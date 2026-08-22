/**
 * Flag rendering on a 2D canvas.
 *
 * The game paints a flag as: the pattern texture recolored (its red / yellow /
 * white placeholders become color1..3), then each layer in order. A colored
 * emblem is recolored the same way from its own placeholders (red and green
 * identify the slot, blue carries the shading), optionally masked to the
 * pixels of the pattern that carry one placeholder (`mask = { n }`); a
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
  EMBLEM_SOURCE_COLORS,
  PATTERN_SOURCE_COLORS,
  type CoaColor,
  type CoaFlag,
  type CoaInstance,
  type Rgb,
} from "@px-lsp/server/coa/coa";

/** Match radius of the shader, in normalized rgb distance. */
const TOLERANCE = 0.8;
const NEUTRAL_SHADE = 128 / 255;
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
}

interface Mapping {
  source: Rgb;
  target: Rgb;
}

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

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * The shader: for each pixel, the first mapping whose source is within
 * TOLERANCE replaces it. Pattern mode compares rgb and paints the target flat;
 * emblem mode compares rg only and shades the target by the blue channel
 * (128 = as is, 0 = black, 255 = white).
 */
function recolor(
  key: string,
  img: HTMLImageElement,
  mappings: Mapping[],
  blueShading: boolean
): HTMLCanvasElement {
  const cacheKey = `${key}|${blueShading ? "e" : "p"}|${mappings.map((m) => m.source.join(",") + ">" + m.target.join(",")).join(";")}`;
  const hit = recolorCache.get(cacheKey);
  if (hit) return hit;
  if (recolorCache.size > 256) recolorCache.clear();

  const src = imageData(key, img);
  const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  const d = out.data;
  const sources = mappings.map((m) => m.source.map((v) => v / 255));
  const targets = mappings.map((m) => m.target);
  for (let o = 0; o < d.length; o += 4) {
    const r = d[o] / 255;
    const g = d[o + 1] / 255;
    const b = d[o + 2] / 255;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      const dr = r - s[0];
      const dg = g - s[1];
      const db = b - s[2];
      const dist = blueShading ? Math.sqrt(dr * dr + dg * dg) : Math.sqrt(dr * dr + dg * dg + db * db);
      const match = 1 - smoothstep(TOLERANCE * 0.75, TOLERANCE, dist);
      if (match <= 0) continue;
      let [tr, tg, tb] = targets[i];
      if (blueShading) {
        if (b < NEUTRAL_SHADE) {
          const k = b / NEUTRAL_SHADE;
          tr *= k;
          tg *= k;
          tb *= k;
        } else {
          const k = (b - NEUTRAL_SHADE) / (1 - NEUTRAL_SHADE);
          tr += (255 - tr) * k;
          tg += (255 - tg) * k;
          tb += (255 - tb) * k;
        }
      }
      d[o] = d[o] + (tr - d[o]) * match;
      d[o + 1] = d[o + 1] + (tg - d[o + 1]) * match;
      d[o + 2] = d[o + 2] + (tb - d[o + 2]) * match;
      break;
    }
  }
  const c = document.createElement("canvas");
  c.width = out.width;
  c.height = out.height;
  c.getContext("2d")!.putImageData(out, 0, 0);
  recolorCache.set(cacheKey, c);
  return c;
}

/** Opaque where the raw pattern carries placeholder `slot` (1..3), transparent elsewhere. */
function maskCanvas(key: string, img: HTMLImageElement, slot: number): HTMLCanvasElement {
  const cacheKey = `${key}|${slot}`;
  const hit = maskCache.get(cacheKey);
  if (hit) return hit;
  const src = imageData(key, img);
  const out = new ImageData(src.width, src.height);
  const [mr, mg, mb] = PATTERN_SOURCE_COLORS[slot - 1].map((v) => v / 255);
  const d = src.data;
  for (let o = 0; o < d.length; o += 4) {
    const dr = d[o] / 255 - mr;
    const dg = d[o + 1] / 255 - mg;
    const db = d[o + 2] / 255 - mb;
    out.data[o + 3] = Math.sqrt(dr * dr + dg * dg + db * db) > TOLERANCE ? 0 : 255;
  }
  const c = document.createElement("canvas");
  c.width = out.width;
  c.height = out.height;
  c.getContext("2d")!.putImageData(out, 0, 0);
  maskCache.set(cacheKey, c);
  return c;
}

/** Slot N of `colors` maps placeholder N; unresolvable colors map nothing. */
function mappings(colors: CoaColor[], flag: CoaFlag, sources: Rgb[], named: Record<string, Rgb>): Mapping[] {
  const out: Mapping[] = [];
  for (const c of colors) {
    const slot = Number(c.name.replace("color", "")) - 1;
    if (!(slot >= 0 && slot < sources.length)) continue;
    const rgb = colorToRgb(c, named, flag.colors);
    if (rgb) out.push({ source: sources[slot], target: rgb });
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
  const patternKey = flag.pattern ? `patterns/${flag.pattern}` : null;
  const pattern = patternKey ? rc.textures.image(patternKey) : null;
  if (patternKey && !pattern) complete = false;
  if (pattern && patternKey) {
    const painted = recolor(
      patternKey,
      pattern,
      mappings(flag.colors, flag, PATTERN_SOURCE_COLORS, rc.namedColors),
      false
    );
    ctx.drawImage(painted, rect.x, rect.y, rect.w, rect.h);
  }

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
        ctx.save();
        ctx.beginPath();
        ctx.rect(sub.x, sub.y, sub.w, sub.h);
        ctx.clip();
        if (!renderFlag(ctx, parent, sub, rc, depth + 1)) complete = false;
        ctx.restore();
      }
      continue;
    }
    const key = `${layer.kind === "colored_emblem" ? "colored_emblems" : "textured_emblems"}/${layer.texture}`;
    const img = layer.texture ? rc.textures.image(key) : null;
    if (!img) {
      if (layer.texture) complete = false;
      continue;
    }
    if (layer.kind === "textured_emblem") {
      drawInstances(ctx, img, layer.instances, rect);
      continue;
    }
    const painted = recolor(
      key,
      img,
      mappings(layer.colors, flag, EMBLEM_SOURCE_COLORS, rc.namedColors),
      true
    );
    const masked = layer.mask >= 1 && layer.mask <= 3 && pattern && patternKey;
    if (!masked) {
      drawInstances(ctx, painted, layer.instances, rect);
      continue;
    }
    // Mask in flag space: draw the instances on a scratch canvas the size of
    // the flag rectangle, keep only what lies on the masked pattern pixels.
    const scratch = document.createElement("canvas");
    scratch.width = Math.max(1, Math.round(rect.w));
    scratch.height = Math.max(1, Math.round(rect.h));
    const sctx = scratch.getContext("2d")!;
    drawInstances(sctx, painted, layer.instances, { x: 0, y: 0, w: scratch.width, h: scratch.height });
    sctx.globalCompositeOperation = "destination-in";
    sctx.drawImage(maskCanvas(patternKey, pattern, layer.mask), 0, 0, scratch.width, scratch.height);
    ctx.drawImage(scratch, rect.x, rect.y, rect.w, rect.h);
  }
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
        { source: EMBLEM_SOURCE_COLORS[0], target: [235, 235, 235] },
        { source: EMBLEM_SOURCE_COLORS[1], target: [150, 150, 150] },
        { source: EMBLEM_SOURCE_COLORS[2], target: [70, 70, 70] },
      ],
      true
    );
  }
  return img;
}
