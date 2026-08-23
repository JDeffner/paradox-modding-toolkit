/**
 * The GUI editor app: the thin DOM shell around the pure modules (scene,
 * hit-test, selection, tree, layers, snap, inspector) and the canvas painter.
 * It owns the camera, the panels and the DOM, and nothing else, layout, text
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
 *
 * G5 stage 1 is editing parity: a multi-selection, a palette, a clipboard,
 * delete/duplicate, align/distribute, an anchor picker and wrap. It keeps the
 * three rules by keeping the BATCH honest: a gesture over several widgets is
 * one `applyOps` message, one server request, one document change and one undo
 * step, and each member's own verdict comes back with it, so a refused member
 * is named in the server's own words while the rest go through.
 *
 * G5 stage 2 is the DEVTOOLS HALO and the browsers, and it adds a fourth rule
 * that only applies to them: A CLOSED PANEL COSTS NOTHING. Every surface below
 * is behind a toggle, and while the toggle is off no request is sent, no scene
 * is walked and no overlay is drawn, which is why the placement trace is a
 * flag on `requestWidgetInfo` rather than a second request, why the heatmap is
 * a mode the painter tests once, and why the halo's own requests are debounced
 * on selection change and never fire inside a drag frame.
 */
import type {
  GuiDependenciesResult,
  GuiLayoutResult,
  GuiPreview,
  GuiSourceOp,
  GuiTextSegment,
  GuiVisibilityCheck,
  GuiVisibilityMode,
  GuiVocabularyEntry,
  GuiWidgetInfo,
} from "@px-lsp/protocol/protocol";
import { GUI_PREVIEW_MAX } from "@px-lsp/protocol/protocol";
import {
  ANCHOR_X,
  ANCHOR_Y,
  anchorCell,
  anchorSpec,
  type AnchorX,
  type AnchorY,
} from "@px-lsp/server/gui/anchorSpec";
import type {
  AppToHost,
  EditProperty,
  GuiEditorUiState,
  GuiLocMode,
  GuiPanelStates,
  GuiValueMode,
  SavedComponent,
  SavedPreset,
  TextureEntry,
} from "../messages";
import { connectHost } from "./host";
import { iconEl, type IconName } from "../../shared/icons";
import { sidePanel } from "../../shared/sidePanel";
import {
  closePopover,
  confirmDialog,
  menu,
  popover,
  toast as pxToast,
  type MenuItem,
} from "../../shared/overlay";
import { scrubbable } from "../../shared/scrub";
import { colorPicker, type Rgb } from "../../shared/colorPicker";
import {
  buildScene,
  childIndices,
  parentIndex,
  setLineHeightRatio,
  subtreeEnd,
  type Scene,
  type SceneItem,
  type SceneRect,
} from "./scene";
import {
  drawScene,
  drawThumbnail,
  resetImageCache,
  type DrawMasks,
  type DrawPulse,
  type Images,
  WORLD_H,
  WORLD_W,
} from "./render";
import { hitRect, hitStack, marqueeHits, nextInStack } from "./hitTest";
import { indexOfSelection, outermost, selectionAt, toggleSelected, type Selection } from "./selection";
import { ancestorKeys, rowKey, treeRows } from "./tree";
import {
  abbreviate,
  blockEntries,
  composeBlock,
  inspectorRows,
  nextValueMode,
  propertyChoices,
  widgetTitle,
  type BlockEntry,
  type InspectorRow,
} from "./inspector";
import { boxAxis, dropRank, layerRows, reorderTo, type LayerRow } from "./layers";
import { alignDeltas, distributeDeltas, type AlignMode } from "./align";
import { containerRows, paletteLabel } from "./palette";
import {
  chunk,
  LIBRARY_PAGE,
  LIBRARY_SECTIONS,
  libraryEntries,
  libraryTiles,
  libraryTip,
  previewEntryFor,
  type LibraryEntry,
  type LibrarySection,
} from "./library";
import { browserGroups, usingValue, vocabularyDetail } from "./browse";
import { buildHeatmap, diffScenes, HEATMAP_MODES, pulseNote, statsLine, type HeatmapMode } from "./devtools";
import { constraintOverlay, num, overrideRows, placementReport, type ConstraintOverlay } from "./placement";
import { textureFolder, textureName, texturePage, textureSummary, textureValue, thumbGrid } from "./textures";
import { GRID_STEP, MOVE_EDGES, snapRect, type Guide, type SnapConfig, type SnapResult } from "./snap";
import { NudgeBurst, nudgeVector } from "./nudge";
import { firstChildOf, firstRoot, isTypingTarget, siblingFrom } from "./keys";
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
const statusEl = document.getElementById("status") as HTMLSpanElement;
const statsEl = document.getElementById("stats") as HTMLSpanElement;
const visibilityBadgeEl = document.getElementById("visibilityBadge") as HTMLSpanElement;
const metaEl = document.getElementById("meta") as HTMLSpanElement;
const infoEl = document.getElementById("info") as HTMLButtonElement;
const fileNameEl = document.getElementById("fileName") as HTMLSpanElement;
const zoomLabel = document.getElementById("zoomLabel") as HTMLSpanElement;
const outlinesEl = document.getElementById("outlines") as HTMLInputElement;
const snapToggle = document.getElementById("snap") as HTMLInputElement;
const gridToggle = document.getElementById("grid") as HTMLInputElement;
const constraintsToggle = document.getElementById("constraints") as HTMLInputElement;
const pulsesToggle = document.getElementById("pulses") as HTMLInputElement;
const heatmapSelect = document.getElementById("heatmap") as HTMLSelectElement;
const heatmapMenuEl = document.getElementById("heatmapMenu") as HTMLButtonElement;
const libraryEl = document.getElementById("library") as HTMLDivElement;
const libraryToggleEl = document.getElementById("libraryToggle") as HTMLButtonElement;
const haloEl = document.getElementById("halo") as HTMLDivElement;
const haloTabsEl = document.getElementById("haloTabs") as HTMLDivElement;
const haloBodyEl = document.getElementById("haloBody") as HTMLDivElement;
const haloToggleEl = document.getElementById("haloToggle") as HTMLButtonElement;
const dropTargetEl = document.getElementById("dropTarget") as HTMLDivElement;
const locResolvedEl = document.getElementById("locResolved") as HTMLButtonElement;
const locRawEl = document.getElementById("locRaw") as HTMLButtonElement;
const textTipEl = document.getElementById("textTip") as HTMLDivElement;
/** The game font is embedded by the host when it could read it. */
const fontFamily = document.body.dataset.font === "game" ? "PxGuiGameFont, Georgia, serif" : "Georgia, serif";

let scene: Scene = { items: [], count: 0, declaredRoots: 0 };
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
/**
 * The OTHER members of a multi-selection, primary excluded (that is `selected`).
 * Kept as draw indices for this scene plus identities for the next one, exactly
 * like the primary: an edit re-lays the document out and a draw index means
 * nothing afterwards.
 */
let others: number[] = [];
let otherIds: Selection[] = [];
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

/**
 * The three canvas devtools, all null while their toggle is off, which is what
 * makes them free: the painter tests one field each and the scene is never
 * walked for a mode nobody asked for.
 */
let heat: ReturnType<typeof buildHeatmap> = null;
let constraints: ConstraintOverlay | null = null;
let pulse: DrawPulse | null = null;
let pulseTimer: ReturnType<typeof setTimeout> | undefined;

/** The stats line's four numbers, and the flag that arms the paint measurement. */
let measurePaint = false;
let lastSceneMs = 0;
let lastPaintMs = 0;
let lastTimings = { parseMs: 0, defsMs: 0, layoutMs: 0, totalMs: 0 };
/** The scene the last push replaced: what a pulse diffs against. */
let previousScene: Scene | null = null;

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
  // Only the repaint that FOLLOWS a layout is timed: two clock reads per frame
  // would be two clock reads inside a drag frame, and the stats line is a
  // per-push readout anyway (devtools.ts).
  const t0 = measurePaint ? performance.now() : 0;
  paintScene();
  if (!measurePaint) return;
  measurePaint = false;
  lastPaintMs = performance.now() - t0;
  statsEl.textContent = statsLine({
    timings: lastTimings,
    sceneMs: lastSceneMs,
    paintMs: lastPaintMs,
    widgets: scene.count,
  });
  syncInfo();
}

/** The store line and the stats live behind the info button at the stage's edge, not in a bar. */
function syncInfo(): void {
  infoEl.dataset.tip = [metaEl.textContent, statsEl.textContent].filter((t) => t).join("\n");
  if (metaEl.hasAttribute("data-warning")) infoEl.setAttribute("data-warning", "");
  else infoEl.removeAttribute("data-warning");
}

function paintScene(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  canvas.width = w;
  canvas.height = h;
  const item = selectedItem();
  const live = livePreview();
  const rect = live?.write.rect ?? (item ? hitRect(item) : undefined);
  const shift = live?.write.offset;
  // A multi-selection's grips sit on the bounds of the whole set, and the
  // bounds follow the preview: they are the rect the grips were dragged from.
  const bounds =
    others.length > 0 && rect ? unionRect([rect, ...others.map((i) => otherRect(i, shift))]) : undefined;
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
      // While a marquee runs its catch is what is marked, so the user sees the
      // selection they are about to get without the panels rebuilding for it.
      // Otherwise the other members, moved by the same delta as the primary, so
      // their marks follow the preview instead of sitting where the file still
      // has them (a resize is single-member and never gets here with others).
      others: marquee
        ? marquee.hits.map((i) => hitRect(scene.items[i]))
        : others.map((i) => otherRect(i, shift)),
      handles: canEdit(item) || (bounds !== undefined && allSelected().some((i) => canEdit(scene.items[i]))),
      handleRect: bounds,
      accent: accentColor(),
      marquee: marquee?.rect,
      preview: live
        ? {
            slices: live.slices,
            dx: live.write.offset.dx,
            dy: live.write.offset.dy,
            duplicate: live.duplicate,
          }
        : undefined,
      masks,
      grid: gridToggle.checked ? GRID_STEP : 0,
      guides: gesture?.snap?.guides,
      bars: gesture?.snap?.bars,
      flash: flashIndex === null ? undefined : hitRect(scene.items[flashIndex]),
      // The same affordance for both kinds of drop: a reorder's new slot, and
      // the slot a palette entry would be inserted into.
      dropLine: paletteDrag?.line ?? gesture?.drop?.line,
      readout: live && rect ? { x: rect.x, y: rect.y, text: geometry(rect) } : undefined,
      heatmap: heat?.values ?? null,
      constraints: constraintsToggle.checked ? (constraints ?? undefined) : undefined,
      pulse: pulse ?? undefined,
    }
  );
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  syncDropTarget();
}

function geometry(rect: SceneRect): string {
  return `${round(rect.x)}, ${round(rect.y)} · ${round(rect.w)} x ${round(rect.h)}`;
}

function shifted(rect: SceneRect, by: { dx: number; dy: number } | undefined): SceneRect {
  return by ? { ...rect, x: rect.x + by.dx, y: rect.y + by.dy } : rect;
}

/**
 * Where a non-primary member is marked: its own previewed write while a
 * gesture carries it (a resize changes its size, not just its place), else
 * its rect moved by the primary's offset, else where the file has it.
 */
function otherRect(index: number, shift: { dx: number; dy: number } | undefined): SceneRect {
  const g = gesture;
  if (g?.writes) {
    const at = g.members.findIndex((m) => m.index === index);
    if (at >= 0 && g.members[at].refused === null) return g.writes[at].rect;
  }
  return shifted(hitRect(scene.items[index]), shift);
}

function unionRect(rects: readonly SceneRect[]): SceneRect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The bounds of the whole selection, where a multi-selection's grips sit. */
function selectionBounds(): SceneRect | null {
  const members = allSelected();
  if (members.length < 2) return null;
  return unionRect(members.map((i) => hitRect(scene.items[i])));
}

/**
 * The theme's accent, read off the page so the guides follow the user's theme
 * rather than a colour the canvas chose. Empty when the page has no token
 * (a host page without px-ui), and the painter then uses its own.
 */
function accentColor(): string {
  return getComputedStyle(document.body).getPropertyValue("--px-primary").trim();
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

interface ButtonOptions {
  icon?: IconName;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "xs" | "icon" | "icon-sm" | "icon-xs";
  /** The tooltip. Every icon-only button has one; a labelled one may. */
  tip?: string;
  className?: string;
}

/** A px-btn. The label is the button's whole text, so a test can find it by label. */
function button(label: string, onClick: () => void, o: ButtonOptions = {}): HTMLButtonElement {
  const node = document.createElement("button");
  node.className = o.className ? `px-btn ${o.className}` : "px-btn";
  node.dataset.variant = o.variant ?? "ghost";
  if (o.size) node.dataset.size = o.size;
  if (o.icon) node.appendChild(iconEl(o.icon));
  if (label) node.appendChild(document.createTextNode(label));
  if (o.tip) {
    node.dataset.tip = o.tip;
    if (o.tip.length > 40) node.dataset.tipWrap = "";
  }
  node.addEventListener("click", onClick);
  return node;
}

/** A text field: px-input, small, with the keystrokes kept off the canvas. */
function textInput(placeholder: string, value: string, className = ""): HTMLInputElement {
  const input = document.createElement("input");
  input.className = className ? `px-input ${className}` : "px-input";
  input.dataset.size = "sm";
  input.placeholder = placeholder;
  input.value = value;
  input.spellcheck = false;
  input.addEventListener("keydown", (ev) => ev.stopPropagation());
  return input;
}

/**
 * A choice that reads as a field: a `<select>` holds the value (so the page's
 * host contract and the harness still see a select) and a px-dropdown button
 * opens its options as a `menu()`, because a native option list cannot be
 * styled and breaks in dark themes. Picking writes the select and fires its
 * `change`, so the owner listens to the select alone.
 */
function dropdownSelect(
  items: MenuItem[],
  value: string,
  o: { tip?: string; search?: boolean } = {}
): { wrap: HTMLElement; select: HTMLSelectElement } {
  const wrap = el("span", "dropdownWrap");
  const select = document.createElement("select");
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  }
  select.value = value;
  const label = el("span", "px-truncate");
  const trigger = button("", () => undefined, {
    variant: "outline",
    size: "sm",
    tip: o.tip,
    className: "px-dropdown",
  });
  trigger.appendChild(label);
  trigger.appendChild(iconEl("chevronDown"));
  const sync = (): void => {
    label.textContent = items.find((i) => i.value === select.value)?.label ?? select.value;
  };
  trigger.addEventListener("click", () =>
    menu(trigger, items, {
      value: select.value,
      search: o.search,
      onPick: (picked) => {
        if (picked === select.value) return;
        select.value = picked;
        sync();
        select.dispatchEvent(new Event("change", { bubbles: true }));
      },
    })
  );
  select.addEventListener("change", sync);
  sync();
  wrap.appendChild(select);
  wrap.appendChild(trigger);
  return { wrap, select };
}

/** A px-badge in its quiet outline form, for the row tags (declaration, synthetic, a count). */
function badge(text: string, title?: string): HTMLElement {
  const node = el("span", "px-badge tag", text);
  node.dataset.variant = "outline";
  if (title) node.title = title;
  return node;
}

/** A section header inside a panel. */
function sectionTitle(text: string): HTMLElement {
  return el("div", "section", text);
}

function renderTree(): void {
  const fragment = document.createDocumentFragment();
  rowEls.clear();
  for (const row of treeRows(scene, collapsed, focusIndex)) {
    const node = el("div", "px-item row");
    node.style.paddingLeft = `${4 + row.depth * 12}px`;
    const twisty = el("span", "twisty");
    if (row.hasChildren) {
      twisty.appendChild(iconEl("chevronRight"));
      if (!row.collapsed) twisty.dataset.open = "";
      twisty.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const key = rowKey(scene.items[row.index].path);
        if (collapsed.has(key)) collapsed.delete(key);
        else collapsed.add(key);
        renderTree();
      });
    }
    node.appendChild(twisty);
    node.appendChild(el("span", "rowKey", row.key));
    if (row.name) node.appendChild(el("span", "rowName", `#${row.name}`));
    if (row.declared) {
      node.appendChild(
        badge(
          "declaration",
          "This file declares this type and instantiates nothing, so the declaration is previewed as one instance of itself. Its children are this file's own statements and are editable."
        )
      );
    } else if (row.synthetic) {
      node.appendChild(
        badge("synthetic", "Spliced in from a template or a type: no source of its own in this file.")
      );
    }
    if (row.ghost) {
      node.appendChild(
        badge("ghost", "A datamodel placeholder: the list has no runtime rows in a static preview.")
      );
    }
    node.addEventListener("click", () => select(row.index, { reveal: false }));
    rowEls.set(row.index, node);
    fragment.appendChild(node);
  }
  treeEl.textContent = "";
  treeEl.appendChild(fragment);
  highlightTree(false);
}

/** The px-item selected state, which is also what the harness reads. */
function setSelected(node: HTMLElement, on: boolean): void {
  if (on) node.setAttribute("aria-selected", "true");
  else node.removeAttribute("aria-selected");
}

function highlightTree(scrollTo: boolean): void {
  const members = new Set(others);
  for (const [index, node] of rowEls) {
    const isPrimary = index === selected;
    setSelected(node, isPrimary || members.has(index));
    if (isPrimary && scrollTo) node.scrollIntoView({ block: "nearest" });
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
    const focus = button(
      "Focus subtree",
      () => {
        if (selected !== null) setFocus(selected);
      },
      { icon: "focus", size: "sm", tip: "Show only the selected widget and what is inside it (f)" }
    );
    focus.disabled = selected === null;
    focusBarEl.appendChild(focus);
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
  focusBarEl.appendChild(el("span", "px-grow"));
  focusBarEl.appendChild(
    button("Unfocus", () => setFocus(null), { size: "xs", tip: "Show the whole document again (f)" })
  );
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
  const title = el("div", "px-panel-title");
  title.appendChild(iconEl("layers"));
  title.appendChild(el("span", undefined, "Layers"));
  title.appendChild(
    el("span", "where px-truncate", container ? `In ${widgetTitle(container)}` : "Document root")
  );
  head.appendChild(title);
  head.appendChild(
    el(
      "div",
      "hint px-muted px-xs",
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
  const node = el("div", "px-item row");
  node.classList.toggle("hiddenWidget", hiddenPaths.has(key));
  const grip = el("span", "grip");
  if (reorderable && row.rank >= 0) grip.appendChild(iconEl("grip"));
  node.appendChild(grip);
  const label = el("span", "label", widgetTitle(row));
  node.appendChild(label);
  if (row.declared) {
    node.appendChild(
      badge(
        "declaration",
        "A type this file declares, previewed as one instance of itself: there is no slot to move."
      )
    );
  } else if (row.synthetic) {
    node.appendChild(
      badge("synthetic", "Spliced in from a template or a type: no source of its own to move.")
    );
  }
  node.appendChild(el("span", "px-grow"));
  const tools = el("span", "layerTools");
  tools.appendChild(
    toggle("eye", "eyeOff", hiddenPaths.has(key), "Hide this widget in the preview", () => {
      if (hiddenPaths.has(key)) hiddenPaths.delete(key);
      else hiddenPaths.add(key);
      afterToggle();
    })
  );
  tools.appendChild(
    toggle("unlock", "lock", lockedPaths.has(key), "Lock: the canvas stops picking this widget", () => {
      if (lockedPaths.has(key)) lockedPaths.delete(key);
      else lockedPaths.add(key);
      afterToggle();
    })
  );
  tools.appendChild(
    toggle("circle", "circleDot", soloPath === key, "Solo: dim everything that is not this widget", () => {
      soloPath = soloPath === key ? null : key;
      afterToggle();
    })
  );
  node.appendChild(tools);

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

/** One row tool: `on` when the state is set, `off` when it is not. */
function toggle(off: IconName, on: IconName, active: boolean, tip: string, run: () => void): HTMLElement {
  const node = button("", run, { icon: active ? on : off, size: "icon-xs", tip, className: "toggle" });
  node.setAttribute("aria-pressed", active ? "true" : "false");
  node.dataset.tipSide = "left";
  node.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  node.addEventListener("click", (ev) => ev.stopPropagation());
  return node;
}

function afterToggle(): void {
  rebuildMasks();
  renderLayers();
  draw();
}

function highlightLayers(): void {
  const members = new Set(others);
  for (const [index, node] of layerEls) {
    setSelected(node, index === selected || members.has(index));
  }
}

// ---- the element library ---------------------------------------------------

/**
 * What the library may offer, straight from the host (`requestVocabulary`): the
 * game's own harvested widget vocabulary plus this document's declarations.
 * Nothing here invents a name, so a dropped entry is always a widget the game
 * knows. Empty until the panel is first opened; asking costs a server request
 * and a closed library has nothing to show.
 */
let vocabulary: GuiVocabularyEntry[] = [];
let vocabularyAsked = false;
/**
 * The other half of the same answer: which PROPERTIES the harvest saw on the
 * types this document names, and the tree-wide ranking behind them. What the
 * inspector's add-property row completes from, and empty until the first
 * vocabulary lands, which is why that row offers nothing rather than guessing.
 */
let vocabularyProps: Record<string, string[]> = {};
let vocabularyCommon: string[] = [];
let libraryQuery = "";
let librarySection: LibrarySection = "all";

/** One tile on screen: what a drag marks and a preview paints into. */
interface Tile {
  node: HTMLElement;
  canvas: HTMLCanvasElement;
  entry: LibraryEntry;
  painted: boolean;
}
const tileEls = new Map<string, Tile>();
let tileObserver: IntersectionObserver | null = null;
/** The tile bitmap, in CSS pixels; the canvas is scaled by the device ratio. */
const TILE_W = 112;
const TILE_H = 72;

/**
 * Previews the host has answered for THIS document version, by tile key. A
 * layout push clears it: the document's own types and templates may have
 * changed, and a tile that showed the old one would be a lie.
 */
const previewCache = new Map<string, GuiPreview>();
/** Keys asked for and not yet answered, so a tile scrolled past twice asks once. */
const previewPending = new Set<string>();
/** The batches in flight, in order: the answer carries names, the batch carries keys. */
const previewRequests: { gen: number; entries: LibraryEntry[] }[] = [];
let libraryGen = 0;
/** Per texture path a preview paints: the image once loaded, null when it could not load. */
const libraryImages = new Map<string, HTMLImageElement | null>();

/**
 * The widget an insert should select once the document comes back: the
 * container's path plus the source index the op wrote at. A draw index would
 * mean nothing after the re-layout the insert itself causes.
 */
let pendingSelect: { parent: string; source: number } | null = null;

function libraryOpen(): boolean {
  return !libraryEl.hidden;
}

function toggleLibrary(): void {
  libraryEl.hidden = !libraryEl.hidden;
  libraryToggleEl.setAttribute("aria-pressed", libraryOpen() ? "true" : "false");
  if (libraryOpen()) {
    // The library lives in the left panel: showing it in a hidden panel would show nothing.
    if (sidePanels.left.collapsed) sidePanels.left.toggle(false);
    // The document's own templates and types change as it is edited, so the
    // list is re-asked for whenever the panel is showing (onLayout does the
    // same); a closed panel asks once and lives with what it got.
    askVocabulary();
    if (!userDataAsked) {
      userDataAsked = true;
      host.send({ type: "requestUserData" });
    }
    renderLibrary();
  }
}

function askVocabulary(): void {
  vocabularyAsked = true;
  host.send({ type: "requestVocabulary" });
}

function renderLibrary(): void {
  if (!libraryOpen()) return;
  libraryEl.textContent = "";
  tileObserver?.disconnect();
  tileObserver = null;
  tileEls.clear();

  const head = el("div", "head");
  const group = el("div", "px-input-group");
  group.appendChild(iconEl("search"));
  const search = textInput("Search the library", libraryQuery);
  search.addEventListener("input", () => {
    libraryQuery = search.value;
    renderLibrary();
    const again = libraryEl.querySelector("input");
    again?.focus();
    again?.setSelectionRange(again.value.length, again.value.length);
  });
  group.appendChild(search);
  head.appendChild(group);
  const tabs = el("div", "px-tabs");
  tabs.dataset.variant = "line";
  tabs.setAttribute("role", "tablist");
  for (const section of LIBRARY_SECTIONS) {
    const tab = el("button", "px-tab", section.label) as HTMLButtonElement;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", section.id === librarySection ? "true" : "false");
    tab.title = section.title;
    tab.addEventListener("click", () => {
      librarySection = section.id;
      renderLibrary();
    });
    tabs.appendChild(tab);
  }
  head.appendChild(tabs);
  libraryEl.appendChild(head);

  if (vocabulary.length === 0 && components.length === 0) {
    libraryEl.appendChild(el("div", "note", "No widget vocabulary for this game yet."));
    return;
  }
  const tiles = libraryTiles(libraryEntries(vocabulary, components), librarySection, libraryQuery);
  if (tiles.length === 0) {
    libraryEl.appendChild(
      el(
        "div",
        "note",
        libraryQuery
          ? `Nothing matches "${libraryQuery}".`
          : "Nothing saved yet. Select widgets and save them under Devtools › Saved."
      )
    );
    return;
  }
  const grid = el("div", "tileGrid");
  const more = el("div", "tileMore");
  const count = el("div", "note count", `${tiles.length} ${tiles.length === 1 ? "entry" : "entries"}`);
  // Previews only for the tiles on screen: each costs the server a layout,
  // and a whole listing would be a layout per widget the game knows.
  const observer = new IntersectionObserver((hits) => {
    const wanted: LibraryEntry[] = [];
    for (const hit of hits) {
      if (!hit.isIntersecting) continue;
      if (hit.target === more) appendPage();
      else {
        const tile = tileEls.get((hit.target as HTMLElement).dataset.key ?? "");
        if (tile && !tile.painted && !paintFromCache(tile)) wanted.push(tile.entry);
      }
    }
    askPreviews(wanted);
  });
  tileObserver = observer;
  let shown = 0;
  const appendPage = (): void => {
    const end = Math.min(tiles.length, shown + LIBRARY_PAGE);
    for (; shown < end; shown++) {
      const tile = libraryTile(tiles[shown]);
      grid.appendChild(tile.node);
      observer.observe(tile.node);
    }
    if (shown >= tiles.length) {
      observer.unobserve(more);
      more.remove();
    }
  };
  libraryEl.append(grid, more, count);
  appendPage();
  if (shown < tiles.length) observer.observe(more);
}

function libraryTile(entry: LibraryEntry): Tile {
  const node = el("div", "tile");
  node.dataset.key = entry.key;
  node.dataset.kind = entry.kind;
  node.title = libraryTip(entry);
  const canvas = document.createElement("canvas");
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = TILE_W * ratio;
  canvas.height = TILE_H * ratio;
  node.append(canvas, el("div", "name", entry.name), el("div", "src", entry.source));
  node.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || committing) return;
    const ghost = el("div", "px-drag-ghost paletteGhost", entry.name);
    document.body.appendChild(ghost);
    paletteDrag = { entry, ghost, target: null, rank: 0, line: null };
    moveGhost(ev.clientX, ev.clientY);
    node.setAttribute("data-dragging", "");
  });
  // A click is a press and a release on the SAME tile, which a drag that
  // reached the canvas never is; so a click inserts where the selection is.
  node.addEventListener("click", () => libraryInsert(entry));
  const tile: Tile = { node, canvas, entry, painted: false };
  tileEls.set(entry.key, tile);
  return tile;
}

/** Send the previews a page needs, in the batches the wire takes. */
function askPreviews(entries: LibraryEntry[]): void {
  const fresh = entries.filter((e) => !previewPending.has(e.key));
  for (const batch of chunk(fresh, GUI_PREVIEW_MAX)) {
    for (const e of batch) previewPending.add(e.key);
    previewRequests.push({ gen: libraryGen, entries: batch });
    host.send({ type: "requestPreviews", entries: batch.map(previewEntryFor) });
  }
}

function onPreviews(previews: GuiPreview[], textures: Record<string, string | null>): void {
  const request = previewRequests.shift();
  if (!request) return;
  for (const entry of request.entries) previewPending.delete(entry.key);
  // An answer for a document version that has since changed: the cache was
  // cleared for a reason, and the tiles re-ask when they are next seen.
  if (request.gen !== libraryGen) return;
  previews.forEach((preview, i) => {
    const entry = request.entries[i] ?? request.entries.find((e) => e.name === preview.name);
    if (entry) previewCache.set(entry.key, preview);
  });
  for (const [texture, url] of Object.entries(textures)) {
    if (libraryImages.has(texture)) continue;
    if (!url) {
      libraryImages.set(texture, null);
      continue;
    }
    const img = new Image();
    img.onload = () => {
      libraryImages.set(texture, img);
      paintTiles();
    };
    img.onerror = () => {
      libraryImages.set(texture, null);
      paintTiles();
    };
    img.src = url;
  }
  paintTiles();
}

function paintTiles(): void {
  for (const tile of tileEls.values()) if (!tile.painted) paintFromCache(tile);
}

/** Paint a tile from the cache. False when it has no preview yet, or its textures are still loading. */
function paintFromCache(tile: Tile): boolean {
  const preview = previewCache.get(tile.entry.key);
  if (!preview) return false;
  if (!preview.node) {
    tile.node.dataset.empty = "";
    tile.node.title = `${libraryTip(tile.entry)}\nNo preview: ${preview.reason ?? "nothing to lay out"}`;
    tile.painted = true;
    return true;
  }
  const images: Images = {};
  for (const texture of preview.textures) {
    const img = libraryImages.get(texture);
    if (img === undefined) return false;
    if (img) images[texture] = img;
  }
  const ctx = tile.canvas.getContext("2d");
  if (!ctx) return false;
  const ratio = tile.canvas.width / TILE_W;
  drawThumbnail(ctx, buildScene([preview.node]), images, { w: TILE_W, h: TILE_H }, fontFamily, ratio);
  tile.painted = true;
  return true;
}

/**
 * A click on a tile: a template is applied to the selection, anything else is
 * inserted next to the selection (or into the first root when nothing is
 * selected), through the same ops a drop sends.
 */
function libraryInsert(entry: LibraryEntry): void {
  if (entry.kind === "template") {
    const target = selectedItem();
    if (!canEdit(target)) {
      toast("Select a widget with a declaration in this file first.", "info");
      return;
    }
    guardedWrite(target.line, [{ key: "using", value: usingValue(entry.name) }]);
    return;
  }
  const at = insertTarget();
  if (!at) return;
  insertEntry(entry, at);
}

/** Where a click inserts: after the selection in its container, or into the first writable root. */
function insertTarget(): { line: number; index?: number } | null {
  const item = selectedItem();
  if (item && canEdit(item)) return pasteTarget();
  const root = childIndices(scene, null)
    .map((i) => scene.items[i])
    .find((i) => canEdit(i));
  if (!root) {
    toast("Select a widget first: an insert needs a container to go into.", "info");
    return null;
  }
  return { line: root.line };
}

/** ONE op for the entry, at the container on `line`: `insert` for a type, `insertRaw` for a saved component. */
function insertEntry(entry: LibraryEntry, at: { line: number; index?: number }): void {
  const container = scene.items.find((i) => i.line === at.line && canEdit(i));
  if (container) {
    pendingSelect = { parent: rowKey(container.path), source: at.index ?? Number.POSITIVE_INFINITY };
  }
  const report = (verdict: EditVerdict): void => {
    if (verdict.refused) {
      pendingSelect = null;
      toast(verdict.refused, "refused");
    } else if (verdict.warning) toast(verdict.warning, "warned");
    else if (entry.kind !== "saved") {
      toast(`${entry.name} inserted. It has no size yet, so it draws nothing until you give it one.`, "info");
    }
  };
  if (entry.kind === "saved") {
    awaitVerdict(
      (id) => ({ type: "insertComponent", id, name: entry.name, line: at.line, index: at.index }),
      report
    );
    return;
  }
  sendOps(
    "applyOps",
    [{ kind: "insert", line: at.line, widget: { type: entry.name }, index: at.index }],
    report
  );
}

/**
 * The editable rows by key, so a gesture can show its numbers in them while it
 * runs. Live values only: the file is unchanged until release, and a gesture
 * that ends without a commit rebuilds the panel from what the file still says.
 * A row the display mode is showing as text is in `inspectorTexts` instead, and
 * a preview updates whichever half the row happens to be.
 */
const inspectorInputs = new Map<string, HTMLInputElement>();
const inspectorTexts = new Map<string, HTMLElement>();

/**
 * How much of a value the rows show. The host stores it and it rides down on
 * the first layout; from then on this is the truth, so a layout still in flight
 * cannot undo a choice the user has just made.
 */
let valueMode: GuiValueMode = "full";
let uiAdopted = false;
/** The preview table the current layout was computed with, keyed `[expression]` as the file has it. */
let previewValues: Record<string, string> = {};

/**
 * The block-valued rows whose sub-editor is open, and the abbreviated rows the
 * user has clicked into. Both are keyed by PROPERTY NAME and both are dropped
 * when the selection moves to another widget: they are statements about the
 * rows on screen, and those rows are one widget's.
 */
const expandedBlocks = new Set<string>();
const editingRows = new Set<string>();

/**
 * The panel's scroll offset, and whether what is on screen is the property rows
 * it was measured against. A commit re-lays the document out, which rebuilds
 * these rows from scratch, and a panel that went back to the top every time a
 * value was written made a long widget unusable. The offset is only recorded
 * while the rows are up: the browser clamping a placeholder to 0 is not a user
 * scrolling to the top.
 */
let inspectorScroll = 0;
let showingRows = false;
/** Which widget the rows belong to, as a positional path. */
let inspectorFor: string | null = null;

inspectorEl.addEventListener("scroll", () => {
  if (showingRows) inspectorScroll = inspectorEl.scrollTop;
});

function previewInspector(write: GestureWrite): void {
  for (const property of write.properties) {
    const input = inspectorInputs.get(property.key);
    if (input) {
      input.value = property.value;
      // A preview is display state, not user intent: move the baseline with
      // it, or an abandoned gesture's rebuild would "restore" the preview as
      // if the user had typed it.
      input.dataset.baseline = property.value;
    }
    const text = inspectorTexts.get(property.key);
    if (text) text.textContent = abbreviate(property.value);
  }
}

/**
 * The row that had keyboard focus, so a rebuild can give it back. Without it,
 * committing a property with Enter drops the caret out of the panel and the
 * next keystroke goes to the canvas.
 */
interface FocusedRow {
  row: string;
  caret: number | null;
}

/**
 * A capture that has not been given back yet. A commit rebuilds the panel
 * TWICE, once for the re-layout and once for the property read that follows it,
 * and the first of those is the one that detaches the focused element: without
 * carrying the capture across, the caret would always be lost to the gap.
 */
let pendingFocus: FocusedRow | null = null;

/**
 * Text typed but not committed when a rebuild hit, keyed by data-row. A commit
 * of ONE field rebuilds every row, and without this the text sitting in a
 * sibling field (a half-filled add-property name, the second field of a block
 * entry) was silently thrown away. Held across placeholder renders exactly
 * like `pendingFocus`.
 */
let pendingTyped: Map<string, string> | null = null;

function capturedFocus(): FocusedRow | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !inspectorEl.contains(active) || active.dataset.row === undefined) return null;
  const caret = active instanceof HTMLInputElement ? active.selectionStart : null;
  return { row: active.dataset.row, caret };
}

/** Every input whose value differs from the baseline it was rendered with. */
function capturedTyped(): Map<string, string> | null {
  const dirty = new Map<string, string>();
  for (const node of Array.from(inspectorEl.querySelectorAll<HTMLInputElement>("input[data-row]"))) {
    const baseline = node.dataset.baseline ?? "";
    if (node.value !== baseline) dirty.set(node.dataset.row as string, node.value);
  }
  return dirty.size > 0 ? dirty : null;
}

function restoreTyped(typed: Map<string, string> | null): void {
  if (!typed) return;
  for (const node of Array.from(inspectorEl.querySelectorAll<HTMLInputElement>("input[data-row]"))) {
    const val = typed.get(node.dataset.row as string);
    if (val === undefined) continue;
    // The commit landed and the row now RENDERS the typed text: restoring
    // would only re-arm the change handler for a second, identical write.
    if ((node.dataset.baseline ?? "") === val) continue;
    node.value = val;
  }
}

function restoreFocus(saved: FocusedRow | null): void {
  if (!saved) return;
  // Only when nothing else has taken it: the panel gives focus back after
  // rebuilding its own rows, it never takes it from wherever the user went.
  const active = document.activeElement;
  if (active && active !== document.body && !inspectorEl.contains(active)) return;
  for (const node of Array.from(inspectorEl.querySelectorAll<HTMLElement>("[data-row]"))) {
    if (node.dataset.row !== saved.row) continue;
    node.focus();
    if (saved.caret !== null && node instanceof HTMLInputElement) {
      node.setSelectionRange(saved.caret, saved.caret);
    }
    return;
  }
}

function renderInspector(): void {
  const item = selectedItem();
  const forWidget = item ? rowKey(item.path) : null;
  const switched = forWidget !== inspectorFor;
  if (switched) {
    // Another widget's rows: the offset, the open sub-editors and any typed
    // text were statements about rows that are no longer here.
    inspectorFor = forWidget;
    inspectorScroll = 0;
    expandedBlocks.clear();
    editingRows.clear();
    pendingFocus = null;
    pendingTyped = null;
  }
  const focus = switched ? null : (capturedFocus() ?? pendingFocus);
  const typed = switched ? null : (capturedTyped() ?? pendingTyped);
  pendingFocus = null;
  pendingTyped = null;
  inspectorEl.textContent = "";
  inspectorInputs.clear();
  inspectorTexts.clear();
  showingRows = false;
  if (!item) {
    inspectorEl.appendChild(el("div", "note", "Nothing selected. Click a widget on the canvas."));
    return;
  }
  // Every early return below is a panel that is not showing the rows the
  // capture named, so the capture is held for the render that will be.
  pendingFocus = focus;
  pendingTyped = typed;
  const head = el("div", "head");
  const titleRow = el("div", "px-row");
  titleRow.appendChild(el("span", "title px-truncate", widgetTitle(item)));
  titleRow.appendChild(el("span", "px-grow"));
  titleRow.appendChild(valueModeButton());
  head.appendChild(titleRow);
  const r = item.rect;
  head.appendChild(el("div", "chain", `${round(r.x)}, ${round(r.y)} · ${round(r.w)} x ${round(r.h)}`));
  if (info && infoLine === item.line && info.typeChain.length > 0) {
    head.appendChild(el("div", "chain", `type chain: ${info.typeChain.join(" -> ")}`));
  }
  if (others.length > 0) {
    // Said plainly rather than shown as a merged property list: the rows below
    // are ONE widget's, and an inspector that implied otherwise would let a
    // user write a value onto widgets they cannot see.
    head.appendChild(
      el(
        "div",
        "chain",
        `${others.length + 1} selected. The rows below are the primary's alone; the buttons act on all of them.`
      )
    );
  }
  inspectorEl.appendChild(head);
  renderTools(item);

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
  } else {
    inspectorEl.appendChild(sectionTitle("Properties"));
  }
  for (const row of rows) {
    inspectorEl.appendChild(propRow(row, item.line));
  }
  renderAddProperty(item, rows);
  renderAnchors(item.line, rows);
  pendingFocus = null;
  pendingTyped = null;
  showingRows = true;
  inspectorEl.scrollTop = inspectorScroll;
  restoreTyped(typed);
  restoreFocus(focus);
}

/** One property row: its name, its value as the display mode shows it, and its block sub-editor. */
function propRow(row: InspectorRow, line: number): HTMLElement {
  const prop = el("div", "prop");
  const head = el("div", "line");
  const entries = blockEntries(row.value);
  const expanded = expandedBlocks.has(row.key);
  if (entries) {
    const twisty = el("span", "twisty");
    twisty.appendChild(iconEl("chevronRight"));
    if (expanded) twisty.dataset.open = "";
    twisty.title = "Edit this block one key at a time";
    twisty.addEventListener("click", () => {
      if (expanded) expandedBlocks.delete(row.key);
      else expandedBlocks.add(row.key);
      renderInspector();
    });
    head.appendChild(twisty);
  }
  head.appendChild(el("span", "key", row.key));
  const value = valueCell(row, line);
  if (value) head.appendChild(value);
  prop.appendChild(head);
  if (!row.local) prop.appendChild(el("div", "from", `from ${row.origin}`));
  if (entries && expanded) prop.appendChild(blockEditor(row, entries, line));
  if (row.key === "text") for (const extra of textRowExtras(row)) prop.appendChild(extra);
  return prop;
}

/**
 * The value half of a row, as the display mode has it: an editable input, an
 * ellipsized label that becomes one on click, or nothing at all.
 *
 * An abbreviated row is a LABEL rather than a short input value, because an
 * input holds what a commit would write: a row that displayed `Background_A…`
 * in an editable field would eventually write those bytes into the file.
 */
function valueCell(row: InspectorRow, line: number): HTMLElement | null {
  if (valueMode === "hidden") return null;
  const short = abbreviate(row.value);
  if (valueMode === "full" || short === row.value.trim() || editingRows.has(row.key)) {
    const input = rowInput(row, line);
    inspectorInputs.set(row.key, input);
    const color = parseColor(row.key, row.value);
    return color ? colorCell(input, color.rgb, color.alpha) : input;
  }
  const label = el("span", "val short px-sm", short);
  label.title = `${row.value} (click to edit)`;
  label.addEventListener("click", () => {
    editingRows.add(row.key);
    renderInspector();
    inspectorInputs.get(row.key)?.focus();
  });
  inspectorTexts.set(row.key, label);
  return label;
}

/** The three-way cycle, in the header because it is a statement about all the rows. */
function valueModeButton(): HTMLElement {
  const node = button(`Values: ${valueMode}`, () => setValueMode(nextValueMode(valueMode)), {
    size: "xs",
    tip: "How much of each value to show: full, abbreviated (the whole value on hover), or names only. Remembered for next time.",
  });
  node.dataset.tipSide = "left";
  return node;
}

/**
 * The toolbar's Resolved / Raw pair. The host remembers the mode like the snap
 * and grid toggles, and unlike them it changes what the server measures, so the
 * layout is asked for again. `silent` is the first layout adopting the stored
 * mode: the layout that carried it was computed with it already.
 */
function setLocMode(mode: GuiLocMode, o: { silent?: boolean } = {}): void {
  locResolvedEl.setAttribute("aria-pressed", String(mode === "resolve"));
  locRawEl.setAttribute("aria-pressed", String(mode === "raw"));
  if (o.silent) return;
  host.send({ type: "setUiState", valueMode, loc: mode });
  host.send({ type: "requestLayout" });
}

// ---- what a textbox resolved to --------------------------------------------

/** The segments worth explaining: a plain literal has none and gets no tooltip. */
function explainedSegments(item: SceneItem | null): GuiTextSegment[] | null {
  const segments = item?.text?.segments?.filter((s) => s.kind !== "literal");
  return segments && segments.length > 0 ? segments : null;
}

/** The preview value in force for a datafunction, keyed as the host's file has it. */
function previewValueOf(segment: GuiTextSegment): string | undefined {
  return previewValues[`[${segment.source}]`] ?? previewValues[segment.source];
}

/** One tooltip row: kind badge, the key or [expression], and what it became. */
function segmentRow(segment: GuiTextSegment): HTMLElement {
  const row = el("div", "seg");
  const kind = el("span", "px-badge", segment.kind === "loc" ? "loc" : "datafn");
  kind.dataset.variant = "outline";
  row.appendChild(kind);
  row.appendChild(el("span", "src", segment.kind === "loc" ? segment.source : `[${segment.source}]`));
  if (segment.resolved) {
    row.appendChild(el("span", "arrow", "\u2192"));
    row.appendChild(el("span", "", segment.text));
  } else {
    row.appendChild(
      el("span", "note", segment.kind === "loc" ? "not localized" : "resolved by the game at runtime")
    );
  }
  return row;
}

let textTipFor: number | null = null;

/** The hover explanation for the textbox under the pointer, or nothing for anything else. */
function showTextTip(index: number | null, clientX: number, clientY: number): void {
  const item = index === null ? null : scene.items[index];
  const segments = explainedSegments(item);
  if (!segments) {
    textTipEl.hidden = true;
    textTipFor = null;
    return;
  }
  if (textTipFor !== index) {
    textTipEl.textContent = "";
    for (const segment of segments) textTipEl.appendChild(segmentRow(segment));
    textTipFor = index;
  }
  textTipEl.hidden = false;
  // Below and right of the pointer, kept inside the window; the stage owns the
  // pointer so the tooltip ignores it and never steals the hover.
  const box = textTipEl.getBoundingClientRect();
  const left = Math.max(0, Math.min(clientX + 12, window.innerWidth - box.width - 4));
  const top = clientY + 16 + box.height > window.innerHeight ? clientY - box.height - 8 : clientY + 16;
  textTipEl.style.left = `${left}px`;
  textTipEl.style.top = `${top}px`;
}

/**
 * Under the inspector's `text` row: what the canvas shows for it when that is
 * not the raw value, and a button per thing the preview could not resolve: a
 * loc key goes to the host's localization flow, a datafunction gets a preview
 * value typed here and kept by the host per mod.
 */
function textRowExtras(row: InspectorRow): HTMLElement[] {
  const text = selectedItem()?.text;
  if (!text || (text.raw === undefined && !text.segments)) return [];
  const out: HTMLElement[] = [];
  const raw = row.value.trim().replace(/^"|"$/g, "");
  if (text.text !== raw) out.push(el("div", "resolved", `shows: ${text.text}`));
  const tools = el("div", "textTools");
  for (const segment of text.segments ?? []) {
    if (segment.kind === "loc" && !segment.resolved) {
      tools.appendChild(
        button("Create localization", () => host.send({ type: "editLoc", key: segment.source }), {
          size: "xs",
          icon: "plus",
          tip: `${segment.source} is not in the mod's localization. Write its text now.`,
        })
      );
    } else if (segment.kind === "datafn") {
      const current = previewValueOf(segment);
      if (current !== undefined) {
        tools.appendChild(
          button(
            `Preview value: ${current}`,
            () => host.send({ type: "clearPreviewValue", expression: segment.source }),
            {
              size: "xs",
              icon: "x",
              tip: `[${segment.source}] shows this text in the preview. Click to drop it.`,
            }
          )
        );
      } else if (!segment.resolved) {
        const open = button("Set preview value\u2026", () => previewValuePopover(open, segment.source), {
          size: "xs",
          tip: `[${segment.source}] is evaluated by the running game. Type what the preview should show for it.`,
        });
        tools.appendChild(open);
      }
    }
  }
  if (tools.childElementCount > 0) out.push(tools);
  return out;
}

/** A one-field popover: Enter sends the value, Escape (or a click outside) drops it. */
function previewValuePopover(anchor: HTMLElement, expression: string): void {
  const body = el("div", "px-stack");
  body.appendChild(el("div", "px-label", `Preview text for [${expression}]`));
  const input = textInput("What the game would show here", "");
  input.dataset.row = "+previewValue";
  input.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    const value = input.value.trim();
    if (value.length === 0) return;
    closePopover();
    host.send({ type: "setPreviewValue", expression, value });
  });
  body.appendChild(input);
  popover(anchor, body);
  input.focus();
}

function setValueMode(mode: GuiValueMode): void {
  valueMode = mode;
  editingRows.clear();
  // Applied here and now; the host is told so the NEXT panel starts this way.
  host.send({ type: "setUiState", valueMode: mode });
  renderInspector();
}

/**
 * A block value, one row per inner key. Every change recomposes the WHOLE block
 * and commits it as one `setProperties` through the guarded path, because that
 * is what the property is: the engine reads `background = { … }` as one value,
 * and half a block is not a smaller edit, it is a different one.
 */
function blockEditor(row: InspectorRow, entries: readonly BlockEntry[], line: number): HTMLElement {
  const wrap = el("div", "block");
  const commit = (next: BlockEntry[]): void => {
    const value = composeBlock(next);
    if (value === row.value.trim()) return;
    writeProperty(line, row.key, value);
  };
  entries.forEach((entry, index) => {
    const sub = el("div", "line");
    sub.appendChild(
      blockInput(`${row.key}.${index}.key`, entry.key, "key", (text) => {
        const next = entries.map((e, i) => (i === index ? { ...e, key: text } : e));
        commit(next);
      })
    );
    sub.appendChild(
      blockInput(`${row.key}.${index}.value`, entry.value, "val", (text) => {
        const next = entries.map((e, i) => (i === index ? { ...e, value: text } : e));
        commit(next);
      })
    );
    const remove = button("", () => commit(entries.filter((_, i) => i !== index)), {
      icon: "x",
      size: "icon-xs",
      tip: `Remove ${entry.key} from ${row.key}`,
      className: "toggle",
    });
    remove.dataset.tipSide = "left";
    sub.appendChild(remove);
    wrap.appendChild(sub);
  });

  const add = el("div", "line");
  const key = blockInput(`${row.key}.new.key`, "", "key", () => undefined);
  const value = blockInput(`${row.key}.new.value`, "", "val", () => undefined);
  key.placeholder = "key";
  value.placeholder = "value";
  const go = button(
    "Add key",
    () => {
      if (key.value.trim().length === 0 || value.value.trim().length === 0) {
        toast(`A ${row.key} entry needs both a key and a value.`, "info");
        return;
      }
      commit([...entries, { key: key.value.trim(), value: value.value.trim() }]);
    },
    { variant: "outline", size: "xs", tip: `Add a key to ${row.key}` }
  );
  add.appendChild(key);
  add.appendChild(value);
  add.appendChild(go);
  wrap.appendChild(add);
  return wrap;
}

/** One field of a block row. `change` fires on blur and on Enter, like the property rows. */
function blockInput(
  rowId: string,
  value: string,
  className: string,
  onCommit: (text: string) => void
): HTMLInputElement {
  const input = textInput("", value, className === "key" ? "val key" : "val");
  input.dataset.row = rowId;
  input.dataset.baseline = value;
  input.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    input.blur();
  });
  input.addEventListener("change", () => {
    const text = input.value.trim();
    if (text.length === 0 || text === value.trim()) {
      input.value = value;
      return;
    }
    onCommit(text);
  });
  return input;
}

/**
 * The add-property row. Its completion comes from `paradox/guiVocabulary`: the
 * property names the vanilla harvest saw on this widget's own type chain, then
 * the tree-wide ranking. Nothing here is a list typed into the editor, which is
 * the same rule the palette's widget names follow.
 *
 * A value vocabulary is offered where the engine has one: the anchors, whose
 * words come from the layout engine's own `anchorSpec` table, so the row cannot
 * write a word the engine does not parse.
 */
function renderAddProperty(item: SceneItem, rows: readonly InspectorRow[]): void {
  if (item.line === undefined) return;
  const line = item.line;
  const taken = new Set(rows.map((row) => row.key.toLowerCase()));
  const chain = [item.key, ...(info?.typeChain ?? [])];

  inspectorEl.appendChild(sectionTitle("Add a property"));
  const wrap = el("div", "addProp");
  const fields = el("div", "line");
  const name = textInput("property", "", "val key");
  name.dataset.row = "+name";
  const suggestions = el("div", "suggest px-list");
  let value: ValueControl = valueControl(name.value);

  const commit = (): void => {
    const key = name.value.trim().toLowerCase();
    if (key.length === 0) {
      toast("Name the property to add first.", "info");
      return;
    }
    if (taken.has(key)) {
      toast(`${key} is already on this widget: edit its row instead.`, "info");
      return;
    }
    const written = value.value.trim();
    if (written.length === 0) {
      toast(`${key} needs a value.`, "info");
      return;
    }
    writeProperty(line, key, written);
  };

  const syncValue = (): void => {
    const next = valueControl(name.value);
    if (next.kind === value.kind) return;
    fields.replaceChild(next.element, value.element);
    value = next;
  };
  const syncSuggestions = (): void => {
    suggestions.textContent = "";
    if (document.activeElement !== name) return;
    for (const choice of propertyChoices(chain, vocabularyProps, vocabularyCommon, taken, name.value)) {
      const node = el("div", "px-item row", choice);
      node.addEventListener("mousedown", (ev) => {
        // mousedown, not click: the input's blur would clear the list first.
        ev.preventDefault();
        name.value = choice;
        syncValue();
        suggestions.textContent = "";
        value.focus();
      });
      suggestions.appendChild(node);
    }
  };

  name.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      const first = suggestions.firstElementChild?.textContent;
      if (first && first !== name.value) {
        name.value = first;
        syncValue();
        suggestions.textContent = "";
        value.focus();
        return;
      }
      value.focus();
    } else if (ev.key === "Escape") {
      suggestions.textContent = "";
    }
  });
  name.addEventListener("input", () => {
    syncValue();
    syncSuggestions();
  });
  name.addEventListener("focus", syncSuggestions);
  name.addEventListener("blur", () => {
    suggestions.textContent = "";
  });

  const go = button("Add", commit, {
    variant: "outline",
    size: "sm",
    tip: "Write this property into the widget's own body, through the same guards every edit passes.",
  });
  go.dataset.tipSide = "left";
  fields.appendChild(name);
  fields.appendChild(value.element);
  fields.appendChild(go);
  wrap.appendChild(fields);
  wrap.appendChild(suggestions);
  inspectorEl.appendChild(wrap);
}

/** The nine anchor words the engine parses, from the layout engine's own table. */
const ANCHOR_SPECS = ANCHOR_Y.flatMap((y) => ANCHOR_X.map((x) => anchorSpec(x as AnchorX, y as AnchorY)));

/** The add-property row's value half: what to put in the row, and what it holds. */
interface ValueControl {
  kind: "choice" | "text";
  element: HTMLElement;
  readonly value: string;
  focus(): void;
}

/**
 * A menu where the engine's vocabulary for the property is known, a plain
 * field where it is not. Anchors are the known case: their words are the layout
 * engine's, so a picked one always parses.
 */
function valueControl(key: string): ValueControl {
  const lower = key.trim().toLowerCase();
  if (lower === "parentanchor" || lower === "widgetanchor") {
    const { wrap, select } = dropdownSelect(
      ANCHOR_SPECS.map((spec) => ({ value: spec, label: spec })),
      ANCHOR_SPECS[0]
    );
    select.dataset.row = "+value";
    return {
      kind: "choice",
      element: wrap,
      get value() {
        return select.value;
      },
      focus: () => (wrap.querySelector("button") as HTMLButtonElement | null)?.focus(),
    };
  }
  const input = textInput("value", "", "val");
  input.dataset.row = "+value";
  return {
    kind: "text",
    element: input,
    get value() {
      return input.value;
    },
    focus: () => input.focus(),
  };
}

/**
 * Write one property through the normal single-op path, guards first: the check
 * carries the same write, so it answers exactly what the commit would, and the
 * commit only goes out if it passed. Adding a property and rewriting a block
 * are both this: one `setProperties`, one document change, one undo step.
 */
function writeProperty(line: number, key: string, value: string): void {
  sendEdit("checkEdit", line, [{ key, value }], (verdict) => {
    if (verdict.refused) {
      toast(verdict.refused, "refused");
      return;
    }
    sendEdit("applyEdit", line, [{ key, value }], (answer) => {
      if (answer.refused) toast(answer.refused, "refused");
      else if (answer.warning) toast(answer.warning, "warned");
    });
  });
}

/**
 * The buttons that act on the SELECTION rather than on one property: align,
 * distribute and wrap. Each is one gesture, so each is one batch: one document
 * change and one undo step, with a per-member verdict for the ones the guards
 * turn down.
 */
function renderTools(item: SceneItem): void {
  const members = allSelected();
  const tools = el("div", "tools");
  const tool = (label: string, tip: string, enabled: boolean, run: () => void): void => {
    const node = button(label, run, { variant: "outline", size: "icon-sm", tip });
    node.disabled = !enabled;
    tools.appendChild(node);
  };

  if (members.length >= 2) {
    inspectorEl.appendChild(sectionTitle("Align the selection"));
    const aligns: [string, AlignMode, string][] = [
      ["⇤", "left", "Align left edges"],
      ["⇔", "hcenter", "Align horizontal centres"],
      ["⇥", "right", "Align right edges"],
      ["⇡", "top", "Align top edges"],
      ["⇕", "vcenter", "Align vertical centres"],
      ["⇣", "bottom", "Align bottom edges"],
    ];
    for (const [label, mode, title] of aligns) {
      tool(label, title, true, () => commitMoves(members, alignDeltas(members.map(rectOf), mode), title));
    }
    tool("↔", "Distribute horizontally: equal gaps left to right", members.length >= 3, () =>
      commitMoves(members, distributeDeltas(members.map(rectOf), "x"), "Distribute horizontally")
    );
    tool("↕", "Distribute vertically: equal gaps top to bottom", members.length >= 3, () =>
      commitMoves(members, distributeDeltas(members.map(rectOf), "y"), "Distribute vertically")
    );
    inspectorEl.appendChild(tools);
  }

  const wrapTools = el("div", "tools");
  const containers = containerRows(vocabulary);
  if (containers.length > 0 && canEdit(item)) {
    const { wrap, select } = dropdownSelect(
      containers.map((entry) => ({ value: entry.name, label: paletteLabel(entry) })),
      containers[0].name,
      { tip: "Wrap the selection in a fresh container", search: containers.length > 8 }
    );
    wrapTools.appendChild(el("span", "px-label", "Wrap in"));
    wrapTools.appendChild(wrap);
    wrapTools.appendChild(
      button("Wrap", () => commitWrap(members, select.value), { variant: "outline", size: "sm" })
    );
    inspectorEl.appendChild(wrapTools);
  } else if (canEdit(item)) {
    // The palette is where the vocabulary comes from, so say that rather than
    // showing a menu with nothing in it.
    inspectorEl.appendChild(el("div", "note", "Open the library to wrap this in a container."));
  }

  // A preset is saved FROM the inspector because the rows it saves are the ones
  // shown here: the widget's own, the ones it authored rather than inherited.
  const local = localProperties();
  if (local.length > 0) {
    inspectorEl.appendChild(sectionTitle("Preset"));
    const presetTools = el("div", "tools");
    const nameInput = textInput("Preset name", presetName);
    nameInput.dataset.row = "+preset";
    nameInput.addEventListener("input", () => {
      presetName = nameInput.value;
    });
    presetTools.appendChild(nameInput);
    const save = button(
      `Save ${local.length} as preset`,
      () => {
        const name = presetName.trim();
        if (name.length === 0) {
          toast("Give the preset a name first.", "info");
          return;
        }
        host.send({ type: "savePreset", name, properties: local });
        toast(`Saved ${local.length} propert${local.length === 1 ? "y" : "ies"} as "${name}".`, "info");
      },
      {
        variant: "outline",
        size: "sm",
        tip: `Store this widget's own ${local.length} properties under that name. Inherited rows are not saved: they are another file's bytes.`,
      }
    );
    save.dataset.tipSide = "left";
    presetTools.appendChild(save);
    inspectorEl.appendChild(presetTools);
  }
}

let presetName = "";

/** The selected widget's own authored rows: what a preset is worth saving from. */
function localProperties(): EditProperty[] {
  const item = selectedItem();
  if (!item || !info || infoLine !== item.line) return [];
  return inspectorRows(info)
    .filter((row) => row.local)
    .map((row) => ({ key: row.key, value: row.value }));
}

/**
 * A 9-point anchor picker for `parentanchor` and `widgetanchor`. The cells are
 * built from the LAYOUT ENGINE's own anchor table (`@px-lsp/server/gui/
 * anchorSpec`), so the picker cannot offer a word the engine does not parse and
 * quietly write a value the game ignores.
 */
function renderAnchors(line: number, rows: readonly InspectorRow[]): void {
  const valueOf = (key: string) => rows.find((r) => r.key === key)?.value;
  inspectorEl.appendChild(sectionTitle("Anchors"));
  const wrap = el("div", "anchors");
  for (const key of ["parentanchor", "widgetanchor"] as const) {
    const column = el("div");
    column.appendChild(el("div", "from", key));
    column.appendChild(anchorGrid(line, key, valueOf(key)));
    wrap.appendChild(column);
  }
  inspectorEl.appendChild(wrap);
}

function anchorGrid(line: number, key: string, current: string | undefined): HTMLElement {
  const grid = el("div", "anchorGrid");
  const at = anchorCell(current);
  for (const y of ANCHOR_Y) {
    for (const x of ANCHOR_X) {
      const spec = anchorSpec(x as AnchorX, y as AnchorY);
      const cell = el("div", "cell");
      cell.title = `${key} = ${spec}`;
      // An unwritten anchor is the engine's own default (top|left), so the grid
      // shows that corner lit rather than nothing.
      if (current !== undefined && x === at.x && y === at.y) cell.classList.add("on");
      cell.addEventListener("click", () => writeProperty(line, key, spec));
      grid.appendChild(cell);
    }
  }
  return grid;
}

/**
 * Move several widgets by their own deltas as ONE batch: one document change,
 * one undo step. Members the guards refuse are named in the server's own words
 * and stay exactly where they were; the others go through.
 */
function commitMoves(
  members: readonly number[],
  deltas: readonly { dx: number; dy: number }[],
  what: string
): void {
  const ops: GuiSourceOp[] = [];
  const skipped: string[] = [];
  members.forEach((index, i) => {
    const item = scene.items[index];
    const delta = deltas[i];
    if (!canEdit(item)) {
      skipped.push(`${widgetTitle(item)} ${NO_SOURCE_HERE}`);
      return;
    }
    if (delta.dx === 0 && delta.dy === 0) return;
    const base = baseOf(item);
    ops.push({
      kind: "setProperties",
      line: item.line,
      properties: [
        { key: "position", value: pairValue(base.position[0] + delta.dx, base.position[1] + delta.dy) },
      ],
    });
  });
  if (skipped.length > 0) toast([...new Set(skipped)].join(" "), "warned");
  if (ops.length === 0) {
    toast(`${what}: every widget is already where that would put it.`, "info");
    return;
  }
  sendOps("applyOps", ops, (verdict) => {
    if (verdict.refused) {
      toast(verdict.refused, "refused");
      return;
    }
    const refused = distinctRefusals(verdict);
    if (refused.length > 0) toast(refused.join(" "), "warned");
  });
}

/**
 * Wrap the selection in a fresh container. The server takes SIBLINGS, so a
 * selection spread over several bodies is refused by it, verbatim, rather than
 * being silently narrowed here.
 */
function commitWrap(members: readonly number[], type: string): void {
  const lines: number[] = [];
  for (const index of members) {
    const item = scene.items[index];
    if (!canEdit(item)) {
      toast(`${widgetTitle(item)} ${NO_SOURCE_HERE}`, "refused");
      return;
    }
    lines.push(item.line);
  }
  if (lines.length === 0) return;
  sendOps("applyOps", [{ kind: "wrap", lines, container: { type } }], (verdict) => {
    const refused = verdict.refused ?? distinctRefusals(verdict)[0];
    if (refused) toast(refused, "refused");
  });
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
  const input = textInput("", row.value, "val");
  // Named so a rebuild can put the caret back where the user left it: a commit
  // re-lays the document out and every row here is a new element. The baseline
  // is what dirty-detection compares against when a sibling's commit rebuilds.
  input.dataset.row = row.key;
  input.dataset.baseline = row.value;
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
    // Typing must not reach the canvas (textInput stops it): Escape here
    // reverts the row, it does not clear the selection the row belongs to.
    if (ev.key === "Enter") {
      ev.preventDefault();
      commit();
    } else if (ev.key === "Escape") {
      input.value = committed;
      input.blur();
    }
  });
  input.addEventListener("change", commit);
  // A plain number drags sideways like every other numeric field; the drag
  // ends in the same commit a typed value gets, so one drag is one undo step.
  if (/^-?\d+(\.\d+)?$/.test(row.value.trim())) {
    scrubbable(input, {
      step: row.value.includes(".") ? 0.01 : 1,
      onChange: () => undefined,
      onCommit: commit,
    });
  }
  return input;
}

/**
 * The value half of a color row: the input plus a swatch that opens the shared
 * color picker. A color is written the way the engine reads one, `{ r g b a }`
 * in 0..1, and the picker's close is the commit, so a drag through the square
 * is one write and one undo step.
 */
function colorCell(input: HTMLInputElement, rgb: Rgb, alpha: string | null): HTMLElement {
  const wrap = el("span", "valRow");
  const swatch = document.createElement("button");
  swatch.className = "px-swatch";
  swatch.dataset.tip = "Pick a color";
  swatch.dataset.tipSide = "left";
  swatch.style.setProperty("--px-swatch", `rgb(${rgb.join(" ")})`);
  swatch.addEventListener("click", () => {
    const start = input.value;
    colorPicker(swatch, rgb, {
      onChange: (next) => {
        rgb = next;
        swatch.style.setProperty("--px-swatch", `rgb(${next.join(" ")})`);
        input.value = `{ ${next.map((v) => round(v / 255)).join(" ")}${alpha === null ? "" : ` ${alpha}`} }`;
      },
      onClose: () => {
        if (input.value !== start) input.dispatchEvent(new Event("change"));
      },
    });
  });
  wrap.appendChild(input);
  wrap.appendChild(swatch);
  return wrap;
}

/** `{ r g b [a] }` in 0..1 on a `*color*` property, as the picker's 0..255 triple plus the alpha text. */
function parseColor(key: string, value: string): { rgb: Rgb; alpha: string | null } | null {
  if (!/color/i.test(key)) return null;
  const m = /^\{\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s+([\d.]+))?\s*\}$/.exec(value.trim());
  if (!m) return null;
  const channel = (v: string): number => Math.max(0, Math.min(255, Math.round(Number(v) * 255)));
  return { rgb: [channel(m[1]), channel(m[2]), channel(m[3])], alpha: m[4] ?? null };
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

/**
 * A refusal reason is the SERVER'S sentence and is shown verbatim: it says what
 * the engine would do with the write, which is knowledge this app does not have
 * and must not paraphrase into something friendlier and wrong. The surface is
 * the shared px-toast, so it reads like every other webview's.
 */
function toast(message: string, kind: "refused" | "warned" | "info"): void {
  pxToast(message, kind === "refused" ? "destructive" : "default", TOAST_MS);
}

/** Take every message down at once (an abandoned gesture's warning is moot). */
function hideToast(): void {
  for (const node of Array.from(document.querySelectorAll<HTMLElement>(".px-toast"))) node.remove();
}

// ---- edits -----------------------------------------------------------------

interface EditVerdict {
  refused?: string;
  warning?: string;
  /** A batch's per-op answers, in the order the ops were sent. */
  ops?: { refused?: string; warning?: string }[];
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

/** `to` is a RANK among the movable rows; the op's indices come out of `reorderTo`. */
function sendReorder(
  type: "checkReorder" | "reorder",
  ctx: ReorderContext,
  to: number,
  onVerdict: (verdict: EditVerdict) => void
): void {
  awaitVerdict(
    (id) => ({
      type,
      id,
      line: ctx.parentLine,
      from: ctx.sources[ctx.from],
      to: reorderTo(ctx.sources, ctx.from, to),
    }),
    onVerdict
  );
}

/**
 * A batch: several ops, one document change, one undo step. The verdict carries
 * one answer per op in the same order, so a refused member can be named.
 */
function sendOps(
  type: "checkOps" | "applyOps",
  ops: GuiSourceOp[],
  onVerdict: (verdict: EditVerdict) => void
): void {
  awaitVerdict((id) => ({ type, id, ops }), onVerdict);
}

function awaitVerdict(build: (id: number) => AppToHost, onVerdict: (verdict: EditVerdict) => void): void {
  const id = nextEditId++;
  pendingEdits.set(id, onVerdict);
  host.send(build(id));
}

// ---- selection -------------------------------------------------------------

/** Every selected widget, primary LAST: the order `toggleSelected` maintains. */
function allSelected(): number[] {
  return selected === null ? [...others] : [...others, selected];
}

/**
 * Replace the whole selection from a member list whose LAST entry is the
 * primary. Everything else in the app reads `selected` plus `others`, so this
 * is the one place the two are set together.
 */
function selectMany(members: readonly number[], options: { reveal: boolean; rebuildTree?: boolean }): void {
  const list = outermost(scene, members);
  others = list.slice(0, -1);
  otherIds = others.map((i) => selectionAt(scene, i)).filter((s): s is Selection => s !== null);
  select(list.length === 0 ? null : list[list.length - 1], { ...options, keepOthers: true });
}

function select(
  index: number | null,
  options: { reveal: boolean; rebuildTree?: boolean; keepOthers?: boolean }
): void {
  if (!options.keepOthers) {
    others = [];
    otherIds = [];
  }
  selected = index;
  selection = index === null ? null : selectionAt(scene, index);
  const item = selectedItem();
  if (!item || item.line === undefined || !item.editable) {
    info = null;
    infoLine = null;
  } else if (infoLine !== item.line) {
    info = null;
    infoLine = null;
    askWidgetInfo(item.line);
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
  // The overlay and the halo both read the selection; both are no-ops while
  // their toggles are off, and the halo's own requests are debounced so a click
  // through a tree does not fire one per row.
  constraints = null;
  if (haloOpen()) scheduleHaloRefresh();
  statusEl.textContent = statusLine();
  draw();
}

/**
 * The inspector's read, plus the "why is it here" trace when the panel that
 * shows it is open. One request either way: two answers echoing the same line
 * would race, and the plainer one landing last would silently drop the trace.
 */
function askWidgetInfo(line: number): void {
  host.send({ type: "requestWidgetInfo", line, placement: wantsPlacement() || undefined });
}

function statusLine(): string {
  const ghosts = scene.items.filter((i) => i.ghostBox).length;
  const estimated = ghosts > 0 ? ` · ${ghosts} unmeasurable (dashed)` : "";
  const item = selectedItem();
  const picked =
    others.length > 0
      ? ` · ${others.length + 1} selected, ${item ? widgetTitle(item) : "none"} is the primary`
      : item
        ? ` · selected ${widgetTitle(item)}${item.editable ? "" : item.declared ? " (declaration)" : " (synthetic)"}`
        : "";
  const focused = focusIndex === null ? "" : ` · focused on ${widgetTitle(scene.items[focusIndex])}`;
  const moved = pulseNoteText ? ` · ${pulseNoteText}` : "";
  // Why several panels are stacked at the origin: the file instantiates none of
  // them, so every type it declares is previewed as one instance of itself.
  const declared =
    scene.declaredRoots > 0
      ? ` · previewing ${scene.declaredRoots} declared type${scene.declaredRoots === 1 ? "" : "s"}`
      : "";
  return `${scene.count} widgets · ${file}${declared}${estimated}${focused}${picked}${moved}`;
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

function onLayout(
  result: GuiLayoutResult,
  textures: Record<string, string | null>,
  name: string,
  visibility: { mode: GuiVisibilityMode; checks?: Record<string, boolean> } | undefined,
  ui: GuiEditorUiState | undefined,
  storeWarning: string | undefined,
  preview: Record<string, string> | undefined
): void {
  // Adopted ONCE, from the first layout: after that the panel's own copy is the
  // truth, so a layout already in flight cannot undo a mode the user just set.
  if (!uiAdopted) {
    uiAdopted = true;
    if (ui) valueMode = ui.valueMode;
    if (ui?.panels) adoptPanels(ui.panels);
    if (ui?.snap !== undefined) snapToggle.checked = ui.snap;
    if (ui?.grid !== undefined) gridToggle.checked = ui.grid;
    if (ui?.loc) setLocMode(ui.loc, { silent: true });
  }
  previewValues = preview ?? {};
  file = name;
  fileNameEl.textContent = name;
  fileNameEl.title = name;
  defsFiles = result.defsFiles;
  previousScene = scene.items.length > 0 ? scene : null;
  const t0 = performance.now();
  scene = buildScene(result.nodes);
  lastSceneMs = performance.now() - t0;
  lastTimings = result.timings ?? lastTimings;
  // The host is where a visibility mode lives, so what it echoes is the truth
  // and the app keeps no copy that could disagree with the canvas.
  visibilityMode = visibility?.mode ?? "showAll";
  visibilityChecks = visibility?.checks ?? {};
  visibilityFound = result.visibilityChecks ?? [];
  renderVisibilityBadge();
  markPulse();
  // The truth arrived: draw indices, rects and source values are all new, so
  // any preview standing in for it goes, whether it was this editor's write or
  // a keystroke in the text editor.
  gesture = null;
  committing = null;
  rowDrag = null;
  paletteDrag = null;
  marquee = null;
  flashIndex = null;
  layersBuilt = false;
  // The warning is the host's own words, shown verbatim: the app cannot know
  // how many files a complete store holds, only the host knows why it is short.
  metaEl.textContent = storeWarning
    ? `${defsFiles} gui files in template store, ${storeWarning}`
    : `${defsFiles} gui files in template store`;
  if (storeWarning) metaEl.setAttribute("data-warning", "");
  else metaEl.removeAttribute("data-warning");
  syncInfo();
  seedCollapse();
  // Every path-keyed view (eye, lock, solo, focus) re-resolves against the new
  // draw indices before anything reads a mask.
  rebuildMasks();
  rebuildHeatmap();
  renderFocusBar();
  // The document changed under the selection: find every member again by its
  // own identity, and re-read the primary's properties, whose lines may have
  // moved. A member the edit removed simply stops being selected.
  const restored = selection ? indexOfSelection(scene, selection) : null;
  const restoredOthers = otherIds
    .map((id) => ({ id, index: indexOfSelection(scene, id) }))
    .filter((m): m is { id: Selection; index: number } => m.index !== null);
  others = restoredOthers.map((m) => m.index);
  otherIds = restoredOthers.map((m) => m.id);
  infoLine = null;
  info = null;
  loadTextures(textures);
  if (fitPending) {
    fitPending = false;
    fitAndCenter();
  }
  const inserted = takePendingSelect();
  // The next repaint is the one the stats line reports: it is the first full
  // paint of this scene, which is what "what did this push cost" means.
  measurePaint = true;
  select(inserted ?? restored, { reveal: false, rebuildTree: true, keepOthers: inserted === null });
  // An Alt+drag's second half: the copy just landed and is the selection.
  if (pendingMove) {
    if (inserted !== null) moveCopy();
    else pendingMove = null;
  }
  // A new document version: every tile preview was laid out against the old
  // one, so the cache goes and the tiles on screen re-ask.
  libraryGen++;
  previewCache.clear();
  previewPending.clear();
  previewRequests.length = 0;
  // The library lists this document's own templates and types, and an edit can
  // add one, so an open library re-asks. The first layout asks too even with
  // the library closed: the inspector's "wrap in" menu is built from the same
  // vocabulary and must not be empty until someone opens a panel.
  if (libraryOpen() || !vocabularyAsked) askVocabulary();
  // A document change can change what it depends on, so an open dependency
  // panel re-asks; every other halo surface is redrawn from what it has.
  if (haloOpen()) {
    if (haloTab === "uses") askDependencies();
    renderHalo();
  }
}

/**
 * The widgets this push moved, flashed. Off by default because the diff is a
 * Map of the whole previous scene and a document can hold 13,700 widgets: it is
 * cheap per push and it is not free, so it is a toggle like the grid.
 *
 * The fade runs on a timer rather than on animation frames: a repaint that
 * schedules the next repaint is a loop, and the canvas already has one of those
 * for gestures.
 */
const PULSE_STEPS = 6;
const PULSE_STEP_MS = 70;

function markPulse(): void {
  if (pulseTimer) clearTimeout(pulseTimer);
  pulseTimer = undefined;
  pulse = null;
  pulseNoteText = null;
  if (!pulsesToggle.checked) return;
  const diff = diffScenes(previousScene, scene);
  const note = pulseNote(diff);
  if (!note) return;
  pulse = { rects: diff.changed.map((i) => hitRect(scene.items[i])), alpha: 1 };
  pulseNoteText = note;
  fadePulse(PULSE_STEPS);
}

function fadePulse(step: number): void {
  pulseTimer = setTimeout(() => {
    pulseTimer = undefined;
    if (!pulse) return;
    if (step <= 1) {
      pulse = null;
      draw();
      return;
    }
    pulse = { rects: pulse.rects, alpha: (step - 1) / PULSE_STEPS };
    draw();
    fadePulse(step - 1);
  }, PULSE_STEP_MS);
}

/**
 * The widget an insert just wrote, found in the layout that insert caused: the
 * child of the recorded container whose source index is the one the op asked
 * for (or the last one, for an append). Null when nothing was pending or the
 * container is gone.
 */
function takePendingSelect(): number | null {
  const pending = pendingSelect;
  pendingSelect = null;
  if (!pending) return null;
  // "" names the document's root list (rowKey of an empty path), the container
  // a duplicated root widget's copy lands in.
  const container =
    pending.parent === "" ? null : scene.items.findIndex((item) => rowKey(item.path) === pending.parent);
  if (container !== null && container < 0) return null;
  const rows = layerRows(scene, container).filter((row) => row.source >= 0);
  const exact = rows.find((row) => row.source === pending.source);
  return exact?.index ?? rows[rows.length - 1]?.index ?? null;
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
      // Before the scene is built: the canvas measures its text boxes with the
      // same law the server laid the widgets out with.
      setLineHeightRatio(message.lineHeightRatio);
      onLayout(
        message.result,
        message.textures,
        message.file,
        message.visibility,
        message.ui,
        message.storeWarning,
        message.previewValues
      );
      return;
    case "widgetInfo": {
      const item = selectedItem();
      // Stale answer: the selection moved while the host was reading.
      if (!item || item.line !== message.line) return;
      info = message.info;
      infoLine = message.line;
      // The constraint overlay and the "why" panel are the same answer read two
      // ways, so both are refreshed from it and neither asks a second time.
      constraints = info ? constraintOverlay(info) : null;
      renderInspector();
      if (haloOpen()) renderHalo();
      draw();
      return;
    }
    case "editVerdict": {
      const handler = pendingEdits.get(message.id);
      pendingEdits.delete(message.id);
      handler?.({ refused: message.refused, warning: message.warning, ops: message.ops });
      return;
    }
    case "vocabulary":
      vocabulary = message.entries;
      vocabularyProps = message.properties ?? {};
      vocabularyCommon = message.commonProperties ?? [];
      renderLibrary();
      renderInspector();
      if (haloOpen() && haloTab === "types") renderHalo();
      return;
    case "dependencies": {
      // Echoed like widgetInfo: an answer for a line the selection has left is
      // an answer about a widget the panel is no longer showing.
      if (message.line !== dependenciesLine) return;
      dependencies = message.result;
      dependenciesPending = false;
      if (haloOpen() && haloTab === "uses") renderHalo();
      return;
    }
    case "textureList":
      textureEntries = message.entries;
      textureTotal = message.total;
      textureRootsKnown = message.roots;
      texturesPending = false;
      if (haloOpen() && haloTab === "art") renderHalo();
      return;
    case "thumbnails":
      Object.assign(thumbUrls, message.urls);
      if (haloOpen() && (haloTab === "art" || haloTab === "texture")) renderHalo();
      return;
    case "userData":
      components = message.components;
      presets = message.presets;
      if (haloOpen() && haloTab === "saved") renderHalo();
      renderLibrary();
      renderInspector();
      return;
    case "previews":
      onPreviews(message.previews, message.textures);
      return;
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
  /**
   * Every widget this drag moves, the pressed one FIRST. One entry for a plain
   * drag and for every resize; several when the press landed on a member of a
   * multi-selection, and then the commit is one batch.
   */
  members: GestureMember[];
  /** Per member, index-aligned with `members`; `writes[0]` is the pressed one's. */
  writes: GestureWrite[] | null;
  /** The other children of the same container: what the smart guides align to. */
  siblings: SceneRect[];
  /** The container's own box (the viewport for a root widget): its edges and centre snap too. */
  parent: SceneRect | null;
  /**
   * Alt+drag: the commit duplicates the pressed widget and moves the COPY,
   * leaving the original where the file has it. Single-widget only.
   */
  duplicate: boolean;
  /** What the last preview snapped to, for the guide lines. */
  snap: SnapResult | null;
  /** Set when the guards turned the move down but the container can be reordered. */
  reorder: ReorderContext | null;
  /** Where a reorder drag would drop, as the op's `to` index plus its drop line. */
  drop: { to: number; line: Guide } | null;
}

/**
 * One widget a drag carries. `line` is null for a widget with no declaration
 * here; `refused` is filled in from the gesture-start check, and a member that
 * carries one neither previews nor commits while the rest do.
 */
interface GestureMember {
  index: number;
  from: number;
  to: number;
  line: number | null;
  base: GestureBase;
  rect: SceneRect;
  refused: string | null;
}

function memberOf(index: number): GestureMember {
  const item = scene.items[index];
  return {
    index,
    from: index,
    to: subtreeEnd(scene, index),
    line: canEdit(item) ? item.line : null,
    base: baseOf(item),
    rect: hitRect(item),
    refused: canEdit(item) ? null : `${widgetTitle(item)} ${NO_SOURCE_HERE}`,
  };
}

/** The members a drag actually moves: the ones the guards did not turn down. */
function movingMembers(g: Gesture): GestureMember[] {
  return g.members.filter((m) => m.refused === null && m.line !== null);
}

/**
 * A container whose source children a drag can permute. `from` and the drop are
 * RANKS among the movable rows, which is what the panel and the pointer speak;
 * `sources` turns a rank into the op's index, which counts the container's
 * source children including the declarations the preview cannot see (layers.ts
 * `reorderTo`). A template- or type-supplied child has no bytes here, no source
 * index and no rank.
 */
interface ReorderContext {
  /** The container's own line: the op is addressed to the parent, not the child. */
  parentLine: number;
  /** Draw indices of the reorderable children, in source order. */
  children: number[];
  /** Their `srcIndex`, ascending: the op's own numbering. */
  sources: number[];
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
  const rows = layerRows(scene, parent).filter((row) => row.rank >= 0);
  if (rows.length < 2) return null;
  const from = rows.findIndex((row) => row.index === index);
  if (from < 0) return null;
  const children = rows.map((row) => row.index);
  const rects = children.map(rectOf);
  return {
    parentLine: container.line,
    children,
    sources: rows.map((row) => row.source),
    rects,
    from,
    axis: boxAxis(rects),
  };
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

/** The container's box: the parent's rect, or the reference viewport for a root widget. */
function parentRect(index: number): SceneRect {
  const parent = parentIndex(scene, index);
  return parent === null ? { x: 0, y: 0, w: WORLD_W, h: WORLD_H } : rectOf(parent);
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
/**
 * An Alt press, which is not yet a click or a drag: the release decides. A
 * click (no drag) steps the selection outward through the stack under the
 * cursor; a drag duplicates.
 */
let altPress: { next: number | null } | null = null;

/**
 * What the canvas paints instead of the file's own geometry: the subtrees that
 * move, and the pressed widget's own write (the rect the marquee draws and the
 * readout reports). Slices are ascending and disjoint, which is what lets the
 * painter walk them with the draw list in one pass.
 */
interface LivePreview {
  slices: { from: number; to: number }[];
  write: GestureWrite;
  /** An Alt+drag: the original stays put and the painter shows the copy moving. */
  duplicate?: boolean;
}

/** A released gesture whose write is in flight: its preview holds until the layout lands. */
let committing: LivePreview | null = null;

function livePreview(): LivePreview | null {
  if (committing) return committing;
  if (nudge.pending) return nudgePreview(nudge.dx, nudge.dy);
  if (gesture?.status !== "allowed" || !gesture.writes) return null;
  const slices = movingMembers(gesture)
    .map((m) => ({ from: m.from, to: m.to }))
    .sort((a, b) => a.from - b.from);
  return { slices, write: gesture.writes[0], duplicate: gesture.duplicate };
}

const NO_SOURCE_HERE =
  "comes from a template or a type, so it has no declaration in this file to move or resize.";

// ---- arrow-key nudges ------------------------------------------------------

/**
 * A held arrow key is ONE op: the burst folds every repeat into one delta and
 * commits it after a trailing quiet time (nudge.ts), never while a commit is
 * still in flight. The preview moves at once, key by key, off the same delta
 * the commit will write, so the canvas never shows a number the file will not
 * get. The members are resolved at commit time from the selection, so a
 * layout that lands mid-burst (the previous nudge's answer) re-bases the next
 * one on the fresh source values rather than on the ones the file has left.
 */
const nudge = new NudgeBurst({
  busy: () => committing !== null,
  onChange: () => {
    const item = selectedItem();
    if (item) {
      const write = moveWrite(baseOf(item), hitRect(item), nudge.dx, nudge.dy);
      const writes = write.properties.map((p) => `${p.key} = ${p.value}`).join("  ");
      statusEl.textContent = `${widgetTitle(item)} · ${geometry(write.rect)} · ${writes}`;
      previewInspector(write);
    }
    requestDraw();
  },
  commit: (dx, dy) => commitNudge(dx, dy),
});

/** The nudge's own preview: every editable member's subtree, moved by the pending delta. */
function nudgePreview(dx: number, dy: number): LivePreview | null {
  const members = allSelected().filter((i) => canEdit(scene.items[i]));
  const primary = selectedItem();
  if (members.length === 0 || !primary) return null;
  const slices = members.map((i) => ({ from: i, to: subtreeEnd(scene, i) })).sort((a, b) => a.from - b.from);
  return { slices, write: moveWrite(baseOf(primary), hitRect(primary), dx, dy) };
}

/**
 * The one op a burst becomes: `applyEdit` for a single widget (the same path
 * a one-widget drag takes), one `applyOps` batch of `setProperties` for a
 * multi-selection. The preview holds until the layout lands, as a drag's does.
 */
function commitNudge(dx: number, dy: number): void {
  const members = allSelected();
  const preview = nudgePreview(dx, dy);
  const skipped = members.filter((i) => !canEdit(scene.items[i]));
  if (skipped.length > 0) {
    const reasons = skipped.map((i) => `${widgetTitle(scene.items[i])} ${NO_SOURCE_HERE}`);
    toast([...new Set(reasons)].join(" "), "warned");
  }
  const moving = members.filter((i) => canEdit(scene.items[i]));
  if (moving.length === 0 || !preview) {
    statusEl.textContent = statusLine();
    draw();
    return;
  }
  committing = preview;
  const onVerdict = (verdict: EditVerdict): void => {
    if (verdict.refused) {
      committing = null;
      toast(verdict.refused, "refused");
      statusEl.textContent = statusLine();
      renderInspector();
      draw();
      return;
    }
    const refused = distinctRefusals(verdict);
    if (refused.length > 0) toast(refused.join(" "), "warned");
    else if (verdict.warning) toast(verdict.warning, "warned");
  };
  const positionOf = (index: number): EditProperty[] => {
    const base = baseOf(scene.items[index]);
    return [{ key: "position", value: pairValue(base.position[0] + dx, base.position[1] + dy) }];
  };
  if (moving.length === 1) {
    sendEdit("applyEdit", scene.items[moving[0]].line!, positionOf(moving[0]), onVerdict);
  } else {
    sendOps(
      "applyOps",
      moving.map((i) => ({
        kind: "setProperties" as const,
        line: scene.items[i].line!,
        properties: positionOf(i),
      })),
      onVerdict
    );
  }
  draw();
}

/**
 * Arm a gesture on the widget at `index` and ask the guards what the commit
 * would answer. The check carries each widget's CURRENT values, so it writes
 * nothing and its verdict is exactly the one the commit will get.
 *
 * A press on a member of a multi-selection arms the whole selection: one check
 * per member, in one `checkOps` batch, and a member the guards turn down keeps
 * its reason and stays where it is while the rest preview and move.
 */
function beginGesture(
  index: number,
  handle: ResizeHandle | null,
  world: { x: number; y: number },
  screen: { x: number; y: number },
  duplicate = false
): void {
  const item = scene.items[index];
  if (!item) return;
  // A press on any member drags the whole set, the pressed one included: the
  // pointerdown promoted it to primary, so membership is what to test, not
  // whether it is one of the others. A grip on a multi-selection's bounds
  // resizes every member by the same delta. An Alt+drag copies ONE widget.
  const group = !duplicate && others.length > 0 && allSelected().includes(index) ? allSelected() : [index];
  const members = [memberOf(index), ...group.filter((i) => i !== index).map(memberOf)];
  const first = members[0];
  const next: Gesture = {
    index,
    from: first.from,
    to: first.to,
    line: first.line,
    handle,
    origin: world,
    screen,
    base: first.base,
    rect: first.rect,
    status: first.refused === null ? "pending" : "blocked",
    reason: first.refused,
    warned: null,
    engaged: false,
    members,
    writes: null,
    siblings: siblingRects(index),
    parent: parentRect(index),
    duplicate,
    snap: null,
    reorder: null,
    drop: null,
  };
  gesture = next;
  if (next.line === null) return;

  const keys = gestureKeys(handle);
  const currentOf = (m: GestureMember) =>
    keys.map((key) => ({
      key,
      value:
        key === "position"
          ? pairValue(m.base.position[0], m.base.position[1])
          : pairValue(m.base.size[0], m.base.size[1]),
    }));

  if (members.length === 1) {
    sendEdit("checkEdit", next.line, currentOf(first), (verdict) => armGesture(next, verdict));
    return;
  }
  const asked = movingMembers(next);
  sendOps(
    "checkOps",
    asked.map((m) => ({ kind: "setProperties", line: m.line!, properties: currentOf(m) })),
    (verdict) => {
      if (gesture !== next) return;
      verdict.ops?.forEach((answer, i) => {
        if (answer.refused) asked[i].refused = answer.refused;
      });
      const moving = movingMembers(next);
      // The primary's own verdict decides what the gesture IS (a move, or the
      // reorder a box child's refusal turns it into); the others only decide
      // whether they come along.
      armGesture(next, {
        refused: first.refused ?? (moving.length === 0 ? verdict.refused : undefined),
        warning: verdict.warning,
      });
      if (next.status === "allowed") announceSkipped(next);
    }
  );
}

/** Turn a gesture-start verdict into what the drag may do. */
function armGesture(g: Gesture, verdict: EditVerdict): void {
  if (gesture !== g) return;
  if (verdict.refused) {
    g.reason = verdict.refused;
    // A move the container refuses is not a dead gesture when the container is
    // one that places its children itself: what a drag means there is a change
    // of LAYOUT ORDER, which is a reorder, and the refusal above is the
    // server's own explanation of why it is not a move.
    const reorder =
      g.handle === null && g.members.length === 1 && !g.duplicate ? reorderContextFor(g.index) : null;
    g.status = reorder ? "reorder" : "blocked";
    g.reorder = reorder;
    if (reorder) probeReorder(reorder, g);
  } else {
    g.status = "allowed";
    if (verdict.warning) g.warned = verdict.warning;
  }
  // The press may already have become a drag while the check was out.
  if (g.engaged) announceGesture(g);
}

/** The members that will not come along, in the server's own words. */
function announceSkipped(g: Gesture): void {
  const reasons = [...new Set(g.members.map((m) => m.refused).filter((r): r is string => r !== null))];
  if (reasons.length === 0) return;
  const staying = g.members.length - movingMembers(g).length;
  toast(`${staying} of ${g.members.length} will not move. ${reasons.join(" ")}`, "warned");
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
  let delta: [number, number] = [rawX, rawY];
  // The guides are the PRIMARY's: one drag has one delta, and snapping every
  // member to its own neighbours would tear the selection apart.
  const snap = snapRect(
    writeFor(g, g.members[0], rawX, rawY).rect,
    g.siblings,
    g.handle ? edgesOf(g.handle) : MOVE_EDGES,
    snapConfig(),
    { parent: g.parent }
  );
  if (snap.dx !== 0 || snap.dy !== 0) {
    // Rounded again, for the reason gesture.ts rounds at all: the preview, the
    // readout and the commit have to come out of one whole-pixel delta.
    delta = roundDelta(rawX + snap.dx, rawY + snap.dy);
  }
  g.snap = snap;
  g.writes = g.members.map((m) => writeFor(g, m, delta[0], delta[1]));
  statusEl.textContent = gestureReadout(g);
  // An Alt+drag can carry a widget that is not the selection; the inspector
  // shows the selection's rows and must not take the other widget's numbers.
  if (g.index === selected) previewInspector(g.writes[0]);
  requestDraw();
}

function writeFor(g: Gesture, m: GestureMember, dx: number, dy: number): GestureWrite {
  return g.handle ? resizeWrite(m.base, m.rect, g.handle, dx, dy) : moveWrite(m.base, m.rect, dx, dy);
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
  // The children the dragged one is landing among; named `rest` because
  // `others` is the multi-selection at this scope.
  const rest = rects.filter((_, i) => i !== ctx.from);
  const at =
    to <= 0
      ? lo(rest[0]) - 2
      : to >= rest.length
        ? hi(rest[rest.length - 1]) + 2
        : (hi(rest[to - 1]) + lo(rest[to])) / 2;
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
  const write = g.writes?.[0];
  const rect = write?.rect ?? g.rect;
  const writes =
    write && write.properties.length > 0
      ? write.properties.map((p) => `${p.key} = ${p.value}`).join("  ")
      : "no change yet";
  const moving = movingMembers(g).length;
  const group = moving > 1 ? ` · and ${moving - 1} more` : "";
  return `${widgetTitle(item)} · ${geometry(rect)} · ${writes}${group}`;
}

/** Release: one op (or one batch), or an honest reason there is none. */
function endGesture(g: Gesture): void {
  gesture = null;
  if (g.status === "reorder" && g.engaged && g.reorder && g.drop && g.drop.to !== g.reorder.from) {
    commitReorder(g.reorder, g.drop.to);
    return;
  }
  const preview = livePreviewOf(g);
  if (!g.engaged || g.status !== "allowed" || g.line === null || !g.writes) {
    statusEl.textContent = statusLine();
    // A gesture that previewed and then wrote nothing leaves the inspector
    // saying what the file still says, not what the abandoned preview showed.
    if (g.writes) renderInspector();
    draw();
    return;
  }
  const moving = movingMembers(g);
  const changed = moving.filter((m) => !g.writes![g.members.indexOf(m)].noop);
  if (changed.length === 0) {
    // Reported, never silently dropped: a drag that rounds to nothing looks
    // exactly like a drag the editor lost.
    toast("That is less than a whole pixel, so nothing was written.", "info");
    statusEl.textContent = statusLine();
    draw();
    return;
  }
  if (g.duplicate) {
    commitDuplicateMove(g, preview);
    return;
  }
  committing = preview;
  const onVerdict = (verdict: EditVerdict): void => {
    if (verdict.refused) {
      // Nothing was written, so the preview is a lie: drop it now rather than
      // waiting for a layout that is not coming.
      committing = null;
      toast(verdict.refused, "refused");
      statusEl.textContent = statusLine();
      draw();
      return;
    }
    const refused = distinctRefusals(verdict);
    if (refused.length > 0) toast(refused.join(" "), "warned");
    else if (verdict.warning && verdict.warning !== g.warned) toast(verdict.warning, "warned");
  };

  if (changed.length === 1 && g.members.length === 1) {
    sendEdit("applyEdit", g.line, g.writes[0].properties, onVerdict);
  } else {
    // One batch: several widgets, one document change, one undo step.
    sendOps(
      "applyOps",
      changed.map((m) => ({
        kind: "setProperties" as const,
        line: m.line!,
        properties: g.writes![g.members.indexOf(m)].properties,
      })),
      onVerdict
    );
  }
  draw();
}

/** The preview a released gesture holds until the layout for its write lands. */
function livePreviewOf(g: Gesture): LivePreview | null {
  if (!g.writes) return null;
  const slices = movingMembers(g)
    .map((m) => ({ from: m.from, to: m.to }))
    .sort((a, b) => a.from - b.from);
  return { slices, write: g.writes[0], duplicate: g.duplicate };
}

/**
 * An Alt+drag's release. The server's ops address lines the document HAS, so
 * the copy cannot be moved in the same batch that creates it: the duplicate
 * goes first, the copy (the original's next source slot) becomes the
 * selection when its layout lands, and the move is then written to it. Two
 * document changes, so two undo steps, which is what the duplicate-then-move
 * the protocol allows costs. The preview holds across both.
 */
let pendingMove: { dx: number; dy: number } | null = null;

function commitDuplicateMove(g: Gesture, preview: LivePreview | null): void {
  const item = scene.items[g.index];
  const parent = parentIndex(scene, g.index);
  const write = g.writes![0];
  if (!canEdit(item) || item.srcIndex === undefined) {
    toast(`${widgetTitle(item)} ${NO_SOURCE_HERE}`, "refused");
    draw();
    return;
  }
  committing = preview;
  pendingSelect = {
    parent: parent === null ? "" : rowKey(scene.items[parent].path),
    source: item.srcIndex + 1,
  };
  pendingMove = { dx: write.offset.dx, dy: write.offset.dy };
  sendOps("applyOps", [{ kind: "duplicate", line: item.line }], (verdict) => {
    const refused = verdict.refused ?? distinctRefusals(verdict)[0];
    if (!refused) return;
    committing = null;
    pendingSelect = null;
    pendingMove = null;
    toast(refused, "refused");
    draw();
  });
  draw();
}

/** The second half of an Alt+drag: the copy is selected, so move it. */
function moveCopy(): void {
  const move = pendingMove;
  pendingMove = null;
  const item = selectedItem();
  if (!move || !canEdit(item)) {
    committing = null;
    return;
  }
  const base = baseOf(item);
  const write = moveWrite(base, hitRect(item), move.dx, move.dy);
  committing = { slices: [{ from: selected!, to: subtreeEnd(scene, selected!) }], write };
  sendEdit("applyEdit", item.line, write.properties, (verdict) => {
    if (!verdict.refused) return;
    committing = null;
    toast(verdict.refused, "refused");
    draw();
  });
}

/** Per-member refusals, deduplicated and never paraphrased. */
function distinctRefusals(verdict: EditVerdict): string[] {
  return [...new Set((verdict.ops ?? []).map((o) => o.refused).filter((r): r is string => !!r))];
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
  if (!reorderable || row.rank < 0 || committing) return;
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
    layerEls.get(drag.index)?.setAttribute("data-dragging", "");
    announceGesture(drag);
  }
  if (drag.status === "blocked" || row.rank < 0) return;
  drag.to = row.rank;
  markDropRow(drag);
}

/**
 * The drop preview: the dragged row moves to where it would land and the rows
 * between slide out of its way (FLIP, the same look as sortable.ts), so the
 * list reads as the order a release would write. The rows go back to the
 * order the file has when the drag ends: the fresh layout is the answer.
 */
function markDropRow(drag: RowDrag): void {
  const moving = layerEls.get(drag.index);
  if (!moving || drag.to === null) return;
  const rows = drag.ctx.children.map((i) => layerEls.get(i)).filter((n): n is HTMLElement => !!n);
  const others = rows.filter((n) => n !== moving);
  const anchor = others[drag.to] ?? null;
  if ((anchor ? anchor.previousElementSibling : others[others.length - 1]) === moving) return;
  const before = new Map(rows.map((n) => [n, n.getBoundingClientRect().top]));
  if (anchor) layersEl.insertBefore(moving, anchor);
  else others[others.length - 1]?.after(moving);
  for (const [row, top] of before) {
    if (row === moving) continue;
    const delta = top - row.getBoundingClientRect().top;
    if (!delta) continue;
    row.style.transition = "none";
    row.style.transform = `translateY(${delta}px)`;
    requestAnimationFrame(() => {
      row.style.transition = "transform 140ms cubic-bezier(0.2, 0, 0, 1)";
      row.style.transform = "";
    });
  }
}

function endRowDrag(): void {
  const drag = rowDrag;
  rowDrag = null;
  if (!drag) return;
  layerEls.get(drag.index)?.removeAttribute("data-dragging");
  for (const node of layerEls.values()) {
    node.style.transition = "";
    node.style.transform = "";
  }
  if (!drag.engaged || drag.status === "blocked" || drag.to === null || drag.to === drag.ctx.from) {
    // Nothing was written, so the rows go back to the order the file still has.
    if (drag.engaged) renderLayers();
    return;
  }
  commitReorder(drag.ctx, drag.to);
}

// ---- the marquee -----------------------------------------------------------

/**
 * A rubber band on empty canvas. It catches the widgets ENTIRELY inside it
 * (hitTest.ts says why containment and not intersection), and the catch is
 * painted rather than selected until release: a marquee over a vanilla window
 * would otherwise rebuild the tree, the layers panel and the inspector on every
 * pointer move.
 */
interface Marquee {
  origin: { x: number; y: number };
  rect: SceneRect;
  /** Shift: the catch joins the selection instead of replacing it. */
  additive: boolean;
  /** What was selected when the band started, for the additive case. */
  base: number[];
  hits: number[];
}

let marquee: Marquee | null = null;

// ---- dropping a palette entry ----------------------------------------------

/**
 * A tile being dragged out of the library. It carries no geometry of its own:
 * what a drop means is decided by the container under the cursor, exactly as a
 * reorder drop is, and the widget itself is written by the server.
 */
interface PaletteDrag {
  entry: LibraryEntry;
  /** The chip that follows the cursor, named after the entry. */
  ghost: HTMLElement;
  /** The container the pointer is over, or null while it is over nothing writable. */
  target: DropTarget | null;
  /** The rank inside that container the drop would land at. */
  rank: number;
  /** The drop line, when the container has children to land between. */
  line: Guide | null;
}

/** A container a drop can write into, and the children a drop line reads. */
interface DropTarget {
  index: number;
  /** The container's own declaration line: what the `insert` op is addressed to. */
  line: number;
  children: number[];
  sources: number[];
  rects: SceneRect[];
  axis: "x" | "y";
}

let paletteDrag: PaletteDrag | null = null;

/**
 * The nearest container a drop can be written into: the widget under the
 * cursor, or the first ancestor of it with a declaration in this file. Null
 * when there is none, which is the honest answer over a template-spliced
 * subtree, the server would refuse that insert, and the drop affordance must
 * not promise it.
 */
function dropTargetAt(world: { x: number; y: number }): DropTarget | null {
  const hit = hitStack(scene, world.x, world.y, skipMask)[0];
  if (hit === undefined) return null;
  for (let i: number | null = hit; i !== null; i = parentIndex(scene, i)) {
    const container = scene.items[i];
    if (!canEdit(container)) continue;
    const rows = layerRows(scene, i).filter((row) => row.rank >= 0);
    const children = rows.map((row) => row.index);
    const rects = children.map(rectOf);
    return {
      index: i,
      line: container.line,
      children,
      sources: rows.map((row) => row.source),
      rects,
      axis: boxAxis(rects),
    };
  }
  return null;
}

/** The `index` an insert takes to land at `rank` among a container's children. */
function insertIndex(target: DropTarget, rank: number): number | undefined {
  // Source indices, not ranks: a declaration between two children holds a slot
  // the preview cannot see (layers.ts). Past the last child, the op appends.
  return rank >= target.sources.length ? undefined : target.sources[rank];
}

/** The chip sits just off the cursor, so the cursor still shows what is under it. */
function moveGhost(clientX: number, clientY: number): void {
  if (paletteDrag) paletteDrag.ghost.style.transform = `translate(${clientX + 12}px, ${clientY + 12}px)`;
}

/** Whether a window pointer event is over the canvas: the only place a drop can land. */
function overStage(ev: { clientX: number; clientY: number }): boolean {
  const rect = stage.getBoundingClientRect();
  return (
    ev.clientX >= rect.left && ev.clientX < rect.right && ev.clientY >= rect.top && ev.clientY < rect.bottom
  );
}

/** The pointer left the canvas mid-drag: nothing to drop into, and the overlay says so. */
function clearPaletteTarget(): void {
  const drag = paletteDrag;
  if (!drag) return;
  drag.target = null;
  drag.line = null;
  statusEl.textContent = `${drag.entry.name} · release over the canvas to insert it`;
  requestDraw();
}

/**
 * The "Drop here" outline over the container a drop would go into: a DOM
 * element over the canvas (the accent colour is the page's, which the canvas
 * cannot read), placed in screen space from the container's world rect, and
 * re-placed on every paint because the camera may have moved under it.
 */
function syncDropTarget(): void {
  const target = paletteDrag?.target;
  if (!target) {
    dropTargetEl.hidden = true;
    return;
  }
  const rect = rectOf(target.index);
  dropTargetEl.hidden = false;
  dropTargetEl.style.left = `${rect.x * zoom + panX}px`;
  dropTargetEl.style.top = `${rect.y * zoom + panY}px`;
  dropTargetEl.style.width = `${rect.w * zoom}px`;
  dropTargetEl.style.height = `${rect.h * zoom}px`;
}

function updatePaletteDrag(world: { x: number; y: number }): void {
  const drag = paletteDrag!;
  const target = dropTargetAt(world);
  drag.target = target;
  if (!target) {
    drag.line = null;
    statusEl.textContent = `${drag.entry.name} · no widget here can take a child`;
    requestDraw();
    return;
  }
  // The same drop reading a reorder uses: how many children the pointer has
  // passed the centre of. With fewer than two there is no gap to point at, so
  // the container is highlighted and the insert appends.
  drag.rank =
    target.rects.length >= 2
      ? dropRank(target.rects, -1, target.axis, target.axis === "x" ? world.x : world.y)
      : target.rects.length;
  drag.line = target.rects.length >= 2 ? dropLineIn(target, drag.rank) : null;
  const container = scene.items[target.index];
  if (drag.entry.kind === "template") {
    // A template is applied to the widget under the cursor, not inserted
    // between its children: there is no slot to point at.
    drag.line = null;
    statusEl.textContent = `${drag.entry.name} · using = on ${widgetTitle(container)}`;
  } else {
    statusEl.textContent = `${drag.entry.name} · into ${widgetTitle(container)} at ${drag.rank + 1} of ${target.rects.length + 1}`;
  }
  requestDraw();
}

/** The drop indicator for an INSERT: a line in the gap the new widget lands in. */
function dropLineIn(target: DropTarget, rank: number): Guide {
  const axis = target.axis;
  const lo = (r: SceneRect) => (axis === "x" ? r.x : r.y);
  const hi = (r: SceneRect) => (axis === "x" ? r.x + r.w : r.y + r.h);
  const rects = target.rects;
  const at =
    rank <= 0
      ? lo(rects[0]) - 2
      : rank >= rects.length
        ? hi(rects[rects.length - 1]) + 2
        : (hi(rects[rank - 1]) + lo(rects[rank])) / 2;
  let start = Infinity;
  let end = -Infinity;
  for (const r of rects) {
    start = Math.min(start, axis === "x" ? r.y : r.x);
    end = Math.max(end, axis === "x" ? r.y + r.h : r.x + r.w);
  }
  return { axis, at, start, end };
}

/**
 * Release: ONE op (`insert` for a type, `insertRaw` for a saved component, a
 * `using` write for a template), and the new widget becomes the selection. The
 * body is empty on purpose, a size this editor invented would be a number the
 * author never chose and the engine never measured, so the toast says the
 * widget draws nothing until it is given one.
 */
function endPaletteDrag(commit: boolean): void {
  const drag = paletteDrag;
  paletteDrag = null;
  for (const tile of tileEls.values()) tile.node.removeAttribute("data-dragging");
  if (!drag) return;
  drag.ghost.remove();
  dropTargetEl.hidden = true;
  const target = drag.target;
  if (!commit || !target) {
    statusEl.textContent = statusLine();
    draw();
    return;
  }
  if (drag.entry.kind === "template") {
    guardedWrite(target.line, [{ key: "using", value: usingValue(drag.entry.name) }]);
  } else {
    insertEntry(drag.entry, { line: target.line, index: insertIndex(target, drag.rank) });
  }
  statusEl.textContent = statusLine();
  draw();
}

// ---- delete, duplicate, copy and paste -------------------------------------

/**
 * The selection's declaration lines, in SOURCE order (ascending), with anything
 * that has no declaration here reported rather than silently dropped. Source
 * order is what makes a multi-copy read like the file it came from.
 */
function selectionLines(what: string): number[] | null {
  const members = allSelected();
  if (members.length === 0) return null;
  const lines: number[] = [];
  const skipped: string[] = [];
  for (const index of members) {
    const item = scene.items[index];
    if (canEdit(item)) lines.push(item.line);
    else skipped.push(`${widgetTitle(item)} ${NO_SOURCE_HERE}`);
  }
  if (skipped.length > 0) toast([...new Set(skipped)].join(" "), "warned");
  if (lines.length === 0) {
    toast(`Nothing in the selection can be ${what}.`, "refused");
    return null;
  }
  return lines.sort((a, b) => a - b);
}

/** Del: one batch, so several widgets are one document change and one undo step. */
function deleteSelection(): void {
  const lines = selectionLines("deleted");
  if (!lines) return;
  sendOps(
    "applyOps",
    lines.map((line) => ({ kind: "delete" as const, line })),
    reportBatch
  );
}

/** Ctrl+D: each widget's copy lands directly below it, all in one batch. */
function duplicateSelection(): void {
  const lines = selectionLines("duplicated");
  if (!lines) return;
  sendOps(
    "applyOps",
    lines.map((line) => ({ kind: "duplicate" as const, line })),
    reportBatch
  );
}

/**
 * Ctrl+C: the host puts the widgets' verbatim blocks on the system clipboard,
 * concatenated in source order. The app never handles the text: a clipboard is
 * the host's, and a paste has to survive being made in a different editor.
 */
function copySelection(): void {
  const lines = selectionLines("copied");
  if (!lines) return;
  awaitVerdict(
    (id) => ({ type: "copyBlocks", id, lines }),
    (verdict) => {
      if (verdict.refused) toast(verdict.refused, "refused");
      else if (verdict.warning) toast(verdict.warning, "warned");
      else toast(`${lines.length} widget(s) copied.`, "info");
    }
  );
}

/**
 * Ctrl+V: paste as the selected widget's next SIBLING, which is where a paste
 * after a copy belongs. With a root widget selected (nothing to be a sibling
 * inside) it appends into that widget instead, and with nothing selected there
 * is no container to name, so it says so.
 */
function pasteIntoSelection(): void {
  const target = pasteTarget();
  if (!target) return;
  awaitVerdict(
    (id) => ({ type: "pasteInto", id, line: target.line, index: target.index }),
    (verdict) => {
      if (verdict.refused) toast(verdict.refused, "refused");
      else if (verdict.warning) toast(verdict.warning, "warned");
    }
  );
}

/**
 * Where a paste (or a saved component) lands: as the selected widget's next
 * SIBLING, which is where a paste after a copy belongs. With a root widget
 * selected (nothing to be a sibling inside) it appends into that widget
 * instead, and with nothing selected there is no container to name, so it says
 * so.
 */
function pasteTarget(): { line: number; index?: number } | null {
  const item = selectedItem();
  if (!item || !canEdit(item)) {
    toast("Select a widget first: a paste needs a container to go into.", "info");
    return null;
  }
  const parent = parentIndex(scene, selected!);
  const container = parent === null ? null : scene.items[parent];
  if (container && canEdit(container) && item.srcIndex !== undefined) {
    return { line: container.line, index: item.srcIndex + 1 };
  }
  return { line: item.line };
}

/** A batch's answer: the whole gesture's refusal, or the members that skipped. */
function reportBatch(verdict: EditVerdict): void {
  if (verdict.refused) {
    toast(verdict.refused, "refused");
    return;
  }
  const refused = distinctRefusals(verdict);
  if (refused.length > 0) toast(refused.join(" "), "warned");
  else if (verdict.warning) toast(verdict.warning, "warned");
}

// ---- the devtools halo ------------------------------------------------------

/**
 * Seven surfaces behind one toggle and one tab strip, and every one of them
 * free while it is closed. That is not a nicety: the placement trace costs a
 * full server-side layout, the dependency walk reads script files, and the
 * texture browser walks a game's gfx tree, so a panel that asked for its data
 * whether or not anyone was looking would make selecting a widget expensive.
 *
 * The tabs are all READERS except the last three, and those three write through
 * exactly the same guarded paths the inspector and the palette use: a texture
 * pick is a `setProperties`, a template is `using = Name`, a preset is one
 * batched `setProperties`, and a component is an `insertRaw`. Nothing here has
 * a write path of its own.
 */
type HaloTab = "why" | "texture" | "visible" | "uses" | "types" | "art" | "saved";

const HALO_TABS: { tab: HaloTab; label: string; title: string }[] = [
  { tab: "why", label: "Why", title: "Why the selected widget's rect is where it is" },
  { tab: "texture", label: "Texture", title: "The sheets the selected widget draws, and the frame it shows" },
  { tab: "visible", label: "Visible", title: "How the preview treats conditional visibility" },
  { tab: "uses", label: "Uses", title: "The scripted_guis, events and loc keys this reaches" },
  { tab: "types", label: "Types", title: "The widget types and templates available here" },
  { tab: "art", label: "Art", title: "Browse the .dds files under the mod's and the game's gfx trees" },
  { tab: "saved", label: "Saved", title: "Your saved components and property presets" },
];

let haloTab: HaloTab = "why";

/** The dependency answer, and the line it was asked for (echo check, like widgetInfo). */
let dependencies: GuiDependenciesResult | null = null;
let dependenciesLine: number | undefined = undefined;
let dependenciesPending = false;
/** The Uses tab's scope switch: the selection's subtree, or the whole file. */
let dependenciesWholeFile = false;

/** The texture browser's last answer, and the thumbnails the host has served. */
let textureEntries: TextureEntry[] = [];
let textureTotal = 0;
let textureRootsKnown = true;
let textureQuery = "";
let texturesPending = false;
let texturesAsked = false;
const thumbUrls: Record<string, string | null> = {};

/** The saved user data, which lives on the host: this is a copy for drawing. */
let components: SavedComponent[] = [];
let presets: SavedPreset[] = [];
let userDataAsked = false;

/** The type/template browser's filter and its picked row. */
let browserQuery = "";
let browserPick: string | null = null;

/** The conditional-visibility mode the CANVAS was laid out with (the host's). */
let visibilityMode: GuiVisibilityMode = "showAll";
let visibilityChecks: Record<string, boolean> = {};
let visibilityFound: GuiVisibilityCheck[] = [];

/** The pulse note the status line carries until the next layout push. */
let pulseNoteText: string | null = null;

function haloOpen(): boolean {
  return !haloEl.hidden;
}

/**
 * The "why" trace is the one halo read that costs a server-side layout, so it
 * is asked for only by the two surfaces that draw it: the panel that reads it as
 * prose, and the overlay that reads it as geometry. They share the ONE request,
 * because they are the same answer read two ways.
 */
function wantsPlacement(): boolean {
  return constraintsToggle.checked || (haloOpen() && haloTab === "why");
}

function toggleHalo(): void {
  haloEl.hidden = !haloEl.hidden;
  haloToggleEl.setAttribute("aria-pressed", haloOpen() ? "true" : "false");
  if (!haloOpen()) return;
  if (sidePanels.right.collapsed) sidePanels.right.toggle(false);
  renderHaloTabs();
  askForTab();
  renderHalo();
}

function setHaloTab(tab: HaloTab): void {
  if (haloTab === tab) return;
  const wanted = wantsPlacement();
  haloTab = tab;
  renderHaloTabs();
  // The placement flag rides on the widget-info request, so a tab change that
  // turns it on or off has to re-ask. A tab change that does neither does not.
  if (wanted !== wantsPlacement()) reReadWidgetInfo();
  askForTab();
  renderHalo();
}

/** Ask for whatever the newly shown tab needs and does not already have. */
function askForTab(): void {
  if (haloTab === "uses") askDependencies();
  if (haloTab === "types" && !vocabularyAsked) askVocabulary();
  if (haloTab === "art" && !texturesAsked) askTextures();
  if (haloTab === "saved" && !userDataAsked) {
    userDataAsked = true;
    host.send({ type: "requestUserData" });
  }
}

/** Re-read the selected widget's properties, with the placement flag as it is now. */
function reReadWidgetInfo(): void {
  const item = selectedItem();
  if (!item || item.line === undefined || !item.editable) return;
  info = null;
  infoLine = null;
  askWidgetInfo(item.line);
}

/**
 * A selection change moves through the halo on a debounce. Clicking down a tree
 * or dragging a marquee moves the selection many times in a few hundred
 * milliseconds, and each of those would otherwise be a server-side layout (the
 * placement trace) or a script walk (the dependency panel).
 */
const HALO_DEBOUNCE_MS = 150;
let haloTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleHaloRefresh(): void {
  if (haloTimer) clearTimeout(haloTimer);
  haloTimer = setTimeout(() => {
    haloTimer = undefined;
    if (!haloOpen()) return;
    askForTab();
    renderHalo();
  }, HALO_DEBOUNCE_MS);
}

function askDependencies(): void {
  const item = selectedItem();
  const line = dependenciesWholeFile || !canEdit(item) ? undefined : item.line;
  if (dependenciesPending && line === dependenciesLine) return;
  dependenciesLine = line;
  dependencies = null;
  dependenciesPending = true;
  host.send({ type: "requestDependencies", line });
}

function askTextures(): void {
  texturesAsked = true;
  texturesPending = true;
  host.send({ type: "requestTextureList", query: textureQuery });
}

function renderHaloTabs(): void {
  haloTabsEl.textContent = "";
  for (const entry of HALO_TABS) {
    const node = el("button", "px-tab", entry.label) as HTMLButtonElement;
    node.setAttribute("role", "tab");
    node.setAttribute("aria-selected", entry.tab === haloTab ? "true" : "false");
    // A native title: the line tab's underline is its ::after, which a data-tip would take over.
    node.title = entry.title;
    node.addEventListener("click", () => setHaloTab(entry.tab));
    haloTabsEl.appendChild(node);
  }
}

function renderHalo(): void {
  if (!haloOpen()) return;
  haloBodyEl.textContent = "";
  switch (haloTab) {
    case "why":
      renderWhy();
      return;
    case "texture":
      renderTextureTab();
      return;
    case "visible":
      renderVisible();
      return;
    case "uses":
      renderUses();
      return;
    case "types":
      renderTypes();
      return;
    case "art":
      renderArt();
      return;
    case "saved":
      renderSaved();
      return;
  }
}

/** The selected widget's info, but only when it is the answer for THIS selection. */
function selectedInfo(): GuiWidgetInfo | null {
  const item = selectedItem();
  return item && info && infoLine === item.line ? info : null;
}

function note(text: string): void {
  haloBodyEl.appendChild(el("div", "note", text));
}

// ---- tab: why is it here ----------------------------------------------------

/**
 * The anchor sum, term by term, with each term's own dx/dy in a column so the
 * addition can be checked by eye, and the notes a sum cannot carry: the
 * container that assigned the slot instead, the position it dropped doing so,
 * the clip that cuts the result, and every property that overrides another.
 */
function renderWhy(): void {
  const item = selectedItem();
  if (!item) {
    note("Nothing selected. Click a widget on the canvas.");
    return;
  }
  const widgetInfo = selectedInfo();
  if (!widgetInfo) {
    note(
      canEdit(item)
        ? "Reading the placement trace…"
        : "This widget is spliced in from a template or a type, so this file has no declaration to trace."
    );
    return;
  }
  const report = placementReport(widgetInfo);
  if (!report) {
    note("The layout did not reach this widget, so it has no rect to explain.");
    return;
  }

  const head = el("div", "head");
  head.appendChild(el("div", "title", widgetTitle(item)));
  head.appendChild(
    el(
      "div",
      "chain",
      `${num(report.rect.x)}, ${num(report.rect.y)} · ${num(report.rect.w)} x ${num(report.rect.h)}`
    )
  );
  haloBodyEl.appendChild(head);

  if (report.rows.length > 0) {
    haloBodyEl.appendChild(sectionTitle("Where the origin comes from"));
    const terms = el("div", "terms");
    report.rows.forEach((row, i) => {
      const line = el("div", i === report.rows.length - 1 ? "term sum" : "term");
      line.appendChild(el("span", "what", row.label));
      line.appendChild(el("span", "n", `${num(row.dx)}, ${num(row.dy)}`));
      terms.appendChild(line);
    });
    haloBodyEl.appendChild(terms);
  }
  for (const line of report.notes) haloBodyEl.appendChild(el("div", "prose", line));

  const overrides = overrideRows(widgetInfo.properties);
  if (overrides.length === 0) return;
  haloBodyEl.appendChild(sectionTitle("What overrides what"));
  for (const row of overrides) {
    const prose = el("div", "prose");
    prose.appendChild(el("span", undefined, `${row.key} = ${row.value}`));
    prose.appendChild(el("span", "chain", ` overrides ${row.was} from ${row.from}`));
    haloBodyEl.appendChild(prose);
  }
}

// ---- tab: the texture inspector ---------------------------------------------

/** How big a frame-sheet thumbnail is drawn, in CSS pixels. */
const THUMB_BOX = { w: 260, h: 150 };

/**
 * One row per texture the widget draws: the sheet's pixel size, its frame grid
 * when it has one, and the sheet itself with the current cell picked out. The
 * IMAGE comes from the host's own pipeline (the layout push already resolved
 * every texture in the document to a URL); only the grid is drawn here.
 */
function renderTextureTab(): void {
  const item = selectedItem();
  const widgetInfo = selectedInfo();
  if (!item) {
    note("Nothing selected. Click a widget on the canvas.");
    return;
  }
  if (!widgetInfo) {
    note("Reading this widget's textures…");
    return;
  }
  const textures = widgetInfo.textures ?? [];
  if (textures.length === 0) {
    note(`${widgetTitle(item)} draws no texture.`);
    return;
  }
  for (const texture of textures) {
    const head = el("div", "head");
    head.appendChild(el("div", "title", `${texture.source}: ${textureName(texture.path)}`));
    head.appendChild(el("div", "chain", texture.path));
    head.appendChild(el("div", "chain", textureSummary(texture)));
    haloBodyEl.appendChild(head);

    const grid = thumbGrid(texture, THUMB_BOX);
    const url = images[texture.path]?.src ?? thumbUrls[texture.path] ?? null;
    if (!grid || !url) {
      note(
        url
          ? "The sheet's own pixel size could not be read, so no frame grid is drawn over it."
          : "No decoded image for this path, so there is nothing to draw the grid on."
      );
      continue;
    }
    haloBodyEl.appendChild(frameCanvas(url, grid));
  }
}

/** The sheet with its grid, drawn once into its own canvas (never the main one). */
function frameCanvas(url: string, grid: ReturnType<typeof thumbGrid>): HTMLElement {
  const node = document.createElement("canvas");
  node.className = "thumb";
  node.width = THUMB_BOX.w;
  node.height = THUMB_BOX.h;
  const context = node.getContext("2d");
  if (!context || !grid) return node;
  const image = new Image();
  const paint = (): void => {
    context.clearRect(0, 0, node.width, node.height);
    context.drawImage(image, grid.image.x, grid.image.y, grid.image.w, grid.image.h);
    if (grid.columns > 1 || grid.rows > 1) {
      context.strokeStyle = "rgba(255,255,255,0.35)";
      context.lineWidth = 1;
      context.beginPath();
      for (let c = 1; c < grid.columns; c++) {
        const x = grid.image.x + c * grid.cellW;
        context.moveTo(x, grid.image.y);
        context.lineTo(x, grid.image.y + grid.image.h);
      }
      for (let r = 1; r < grid.rows; r++) {
        const y = grid.image.y + r * grid.cellH;
        context.moveTo(grid.image.x, y);
        context.lineTo(grid.image.x + grid.image.w, y);
      }
      context.stroke();
    }
    if (grid.current) {
      context.strokeStyle = "#4fc1ff";
      context.lineWidth = 2;
      context.strokeRect(grid.current.x, grid.current.y, grid.current.w, grid.current.h);
    }
  };
  image.onload = paint;
  image.src = url;
  return node;
}

// ---- tab: conditional visibility --------------------------------------------

const VISIBILITY_MODES: { mode: GuiVisibilityMode; label: string; title: string }[] = [
  { mode: "showAll", label: "Show all", title: "Keep every conditional widget: the safe default" },
  { mode: "hideAll", label: "Hide all", title: "Collapse every widget whose visible is an expression" },
  { mode: "evaluate", label: "Evaluate", title: "Decide each condition yourself, below" },
];

/**
 * The three modes, and in `evaluate` a toggle per condition the layout met. The
 * key is the condition SOURCE STRING, so two widgets written with the same
 * condition share one toggle, which is what the wire says and what a designer
 * expects.
 */
function renderVisible(): void {
  const head = el("div", "head");
  head.appendChild(el("div", "title", "Conditional visibility"));
  head.appendChild(
    el(
      "div",
      "chain",
      "A `visible` that is an expression cannot be evaluated in a static preview. Choose what the canvas should assume."
    )
  );
  haloBodyEl.appendChild(head);

  const tools = el("div", "tools");
  const group = el("div", "px-toggle-group");
  group.dataset.spacing = "0";
  for (const entry of VISIBILITY_MODES) {
    const node = el("button", "px-toggle", entry.label) as HTMLButtonElement;
    node.dataset.variant = "outline";
    node.dataset.size = "sm";
    node.setAttribute("aria-pressed", entry.mode === visibilityMode ? "true" : "false");
    node.dataset.tip = entry.title;
    node.dataset.tipWrap = "";
    node.addEventListener("click", () => sendVisibility(entry.mode, visibilityChecks));
    group.appendChild(node);
  }
  tools.appendChild(group);
  haloBodyEl.appendChild(tools);

  if (visibilityFound.length === 0) {
    note("No widget in this file has a conditional `visible`, so the mode changes nothing here.");
    return;
  }
  haloBodyEl.appendChild(sectionTitle(`${visibilityFound.length} condition(s) the layout met`));
  for (const check of visibilityFound) {
    // Unassigned behaves as shown (the wire's rule), so an unticked box means
    // "assume false" and a ticked one means "assume true".
    const label = switchRow(check.key, visibilityChecks[check.key] !== false, (on) =>
      sendVisibility("evaluate", { ...visibilityChecks, [check.key]: on })
    );
    const box = label.querySelector("input") as HTMLInputElement;
    box.disabled = visibilityMode !== "evaluate";
    label.title = `${check.count} widget(s) carry this condition${check.hidden ? "; this run hid them" : ""}`;
    if (check.hidden) label.appendChild(badge("hidden"));
    haloBodyEl.appendChild(label);
  }
}

/** A labelled px-switch: `<label class="px-switch check"><input><span></span><span>text</span></label>`. */
function switchRow(text: string, on: boolean, onChange: (on: boolean) => void): HTMLLabelElement {
  const label = el("label", "px-switch check") as HTMLLabelElement;
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = on;
  box.addEventListener("change", () => onChange(box.checked));
  label.appendChild(box);
  label.appendChild(el("span"));
  label.appendChild(el("span", "px-grow px-sm", text));
  return label;
}

function sendVisibility(mode: GuiVisibilityMode, checks: Record<string, boolean>): void {
  // Optimistic only for the badge and the buttons; the CANVAS changes when the
  // host pushes the layout it computed, which is the only thing that can be
  // said to be laid out this way.
  host.send({ type: "setVisibility", mode, checks });
}

/**
 * The badge is the whole honesty of the feature: a mode that hides a widget
 * must never be silent, or a missing widget is a bug hunt. Visible whenever the
 * mode is not the default, and clicking it opens the panel that set it.
 */
function renderVisibilityBadge(): void {
  const off = visibilityMode === "showAll";
  visibilityBadgeEl.hidden = off;
  if (off) return;
  const assigned = Object.values(visibilityChecks).filter((v) => v === false).length;
  visibilityBadgeEl.textContent =
    visibilityMode === "hideAll"
      ? "visibility: hiding every conditional widget"
      : `visibility: evaluating, ${assigned} condition(s) set to false`;
}

// ---- tab: what this reaches --------------------------------------------------

/**
 * The forward dependency surface: the scripted_guis this document (or this
 * widget's subtree) calls, the events and on_actions they hand control to, and
 * the loc keys it names. Every row with a definition site is a click-through,
 * and a missing loc key is marked rather than left to be discovered in game.
 */
function renderUses(): void {
  const item = selectedItem();
  const head = el("div", "head");
  head.appendChild(
    el(
      "div",
      "title",
      dependenciesLine === undefined ? `Whole file: ${file}` : `Inside ${widgetTitle(item!)}`
    )
  );
  haloBodyEl.appendChild(head);

  haloBodyEl.appendChild(
    switchRow("The whole file, not just the selection", dependenciesWholeFile, (on) => {
      dependenciesWholeFile = on;
      askDependencies();
      renderHalo();
    })
  );

  if (!dependencies) {
    note(dependenciesPending ? "Reading what this reaches…" : "The host could not answer that.");
    return;
  }

  haloBodyEl.appendChild(sectionTitle(`scripted_gui (${dependencies.scriptedGuis.length})`));
  if (dependencies.scriptedGuis.length === 0) {
    note("This calls no scripted_gui, so it hands control to no script.");
  }
  for (const row of dependencies.scriptedGuis) {
    const line = el("div", "prose");
    line.appendChild(revealLink(row.name, row.file, row.line));
    line.appendChild(
      el("span", "chain", ` · ${row.uses} call site(s) across the gui tree, ${row.callLines.length} here`)
    );
    haloBodyEl.appendChild(line);
    if (!row.file) haloBodyEl.appendChild(el("div", "chain missing", "  no scripted_gui by that name"));
    for (const chain of row.chains) {
      const entry = el("div", "prose");
      entry.appendChild(el("span", "chain", "  → "));
      entry.appendChild(revealLink(chain.name, chain.file, chain.line));
      entry.appendChild(
        el(
          "span",
          "chain",
          chain.via.length === 0
            ? ` (${chain.kind}, directly)`
            : ` (${chain.kind}, via ${chain.via.join(" → ")})`
        )
      );
      haloBodyEl.appendChild(entry);
    }
  }

  haloBodyEl.appendChild(sectionTitle(`localization (${dependencies.locKeys.length})`));
  if (dependencies.locKeys.length === 0) note("This names no localization key.");
  for (const row of dependencies.locKeys) {
    const line = el("div", "prose");
    const key = el("span", row.missing ? "link missing" : "link", row.key);
    key.title = row.missing
      ? "No loc_key definition anywhere in the index: the game will print the key itself."
      : (row.value ?? "");
    // The key is named in THIS document, so the ordinary reveal is the right one.
    key.addEventListener("click", () => host.send({ type: "reveal", line: row.line }));
    line.appendChild(key);
    line.appendChild(el("span", "chain", ` · ${row.prop}`));
    if (row.missing) line.appendChild(badge("missing"));
    else if (row.value) line.appendChild(el("span", "chain", ` · ${row.value}`));
    haloBodyEl.appendChild(line);
  }
}

/** A name that reveals its definition site, or plain text when there is none. */
function revealLink(name: string, atFile: string | undefined, atLine: number | undefined): HTMLElement {
  if (!atFile || atLine === undefined) return el("span", undefined, name);
  const node = el("span", "link", name);
  node.title = `${atFile}:${atLine + 1}`;
  node.addEventListener("click", () => host.send({ type: "revealAt", file: atFile, line: atLine }));
  return node;
}

// ---- tab: the type and template browser --------------------------------------

/**
 * The vocabulary read as a catalogue. A type is INSERTED through the same
 * `insert` op the palette's drop uses; a template is APPLIED to the selected
 * widget as `using = Name`, which is a plain guarded property write, because
 * writing a template's name as a widget declaration would declare a widget the
 * game does not know.
 */
function renderTypes(): void {
  haloBodyEl.appendChild(
    filterBox("Filter types and templates", browserQuery, (value) => {
      browserQuery = value;
      renderHalo();
      focusFilter();
    })
  );
  if (vocabulary.length === 0) {
    note("No widget vocabulary for this game yet.");
    return;
  }
  const groups = browserGroups(vocabulary, browserQuery);
  if (groups.length === 0) {
    note(`Nothing matches "${browserQuery}".`);
    return;
  }
  for (const group of groups) {
    haloBodyEl.appendChild(sectionTitle(group.title));
    for (const entry of group.entries) {
      const row = el("div", "px-item row");
      setSelected(row, browserPick === entry.name);
      row.appendChild(el("span", "label", paletteLabel(entry)));
      if (entry.count !== undefined) row.appendChild(badge(String(entry.count)));
      row.addEventListener("click", () => {
        browserPick = browserPick === entry.name ? null : entry.name;
        renderHalo();
      });
      haloBodyEl.appendChild(row);
      if (browserPick !== entry.name) continue;
      for (const detail of vocabularyDetail(entry)) {
        haloBodyEl.appendChild(el("div", "chain", detail));
      }
      haloBodyEl.appendChild(browserActions(entry));
    }
    if (group.hidden > 0) {
      haloBodyEl.appendChild(el("div", "note", `${group.hidden} more; type to filter.`));
    }
  }
}

/**
 * A picked entry's two verbs. Both resolve the SELECTION AT CLICK TIME rather
 * than at render time: a panel is rebuilt on a debounce, so a handler that
 * closed over the selection it was drawn with would write to the widget the
 * user had selected a moment ago.
 */
function browserActions(entry: GuiVocabularyEntry): HTMLElement {
  const tools = el("div", "tools");
  const writable = canEdit(selectedItem());
  if (entry.kind === "template") {
    const apply = button(
      `Apply as using = ${entry.name}`,
      () => {
        const target = selectedItem();
        if (!canEdit(target)) {
          toast("Select a widget with a declaration in this file first.", "info");
          return;
        }
        guardedWrite(target.line, [{ key: "using", value: usingValue(entry.name) }]);
      },
      {
        variant: "outline",
        size: "sm",
        tip: "Write `using` on the selected widget. Its own properties still win over the template's.",
      }
    );
    apply.disabled = !writable;
    tools.appendChild(apply);
    return tools;
  }
  const insert = button("Insert here", () => insertType(entry), {
    variant: "outline",
    size: "sm",
    tip: "Insert an instance next to the selected widget, through the same op a palette drop uses.",
  });
  insert.disabled = !writable;
  tools.appendChild(insert);
  return tools;
}

/** The browser's insert: the same op a library drop sends, at the paste target. */
function insertType(entry: GuiVocabularyEntry): void {
  const at = pasteTarget();
  if (!at) return;
  insertEntry(
    { key: `${entry.kind}:${entry.name}`, name: entry.name, kind: entry.kind, source: "", vocab: entry },
    at
  );
}

/**
 * One property write, guards first: the check carries the value being written
 * so the answer is exactly the commit's, and the commit only goes out if it
 * passed. The same two-step the anchor picker uses.
 */
function guardedWrite(line: number, properties: EditProperty[]): void {
  sendEdit("checkEdit", line, properties, (verdict) => {
    if (verdict.refused) {
      toast(verdict.refused, "refused");
      return;
    }
    sendEdit("applyEdit", line, properties, (answer) => {
      if (answer.refused) toast(answer.refused, "refused");
      else if (answer.warning) toast(answer.warning, "warned");
    });
  });
}

// ---- tab: the texture browser -------------------------------------------------

/**
 * The `.dds` files under the mod's and the game's `gfx/` trees, enumerated by
 * the HOST (the app has no file system) and thumbnailed through the host's
 * existing decode cache. Picking one writes a texture property on the selected
 * widget in the format the engine reads: a quoted, root-relative, forward-slash
 * path (textures.ts `textureValue`).
 */
function renderArt(): void {
  const item = selectedItem();
  const keys = textureKeys();
  const head = el("div", "head");
  head.appendChild(el("div", "title", "Textures under gfx/"));
  head.appendChild(
    el(
      "div",
      "chain",
      canEdit(item)
        ? `Picking one writes it on ${widgetTitle(item)}.`
        : "Select a widget with a declaration in this file to pick one."
    )
  );
  haloBodyEl.appendChild(head);

  if (canEdit(item) && keys.length > 1) {
    const tools = el("div", "tools");
    tools.appendChild(el("span", "px-label", "Write to"));
    const { wrap, select } = dropdownSelect(
      keys.map((key) => ({ value: key, label: key })),
      texturePropertyKey,
      { tip: "Which texture property a pick writes" }
    );
    select.addEventListener("change", () => {
      texturePropertyKey = select.value;
    });
    tools.appendChild(wrap);
    haloBodyEl.appendChild(tools);
  }

  haloBodyEl.appendChild(
    filterBox("Filter by path", textureQuery, (value) => {
      textureQuery = value;
      askTextures();
      renderHalo();
      focusFilter();
    })
  );

  if (!textureRootsKnown) {
    note("No mod or game folder is configured, so there is no gfx tree to walk.");
    return;
  }
  if (textureEntries.length === 0) {
    note(texturesPending ? "Walking the gfx trees…" : `No .dds path contains "${textureQuery}".`);
    return;
  }
  const page = texturePage(textureEntries);
  // Thumbnails only for what is on screen: the host decodes one image per path,
  // and a whole listing would be a decode per file in the game.
  const wanted = page.paths.filter((path) => thumbUrls[path] === undefined);
  if (wanted.length > 0) host.send({ type: "requestThumbnails", paths: wanted });

  for (const entry of page.rows) {
    const row = el("div", "px-item texRow");
    const url = thumbUrls[entry.path];
    if (url) {
      const img = document.createElement("img");
      img.className = "swatch";
      img.src = url;
      row.appendChild(img);
    } else {
      row.appendChild(el("span", "swatch"));
    }
    const names = el("div", "names");
    names.appendChild(el("div", undefined, textureName(entry.path)));
    names.appendChild(el("div", "chain px-xs", `${entry.source} · ${textureFolder(entry.path)}`));
    row.appendChild(names);
    row.title = entry.path;
    row.addEventListener("click", () => {
      // At click time, not at render time: the panel is rebuilt on a debounce
      // and the selection may have moved on since it was drawn.
      const target = selectedItem();
      if (!canEdit(target)) {
        toast("Select a widget with a declaration in this file first.", "info");
        return;
      }
      guardedWrite(target.line, [{ key: texturePropertyKey, value: textureValue(entry.path) }]);
    });
    haloBodyEl.appendChild(row);
  }
  const hidden = textureTotal - page.rows.length;
  if (hidden > 0) haloBodyEl.appendChild(el("div", "note", `${hidden} more; type to filter.`));
}

/** Which property a pick writes. `texture` unless the widget names another one. */
let texturePropertyKey = "texture";

/**
 * The widget's own texture-valued keys, found by their VALUES rather than by a
 * list of key names: a `.dds` in the value is what makes a property a texture,
 * and the vanilla trees spell that key several ways.
 */
function textureKeys(): string[] {
  const widgetInfo = selectedInfo();
  const keys = new Set<string>(["texture"]);
  for (const property of widgetInfo?.properties ?? []) {
    if (/\.dds"?\s*$/i.test(property.value.trim())) keys.add(property.key);
  }
  const list = [...keys];
  if (!list.includes(texturePropertyKey)) texturePropertyKey = "texture";
  return list;
}

// ---- tab: saved components and presets ----------------------------------------

/**
 * The user's own library, which is the host's to keep (workspaceState) and the
 * app's only to draw. NOTHING is bundled: a component or a preset this editor
 * shipped would be a guess at what a mod's widgets look like, and the panel
 * says it is empty rather than filling itself with invented content.
 */
function renderSaved(): void {
  const item = selectedItem();

  haloBodyEl.appendChild(sectionTitle(`Components (${components.length})`));
  const saveTools = el("div", "tools");
  const nameInput = textInput("Name", componentName, "text");
  nameInput.addEventListener("input", () => {
    componentName = nameInput.value;
  });
  saveTools.appendChild(nameInput);
  const save = button("Save selection", () => saveSelectionAsComponent(), {
    variant: "outline",
    size: "sm",
    tip: "Store the selected widgets' verbatim block text under that name.",
  });
  save.dataset.tipSide = "left";
  save.disabled = selected === null;
  saveTools.appendChild(save);
  haloBodyEl.appendChild(saveTools);

  if (components.length === 0) {
    note("Nothing saved yet. Select one or more widgets, name them, and save.");
  }
  for (const component of components) {
    const row = el("div", "px-item row");
    row.appendChild(el("span", "label", component.name));
    row.appendChild(badge(`${component.widgets}w`, `${component.widgets} widget(s)`));
    row.appendChild(el("span", "px-grow"));
    const tools = el("span", "px-item-tools");
    const insert = button("Insert", () => insertComponent(component.name), {
      size: "xs",
      tip: "Insert it next to the selected widget",
    });
    insert.disabled = !canEdit(item);
    tools.appendChild(insert);
    tools.appendChild(forgetButton("component", component.name));
    row.appendChild(tools);
    haloBodyEl.appendChild(row);
  }

  haloBodyEl.appendChild(sectionTitle(`Property presets (${presets.length})`));
  if (presets.length === 0) {
    note('Nothing saved yet. Use "Save preset" in the inspector to store a widget\'s own properties.');
  }
  for (const preset of presets) {
    const row = el("div", "px-item row");
    row.appendChild(el("span", "label", preset.name));
    row.appendChild(badge(`${preset.properties.length}`, `${preset.properties.length} propert(ies)`));
    row.title = preset.properties.map((p) => `${p.key} = ${p.value}`).join("\n");
    row.appendChild(el("span", "px-grow"));
    const tools = el("span", "px-item-tools");
    const apply = button("Apply", () => applyPreset(preset), {
      size: "xs",
      tip: "Write every property of this preset onto the selection, as one undo step.",
    });
    apply.disabled = selected === null;
    tools.appendChild(apply);
    tools.appendChild(forgetButton("preset", preset.name));
    row.appendChild(tools);
    haloBodyEl.appendChild(row);
  }
}

let componentName = "";

function forgetButton(kind: "component" | "preset", name: string): HTMLElement {
  const node = button("Forget", () => host.send({ type: "forgetSaved", kind, name }), {
    size: "xs",
    tip: `Remove "${name}" from your saved ${kind}s. The document is not touched.`,
  });
  node.dataset.tipSide = "left";
  return node;
}

function saveSelectionAsComponent(): void {
  const name = componentName.trim();
  if (name.length === 0) {
    toast("Give the component a name first.", "info");
    return;
  }
  const lines = selectionLines("saved");
  if (!lines) return;
  awaitVerdict(
    (id) => ({ type: "saveComponent", id, name, lines }),
    (verdict) => {
      if (verdict.refused) toast(verdict.refused, "refused");
      else toast(`Saved ${lines.length} widget(s) as "${name}".`, "info");
    }
  );
}

function insertComponent(name: string): void {
  const at = pasteTarget();
  if (!at) return;
  insertEntry({ key: `saved:${name}`, name, kind: "saved", source: "" }, at);
}

/**
 * A preset over the selection: ONE batch, so several widgets are one document
 * change and one undo step, exactly like align and wrap. A member with no
 * declaration here is named rather than silently skipped.
 */
function applyPreset(preset: SavedPreset): void {
  const ops: GuiSourceOp[] = [];
  const skipped: string[] = [];
  for (const index of allSelected()) {
    const item = scene.items[index];
    if (canEdit(item)) ops.push({ kind: "setProperties", line: item.line, properties: preset.properties });
    else skipped.push(`${widgetTitle(item)} ${NO_SOURCE_HERE}`);
  }
  if (skipped.length > 0) toast([...new Set(skipped)].join(" "), "warned");
  if (ops.length === 0) return;
  sendOps("applyOps", ops, reportBatch);
}

/** A filter box, the palette's, reused by the two browsers. */
function filterBox(placeholder: string, value: string, onInput: (value: string) => void): HTMLElement {
  const wrap = el("div", "filter");
  const group = el("div", "px-input-group");
  group.appendChild(iconEl("search"));
  const input = textInput(placeholder, value, "text");
  input.addEventListener("input", () => onInput(input.value));
  group.appendChild(input);
  wrap.appendChild(group);
  return wrap;
}

/** A re-render replaces the box the user is typing in; put the caret back. */
function focusFilter(): void {
  const input = haloBodyEl.querySelector<HTMLInputElement>(".filter input");
  if (!input) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
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
  // whatever happens to be painted under that corner. A multi-selection's
  // grips sit on its bounds and resize every member.
  const bounds = selectionBounds();
  const handle = bounds
    ? handleAt(bounds, world.x, world.y, zoom)
    : current && selected !== null && canEdit(current)
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
  const reveal = (ev.ctrlKey || ev.metaKey) && ev.shiftKey;
  const additive = ev.shiftKey && !ev.ctrlKey && !ev.metaKey;
  if (ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && stack.length > 0 && !committing) {
    // Alt is two gestures on one press: a CLICK steps outward through the
    // stack (decided on release, when no drag happened) and a DRAG duplicates
    // the widget under the cursor, the selected one when the press is on it.
    const target = selected !== null && stack.includes(selected) ? selected : stack[0];
    altPress = { next: nextInStack(stack, selected) };
    capture(ev.pointerId);
    beginGesture(target, null, world, screen, true);
    return;
  }
  // Empty canvas starts a marquee; Shift (without the reveal chord) adds to
  // or removes from the set.
  const next = stack[0] ?? null;
  if (next === null) {
    if (!additive) select(null, { reveal: false });
    marquee = { origin: world, rect: { ...world, w: 0, h: 0 }, additive, base: allSelected(), hits: [] };
    capture(ev.pointerId);
    draw();
    return;
  }
  if (additive) {
    // A shift-click is a SELECTION gesture: it never also arms a drag, or the
    // widget the user was only adding would move with the next pointer move.
    selectMany(toggleSelected(allSelected(), next), { reveal: false });
    return;
  }
  const members = allSelected();
  // Pressing a member keeps the whole selection (and drags all of it), with the
  // pressed one as the primary; pressing anything else replaces the selection.
  if (members.includes(next)) selectMany([...members.filter((i) => i !== next), next], { reveal });
  else select(next, { reveal });
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
  if (paletteDrag) return;
  if (marquee) {
    marquee.rect = {
      x: Math.min(marquee.origin.x, world.x),
      y: Math.min(marquee.origin.y, world.y),
      w: Math.abs(world.x - marquee.origin.x),
      h: Math.abs(world.y - marquee.origin.y),
    };
    // Painted, not selected, until release: a marquee over a big window would
    // otherwise rebuild the tree and the inspector on every pointer move.
    marquee.hits = marqueeHits(scene, marquee.rect, skipMask);
    statusEl.textContent = `${marquee.hits.length} widget(s) inside the marquee`;
    requestDraw();
    return;
  }
  if (gesture) {
    updateGesture(gesture, world, { x: ev.clientX, y: ev.clientY });
    return;
  }
  const current = selectedItem();
  const handle = canEdit(current) ? handleAt(hitRect(current), world.x, world.y, zoom) : null;
  stage.style.cursor = handle ? handleCursor(handle) : "default";
  showTextTip(hitStack(scene, world.x, world.y, skipMask)[0] ?? null, ev.clientX, ev.clientY);
});
stage.addEventListener("pointerleave", () => showTextTip(null, 0, 0));
stage.addEventListener("pointerup", (ev) => {
  if (ev.button === 1 && panning) {
    panning = false;
    release(ev.pointerId);
    stage.style.cursor = "default";
    return;
  }
  if (ev.button !== 0) return;
  if (paletteDrag) return;
  if (marquee) {
    release(ev.pointerId);
    const caught = marquee.additive ? [...marquee.base, ...marquee.hits] : marquee.hits;
    marquee = null;
    selectMany([...new Set(caught)], { reveal: false });
    return;
  }
  if (!gesture) return;
  release(ev.pointerId);
  const g = gesture;
  const alt = altPress;
  altPress = null;
  if (alt && !g.engaged) {
    // The Alt+click half: nothing was dragged, so step through the stack.
    gesture = null;
    select(alt.next, { reveal: false });
    return;
  }
  endGesture(g);
});
stage.addEventListener("pointercancel", () => {
  altPress = null;
  // The pointer went away mid-gesture (a touch cancelled, the window lost it):
  // drop the gesture without committing anything.
  if (!gesture) return;
  const previewed = gesture.writes !== null;
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
  // A key typed into a field is the field's (the page's inputs stop
  // propagation themselves; this is for anything that does not).
  if (isTypingTarget(ev.target)) return;
  const chord = ev.ctrlKey || ev.metaKey;
  if (!chord && ev.key !== "Escape" && onNavigationKey(ev)) return;
  if (chord && !ev.altKey) {
    const key = ev.key.toLowerCase();
    if (key === "c" || key === "d" || key === "v") {
      ev.preventDefault();
      if (key === "c") copySelection();
      else if (key === "d") duplicateSelection();
      else pasteIntoSelection();
      return;
    }
  }
  if ((ev.key === "Delete" || ev.key === "Backspace") && !chord) {
    ev.preventDefault();
    void deleteSelectionConfirmed();
    return;
  }
  if (ev.key === "f" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    // Focus the selection, or leave the focus when there is nothing new to
    // focus on: one key, both directions. With nothing to focus and nothing
    // to leave, F fits the view instead.
    if (selected !== null && selected !== focusIndex) setFocus(selected);
    else if (focusIndex !== null) setFocus(null);
    else fitView();
    return;
  }
  if (ev.key !== "Escape") return;
  if (nudge.pending) {
    // Escape drops the nudge that has not been written yet; the preview goes
    // back to what the file says.
    nudge.cancel();
    statusEl.textContent = statusLine();
    renderInspector();
    draw();
    return;
  }
  if (paletteDrag) {
    endPaletteDrag(false);
    return;
  }
  if (marquee) {
    marquee = null;
    statusEl.textContent = statusLine();
    draw();
    return;
  }
  if (gesture) {
    // Escape abandons the drag in progress before it touches the selection:
    // the widget snaps back to where the file still has it.
    const previewed = gesture.writes !== null;
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

/**
 * The keys that move the SELECTION or the VIEW rather than the document:
 * arrows nudge, Tab and Shift+Tab step through siblings, Enter descends into
 * the first child, Shift+Enter climbs back to the parent, Shift+F zooms to
 * the selection and Home fits the reference viewport. True when the key was
 * taken.
 */
function onNavigationKey(ev: KeyboardEvent): boolean {
  const vector = nudgeVector(ev.key, ev, GRID_STEP);
  if (vector) {
    if (selected === null || gesture || marquee) return false;
    ev.preventDefault();
    nudge.add(vector[0], vector[1]);
    return true;
  }
  if (ev.key === "Tab") {
    // Only from the canvas: with a toolbar button focused, Tab is the page's.
    if (document.activeElement && document.activeElement !== document.body) return false;
    const next =
      selected === null
        ? firstRoot(scene, skipMask)
        : siblingFrom(scene, selected, ev.shiftKey ? -1 : 1, skipMask);
    if (next === null) return false;
    ev.preventDefault();
    select(next, { reveal: false });
    return true;
  }
  if (ev.key === "Enter" && selected !== null) {
    const next = ev.shiftKey ? parentIndex(scene, selected) : firstChildOf(scene, selected, skipMask);
    if (next === null || skipMask?.[next]) return false;
    ev.preventDefault();
    select(next, { reveal: false });
    return true;
  }
  if (ev.key === "F" && ev.shiftKey && !ev.altKey) {
    const bounds = selectionBounds() ?? (selected !== null ? hitRect(scene.items[selected]) : null);
    if (!bounds) return false;
    ev.preventDefault();
    fitRect(bounds);
    return true;
  }
  if (ev.key === "Home" && !ev.shiftKey && !ev.altKey) {
    ev.preventDefault();
    fitView();
    return true;
  }
  return false;
}

/** Fit what is on screen: the focused subtree when there is one, else the reference viewport. */
function fitView(): void {
  if (focusIndex === null) fitAndCenter();
  else fitRect(hitRect(scene.items[focusIndex]));
}

/**
 * Delete, confirmed when it would take more than one widget: a multi-delete
 * is one undo step, but it is also the one key that can empty a window.
 */
async function deleteSelectionConfirmed(): Promise<void> {
  const count = allSelected().length;
  if (count === 0) return;
  if (count > 1) {
    const ok = await confirmDialog({
      title: `Delete ${count} widgets?`,
      description: "Their blocks are removed from the file as one change; undo brings them all back.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
  }
  deleteSelection();
}

// ---- toolbar ---------------------------------------------------------------

document.getElementById("undo")!.addEventListener("click", () => host.send({ type: "undo" }));
document.getElementById("redo")!.addEventListener("click", () => host.send({ type: "redo" }));

document.getElementById("zoomIn")!.addEventListener("click", () => {
  zoomToPoint(stage.clientWidth / 2, stage.clientHeight / 2, zoom * 1.25);
});
document.getElementById("zoomOut")!.addEventListener("click", () => {
  zoomToPoint(stage.clientWidth / 2, stage.clientHeight / 2, zoom / 1.25);
});
// Fit means "fit what is on screen", and under a subtree focus that is the
// subtree, not the 1920x1080 reference viewport around it.
document.getElementById("zoomFit")!.addEventListener("click", fitView);
document.getElementById("refresh")!.addEventListener("click", () => host.send({ type: "requestLayout" }));
libraryToggleEl.addEventListener("click", toggleLibrary);
haloToggleEl.addEventListener("click", toggleHalo);
outlinesEl.addEventListener("change", draw);
// The two drag toggles are remembered by the host, like the value mode.
snapToggle.addEventListener("change", () => {
  host.send({ type: "setUiState", valueMode, snap: snapToggle.checked, grid: gridToggle.checked });
  draw();
});
gridToggle.addEventListener("change", () => {
  host.send({ type: "setUiState", valueMode, snap: snapToggle.checked, grid: gridToggle.checked });
  draw();
});
locResolvedEl.addEventListener("click", () => setLocMode("resolve"));
locRawEl.addEventListener("click", () => setLocMode("raw"));
constraintsToggle.addEventListener("change", () => {
  // Switching it on turns the placement flag on, so the trace has to be fetched
  // for the CURRENT selection or the overlay would stay blank until the user
  // clicked something else. An answer already in hand is reused rather than
  // re-asked, which is the case whenever the "why" panel is open as well.
  if (!constraintsToggle.checked) {
    draw();
    return;
  }
  const widgetInfo = selectedInfo();
  constraints = widgetInfo ? constraintOverlay(widgetInfo) : null;
  if (!constraints) reReadWidgetInfo();
  draw();
});
pulsesToggle.addEventListener("change", () => {
  if (!pulsesToggle.checked) {
    if (pulseTimer) clearTimeout(pulseTimer);
    pulseTimer = undefined;
    pulse = null;
    pulseNoteText = null;
    statusEl.textContent = statusLine();
  }
  draw();
});
for (const entry of HEATMAP_MODES) {
  const option = document.createElement("option");
  option.value = entry.mode;
  option.textContent = entry.label;
  option.title = entry.title;
  heatmapSelect.appendChild(option);
}
/** The select holds the mode; the toolbar shows it as a px-dropdown whose list is a menu. */
function syncHeatmapMenu(): void {
  const label = heatmapMenuEl.querySelector(".px-truncate") as HTMLElement;
  label.textContent = HEATMAP_MODES.find((m) => m.mode === heatmapSelect.value)?.label ?? "Heatmap";
  heatmapMenuEl.setAttribute("aria-pressed", heatmapSelect.value === "off" ? "false" : "true");
}
heatmapMenuEl.addEventListener("click", () =>
  menu(
    heatmapMenuEl,
    HEATMAP_MODES.map((m) => ({ value: m.mode, label: m.label, description: m.title })),
    {
      value: heatmapSelect.value,
      width: 260,
      onPick: (mode) => {
        if (mode === heatmapSelect.value) return;
        heatmapSelect.value = mode;
        heatmapSelect.dispatchEvent(new Event("change"));
      },
    }
  )
);
heatmapSelect.addEventListener("change", () => {
  syncHeatmapMenu();
  rebuildHeatmap();
  if (heat) toast(heat.legend, "info");
  draw();
});
syncHeatmapMenu();

// ---- side panels ------------------------------------------------------------

/**
 * The two side columns: resizable, hideable from the toolbar, and remembered
 * by the host under the same ui key as the value display mode. A change is
 * sent with the CURRENT value mode, since the host stores the two together.
 */
const sidePanels = {
  left: sidePanel(document.getElementById("side") as HTMLElement, {
    width: 280,
    min: 200,
    max: 560,
    onChange: sendPanels,
  }),
  right: sidePanel(document.getElementById("right") as HTMLElement, {
    width: 320,
    min: 240,
    max: 640,
    onChange: sendPanels,
  }),
};

function panelStates(): GuiPanelStates {
  const of = (p: (typeof sidePanels)["left"]) => ({
    width: parseInt(p.element.style.getPropertyValue("--px-sidepanel-width"), 10) || 0,
    collapsed: p.collapsed,
  });
  return { left: of(sidePanels.left), right: of(sidePanels.right) };
}

/** True while the host's remembered state is being applied: that is not a change to send back. */
let adoptingPanels = false;

function sendPanels(): void {
  updatePanelToggles();
  if (!adoptingPanels) host.send({ type: "setUiState", valueMode, panels: panelStates() });
}

function adoptPanels(panels: GuiPanelStates): void {
  adoptingPanels = true;
  sidePanels.left.setWidth(panels.left.width);
  sidePanels.left.toggle(panels.left.collapsed);
  sidePanels.right.setWidth(panels.right.width);
  sidePanels.right.toggle(panels.right.collapsed);
  adoptingPanels = false;
}

function updatePanelToggles(): void {
  const left = document.getElementById("toggleSide") as HTMLButtonElement;
  left.replaceChildren(iconEl(sidePanels.left.collapsed ? "panelLeftOpen" : "panelLeftClose"));
  left.dataset.tip = sidePanels.left.collapsed ? "Show the tree" : "Hide the tree";
  const right = document.getElementById("toggleRight") as HTMLButtonElement;
  right.replaceChildren(iconEl(sidePanels.right.collapsed ? "panelRightOpen" : "panelRightClose"));
  right.dataset.tip = sidePanels.right.collapsed ? "Show the inspector" : "Hide the inspector";
}

document.getElementById("toggleSide")!.addEventListener("click", () => sidePanels.left.toggle());
document.getElementById("toggleRight")!.addEventListener("click", () => sidePanels.right.toggle());
window.addEventListener("resize", draw);
// A panel drag or fold resizes the stage without a window resize; the canvas follows.
if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => requestDraw()).observe(stage);

/**
 * The heatmap is rebuilt on a mode change and on every layout push, and never
 * per frame: it is a Float32Array over the whole draw list, which is the same
 * discipline `rebuildMasks` follows and for the same reason.
 */
function rebuildHeatmap(): void {
  heat = buildHeatmap(scene, heatmapSelect.value as HeatmapMode);
}
// A palette drag has no pointer capture of its own: it starts on a panel row
// and can end anywhere, so the WINDOW follows and ends it (pointer events
// bubble there from every element). Over the stage the drop commits; anywhere
// else it cancels rather than leaving the drag armed for the next pointer move.
window.addEventListener("pointermove", (ev) => {
  if (!paletteDrag) return;
  moveGhost(ev.clientX, ev.clientY);
  if (overStage(ev)) updatePaletteDrag(toWorld(ev));
  else clearPaletteTarget();
});
window.addEventListener("pointerup", (ev) => {
  if (!paletteDrag || ev.button !== 0) return;
  endPaletteDrag(overStage(ev));
});
window.addEventListener("pointercancel", () => {
  if (paletteDrag) endPaletteDrag(false);
});

visibilityBadgeEl.addEventListener("click", () => {
  if (!haloOpen()) toggleHalo();
  setHaloTab("visible");
});

renderFocusBar();
renderLayers();
renderInspector();
renderHaloTabs();
host.send({ type: "ready" });
