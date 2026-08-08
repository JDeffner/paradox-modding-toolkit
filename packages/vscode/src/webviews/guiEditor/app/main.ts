/**
 * The GUI editor app: the thin DOM shell around the pure modules (scene,
 * hit-test, selection, tree, layers, snap, inspector) and the canvas painter.
 * It owns the camera, the panels and the DOM, and nothing else — layout, text
 * and the inspector's rows all come from the host (../messages.ts).
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
 *
 * G4 is the UX pass and adds nothing to those rules. The layers panel, the
 * smart guides, the subtree focus and the eye/lock/solo toggles are all VIEWS
 * over the same scene; the only new write is a reorder, and it goes out as one
 * op through the same pending-verdict map as everything else.
 */
import type { GuiLayoutResult, GuiWidgetInfo } from "@px-lsp/protocol/protocol";
import type { AppToHost, EditProperty } from "../messages";
import { connectHost } from "./host";
import {
  buildScene,
  childIndices,
  parentIndex,
  subtreeEnd,
  type Scene,
  type SceneItem,
  type SceneRect,
} from "./scene";
import { drawScene, resetImageCache, type DrawMasks, type Images, WORLD_H, WORLD_W } from "./render";
import { hitRect, hitStack, nextInStack } from "./hitTest";
import { indexOfSelection, selectionAt, type Selection } from "./selection";
import { ancestorKeys, rowKey, treeRows } from "./tree";
import { inspectorRows, widgetTitle, type InspectorRow } from "./inspector";
import { boxAxis, dropRank, layerRows, type LayerRow } from "./layers";
import { GRID_STEP, MOVE_EDGES, snapRect, type Guide, type SnapConfig, type SnapResult } from "./snap";
import {
  baseOf,
  DRAG_THRESHOLD,
  edgesOf,
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
const layersEl = document.getElementById("layers") as HTMLDivElement;
const focusBarEl = document.getElementById("focusBar") as HTMLDivElement;
const inspectorEl = document.getElementById("inspector") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const toastEl = document.getElementById("toast") as HTMLDivElement;
const metaEl = document.getElementById("meta") as HTMLSpanElement;
const zoomLabel = document.getElementById("zoomLabel") as HTMLSpanElement;
const outlinesEl = document.getElementById("outlines") as HTMLInputElement;
const snapToggle = document.getElementById("snap") as HTMLInputElement;
const gridToggle = document.getElementById("grid") as HTMLInputElement;
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

/**
 * The layers panel's three toggles and the tree's subtree focus, all keyed by
 * POSITIONAL PATH like `collapsed`, for the same reason: a draw index means
 * nothing after the next layout, and a widget the user hid must stay hidden
 * across the re-layout their own edit caused.
 */
const hiddenPaths = new Set<string>();
const lockedPaths = new Set<string>();
let soloPath: string | null = null;
let focusPath: string | null = null;
/** Resolved from `focusPath` against THIS scene; null when nothing is focused. */
let focusIndex: number | null = null;
/** The layers row under the pointer, outlined on the canvas until it leaves. */
let flashIndex: number | null = null;

/**
 * The paths above, resolved into per-item masks. Rebuilt when they change and
 * never per frame: a drag repaints at 60 Hz and a mask rebuild there would put
 * a full scene walk inside the frame budget.
 */
const masks: DrawMasks = { hidden: null, dim: null };
/** What the canvas hit-test skips: hidden, locked, or outside the focus. */
let skipMask: Uint8Array | null = null;

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

// ---- eye, lock, solo and focus, as masks -----------------------------------

/**
 * Resolve the four path sets against the current scene. Every set is normally
 * empty, and then this walks nothing: the map from path to draw index is only
 * built when there is something to look up, because building it over a 13,700
 * widget scene is a cost no untouched editor should pay on every layout.
 */
function rebuildMasks(): void {
  const n = scene.items.length;
  focusIndex = null;
  masks.hidden = null;
  masks.dim = null;
  skipMask = null;
  if (hiddenPaths.size === 0 && lockedPaths.size === 0 && soloPath === null && focusPath === null) return;

  const byPath = new Map<string, number>();
  for (let i = 0; i < n; i++) byPath.set(rowKey(scene.items[i].path), i);
  // A widget the file no longer has cannot stay hidden, locked, soloed or
  // focused: the state would be invisible and unclearable.
  for (const set of [hiddenPaths, lockedPaths]) {
    for (const key of [...set]) if (!byPath.has(key)) set.delete(key);
  }
  if (soloPath !== null && !byPath.has(soloPath)) soloPath = null;
  if (focusPath !== null && !byPath.has(focusPath)) focusPath = null;

  const hidden = new Uint8Array(n);
  const skip = new Uint8Array(n);
  focusIndex = focusPath === null ? null : (byPath.get(focusPath) ?? null);
  if (focusIndex !== null) {
    const end = subtreeEnd(scene, focusIndex);
    for (let i = 0; i < n; i++) if (i < focusIndex || i >= end) hidden[i] = 1;
  }
  for (const key of hiddenPaths) markSubtree(hidden, byPath.get(key));
  for (const key of lockedPaths) markSubtree(skip, byPath.get(key));
  // Something not drawn cannot be clicked: a hit on it would be a hit on
  // nothing the user can see.
  let anyHidden = false;
  for (let i = 0; i < n; i++) {
    if (!hidden[i]) continue;
    anyHidden = true;
    skip[i] = 1;
  }
  masks.hidden = anyHidden ? hidden : null;
  skipMask = skip.some((v) => v === 1) ? skip : null;

  const solo = soloPath === null ? null : (byPath.get(soloPath) ?? null);
  if (solo !== null) {
    const dim = new Uint8Array(n);
    const end = subtreeEnd(scene, solo);
    for (let i = 0; i < n; i++) if (i < solo || i >= end) dim[i] = 1;
    masks.dim = dim;
  }
}

function markSubtree(mask: Uint8Array, index: number | undefined): void {
  if (index === undefined) return;
  const end = subtreeEnd(scene, index);
  for (let i = index; i < end; i++) mask[i] = 1;
}

function draw(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  canvas.width = w;
  canvas.height = h;
  const item = selectedItem();
  const live = livePreview();
  const rect = live?.write.rect ?? (item ? hitRect(item) : undefined);
  drawScene(
    ctx,
    scene,
    images,
    { zoom, panX, panY },
    { w, h },
    {
      outlines: outlinesEl.checked,
      fontFamily,
      selected: rect,
      handles: canEdit(item),
      preview: live
        ? { from: live.from, to: live.to, dx: live.write.offset.dx, dy: live.write.offset.dy }
        : undefined,
      masks,
      grid: gridToggle.checked ? GRID_STEP : 0,
      guides: gesture?.snap?.guides,
      bars: gesture?.snap?.bars,
      flash: flashIndex === null ? undefined : hitRect(scene.items[flashIndex]),
      dropLine: gesture?.drop?.line,
      readout: live && rect ? { x: rect.x, y: rect.y, text: geometry(rect) } : undefined,
    }
  );
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function geometry(rect: SceneRect): string {
  return `${round(rect.x)}, ${round(rect.y)} · ${round(rect.w)} x ${round(rect.h)}`;
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

/**
 * Centre one world rect in the stage, with a margin so a focused subtree does
 * not sit flush against the edges. The reference viewport keeps its own exact
 * fit above: that one has to land on the same numbers every time.
 */
function fitRect(rect: SceneRect): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const margin = 16;
  zoom = clampZoom(Math.min((w - margin * 2) / Math.max(1, rect.w), (h - margin * 2) / Math.max(1, rect.h)));
  panX = (w - rect.w * zoom) / 2 - rect.x * zoom;
  panY = (h - rect.h * zoom) / 2 - rect.y * zoom;
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
  for (const row of treeRows(scene, collapsed, focusIndex)) {
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

// ---- subtree focus ---------------------------------------------------------

/**
 * Scope the tree and the canvas to one widget's subtree. Everything outside it
 * stops being drawn, stops being clickable and stops being a tree row, so a
 * 13,700 widget window becomes the twelve widgets the user is actually working
 * on. The breadcrumb is the only way back, which is why it is always visible.
 */
function setFocus(index: number | null): void {
  if (index !== null) {
    const key = rowKey(scene.items[index].path);
    // Focusing a collapsed row would show one row and nothing under it.
    collapsed.delete(key);
    focusPath = key;
  } else {
    focusPath = null;
  }
  rebuildMasks();
  renderFocusBar();
  renderTree();
  highlightTree(true);
  statusEl.textContent = statusLine();
  draw();
}

function renderFocusBar(): void {
  focusBarEl.textContent = "";
  if (focusIndex === null) {
    const button = el("button", undefined, "Focus subtree") as HTMLButtonElement;
    button.title = "Show only the selected widget and what is inside it (f)";
    button.disabled = selected === null;
    button.addEventListener("click", () => {
      if (selected !== null) setFocus(selected);
    });
    focusBarEl.appendChild(button);
    return;
  }
  // The ancestors are no longer rows, so the crumbs are the only way up.
  const chain: number[] = [];
  for (let i: number | null = parentIndex(scene, focusIndex); i !== null; i = parentIndex(scene, i)) {
    chain.unshift(i);
  }
  for (const index of chain) {
    const crumb = el("span", "crumb", widgetTitle(scene.items[index]));
    crumb.addEventListener("click", () => setFocus(index));
    focusBarEl.appendChild(crumb);
    focusBarEl.appendChild(el("span", "sepArrow", "›"));
  }
  focusBarEl.appendChild(el("span", undefined, widgetTitle(scene.items[focusIndex])));
  const button = el("button", undefined, "Unfocus");
  button.style.marginLeft = "auto";
  button.addEventListener("click", () => setFocus(null));
  focusBarEl.appendChild(button);
}

// ---- the layers panel ------------------------------------------------------

/**
 * A container with more rows than this shows a window around the selected
 * child. Not a measurement, a UI budget of the same kind the tree has: a
 * datamodel vbox can hold thousands of rows, and a list that long is neither
 * scannable nor worth rebuilding whenever the selection moves inside it.
 */
const LAYERS_MAX_ROWS = 300;

/** The container the panel is currently listing, so a sibling click does not rebuild it. */
let layersContainer: number | null = null;
let layersBuilt = false;
const layerEls = new Map<number, HTMLElement>();

function syncLayers(): void {
  const container = selected === null ? null : parentIndex(scene, selected);
  if (layersBuilt && container === layersContainer) {
    highlightLayers();
    return;
  }
  layersContainer = container;
  layersBuilt = true;
  renderLayers();
}

function renderLayers(): void {
  layersEl.textContent = "";
  layerEls.clear();
  const rows = layerRows(scene, layersContainer);
  const container = layersContainer === null ? null : scene.items[layersContainer];
  const reorderable = layersContainer !== null && container !== null && canEdit(container);

  const head = el("div", "head");
  head.appendChild(el("div", "title", container ? `In ${widgetTitle(container)}` : "Document root"));
  head.appendChild(
    el(
      "div",
      "hint",
      reorderable
        ? "Source order: later rows paint on top, and in a box that is the layout order. Drag to reorder."
        : "Source order. These are the file's root widgets: there is no parent widget to reorder them inside."
    )
  );
  layersEl.appendChild(head);
  if (rows.length === 0) {
    layersEl.appendChild(el("div", "note", "This widget's container has no children."));
    return;
  }

  const shown = visibleWindow(rows);
  if (shown.start > 0) {
    layersEl.appendChild(el("div", "note", `${shown.start} more above.`));
  }
  for (let i = shown.start; i < shown.end; i++) {
    layersEl.appendChild(layerRowEl(rows[i], reorderable));
  }
  if (shown.end < rows.length) {
    layersEl.appendChild(el("div", "note", `${rows.length - shown.end} more below.`));
  }
  highlightLayers();
}

/** The slice of rows around the selection that the budget allows. */
function visibleWindow(rows: readonly LayerRow[]): { start: number; end: number } {
  if (rows.length <= LAYERS_MAX_ROWS) return { start: 0, end: rows.length };
  const at = Math.max(
    0,
    rows.findIndex((r) => r.index === selected)
  );
  const start = Math.min(Math.max(0, at - LAYERS_MAX_ROWS / 2), rows.length - LAYERS_MAX_ROWS);
  return { start, end: start + LAYERS_MAX_ROWS };
}

function layerRowEl(row: LayerRow, reorderable: boolean): HTMLElement {
  const key = rowKey(scene.items[row.index].path);
  const node = el("div", "row");
  node.classList.toggle("hiddenWidget", hiddenPaths.has(key));
  node.appendChild(el("span", "grip", reorderable && !row.synthetic ? "⠿" : ""));
  node.appendChild(
    toggle("◉", "◌", hiddenPaths.has(key), "Hide this widget in the preview", () => {
      if (hiddenPaths.has(key)) hiddenPaths.delete(key);
      else hiddenPaths.add(key);
      afterToggle();
    })
  );
  node.appendChild(
    toggle("▢", "▣", lockedPaths.has(key), "Lock: the canvas stops picking this widget", () => {
      if (lockedPaths.has(key)) lockedPaths.delete(key);
      else lockedPaths.add(key);
      afterToggle();
    })
  );
  node.appendChild(
    toggle("○", "◍", soloPath === key, "Solo: dim everything that is not this widget", () => {
      soloPath = soloPath === key ? null : key;
      afterToggle();
    })
  );
  const label = el("span", "label", widgetTitle(row));
  node.appendChild(label);
  if (row.synthetic) {
    const tag = el("span", "tag", "synthetic");
    tag.title = "Spliced in from a template or a type: no source of its own to move.";
    node.appendChild(tag);
  }

  node.addEventListener("pointerdown", (ev) => onLayerPointerDown(ev as PointerEvent, row, reorderable));
  node.addEventListener("pointermove", (ev) => onLayerPointerMove(ev as PointerEvent, row));
  node.addEventListener("pointerenter", () => {
    flashIndex = row.index;
    requestDraw();
  });
  node.addEventListener("pointerleave", () => {
    if (flashIndex !== row.index) return;
    flashIndex = null;
    requestDraw();
  });
  layerEls.set(row.index, node);
  return node;
}

/** One glyph column: `on` when the state is set, `off` when it is not. */
function toggle(off: string, on: string, active: boolean, title: string, run: () => void): HTMLElement {
  const node = el("span", `toggle${active ? " on" : ""}`, active ? on : off);
  node.title = title;
  node.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  node.addEventListener("click", (ev) => {
    ev.stopPropagation();
    run();
  });
  return node;
}

function afterToggle(): void {
  rebuildMasks();
  renderLayers();
  draw();
}

function highlightLayers(): void {
  for (const [index, node] of layerEls) node.classList.toggle("selected", index === selected);
}

/**
 * The editable rows by key, so a gesture can show its numbers in them while it
 * runs. Live values only: the file is unchanged until release, and a gesture
 * that ends without a commit rebuilds the panel from what the file still says.
 */
const inspectorInputs = new Map<string, HTMLInputElement>();

function previewInspector(write: GestureWrite): void {
  for (const property of write.properties) {
    const input = inspectorInputs.get(property.key);
    if (input) input.value = property.value;
  }
}

function renderInspector(): void {
  const item = selectedItem();
  inspectorEl.textContent = "";
  inspectorInputs.clear();
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
    const input = rowInput(row, item.line);
    inspectorInputs.set(row.key, input);
    line.appendChild(input);
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
  awaitVerdict((id) => ({ type, id, line, properties }), onVerdict);
}

function sendReorder(
  type: "checkReorder" | "reorder",
  ctx: ReorderContext,
  to: number,
  onVerdict: (verdict: EditVerdict) => void
): void {
  awaitVerdict((id) => ({ type, id, line: ctx.parentLine, from: ctx.from, to }), onVerdict);
}

function awaitVerdict(build: (id: number) => AppToHost, onVerdict: (verdict: EditVerdict) => void): void {
  const id = nextEditId++;
  pendingEdits.set(id, onVerdict);
  host.send(build(id));
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
  syncLayers();
  if (focusIndex === null) renderFocusBar();
  renderInspector();
  statusEl.textContent = statusLine();
  draw();
}

function statusLine(): string {
  const ghosts = scene.items.filter((i) => i.ghostBox).length;
  const estimated = ghosts > 0 ? ` · ${ghosts} unmeasurable (dashed)` : "";
  const item = selectedItem();
  const picked = item ? ` · selected ${widgetTitle(item)}${item.editable ? "" : " (synthetic)"}` : "";
  const focused = focusIndex === null ? "" : ` · focused on ${widgetTitle(scene.items[focusIndex])}`;
  return `${scene.count} widgets · ${file}${estimated}${focused}${picked}`;
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
  rowDrag = null;
  flashIndex = null;
  layersBuilt = false;
  metaEl.textContent = `${defsFiles} gui files in template store`;
  seedCollapse();
  // Every path-keyed view (eye, lock, solo, focus) re-resolves against the new
  // draw indices before anything reads a mask.
  rebuildMasks();
  renderFocusBar();
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
  status: "pending" | "allowed" | "blocked" | "reorder";
  /** Why the gesture cannot commit as a move; shown once, when the user tries. */
  reason: string | null;
  /** A warning already shown for this gesture, so the commit does not repeat it. */
  warned: string | null;
  /** Past DRAG_THRESHOLD: this is a drag, not a click. */
  engaged: boolean;
  write: GestureWrite | null;
  /** The other children of the same container: what the smart guides align to. */
  siblings: SceneRect[];
  /** What the last preview snapped to, for the guide lines. */
  snap: SnapResult | null;
  /** Set when the guards turned the move down but the container can be reordered. */
  reorder: ReorderContext | null;
  /** Where a reorder drag would drop, as the op's `to` index plus its drop line. */
  drop: { to: number; line: Guide } | null;
}

/**
 * A container whose source children a drag can permute. The indices are ranks
 * among the children THIS DOCUMENT DECLARES, which is what the `reorder` op
 * counts (messages.ts): a template- or type-supplied child has no bytes here
 * and no rank.
 */
interface ReorderContext {
  /** The container's own line: the op is addressed to the parent, not the child. */
  parentLine: number;
  /** Draw indices of the reorderable children, in source order. */
  children: number[];
  /** Their rects, resolved once: a drag reads them every frame and allocates none. */
  rects: SceneRect[];
  /** The dragged child's rank among them. */
  from: number;
  /** Which way the container lays its children out, read off their rects. */
  axis: "x" | "y";
}

/**
 * The reorder a drag on `index` could become, or null when there is none: a
 * root widget has no parent widget the op could be addressed to, a synthetic
 * parent has no bytes here, and a lone child has nothing to permute with.
 */
function reorderContextFor(index: number): ReorderContext | null {
  const parent = parentIndex(scene, index);
  if (parent === null) return null;
  const container = scene.items[parent];
  if (!canEdit(container)) return null;
  const rows = layerRows(scene, parent).filter((row) => !row.synthetic);
  if (rows.length < 2) return null;
  const from = rows.findIndex((row) => row.index === index);
  if (from < 0) return null;
  const children = rows.map((row) => row.index);
  const rects = children.map(rectOf);
  return { parentLine: container.line, children, rects, from, axis: boxAxis(rects) };
}

function rectOf(index: number): SceneRect {
  return hitRect(scene.items[index]);
}

/** How close to an alignment a drag has to be, in SCREEN pixels, to take it. */
const SNAP_SCREEN_PX = 6;

function snapConfig(): SnapConfig {
  return {
    tolerance: SNAP_SCREEN_PX / zoom,
    grid: gridToggle.checked ? GRID_STEP : 0,
    guides: snapToggle.checked,
  };
}

/** The other children of the widget's own container: everything a guide can align to. */
function siblingRects(index: number): SceneRect[] {
  const rects: SceneRect[] = [];
  for (const i of childIndices(scene, parentIndex(scene, index))) {
    if (i === index || masks.hidden?.[i]) continue;
    const rect = rectOf(i);
    if (rect.w > 0 && rect.h > 0) rects.push(rect);
  }
  return rects;
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
    siblings: siblingRects(index),
    snap: null,
    reorder: null,
    drop: null,
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
      next.reason = verdict.refused;
      // A move the container refuses is not a dead gesture when the container
      // is one that places its children itself: what a drag means there is a
      // change of LAYOUT ORDER, which is a reorder, and the refusal above is
      // the server's own explanation of why it is not a move.
      const reorder = handle === null ? reorderContextFor(index) : null;
      next.status = reorder ? "reorder" : "blocked";
      next.reorder = reorder;
      if (reorder) probeReorder(reorder, next);
    } else {
      next.status = "allowed";
      if (verdict.warning) next.warned = verdict.warning;
    }
    // The press may already have become a drag while the check was out.
    if (next.engaged) announceGesture(next);
  });
}

/**
 * The gesture-start check for a reorder, the same probe pattern as `checkEdit`:
 * ask the guards before the drag moves anything. The drop is not known yet, so
 * what is asked about is the neighbouring slot, the smallest legal move (see
 * messages.ts); the commit's own answer is still shown when it differs.
 */
function probeReorder(ctx: ReorderContext, owner: Gesture | RowDrag): void {
  const to = ctx.from === ctx.children.length - 1 ? ctx.from - 1 : ctx.from + 1;
  sendReorder("checkReorder", ctx, to, (verdict) => {
    if (gesture !== owner && rowDrag !== owner) return;
    if (!verdict.refused) return;
    owner.status = "blocked";
    owner.reason = verdict.refused;
    if (owner.engaged) announceGesture(owner);
  });
}

/** Say, once, what the guards answered: a refusal, or the axis a box will keep. */
function announceGesture(g: { status: string; reason: string | null; warned?: string | null }): void {
  if (g.status === "blocked" && g.reason) {
    toast(g.reason, "refused");
    g.reason = null;
  } else if (g.status === "reorder" && g.reason) {
    // Verbatim, like every refusal: only the severity differs, because the
    // gesture is not refused, the MOVE is, and the drag still does something.
    toast(g.reason, "info");
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
  if (g.status === "reorder" && g.reorder) {
    updateReorderDrag(g, world);
    return;
  }
  // A pending check freezes the preview: the widget must not move before the
  // guards have answered for it.
  if (g.status !== "allowed") return;
  const [rawX, rawY] = roundDelta(world.x - g.origin.x, world.y - g.origin.y);
  let write = writeFor(g, rawX, rawY);
  const snap = snapRect(write.rect, g.siblings, g.handle ? edgesOf(g.handle) : MOVE_EDGES, snapConfig());
  if (snap.dx !== 0 || snap.dy !== 0) {
    // Rounded again, for the reason gesture.ts rounds at all: the preview, the
    // readout and the commit have to come out of one whole-pixel delta.
    const [dx, dy] = roundDelta(rawX + snap.dx, rawY + snap.dy);
    write = writeFor(g, dx, dy);
  }
  g.snap = snap;
  g.write = write;
  statusEl.textContent = gestureReadout(g);
  previewInspector(write);
  requestDraw();
}

function writeFor(g: Gesture, dx: number, dy: number): GestureWrite {
  return g.handle ? resizeWrite(g.base, g.rect, g.handle, dx, dy) : moveWrite(g.base, g.rect, dx, dy);
}

/**
 * Where a reorder drag would drop: the rank the pointer has passed the centre
 * of, and the line drawn between the two children it would land between.
 */
function updateReorderDrag(g: Gesture, world: { x: number; y: number }): void {
  const ctx = g.reorder!;
  const to = dropRank(ctx.rects, ctx.from, ctx.axis, ctx.axis === "x" ? world.x : world.y);
  if (g.drop?.to !== to) g.drop = { to, line: dropLine(ctx, to) };
  const item = scene.items[g.index];
  statusEl.textContent =
    to === ctx.from
      ? `${widgetTitle(item)} · layout order ${ctx.from + 1} of ${ctx.children.length} · drag to another slot`
      : `${widgetTitle(item)} · layout order ${ctx.from + 1} -> ${to + 1} of ${ctx.children.length}`;
  requestDraw();
}

/** The drop indicator: a line in the gap the widget would land in. */
function dropLine(ctx: ReorderContext, to: number): Guide {
  const axis = ctx.axis;
  const rects = ctx.rects;
  const lo = (r: SceneRect) => (axis === "x" ? r.x : r.y);
  const hi = (r: SceneRect) => (axis === "x" ? r.x + r.w : r.y + r.h);
  const others = rects.filter((_, i) => i !== ctx.from);
  const at =
    to <= 0
      ? lo(others[0]) - 2
      : to >= others.length
        ? hi(others[others.length - 1]) + 2
        : (hi(others[to - 1]) + lo(others[to])) / 2;
  // Across the whole container, so the line reads as a slot and not as an edge.
  let start = Infinity;
  let end = -Infinity;
  for (const r of rects) {
    start = Math.min(start, axis === "x" ? r.y : r.x);
    end = Math.max(end, axis === "x" ? r.y + r.h : r.x + r.w);
  }
  return { axis, at, start, end };
}

/** The live geometry readout: where the widget is now, and what release would write. */
function gestureReadout(g: Gesture): string {
  const item = scene.items[g.index];
  const rect = g.write?.rect ?? g.rect;
  const writes =
    g.write && g.write.properties.length > 0
      ? g.write.properties.map((p) => `${p.key} = ${p.value}`).join("  ")
      : "no change yet";
  return `${widgetTitle(item)} · ${geometry(rect)} · ${writes}`;
}

/** Release: one op, or an honest reason there is none. */
function endGesture(g: Gesture): void {
  gesture = null;
  if (g.status === "reorder" && g.engaged && g.reorder && g.drop && g.drop.to !== g.reorder.from) {
    commitReorder(g.reorder, g.drop.to);
    return;
  }
  if (!g.engaged || g.status !== "allowed" || g.line === null || !g.write) {
    statusEl.textContent = statusLine();
    // A gesture that previewed and then wrote nothing leaves the inspector
    // saying what the file still says, not what the abandoned preview showed.
    if (g.write) renderInspector();
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

/**
 * A reorder commit: ONE op, one document change, one undo step, exactly like a
 * property write. There is no local preview to hold onto because the file, not
 * the canvas, decides where the children end up; the fresh layout is the answer.
 */
function commitReorder(ctx: ReorderContext, to: number): void {
  statusEl.textContent = statusLine();
  draw();
  sendReorder("reorder", ctx, to, (verdict) => {
    if (verdict.refused) toast(verdict.refused, "refused");
    else if (verdict.warning) toast(verdict.warning, "warned");
  });
}

// ---- dragging a layers row -------------------------------------------------

/**
 * A row drag in the layers panel. It carries no geometry: the drop is the row
 * the pointer is OVER, and whether the widget lands before or after it follows
 * from the direction of travel, which is the same answer either way (layers.ts
 * explains why both are the same index).
 */
interface RowDrag {
  ctx: ReorderContext;
  index: number;
  screen: { x: number; y: number };
  engaged: boolean;
  /** The rank the pointer is over, or null while it is over nothing droppable. */
  to: number | null;
  status: "pending" | "allowed" | "blocked";
  reason: string | null;
}

let rowDrag: RowDrag | null = null;

function onLayerPointerDown(ev: PointerEvent, row: LayerRow, reorderable: boolean): void {
  if (ev.button !== 0) return;
  select(row.index, { reveal: false });
  if (!reorderable || row.synthetic || committing) return;
  const ctx = reorderContextFor(row.index);
  if (!ctx) return;
  rowDrag = {
    ctx,
    index: row.index,
    screen: { x: ev.clientX, y: ev.clientY },
    engaged: false,
    to: null,
    status: "pending",
    reason: null,
  };
}

function onLayerPointerMove(ev: PointerEvent, row: LayerRow): void {
  const drag = rowDrag;
  if (!drag) return;
  if (!drag.engaged) {
    if (Math.hypot(ev.clientX - drag.screen.x, ev.clientY - drag.screen.y) < DRAG_THRESHOLD) return;
    drag.engaged = true;
    // Same discipline as a canvas drag: the guards answer before the row moves.
    probeReorder(drag.ctx, drag);
    layerEls.get(drag.index)?.classList.add("dragging");
    announceGesture(drag);
  }
  if (drag.status === "blocked" || row.synthetic) return;
  drag.to = row.source;
  markDropRow(drag);
}

/** The drop line, as a border on the row the widget would land at. */
function markDropRow(drag: RowDrag): void {
  for (const node of layerEls.values()) node.classList.remove("dropBefore", "dropAfter");
  if (drag.to === null || drag.to === drag.ctx.from) return;
  const target = layerEls.get(drag.ctx.children[drag.to]);
  target?.classList.add(drag.to < drag.ctx.from ? "dropBefore" : "dropAfter");
}

function endRowDrag(): void {
  const drag = rowDrag;
  rowDrag = null;
  if (!drag) return;
  layerEls.get(drag.index)?.classList.remove("dragging");
  for (const node of layerEls.values()) node.classList.remove("dropBefore", "dropAfter");
  if (!drag.engaged || drag.status === "blocked" || drag.to === null || drag.to === drag.ctx.from) return;
  commitReorder(drag.ctx, drag.to);
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
  const stack = hitStack(scene, world.x, world.y, skipMask);
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
  const previewed = gesture.write !== null;
  gesture = null;
  statusEl.textContent = statusLine();
  if (previewed) renderInspector();
  draw();
});
// A row drag has no pointer capture to end it: the panel scrolls and the drop
// can land anywhere, so the window is what closes the gesture.
window.addEventListener("pointerup", endRowDrag);
window.addEventListener("pointercancel", endRowDrag);
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
  if (ev.key === "f" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    // Focus the selection, or leave the focus when there is nothing new to
    // focus on: one key, both directions.
    if (selected !== null && selected !== focusIndex) setFocus(selected);
    else if (focusIndex !== null) setFocus(null);
    return;
  }
  if (ev.key !== "Escape") return;
  if (gesture) {
    // Escape abandons the drag in progress before it touches the selection:
    // the widget snaps back to where the file still has it.
    const previewed = gesture.write !== null;
    gesture = null;
    hideToast();
    statusEl.textContent = statusLine();
    if (previewed) renderInspector();
    draw();
    return;
  }
  if (rowDrag) {
    rowDrag.status = "blocked";
    endRowDrag();
    return;
  }
  // Selection first, focus second: Escape gives back the last thing that was
  // narrowed, and a focused user still selects and clears inside their subtree.
  if (selected !== null) select(null, { reveal: false });
  else if (focusIndex !== null) setFocus(null);
});

// ---- toolbar ---------------------------------------------------------------

document.getElementById("zoomIn")!.addEventListener("click", () => {
  zoomToPoint(stage.clientWidth / 2, stage.clientHeight / 2, zoom * 1.25);
});
document.getElementById("zoomOut")!.addEventListener("click", () => {
  zoomToPoint(stage.clientWidth / 2, stage.clientHeight / 2, zoom / 1.25);
});
document.getElementById("zoomFit")!.addEventListener("click", () => {
  // Fit means "fit what is on screen", and under a subtree focus that is the
  // subtree, not the 1920x1080 reference viewport around it.
  if (focusIndex === null) fitAndCenter();
  else fitRect(hitRect(scene.items[focusIndex]));
});
document.getElementById("refresh")!.addEventListener("click", () => host.send({ type: "requestLayout" }));
outlinesEl.addEventListener("change", draw);
snapToggle.addEventListener("change", draw);
gridToggle.addEventListener("change", draw);
window.addEventListener("resize", draw);

renderFocusBar();
renderLayers();
renderInspector();
host.send({ type: "ready" });
