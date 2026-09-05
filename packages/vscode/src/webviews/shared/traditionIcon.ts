/**
 * A culture tradition's picture: the layers the engine stacks, drawn as one
 * element.
 *
 * The game composes the icon in code, one file per layer folder in index order
 * (`_traditions.info`, CULTURE_TRADITION_LAYER_PATHS), so a creator that shows
 * a tradition has to stack them itself. `window_culture.gui`'s
 * `widget_tradition_icon` is what it draws: the background at full size, the
 * pattern TWICE (the second mirrored horizontally), the support, the stroke at
 * 90% and the items on top.
 *
 * Which files those are is the host's answer (creators/traditionLayers.ts);
 * this only draws them. A layer whose picture has not arrived yet keeps its
 * `data-rel`, so a caller that repaints late images can fill it in.
 *
 * Browser code, styled by ui.css (`.px-tradicon`).
 */

/** One drawn layer: its game-relative file, and how the game draws it. */
export interface TraditionLayerImage {
  rel: string;
  /** `widget_tradition_icon` draws the pattern layer a second time, mirrored. */
  mirrored?: boolean;
  /** Fraction of the box the layer covers; the stroke is `size = { 90% 90% }`. */
  scale?: number;
}

/** `widget_tradition_icon`: the pattern is drawn twice, the second mirrored. */
const PATTERN_INDEX = 1;
/** `widget_tradition_icon`: the stroke is `size = { 90% 90% }`, centred. */
const STROKE_INDEX = 3;
const STROKE_SCALE = 0.9;

/**
 * The files of a tradition, one per layer folder in index order (null or ""
 * where none), as the images `widget_tradition_icon` draws for them. Both
 * creators go through this so a tile reads the same in each.
 */
export function stackLayers(rels: readonly (string | null | undefined)[]): TraditionLayerImage[] {
  const out: TraditionLayerImage[] = [];
  rels.forEach((rel, index) => {
    if (!rel) return;
    out.push({ rel, ...(index === STROKE_INDEX ? { scale: STROKE_SCALE } : {}) });
    if (index === PATTERN_INDEX) out.push({ rel, mirrored: true });
  });
  return out;
}

/**
 * The stacked picture. `size` sets the box in px when the caller has one;
 * without it the box takes its size from CSS, which is what a non-square tile
 * (the game's own 220x120 tradition tile) needs.
 */
export function traditionIcon(
  layers: readonly TraditionLayerImage[],
  size: number | null,
  urlOf: (rel: string) => string | null | undefined
): HTMLElement {
  const box = document.createElement("span");
  box.className = "px-tradicon";
  if (size !== null) box.style.setProperty("--px-tradicon", `${size}px`);
  for (const layer of layers) {
    const img = document.createElement("img");
    img.alt = "";
    img.dataset.rel = layer.rel;
    const transforms: string[] = [];
    if (layer.mirrored) transforms.push("scaleX(-1)");
    if (layer.scale !== undefined) transforms.push(`scale(${layer.scale})`);
    if (transforms.length > 0) img.style.transform = transforms.join(" ");
    const url = urlOf(layer.rel);
    if (url) img.src = url;
    else img.hidden = true;
    box.append(img);
  }
  box.hidden = layers.length === 0;
  return box;
}
