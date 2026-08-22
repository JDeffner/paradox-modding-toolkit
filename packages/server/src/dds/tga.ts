/**
 * Truevision TGA decoder: true-color 24/32-bit, raw (type 2) or RLE (type 10),
 * either vertical origin. That is every .tga the games ship under gfx/ (the
 * coat-of-arms patterns are 24-bit, raw or RLE, bottom-left origin). No
 * color-mapped or grayscale images: nothing in the corpus uses them.
 */
import type { DecodedImage } from "./decoder";

export function decodeTga(buf: Uint8Array): DecodedImage {
  if (buf.length < 18) throw new Error("truncated TGA header");
  const idLength = buf[0];
  const colorMapType = buf[1];
  const imageType = buf[2];
  const width = buf[12] | (buf[13] << 8);
  const height = buf[14] | (buf[15] << 8);
  const depth = buf[16];
  const descriptor = buf[17];
  if (colorMapType !== 0 || (imageType !== 2 && imageType !== 10)) {
    throw new Error(`unsupported TGA image type ${imageType} (color map ${colorMapType})`);
  }
  if (depth !== 24 && depth !== 32) throw new Error(`unsupported TGA depth ${depth}`);
  if (width === 0 || height === 0) throw new Error("empty TGA");

  const bpp = depth / 4 / 2; // bytes per pixel: 3 or 4
  const topDown = (descriptor & 0x20) !== 0;
  const pixels = new Uint8Array(width * height * 4);
  let src = 18 + idLength;
  const count = width * height;

  const put = (i: number): void => {
    // Row i / width of the file maps to the bottom row first unless top-down.
    const row = Math.floor(i / width);
    const y = topDown ? row : height - 1 - row;
    const o = (y * width + (i % width)) * 4;
    pixels[o] = buf[src + 2];
    pixels[o + 1] = buf[src + 1];
    pixels[o + 2] = buf[src];
    pixels[o + 3] = bpp === 4 ? buf[src + 3] : 255;
  };

  if (imageType === 2) {
    if (src + count * bpp > buf.length) throw new Error("truncated TGA data");
    for (let i = 0; i < count; i++, src += bpp) put(i);
    return { width, height, pixels };
  }

  let i = 0;
  while (i < count) {
    if (src >= buf.length) throw new Error("truncated TGA RLE data");
    const packet = buf[src++];
    const n = (packet & 0x7f) + 1;
    if (packet & 0x80) {
      if (src + bpp > buf.length) throw new Error("truncated TGA RLE data");
      for (let k = 0; k < n && i < count; k++, i++) put(i);
      src += bpp;
    } else {
      if (src + n * bpp > buf.length) throw new Error("truncated TGA RLE data");
      for (let k = 0; k < n && i < count; k++, i++, src += bpp) put(i);
    }
  }
  return { width, height, pixels };
}
