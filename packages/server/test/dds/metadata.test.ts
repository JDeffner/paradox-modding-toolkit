import { describe, expect, it } from "vitest";
import { ddsFormatInfo, decodeDds, encodeDds } from "../../src/dds";

function header(dx10: boolean, count: number, flags: number): Uint8Array {
  const bytes = new Uint8Array(dx10 ? 148 : 128);
  bytes.set(encodeDds(16, 16, new Uint8Array(16 * 16 * 4), "bgra8").subarray(0, 128));
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 4, true);
  view.setUint32(84, 0x31545844, true);
  view.setUint32(8, flags, true);
  view.setUint32(28, count, true);
  if (dx10) {
    view.setUint32(84, 0x30315844, true);
    view.setUint32(128, 71, true); // DXGI_FORMAT_BC1_UNORM
    view.setUint32(132, 3, true); // D3D10_RESOURCE_DIMENSION_TEXTURE2D
    view.setUint32(140, 1, true);
  }
  return bytes;
}

describe.each([false, true])("DDS header metadata (DX10: %s)", (dx10) => {
  it.each([0, 1, 5])("reports declared count %s independently of payload and flags", (count) => {
    for (const flags of [0x1007, 0x21007]) {
      const bytes = header(dx10, count, flags);
      expect(ddsFormatInfo(bytes)).toEqual({
        format: dx10 ? "BC1 (DX10)" : "DXT1",
        width: 16,
        height: 16,
        mipLevelCount: Math.max(1, count),
      });
      expect(() => decodeDds(bytes)).toThrow(/truncated/);
    }
  });

  it("reports metadata for unsupported formats", () => {
    const bytes = header(dx10, 5, 0x1007);
    new DataView(bytes.buffer).setUint32(dx10 ? 128 : 84, 0xffffffff, true);
    expect(ddsFormatInfo(bytes)).toEqual({ format: "unsupported", width: 16, height: 16, mipLevelCount: 5 });
    expect(() => decodeDds(bytes)).toThrow(/unsupported/);
  });

  it("reports metadata above the decode budget without allocating pixels", () => {
    const bytes = header(dx10, 5, 0x1007);
    const view = new DataView(bytes.buffer);
    view.setUint32(12, 65535, true);
    view.setUint32(16, 65535, true);
    expect(ddsFormatInfo(bytes)).toMatchObject({ width: 65535, height: 65535, mipLevelCount: 5 });
    expect(() => decodeDds(bytes)).toThrow(/too large/);
  });

  it("returns unknown for truncated headers at any boundary", () => {
    const bytes = header(dx10, 5, 0x1007);
    for (let end = 0; end < bytes.length; end++) expect(ddsFormatInfo(bytes.subarray(0, end))).toBeNull();
  });

  it.each([0, 4, 12, 16])("returns unknown with invalid header field at offset %s", (offset) => {
    const bytes = header(dx10, 5, 0x1007);
    new DataView(bytes.buffer).setUint32(offset, 0, true);
    expect(ddsFormatInfo(bytes)).toBeNull();
  });
});

it("does not treat a truncated oversized DX10 header as supported metadata", () => {
  const bytes = header(true, 5, 0x1007);
  new DataView(bytes.buffer).setUint32(12, 65535, true);
  new DataView(bytes.buffer).setUint32(16, 65535, true);
  expect(ddsFormatInfo(bytes.subarray(0, 128))).toBeNull();
});
