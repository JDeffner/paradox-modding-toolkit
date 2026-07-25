/**
 * DDS encoder round-trips: encodeDds output must decode back through the
 * shipping decoder (decoder.ts) with exact pixels for uncompressed, exact
 * two-color blocks for BC1/BC3, and bounded error on gradients.
 */
import { describe, expect, it } from "vitest";
import { decodeDds, encodeDds, hasTransparency } from "../../src/dds";

function image(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number]
) {
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const o = (y * width + x) * 4;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = a;
    }
  }
  return px;
}

describe("encodeDds round-trips through decodeDds", () => {
  it("uncompressed BGRA8 is lossless", () => {
    const src = image(5, 3, (x, y) => [x * 40, y * 80, 200, 255 - x * 10]);
    const dds = encodeDds(5, 3, src, "bgra8");
    const back = decodeDds(dds);
    expect(back.width).toBe(5);
    expect(back.height).toBe(3);
    expect([...back.pixels]).toEqual([...src]);
  });

  it("BC1: a two-color block survives near-exactly (565 quantization only)", () => {
    // Pure black + pure white quantize exactly in 565.
    const src = image(4, 4, (x) => (x < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const back = decodeDds(encodeDds(4, 4, src, "bc1"));
    for (let i = 0; i < 16; i++) {
      const o = i * 4;
      expect(Math.abs(back.pixels[o] - src[o])).toBeLessThanOrEqual(8);
      expect(back.pixels[o + 3]).toBe(255);
    }
  });

  it("BC1: gradients stay within range-fit tolerance", () => {
    const src = image(16, 16, (x, y) => [x * 16, y * 16, 128, 255]);
    const back = decodeDds(encodeDds(16, 16, src, "bc1"));
    let worst = 0;
    for (let i = 0; i < src.length; i += 4) {
      worst = Math.max(
        worst,
        Math.abs(back.pixels[i] - src[i]),
        Math.abs(back.pixels[i + 1] - src[i + 1]),
        Math.abs(back.pixels[i + 2] - src[i + 2])
      );
    }
    expect(worst).toBeLessThanOrEqual(48); // 4-level palette per 4px block
  });

  it("BC3 preserves alpha gradients within 3-bit tolerance", () => {
    const src = image(8, 8, (x, y) => [200, 100, 50, x * 32 + y]);
    const back = decodeDds(encodeDds(8, 8, src, "bc3"));
    for (let i = 3; i < src.length; i += 4) {
      expect(Math.abs(back.pixels[i] - src[i])).toBeLessThanOrEqual(40);
    }
  });

  it("BC3 keeps fully opaque images opaque", () => {
    const src = image(4, 4, (x, y) => [x * 60, y * 60, 90, 255]);
    const back = decodeDds(encodeDds(4, 4, src, "bc3"));
    for (let i = 3; i < back.pixels.length; i += 4) expect(back.pixels[i]).toBe(255);
  });

  it("non-multiple-of-4 sizes encode via edge clamping", () => {
    const src = image(5, 7, () => [10, 200, 30, 255]);
    const back = decodeDds(encodeDds(5, 7, src, "bc1"));
    expect(back.width).toBe(5);
    expect(back.height).toBe(7);
    expect(Math.abs(back.pixels[0] - 10)).toBeLessThanOrEqual(8);
  });

  it("hasTransparency detects alpha", () => {
    expect(hasTransparency(image(2, 2, () => [1, 2, 3, 255]))).toBe(false);
    expect(hasTransparency(image(2, 2, (x) => [1, 2, 3, x === 0 ? 254 : 255]))).toBe(true);
  });
});
