import { describe, expect, it } from "vitest";
import { adjustDdsMipLevels, inspectDdsHeader, inspectDdsResource } from "../src/dds/migrateMips";
import { decodeDds } from "../src/dds/decoder";
import { encodeDds } from "../src/dds/encode";

function set(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
  return bytes;
}

function read(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

/** Literal DDS_HEADER fixture, independently of the encoder and migration helper. */
function fixture(width: number, height: number, count: number, format: string | number = "DXT5"): Uint8Array {
  const dx10 = typeof format === "number";
  const rgb = format === "RGB32";
  const blockBytes = format === "DXT1" || format === "ATI1" || format === 80 ? 8 : 16;
  const sizes: number[] = [];
  let w = width,
    h = height;
  for (let i = 0; i < count; i++) {
    sizes.push(rgb ? w * h * 4 : Math.ceil(w / 4) * Math.ceil(h / 4) * blockBytes);
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
  }
  const start = dx10 ? 148 : 128;
  const bytes = new Uint8Array(start + sizes.reduce((a, b) => a + b, 0));
  set(bytes, 0, 0x20534444);
  set(bytes, 4, 124);
  set(bytes, 8, 0x1007 | (rgb ? 8 : 0x80000) | (count > 1 ? 0x20000 : 0));
  set(bytes, 12, height);
  set(bytes, 16, width);
  set(bytes, 20, rgb ? width * 4 : sizes[0]);
  set(bytes, 28, count);
  set(bytes, 32, 0xcafebabe); // unrelated metadata must survive
  set(bytes, 76, 32);
  set(bytes, 80, rgb ? 0x41 : 4);
  if (rgb) {
    set(bytes, 88, 32);
    set(bytes, 92, 0xff0000);
    set(bytes, 96, 0xff00);
    set(bytes, 100, 0xff);
    set(bytes, 104, 0xff000000);
  } else {
    const tag = dx10 ? "DX10" : (format as string);
    set(
      bytes,
      84,
      (tag.charCodeAt(0) |
        (tag.charCodeAt(1) << 8) |
        (tag.charCodeAt(2) << 16) |
        (tag.charCodeAt(3) << 24)) >>>
        0
    );
  }
  set(bytes, 108, 0x1000 | (count > 1 ? 0x400008 : 0));
  if (dx10) {
    set(bytes, 128, format);
    set(bytes, 132, 3);
    set(bytes, 140, 1);
    set(bytes, 144, 4); // custom alpha, used as independent mask data
  }
  for (let i = start; i < bytes.length; i++) bytes[i] = (i * 17 + 23) & 255;
  return bytes;
}

function expectRetained(source: Uint8Array, output: Uint8Array, end: number): void {
  const expected = source.slice(0, end);
  // The three DDS mip fields are the only header fields this writer changes.
  for (const offset of [8, 28, 108]) set(expected, offset, read(output, offset));
  expect(Buffer.from(output.buffer, output.byteOffset, end).equals(Buffer.from(expected))).toBe(true);
}

describe("DDS migration mip adjustment", () => {
  it("inspects a prefix and reports expected full size without accepting a truncated write", () => {
    const source = fixture(8, 8, 4, 98);
    const header = inspectDdsHeader(source.subarray(0, 148));
    expect(header.expectedByteLength).toBe(260);
    expect(header.mipLevelCount).toBe(4);
    expect(header.resourceKind).toBe("2d");
    expect(() => inspectDdsResource(source.subarray(0, 148))).toThrow(/Truncated DDS mip/);
    expect(inspectDdsHeader(fixture(8, 8, 1, 115).subarray(0, 148)).expectedByteLength).toBeUndefined();
  });
  it("returns a separate unchanged copy, including a view with a nonzero byte offset", () => {
    const original = fixture(8, 8, 3);
    const container = new Uint8Array(original.length + 11);
    container.set(original, 5);
    const input = container.subarray(5, 5 + original.length);
    const output = adjustDdsMipLevels(input, 3);
    expect(output).toEqual(original);
    expect(output).not.toBe(input);
    output[128] ^= 255;
    expect(input).toEqual(original);
  });

  it.each([
    [512, 10, 2, 327808],
    [1024, 11, 3, 1376384],
    [2048, 12, 4, 5570688],
  ])(
    "shortens a full %i texture to %i stored levels without recompression",
    (size, fullCount, target, expectedBytes) => {
      const source = fixture(size, size, fullCount);
      const before = source.slice();
      const output = adjustDdsMipLevels(source, target);
      expect(output.length).toBe(expectedBytes);
      expect(inspectDdsResource(output).mipLevelCount).toBe(target);
      expectRetained(source, output, output.length);
      expect(
        Buffer.from(source.buffer, source.byteOffset, source.byteLength).equals(Buffer.from(before))
      ).toBe(true);
    }
  );

  it.each(["DXT1", "DXT3", "DXT5", "ATI1", "ATI2", 80, 83, 95, 98, "RGB32"])(
    "retains exact mip bytes and metadata for %s",
    (format) => {
      const source = fixture(8, 8, 4, format);
      const output = adjustDdsMipLevels(source, 2);
      const resource = inspectDdsResource(output);
      expect(resource.mipLevelCount).toBe(2);
      expectRetained(source, output, output.length);
      expect(read(output, 32)).toBe(0xcafebabe);
      if (typeof format === "number") expect(output.subarray(128, 148)).toEqual(source.subarray(128, 148));
    }
  );

  it("clears mip flags and caps when only the base image remains", () => {
    const source = fixture(8, 8, 4);
    set(source, 108, read(source, 108) | 0x20000);
    const output = adjustDdsMipLevels(source, 1);
    expect(read(output, 28)).toBe(1);
    expect(read(output, 8) & 0x20000).toBe(0);
    expect(read(output, 108) & 0x400008).toBe(0);
    expect(read(output, 108) & 0x21000).toBe(0x21000);
    expect(output.length).toBe(192);
  });

  it("accepts one image with the mip count unset and missing advisory caps flags", () => {
    const source = fixture(4, 4, 1);
    set(source, 28, 0);
    set(source, 108, 0);
    set(source, 8, read(source, 8) & ~0x1001);
    expect(inspectDdsResource(source).mipLevelCount).toBe(1);
  });

  it.each(["bc1", "bc3", "bgra8"] as const)("generates only the missing tail for %s", (format) => {
    const pixels = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([180, 80, 30, 255], i);
    const source = encodeDds(8, 8, pixels, format);
    const output = adjustDdsMipLevels(source, 3);
    const resource = inspectDdsResource(output);
    expect(resource.levels.map((level) => [level.width, level.height])).toEqual([
      [8, 8],
      [4, 4],
      [2, 2],
    ]);
    expect(resource.levels.map((level) => level.byteLength)).toEqual(
      format === "bgra8" ? [256, 64, 16] : format === "bc1" ? [32, 8, 8] : [64, 16, 16]
    );
    expectRetained(source, output, source.length);
    expect(read(output, 8) & 0x20000).toBe(0x20000);
    expect(read(output, 108) & 0x400008).toBe(0x400008);
    expect(decodeDds(output, 2).width).toBe(2);
  });

  it("filters from the last stored mip and keeps mask channels independent of alpha", () => {
    const source = fixture(8, 8, 2, "RGB32");
    const resource = inspectDdsResource(source);
    // Deliberately different base and last-level pixels expose regenerating from level zero.
    for (let i = 128; i < 384; i += 4) source.set([0, 0, 255, 255], i);
    for (let i = resource.levels[1].offset; i < source.length; i += 4) source.set([0, 0, 200, 0], i);
    const output = adjustDdsMipLevels(source, 4);
    expectRetained(source, output, source.length);
    expect(Array.from(decodeDds(output, 3).pixels)).toEqual([200, 0, 0, 0]);
  });

  it("generates non-square and non-power-of-two uncompressed tails", () => {
    const source = fixture(7, 3, 1, "RGB32");
    const output = adjustDdsMipLevels(source, 3);
    expect(
      inspectDdsResource(output).levels.map((level) => [level.width, level.height, level.byteLength])
    ).toEqual([
      [7, 3, 84],
      [3, 1, 12],
      [1, 1, 4],
    ]);
    expectRetained(source, output, source.length);
  });

  it.each([0, -1, 1.5, 5, NaN, Infinity])("rejects invalid requested counts: %s", (target) => {
    expect(() => adjustDdsMipLevels(fixture(8, 8, 1), target)).toThrow(/mipmap count/);
  });

  it.each([
    ["magic", 0, 0, /header/],
    ["header size", 4, 123, /header/],
    ["pixel format size", 76, 31, /header/],
    ["width", 16, 0, /dimensions/],
    ["height", 12, 0, /dimensions/],
    ["mip count", 28, 5, /mipmap count/],
    ["cube", 112, 0x200, /simple 2D/],
    ["cube face", 112, 0x400, /simple 2D/],
    ["volume caps", 112, 0x200000, /simple 2D/],
    ["depth", 24, 1, /simple 2D/],
    ["volume flag", 8, 0x800000, /simple 2D/],
    ["linear size", 20, 65, /linear size/],
  ] as const)("rejects invalid %s", (_name, offset, value, error) => {
    const source = fixture(8, 8, 1);
    set(source, offset, value);
    expect(() => adjustDdsMipLevels(source, 1)).toThrow(error);
  });

  it.each([
    [132, 2],
    [132, 4],
    [132, 0],
    [140, 2],
    [136, 4],
  ] as const)("rejects complex DX10 resource field %i=%i", (offset, value) => {
    const source = fixture(8, 8, 1, 98);
    set(source, offset, value);
    expect(inspectDdsHeader(source).resourceKind).not.toBe("2d");
    expect(() => adjustDdsMipLevels(source, 1)).toThrow(/simple 2D/);
  });

  it("rejects zero DX10 array size and a truncated extended header", () => {
    expect(() => inspectDdsResource(set(fixture(8, 8, 1, 98), 140, 0))).toThrow(/array size/);
    expect(() => inspectDdsResource(fixture(8, 8, 1, 98).subarray(0, 140))).toThrow(/DX10 header/);
  });

  it("rejects padded rows, unknown formats and unusual RGB masks", () => {
    expect(() => adjustDdsMipLevels(set(fixture(8, 8, 1, "RGB32"), 20, 36), 1)).toThrow(/rows/);
    expect(() => adjustDdsMipLevels(fixture(8, 8, 1, "ABCD"), 1)).toThrow(/Unsupported DDS format/);
    expect(() => adjustDdsMipLevels(fixture(8, 8, 1, 115), 1)).toThrow(/Unsupported DDS format/);
    expect(() => adjustDdsMipLevels(set(fixture(8, 8, 1, "RGB32"), 92, 0xffff), 1)).toThrow(/RGB masks/);
  });

  it("rejects truncated and trailing payloads before even an unchanged-count write", () => {
    const source = fixture(8, 8, 4);
    expect(() => adjustDdsMipLevels(source.subarray(0, source.length - 1), 4)).toThrow(/Truncated DDS mip/);
    const trailing = new Uint8Array(source.length + 1);
    trailing.set(source);
    expect(() => adjustDdsMipLevels(trailing, 4)).toThrow(/trailing bytes/);
    expect(() => inspectDdsResource(source.subarray(0, 127))).toThrow(/header/);
  });

  it("reports unsupported generation instead of silently changing formats", () => {
    for (const format of ["DXT3", "DXT4", "ATI1", "ATI2", 95, 98])
      expect(() => adjustDdsMipLevels(fixture(8, 8, 1, format), 3)).toThrow(/generation is unsupported/);
    expect(() => adjustDdsMipLevels(set(fixture(8, 8, 1, 77), 144, 2), 3)).toThrow(/premultiplied/);
  });

  it("refuses to discard BC1 transparency while generating", () => {
    const source = fixture(4, 4, 1, "DXT1");
    source.fill(0, 128); // equal endpoints select BC1's three-color/transparent mode
    source.fill(255, 132); // all pixels select transparent index 3
    expect(() => adjustDdsMipLevels(source, 2)).toThrow(/BC1 transparency/);
  });
});
