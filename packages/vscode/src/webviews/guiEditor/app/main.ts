/**
 * The GUI editor app: the thin DOM shell around the pure modules (scene,
 * hit-test, selection, tree, inspector) and the canvas painter. It owns the
 * camera, the panels and the DOM, and nothing else — layout, text and the
 * inspector's rows all come from the host (../messages.ts).
 *
 * G3.1 rendered; G3.2 selects and inspects: click picks the smallest rect,
 * Alt+click cycles the stack, Esc clears, Ctrl/Cmd+Shift+click reveals the
 * declaration in the text editor, and the selection is a positional path so it
 * survives the re-layout that follows every document change. The edit gestures
 * land in G3.3.
 */
import type { GuiLayoutResult, GuiWidgetInfo } from "@px-lsp/protocol/protocol";
import { connectHost } from "./host";
import { buildScene, type Scene, type SceneItem } from "./scene";
import { drawScene, resetImageCache, type Images, WORLD_H, WORLD_W } from "./render";
import { hitRect, hitStack, nextInStack } from "./hitTest";
import { indexOfSelection, selectionAt, type Selection } from "./selection";
import { ancestorKeys, rowKey, treeRows } from "./tree";
import { inspectorRows, widgetTitle } from "./inspector";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const stage = document.getElementById("stage") as HTMLDivElement;
const treeEl = document.getElementById("tree") as HTMLDivElement;
const inspectorEl = document.getElementById("inspector") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const metaEl = document.getElementById("meta") as HTMLSpanElement;
const zoomLabel = document.getElementById("zoomLabel") as HTMLSpanElement;
const outlinesEl = document.getElementById("outlines") as HTMLInputElement;
/** The game font is embedded by the host when it could read it. */
const fontFamily = document.body.dataset.font === "game" ? "PxGuiGameFont, Georgia, serif" : "Georgia, serif";

let scene: Scene = { items: [], count: 0 };
let images: Images = {};
let file = "";
let defsFiles = 0;
let zoom = 0.5;
/** Canvas-local screen = world * zoom + pan. Unclamped, so nothing is unreachable. */
let panX = 0;
let panY = 0;
let fitPending = true;
let panning = false;
let panFrom = { x: 0, y: 0, panX: 0, panY: 0 };

/** The selection's identity across re-parses; `selected` is its index in THIS scene. */
let selection: Selection | null = null;
let selected: number | null = null;
/** Collapsed tree rows, by positional path, so collapse survives a re-layout too. */
const collapsed = new Set<string>();
const rowEls = new Map<number, HTMLElement>();
/** The host's answer for `infoLine`; kept only while the selection still asks for it. */
let info: GuiWidgetInfo | null = null;
let infoLine: number | null = null;

function selectedItem(): SceneItem | null {
  return selected === null ? null : (scene.items[selected] ?? null);
}

function clampZoom(z: number): number {
  return Math.min(4, Math.max(0.05, z));
}

function draw(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  canvas.width = w;
  canvas.height = h;
  const item = selectedItem();
  drawScene(
    ctx,
    scene,
    images,
    { zoom, panX, panY },
    { w, h },
    {
      outlines: outlinesEl.checked,
      fontFamily,
      selected: item ? hitRect(item) : undefined,
    }
  );
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

/** Zoom to z keeping the world point at canvas-local (sx, sy) fixed on screen. */
function zoomToPoint(sx: number, sy: number, z: number): void {
  const next = clampZoom(z);
  panX = sx - ((sx - panX) / zoom) * next;
  panY = sy - ((sy - panY) / zoom) * next;
  zoom = next;
  draw();
}

function fitAndCenter(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  zoom = clampZoom(Math.min(w / WORLD_W, h / WORLD_H));
  panX = (w - WORLD_W * zoom) / 2;
  panY = (h - WORLD_H * zoom) / 2;
  draw();
}

// ---- panels ----------------------------------------------------------------

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // textContent, never innerHTML: widget names are document text.
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderTree(): void {
  const fragment = document.createDocumentFragment();
  rowEls.clear();
  for (const row of treeRows(scene, collapsed)) {
    const node = el("div", "row");
    node.style.paddingLeft = `${4 + row.depth * 12}px`;
    const twisty = el("span", "twisty", row.hasChildren ? (row.collapsed ? "▸" : "▾") : "");
    if (row.hasChildren) {
      twisty.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const key = rowKey(scene.items[row.index].path);
        if (collapsed.has(key)) collapsed.delete(key);
        else collapsed.add(key);
        renderTree();
      });
    }
    node.appendChild(twisty);
    node.appendChild(el("span", undefined, row.key));
    if (row.name) node.appendChild(el("span", "rowName", `#${row.name}`));
    if (row.synthetic) {
      const tag = el("span", "tag", "synthetic");
      tag.title = "Spliced in from a template or a type: no source of its own in this file.";
      node.appendChild(tag);
    }
    if (row.ghost) {
      const tag = el("span", "tag", "ghost");
      tag.title = "A datamodel placeholder: the list has no runtime rows in a static preview.";
      node.appendChild(tag);
    }
    node.addEventListener("click", () => select(row.index, { reveal: false }));
    rowEls.set(row.index, node);
    fragment.appendChild(node);
  }
  treeEl.textContent = "";
  treeEl.appendChild(fragment);
  highlightTree(false);
}

function highlightTree(scrollTo: boolean): void {
  for (const [index, node] of rowEls) {
    const isSelected = index === selected;
    node.classList.toggle("selected", isSelected);
    if (isSelected && scrollTo) node.scrollIntoView({ block: "nearest" });
  }
}

function renderInspector(): void {
  const item = selectedItem();
  inspectorEl.textContent = "";
  if (!item) {
    inspectorEl.appendChild(el("div", "note", "Nothing selected. Click a widget on the canvas."));
    return;
  }
  const head = el("div", "head");
  head.appendChild(el("div", undefined, widgetTitle(item)));
  const r = item.rect;
  head.appendChild(el("div", "chain", `${round(r.x)}, ${round(r.y)} · ${round(r.w)} x ${round(r.h)}`));
  if (info && infoLine === item.line && info.typeChain.length > 0) {
    head.appendChild(el("div", "chain", `type chain: ${info.typeChain.join(" -> ")}`));
  }
  inspectorEl.appendChild(head);

  if (!item.editable || item.line === undefined) {
    inspectorEl.appendChild(
      el(
        "div",
        "note",
        "This widget is spliced in from a template or a type, so it has no declaration in this file to inspect or edit."
      )
    );
    return;
  }
  if (!info || infoLine !== item.line) {
    inspectorEl.appendChild(el("div", "note", "Reading properties…"));
    return;
  }
  const rows = inspectorRows(info);
  if (rows.length === 0) {
    inspectorEl.appendChild(el("div", "note", "This widget sets no properties."));
    return;
  }
  for (const row of rows) {
    const prop = el("div", "prop");
    const line = el("div", "line");
    line.appendChild(el("span", "key", row.key));
    const value = el("span", "val", row.value);
    value.title = row.value;
    line.appendChild(value);
    prop.appendChild(line);
    if (!row.local) prop.appendChild(el("div", "from", `from ${row.origin}`));
    inspectorEl.appendChild(prop);
  }
}

function round(v: number): string {
  return String(Math.round(v * 100) / 100);
}

// ---- selection -------------------------------------------------------------

function select(index: number | null, options: { reveal: boolean; rebuildTree?: boolean }): void {
  selected = index;
  selection = index === null ? null : selectionAt(scene, index);
  const item = selectedItem();
  if (!item || item.line === undefined || !item.editable) {
    info = null;
    infoLine = null;
  } else if (infoLine !== item.line) {
    info = null;
    infoLine = null;
    host.send({ type: "requestWidgetInfo", line: item.line });
  }
  // Reveal the row: expanding an ancestor changes the row list, and only then
  // is a rebuild worth it. A tree can be 13,000 rows deep (window_character),
  // so a selection that changes no row must not rebuild one.
  let expanded = false;
  if (index !== null) {
    for (const key of ancestorKeys(scene, index)) expanded = collapsed.delete(key) || expanded;
  }
  if (options.reveal && item?.line !== undefined) host.send({ type: "reveal", line: item.line });
  if (expanded || options.rebuildTree) renderTree();
  highlightTree(true);
  renderInspector();
  statusEl.textContent = statusLine();
  draw();
}

function statusLine(): string {
  const ghosts = scene.items.filter((i) => i.ghostBox).length;
  const estimated = ghosts > 0 ? ` · ${ghosts} unmeasurable (dashed)` : "";
  const item = selectedItem();
  const picked = item ? ` · selected ${widgetTitle(item)}${item.editable ? "" : " (synthetic)"}` : "";
  return `${scene.count} widgets · ${file}${estimated}${picked}`;
}

function loadTextures(urls: Record<string, string | null>): void {
  images = {};
  resetImageCache();
  let pending = 0;
  for (const [texture, url] of Object.entries(urls)) {
    if (!url) continue;
    const img = new Image();
    pending++;
    const done = () => {
      if (--pending === 0) draw();
    };
    img.onload = () => {
      images[texture] = img;
      done();
    };
    img.onerror = done;
    img.src = url;
  }
}

function onLayout(result: GuiLayoutResult, textures: Record<string, string | null>, name: string): void {
  file = name;
  defsFiles = result.defsFiles;
  scene = buildScene(result.nodes);
  metaEl.textContent = `${defsFiles} gui files in template store`;
  seedCollapse();
  // The document changed under the selection: find the same widget again by its
  // path, and re-read its properties, whose lines may have moved.
  const restored = selection ? indexOfSelection(scene, selection) : null;
  infoLine = null;
  info = null;
  loadTextures(textures);
  if (fitPending) {
    fitPending = false;
    fitAndCenter();
  }
  select(restored, { reveal: false, rebuildTree: true });
}

/**
 * A tree taller than this opens collapsed to its top level. Not a measurement,
 * a UI budget: `window_character` expands to 13,702 widgets with the vanilla
 * template store behind it, and a list that long is neither scannable nor
 * affordable to rebuild after every keystroke's re-layout. Seeded ONCE, so a
 * row the user opened stays open through every later layout.
 */
const TREE_AUTO_COLLAPSE_ROWS = 2000;
let treeSeeded = false;

function seedCollapse(): void {
  if (treeSeeded) return;
  treeSeeded = true;
  if (scene.count <= TREE_AUTO_COLLAPSE_ROWS) return;
  // Every row, so what is left is the top level; clicking a widget on the
  // canvas opens the path down to it.
  for (const item of scene.items) collapsed.add(rowKey(item.path));
}

const host = connectHost((message) => {
  switch (message.type) {
    case "loading":
      statusEl.textContent = `Laying out ${message.file}…`;
      return;
    case "layout":
      onLayout(message.result, message.textures, message.file);
      return;
    case "widgetInfo": {
      const item = selectedItem();
      // Stale answer: the selection moved while the host was reading.
      if (!item || item.line !== message.line) return;
      info = message.info;
      infoLine = message.line;
      renderInspector();
      return;
    }
    case "error":
      statusEl.textContent = `Error: ${message.message}`;
      return;
  }
});

// ---- camera and selection interactions -------------------------------------

/** Canvas-local screen point -> world (game) coordinates: the camera, inverted. */
function toWorld(ev: { clientX: number; clientY: number }): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: (ev.clientX - rect.left - panX) / zoom, y: (ev.clientY - rect.top - panY) / zoom };
}

stage.addEventListener("pointerdown", (ev) => {
  if (ev.button === 1) {
    // Middle mouse drags the camera.
    ev.preventDefault();
    panning = true;
    panFrom = { x: ev.clientX, y: ev.clientY, panX, panY };
    stage.setPointerCapture(ev.pointerId);
    stage.style.cursor = "move";
    return;
  }
  if (ev.button !== 0) return;
  const world = toWorld(ev);
  const stack = hitStack(scene, world.x, world.y);
  // Empty canvas clears; Alt steps through everything under the cursor.
  const next = ev.altKey ? nextInStack(stack, selected) : (stack[0] ?? null);
  select(next, { reveal: (ev.ctrlKey || ev.metaKey) && ev.shiftKey });
});
stage.addEventListener("pointermove", (ev) => {
  if (!panning) return;
  panX = panFrom.panX + (ev.clientX - panFrom.x);
  panY = panFrom.panY + (ev.clientY - panFrom.y);
  draw();
});
stage.addEventListener("pointerup", (ev) => {
  if (ev.button !== 1 || !panning) return;
  panning = false;
  stage.releasePointerCapture(ev.pointerId);
  stage.style.cursor = "default";
});
stage.addEventListener("auxclick", (ev) => {
  if (ev.button === 1) ev.preventDefault();
});
stage.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomToPoint(ev.clientX - rect.left, ev.clientY - rect.top, zoom * (ev.deltaY < 0 ? 1.15 : 1 / 1.15));
  },
  { passive: false }
);
window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && selected !== null) select(null, { reveal: false });
});

// ---- toolbar ---------------------------------------------------------------

document.getElementById("zoomIn")!.addEventListener("click", () => {
  zoomToPoint(stage.clientWidth / 2, stage.clientHeight / 2, zoom * 1.25);
});
document.getElementById("zoomOut")!.addEventListener("click", () => {
  zoomToPoint(stage.clientWidth / 2, stage.clientHeight / 2, zoom / 1.25);
});
document.getElementById("zoomFit")!.addEventListener("click", fitAndCenter);
document.getElementById("refresh")!.addEventListener("click", () => host.send({ type: "requestLayout" }));
outlinesEl.addEventListener("change", draw);
window.addEventListener("resize", draw);

renderInspector();
host.send({ type: "ready" });
