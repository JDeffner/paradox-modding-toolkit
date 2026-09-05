/**
 * Flag rendering on a 2D canvas.
 *
 * The game paints a flag as: the pattern texture recolored (its red / yellow /
 * white placeholders become color1..3), then each layer in order. A colored
 * emblem is recolored from its own placeholders (green weighs color2, red
 * color3, blue shades the result), optionally masked to the pixels of the
 * pattern that carry one placeholder (`mask = { n }`); the formulas are the
 * game's own shaders, quoted at `recolor` and `maskCanvas`; a
 * textured emblem is drawn as is; a `sub` draws another flag into a rectangle.
 * Instances place a layer by position (flag fractions), scale and rotation;
 * the rotation happens in the flag's own UV space, so a rotated emblem on a
 * 3:2 flag stretches exactly as the game stretches it.
 *
 * Recolors are per-pixel JS, cached by texture + colors: a 768x512 emblem is
 * ~400k pixels, a few milliseconds, and a flag reuses the same recolor for
 * every instance. Browser code: DOM only.
 */
import {
  colorToRgb,
  DEFAULT_INSTANCE,
  DEFAULT_SUB_INSTANCE,
  type CoaColor,
  type CoaFlag,
  type CoaInstance,
  type Rgb,
} from "@px-lsp/server/coa/coa";

const MAX_SUB_DEPTH = 4;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pixels of the decoded textures; the app fills it from the host's PNGs. */
export interface TextureSource {
  image(key: string): HTMLImageElement | null;
}

export interface RenderContext {
  textures: TextureSource;
  namedColors: Record<string, Rgb>;
  definitions: Record<string, CoaFlag>;
  /** Prefix for the pixel caches: a source serving thumbnails must not share them with full-size decodes. */
  cacheTag?: string;
}

/** The layer's color1..3 by slot; null where the layer declares no such slot. */
type Slots = [Rgb | null, Rgb | null, Rgb | null];

const imageDataCache = new Map<string, ImageData>();
const recolorCache = new Map<string, HTMLCanvasElement>();
const maskCache = new Map<string, HTMLCanvasElement>();

/** Drop every cached pixel buffer (a texture changed on disk, or memory). */
export function clearRenderCaches(): void {
  imageDataCache.clear();
  recolorCache.clear();
  maskCache.clear();
}

function imageData(key: string, img: HTMLImageElement): ImageData {
  const hit = imageDataCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  imageDataCache.set(key, data);
  return data;
}

/**
 * Overlay blend, the game's cw/utility.fxh `Overlay(Base, Blend)`: a base
 * below half darkens the blend, above half lightens it, half leaves it as is.
 */
function overlay(base: number, blend: number): number {
  return base < 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend);
}

/**
 * The game's shaders, per pixel, in [0, 1]:
 *
 *   emblem  (jomini coat_of_arms_textured_emblem.fxh):
 *     c = color1; c = lerp(c, color2, g); c = lerp(c, color3, r); c = overlay(b, c)
 *   pattern (jomini coat_of_arms_pattern.fxh):
 *     c = fallback; c = lerp(c, color1, r); c = lerp(c, color2, g); c = lerp(c, color3, b)
 *
 * so a placeholder's channel is a WEIGHT, not something to match: an
 * anti-aliased edge between two slots blends their colors as the game blends
 * them. A slot the layer does not declare skips its lerp. What the game
 * feeds an undeclared slot is not in its files (its designer offers only the
 * slots the catalog counts); skipping keeps such pixels the color under them,
 * where matching left them the raw placeholder (a magenta rim on a two-color
 * emblem whose edge pixels carry red, ce_religion_taoism.dds).
 */
function recolor(key: string, img: HTMLImageElement, slots: Slots, emblem: boolean): HTMLCanvasElement {
  const cacheKey = `${key}|${emblem ? "e" : "p"}|${slots.map((c) => (c ? c.join(",") : "-")).join(";")}`;
  const hit = recolorCache.get(cacheKey);
  if (hit) return hit;
  if (recolorCache.size > 256) recolorCache.clear();

  const src = imageData(key, img);
  const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  const d = out.data;
  const [c1, c2, c3] = slots;
  const lerp = (c: number[], to: Rgb | null, t: number): void => {
    if (!to || t <= 0) return;
    for (let i = 0; i < 3; i++) c[i] += (to[i] / 255 - c[i]) * t;
  };
  const c = [0, 0, 0];
  for (let o = 0; o < d.length; o += 4) {
    const r = d[o] / 255;
    const g = d[o + 1] / 255;
    const b = d[o + 2] / 255;
    // The raw pixel stands in for the game's fallback and for color1 when
    // undeclared; a declared color1 replaces it outright.
    for (let i = 0; i < 3; i++) c[i] = c1 ? c1[i] / 255 : d[o + i] / 255;
    if (emblem) {
      lerp(c, c2, g);
      lerp(c, c3, r);
      for (let i = 0; i < 3; i++) c[i] = overlay(b, c[i]);
    } else {
      lerp(c, c1, r);
      lerp(c, c2, g);
      lerp(c, c3, b);
    }
    d[o] = c[0] * 255;
    d[o + 1] = c[1] * 255;
    d[o + 2] = c[2] * 255;
  }
  const canvas = document.createElement("canvas");
  canvas.width = out.width;
  canvas.height = out.height;
  canvas.getContext("2d")!.putImageData(out, 0, 0);
  recolorCache.set(cacheKey, canvas);
  return canvas;
}

/**
 * Where the pattern carries placeholder `slot` (1..3), as the game weighs it
 * (coat_of_arms_textured_emblem.fxh USE_PATTERN_MASK): the red placeholder is
 * r - g - b, the yellow one g - b, the white one b, each clamped to [0, 1],
 * and the emblem's alpha is multiplied by that weight.
 */
function maskCanvas(key: string, img: HTMLImageElement, slot: number): HTMLCanvasElement {
  const cacheKey = `${key}|${slot}`;
  const hit = maskCache.get(cacheKey);
  if (hit) return hit;
  const src = imageData(key, img);
  const out = new ImageData(src.width, src.height);
  const d = src.data;
  for (let o = 0; o < d.length; o += 4) {
    const r = d[o] / 255;
    const g = d[o + 1] / 255;
    const b = d[o + 2] / 255;
    const weight = slot === 1 ? r - g - b : slot === 2 ? g - b : b;
    out.data[o + 3] = Math.min(1, Math.max(0, weight)) * 255;
  }
  const c = document.createElement("canvas");
  c.width = out.width;
  c.height = out.height;
  c.getContext("2d")!.putImageData(out, 0, 0);
  maskCache.set(cacheKey, c);
  return c;
}

/** Slot N of `colors` fills placeholder N; an unresolvable color leaves its slot undeclared. */
function slotsOf(colors: CoaColor[], flag: CoaFlag, named: Record<string, Rgb>): Slots {
  const out: Slots = [null, null, null];
  for (const c of colors) {
    const slot = Number(c.name.replace("color", "")) - 1;
    if (slot >= 0 && slot < 3) out[slot] = colorToRgb(c, named, flag.colors);
  }
  return out;
}

/**
 * Draw `img` for each instance: the unit square of the flag is the coordinate
 * space, so scale is a fraction of the flag, position its center, and the
 * rotation turns in that (non-square) space.
 */
function drawInstances(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  instances: CoaInstance[],
  rect: Rect
): void {
  for (const inst of instances.length ? instances : [DEFAULT_INSTANCE]) {
    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.scale(rect.w, rect.h);
    ctx.translate(inst.position[0], inst.position[1]);
    ctx.rotate((inst.rotation * Math.PI) / 180);
    ctx.drawImage(img, -inst.scale[0] / 2, -inst.scale[1] / 2, inst.scale[0], inst.scale[1]);
    ctx.restore();
  }
}

/** True when every texture the flag (and its subs) needs has arrived. */
export function renderFlag(
  ctx: CanvasRenderingContext2D,
  flag: CoaFlag,
  rect: Rect,
  rc: RenderContext,
  depth = 0
): boolean {
  let complete = true;
  const tag = rc.cacheTag ?? "";
  const patternKey = flag.pattern ? `patterns/${flag.pattern}` : null;
  const pattern = patternKey ? rc.textures.image(patternKey) : null;
  if (patternKey && !pattern) complete = false;
  if (pattern && patternKey) {
    const painted = recolor(tag + patternKey, pattern, slotsOf(flag.colors, flag, rc.namedColors), false);
    ctx.drawImage(painted, rect.x, rect.y, rect.w, rect.h);
  }

  // Every instance draws in the designer's z order: `depth` ascending across
  // layers, file order among equals, a missing depth counting as 0 (coa.ts).
  // The in-game designer writes depth as a draw index and it spans layers
  // (01_landed_titles.txt d_samarra: a sabre at 0, the octagon frame at 1.01,
  // the second sabre at 2.01), so file order alone puts the frame over both
  // sabres. A definition with no depth anywhere draws in file order as before.
  const items: { z: number; order: number; draw: () => void }[] = [];
  let order = 0;
  for (const layer of flag.layers) {
    if (layer.kind === "sub") {
      const parent = rc.definitions[layer.parent];
      if (!parent || depth >= MAX_SUB_DEPTH) continue;
      for (const inst of layer.instances.length ? layer.instances : [DEFAULT_SUB_INSTANCE]) {
        const sub = {
          x: rect.x + rect.w * inst.offset[0],
          y: rect.y + rect.h * inst.offset[1],
          w: rect.w * inst.scale[0],
          h: rect.h * inst.scale[1],
        };
        items.push({
          z: 0,
          order: order++,
          draw: () => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(sub.x, sub.y, sub.w, sub.h);
            ctx.clip();
            if (!renderFlag(ctx, parent, sub, rc, depth + 1)) complete = false;
            ctx.restore();
          },
        });
      }
      continue;
    }
    const key = `${layer.kind === "colored_emblem" ? "colored_emblems" : "textured_emblems"}/${layer.texture}`;
    const img = layer.texture ? rc.textures.image(key) : null;
    if (!img) {
      if (layer.texture) complete = false;
      continue;
    }
    const painted: CanvasImageSource =
      layer.kind === "textured_emblem"
        ? img
        : recolor(tag + key, img, slotsOf(layer.colors, flag, rc.namedColors), true);
    const mask =
      layer.kind === "colored_emblem" && layer.mask >= 1 && layer.mask <= 3 && pattern && patternKey
        ? maskCanvas(tag + patternKey, pattern, layer.mask)
        : null;
    for (const inst of layer.instances.length ? layer.instances : [DEFAULT_INSTANCE]) {
      items.push({
        z: inst.depth ?? 0,
        order: order++,
        draw: () => {
          if (!mask) {
            drawInstances(ctx, painted, [inst], rect);
            return;
          }
          // Mask in flag space: draw the instance on a scratch canvas the size
          // of the flag rectangle, keep only what lies on the masked pattern pixels.
          const scratch = document.createElement("canvas");
          scratch.width = Math.max(1, Math.round(rect.w));
          scratch.height = Math.max(1, Math.round(rect.h));
          const sctx = scratch.getContext("2d")!;
          drawInstances(sctx, painted, [inst], { x: 0, y: 0, w: scratch.width, h: scratch.height });
          sctx.globalCompositeOperation = "destination-in";
          sctx.drawImage(mask, 0, 0, scratch.width, scratch.height);
          ctx.drawImage(scratch, rect.x, rect.y, rect.w, rect.h);
        },
      });
    }
  }
  items.sort((a, b) => a.z - b.z || a.order - b.order);
  for (const item of items) item.draw();
  return complete;
}

/** Every texture key a flag draws, subs included: what to ask the host for. */
export function textureKeys(
  flag: CoaFlag,
  definitions: Record<string, CoaFlag>,
  depth = 0,
  out = new Set<string>()
): string[] {
  if (flag.pattern) out.add(`patterns/${flag.pattern}`);
  for (const layer of flag.layers) {
    if (layer.kind === "sub") {
      const parent = definitions[layer.parent];
      if (parent && depth < MAX_SUB_DEPTH) textureKeys(parent, definitions, depth + 1, out);
    } else if (layer.texture) {
      out.add(`${layer.kind === "colored_emblem" ? "colored_emblems" : "textured_emblems"}/${layer.texture}`);
    }
  }
  return [...out];
}

/** A readable preview of a raw placeholder texture for the browser grid. */
export function previewThumb(key: string, img: HTMLImageElement, kind: string): CanvasImageSource {
  if (kind === "colored_emblems") {
    return recolor(
      key,
      img,
      [
        [235, 235, 235],
        [150, 150, 150],
        [70, 70, 70],
      ],
      true
    );
  }
  return img;
}
