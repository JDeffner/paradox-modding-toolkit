import { decodeDds, type DecodedImage } from "./decoder";
import { encodePng } from "./png";

export { decodeDds, ddsFormatInfo } from "./decoder";
export { encodePng } from "./png";
export { encodeDds, hasTransparency, type DdsEncodeFormat } from "./encode";
export type { DecodedImage } from "./decoder";

/** Nearest-neighbour downscale so max(width, height) <= maxDim. Returns the image unchanged if already small enough. */
export function downscale(img: DecodedImage, maxDim: number): DecodedImage {
  const { width, height, pixels } = img;
  const longest = Math.max(width, height);
  if (longest <= maxDim || maxDim <= 0) return img;

  const scale = maxDim / longest;
  const dw = Math.max(1, Math.round(width * scale));
  const dh = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / dw));
      const so = (sy * width + sx) * 4;
      const dof = (y * dw + x) * 4;
      out[dof] = pixels[so];
      out[dof + 1] = pixels[so + 1];
      out[dof + 2] = pixels[so + 2];
      out[dof + 3] = pixels[so + 3];
    }
  }
  return { width: dw, height: dh, pixels: out };
}

/**
 * Decode a DDS, downscale so max(w,h) <= maxDim, encode PNG, return a data URI —
 * or null if even a shrunk preview can't fit the length budget.
 *
 * VS Code's hover markdown renderer hard-truncates any hover body longer than
 * 100_000 chars (`preprocessMarkdownString` in markdownRenderer.ts: `if
 * (value.length > 100_000) value = value.substr(0, 100_000) + '…'`). That cut
 * lands mid-base64 inside `![texture](data:...)`, leaving an unterminated image
 * link that markdown-it then renders as literal text — the raw base64 spilling
 * into the popup. Smooth vanilla art deflates small (~55-80 KB URIs) and stays
 * under the limit; noisy/photographic converter output can exceed it (a 1592x848
 * DXT1 event scene measured ~108 KB). So we cap the URI at `maxUriLength` and
 * progressively shrink maxDim until it fits, decoding only once.
 */
export function ddsToPngDataUri(buf: Uint8Array, maxDim = 256, maxUriLength = 90_000): string | null {
  const decoded = decodeDds(buf);
  for (let dim = maxDim; dim >= 32; dim = Math.floor(dim * 0.75)) {
    const scaled = downscale(decoded, dim);
    const png = encodePng(scaled.width, scaled.height, scaled.pixels);
    const uri = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
    if (uri.length <= maxUriLength) return uri;
  }
  return null;
}
