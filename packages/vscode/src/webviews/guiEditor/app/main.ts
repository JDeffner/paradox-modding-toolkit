/**
 * The GUI editor app: the thin DOM shell around the pure modules (scene,
 * hit-test, selection, tree, inspector) and the canvas painter. It owns the
 * camera, the panels and the DOM, and nothing else — layout, text and the
 * inspector's rows all come from the host (../messages.ts).
 *
 * G3.1 rendered; G3.2 selects and inspects: click picks the smallest rect,
 * Alt+click cycles the stack, Esc clears, Ctrl/Cmd+Shift+click reveals the
 * declaration in the text editor, and the selection is a positional path so it
 * survives the re-layout that follows every document change.
 *
 * G3.3 writes. Three rules shape the whole edit path:
 * - The GUARDS ARE ASKED FIRST. Pressing on a widget sends the check the
 *   commit would send; nothing moves until the answer is in, so a refused
 *   gesture is refused before the widget budges and has nothing to snap back.
 * - ONE GESTURE IS ONE OP. A drag previews itself locally and commits exactly
 *   once, on release, as `effective value + delta`.
 * - UNDO IS THE DOCUMENT'S. Every write goes back as a host `WorkspaceEdit`,
 *   the change re-lays out, and the canvas follows. This file holds no history.
 */
import type { GuiLayoutResult, GuiWidgetInfo } from "@px-lsp/protocol/protocol";
import type { EditProperty } from "../messages";
import { connectHost } from "./host";
import { buildScene, subtreeEnd, type Scene, type SceneItem, type SceneRect } from "./scene";
import { drawScene, resetImageCache, type Images, WORLD_H, WORLD_W } from "./render";
import { hitRect, hitStack, nextInStack } from "./hitTest";
import { indexOfSelection, selectionAt, type Selection } from "./selection";
import { ancestorKeys, rowKey, treeRows } from "./tree";
import { inspectorRows, widgetTitle, type InspectorRow } from "./inspector";
import {
  baseOf,
  DRAG_THRESHOLD,
  gestureKeys,
  handleAt,
  handleCursor,
  moveWrite,
  pairValue,
  resizeWrite,
  roundDelta,
  type GestureBase,
  type GestureWrite,
  type ResizeHandle,
} from "./gesture";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const stage = document.getElementById("stage") as HTMLDivElement;
const treeEl = document.getElementById("tree") as HTMLDivElement;
const inspectorEl = document.getElementById("inspector") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const toastEl = document.getElementById("toast") as HTMLDivElement;
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

/** A widget with a declaration in THIS document is the only kind a write can reach. */
function canEdit(item: SceneItem | null): item is SceneItem & { line: number } {
  return item !== null && item.editable && item.line !== undefined;
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
  const live = livePreview();
  drawScene(
    ctx,
    scene,
    images,
    { zoom, panX, panY },
    { w, h },
    {
      outlines: outlinesEl.checked,
      fontFamily,
      selected: live?.write.rect ?? (item ? hitRect(item) : undefined),
      handles: canEdit(item),
      preview: live
        ? { from: live.from, to: live.to, dx: live.write.offset.dx, dy: live.write.offset.dy }
        : undefined,
    }
  );
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

/**
 * The canvas repaints at most once per frame while a gesture runs: the pointer
 * fires faster than the display, and a full scene repaint per pointermove is
 * the one thing that makes a drag feel heavy. Text readouts are NOT throttled;
 * they are a single assignment and the numbers must not lag the cursor.
 */
let frame = 0;
function requestDraw(): void {
  if (frame !== 0) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
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
    line.appendChild(rowInput(row, item.line));
    prop.appendChild(line);
    if (!row.local) prop.appendChild(el("div", "from", `from ${row.origin}`));
    inspectorEl.appendChild(prop);
  }
}

/**
 * One editable row. Each edit is ONE `setProperties` op, and a value the guards
 * turn down snaps the row back to what the file still says: the inspector never
 * shows a number the document does not contain.
 *
 * An inherited row is editable too. Writing it overrides the value AT THE USE
 * SITE and leaves the template's or type's own bytes alone (the writer's W09),
 * which is what the "from …" label under the row is there to explain.
 */
function rowInput(row: InspectorRow, line: number): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "val";
  input.value = row.value;
  input.spellcheck = false;
  input.title = row.local
    ? row.value
    : `${row.value} (inherited: writing it adds an override on this widget).`;

  // What the file says as far as this row knows. Enter commits and blur fires
  // `change` right after it, so without this the same write goes twice.
  let committed = row.value;
  const commit = (): void => {
    const value = input.value.trim();
    if (value === committed.trim()) return;
    if (value.length === 0) {
      input.value = committed;
      toast(`${row.key} needs a value. Removing a property is not an edit this editor makes yet.`, "info");
      return;
    }
    const previous = committed;
    committed = value;
    sendEdit("applyEdit", line, [{ key: row.key, value }], (verdict) => {
      if (verdict.refused) {
        committed = previous;
        input.value = previous;
        toast(verdict.refused, "refused");
        return;
      }
      if (verdict.warning) toast(verdict.warning, "warned");
      // A rename is the one write that moves the selection's identity. The
      // READER cannot tell a rename from a delete and clears (selection.ts);
      // the writer knows exactly what it wrote, so it re-points instead.
      if (row.key.toLowerCase() === "name" && selection) {
        selection = { ...selection, name: unquote(value) };
      }
    });
  };

  input.addEventListener("keydown", (ev) => {
    // Typing must not reach the canvas: Escape here reverts the row, it does
    // not clear the selection the row belongs to.
    ev.stopPropagation();
    if (ev.key === "Enter") {
      ev.preventDefault();
      commit();
    } else if (ev.key === "Escape") {
      input.value = committed;
      input.blur();
    }
  });
  input.addEventListener("change", commit);
  return input;
}

/** `"px_card"` -> `px_card`: the scene reports names unquoted, the source quotes them. */
function unquote(value: string): string {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
}

function round(v: number): string {
  return String(Math.round(v * 100) / 100);
}

// ---- toasts ----------------------------------------------------------------

/** How long a message stays up. Refusals are sentences; they need reading time. */
const TOAST_MS = 8000;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * A refusal reason is the SERVER'S sentence and is shown verbatim: it says what
 * the engine would do with the write, which is knowledge this app does not have
 * and must not paraphrase into something friendlier and wrong.
 */
function toast(message: string, kind: "refused" | "warned" | "info"): void {
  toastEl.textContent = message;
  toastEl.className = kind;
  toastEl.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast(): void {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = undefined;
  toastEl.hidden = true;
  toastEl.textContent = "";
}

toastEl.addEventListener("click", hideToast);

// ---- edits -----------------------------------------------------------------

interface EditVerdict {
  refused?: string;
  warning?: string;
}

/** In-flight checks and commits, by the id the host echoes back. */
let nextEditId = 1;
const pendingEdits = new Map<number, (verdict: EditVerdict) => void>();

function sendEdit(
  type: "checkEdit" | "applyEdit",
  line: number,
  properties: EditProperty[],
  onVerdict: (verdict: EditVerdict) => void
): void {
  const id = nextEditId++;
  pendingEdits.set(id, onVerdict);
  host.send({ type, id, line, properties });
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
  // The truth arrived: draw indices, rects and source values are all new, so
  // any preview standing in for it goes, whether it was this editor's write or
  // a keystroke in the text editor.
  gesture = null;
  committing = null;
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
    case "editVerdict": {
      const handler = pendingEdits.get(message.id);
      pendingEdits.delete(message.id);
      handler?.({ refused: message.refused, warning: message.warning });
      return;
    }
    case "error":
      statusEl.textContent = `Error: ${message.message}`;
      return;
  }
});

// ---- gestures --------------------------------------------------------------

/**
 * A pointer press on a widget, and everything the commit it may become needs.
 *
 * `status` is the whole honesty of the feature. A press starts PENDING and asks
 * the guards; the preview shows no movement at all until the answer is in, so a
 * refusal lands before the widget has moved a pixel and there is nothing to
 * snap back. BLOCKED is a gesture with a reason to show; ALLOWED is one that
 * may preview and commit.
 */
interface Gesture {
  index: number;
  /** Draw-list slice of the widget's subtree, for the preview translate. */
  from: number;
  to: number;
  /** The declaration a commit writes to; null when the widget has none here. */
  line: number | null;
  handle: ResizeHandle | null;
  /** World point of the press, and its client point (the threshold is screen pixels). */
  origin: { x: number; y: number };
  screen: { x: number; y: number };
  base: GestureBase;
  rect: SceneRect;
  status: "pending" | "allowed" | "blocked";
  /** Why the gesture cannot commit; shown once, when the user actually tries. */
  reason: string | null;
  /** A warning already shown for this gesture, so the commit does not repeat it. */
  warned: string | null;
  /** Past DRAG_THRESHOLD: this is a drag, not a click. */
  engaged: boolean;
  write: GestureWrite | null;
}

let gesture: Gesture | null = null;
/** A released gesture whose write is in flight: its preview holds until the layout lands. */
let committing: { from: number; to: number; write: GestureWrite } | null = null;

function livePreview(): { from: number; to: number; write: GestureWrite } | null {
  if (committing) return committing;
  if (gesture?.status === "allowed" && gesture.write) {
    return { from: gesture.from, to: gesture.to, write: gesture.write };
  }
  return null;
}

const NO_SOURCE_HERE =
  "comes from a template or a type, so it has no declaration in this file to move or resize.";

/**
 * Arm a gesture on the widget at `index` and ask the guards what the commit
 * would answer. The check carries the widget's CURRENT values, so it writes
 * nothing and its verdict is exactly the one the commit will get.
 */
function beginGesture(
  index: number,
  handle: ResizeHandle | null,
  world: { x: number; y: number },
  screen: { x: number; y: number }
): void {
  const item = scene.items[index];
  if (!item) return;
  const base = baseOf(item);
  const editable = canEdit(item);
  const next: Gesture = {
    index,
    from: index,
    to: subtreeEnd(scene, index),
    line: editable ? item.line : null,
    handle,
    origin: world,
    screen,
    base,
    rect: hitRect(item),
    status: editable ? "pending" : "blocked",
    reason: editable ? null : `${widgetTitle(item)} ${NO_SOURCE_HERE}`,
    warned: null,
    engaged: false,
    write: null,
  };
  gesture = next;
  if (next.line === null) return;

  const properties = gestureKeys(handle).map((key) => ({
    key,
    value:
      key === "position"
        ? pairValue(base.position[0], base.position[1])
        : pairValue(base.size[0], base.size[1]),
  }));
  sendEdit("checkEdit", next.line, properties, (verdict) => {
    if (gesture !== next) return;
    if (verdict.refused) {
      next.status = "blocked";
      next.reason = verdict.refused;
    } else {
      next.status = "allowed";
      if (verdict.warning) next.warned = verdict.warning;
    }
    // The press may already have become a drag while the check was out.
    if (next.engaged) announceGesture(next);
  });
}

/** Say, once, what the guards answered: a refusal, or the axis a box will keep. */
function announceGesture(g: Gesture): void {
  if (g.status === "blocked" && g.reason) {
    toast(g.reason, "refused");
    g.reason = null;
  } else if (g.status === "allowed" && g.warned) {
    toast(g.warned, "warned");
  }
}

function updateGesture(g: Gesture, world: { x: number; y: number }, screen: { x: number; y: number }): void {
  if (!g.engaged) {
    if (Math.hypot(screen.x - g.screen.x, screen.y - g.screen.y) < DRAG_THRESHOLD) return;
    g.engaged = true;
    announceGesture(g);
  }
  // A pending check freezes the preview: the widget must not move before the
  // guards have answered for it.
  if (g.status !== "allowed") return;
  const [dx, dy] = roundDelta(world.x - g.origin.x, world.y - g.origin.y);
  g.write = g.handle ? resizeWrite(g.base, g.rect, g.handle, dx, dy) : moveWrite(g.base, g.rect, dx, dy);
  statusEl.textContent = gestureReadout(g);
  requestDraw();
}

/** The live geometry readout: where the widget is now, and what release would write. */
function gestureReadout(g: Gesture): string {
  const item = scene.items[g.index];
  const rect = g.write?.rect ?? g.rect;
  const geometry = `${round(rect.x)}, ${round(rect.y)} · ${round(rect.w)} x ${round(rect.h)}`;
  const writes =
    g.write && g.write.properties.length > 0
      ? g.write.properties.map((p) => `${p.key} = ${p.value}`).join("  ")
      : "no change yet";
  return `${widgetTitle(item)} · ${geometry} · ${writes}`;
}

/** Release: one op, or an honest reason there is none. */
function endGesture(g: Gesture): void {
  gesture = null;
  if (!g.engaged || g.status !== "allowed" || g.line === null || !g.write) {
    statusEl.textContent = statusLine();
    draw();
    return;
  }
  if (g.write.noop) {
    // Reported, never silently dropped: a drag that rounds to nothing looks
    // exactly like a drag the editor lost.
    toast("That is less than a whole pixel, so nothing was written.", "info");
    statusEl.textContent = statusLine();
    draw();
    return;
  }
  committing = { from: g.from, to: g.to, write: g.write };
  sendEdit("applyEdit", g.line, g.write.properties, (verdict) => {
    if (verdict.refused) {
      // Nothing was written, so the preview is a lie: drop it now rather than
      // waiting for a layout that is not coming.
      committing = null;
      toast(verdict.refused, "refused");
      statusEl.textContent = statusLine();
      draw();
      return;
    }
    if (verdict.warning && verdict.warning !== g.warned) toast(verdict.warning, "warned");
  });
  draw();
}

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
    capture(ev.pointerId);
    stage.style.cursor = "move";
    return;
  }
  if (ev.button !== 0) return;
  const world = toWorld(ev);
  const screen = { x: ev.clientX, y: ev.clientY };
  const current = selectedItem();
  // A handle belongs to the CURRENT selection, so it is tested before the click
  // is allowed to pick anything else: grabbing a corner must never re-select
  // whatever happens to be painted under that corner.
  const handle =
    current && selected !== null && canEdit(current)
      ? handleAt(hitRect(current), world.x, world.y, zoom)
      : null;
  if (handle !== null && selected !== null) {
    // A commit still in flight owns the widget's source values; a second
    // gesture on top of it would add its delta to values the file has left.
    if (committing) return;
    capture(ev.pointerId);
    beginGesture(selected, handle, world, screen);
    return;
  }
  const stack = hitStack(scene, world.x, world.y);
  // Empty canvas clears; Alt steps through everything under the cursor.
  const next = ev.altKey ? nextInStack(stack, selected) : (stack[0] ?? null);
  select(next, { reveal: (ev.ctrlKey || ev.metaKey) && ev.shiftKey });
  if (selected === null || committing) return;
  capture(ev.pointerId);
  beginGesture(selected, null, world, screen);
});
stage.addEventListener("pointermove", (ev) => {
  if (panning) {
    panX = panFrom.panX + (ev.clientX - panFrom.x);
    panY = panFrom.panY + (ev.clientY - panFrom.y);
    draw();
    return;
  }
  const world = toWorld(ev);
  if (gesture) {
    updateGesture(gesture, world, { x: ev.clientX, y: ev.clientY });
    return;
  }
  const current = selectedItem();
  const handle = canEdit(current) ? handleAt(hitRect(current), world.x, world.y, zoom) : null;
  stage.style.cursor = handle ? handleCursor(handle) : "default";
});
stage.addEventListener("pointerup", (ev) => {
  if (ev.button === 1 && panning) {
    panning = false;
    release(ev.pointerId);
    stage.style.cursor = "default";
    return;
  }
  if (ev.button !== 0 || !gesture) return;
  release(ev.pointerId);
  endGesture(gesture);
});
stage.addEventListener("pointercancel", () => {
  // The pointer went away mid-gesture (a touch cancelled, the window lost it):
  // drop the gesture without committing anything.
  if (!gesture) return;
  gesture = null;
  statusEl.textContent = statusLine();
  draw();
});
stage.addEventListener("auxclick", (ev) => {
  if (ev.button === 1) ev.preventDefault();
});

/**
 * Pointer capture is what makes a drag survive leaving the canvas: the events
 * keep coming to this element until release, so a gesture cannot be lost
 * halfway and left half-applied. Guarded because a host page may not implement
 * it (jsdom does not), and a missing capture must not cost the gesture.
 */
function capture(pointerId: number): void {
  try {
    stage.setPointerCapture(pointerId);
  } catch {
    /* not fatal: the gesture just ends if the pointer leaves */
  }
}

function release(pointerId: number): void {
  try {
    stage.releasePointerCapture(pointerId);
  } catch {
    /* never captured */
  }
}
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
  if (ev.key !== "Escape") return;
  if (gesture) {
    // Escape abandons the drag in progress before it touches the selection:
    // the widget snaps back to where the file still has it.
    gesture = null;
    hideToast();
    statusEl.textContent = statusLine();
    draw();
    return;
  }
  if (selected !== null) select(null, { reveal: false });
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
