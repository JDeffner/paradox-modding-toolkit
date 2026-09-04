/**
 * One texture file to PNG bytes: the only part of the texture cache that
 * costs real time, split out so the extension host and the decode worker
 * (decodeWorker.ts) run the SAME code and the cache's bookkeeping stays on one
 * thread.
 *
 * No vscode, no fs state: a path in, bytes out.
 */
import * as fs from "fs";
import { decodeDds, decodeTga, downscale, encodePng, type DecodedImage } from "@px-lsp/server/dds";

/** Skip textures beyond this pixel count (loading screens, atlases). */
const MAX_TEXTURE_PIXELS = 4096 * 4096;

/**
 * `maxDim` caps the longest edge of the decode. It only bites on a DDS or a
 * TGA: a source that is already a PNG is passed through, since decoding one
 * back to pixels to shrink it would cost more than the caller saves.
 */
export function convertImage(abs: string, maxDim: number): Uint8Array | null {
  // Extension gate BEFORE the read: a path that is not an image never has its
  // bytes pulled into memory (readFileSync on a huge or special file is the
  // expensive part, not the decode).
  if (!/\.(png|dds|tga)$/i.test(abs)) return null;
  try {
    const bytes = fs.readFileSync(abs);
    if (/\.png$/i.test(abs)) return new Uint8Array(bytes);
    let decoded: DecodedImage;
    if (/\.dds$/i.test(abs)) decoded = decodeDds(new Uint8Array(bytes));
    else if (/\.tga$/i.test(abs)) decoded = decodeTga(new Uint8Array(bytes));
    else return null;
    if (decoded.width * decoded.height > MAX_TEXTURE_PIXELS) return null;
    const img = maxDim > 0 ? downscale(decoded, maxDim) : decoded;
    return encodePng(img.width, img.height, img.pixels);
  } catch {
    return null;
  }
}
