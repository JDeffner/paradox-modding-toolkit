import { describe, it, expect } from "vitest";
import { decodeDds, ddsFormatInfo } from "../../src/dds/decoder";

function fourCC(s: string): number {
  return (
    ((s.charCodeAt(0) & 0xff) |
      ((s.charCodeAt(1) & 0xff) << 8) |
      ((s.charCodeAt(2) & 0xff) << 16) |
      ((s.charCodeAt(3) & 0xff) << 24)) >>>
    0
  );
}

describe("fuzz / robustness", () => {
  it("never crashes on random byte buffers", () => {
    let rng = 0x12345678;
    const rand = () => {
      // xorshift
      rng ^= rng << 13;
      rng ^= rng >>> 17;
      rng ^= rng << 5;
      return (rng >>> 0) & 0xff;
    };
    for (let iter = 0; iter < 2000; iter++) {
      const len = Math.floor((rand() / 255) * 512);
      const buf = new Uint8Array(len);
      for (let i = 0; i < len; i++) buf[i] = rand();
      // must not throw for ddsFormatInfo (returns null) and decodeDds throws cleanly
      expect(() => ddsFormatInfo(buf)).not.toThrow();
      try {
        decodeDds(buf);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    }
  });

  it("random buffers starting with the DDS magic still terminate", () => {
    let rng = 0xdeadbeef;
    const rand = () => {
      rng ^= rng << 13;
      rng ^= rng >>> 17;
      rng ^= rng << 5;
      return (rng >>> 0) & 0xff;
    };
    for (let iter = 0; iter < 1000; iter++) {
      const len = 128 + Math.floor((rand() / 255) * 4096);
      const buf = new Uint8Array(len);
      for (let i = 0; i < len; i++) buf[i] = rand();
      // valid magic + header size
      const dv = new DataView(buf.buffer);
      dv.setUint32(0, fourCC("DDS "), true);
      dv.setUint32(4, 124, true);
      // random but bounded dimensions
      dv.setUint32(12, 1 + (rand() % 64), true); // height
      dv.setUint32(16, 1 + (rand() % 64), true); // width
      dv.setUint32(80, 0x4, true); // DDPF_FOURCC
      dv.setUint32(84, fourCC("DXT5"), true);
      try {
        const img = decodeDds(buf);
        expect(img.pixels.length).toBe(img.width * img.height * 4);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    }
  });

  it("truncated real headers return info or throw, never crash", () => {
    // A well-formed DXT1 header but with no block data.
    const buf = new Uint8Array(128);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, fourCC("DDS "), true);
    dv.setUint32(4, 124, true);
    dv.setUint32(12, 256, true);
    dv.setUint32(16, 256, true);
    dv.setUint32(80, 0x4, true);
    dv.setUint32(84, fourCC("DXT1"), true);

    expect(ddsFormatInfo(buf)).toEqual({ format: "DXT1", width: 256, height: 256 });
    expect(() => decodeDds(buf)).toThrow(/truncated/);

    // Truncate the header itself
    for (let cut = 0; cut < 128; cut += 7) {
      const sliced = buf.subarray(0, cut);
      expect(() => ddsFormatInfo(sliced)).not.toThrow();
      expect(() => {
        try {
          decodeDds(sliced);
        } catch {
          /* expected */
        }
      }).not.toThrow();
    }
  });

  it("DX10 header without extension data returns null / throws cleanly", () => {
    const buf = new Uint8Array(130); // magic+header but < 148 needed for DX10 ext
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, fourCC("DDS "), true);
    dv.setUint32(4, 124, true);
    dv.setUint32(12, 16, true);
    dv.setUint32(16, 16, true);
    dv.setUint32(80, 0x4, true);
    dv.setUint32(84, fourCC("DX10"), true);
    expect(ddsFormatInfo(buf)).toBeNull();
    expect(() => decodeDds(buf)).toThrow();
  });
});
