/**
 * The Coat of Arms Designer app: the game's own designer, rebuilt over the
 * toolkit's renderer.
 *
 * The three tabs are the game's (gui/shared/coa_designer.gui, strings from
 * localization/english/gui/coa_designer_l_english.yml): Background is the
 * pattern grid and the pattern's color slots, Layout is the ~35 whole-arms
 * layouts, Emblems is the emblem catalog by category with the selected
 * emblem's colors and its instances. Everything they offer arrives in
 * `db.designer`, read from the same files the game reads.
 *
 * Rendering is render.ts and the canvas gestures are elements.ts, both shared
 * with the Flag Builder: this panel is a different way to reach the same
 * `coat_of_arms` definition, not a second renderer.
 */
import {
  COLOR_SLOTS,
  colorToRgb,
  DEFAULT_INSTANCE,
  writeFlag,
  type CoaColor,
  type CoaFlag,
  type CoaInstance,
  type CoaLayer,
  type CoaSubInstance,
  type DesignerEntry,
  type Rgb,
} from "@px-lsp/server/coa/coa";
import type {
  AppToHost,
  DesignerTab,
  DesignerUiState,
  FlagDatabase,
  FlagEntry,
  FlagTarget,
  HostToApp,
  LibraryItem,
  LibraryState,
  ModTarget,
} from "../messages";
import { GRID_COLUMNS } from "../messages";
import { edgeStrips, placeArms, type Box } from "../frameGeometry";
import { frameHint } from "../../flagBuilder/messages";
import { targetAction } from "../../flagBuilder/target";
import { middleEllipsis } from "../../flagBuilder/app/paths";
import { clearRenderCaches, previewThumb, renderFlag, textureKeys } from "../../flagBuilder/app/render";
import {
  boxOf,
  cornerAt,
  cornerCursor,
  containsPoint,
  corners,
  instanceCount,
  resizeBox,
  writeBox,
  DRAG_THRESHOLD,
  HANDLE_SIZE,
  type Corner,
  type ElementBox,
  type ElementRef,
} from "../../flagBuilder/app/elements";
import {
  alignDeltas,
  ARMS_RECT,
  DEFAULT_GRID_DIVISION,
  distributeDeltas,
  GRID_DIVISIONS,
  mirrorGroup,
  moveGroup,
  nudgeStep,
  rectCentre,
  rotateGroup,
  scaleGroup,
  selectionBounds,
  snapDelta,
  snapTolerance,
  snapValue,
  validGridDivision,
  type AlignMode,
  type Rect,
} from "./groups";
import { iconEl } from "../../shared/icons";
import { sidePanel, type SidePanel } from "../../shared/sidePanel";
import { closePopover, confirmDialog, menu, popover, toast, type MenuItem } from "../../shared/overlay";
import { helpDialog } from "../../shared/help";
import { scrubbable } from "../../shared/scrub";
import { colorPicker, paintSwatch, rgbToHex } from "../../shared/colorPicker";
import { sortable } from "../../shared/sortable";
import { installTips } from "../../shared/tips";
import { saveTargetLine } from "../../shared/saveTarget";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

installTips();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let db: FlagDatabase | null = null;
let mods: ModTarget[] = [];
let flag: CoaFlag = { name: "new_coa", pattern: "", colors: [], layers: [] };
/**
 * The game's two modes. "adjusted" is what "Adjust Existing Design" gives:
 * the structure of the opened design stays and only its colors and instances
 * move (COA_DESIGNER_BACKGROUND_PATTERN_DISABLED_IN_ADJUSTED_MODE). The game
 * locks the emblem textures there too; this editor does not, because a modder
 * opening arms from a file to swap one emblem should not have to rebuild them.
 */
let mode: "custom" | "adjusted" = "custom";
let tab: DesignerTab = "background";
/** The emblem layer under edit, or -1. */
let layerIndex = -1;
/** The instance of that layer the detail edit is on. */
let instIndex = 0;
/**
 * What the canvas outlines and every tool acts on, in pick order: the last one
 * is the PRIMARY, whose numbers the detail panel shows and whose value a mass
 * edit takes its delta from.
 */
let selection: ElementRef[] = [];
/**
 * Layers a click cannot reach and a gesture cannot move, by index. UI state,
 * not script: the game has no such key, so a lock is never written and never
 * survives a reload.
 */
const locked = new Set<number>();
let frameId = "";
/** Which cell of a frame sheet the preview draws, 1-based (see frameCells). */
let frameTier = 2;
/**
 * The grid over the arms: drawn and snapped to when on, `div` cells per axis.
 * ON out of the box, because a coat of arms is built on the arms' own halves
 * and quarters and every placement gesture in this panel reads better against
 * lines than against nothing.
 */
const grid = { on: true, div: DEFAULT_GRID_DIVISION };
let emblemCategory = "";
let opened: { name: string; source: string; file: string } | null = null;
let target: FlagTarget | undefined;

const designer = (): FlagDatabase["designer"] | undefined => db?.designer;

// ---------------------------------------------------------------------------
// The selection
// ---------------------------------------------------------------------------

const sameRef = (a: ElementRef, b: ElementRef): boolean => a.layer === b.layer && a.instance === b.instance;

/** The last picked element: whose numbers the detail panel shows. */
const primary = (): ElementRef | null => selection[selection.length - 1] ?? null;

const isSelected = (ref: ElementRef): boolean => selection.some((r) => sameRef(r, ref));

/** Shift adds or removes; a plain pick replaces. A locked layer is never taken. */
function select(ref: ElementRef, add: boolean): void {
  if (locked.has(ref.layer)) return;
  if (!add) {
    selection = [ref];
    return;
  }
  const at = selection.findIndex((r) => sameRef(r, ref));
  if (at >= 0) selection.splice(at, 1);
  else selection.push(ref);
}

function selectMany(refs: ElementRef[]): void {
  selection = refs.filter((r) => !locked.has(r.layer));
}

/** Every unlocked element of every layer: what Ctrl+A means. */
function allElements(): ElementRef[] {
  const out: ElementRef[] = [];
  flag.layers.forEach((layer, index) => {
    if (locked.has(index)) return;
    for (let i = 0; i < instanceCount(layer); i++) out.push({ layer: index, instance: i });
  });
  return out;
}

/**
 * What the tools act on: the selection, or, with nothing selected, the one
 * element the placement panel is showing. The panel's numbers already edited
 * that element with nothing selected; a mirror button beside them that did
 * nothing read as broken.
 */
function actedOn(): ElementRef[] {
  if (selection.length > 0) return selection;
  const layer = flag.layers[layerIndex];
  if (!layer || locked.has(layerIndex) || instanceCount(layer) === 0) return [];
  return [{ layer: layerIndex, instance: Math.min(instIndex, instanceCount(layer) - 1) }];
}

const selectedBoxes = (): ElementBox[] => actedOn().map((r) => boxOf(flag.layers[r.layer], r.instance));

/** Write boxes back, one per acted-on element, materializing implicit instances. */
function writeBoxes(boxes: readonly ElementBox[]): void {
  actedOn().forEach((ref, i) => {
    const layer = flag.layers[ref.layer];
    materialize(layer);
    writeBox(layer, ref.instance, boxes[i]);
  });
}

/** The topmost element under the point, skipping locked layers. */
function hitUnlocked(u: number, v: number): ElementRef | null {
  for (let l = flag.layers.length - 1; l >= 0; l--) {
    if (locked.has(l)) continue;
    const layer = flag.layers[l];
    for (let i = instanceCount(layer) - 1; i >= 0; i--) {
      if (containsPoint(boxOf(layer, i), u, v)) return { layer: l, instance: i };
    }
  }
  return null;
}

/** The one layer kind this panel creates: the designer only makes colored emblems. */
type EmblemLayer = Extract<CoaLayer, { kind: "colored_emblem" }>;

// ---------------------------------------------------------------------------
// Textures (the host decodes; the app only ever holds images)
// ---------------------------------------------------------------------------

const images = new Map<string, HTMLImageElement | null>();
const thumbs = new Map<string, HTMLImageElement | null>();
const pending = { full: new Set<string>(), thumb: new Set<string>() };
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function request(key: string, thumb: boolean): void {
  const store = thumb ? thumbs : images;
  const queue = thumb ? pending.thumb : pending.full;
  if (store.has(key) || queue.has(key)) return;
  queue.add(key);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      for (const [q, isThumb] of [
        [pending.full, false],
        [pending.thumb, true],
      ] as const) {
        if (q.size) send({ type: "textures", keys: [...q], thumbs: isThumb });
        q.clear();
      }
    }, 0);
  }
}

function receiveTextures(urls: Record<string, string | null>, thumb: boolean): void {
  const store = thumb ? thumbs : images;
  for (const [key, url] of Object.entries(urls)) {
    if (!url) {
      store.set(key, null);
      if (thumb) paintTiles();
      continue;
    }
    const img = new Image();
    img.onload = () => {
      store.set(key, img);
      if (thumb) paintTiles();
      else draw();
    };
    img.onerror = () => store.set(key, null);
    img.src = url;
  }
  if (!thumb) draw();
}

const FULL_SOURCE = { image: (k: string): HTMLImageElement | null => images.get(k) ?? null };
const THUMB_SOURCE = { image: (k: string): HTMLImageElement | null => thumbs.get(k) ?? null };

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const past: string[] = [];
const future: string[] = [];
let snapshot = "";

function commit(): void {
  const now = JSON.stringify(flag);
  if (now === snapshot) return;
  past.push(snapshot);
  if (past.length > 200) past.shift();
  future.length = 0;
  snapshot = now;
  updateHistoryButtons();
}

function restore(json: string): void {
  snapshot = json;
  flag = JSON.parse(json);
  $<HTMLInputElement>("name").value = flag.name;
  clampSelection();
  refresh(false);
  updateHistoryButtons();
}

function undo(): void {
  const prev = past.pop();
  if (prev === undefined) return;
  future.push(snapshot);
  restore(prev);
}

function redo(): void {
  const next = future.pop();
  if (next === undefined) return;
  past.push(snapshot);
  restore(next);
}

function resetHistory(): void {
  past.length = 0;
  future.length = 0;
  loadedDirty = false;
  snapshot = JSON.stringify(flag);
  updateHistoryButtons();
}

/**
 * A design that came from somewhere the mod cannot get it back from (the
 * library) counts as unsaved even before the first edit, so the discard
 * question is asked. Not an undo step: undoing to the same design is noise.
 */
let loadedDirty = false;

function updateHistoryButtons(): void {
  $<HTMLButtonElement>("undo").disabled = past.length === 0;
  $<HTMLButtonElement>("redo").disabled = future.length === 0;
}

const dirty = (): boolean => past.length > 0 || loadedDirty;

async function confirmDiscard(what: string): Promise<boolean> {
  if (!dirty()) return true;
  return confirmDialog({
    title: `${what} discards your changes`,
    description: "The current design has unsaved edits.",
    confirmLabel: "Discard",
    destructive: true,
  });
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

/**
 * Square, because CK3 draws arms square: every coat-of-arms widget in
 * gui/shared/coat_of_arms.gui asks for one size twice
 * (`GetTexture('(int32)56','(int32)56')`), and the frames are square too.
 */
const CANVAS_SIZE = 512;
const canvas = $<HTMLCanvasElement>("canvas");
canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

/** The GUI editor's selection colors, so the editors read as one product. */
const SELECT_STROKE = "#4fc1ff";
const SELECT_SHADOW = "rgba(0,0,0,0.65)";

const scratch = document.createElement("canvas");

function renderContext(): Parameters<typeof renderFlag>[3] {
  return {
    textures: FULL_SOURCE,
    namedColors: db?.namedColors ?? {},
    definitions: db?.definitions ?? {},
  };
}

/**
 * Where the arms sit on the canvas. Every mapping between pointer, selection
 * outline and pixels goes through the `arms` rect; the mask is drawn at
 * `icon`, which the arms shrink and move inside (frameGeometry.ts). No frame:
 * both are the whole canvas.
 */
function frameGeometry(): { icon: Box; arms: Box } {
  const cell: Box = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  if (!frameId) return { icon: cell, arms: cell };
  const known = designer()?.frames.find((f) => f.id === frameId);
  // A house frame's arms are scaled and raised as its cultures declare
  // (house_coa_mask_scale / _offset), which the game's widget reads off the
  // culture; the defaults otherwise.
  if (known?.family)
    return placeArms(cell, known.family, { scale: known.maskScale, offset: known.maskOffset });
  // A frame no gui type is known for (flagBuilder/database.ts GUI_FRAMES and
  // the cultures name every vanilla one): fit the mask's painted shape to the
  // frame's own hole, so the arms land where the hole is.
  const mask = images.get(`masks/${frameId}`);
  const frame = images.get(`frames/${frameId}`);
  const hole = frame ? frameHole(frame) : null;
  const shape = mask ? maskShape(`masks/${frameId}`, mask) : null;
  if (!hole || !shape) return { icon: cell, arms: cell };
  const box: Box = {
    x: (hole.x - shape.x * (hole.w / shape.w)) * canvas.width,
    y: (hole.y - shape.y * (hole.h / shape.h)) * canvas.height,
    w: (hole.w / shape.w) * canvas.width,
    h: (hole.h / shape.h) * canvas.height,
  };
  return { icon: box, arms: box };
}

const armsRect = (): Box => frameGeometry().arms;

/**
 * Where the arms go in a frame cell: the bounding box of the transparent
 * region around the cell's centre, as fractions of the cell.
 *
 * The house and dynasty masks are the full 160 px of their cell, while the
 * frame cell paints a border around a transparent middle, so the mask's
 * painted shape has to be fitted to that hole. A scan along the middle row
 * and column was not enough: house_frame_14 is a roundel with concave
 * sides, and its hole is 34 px wider at the top than on the middle row
 * (measured on 1.19), so the arms came out a narrow shield. A flood fill
 * from the centre finds the whole hole. Once per frame and tier.
 */
const holes = new Map<string, Box | null>();

function frameHole(frame: HTMLImageElement): Box | null {
  const cells = frameCells(frame);
  const index = frameCellIndex(cells);
  const key = `${frameId}:${index}`;
  const hit = holes.get(key);
  if (hit !== undefined) return hit;
  const cell = Math.round(frame.naturalWidth / cells);
  const size = frame.naturalHeight;
  const c = document.createElement("canvas");
  c.width = cell;
  c.height = size;
  const cctx = c.getContext("2d", { willReadFrequently: true })!;
  cctx.drawImage(frame, index * cell, 0, cell, size, 0, 0, cell, size);
  const alpha = cctx.getImageData(0, 0, cell, size).data;
  const clear = (x: number, y: number): boolean => alpha[(y * cell + x) * 4 + 3] < 128;
  const midX = Math.floor(cell / 2);
  const midY = Math.floor(size / 2);
  let out: Box | null = null;
  if (clear(midX, midY)) {
    const seen = new Uint8Array(cell * size);
    const stack = [midY * cell + midX];
    seen[stack[0]] = 1;
    let left = midX,
      right = midX,
      top = midY,
      bottom = midY;
    while (stack.length > 0) {
      const at = stack.pop()!;
      const x = at % cell;
      const y = (at - x) / cell;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cell || ny >= size) continue;
        const n = ny * cell + nx;
        if (seen[n] || !clear(nx, ny)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    out = { x: left / cell, y: top / size, w: (right - left + 1) / cell, h: (bottom - top + 1) / size };
  }
  holes.set(key, out);
  return out;
}

/** The painted part of a mask (alpha at least half), as fractions of the mask. */
const shapes = new Map<string, Box>();

function maskShape(key: string, mask: HTMLImageElement): Box {
  const hit = shapes.get(key);
  if (hit) return hit;
  const w = mask.naturalWidth,
    h = mask.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cctx = c.getContext("2d", { willReadFrequently: true })!;
  cctx.drawImage(mask, 0, 0);
  const alpha = cctx.getImageData(0, 0, w, h).data;
  let left = w,
    right = -1,
    top = h,
    bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[(y * w + x) * 4 + 3] < 128) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  const out: Box =
    right < 0
      ? { x: 0, y: 0, w: 1, h: 1 }
      : { x: left / w, y: top / h, w: (right - left + 1) / w, h: (bottom - top + 1) / h };
  shapes.set(key, out);
  return out;
}

/**
 * How many frames a frame texture holds. The house and dynasty frames are
 * SPRITE SHEETS, one square cell per title tier laid out across
 * (`gfx/interface/coat_of_arms/frames/house_frame_26.dds` is 960x160 next to a
 * 160x160 mask, measured on 1.19); the title pair is a single cell. The cell
 * is square either way, so the count is the aspect ratio.
 */
function frameCells(frame: HTMLImageElement): number {
  if (!frame.naturalHeight) return 1;
  return Math.max(1, Math.round(frame.naturalWidth / frame.naturalHeight));
}

/** The tier the preview draws, clamped to what this frame actually has. */
function frameCellIndex(cells: number): number {
  return Math.min(cells, Math.max(1, frameTier)) - 1;
}

/** `overlay` = false for the PNG export: the outline is a tool, not the arms. */
function draw(overlay = true): void {
  if (!db) return;
  const ctx = canvas.getContext("2d")!;
  const { icon, arms: rect } = frameGeometry();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const mask = frameId ? images.get(`masks/${frameId}`) : null;
  const frame = frameId ? images.get(`frames/${frameId}`) : null;
  if (frameId && (mask === undefined || frame === undefined)) {
    request(`masks/${frameId}`, false);
    request(`frames/${frameId}`, false);
  }
  let complete: boolean;
  if (frameId && mask) {
    // The game masks the arms with `<frame>_mask.dds` and draws `<frame>.dds`
    // over them (gui/shared/coat_of_arms.gui). The mask's shape is its ALPHA,
    // which is what `destination-in` reads: house_china_mask.dds and
    // house_japan_mask.dds are 160x160 of pure black at alpha 255 (measured on
    // 1.19), so a mask read as brightness leaves those two frames empty, and
    // title_mask.dds is the mirror case, pure white with the shape in alpha.
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const sctx = scratch.getContext("2d")!;
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    complete = renderFlag(sctx, flag, rect, renderContext());
    // The band between the arms and the mask shows the arms' edge pixels
    // stretched, as the game's clamp-to-edge sampling shows them
    // (frameGeometry.ts edgeStrips). Same canvas as source and destination:
    // the spec copies the source first, so a strip never reads itself.
    for (const e of edgeStrips(rect, icon))
      sctx.drawImage(scratch, e.sx, e.sy, e.sw, e.sh, e.dx, e.dy, e.dw, e.dh);
    sctx.globalCompositeOperation = "destination-in";
    sctx.drawImage(mask, icon.x, icon.y, icon.w, icon.h);
    sctx.globalCompositeOperation = "source-over";
    ctx.drawImage(scratch, 0, 0);
    if (frame) drawFrame(ctx, frame);
  } else {
    complete = renderFlag(ctx, flag, rect, renderContext());
  }
  const keys = textureKeys(flag, db.definitions);
  if (!complete) for (const key of keys) request(key, false);
  const missing = keys.filter((k) => images.get(k) === null);
  $("hint").textContent = missing.length ? `Missing textures: ${missing.join(", ")}` : "";
  if (overlay) {
    paintGrid(ctx);
    paintArmsEdge(ctx, icon, rect);
    paintSelection(ctx);
  }
  updateTierControl();
}

/** ONE cell of the frame sheet, over the whole preview. */
function drawFrame(ctx: CanvasRenderingContext2D, frame: HTMLImageElement): void {
  const cells = frameCells(frame);
  const cell = frame.naturalWidth / cells;
  ctx.drawImage(
    frame,
    frameCellIndex(cells) * cell,
    0,
    cell,
    frame.naturalHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );
}

/** The grid over the arms, so a placement can be read off as well as felt. */
function paintGrid(ctx: CanvasRenderingContext2D): void {
  if (!grid.on) return;
  const arms = armsRect();
  const screen = canvas.getBoundingClientRect();
  const f = screen.width ? screen.width / canvas.width : 1;
  ctx.save();
  ctx.lineWidth = 1 / f;
  for (let i = 0; i <= grid.div; i++) {
    // The centre lines are the ones a design is built around, so they read
    // stronger than the rest; the border is the arms' own edge.
    const middle = i * 2 === grid.div;
    ctx.strokeStyle = middle ? "rgba(79,193,255,0.55)" : "rgba(255,255,255,0.22)";
    const x = arms.x + (arms.w * i) / grid.div;
    const y = arms.y + (arms.h * i) / grid.div;
    ctx.beginPath();
    ctx.moveTo(x, arms.y);
    ctx.lineTo(x, arms.y + arms.h);
    ctx.moveTo(arms.x, y);
    ctx.lineTo(arms.x + arms.w, y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The arms' edge when the grid is not there to show it and a frame leaves a
 * band outside it: what lies past the line is stretched edge, not arms, and an
 * emblem placed across it streaks in the game.
 */
function paintArmsEdge(ctx: CanvasRenderingContext2D, icon: Box, arms: Box): void {
  if (grid.on || (icon.x === arms.x && icon.y === arms.y && icon.w === arms.w && icon.h === arms.h)) return;
  const f = screenFactor();
  ctx.save();
  ctx.setLineDash([4 / f, 4 / f]);
  ctx.lineWidth = 1 / f;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.strokeRect(arms.x, arms.y, arms.w, arms.h);
  ctx.restore();
}

/** Canvas pixels per screen pixel: outlines stay one pixel wide at any zoom. */
function screenFactor(): number {
  const screen = canvas.getBoundingClientRect();
  return screen.width ? screen.width / canvas.width : 1;
}

/** Arms fractions to canvas pixels. */
function toCanvas(u: number, v: number): [number, number] {
  const arms = armsRect();
  return [arms.x + u * arms.w, arms.y + v * arms.h];
}

function outline(ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[]): void {
  const f = screenFactor();
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.lineWidth = 3 / f;
  ctx.strokeStyle = SELECT_SHADOW;
  ctx.stroke();
  ctx.lineWidth = 1.5 / f;
  ctx.strokeStyle = SELECT_STROKE;
  ctx.stroke();
}

function handles(ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[]): void {
  const f = screenFactor();
  const side = HANDLE_SIZE / f;
  ctx.lineWidth = 1 / f;
  ctx.strokeStyle = SELECT_SHADOW;
  ctx.fillStyle = SELECT_STROKE;
  for (const [x, y] of points) {
    ctx.fillRect(x - side / 2, y - side / 2, side, side);
    ctx.strokeRect(x - side / 2, y - side / 2, side, side);
  }
}

/** The group box's four corners, in arms fractions, clockwise from the top left. */
function groupCorners(bounds: Rect): { corner: Corner; x: number; y: number }[] {
  return [
    { corner: "nw" as const, x: bounds.x, y: bounds.y },
    { corner: "ne" as const, x: bounds.x + bounds.w, y: bounds.y },
    { corner: "se" as const, x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    { corner: "sw" as const, x: bounds.x, y: bounds.y + bounds.h },
  ];
}

/** Where the rotate grip sits: above the top edge, on the group's centre line. */
function rotateGrip(bounds: Rect): [number, number] {
  const arms = armsRect();
  const reach = arms.h ? (ROTATE_GRIP_PX * screenFactor()) / arms.h : 0.05;
  return [bounds.x + bounds.w / 2, bounds.y - reach];
}

/** How far above the group box the rotate grip sits, in SCREEN pixels. */
const ROTATE_GRIP_PX = 22;

function paintSelection(ctx: CanvasRenderingContext2D): void {
  if (selection.length === 0) return;
  const boxes = selectedBoxes();
  ctx.save();
  for (const box of boxes) {
    outline(
      ctx,
      corners(box).map((p) => toCanvas(p.x, p.y))
    );
  }
  if (boxes.length === 1) {
    handles(
      ctx,
      corners(boxes[0]).map((p) => toCanvas(p.x, p.y))
    );
    ctx.restore();
    return;
  }
  // Several: the members keep their thin outlines and the group box carries
  // the handles, because one gesture now moves the arrangement, not a member.
  const bounds = selectionBounds(boxes);
  const points = groupCorners(bounds).map((p) => toCanvas(p.x, p.y));
  const f = screenFactor();
  ctx.setLineDash([6 / f, 4 / f]);
  outline(ctx, points);
  ctx.setLineDash([]);
  const [gx, gy] = rotateGrip(bounds);
  const [rx, ry] = toCanvas(gx, gy);
  const [tx, ty] = toCanvas(bounds.x + bounds.w / 2, bounds.y);
  ctx.lineWidth = 1.5 / f;
  ctx.strokeStyle = SELECT_STROKE;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(rx, ry);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rx, ry, HANDLE_SIZE / 2 / f, 0, Math.PI * 2);
  ctx.fillStyle = SELECT_STROKE;
  ctx.fill();
  ctx.strokeStyle = SELECT_SHADOW;
  ctx.lineWidth = 1 / f;
  ctx.stroke();
  handles(ctx, points);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Small px-ui builders
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  e.append(...children);
  return e;
}

function button(label: string, onClick: () => void, variant = "ghost", size?: string): HTMLButtonElement {
  const b = el("button", "px-btn", label);
  b.dataset.variant = variant;
  if (size) b.dataset.size = size;
  b.onclick = onClick;
  return b;
}

function iconButton(name: Parameters<typeof iconEl>[0], tip: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", "px-btn", iconEl(name));
  b.dataset.variant = "ghost";
  b.dataset.size = "icon-xs";
  b.dataset.tip = tip;
  b.onclick = onClick;
  return b;
}

/**
 * A labelled number. The LABEL is the drag handle and the input is only ever
 * typed in, which is the rule the shared fields follow (shared/scrub.ts): a
 * press inside the box must not move the value out from under the caret.
 */
function numberField(
  label: string,
  value: number,
  step: number,
  onChange: (v: number) => void
): { el: HTMLElement; input: HTMLInputElement } {
  const input = el("input", "px-input");
  input.type = "number";
  input.step = String(step);
  input.value = String(value);
  const apply = (v: number): void => {
    if (Number.isFinite(v)) onChange(Math.round(v * 1000) / 1000);
  };
  input.oninput = () => apply(Number(input.value));
  input.onchange = () => {
    apply(Number(input.value));
    commit();
  };
  const row = el("div", "px-field");
  const caption = el("span", "px-label", label);
  row.append(caption, input);
  scrubbable(input, {
    step,
    handle: caption,
    onChange: (v) => {
      input.value = String(Math.round(v * 1000) / 1000);
      apply(v);
    },
    onCommit: commit,
  });
  return { el: row, input };
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

/**
 * A pattern tile's colors: the design's, and a grey for every slot the design
 * has not set. Unset, the texture's own placeholder (yellow for the second
 * slot) showed through and the tiles read as miscoloured.
 */
const NEUTRAL_SLOTS: Rgb[] = [
  [214, 214, 214],
  [132, 132, 132],
  [72, 72, 72],
];
function tileColors(colors: CoaColor[]): CoaColor[] {
  return COLOR_SLOTS.slice(0, 3).map(
    (name, i) =>
      colors.find((c) => c.name === name) ?? { name, kind: "rgb" as const, value: NEUTRAL_SLOTS[i] }
  );
}

function rgbOf(color: CoaColor | undefined): Rgb | null {
  if (!color || !db) return null;
  return colorToRgb(color, db.namedColors, flag.colors);
}

/** The color at `slot` (0-based) of `colors`, adding empty slots up to it. */
function ensureSlot(colors: CoaColor[], slot: number, fallback: CoaColor): CoaColor {
  while (colors.length <= slot) colors.push({ ...fallback, name: COLOR_SLOTS[colors.length] });
  return colors[slot];
}

/**
 * The palette: the 13 named colors the game's designer offers, plus the free
 * picker it hides behind "Color Picker". A free color is written as
 * `rgb { r g b }`, which is what the game's own export does.
 */
function openPalette(
  anchor: HTMLElement,
  current: CoaColor | undefined,
  onPick: (c: CoaColor) => void
): void {
  const cat = designer();
  if (!cat) return;
  const root = el("div");
  const grid = el("div", "palette");
  for (const entry of cat.palette) {
    const sw = el("span", "px-swatch");
    paintSwatch(sw, entry.rgb);
    sw.dataset.tip = entry.name;
    if (current?.kind === "named" && current.value === entry.name) sw.setAttribute("aria-selected", "true");
    sw.onclick = () => {
      closePopover();
      onPick({ name: current?.name ?? "color1", kind: "named", value: entry.name });
      commit();
    };
    grid.append(sw);
  }
  const foot = el("div", "paletteFoot");
  foot.append(
    button(
      "Color Picker",
      () => {
        const start = rgbOf(current) ?? [255, 255, 255];
        // popover() closes the palette before opening the picker on the same anchor.
        colorPicker(anchor, start, {
          onChange: (rgb) => {
            onPick({ name: current?.name ?? "color1", kind: "rgb", value: rgb });
          },
          onClose: commit,
          onCopy: (text) => send({ type: "copy", text }),
        });
      },
      "outline",
      "sm"
    )
  );
  root.append(grid, foot);
  popover(anchor, root);
}

/** One labelled swatch button per color slot the entry declares. */
function colorRows(
  host: HTMLElement,
  colors: CoaColor[],
  count: number,
  labels: string[],
  onChange: () => void
): void {
  for (let slot = 0; slot < count; slot++) {
    const btn = el("button", "px-btn swatchBtn");
    btn.dataset.variant = "outline";
    const sw = el("span", "px-swatch");
    btn.append(sw);
    const paint = (): void => {
      const color = colors[slot];
      const rgb = rgbOf(color);
      if (rgb) paintSwatch(sw, rgb);
      else sw.style.setProperty("--px-swatch", "transparent");
      btn.dataset.tip = !color
        ? "Not set"
        : color.kind === "named"
          ? color.value
          : rgb
            ? rgbToHex(rgb)
            : "unset";
    };
    paint();
    btn.onclick = () =>
      openPalette(btn, colors[slot], (c) => {
        const name = COLOR_SLOTS[slot];
        ensureSlot(colors, slot, { name, kind: "named", value: "white" });
        colors[slot] = { ...c, name };
        paint();
        onChange();
      });
    const row = el("div", "colorRow");
    row.append(el("span", "px-label", labels[slot] ?? COLOR_SLOTS[slot]), btn);
    host.append(row);
  }
}

/** The game's own names for the five color slots (coa_designer_l_english.yml). */
const COLOR_LABELS = [
  "Primary Color",
  "Secondary Color",
  "Tertiary Color",
  "Quaternary Color",
  "Quinary Color",
];

// ---------------------------------------------------------------------------
// Catalog lookups
// ---------------------------------------------------------------------------

function patternEntry(): DesignerEntry | undefined {
  return designer()?.patterns.find((p) => p.file === flag.pattern);
}

function emblemEntry(texture: string): DesignerEntry | undefined {
  return designer()?.emblems.find((e) => e.file === texture);
}

/** The emblem layers, which is what the Emblems tab edits. */
function emblemLayers(): { layer: CoaLayer; index: number }[] {
  return flag.layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.kind === "colored_emblem");
}

function selectedLayer(): CoaLayer | null {
  return layerIndex >= 0 ? (flag.layers[layerIndex] ?? null) : null;
}

function clampSelection(): void {
  if (layerIndex >= flag.layers.length) layerIndex = flag.layers.length - 1;
  const layer = selectedLayer();
  if (!layer) {
    layerIndex = emblemLayers()[0]?.index ?? -1;
    instIndex = 0;
  }
  const current = selectedLayer();
  if (current && instIndex >= Math.max(1, current.instances.length)) instIndex = 0;
  selection = selection.filter((r) => flag.layers[r.layer] && r.instance < boxCount(r.layer));
  for (const index of [...locked]) if (!flag.layers[index]) locked.delete(index);
}

function boxCount(index: number): number {
  const layer = flag.layers[index];
  return layer ? Math.max(1, layer.instances.length) : 0;
}

// ---------------------------------------------------------------------------
// Tiles (lazy thumbnails)
// ---------------------------------------------------------------------------

interface Tile {
  canvas: HTMLCanvasElement;
  keys: string[];
  paint: () => void;
}

const tiles = new Map<HTMLElement, Tile>();
let observer: IntersectionObserver | null = null;

function tileObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const tile = tiles.get(entry.target as HTMLElement);
        if (!tile) continue;
        // In view order, batched: request() coalesces one message per tick.
        for (const key of tile.keys) request(key, true);
        tile.paint();
      }
    },
    { root: null, rootMargin: "200px" }
  );
  return observer;
}

function paintTiles(): void {
  for (const tile of tiles.values()) tile.paint();
}

/** A grid tile drawing `flagOf()` at thumbnail size; repainted as textures land. */
function makeTile(flagOf: () => CoaFlag, square: boolean, tip: string, onPick: () => void): HTMLElement {
  const host = el("div", "tile");
  if (square) host.dataset.square = "";
  host.dataset.tip = tip;
  const c = el("canvas");
  c.width = square ? 96 : 144;
  c.height = 96;
  host.append(c);
  host.onclick = onPick;
  const paint = (): void => {
    const source = flagOf();
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    renderFlag(
      ctx,
      source,
      { x: 0, y: 0, w: c.width, h: c.height },
      {
        textures: THUMB_SOURCE,
        namedColors: db?.namedColors ?? {},
        definitions: db?.definitions ?? {},
        cacheTag: "t",
      }
    );
  };
  tiles.set(host, { canvas: c, keys: [], paint });
  return host;
}

function registerTile(host: HTMLElement, keys: string[]): void {
  const tile = tiles.get(host);
  if (tile) tile.keys = keys;
  tileObserver().observe(host);
}

function clearTiles(host: HTMLElement): void {
  for (const child of Array.from(host.children)) {
    tiles.delete(child as HTMLElement);
    tileObserver().unobserve(child as HTMLElement);
  }
  host.replaceChildren();
}

// ---------------------------------------------------------------------------
// Background tab
// ---------------------------------------------------------------------------

function renderBackground(): void {
  const cat = designer();
  const colorsHost = $("bgColors");
  colorsHost.replaceChildren();
  if (!cat) return;
  const count = patternEntry()?.colors ?? 3;
  colorRows(colorsHost, flag.colors, count, COLOR_LABELS, () => {
    refresh();
  });

  const grid = $("patternGrid");
  clearTiles(grid);
  grid.style.setProperty("--cols", String(GRID_COLUMNS));
  if (mode === "adjusted") {
    const note = el(
      "div",
      "note",
      "In Adjusted mode the background pattern may not be changed, but you can adjust the colors above."
    );
    const back = button(
      "Customize Design",
      () => {
        mode = "custom";
        refresh(false);
      },
      "outline",
      "sm"
    );
    grid.style.removeProperty("--cols");
    // One full-width cell: the grid's columns are for pattern tiles, and the
    // note must not wrap inside one of them.
    const wrap = el("div", "adjustedNote");
    wrap.append(note, back);
    grid.append(wrap);
    return;
  }
  for (const entry of cat.patterns) {
    const key = `patterns/${entry.file}`;
    const host = makeTile(
      () => ({ name: "", pattern: entry.file, colors: tileColors(flag.colors), layers: [] }),
      true,
      entry.file,
      () => {
        flag.pattern = entry.file;
        // The new pattern may show fewer or more color buttons; keep what the
        // design already picked and let the extra slots stay in the script.
        refresh();
      }
    );
    if (entry.file === flag.pattern) host.setAttribute("aria-selected", "true");
    grid.append(host);
    registerTile(host, [key]);
  }
}

// ---------------------------------------------------------------------------
// Layout tab
// ---------------------------------------------------------------------------

/**
 * A layout is a whole coat of arms written against `@pattern`, `@color_1..3`
 * and `@texture_1..2`. Substituting is what "picking a layout" means: the
 * design's own pattern and colors stay, and the emblems it already has fill
 * the texture and emblem-color holes (the first two, in layer order).
 */
function substituteLayout(layout: CoaFlag, defaults: Record<string, string>): CoaFlag {
  const cat = designer();
  const emblems = emblemLayers().map(({ layer }) => layer as Extract<CoaLayer, { kind: "colored_emblem" }>);
  const texture = (n: 1 | 2): string =>
    emblems[n - 1]?.texture ?? emblems[0]?.texture ?? defaults[`@texture_${n}`] ?? "";
  const emblemColor = (n: 2 | 3): CoaColor | null =>
    emblems[n - 2]?.colors[0] ?? emblems[0]?.colors[0] ?? null;
  const named = (value: string, name: string): CoaColor => ({ name, kind: "named", value });

  const layers: CoaLayer[] = layout.layers.map((source) => {
    if (source.kind !== "colored_emblem") return JSON.parse(JSON.stringify(source)) as CoaLayer;
    const file = source.texture === "@texture_2" ? texture(2) : texture(1);
    const slots = cat?.emblems.find((e) => e.file === file)?.colors ?? source.colors.length;
    const colors: CoaColor[] = [];
    for (let slot = 0; slot < slots; slot++) {
      const placeholder = source.colors[slot];
      const which = placeholder?.kind === "named" && placeholder.value === "@color_3" ? 3 : 2;
      const from = emblemColor(which as 2 | 3) ?? flag.colors[slot + 1] ?? flag.colors[0];
      colors.push(
        from
          ? { ...from, name: COLOR_SLOTS[slot] }
          : named(defaults[`@color_${which}`] ?? "white", COLOR_SLOTS[slot])
      );
    }
    return {
      kind: "colored_emblem",
      texture: file,
      mask: source.mask,
      colors,
      instances: source.instances.map((i) => ({ ...i, scale: [...i.scale], position: [...i.position] })),
    };
  });
  return { name: flag.name, pattern: flag.pattern, colors: flag.colors, layers };
}

/** The layout as its own file writes it: neutral emblems and neutral colors. */
function layoutPreview(layout: CoaFlag, defaults: Record<string, string>): CoaFlag {
  const resolve = (value: string, name: string): CoaColor =>
    value.startsWith("@")
      ? { name, kind: "named", value: defaults[value] ?? "white" }
      : { name, kind: "named", value };
  const colors = layout.colors.map((c) =>
    c.kind === "named" ? resolve(c.value, c.name) : { ...c, name: c.name }
  );
  const layers = layout.layers.map((layer) => {
    if (layer.kind !== "colored_emblem") return layer;
    return {
      ...layer,
      texture: layer.texture.startsWith("@") ? (defaults[layer.texture] ?? "") : layer.texture,
      colors: layer.colors.map((c) => (c.kind === "named" ? resolve(c.value, c.name) : c)),
    };
  });
  return {
    name: layout.name,
    pattern: layout.pattern.startsWith("@") ? (defaults[layout.pattern] ?? "") : layout.pattern,
    colors,
    layers,
  };
}

function renderLayout(): void {
  const cat = designer();
  const grid = $("layoutGrid");
  clearTiles(grid);
  grid.style.setProperty("--cols", String(GRID_COLUMNS));
  if (!cat) return;
  for (const layout of cat.layouts) {
    const preview = layoutPreview(layout.flag, cat.layoutDefaults);
    const host = makeTile(
      () => preview,
      true,
      layout.name,
      () => {
        flag.layers = substituteLayout(layout.flag, cat.layoutDefaults).layers;
        layerIndex = emblemLayers()[0]?.index ?? -1;
        instIndex = 0;
        selection = [];
        locked.clear();
        refresh();
      }
    );
    grid.append(host);
    registerTile(host, textureKeys(preview, db?.definitions ?? {}));
  }
}

// ---------------------------------------------------------------------------
// Emblems tab
// ---------------------------------------------------------------------------

function emblemLabel(texture: string): string {
  return texture
    .replace(/^ce_/, "")
    .replace(/\.(dds|tga|png)$/i, "")
    .replace(/_/g, " ");
}

function renderLayerList(): void {
  const list = $("layerList");
  list.replaceChildren();
  for (const { layer, index } of emblemLayers()) {
    if (layer.kind !== "colored_emblem") continue;
    const row = el("div", "px-item");
    if (index === layerIndex) row.setAttribute("aria-selected", "true");
    if (locked.has(index)) row.dataset.locked = "";
    row.append(el("span", "px-item-kind", iconEl("shapes")));
    row.append(el("span", "px-item-label", emblemLabel(layer.texture) || "no emblem"));
    const tools = el("div", "px-item-tools");
    const instances = instanceCount(layer);
    if (instances > 1) {
      tools.append(
        iconButton("focus", `Select all ${instances} instances of this emblem`, () => {
          selectMany(Array.from({ length: instances }, (_, i) => ({ layer: index, instance: i })));
          layerIndex = index;
          refresh(false);
        })
      );
    }
    tools.append(
      iconButton(locked.has(index) ? "lock" : "unlock", locked.has(index) ? "Unlock" : "Lock", () => {
        if (locked.has(index)) locked.delete(index);
        else {
          locked.add(index);
          selection = selection.filter((r) => r.layer !== index);
        }
        refresh(false);
      }),
      iconButton("trash", "Remove this emblem", () => {
        removeLayer(index);
        selection = [];
        clampSelection();
        refresh();
      })
    );
    row.append(tools);
    row.onclick = (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      if (locked.has(index)) return;
      layerIndex = index;
      instIndex = 0;
      select({ layer: index, instance: 0 }, e.shiftKey);
      refresh(false);
      draw();
    };
    list.append(row);
  }
}

// Registered once, not per render: the list element outlives its rows.
// "Click and drag emblems to set which one is drawn on top of others"
// (COA_DESIGNER_DETAIL_DRAG_INSTRUCTION), which is layer order, so a drop
// moves the layer inside `flag.layers`.
sortable($("layerList"), {
  rows: () => Array.from($("layerList").children) as HTMLElement[],
  onReorder: (from, to) => {
    const order = emblemLayers().map((e) => e.index);
    const [moved] = flag.layers.splice(order[from], 1);
    flag.layers.splice(order[to], 0, moved);
    layerIndex = order[to];
    // Locks and the selection are held by layer index; a reorder invalidates
    // both, and there is nothing to be gained by guessing what moved where.
    locked.clear();
    selection = [];
    refresh();
  },
});

function renderEmblems(): void {
  renderLayerList();
  const cat = designer();
  const body = $("emblemBody");
  clearTiles(body);
  if (!cat) return;
  const layer = selectedLayer();
  if (!layer || layer.kind !== "colored_emblem") {
    body.append(el("div", "note", "Add an emblem to place a shape on the arms."));
    return;
  }

  // Colors of the selected emblem: as many buttons as the catalog declares.
  const colorsHost = el("div", "colors");
  const slots = emblemEntry(layer.texture)?.colors ?? layer.colors.length;
  colorRows(colorsHost, layer.colors, slots, COLOR_LABELS, () => refresh());
  body.append(el("div", "px-panel-title", "Colors"), colorsHost);

  // The catalog, one category at a time: 1577 emblems never all reach the DOM.
  // Offered in both modes: see the note on `mode`.
  {
    const head = el("div", "px-panel-title", "Textures");
    const pick = el("button", "px-btn px-dropdown");
    pick.dataset.variant = "outline";
    // Standard height: it sits with the tab's own fields, not among icon rows.
    pick.style.width = "auto";
    const category = emblemCategory || cat.categories[0] || "";
    pick.append(el("span", "px-truncate", categoryLabel(category)), iconEl("chevronDown"));
    pick.onclick = () =>
      menu(
        pick,
        cat.categories.map((id): MenuItem => ({ value: id, label: categoryLabel(id) })),
        {
          value: category,
          width: 220,
          onPick: (value) => {
            emblemCategory = value;
            renderEmblems();
          },
        }
      );
    const grid = el("div", "grid gridScroll");
    grid.style.setProperty("--cols", String(GRID_COLUMNS));
    for (const entry of cat.emblems) {
      if (entry.category !== category) continue;
      const host = emblemTile(entry, layer);
      grid.append(host);
      registerTile(host, [`colored_emblems/${entry.file}`]);
    }
    body.append(head, pick, grid);
  }
}

/**
 * The Placement section of the LEFT panel: which copy of the emblem is being
 * edited, and its numbers. It is not part of the Emblems tab because a
 * placement is what every tab's work ends in, so it must stay on screen while
 * the pattern or the layout is being picked on the right.
 */
function renderPlacement(): void {
  const host = $("placement");
  host.replaceChildren();
  const layer = selectedLayer();
  if (!layer || layer.kind !== "colored_emblem") {
    host.append(el("div", "note", "Select an emblem to place it."));
    return;
  }
  host.append(instanceGrid(layer), detailEdit(layer));
}

/** A raw emblem thumbnail, recolored for reading like the game's own grid. */
function emblemTile(entry: DesignerEntry, layer: EmblemLayer): HTMLElement {
  const key = `colored_emblems/${entry.file}`;
  const host = el("div", "tile");
  host.dataset.square = "";
  host.dataset.tip = entry.file;
  const c = el("canvas");
  c.width = 96;
  c.height = 96;
  host.append(c);
  if (layer.texture === entry.file) host.setAttribute("aria-selected", "true");
  host.onclick = () => pickEmblem(entry);
  const paint = (): void => {
    const img = thumbs.get(key);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (img) ctx.drawImage(previewThumb("t" + key, img, "colored_emblems"), 0, 0, c.width, c.height);
  };
  tiles.set(host, { canvas: c, keys: [key], paint });
  return host;
}

/** Swap the selected layer's texture and fit its color slots to the emblem's. */
function pickEmblem(entry: DesignerEntry): void {
  const layer = selectedLayer();
  if (!layer || layer.kind !== "colored_emblem") return;
  layer.texture = entry.file;
  layer.colors.length = Math.min(layer.colors.length, entry.colors);
  while (layer.colors.length < entry.colors) {
    const name = COLOR_SLOTS[layer.colors.length];
    const from = layer.colors[0] ?? flag.colors[1] ?? flag.colors[0];
    layer.colors.push(from ? { ...from, name } : { name, kind: "named", value: "white" });
  }
  refresh();
}

function categoryLabel(id: string): string {
  // COA_DESIGNER_CATEGORY_<id> in coa_designer_l_english.yml.
  const LABELS: Record<string, string> = {
    abstract: "Abstract",
    animals: "Animals",
    circles_spirals: "Circles and Spirals",
    crosses_and_knots: "Crosses and Knots",
    faiths: "Faiths",
    manmade: "Man-Made",
    nature: "Nature",
    patterns: "Patterns",
    tribal_seal: "Tribal Seals",
    writing: "Writing",
    figures: "Figures",
    kamon: "Kamon",
    chinese_seal: "Chinese Seals",
  };
  return LABELS[id] ?? id.replace(/_/g, " ");
}

/** The instances of a layer, four per row as the game lists them. */
function instanceGrid(layer: EmblemLayer): HTMLElement {
  const grid = el("div", "instances");
  const count = Math.max(1, layer.instances.length);
  for (let i = 0; i < count; i++) {
    const tile = el("div", "instTile", String(i + 1));
    tile.dataset.tip = "Click to edit, shift-click to add to the selection, right-click to remove";
    if (isSelected({ layer: layerIndex, instance: i })) tile.setAttribute("aria-selected", "true");
    tile.onclick = (e) => {
      instIndex = i;
      select({ layer: layerIndex, instance: i }, e.shiftKey);
      refresh(false);
      draw();
    };
    tile.oncontextmenu = (e) => {
      e.preventDefault();
      if (layer.instances.length <= 1) return;
      layer.instances.splice(i, 1);
      instIndex = 0;
      selection = [];
      refresh();
    };
    grid.append(tile);
  }
  const add = el("div", "instTile", "+");
  add.dataset.tip = "Add Emblem";
  add.onclick = () => {
    materialize(layer);
    const from = layer.instances[instIndex] ?? DEFAULT_INSTANCE;
    layer.instances.push({
      rotation: from.rotation,
      scale: [from.scale[0], from.scale[1]],
      position: [Math.min(1, from.position[0] + 0.1), Math.min(1, from.position[1] + 0.1)],
    });
    instIndex = layer.instances.length - 1;
    refresh();
  };
  grid.append(add);
  return grid;
}

/** Drop a layer and keep the locks, which are held by index, on the layers they were on. */
function removeLayer(index: number): void {
  flag.layers.splice(index, 1);
  const kept = [...locked].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i));
  locked.clear();
  for (const i of kept) locked.add(i);
}

/**
 * Delete: the selected placements go; an emblem left with none goes with
 * them, as its trash button would take it. Highest index first on both axes,
 * so an earlier splice cannot move a later one.
 */
function removeSelection(): void {
  if (selection.length === 0) return;
  const byLayer = new Map<number, Set<number>>();
  for (const ref of selection)
    byLayer.set(ref.layer, (byLayer.get(ref.layer) ?? new Set()).add(ref.instance));
  for (const [index, instances] of [...byLayer].sort((a, b) => b[0] - a[0])) {
    const layer = flag.layers[index];
    materialize(layer);
    for (const i of [...instances].sort((a, b) => b - a)) layer.instances.splice(i, 1);
    if (layer.instances.length === 0) removeLayer(index);
  }
  selection = [];
  instIndex = 0;
  clampSelection();
  refresh();
}

/** An implicit default instance becomes a real one before anything edits it. */
function materialize(layer: CoaLayer): void {
  if (layer.instances.length) return;
  if (layer.kind === "sub") layer.instances.push({ offset: [0, 0], scale: [1, 1] });
  else layer.instances.push({ ...DEFAULT_INSTANCE, scale: [1, 1], position: [0.5, 0.5] });
}

/**
 * Whether the two axes of an instance are kept equal. ON unless the modder
 * turns it off: a coat of arms emblem is a shape, and stretching one axis
 * alone is the rarer intent by far, so the set holds the EXCEPTIONS.
 */
const unmatchedScale = new Set<string>();

const matchKeyOf = (ref: ElementRef): string => `${ref.layer}:${ref.instance}`;
const scaleMatched = (ref: ElementRef): boolean => !unmatchedScale.has(matchKeyOf(ref));

/** One gesture, one undo step: run `edit` over the whole selection and commit once. */
function editSelection(edit: (boxes: ElementBox[]) => ElementBox[]): void {
  if (actedOn().length === 0) return;
  writeBoxes(edit(selectedBoxes()));
  refresh();
}

/** Move every selected element by the same amount. */
function nudgeSelection(du: number, dv: number): void {
  editSelection((boxes) => moveGroup(boxes, du, dv));
}

/**
 * Align and distribute the selection. One selected emblem has nothing to line
 * up against but the arms themselves, so that is the frame it gets; several
 * line up on the box they share, the way every layout tool does it.
 */
function alignSelection(mode: AlignMode): void {
  editSelection((boxes) => {
    const frame = boxes.length === 1 ? ARMS_RECT : selectionBounds(boxes);
    const deltas = alignDeltas(boxes, mode, frame);
    return boxes.map((box, i) => ({ ...box, cx: box.cx + deltas[i].du, cy: box.cy + deltas[i].dv }));
  });
}

function distributeSelection(axis: "x" | "y"): void {
  editSelection((boxes) => {
    const deltas = distributeDeltas(boxes, axis);
    return boxes.map((box, i) => ({ ...box, cx: box.cx + deltas[i].du, cy: box.cy + deltas[i].dv }));
  });
}

/** Copy every selected element where it stands; the copies become the selection. */
function duplicateSelection(): void {
  if (selection.length === 0) return;
  const made: ElementRef[] = [];
  // Highest instance first, so an earlier splice cannot move a later index.
  for (const ref of [...selection].sort((a, b) => b.layer - a.layer || b.instance - a.instance)) {
    const layer = flag.layers[ref.layer];
    materialize(layer);
    // Split by kind because the two instance shapes are different arrays; the
    // designer only ever makes colored emblems, but a pasted design can carry
    // a sub flag and it copies just as well.
    if (layer.kind === "sub")
      layer.instances.push(JSON.parse(JSON.stringify(layer.instances[ref.instance])) as CoaSubInstance);
    else layer.instances.push(JSON.parse(JSON.stringify(layer.instances[ref.instance])) as CoaInstance);
    made.push({ layer: ref.layer, instance: layer.instances.length - 1 });
  }
  selectMany(made.reverse());
  refresh();
}

/** The tools that act on the selection rather than on one number. */
/**
 * The tools under the numbers: align, distribute, mirror, duplicate, as four
 * groups in one row with a gap between them. The groups read from the glyphs
 * and the gaps; every button's tooltip names what it does and to what.
 */
function selectionTools(): HTMLElement {
  const host = el("div", "selTools");
  let row: HTMLElement = host;
  const group = (caption: string): void => {
    row = el("div", "toolGroup");
    row.setAttribute("aria-label", caption);
    host.append(row);
  };
  const tool = (label: string, tip: string, enabled: boolean, run: () => void): void => {
    const b = button(label, run, "outline", "icon-sm");
    b.dataset.tip = tip;
    b.disabled = !enabled;
    row.append(b);
  };
  const many = selection.length >= 2;
  const against = many ? "the selection" : "the arms";
  group(`Align to ${against}`);
  const aligns: [string, AlignMode, string][] = [
    ["⇤", "left", "Left edges"],
    ["⇔", "hcenter", "Centre horizontally"],
    ["⇥", "right", "Right edges"],
    ["⇡", "top", "Top edges"],
    ["⇕", "vcenter", "Centre vertically"],
    ["⇣", "bottom", "Bottom edges"],
  ];
  for (const [label, mode, tip] of aligns)
    tool(label, `${tip}, to ${against}`, true, () => alignSelection(mode));
  group("Distribute");
  tool("↔", "Equal gaps left to right (three or more selected)", selection.length >= 3, () =>
    distributeSelection("x")
  );
  tool("↕", "Equal gaps top to bottom (three or more selected)", selection.length >= 3, () =>
    distributeSelection("y")
  );
  group("Mirror");
  tool("⇄", "Mirror horizontally", true, () => editSelection((b) => mirrorGroup(b, "x")));
  tool("⇅", "Mirror vertically", true, () => editSelection((b) => mirrorGroup(b, "y")));
  group("Duplicate");
  const dup = iconButton("copy", "Duplicate in place", duplicateSelection);
  dup.dataset.variant = "outline";
  dup.dataset.size = "icon-sm";
  row.append(dup);
  return host;
}

/**
 * The numbers of the selection. One element edits its own instance; several
 * show the PRIMARY's numbers and write the DIFFERENCE into every member, so a
 * mass edit moves the arrangement instead of stacking it on one spot.
 */
function detailEdit(layer: EmblemLayer): HTMLElement {
  const body = el("div", "detail");
  materialize(layer);
  const ref = primary() ?? { layer: layerIndex, instance: Math.min(instIndex, layer.instances.length - 1) };
  const many = selection.length >= 2;
  const inst = (flag.layers[ref.layer] as EmblemLayer).instances[ref.instance] as CoaInstance;
  const matched = scaleMatched(ref);

  /** A number that writes its own change into every member of the selection. */
  const spread = (
    label: string,
    value: number,
    step: number,
    axis: (box: ElementBox, delta: number) => ElementBox
  ): HTMLElement => {
    let last = value;
    return numberField(label, value, step, (v) => {
      const delta = v - last;
      last = v;
      if (delta === 0) return;
      writeBoxes(selectedBoxes().map((box) => axis(box, delta)));
      draw();
    }).el;
  };

  // One row per quantity: its name once, then the numbers beside X and Y.
  const prow = (caption: string, key: string, ...controls: HTMLElement[]): HTMLElement => {
    const row = el("div", "prow");
    row.dataset.row = key;
    row.append(el("span", "cap", caption), ...controls);
    return row;
  };

  if (many) {
    body.append(el("div", "note", `${selection.length} emblems selected. Numbers move all of them.`));
    body.append(
      prow(
        "Position",
        "position",
        spread("X", inst.position[0], 0.01, (b, d) => ({ ...b, cx: b.cx + d })),
        spread("Y", inst.position[1], 0.01, (b, d) => ({ ...b, cy: b.cy + d }))
      ),
      prow(
        "Scale",
        "scale",
        spread("X", inst.scale[0], 0.01, (b, d) => ({ ...b, w: b.w + Math.sign(b.w || 1) * d })),
        spread("Y", inst.scale[1], 0.01, (b, d) => ({ ...b, h: b.h + Math.sign(b.h || 1) * d }))
      ),
      prow(
        "Rotation",
        "rotation",
        spread("°", inst.rotation, 1, (b, d) => ({ ...b, rotation: b.rotation + d }))
      ),
      selectionTools()
    );
    return body;
  }

  const position = prow(
    "Position",
    "position",
    numberField("X", inst.position[0], 0.01, (v) => {
      inst.position[0] = v;
      draw();
    }).el,
    numberField("Y", inst.position[1], 0.01, (v) => {
      inst.position[1] = v;
      draw();
    }).el
  );

  const y = numberField("Y", inst.scale[1], 0.01, (v) => {
    inst.scale[1] = v;
    if (scaleMatched(ref)) inst.scale[0] = Math.sign(inst.scale[0] || 1) * Math.abs(v);
    draw();
    if (scaleMatched(ref)) renderPanel();
  });
  const x = numberField("X", inst.scale[0], 0.01, (v) => {
    inst.scale[0] = v;
    if (scaleMatched(ref)) {
      inst.scale[1] = Math.sign(inst.scale[1] || 1) * Math.abs(v);
      y.input.value = String(inst.scale[1]);
    }
    draw();
  });
  // The lock stands between the two numbers it ties together, the way a
  // graphics editor draws it; a flip is the mirror tool below, so no checkbox
  // repeats it here.
  const lock = iconButton(
    matched ? "lock" : "unlock",
    matched ? "X and Y scale move together" : "X and Y scale move apart",
    () => {
      const key = matchKeyOf(ref);
      if (matched) unmatchedScale.add(key);
      else {
        unmatchedScale.delete(key);
        inst.scale[0] = Math.sign(inst.scale[0] || 1) * Math.abs(inst.scale[1]);
      }
      refresh();
    }
  );
  lock.id = "scaleLock";
  lock.dataset.variant = "outline";
  lock.dataset.size = "icon-sm";
  lock.setAttribute("aria-pressed", String(matched));
  const scale = prow("Scale", "scale", x.el, lock, y.el);

  const rest = prow(
    "Rotation",
    "rotation",
    numberField("°", inst.rotation, 1, (v) => {
      inst.rotation = v;
      draw();
    }).el,
    el("span", "cap", "Depth"),
    numberField("", inst.depth ?? 0, 0.01, (v) => {
      // 0 is what an instance with no `depth` means, so writing 0 drops the key.
      if (v === 0) delete inst.depth;
      else inst.depth = v;
    }).el
  );

  body.append(position, scale, rest, selectionTools());
  return body;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function renderPanel(): void {
  // Adjusted mode keeps the opened design's structure, so a whole new layout
  // is not on offer there; the Background tab carries the way back to custom.
  if (mode === "adjusted" && tab === "layout") tab = "background";
  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".px-tab"))) {
    const on = btn.dataset.tab === tab;
    btn.setAttribute("aria-selected", String(on));
    if (btn.dataset.tab === "layout") {
      btn.disabled = mode === "adjusted";
      btn.dataset.tip = btn.disabled ? "Layouts need Customize Design (Background tab)" : "";
    }
  }
  for (const [id, name] of [
    ["tabBackground", "background"],
    ["tabLayout", "layout"],
    ["tabEmblems", "emblems"],
  ] as const) {
    if (name === tab) $(id).setAttribute("data-active", "");
    else $(id).removeAttribute("data-active");
  }
  if (tab === "background") renderBackground();
  else if (tab === "layout") renderLayout();
  else renderEmblems();
  // The left panel is always on screen, so it is drawn whichever tab is up.
  renderPlacement();
}

function refresh(record = true): void {
  clampSelection();
  renderPanel();
  draw();
  updateOrigin();
  if (record) commit();
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * An emblem color written as a reference (`color1 = color2`: the game's blank
 * template, and a third of the vanilla emblems) becomes the flag color it
 * names. The game's own designer holds concrete colors only: a definition
 * pasted into it with a reference came out in the fallback red, not in the
 * color the panel showed. Resolved here, the panel shows and writes what the
 * game draws, and this is the form the game's own Copy writes too.
 */
function concreteColors(next: CoaFlag): void {
  for (const layer of next.layers) {
    if (layer.kind !== "colored_emblem") continue;
    layer.colors = layer.colors.map((c) => {
      if (c.kind !== "ref") return c;
      const base = next.colors.find((b) => b.name === c.value);
      return base && base.kind !== "ref" ? { ...base, name: c.name } : c;
    });
  }
}

function setFlag(next: CoaFlag): void {
  flag = JSON.parse(JSON.stringify(next));
  concreteColors(flag);
  $<HTMLInputElement>("name").value = flag.name;
  layerIndex = emblemLayers()[0]?.index ?? -1;
  instIndex = 0;
  selection = [];
  locked.clear();
  unmatchedScale.clear();
  emblemCategory = "";
  resetHistory();
}

/** "Start From Scratch": the game's own `coa_designer_blank_default`. */
function startFromScratch(): void {
  const template = designer()?.template;
  const name = target?.name ?? flag.name;
  setFlag(
    template
      ? { ...JSON.parse(JSON.stringify(template)), name }
      : { name, pattern: "", colors: [], layers: [] }
  );
  mode = "custom";
  opened = null;
  tab = "background";
  refresh(false);
}

function updateOrigin(): void {
  const label = target?.label ? `for ${target.label}` : "";
  const from = opened ? `from ${opened.source}` : "";
  $("target").textContent = [label, from].filter(Boolean).join(" · ");
}

function applyTarget(next: FlagTarget): void {
  target = next;
  if (!db) return;
  const action = targetAction(next.name, db.flags);
  if (action.kind === "new") {
    flag.name = next.name;
    $<HTMLInputElement>("name").value = next.name;
    resetHistory();
    updateOrigin();
    return;
  }
  const definition = db.definitions[action.entry.name];
  if (!definition) return;
  opened = action.entry;
  setFlag(definition);
  mode = "adjusted";
  refresh(false);
}

// ---------------------------------------------------------------------------
// The library: designs stored as script files outside any mod
// ---------------------------------------------------------------------------

/** Long enough for a Documents path, short enough not to stretch a tooltip. */
const LIBRARY_PATH_CHARS = 62;

/**
 * The library row's tooltips. Until px.coaLibraryDir is set the folder is one
 * the panel picked, so Library and Save say where a design would land and which
 * button changes it: a modder should not have to open the settings to find out.
 */
function updateLibraryButtons(library: LibraryState): void {
  const dir = middleEllipsis(library.dir, LIBRARY_PATH_CHARS);
  const unchosen = dir
    ? `No library folder chosen yet: the folder button picks one. Until then designs go to ${dir}.`
    : "No library folder chosen yet: the folder button picks one.";
  $("libImport").dataset.tip = library.chosen ? "Open a design from your library" : unchosen;
  $("libExport").dataset.tip = library.chosen
    ? "Save this design to your library, outside any mod"
    : unchosen;
  $("libDir").dataset.tip = library.chosen
    ? `Library folder: ${dir}. Click to change it.`
    : "Choose the library folder (px.coaLibraryDir). None chosen yet.";
}

/** The one overlay the page opens itself, closed by Escape, the backdrop or a pick. */
function overlay(title: string, body: HTMLElement, onClose?: () => void): () => void {
  const backdrop = el("div", "px-dialog-backdrop");
  const dialog = el("div", "px-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.style.maxWidth = "560px";
  dialog.append(el("div", "px-dialog-title", title), body);
  let done = false;
  const close = (): void => {
    if (done) return;
    done = true;
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    onClose?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    close();
  };
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  document.addEventListener("keydown", onKey, true);
  backdrop.append(dialog);
  document.body.append(backdrop);
  return close;
}

/** The library, as the previews it actually holds; picking one loads it. */
function showLibrary(dir: string, items: LibraryItem[]): void {
  if (!items.length) {
    const body = el("div", "libEmpty");
    body.append(
      el("div", "px-dialog-description", "Nothing here yet. Export a design and it lands in:"),
      el("div", "note libPath", dir)
    );
    overlay("Coat of Arms Library", body);
    return;
  }
  const shelf = el("div");
  shelf.id = "libGrid";
  const made: HTMLElement[] = [];
  let close = (): void => undefined;
  for (const item of items) {
    const wrap = el("div", "libItem");
    const stored = item.flag;
    if (!stored) {
      const broken = el("div", "libBroken", "cannot read");
      broken.dataset.tip = `${item.file} does not hold a coat of arms definition`;
      wrap.append(broken);
    } else {
      const host = makeTile(
        () => stored,
        true,
        item.file,
        () => {
          close();
          loadFromLibrary(stored, item.name);
        }
      );
      wrap.append(host);
      registerTile(host, textureKeys(stored, db?.definitions ?? {}));
      made.push(host);
    }
    wrap.append(el("span", "px-label px-xs", item.name));
    shelf.append(wrap);
  }
  // The tiles are observed by the lazy-thumbnail observer, which outlives the
  // overlay: forget them with the markup rather than leaking a growing map.
  close = overlay("Coat of Arms Library", shelf, () => {
    for (const host of made) {
      tiles.delete(host);
      tileObserver().unobserve(host);
    }
  });
}

/** A library design becomes the current one, named as the library named it. */
function loadFromLibrary(stored: CoaFlag, name: string): void {
  opened = null;
  setFlag({ ...stored, name });
  mode = "custom";
  // It is not in the mod yet, so leaving without a save would lose it.
  loadedDirty = true;
  refresh(false);
  toast(`Loaded ${name} from the library.`);
}

// ---------------------------------------------------------------------------
// Side panels, mod picker and frame
// ---------------------------------------------------------------------------

let uiState: DesignerUiState = {
  panelWidth: 360,
  panelCollapsed: false,
  leftWidth: 280,
  leftCollapsed: false,
};

/**
 * The arms are the point of the panel, so neither column may squeeze the stage
 * past this. Each panel's ceiling is what is left after the other one and the
 * stage have taken theirs, re-read on every clamp (sidePanel takes a function),
 * so a drag stops at the edge instead of snapping back after it.
 */
const MIN_STAGE = 320;

/** What a panel takes from the layout right now, read off the element: 0 while collapsed. */
function panelRoom(el: HTMLElement): number {
  if (el.hasAttribute("data-collapsed")) return 0;
  return parseInt(el.style.getPropertyValue("--px-sidepanel-width"), 10) || 0;
}
// The OTHER panel is read from the DOM rather than held as an object, so the
// two ceilings can refer to each other without one having to exist first.
// clientWidth, not innerWidth: innerWidth counts the scrollbar gutter, which
// the row the panels share does not have.
const roomFor = (otherId: string): number =>
  Math.max(160, document.documentElement.clientWidth - MIN_STAGE - panelRoom($(otherId)));

const left = sidePanel($("left"), {
  min: 200,
  width: uiState.leftWidth,
  max: () => roomFor("side"),
  onChange: (state) => {
    uiState = { ...uiState, leftWidth: state.width, leftCollapsed: state.collapsed };
    send({ type: "uiState", state: uiState });
    updateToggles();
  },
});
const right = sidePanel($("side"), {
  width: uiState.panelWidth,
  max: () => roomFor("left"),
  onChange: (state) => {
    uiState = { ...uiState, panelWidth: state.width, panelCollapsed: state.collapsed };
    send({ type: "uiState", state: uiState });
    updateToggles();
  },
});

window.addEventListener("resize", () => {
  left.reclamp();
  right.reclamp();
  draw();
});

function updateToggles(): void {
  const set = (id: string, p: SidePanel, side: "Left" | "Right", what: string): void => {
    const btn = $(id);
    btn.replaceChildren(iconEl(p.collapsed ? `panel${side}Open` : `panel${side}Close`));
    btn.dataset.tip = `${p.collapsed ? "Show" : "Hide"} ${what}`;
  };
  set("toggleLeft", left, "Left", "the tools");
  set("toggleRight", right, "Right", "the catalog");
}

function saveTarget(): ModTarget | undefined {
  return mods.find((m) => m.path === uiState.savePath) ?? mods[0];
}

/**
 * "Saves to <mod> > common/coat_of_arms/coat_of_arms/<file>", in the top bar
 * from the moment the panel opens: where a definition lands is not a question
 * to spring on a modder at save time.
 */
const targetLine = saveTargetLine(() => send({ type: "changeTarget" }));
$("targetLine").append(targetLine.el);
targetLine.set(null);

const MOD_PATH_CHARS = 62;

function updateModPicker(): void {
  const btn = $("mod");
  const target = saveTarget();
  btn.querySelector(".px-truncate")!.textContent = target ? target.label : "No mod";
  btn.dataset.tip = target ? `Saves into ${target.path}` : "Open a mod folder to save arms into it";
  (btn as HTMLButtonElement).disabled = mods.length === 0;
}

function openModMenu(): void {
  menu(
    $("mod"),
    mods.map((m) => ({
      value: m.path,
      label: m.label,
      description: middleEllipsis(m.path, MOD_PATH_CHARS),
    })),
    {
      value: saveTarget()?.path,
      width: 420,
      onPick: (value) => {
        uiState = { ...uiState, savePath: value };
        send({ type: "uiState", state: uiState });
        updateModPicker();
      },
    }
  );
}

const FRAME_TIP = "Preview frame (never written into the script)";

/**
 * The button says the frame's plain name, because the button is narrow and
 * shares its row with the tier. Who wears the frame is the tooltip's job, and
 * every heritage is listed there: the menu's hint only has room for two.
 */
function updateFramePicker(): void {
  const cat = designer();
  const frame = frameId ? cat?.frames.find((f) => f.id === frameId) : undefined;
  const btn = $("frame");
  btn.querySelector(".px-truncate")!.textContent = frameId ? (frame?.label ?? frameId) : "No frame";
  const names = frame?.heritageNames ?? [];
  btn.dataset.tip = names.length ? `Worn by the houses of ${listNames(names)} cultures` : FRAME_TIP;
}

/** "a, b and c": the tooltip reads as a sentence, so the last name gets "and". */
function listNames(names: string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function openFrameMenu(): void {
  const cat = designer();
  if (!cat) return;
  menu(
    $("frame"),
    [
      { value: "", label: "No frame" },
      ...cat.frames.map((f) => ({
        value: f.id,
        label: f.label,
        // The filter reads the hint too, so typing a culture's heritage finds
        // the frame its houses wear.
        hint: frameHint(f.heritageNames ?? []),
      })),
    ],
    {
      value: frameId,
      // The name, then the heritages beside it.
      width: 340,
      onPick: (value) => {
        frameId = value;
        uiState = { ...uiState, frame: value };
        send({ type: "uiState", state: uiState });
        updateFramePicker();
        draw();
      },
    }
  );
}

/**
 * The tier picker beside the frame: which cell of a frame sheet is drawn. It
 * only appears for a frame that HAS tiers, so the title pair (one cell) shows
 * nothing rather than a control with one choice.
 */
function updateTierControl(): void {
  const host = $("tier");
  const frame = frameId ? images.get(`frames/${frameId}`) : null;
  const cells = frame ? frameCells(frame) : 1;
  host.hidden = cells < 2;
  if (cells < 2) return;
  const shown = frameCellIndex(cells) + 1;
  host.querySelector(".px-truncate")!.textContent = `Tier ${shown}`;
  host.dataset.tip = `Which of the frame's ${cells} title tiers the preview wears`;
  (host as HTMLButtonElement).onclick = () =>
    menu(
      host,
      Array.from({ length: cells }, (_, i) => ({ value: String(i + 1), label: `Tier ${i + 1}` })),
      {
        value: String(shown),
        width: 140,
        onPick: (value) => {
          frameTier = Number(value);
          uiState = { ...uiState, frameTier };
          send({ type: "uiState", state: uiState });
          draw();
        },
      }
    );
}

/**
 * The grid control: one segmented row, Off and every subdivision side by
 * side, the active one pressed. Every choice is visible at once, and whether
 * the grid is on reads from which segment is lit. Remembered by the host.
 */
function updateGridControls(): void {
  const group = $("gridPick");
  if (group.childElementCount === 0) {
    const segment = (label: string, value: number, tip: string): void => {
      const button = document.createElement("button");
      button.className = "px-toggle";
      button.dataset.variant = "outline";
      button.dataset.size = "sm";
      button.dataset.grid = String(value);
      button.dataset.tip = tip;
      button.dataset.tipWrap = "";
      if (value === 0) button.append(iconEl("grid"));
      button.append(label);
      button.onclick = () => {
        if (value === 0) grid.on = false;
        else {
          grid.on = true;
          grid.div = validGridDivision(value);
        }
        saveGrid();
      };
      group.append(button);
    };
    segment("Off", 0, "No grid: nothing snaps, and an arrow key moves 1/256 of the arms.");
    for (const n of GRID_DIVISIONS) {
      segment(
        String(n),
        n,
        `A ${n} x ${n} grid: placements snap to its cells, and an arrow key moves one cell.`
      );
    }
  }
  for (const button of Array.from(group.querySelectorAll<HTMLButtonElement>("button"))) {
    const value = Number(button.dataset.grid);
    button.setAttribute("aria-pressed", String(grid.on ? value === grid.div : value === 0));
  }
}

function saveGrid(): void {
  uiState = { ...uiState, grid: grid.on, gridDiv: grid.div };
  send({ type: "uiState", state: uiState });
  updateGridControls();
  draw();
}

/**
 * The frame a save target implies, so the preview matches where the arms will
 * show: a dynasty gets the dynasty frame, a house or a character the house one
 * (a character's arms are keyed by their house), anything else the title one.
 * The only signal a target carries is its label, which target.ts builds as
 * `<name> (<kind>)`.
 */
function defaultFrame(label: string | undefined): string {
  const kind = /\(([^)]+)\)\s*$/.exec(label ?? "")?.[1] ?? "";
  const wanted =
    kind === "dynasty" ? "dynasty" : kind === "house" || kind === "character" ? "house" : "title";
  return designer()?.frames.some((f) => f.id === wanted) ? wanted : "";
}

// ---------------------------------------------------------------------------
// Stage view
// ---------------------------------------------------------------------------

const stage = $("stage");
const viewport = $("viewport");
const view = { x: 0, y: 0, scale: 1 };

function applyView(): void {
  viewport.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  $("zoom").textContent = `${Math.round(view.scale * 100)}%`;
  draw();
}

$("recenter").onclick = () => {
  view.x = view.y = 0;
  view.scale = 1;
  applyView();
};
stage.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const next = Math.max(0.1, Math.min(16, view.scale * Math.exp(-e.deltaY * 0.0015)));
    view.x = px - ((px - view.x) * next) / view.scale;
    view.y = py - ((py - view.y) * next) / view.scale;
    view.scale = next;
    applyView();
  },
  { passive: false }
);
stage.addEventListener("pointerdown", (down) => {
  if (down.target instanceof Element && down.target.closest("#stageTools, #stageInfo")) return;
  if (down.button !== 1) return;
  down.preventDefault();
  stage.setPointerCapture(down.pointerId);
  stage.setAttribute("data-panning", "");
  let lastX = down.clientX;
  let lastY = down.clientY;
  const move = (ev: PointerEvent): void => {
    view.x += ev.clientX - lastX;
    view.y += ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    applyView();
  };
  const up = (): void => {
    stage.removeEventListener("pointermove", move);
    stage.removeEventListener("pointerup", up);
    stage.removeAttribute("data-panning");
  };
  stage.addEventListener("pointermove", move);
  stage.addEventListener("pointerup", up);
});

// ---------------------------------------------------------------------------
// Direct manipulation on the canvas (elements.ts)
// ---------------------------------------------------------------------------

function unitAt(e: PointerEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  const arms = armsRect();
  const px = ((e.clientX - r.left) / r.width) * canvas.width;
  const py = ((e.clientY - r.top) / r.height) * canvas.height;
  return [(px - arms.x) / arms.w, (py - arms.y) / arms.h];
}

function handleTolerance(): [number, number] {
  const r = canvas.getBoundingClientRect();
  const arms = armsRect();
  const scale = r.width ? r.width / canvas.width : 1;
  return [HANDLE_SIZE / 2 / (arms.w * scale), HANDLE_SIZE / 2 / (arms.h * scale)];
}

function cornerUnder(u: number, v: number): Corner | null {
  const ref = selection.length === 1 ? selection[0] : null;
  const layer = ref ? flag.layers[ref.layer] : null;
  if (!ref || !layer) return null;
  const [tu, tv] = handleTolerance();
  return cornerAt(boxOf(layer, ref.instance), u, v, tu, tv);
}

/** A corner of the group box, when several elements are selected. */
function groupCornerUnder(u: number, v: number): Corner | null {
  if (selection.length < 2) return null;
  const [tu, tv] = handleTolerance();
  for (const p of groupCorners(selectionBounds(selectedBoxes()))) {
    if (Math.abs(u - p.x) <= tu && Math.abs(v - p.y) <= tv) return p.corner;
  }
  return null;
}

function onRotateGrip(u: number, v: number): boolean {
  if (selection.length < 2) return false;
  const [tu, tv] = handleTolerance();
  const [gx, gy] = rotateGrip(selectionBounds(selectedBoxes()));
  return Math.abs(u - gx) <= tu && Math.abs(v - gy) <= tv;
}

type GestureKind = "move" | "resize" | "groupMove" | "groupScale" | "groupRotate";

interface Gesture {
  kind: GestureKind;
  corner: Corner | null;
  /** The boxes as they stood when the press landed; every frame writes from these. */
  start: ElementBox[];
  /** Pointer minus the moved centre, so a drag does not jump to the cursor. */
  grabU: number;
  grabV: number;
  /** Where the pointer stood on the group's centre, for a rotate. */
  startAngle: number;
  startX: number;
  startY: number;
  started: boolean;
}

let gesture: Gesture | null = null;

/** The pointer, snapped to the grid when the grid is on. */
function snapped(u: number, v: number): [number, number] {
  if (!grid.on) return [u, v];
  return [snapValue(u, grid.div), snapValue(v, grid.div)];
}

function angleTo(centre: readonly [number, number], u: number, v: number): number {
  return (Math.atan2(v - centre[1], u - centre[0]) * 180) / Math.PI;
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const [u, v] = unitAt(e);
  const begin = (kind: GestureKind, corner: Corner | null, grab: [number, number]): void => {
    const boxes = selectedBoxes();
    const centre = rectCentre(selectionBounds(boxes));
    gesture = {
      kind,
      corner,
      start: boxes,
      grabU: grab[0],
      grabV: grab[1],
      startAngle: angleTo(centre, u, v),
      startX: e.clientX,
      startY: e.clientY,
      started: false,
    };
    canvas.setPointerCapture(e.pointerId);
  };

  if (onRotateGrip(u, v)) {
    e.preventDefault();
    begin("groupRotate", null, [0, 0]);
    return;
  }
  const groupCorner = groupCornerUnder(u, v);
  if (groupCorner) {
    e.preventDefault();
    begin("groupScale", groupCorner, [0, 0]);
    return;
  }
  const corner = cornerUnder(u, v);
  if (corner) {
    e.preventDefault();
    const box = boxOf(flag.layers[selection[0].layer], selection[0].instance);
    begin("resize", corner, [u - box.cx, v - box.cy]);
    return;
  }

  const ref = hitUnlocked(u, v);
  if (!ref) {
    // Shift on empty canvas keeps what is selected: an overshot click while
    // building a selection must not throw the selection away.
    if (!e.shiftKey) {
      selection = [];
      renderPanel();
    }
    draw();
    return;
  }
  e.preventDefault();
  // Dragging one member of a selection drags them all; a plain click on
  // anything else makes that the selection.
  const inGroup = isSelected(ref) && selection.length >= 2 && !e.shiftKey;
  if (!inGroup) select(ref, e.shiftKey);
  layerIndex = ref.layer;
  instIndex = ref.instance;
  tab = "emblems";
  renderPanel();
  const anchor = rectCentre(selectionBounds(selectedBoxes()));
  begin(selection.length >= 2 ? "groupMove" : "move", null, [u - anchor[0], v - anchor[1]]);
  draw();
});

canvas.addEventListener("pointermove", (e) => {
  const [u, v] = unitAt(e);
  if (!gesture) {
    const corner = groupCornerUnder(u, v) ?? cornerUnder(u, v);
    canvas.style.cursor = onRotateGrip(u, v)
      ? "grab"
      : corner
        ? cornerCursor(corner)
        : hitUnlocked(u, v)
          ? "move"
          : "";
    return;
  }
  if (!gesture.started) {
    if (Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) < DRAG_THRESHOLD) return;
    gesture.started = true;
    for (const ref of selection) materialize(flag.layers[ref.layer]);
  }
  const start = gesture.start;
  let next: ElementBox[];
  if (gesture.kind === "groupRotate") {
    const centre = rectCentre(selectionBounds(start));
    next = rotateGroup(start, angleTo(centre, u, v) - gesture.startAngle);
  } else if (gesture.kind === "groupScale") {
    const [su, sv] = snapped(u, v);
    next = scaleGroup(start, gesture.corner!, su, sv);
  } else if (gesture.kind === "resize") {
    const [su, sv] = snapped(u, v);
    next = [resizeBox(start[0], gesture.corner!, su, sv)];
  } else {
    const centre = rectCentre(selectionBounds(start));
    next = moveGroup(start, u - gesture.grabU - centre[0], v - gesture.grabV - centre[1]);
    if (grid.on) {
      const to = snapDelta(selectionBounds(next), grid.div, snapTolerance(grid.div));
      next = moveGroup(next, to.du, to.dv);
    }
  }
  writeBoxes(next);
  // Only the numbers follow the pointer. Rebuilding the whole panel on every
  // move redrew the catalog grid (a hundred tiles) per pixel, which read as
  // the selector reloading and made the drag lag; the panel is rebuilt once
  // when the gesture ends.
  renderPlacement();
  draw();
});

const endGesture = (e: PointerEvent): void => {
  if (!gesture) return;
  const moved = gesture.started;
  gesture = null;
  canvas.releasePointerCapture(e.pointerId);
  if (moved) {
    commit();
    renderPanel();
  }
};
canvas.addEventListener("pointerup", endGesture);
canvas.addEventListener("pointercancel", endGesture);

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

for (const btn of Array.from(document.querySelectorAll<HTMLElement>(".px-tab"))) {
  btn.onclick = () => {
    tab = (btn.dataset.tab as DesignerTab) ?? "background";
    uiState = { ...uiState, tab };
    send({ type: "uiState", state: uiState });
    renderPanel();
  };
}

$("new").onclick = async () => {
  if (await confirmDiscard("Starting from scratch")) startFromScratch();
};
$("open").onclick = async () => {
  if (!db) return;
  if (await confirmDiscard("Opening a design")) send({ type: "open" });
};
$("paste").onclick = () => send({ type: "paste" });
$("copy").onclick = () => send({ type: "copy", text: writeFlag(flag) });
$("undo").onclick = undo;
$("redo").onclick = redo;
$("mod").onclick = openModMenu;
$("frame").onclick = openFrameMenu;
$("toggleLeft").onclick = () => left.toggle();
$("toggleRight").onclick = () => right.toggle();
$("libImport").onclick = async () => {
  if (await confirmDiscard("Importing a design")) send({ type: "libraryList" });
};
$("libDir").onclick = () => send({ type: "libraryDir" });
$("libExport").onclick = () => {
  if (!flag.name.trim()) {
    toast("Give the arms a name first.", "destructive");
    return;
  }
  send({ type: "libraryExport", name: flag.name.trim(), script: writeFlag(flag) });
};
$("addEmblem").onclick = () => {
  const cat = designer();
  const empty = cat?.emptyEmblem;
  const start = cat?.emblems.find((e) => e.colors > 0);
  const texture = start?.file ?? empty ?? "";
  const slots = start?.colors ?? 1;
  flag.layers.push({
    kind: "colored_emblem",
    texture,
    mask: 0,
    colors: COLOR_SLOTS.slice(0, slots).map((name) => ({
      name,
      kind: "named",
      value: flag.colors[1]?.kind === "named" ? flag.colors[1].value : "white",
    })),
    instances: [{ ...DEFAULT_INSTANCE, scale: [0.7, 0.7] }],
  });
  layerIndex = flag.layers.length - 1;
  instIndex = 0;
  tab = "emblems";
  refresh();
};
$("save").onclick = () => {
  const target = saveTarget();
  if (!target) return;
  if (!flag.name.trim()) {
    toast("Give the arms a name first.", "destructive");
    return;
  }
  send({ type: "save", name: flag.name.trim(), script: writeFlag(flag), modPath: target.path });
};
$("png").onclick = () => {
  draw(false);
  const dataUrl = canvas.toDataURL("image/png");
  draw();
  send({ type: "exportPng", name: flag.name, dataUrl });
};

/**
 * What "Adjust Existing Design" lands on. The picking itself is the host's
 * QuickPick (messages.ts `open`): the list is every definition the game and the
 * mods ship, thousands of rows, which is a size VS Code's picker handles and an
 * in-page list does not.
 */
function openDefinition(entry: FlagEntry, definition: CoaFlag): void {
  opened = entry;
  setFlag(definition);
  mode = "adjusted";
  tab = "background";
  refresh(false);
}

const nameInput = $<HTMLInputElement>("name");
nameInput.oninput = () => {
  flag.name = nameInput.value.replace(/[^\w.-]/g, "_");
};
nameInput.onchange = commit;

/** Which way each arrow moves; how far is nudgeStep (groups.ts). */
const NUDGE_ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

document.addEventListener("keydown", (e) => {
  const editing = (e.target as HTMLElement).tagName === "INPUT";
  if (e.key === "Escape" && selection.length) {
    selection = [];
    renderPanel();
    draw();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !editing) {
    if (e.key === "z" && !e.shiftKey) undo();
    else if (e.key === "y" || (e.key === "z" && e.shiftKey)) redo();
    else if (e.key === "a") {
      selectMany(allElements());
      renderPanel();
      draw();
    } else return;
    e.preventDefault();
    return;
  }
  if ((e.key === "Delete" || e.key === "Backspace") && !editing && selection.length) {
    e.preventDefault();
    removeSelection();
    return;
  }
  const arrow = NUDGE_ARROWS[e.key];
  if (arrow && !editing && selection.length) {
    e.preventDefault();
    const step = nudgeStep(grid.on, grid.div, e.shiftKey);
    nudgeSelection(arrow[0] * step, arrow[1] * step);
  }
});

$("help").onclick = () =>
  helpDialog({
    title: "Coat of Arms Designer",
    intro:
      "The game's own Coat of Arms designer, over your mod's files. Everything it offers is read from the game: the patterns, the palette, the layouts and the 1500-odd emblems. Save writes a real coat_of_arms definition into your mod.",
    sections: [
      {
        title: "Starting",
        items: [
          {
            lead: "Start From Scratch",
            text: "gives you the game's blank template: a solid pattern and one emblem.",
          },
          {
            lead: "Adjust Existing Design",
            text: "opens any coat of arms the game or a mod ships. Its structure stays put and you change colors and placement; Customize Design unlocks the rest.",
          },
          { lead: "Paste from Clipboard", text: "reads a definition straight out of the clipboard." },
          {
            lead: "Import…",
            text: "shows the designs you exported, as pictures. Picking one loads it, unsaved, under the name it was stored with.",
          },
          {
            lead: "Export",
            text: "stores this design as <name>.txt in your library folder, outside any mod. The file holds exactly what Copy puts on the clipboard, so it pastes into a mod as it stands. Set the folder with px.coaLibraryDir.",
          },
        ],
      },
      {
        title: "The three tabs (right)",
        items: [
          {
            lead: "Background",
            text: "picks the pattern and its colors. How many color buttons you get is what the pattern declares.",
          },
          {
            lead: "Layout",
            text: "places your emblems in one of the game's arrangements: the pattern and colors stay, the emblems move.",
          },
          {
            lead: "Emblems",
            text: "picks the shape by category and its colors. Drag the rows to change which emblem is drawn on top.",
          },
        ],
      },
      {
        title: "Placement (left)",
        items: [
          {
            lead: "On the canvas:",
            text: "click an emblem to select it, drag to move it, drag a corner to resize it.",
          },
          {
            lead: "Several at once:",
            text: "shift-click adds and removes, Ctrl+A takes everything unlocked, Esc clears. With more than one selected the dashed box moves, scales and turns them together, and the numbers write the same change into all of them.",
          },
          {
            lead: "The tools under the numbers",
            text: "align, distribute, mirror and duplicate the selection. One emblem lines up against the arms, several against the box they share.",
          },
          {
            lead: "Lock a row",
            text: "in the emblem list and nothing on the canvas can select or move it.",
          },
          {
            lead: "The grid",
            text: "on the left snaps positions and edges to its lines and to the centre, so centring an emblem is one drag. It also sets the arrow keys: one press is one cell, Shift is four. With the grid off an arrow moves 1/256 of the arms and Shift 1/32.",
          },
          {
            lead: "By numbers:",
            text: "position and scale are fractions of the arms, rotation is degrees. Drag a number's LABEL sideways to scrub it; the box itself is for typing.",
          },
          { lead: "Flip X or Y", text: "mirrors the emblem, which the game writes as a negative scale." },
          {
            lead: "Depth",
            text: "is the z value the in-game designer writes. It is kept so a design round-trips; the preview draws in row order.",
          },
        ],
      },
      {
        title: "Preview and saving",
        items: [
          {
            lead: "The frame",
            text: "on the left shows the arms the way the game frames a dynasty, a house or a title: a smaller square inside the frame, and on the title shield shrunk and moved down a little more, as the game's gui does. The band between that square and the frame is the arms' edge stretched, which is what the game shows there too; an emblem across the edge streaks. The grid's border, or the dashed line with the grid off, is the edge. The frame is preview only and never written.",
          },
          {
            lead: "The tier",
            text: "beside it picks which of a frame's six title ranks the preview wears. A house or dynasty frame is one sheet of six; the title frame has one.",
          },
          {
            lead: "The top bar",
            text: "says which mod and which file the next Save writes into. Click it to write somewhere else.",
          },
          { lead: "Saving under a vanilla key", text: "overrides those arms; a new key adds new arms." },
        ],
      },
      {
        title: "Keyboard",
        shortcuts: [
          { keys: ["Shift", "Click"], does: "Add or remove one emblem from the selection" },
          { keys: ["Ctrl", "A"], does: "Select every unlocked emblem" },
          { keys: ["Esc"], does: "Clear the selection" },
          { keys: ["Del"], does: "Remove the selected placements (Backspace too)" },
          { keys: ["←↑→↓"], does: "Nudge one grid cell, Shift four (grid off: 1/256 and 1/32)" },
          { keys: ["Ctrl", "Z"], does: "Undo" },
          { keys: ["Ctrl", "Y"], does: "Redo (Ctrl+Shift+Z too)" },
        ],
      },
    ],
  });

window.addEventListener("message", (event: MessageEvent<HostToApp>) => {
  const m = event.data;
  switch (m.type) {
    case "init": {
      const first = db === null;
      db = m.db;
      mods = m.mods;
      const cat = m.db.designer;
      $("info").dataset.tip =
        `${db.gameName}: ${db.flags.length} coats of arms` +
        (cat
          ? `, ${cat.patterns.length} patterns, ${cat.emblems.length} emblems in ${cat.categories.length} categories, ${cat.layouts.length} layouts`
          : "") +
        (db.gameMissing ? "\nGame folder not found: set px.gamePath." : "");
      images.clear();
      thumbs.clear();
      clearRenderCaches();
      if (first) {
        if (m.ui) {
          uiState = { ...uiState, ...m.ui };
          right.setWidth(m.ui.panelWidth);
          right.toggle(m.ui.panelCollapsed);
          if (m.ui.leftWidth !== undefined) left.setWidth(m.ui.leftWidth);
          left.toggle(m.ui.leftCollapsed ?? false);
          if (m.ui.tab) tab = m.ui.tab;
          frameId = m.ui.frame ?? "";
          frameTier = m.ui.frameTier ?? frameTier;
          grid.on = m.ui.grid ?? grid.on;
          if (m.ui.gridDiv !== undefined) grid.div = validGridDivision(m.ui.gridDiv);
        }
        updateToggles();
        startFromScratch();
      }
      // A remembered frame wins; otherwise the target says what these arms are.
      if (m.ui?.frame === undefined) frameId = defaultFrame(m.target?.label);
      updateModPicker();
      updateFramePicker();
      updateGridControls();
      updateLibraryButtons(m.library);
      applyView();
      if (m.target) applyTarget(m.target);
      else refresh(false);
      return;
    }
    case "textures":
      receiveTextures(m.urls, m.thumbs);
      return;
    case "frames":
      if (db?.designer) db.designer.frames = m.frames;
      updateFramePicker();
      return;
    case "target":
      targetLine.set(m.target);
      return;
    case "opened":
      openDefinition(m.entry, m.flag);
      return;
    case "library":
      showLibrary(m.dir, m.items);
      return;
    case "libraryDir":
      updateLibraryButtons({ dir: m.dir, chosen: m.chosen });
      return;
    case "pasted":
      void (async () => {
        if (!(await confirmDiscard(`Pasting ${m.flag.name}`))) return;
        opened = null;
        setFlag(m.flag);
        mode = "custom";
        refresh(false);
        toast(`Pasted ${m.flag.name}.`);
      })();
      return;
    case "toast":
      toast(m.message);
      return;
  }
});

send({ type: "ready" });
