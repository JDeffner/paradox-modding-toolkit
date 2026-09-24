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

  it.each(["bc1", "bc3"] as const)("rejects %s sizes that Direct3D cannot load", (format) => {
    const src = image(5, 7, () => [10, 200, 30, 255]);
    expect(() => encodeDds(5, 7, src, format)).toThrow(/multiples of 4.*Auto.*Uncompressed/);
  });

  it.each(["bc1", "bc3"] as const)("%s preserves two colors with equal luminance", (format) => {
    const src = image(4, 4, (x) => (x < 2 ? [170, 0, 0, 255] : [0, 85, 0, 255]));
    const back = decodeDds(encodeDds(4, 4, src, format));
    for (let i = 0; i < src.length; i++) expect(Math.abs(back.pixels[i] - src[i])).toBeLessThanOrEqual(8);
  });

  it.each([
    [0, 4],
    [-1, 4],
    [1.5, 4],
    [4, NaN],
    [Infinity, 4],
  ])("rejects invalid dimensions %s by %s", (width, height) => {
    expect(() => encodeDds(width, height, new Uint8Array(64), "bgra8")).toThrow(/dimensions/);
  });

  it("rejects an incomplete pixel buffer", () => {
    expect(() => encodeDds(4, 4, new Uint8Array(63), "bgra8")).toThrow(/pixel buffer/);
  });

  it.each(["bc1", "bc3", "bgra8"] as const)(
    "writes every mip level and required header flags for %s",
    (format) => {
      const src = image(8, 4, () => [255, 0, 0, 255]);
      const dds = encodeDds(8, 4, src, format, true);
      const header = new DataView(dds.buffer);
      expect(header.getUint32(28, true)).toBe(4);
      expect(header.getUint32(8, true) & 0x20000).toBe(0x20000);
      expect(header.getUint32(108, true) & 0x401008).toBe(0x401008);
      const baseSize = format === "bgra8" ? 8 * 4 * 4 : 2 * (format === "bc1" ? 8 : 16);
      expect(header.getUint32(20, true)).toBe(format === "bgra8" ? 8 * 4 : baseSize);
      let offset = 128;
      for (const [width, height] of [
        [8, 4],
        [4, 2],
        [2, 1],
        [1, 1],
      ]) {
        const size =
          format === "bgra8"
            ? width * height * 4
            : Math.ceil(width / 4) * Math.ceil(height / 4) * (format === "bc1" ? 8 : 16);
        const level = new Uint8Array(128 + size);
        level.set(dds.subarray(0, 128));
        const view = new DataView(level.buffer);
        view.setUint32(12, height, true);
        view.setUint32(16, width, true);
        view.setUint32(20, format === "bgra8" ? width * 4 : size, true);
        view.setUint32(28, 1, true);
        level.set(dds.subarray(offset, offset + size), 128);
        const decoded = decodeDds(level);
        expect(decoded.pixels).toEqual(image(width, height, () => [255, 0, 0, 255]));
        offset += size;
      }
      expect(offset).toBe(dds.length);
    }
  );

  it("filters masks independently of alpha and includes odd-sized edges", () => {
    const src = image(3, 3, (x, y) => [x === 2 && y === 2 ? 255 : 0, 90, 180, 0]);
    const dds = encodeDds(3, 3, src, "bgra8", true);
    expect(new DataView(dds.buffer).getUint32(28, true)).toBe(2);
    expect([...dds.subarray(-4)]).toEqual([180, 90, 28, 0]);
  });

  it("keeps base-only headers and pixels when mipmaps are disabled or already 1x1", () => {
    for (const mipmaps of [false, true]) {
      const dds = encodeDds(1, 1, new Uint8Array([10, 20, 30, 0]), "bgra8", mipmaps);
      const header = new DataView(dds.buffer);
      expect(header.getUint32(28, true)).toBe(0);
      expect(header.getUint32(8, true) & 0x20000).toBe(0);
      expect(header.getUint32(108, true)).toBe(0x1000);
      expect(dds.length).toBe(132);
    }
  });

  it("hasTransparency detects alpha", () => {
    expect(hasTransparency(image(2, 2, () => [1, 2, 3, 255]))).toBe(false);
    expect(hasTransparency(image(2, 2, (x) => [1, 2, 3, x === 0 ? 254 : 255]))).toBe(true);
  });
});
