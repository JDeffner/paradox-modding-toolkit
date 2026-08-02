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
import { GHOST_OPACITY, type Scene, type SceneItem, type SceneRect } from "./scene";

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
  fontFamily: string
): void {
  if (item.clip && (item.clip.w <= 0 || item.clip.h <= 0)) return;
  ctx.save();
  if (item.clip) {
    ctx.beginPath();
    ctx.rect(item.clip.x, item.clip.y, item.clip.w, item.clip.h);
    ctx.clip();
  }
  ctx.globalAlpha = item.opacity;
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

export interface DrawOptions {
  outlines: boolean;
  /** CSS font stack for widget text (the game font when the host supplied it). */
  fontFamily: string;
  /**
   * The selected widget's clickable rect, in world coordinates (the hit rect,
   * so an unmeasurable widget is marked on the estimate box that is drawn).
   */
  selected?: SceneRect;
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
  for (const item of scene.items) {
    paintItem(ctx, item, images, camera.zoom, options.outlines, options.fontFamily);
  }
  if (options.selected) paintSelection(ctx, options.selected, camera.zoom);
}

/** Drop the tint/cell caches: a fresh layout may re-color the same sprites. */
export function resetImageCache(): void {
  derived.clear();
}
