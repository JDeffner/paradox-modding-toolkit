/**
 * The two picture rules the culture window draws its art with, on a canvas.
 *
 * The pillar icons are NOT pictures: measured over heritage.dds, language.dds
 * and martial_custom_equal.dds, every opaque pixel is pure black and the shape
 * lives in the alpha channel, so drawing the file is a black silhouette. The
 * game colors it through a texture:
 *
 *   gui/shared/icons.gui: `icon_doctrine` = `icon_flat_standard` = `icon`
 *   using template Icon_Flat_Standard = modify_texture {
 *       texture = "gfx/interface/colors/colors_textured.dds"
 *       blend_mode = add  framesize = { 96 96 }  frame = 7 }
 *
 * colors_textured.dds is 960x96, ten 96px cells, and `frame` is 1-BASED:
 * icon_flat_standard_gold takes frame 1 (measured 158,127,82), _green 8,
 * _red 9, _black 10, which pins the numbering. Cell 7 is the blue-grey the
 * culture window's pillars come out in, not gold.
 *
 * The ethos art is a painted banner cut out by a mask:
 *
 *   gui/shared/backgrounds.gui: template Mask_Rough_Edges = modify_texture {
 *       texture = "gfx/interface/component_masks/mask_rough_edges.dds"
 *       spriteType = Corneredtiled  spriteborder = { 20 20 }
 *       blend_mode = alphamultiply  texture_density = 2 }
 *
 * The mask file is 300x300, solid inside and rough over its outer band, so it
 * is a nine-slice: the corners keep their size, the edges repeat, the middle is
 * one stretch. `texture_density = 2` makes the 20-unit border 40 texture px.
 *
 * Browser code. Compositing only, never `getImageData`, so the webview's
 * cross-origin texture URLs never have to be readable.
 */

/** colors_textured.dds is square cells across one row; `frame` is 1-based. */
const FLAT_FRAME = 7;
/** mask_rough_edges.dds: spriteborder 20 at texture_density 2. */
const MASK_SIZE = 300;
const MASK_BORDER = 40;
/** The border in the widget's own units, which is what spriteborder counts. */
const MASK_BORDER_UNITS = 20;

/** url -> the browser's decoded copy; a canvas cannot draw one that is not in. */
const decoded = new Map<string, HTMLImageElement>();

function picture(url: string): HTMLImageElement {
  const have = decoded.get(url);
  if (have) return have;
  const img = new Image();
  img.src = url;
  decoded.set(url, img);
  return img;
}

const isReady = (img: HTMLImageElement): boolean => img.complete && img.naturalWidth > 0;

/** Run `draw` once every picture has decoded, or right now when they all have. */
function whenReady(urls: readonly string[], draw: (imgs: HTMLImageElement[]) => void): void {
  const imgs = urls.map(picture);
  if (imgs.every(isReady)) {
    draw(imgs);
    return;
  }
  let left = imgs.filter((img) => !isReady(img)).length;
  const done = (): void => {
    if (--left === 0 && imgs.every(isReady)) draw(imgs);
  };
  for (const img of imgs) {
    if (isReady(img)) continue;
    img.addEventListener("load", done, { once: true });
    // A texture that will not decode leaves the canvas as it is rather than
    // holding the others back.
    img.addEventListener("error", done, { once: true });
  }
}

/** A canvas the size the caller asked for, backed at the screen's density. */
function canvasOf(
  width: number,
  height: number
): { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null; scale: number } {
  const el = document.createElement("canvas");
  const scale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
  el.width = Math.max(1, Math.round(width * scale));
  el.height = Math.max(1, Math.round(height * scale));
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  // jsdom and any host without a 2d context get an empty canvas, not a throw.
  return { el, ctx: el.getContext?.("2d") ?? null, scale };
}

/**
 * A flat icon the way `icon_doctrine` draws one: the file, the color cell added
 * over it, and the file's own alpha put back so the added color stops at the
 * silhouette. `colorsUrl` missing (no game folder yet) leaves the black shape.
 */
export function flatIcon(iconUrl: string, colorsUrl: string | null, size: number): HTMLCanvasElement {
  const { el, ctx } = canvasOf(size, size);
  if (!ctx) return el;
  whenReady(colorsUrl ? [iconUrl, colorsUrl] : [iconUrl], ([icon, colors]) => {
    const { width, height } = el;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(icon, 0, 0, width, height);
    if (!colors || !isReady(colors)) return;
    // The cells are square and sit in one row, so their count is the aspect.
    const cells = Math.max(1, Math.round(colors.naturalWidth / colors.naturalHeight));
    const cell = colors.naturalWidth / cells;
    ctx.globalCompositeOperation = "lighter"; // blend_mode = add
    ctx.drawImage(colors, (FLAT_FRAME - 1) * cell, 0, cell, colors.naturalHeight, 0, 0, width, height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(icon, 0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
  });
  return el;
}

/** The nine-slice mask, painted opaque so it can be used as an alpha cutter. */
function paintMask(
  ctx: CanvasRenderingContext2D,
  mask: HTMLImageElement,
  w: number,
  h: number,
  border: number
): void {
  const sw = mask.naturalWidth;
  const sh = mask.naturalHeight;
  // The border in source pixels, whatever size the host decoded the file at.
  const sb = Math.max(1, Math.round((sw * MASK_BORDER) / MASK_SIZE));
  const db = Math.max(1, Math.min(border, Math.floor(w / 2), Math.floor(h / 2)));
  const midSw = Math.max(1, sw - sb * 2);
  const midSh = Math.max(1, sh - sb * 2);
  const midW = Math.max(0, w - db * 2);
  const midH = Math.max(0, h - db * 2);

  ctx.drawImage(mask, 0, 0, sb, sb, 0, 0, db, db);
  ctx.drawImage(mask, sw - sb, 0, sb, sb, w - db, 0, db, db);
  ctx.drawImage(mask, 0, sh - sb, sb, sb, 0, h - db, db, db);
  ctx.drawImage(mask, sw - sb, sh - sb, sb, sb, w - db, h - db, db, db);
  // The middle of the file is uniform, so one stretch is what tiling would give.
  if (midW > 0 && midH > 0) ctx.drawImage(mask, sb, sb, midSw, midSh, db, db, midW, midH);

  // Corneredtiled repeats the edges at the texture's own length rather than
  // stretching them, which is what keeps the roughness from smearing.
  const scale = db / sb;
  const tileW = Math.max(1, midSw * scale);
  for (let x = db; x < w - db; x += tileW) {
    const take = Math.min(tileW, w - db - x);
    const src = midSw * (take / tileW);
    ctx.drawImage(mask, sb, 0, src, sb, x, 0, take, db);
    ctx.drawImage(mask, sb, sh - sb, src, sb, x, h - db, take, db);
  }
  const tileH = Math.max(1, midSh * scale);
  for (let y = db; y < h - db; y += tileH) {
    const take = Math.min(tileH, h - db - y);
    const src = midSh * (take / tileH);
    ctx.drawImage(mask, 0, sb, sb, src, 0, y, db, take);
    ctx.drawImage(mask, sw - sb, sb, sb, src, w - db, y, db, take);
  }
}

/**
 * Art stretched into a box and cut out by Mask_Rough_Edges, the way the culture
 * window draws the ethos. `maskUrl` missing leaves the art with square edges.
 */
export function maskedArt(
  artUrl: string,
  maskUrl: string | null,
  width: number,
  height: number
): HTMLCanvasElement {
  const { el, ctx, scale } = canvasOf(width, height);
  if (!ctx) return el;
  whenReady(maskUrl ? [artUrl, maskUrl] : [artUrl], ([art, mask]) => {
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.drawImage(art, 0, 0, el.width, el.height);
    if (!mask || !isReady(mask)) return;
    // The mask is built whole first: `destination-in` would clear everything
    // outside each piece if the nine slices were composited one at a time.
    const cut = document.createElement("canvas");
    cut.width = el.width;
    cut.height = el.height;
    const cutCtx = cut.getContext?.("2d") ?? null;
    if (!cutCtx) return;
    paintMask(cutCtx, mask, el.width, el.height, Math.round(MASK_BORDER_UNITS * scale));
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(cut, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  });
  return el;
}
