import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeDds, ddsMipLevels, encodeDds } from "../../src/dds";
import { devPath } from "../../../../scripts/devPaths";

// Independently authored levels prove the preview reads stored pixels rather than resizing level 0.
function storedMips(): Uint8Array {
  const bytes = new Uint8Array(128 + 4 * (8 * 4 + 4 * 2 + 2 + 1));
  bytes.set(encodeDds(8, 4, new Uint8Array(8 * 4 * 4), "bgra8").subarray(0, 128));
  new DataView(bytes.buffer).setUint32(28, 4, true);
  let offset = 128;
  for (const [size, color] of [
    [32, [0, 0, 255, 255]],
    [8, [0, 255, 0, 255]],
    [2, [255, 0, 0, 128]],
    [1, [9, 7, 5, 0]],
  ] as const) {
    for (let pixel = 0; pixel < size; pixel++) {
      bytes.set(color, offset);
      offset += 4;
    }
  }
  return bytes;
}

it("reads actual stored non-square mip levels and offsets", () => {
  const bytes = storedMips();
  expect(
    ddsMipLevels(bytes).map(({ width, height, offset, byteLength }) => [width, height, offset, byteLength])
  ).toEqual([
    [8, 4, 128, 128],
    [4, 2, 256, 32],
    [2, 1, 288, 8],
    [1, 1, 296, 4],
  ]);
  expect([...decodeDds(bytes, 1).pixels.slice(0, 4)]).toEqual([0, 255, 0, 255]);
  expect([...decodeDds(bytes, 2).pixels.slice(0, 4)]).toEqual([0, 0, 255, 128]);
  expect([...decodeDds(bytes, 3).pixels]).toEqual([5, 7, 9, 0]);
  const padded = new Uint8Array(bytes.length + 5);
  padded.set(bytes, 5);
  expect(decodeDds(padded.subarray(5), 3)).toEqual(decodeDds(bytes, 3));
});

it.each(["bc1", "bc3", "bgra8"] as const)("encodes a partial chain in %s", (format) => {
  const bytes = encodeDds(16, 8, new Uint8Array(16 * 8 * 4).fill(255), format, 3);
  const levels = ddsMipLevels(bytes);
  expect(levels.map(({ width, height }) => [width, height])).toEqual([
    [16, 8],
    [8, 4],
    [4, 2],
  ]);
  for (const mip of levels) expect(decodeDds(bytes, mip.level).pixels.every((v) => v === 255)).toBe(true);
  expect(levels.at(-1)!.offset + levels.at(-1)!.byteLength).toBe(bytes.length);
});

it.each(["DXT1", "DXT3", "DXT5", "DX10"])("locates complete blocks in 2x2 and 1x1 %s mipmaps", (tag) => {
  const blockSize = tag === "DXT1" ? 8 : 16;
  const start = tag === "DX10" ? 148 : 128;
  const bytes = new Uint8Array(start + blockSize * 3);
  bytes.set(encodeDds(4, 4, new Uint8Array(64), "bc3").subarray(0, 128));
  bytes.set(new TextEncoder().encode(tag), 84);
  const header = new DataView(bytes.buffer);
  header.setUint32(28, 3, true);
  if (tag === "DX10") {
    header.setUint32(128, 98, true); // BC7
    header.setUint32(132, 3, true); // 2D
    header.setUint32(140, 1, true);
    for (let mip = 0; mip < 3; mip++) bytes[start + mip * blockSize] = 0x40; // BC7 mode 6
  }
  expect(ddsMipLevels(bytes).map((mip) => mip.offset)).toEqual([
    start,
    start + blockSize,
    start + 2 * blockSize,
  ]);
  expect(decodeDds(bytes, 1).width).toBe(2);
  expect(decodeDds(bytes, 2).pixels.length).toBe(4);
});

it("rejects invalid counts, missing levels and truncated chains without changing base-only decoding", () => {
  const bytes = storedMips();
  for (const level of [-1, 0.5, NaN, 4, 1e9]) expect(() => decodeDds(bytes, level)).toThrow(/mip level/);
  expect(() => ddsMipLevels(bytes.subarray(0, -1))).toThrow(/truncated DDS mip level 3/);
  expect(decodeDds(bytes.subarray(0, 256)).width).toBe(8);
  new DataView(bytes.buffer).setUint32(28, 99, true);
  expect(() => ddsMipLevels(bytes)).toThrow(/mipmap count/);
  for (const count of [0, -1, 1.5, NaN, 5])
    expect(() => encodeDds(8, 4, new Uint8Array(128), "bgra8", count)).toThrow(/Mipmap count/);
});

const game = devPath("gamePath");
const mask =
  game &&
  join(
    game,
    "gfx/portraits/accessory_variations/textures/patterns/byzantine/byzantine_silk_trim_03_masks.dds"
  );
describe.skipIf(!mask || !existsSync(mask))("installed CK3 portrait pattern", () => {
  it("reads all ten vanilla levels and reproduces the vanilla layout", () => {
    const vanilla = readFileSync(mask!);
    const levels = ddsMipLevels(vanilla);
    expect(levels.map((mip) => mip.width)).toEqual([512, 256, 128, 64, 32, 16, 8, 4, 2, 1]);
    for (const mip of levels)
      expect(decodeDds(vanilla, mip.level).pixels.length).toBe(mip.width * mip.height * 4);
    const base = decodeDds(vanilla);
    const converted = encodeDds(base.width, base.height, base.pixels, "bc3", levels.length);
    expect(ddsMipLevels(converted)).toEqual(levels);
    expect(converted.length).toBe(vanilla.length);
  });
});
