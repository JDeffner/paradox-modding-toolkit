/**
 * TGA decoder: raw and RLE true-color, both origins; and the vanilla
 * Victoria 3 patterns when games.vic3.gamePath is configured.
 */
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { devPath } from "../../../scripts/devPaths";
import { decodeTga } from "../src/dds/tga";

/** A 2x2 image; rows are given top to bottom as [r,g,b(,a)] pixels. */
function tga(type: 2 | 10, depth: 24 | 32, topDown: boolean, body: number[]): Uint8Array {
  const h = new Uint8Array(18);
  h[2] = type;
  h[12] = 2;
  h[14] = 2;
  h[16] = depth;
  h[17] = topDown ? 0x20 : 0;
  return new Uint8Array([...h, ...body]);
}

describe("decodeTga", () => {
  it("decodes raw 24-bit BGR with bottom-left origin", () => {
    // File rows: first row stored is the BOTTOM row.
    const img = decodeTga(tga(2, 24, false, [0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255]));
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    // Top row (stored second): blue-channel-first bytes become rgb.
    expect([...img.pixels.slice(0, 8)]).toEqual([0, 0, 255, 255, 255, 255, 255, 255]);
    expect([...img.pixels.slice(8, 16)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it("decodes RLE 32-bit with top-left origin", () => {
    // One run packet of 3 identical pixels, then one raw packet of 1 pixel.
    const body = [0x82, 10, 20, 30, 40, 0x00, 1, 2, 3, 4];
    const img = decodeTga(tga(10, 32, true, body));
    expect([...img.pixels.slice(0, 4)]).toEqual([30, 20, 10, 40]);
    expect([...img.pixels.slice(8, 12)]).toEqual([30, 20, 10, 40]);
    expect([...img.pixels.slice(12, 16)]).toEqual([3, 2, 1, 4]);
  });

  it("rejects what it does not decode", () => {
    expect(() => decodeTga(tga(2, 24, false, [1, 2, 3]))).toThrow(/truncated/);
    const h = tga(2, 24, false, []);
    h[2] = 1;
    expect(() => decodeTga(h)).toThrow(/unsupported/);
  });
});

const vic3 = devPath("gamePath", "vic3");
describe.skipIf(!vic3)("vanilla Victoria 3 patterns", () => {
  it("decodes every .tga pattern", () => {
    const dir = path.join(vic3!, "gfx", "coat_of_arms", "patterns");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".tga"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const img = decodeTga(new Uint8Array(fs.readFileSync(path.join(dir, f))));
      expect(img.width * img.height * 4, f).toBe(img.pixels.length);
    }
    // pattern_solid is the slot-1 placeholder everywhere: pure red.
    const solid = decodeTga(new Uint8Array(fs.readFileSync(path.join(dir, "pattern_solid.tga"))));
    expect([...solid.pixels.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  });
});
