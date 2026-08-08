/**
 * Canvas2d painter for a built scene. The camera is ONE canvas transform, so
 * every rect is drawn in world (game) coordinates exactly as the engine
 * measured it; nothing here re-derives geometry.
 *
 * Sprite geometry (nine-slice regions, frame-sheet cells) is imported from the
 * engine's own leaf module rather than reimplemented: same numbers, by
 * construction.
 */
import { computeFrameCell, computeNineSlice } from "@px-lsp/server/gui/fillGeometry";
import type { GuiLayoutFill } from "@px-lsp/protocol/protocol";
import { handlePoints, HANDLE_SIZE } from "./gesture";
import { GHOST_OPACITY, type Scene, type SceneItem, type SceneRect } from "./scene";
import type { Guide, SpacingBar } from "./snap";

export interface Camera {
  zoom: number;
  panX: number;
  panY: number;
}

/** Decoded textures by the path the engine reported. */
export type Images = Record<string, HTMLImageElement | undefined>;

/** The game's reference resolution: the layout engine's viewport. */
export const WORLD_W = 1920;
export const WORLD_H = 1080;

const CANVAS_BG = "#101010";
const WORLD_BG = "#181818";
const OUTLINE = "rgba(120,180,255,0.35)";
const GHOST_BOX_STROKE = "#ff9f43";
const SELECT_STROKE = "#4fc1ff";
const SELECT_SHADOW = "rgba(0,0,0,0.65)";
const MARQUEE_FILL = "rgba(79,193,255,0.08)";
const GRID_STROKE = "rgba(255,255,255,0.07)";
const GUIDE_STROKE = "#ff4fd8";
const FLASH_STROKE = "#ffd54f";
/** Green, and not the selection's blue: a drop line is an insertion, not a selection. */
const DROP_STROKE = "#89d185";
/** Solo: everything that is not the isolated subtree, at this alpha. */
const DIM_OPACITY = 0.12;

/** Tinted and cell-cropped source images, keyed by texture + parameters. */
const derived = new Map<string, HTMLCanvasElement>();

function rgba(color: [number, number, number, number] | undefined): string {
  if (!color) return "rgba(255,255,255,1)";
  const [r, g, b, a] = color;
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

/** A colorless tint is the identity multiply; skip the offscreen pass. */
function isTintless(color: [number, number, number, number] | undefined): boolean {
  return !color || (color[0] >= 0.999 && color[1] >= 0.999 && color[2] >= 0.999);
}

function offscreen(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return { canvas, ctx: canvas.getContext("2d")! };
}

/**
 * The source pixels a fill draws from: the frame cell when the texture is a
 * sheet, the whole texture otherwise, multiplied by the fill color when it
 * tints. Cached: a vanilla window re-uses the same sprite dozens of times.
 */
function sourceFor(fill: GuiLayoutFill, img: HTMLImageElement): HTMLCanvasElement | HTMLImageElement {
  const texW = img.naturalWidth || img.width;
  const texH = img.naturalHeight || img.height;
  const cell = fill.framesize
    ? computeFrameCell(fill.framesize, fill.frame ?? 1, texW, texH)
    : { sx: 0, sy: 0, sw: texW, sh: texH };
  const tint = isTintless(fill.color) ? null : fill.color!;
  if (!fill.framesize && !tint) return img;

  const key = `${fill.texture}|${cell.sx},${cell.sy},${cell.sw},${cell.sh}|${tint ? tint.slice(0, 3).join(",") : ""}`;
  const hit = derived.get(key);
  if (hit) return hit;
  const { canvas, ctx } = offscreen(cell.sw, cell.sh);
  ctx.drawImage(img, cell.sx, cell.sy, cell.sw, cell.sh, 0, 0, canvas.width, canvas.height);
  if (tint) {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = rgba([tint[0], tint[1], tint[2], 1]);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Multiply paints the transparent margin too; mask it back out.
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(img, cell.sx, cell.sy, cell.sw, cell.sh, 0, 0, canvas.width, canvas.height);
  }
  derived.set(key, canvas);
  return canvas;
}

function sizeOf(src: HTMLCanvasElement | HTMLImageElement): { w: number; h: number } {
  return src instanceof HTMLImageElement
    ? { w: src.naturalWidth || src.width, h: src.naturalHeight || src.height }
    : { w: src.width, h: src.height };
}

function tileInto(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement | HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const pattern = ctx.createPattern(src, "repeat");
  if (!pattern) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function paintFill(
  ctx: CanvasRenderingContext2D,
  rect: SceneRect,
  fill: GuiLayoutFill | undefined,
  images: Images
): void {
  if (!fill || rect.w <= 0 || rect.h <= 0) return;
  const img = fill.texture ? images[fill.texture] : undefined;
  if (!img) {
    if (!fill.color) return;
    ctx.save();
    ctx.fillStyle = rgba(fill.color);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
    return;
  }
  const src = sourceFor(fill, img);
  const { w: sw, h: sh } = sizeOf(src);
  if (sw <= 0 || sh <= 0) return;
  ctx.save();
  ctx.globalAlpha *= fill.color?.[3] ?? 1;
  const mode = fill.mode ?? "stretch";
  if (fill.border && mode.startsWith("nineslice")) {
    // Corners 1:1, edges and centre stretched or tiled per the suffix
    // (the border applies only with a Cornered* sprite type, which the
    // engine already decided when it set `mode`).
    const tiled = mode === "nineslice-tile";
    for (const r of computeNineSlice(rect, fill.border, sw, sh)) {
      if (tiled && (r.dw > r.sw || r.dh > r.sh)) {
        const cellSrc = cellCanvas(src, fill.texture ?? "", r.sx, r.sy, r.sw, r.sh);
        tileInto(ctx, cellSrc, r.dx, r.dy, r.dw, r.dh);
      } else {
        ctx.drawImage(src, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
      }
    }
  } else if (mode === "tile") {
    tileInto(ctx, src, rect.x, rect.y, rect.w, rect.h);
  } else {
    ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
}

/** One nine-slice region as its own image, so it can be used as a tile pattern. */
function cellCanvas(
  src: HTMLCanvasElement | HTMLImageElement,
  texture: string,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): HTMLCanvasElement {
  const key = `tile|${texture}|${sx},${sy},${sw},${sh}`;
  const hit = derived.get(key);
  if (hit) return hit;
  const { canvas, ctx } = offscreen(sw, sh);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  derived.set(key, canvas);
  return canvas;
}

function paintItem(
  ctx: CanvasRenderingContext2D,
  item: SceneItem,
  images: Images,
  zoom: number,
  outlines: boolean,
  fontFamily: string,
  alpha: number
): void {
  if (item.clip && (item.clip.w <= 0 || item.clip.h <= 0)) return;
  ctx.save();
  if (item.clip) {
    ctx.beginPath();
    ctx.rect(item.clip.x, item.clip.y, item.clip.w, item.clip.h);
    ctx.clip();
  }
  ctx.globalAlpha = item.opacity * alpha;
  paintFill(ctx, item.rect, item.bg, images);
  paintFill(ctx, item.rect, item.fill, images);

  if (item.textLines.length > 0) {
    ctx.save();
    ctx.textBaseline = "top";
    ctx.fillStyle = item.text?.color ? rgba(item.text.color) : "#e3dac3";
    for (const line of item.textLines) {
      ctx.font = `${line.fontsize}px ${fontFamily}`;
      ctx.fillText(line.text, line.x, line.y);
    }
    ctx.restore();
  }

  if (item.ghostBox) {
    // L11b: content the engine could not measure. Dashed and dimmed so it
    // never reads as real pixels.
    ctx.save();
    ctx.globalAlpha = GHOST_OPACITY;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeStyle = GHOST_BOX_STROKE;
    ctx.strokeRect(item.ghostBox.x, item.ghostBox.y, item.ghostBox.w, item.ghostBox.h);
    ctx.restore();
  }

  if (outlines && item.rect.w > 0 && item.rect.h > 0) {
    ctx.save();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(item.rect.x, item.rect.y, item.rect.w, item.rect.h);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * A gesture in progress, drawn WITHOUT re-laying anything out: the dragged
 * widget's subtree is painted through one extra translate and everything else
 * stays where the engine put it.
 *
 * That is the whole preview, deliberately. A move really does translate the
 * subtree (every placement rule under it is an additive offset), so this
 * preview is exact. A resize does not: the children would reflow, and only the
 * engine knows how, so a resize previews its own marquee and nothing else
 * pretends to know what the inside will look like until the server answers.
 */
export interface DrawPreview {
  /**
   * Draw-list slices of the moving subtrees, `[from, to)` each, ASCENDING and
   * disjoint (a multi-selection drops any member inside another). Sorted so the
   * painter walks them alongside the draw list instead of testing every item
   * against every slice.
   */
  slices: readonly { from: number; to: number }[];
  dx: number;
  dy: number;
}

/**
 * The layers panel's eye and lock, and the tree's subtree focus, as two masks
 * over the draw list. Both are computed once per change, never per frame: a
 * gesture repaints at 60 Hz and must allocate nothing to do it.
 */
export interface DrawMasks {
  /** 1 = not painted at all: hidden by the eye, or outside the focused subtree. */
  hidden: Uint8Array | null;
  /** 1 = painted dimmed: solo is on somewhere else. */
  dim: Uint8Array | null;
}

/** A live geometry readout, anchored at a world point and drawn at screen size. */
export interface DrawReadout {
  x: number;
  y: number;
  text: string;
}

export interface DrawOptions {
  outlines: boolean;
  /** CSS font stack for widget text (the game font when the host supplied it). */
  fontFamily: string;
  /**
   * The selected widget's clickable rect, in world coordinates (the hit rect,
   * so an unmeasurable widget is marked on the estimate box that is drawn);
   * during a gesture, the rect the gesture would commit.
   */
  selected?: SceneRect;
  /**
   * The other members of a multi-selection: marked like the primary but never
   * given handles, because a resize grip belongs to one widget's own rect.
   */
  others?: readonly SceneRect[];
  /** Draw resize handles on `selected` (a widget with a declaration to write to). */
  handles?: boolean;
  /** The rubber band of a marquee drag, in world coordinates. */
  marquee?: SceneRect;
  preview?: DrawPreview;
  masks?: DrawMasks;
  /** World grid step; 0 or absent draws no grid. */
  grid?: number;
  /** Smart guides the current gesture snapped to. */
  guides?: readonly Guide[];
  /** Equal-spacing bars for the gaps the gesture equalised. */
  bars?: readonly SpacingBar[];
  /** A hovered layers row's outline, flashed so the row and the rect find each other. */
  flash?: SceneRect;
  /** Where a box reorder would drop the dragged widget. */
  dropLine?: Guide;
  readout?: DrawReadout;
}

/**
 * The selection marquee, drawn over the finished scene so no later widget can
 * paint on top of it. Two strokes: a dark one for contrast against a bright
 * sprite, the accent over it. Widths divide by zoom, so the marquee is one
 * screen pixel at every zoom instead of growing with the world.
 */
function paintSelection(ctx: CanvasRenderingContext2D, rect: SceneRect, zoom: number): void {
  ctx.save();
  ctx.lineWidth = 3 / zoom;
  ctx.strokeStyle = SELECT_SHADOW;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.lineWidth = 1.5 / zoom;
  ctx.strokeStyle = SELECT_STROKE;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

/**
 * The eight resize grips, screen-sized at every zoom like the marquee. Drawn
 * only on a widget with a declaration in this file: a grip on something that
 * cannot be written to would promise an edit the writer refuses.
 */
function paintHandles(ctx: CanvasRenderingContext2D, rect: SceneRect, zoom: number): void {
  const side = HANDLE_SIZE / zoom;
  ctx.save();
  ctx.lineWidth = 1 / zoom;
  ctx.strokeStyle = SELECT_SHADOW;
  ctx.fillStyle = SELECT_STROKE;
  for (const point of handlePoints(rect)) {
    const x = point.x - side / 2;
    const y = point.y - side / 2;
    ctx.fillRect(x, y, side, side);
    ctx.strokeRect(x, y, side, side);
  }
  ctx.restore();
}

/**
 * The marquee's rubber band: a dashed outline over a barely-there wash, so the
 * widgets it is about to catch stay readable underneath it.
 */
function paintMarquee(ctx: CanvasRenderingContext2D, rect: SceneRect, zoom: number): void {
  ctx.save();
  ctx.fillStyle = MARQUEE_FILL;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.setLineDash([4 / zoom, 3 / zoom]);
  ctx.lineWidth = 1 / zoom;
  ctx.strokeStyle = SELECT_STROKE;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

/** The grid, drawn under the scene as one path so the step costs one stroke. */
function paintGrid(ctx: CanvasRenderingContext2D, step: number, zoom: number): void {
  if (step <= 0 || step * zoom < 4) return;
  ctx.save();
  ctx.beginPath();
  for (let x = step; x < WORLD_W; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD_H);
  }
  for (let y = step; y < WORLD_H; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD_W, y);
  }
  ctx.lineWidth = 1 / zoom;
  ctx.strokeStyle = GRID_STROKE;
  ctx.stroke();
  ctx.restore();
}

/** One smart guide, one screen pixel wide at any zoom, like the marquee. */
function paintGuides(
  ctx: CanvasRenderingContext2D,
  guides: readonly Guide[],
  zoom: number,
  color: string,
  dash: boolean
): void {
  if (guides.length === 0) return;
  ctx.save();
  ctx.beginPath();
  for (const guide of guides) {
    if (guide.axis === "x") {
      ctx.moveTo(guide.at, guide.start);
      ctx.lineTo(guide.at, guide.end);
    } else {
      ctx.moveTo(guide.start, guide.at);
      ctx.lineTo(guide.end, guide.at);
    }
  }
  if (dash) ctx.setLineDash([5 / zoom, 3 / zoom]);
  ctx.lineWidth = 1 / zoom;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

/** The two equal gaps, as segments with end ticks so a gap reads as a measure. */
function paintBars(ctx: CanvasRenderingContext2D, bars: readonly SpacingBar[], zoom: number): void {
  if (bars.length === 0) return;
  const tick = 4 / zoom;
  ctx.save();
  ctx.beginPath();
  for (const bar of bars) {
    if (bar.axis === "x") {
      ctx.moveTo(bar.start, bar.on);
      ctx.lineTo(bar.end, bar.on);
      ctx.moveTo(bar.start, bar.on - tick);
      ctx.lineTo(bar.start, bar.on + tick);
      ctx.moveTo(bar.end, bar.on - tick);
      ctx.lineTo(bar.end, bar.on + tick);
    } else {
      ctx.moveTo(bar.on, bar.start);
      ctx.lineTo(bar.on, bar.end);
      ctx.moveTo(bar.on - tick, bar.start);
      ctx.lineTo(bar.on + tick, bar.start);
      ctx.moveTo(bar.on - tick, bar.end);
      ctx.lineTo(bar.on + tick, bar.end);
    }
  }
  ctx.lineWidth = 1 / zoom;
  ctx.strokeStyle = GUIDE_STROKE;
  ctx.stroke();
  ctx.restore();
}

/**
 * The live geometry readout, drawn in SCREEN space: it is a label about the
 * gesture, not a thing in the world, so it stays the same size at every zoom
 * and never ends up subpixel over a widget the user is trying to place.
 */
function paintReadout(ctx: CanvasRenderingContext2D, readout: DrawReadout, camera: Camera): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = "11px var(--vscode-editor-font-family, monospace), monospace";
  ctx.textBaseline = "top";
  const padding = 4;
  const width = ctx.measureText(readout.text).width + padding * 2;
  const height = 16;
  const x = readout.x * camera.zoom + camera.panX;
  // Above the rect when there is room, inside it when there is not.
  const y = readout.y * camera.zoom + camera.panY - height - 3;
  const top = y < 0 ? y + height + 6 : y;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(x, top, width, height);
  ctx.fillStyle = SELECT_STROKE;
  ctx.fillText(readout.text, x + padding, top + 3);
  ctx.restore();
}

/** Repaint the whole canvas: viewport clear, world backdrop, then the scene. */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  images: Images,
  camera: Camera,
  viewport: { w: number; h: number },
  options: DrawOptions
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, viewport.w, viewport.h);
  ctx.setTransform(camera.zoom, 0, 0, camera.zoom, camera.panX, camera.panY);
  ctx.fillStyle = WORLD_BG;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  if (options.grid) paintGrid(ctx, options.grid, camera.zoom);
  const preview = options.preview;
  const shifted = preview && (preview.dx !== 0 || preview.dy !== 0);
  const slices = preview?.slices ?? [];
  let slice = 0;
  const hidden = options.masks?.hidden ?? null;
  const dim = options.masks?.dim ?? null;
  for (let i = 0; i < scene.items.length; i++) {
    // The slices are ascending, so one pointer walks them with the draw list.
    while (slice < slices.length && i >= slices[slice].to) slice++;
    const inPreview = slice < slices.length && i >= slices[slice].from;
    if (hidden?.[i]) continue;
    const alpha = dim?.[i] ? DIM_OPACITY : 1;
    if (shifted && inPreview) {
      ctx.save();
      ctx.translate(preview.dx, preview.dy);
      paintItem(ctx, scene.items[i], images, camera.zoom, options.outlines, options.fontFamily, alpha);
      ctx.restore();
    } else {
      paintItem(ctx, scene.items[i], images, camera.zoom, options.outlines, options.fontFamily, alpha);
    }
  }
  if (options.flash) {
    ctx.save();
    ctx.lineWidth = 2 / camera.zoom;
    ctx.strokeStyle = FLASH_STROKE;
    ctx.strokeRect(options.flash.x, options.flash.y, options.flash.w, options.flash.h);
    ctx.restore();
  }
  if (options.guides) paintGuides(ctx, options.guides, camera.zoom, GUIDE_STROKE, false);
  if (options.bars) paintBars(ctx, options.bars, camera.zoom);
  if (options.dropLine) paintGuides(ctx, [options.dropLine], camera.zoom, DROP_STROKE, true);
  if (options.marquee) paintMarquee(ctx, options.marquee, camera.zoom);
  for (const rect of options.others ?? []) paintSelection(ctx, rect, camera.zoom);
  if (options.selected) {
    paintSelection(ctx, options.selected, camera.zoom);
    if (options.handles) paintHandles(ctx, options.selected, camera.zoom);
  }
  if (options.readout) paintReadout(ctx, options.readout, camera);
}

/** Drop the tint/cell caches: a fresh layout may re-color the same sprites. */
export function resetImageCache(): void {
  derived.clear();
}
