import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { decodeDds, ddsFormatInfo } from "../../src/dds/decoder";
import { encodePng } from "../../src/dds/png";

// ---------------------------------------------------------------------------
// DDS header helpers
// ---------------------------------------------------------------------------

function fourCC(s: string): number {
  return (
    ((s.charCodeAt(0) & 0xff) |
      ((s.charCodeAt(1) & 0xff) << 8) |
      ((s.charCodeAt(2) & 0xff) << 16) |
      ((s.charCodeAt(3) & 0xff) << 24)) >>>
    0
  );
}

interface HeaderOpts {
  width: number;
  height: number;
  pfFlags: number;
  fourCC?: number;
  rgbBitCount?: number;
  rMask?: number;
  gMask?: number;
  bMask?: number;
  aMask?: number;
}

const DDPF_ALPHAPIXELS = 0x1;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;

function writeHeader(o: HeaderOpts): Uint8Array {
  const h = new Uint8Array(128);
  const dv = new DataView(h.buffer);
  dv.setUint32(0, fourCC("DDS "), true);
  dv.setUint32(4, 124, true); // header size
  dv.setUint32(12, o.height, true);
  dv.setUint32(16, o.width, true);
  // pixel format at offset 76, size 32
  dv.setUint32(76, 32, true); // pf size
  dv.setUint32(80, o.pfFlags, true);
  dv.setUint32(84, o.fourCC ?? 0, true);
  dv.setUint32(88, o.rgbBitCount ?? 0, true);
  dv.setUint32(92, o.rMask ?? 0, true);
  dv.setUint32(96, o.gMask ?? 0, true);
  dv.setUint32(100, o.bMask ?? 0, true);
  dv.setUint32(104, o.aMask ?? 0, true);
  return h;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function rgb565(r: number, g: number, b: number): number {
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

function le16(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DXT1 decode", () => {
  it("decodes a 4x4 block with two known colors", () => {
    const header = writeHeader({
      width: 4,
      height: 4,
      pfFlags: DDPF_FOURCC,
      fourCC: fourCC("DXT1"),
    });
    // color0 = pure red, color1 = pure blue. c0 > c1 so 4-color mode.
    const red = rgb565(255, 0, 0);
    const blue = rgb565(0, 0, 255);
    // Ensure c0 > c1
    const c0 = Math.max(red, blue);
    const c1 = Math.min(red, blue);
    // indices: top row = color0, second row = color1, others color0
    // texel index = row*4 + col; bits are 2 bits per texel, texel 0 in low bits
    // Build so row0 -> idx0, row1 -> idx1, row2 -> idx0, row3 -> idx1
    let bits = 0;
    for (let i = 0; i < 16; i++) {
      const row = i >> 2;
      const idx = row % 2 === 0 ? 0 : 1;
      bits |= idx << (i * 2);
    }
    const block = concat(
      le16(c0),
      le16(c1),
      new Uint8Array([bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff])
    );
    const dds = concat(header, block);

    const img = decodeDds(dds);
    expect(img.width).toBe(4);
    expect(img.height).toBe(4);
    expect(img.pixels.length).toBe(4 * 4 * 4);

    const colorHi = c0 === red; // whether idx0 is red
    // pixel at (0,0): idx0
    const p00 = img.pixels.subarray(0, 4);
    // pixel at (0,1) row1: idx1
    const p01 = img.pixels.subarray(4 * 4, 4 * 4 + 4);
    if (colorHi) {
      expect(Array.from(p00)).toEqual([255, 0, 0, 255]);
      expect(Array.from(p01)).toEqual([0, 0, 255, 255]);
    } else {
      expect(Array.from(p00)).toEqual([0, 0, 255, 255]);
      expect(Array.from(p01)).toEqual([255, 0, 0, 255]);
    }
  });

  it("produces transparent texels in 3-color (punch-through) mode", () => {
    const header = writeHeader({ width: 4, height: 4, pfFlags: DDPF_FOURCC, fourCC: fourCC("DXT1") });
    // c0 < c1 forces 3-color mode; index 3 = transparent black
    const c0 = 0x0001;
    const c1 = 0xffff;
    // all texels use index 3
    let bits = 0;
    for (let i = 0; i < 16; i++) bits |= 3 << (i * 2);
    const block = concat(
      le16(c0),
      le16(c1),
      new Uint8Array([bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff])
    );
    const img = decodeDds(concat(header, block));
    expect(Array.from(img.pixels.subarray(0, 4))).toEqual([0, 0, 0, 0]);
  });
});

describe("DXT5 decode", () => {
  it("decodes a known alpha ramp", () => {
    const header = writeHeader({ width: 4, height: 4, pfFlags: DDPF_FOURCC, fourCC: fourCC("DXT5") });
    // alpha block: a0=255, a1=0, 8-alpha mode (a0 > a1)
    // alpha indices: use index 0 (=a0=255) for texel 0, index 1 (=a1=0) for texel 1.
    const a0 = 255;
    const a1 = 0;
    // 3-bit indices, 16 texels = 48 bits over 6 bytes.
    // texel0 -> 0, texel1 -> 1, rest -> 0
    let aIdxLo = 0; // 24 bits for texels 0..7
    aIdxLo |= 0 << 0;
    aIdxLo |= 1 << 3;
    const aIdxHi = 0; // texels 8..15
    const alphaBytes = new Uint8Array([
      a0,
      a1,
      aIdxLo & 0xff,
      (aIdxLo >> 8) & 0xff,
      (aIdxLo >> 16) & 0xff,
      aIdxHi & 0xff,
      (aIdxHi >> 8) & 0xff,
      (aIdxHi >> 16) & 0xff,
    ]);
    // color block: white color0, black color1, all texels index 0 (white)
    const cWhite = rgb565(255, 255, 255);
    const cBlack = rgb565(0, 0, 0);
    const colorBytes = concat(le16(cWhite), le16(cBlack), new Uint8Array([0, 0, 0, 0]));
    const block = concat(alphaBytes, colorBytes);
    const img = decodeDds(concat(header, block));

    // texel 0: white, alpha 255
    expect(Array.from(img.pixels.subarray(0, 4))).toEqual([255, 255, 255, 255]);
    // texel 1: white, alpha 0
    expect(Array.from(img.pixels.subarray(4, 8))).toEqual([255, 255, 255, 0]);
  });
});

describe("uncompressed BGRA decode", () => {
  it("decodes A8R8G8B8 (BGRA byte order) exactly", () => {
    const header = writeHeader({
      width: 2,
      height: 1,
      pfFlags: DDPF_RGB | DDPF_ALPHAPIXELS,
      rgbBitCount: 32,
      rMask: 0x00ff0000,
      gMask: 0x0000ff00,
      bMask: 0x000000ff,
      aMask: 0xff000000,
    });
    // pixel 0: B=10 G=20 R=30 A=40 ; pixel 1: B=200 G=150 R=100 A=255
    const data = new Uint8Array([10, 20, 30, 40, 200, 150, 100, 255]);
    const img = decodeDds(concat(header, data));
    expect(img.width).toBe(2);
    expect(img.height).toBe(1);
    expect(Array.from(img.pixels.subarray(0, 4))).toEqual([30, 20, 10, 40]);
    expect(Array.from(img.pixels.subarray(4, 8))).toEqual([100, 150, 200, 255]);
  });

  it("treats X8R8G8B8 alpha as opaque", () => {
    const header = writeHeader({
      width: 1,
      height: 1,
      pfFlags: DDPF_RGB,
      rgbBitCount: 32,
      rMask: 0x00ff0000,
      gMask: 0x0000ff00,
      bMask: 0x000000ff,
      aMask: 0,
    });
    const data = new Uint8Array([10, 20, 30, 0]);
    const img = decodeDds(concat(header, data));
    expect(Array.from(img.pixels.subarray(0, 4))).toEqual([30, 20, 10, 255]);
  });
});

describe("ddsFormatInfo", () => {
  it("returns null for non-DDS", () => {
    expect(ddsFormatInfo(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(ddsFormatInfo(new Uint8Array(0))).toBeNull();
  });
  it("reports DXT5 format and dimensions", () => {
    const header = writeHeader({ width: 64, height: 32, pfFlags: DDPF_FOURCC, fourCC: fourCC("DXT5") });
    const info = ddsFormatInfo(header);
    expect(info).toEqual({ format: "DXT5", width: 64, height: 32 });
  });
});

// ---------------------------------------------------------------------------
// PNG encoder tests
// ---------------------------------------------------------------------------

function readU32be(b: Uint8Array, off: number): number {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

// independent CRC32 for verifying IHDR CRC
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

describe("PNG encoder", () => {
  it("encodes a 2x2 image that round-trips exactly", () => {
    const rgba = new Uint8Array([
      255,
      0,
      0,
      255, // red
      0,
      255,
      0,
      255, // green
      0,
      0,
      255,
      255, // blue
      255,
      255,
      0,
      128, // yellow, half alpha
    ]);
    const png = encodePng(2, 2, rgba);

    // signature
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // parse chunks
    let off = 8;
    const chunks: { type: string; data: Uint8Array; crc: number }[] = [];
    while (off < png.length) {
      const len = readU32be(png, off);
      const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
      const data = png.subarray(off + 8, off + 8 + len);
      const crc = readU32be(png, off + 8 + len);
      chunks.push({ type, data, crc });
      off += 12 + len;
    }

    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);

    // verify IHDR contents
    const ihdr = chunks[0];
    expect(readU32be(ihdr.data, 0)).toBe(2); // width
    expect(readU32be(ihdr.data, 4)).toBe(2); // height
    expect(ihdr.data[8]).toBe(8); // bit depth
    expect(ihdr.data[9]).toBe(6); // color type RGBA

    // verify IHDR CRC (over type + data)
    const typeAndData = new Uint8Array(4 + ihdr.data.length);
    typeAndData.set([0x49, 0x48, 0x44, 0x52], 0); // "IHDR"
    typeAndData.set(ihdr.data, 4);
    expect(crc32(typeAndData)).toBe(ihdr.crc);

    // inflate IDAT and defilter
    const raw = new Uint8Array(inflateSync(chunks[1].data));
    const stride = 2 * 4;
    const pixels = new Uint8Array(2 * 2 * 4);
    for (let y = 0; y < 2; y++) {
      const filter = raw[y * (stride + 1)];
      expect(filter).toBe(0); // filter type none
      pixels.set(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride), y * stride);
    }
    expect(Array.from(pixels)).toEqual(Array.from(rgba));
  });
});
