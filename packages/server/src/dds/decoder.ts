export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA8, row-major */
  pixels: Uint8Array;
}

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

const DDS_MAGIC = 0x20534444; // "DDS " little-endian

// DDS_PIXELFORMAT flags
const DDPF_ALPHAPIXELS = 0x1;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;
const DDPF_LUMINANCE = 0x20000;

function fourCC(a: string): number {
  return (
    ((a.charCodeAt(0) & 0xff) |
      ((a.charCodeAt(1) & 0xff) << 8) |
      ((a.charCodeAt(2) & 0xff) << 16) |
      ((a.charCodeAt(3) & 0xff) << 24)) >>>
    0
  );
}

const FOURCC_DXT1 = fourCC("DXT1");
const FOURCC_DXT2 = fourCC("DXT2");
const FOURCC_DXT3 = fourCC("DXT3");
const FOURCC_DXT4 = fourCC("DXT4");
const FOURCC_DXT5 = fourCC("DXT5");
const FOURCC_DX10 = fourCC("DX10");

// DXGI formats we care about
const enum Dxgi {
  R8G8B8A8_UNORM = 28,
  R8G8B8A8_UNORM_SRGB = 29,
  BC1_UNORM = 71,
  BC1_UNORM_SRGB = 72,
  BC2_UNORM = 74,
  BC2_UNORM_SRGB = 75,
  BC3_UNORM = 77,
  BC3_UNORM_SRGB = 78,
  B8G8R8A8_UNORM = 87,
  B8G8R8A8_UNORM_SRGB = 91,
  BC7_UNORM = 98,
  BC7_UNORM_SRGB = 99,
}

type Kind =
  | { k: "dxt1" }
  | { k: "dxt3" }
  | { k: "dxt5" }
  | { k: "bc7" }
  | { k: "bgra8"; hasAlpha: boolean } // A8R8G8B8 / X8R8G8B8 (BGRA byte order in file)
  | { k: "rgba8" } // DXGI R8G8B8A8
  | { k: "rgb8" }; // 24-bit R8G8B8

interface ParsedHeader {
  width: number;
  height: number;
  kind: Kind;
  /** byte offset of the first mip level's pixel/block data */
  dataOffset: number;
  formatName: string;
}

/**
 * Decode budget, in pixels. Every decoder allocates width*height*4 bytes of
 * RGBA out of dimensions the file declares, so the budget has to be per pixel:
 * a per-axis cap of 0x10000 still admits 65535x65535, which reserved 16.1 GB
 * (measured) before the data-length check could refuse it. 4096*4096 is the cap
 * the GUI editor's texture cache already applies (MAX_TEXTURE_PIXELS in
 * webviews/guiEditor/textureCache.ts), only after the decode instead of before.
 */
export const MAX_DECODE_PIXELS = 4096 * 4096;

function readU32(buf: Uint8Array, off: number): number {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

function parseHeader(buf: Uint8Array): ParsedHeader | null {
  // 4 (magic) + 124 (DDS_HEADER) = 128 bytes minimum
  if (buf.length < 128) return null;
  if (readU32(buf, 0) !== DDS_MAGIC) return null;

  const headerSize = readU32(buf, 4);
  if (headerSize !== 124) return null;

  const height = readU32(buf, 12);
  const width = readU32(buf, 16);
  if (width === 0 || height === 0) return null;
  // Throw rather than return null so ddsFormatInfo still reports the declared
  // size (its catch branch) and the caller can say why the preview is missing.
  if (width * height > MAX_DECODE_PIXELS) {
    throw new Error(`image too large: ${width}x${height} exceeds ${MAX_DECODE_PIXELS} pixels`);
  }

  // DDS_PIXELFORMAT starts at offset 76, size 32 bytes
  const pfOffset = 76;
  const pfFlags = readU32(buf, pfOffset + 4);
  const pfFourCC = readU32(buf, pfOffset + 8);
  const pfRgbBitCount = readU32(buf, pfOffset + 12);
  const pfRBitMask = readU32(buf, pfOffset + 16);
  const pfGBitMask = readU32(buf, pfOffset + 20);
  const pfBBitMask = readU32(buf, pfOffset + 24);
  const pfABitMask = readU32(buf, pfOffset + 28);

  let dataOffset = 128;
  let kind: Kind;
  let formatName: string;

  if (pfFlags & DDPF_FOURCC) {
    if (pfFourCC === FOURCC_DX10) {
      // DDS_HEADER_DXT10 (20 bytes) follows the main header
      if (buf.length < 148) return null;
      const dxgiFormat = readU32(buf, 128);
      dataOffset = 148;
      switch (dxgiFormat) {
        case Dxgi.BC1_UNORM:
        case Dxgi.BC1_UNORM_SRGB:
          kind = { k: "dxt1" };
          formatName = "BC1 (DX10)";
          break;
        case Dxgi.BC2_UNORM:
        case Dxgi.BC2_UNORM_SRGB:
          kind = { k: "dxt3" };
          formatName = "BC2 (DX10)";
          break;
        case Dxgi.BC3_UNORM:
        case Dxgi.BC3_UNORM_SRGB:
          kind = { k: "dxt5" };
          formatName = "BC3 (DX10)";
          break;
        case Dxgi.BC7_UNORM:
        case Dxgi.BC7_UNORM_SRGB:
          kind = { k: "bc7" };
          formatName = "BC7 (DX10)";
          break;
        case Dxgi.R8G8B8A8_UNORM:
        case Dxgi.R8G8B8A8_UNORM_SRGB:
          kind = { k: "rgba8" };
          formatName = "R8G8B8A8 (DX10)";
          break;
        case Dxgi.B8G8R8A8_UNORM:
        case Dxgi.B8G8R8A8_UNORM_SRGB:
          kind = { k: "bgra8", hasAlpha: true };
          formatName = "B8G8R8A8 (DX10)";
          break;
        default:
          throw new Error(`unsupported format: DXGI ${dxgiFormat}`);
      }
    } else {
      switch (pfFourCC) {
        case FOURCC_DXT1:
          kind = { k: "dxt1" };
          formatName = "DXT1";
          break;
        case FOURCC_DXT2:
        case FOURCC_DXT3:
          kind = { k: "dxt3" };
          formatName = "DXT3";
          break;
        case FOURCC_DXT4:
        case FOURCC_DXT5:
          kind = { k: "dxt5" };
          formatName = "DXT5";
          break;
        default: {
          const tag = String.fromCharCode(
            pfFourCC & 0xff,
            (pfFourCC >>> 8) & 0xff,
            (pfFourCC >>> 16) & 0xff,
            (pfFourCC >>> 24) & 0xff
          ).replace(/[^\x20-\x7e]/g, "?");
          throw new Error(`unsupported format: FourCC '${tag}'`);
        }
      }
    }
  } else if (pfFlags & DDPF_RGB) {
    if (pfRgbBitCount === 32) {
      // Expect BGRA byte order: R mask 0x00FF0000, G 0x0000FF00, B 0x000000FF
      const bgra = pfRBitMask === 0x00ff0000 && pfGBitMask === 0x0000ff00 && pfBBitMask === 0x000000ff;
      const rgba = pfRBitMask === 0x000000ff && pfGBitMask === 0x0000ff00 && pfBBitMask === 0x00ff0000;
      if (bgra) {
        kind = { k: "bgra8", hasAlpha: (pfFlags & DDPF_ALPHAPIXELS) !== 0 && pfABitMask !== 0 };
        formatName = pfABitMask ? "A8R8G8B8" : "X8R8G8B8";
      } else if (rgba) {
        kind = { k: "rgba8" };
        formatName = "A8B8G8R8";
      } else {
        throw new Error("unsupported format: 32-bit RGB with unusual masks");
      }
    } else if (pfRgbBitCount === 24) {
      // 24-bit: assume R8G8B8 in the common D3D order (B,G,R bytes)
      kind = { k: "rgb8" };
      formatName = "R8G8B8";
    } else {
      throw new Error(`unsupported format: ${pfRgbBitCount}-bit RGB`);
    }
  } else if (pfFlags & DDPF_LUMINANCE) {
    throw new Error("unsupported format: luminance");
  } else {
    throw new Error("unsupported format: unknown pixel format");
  }

  return { width, height, kind, dataOffset, formatName };
}

/** Cheap header peek: returns format name + dimensions, or null if not a DDS. */
export function ddsFormatInfo(buf: Uint8Array): { format: string; width: number; height: number } | null {
  let parsed: ParsedHeader | null;
  try {
    parsed = parseHeader(buf);
  } catch {
    // It IS a DDS but an unsupported format; still report what we can.
    if (buf.length >= 128 && readU32(buf, 0) === DDS_MAGIC) {
      const height = readU32(buf, 12);
      const width = readU32(buf, 16);
      return { format: "unsupported", width, height };
    }
    return null;
  }
  if (!parsed) return null;
  return { format: parsed.formatName, width: parsed.width, height: parsed.height };
}

// ---------------------------------------------------------------------------
// Block-compression decoders
// ---------------------------------------------------------------------------

/** Decode 5-6-5 color into RGB (each 0..255). */
function rgb565(c: number): [number, number, number] {
  const r = (c >> 11) & 0x1f;
  const g = (c >> 5) & 0x3f;
  const b = c & 0x1f;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

function putPixel(
  out: Uint8Array,
  width: number,
  height: number,
  px: number,
  py: number,
  r: number,
  g: number,
  b: number,
  a: number
): void {
  if (px >= width || py >= height) return;
  const o = (py * width + px) * 4;
  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
  out[o + 3] = a;
}

function decodeDxt1(buf: Uint8Array, off: number, width: number, height: number): Uint8Array {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const needed = off + blocksX * blocksY * 8;
  // Refuse before allocating: a truncated file must not reserve the full RGBA
  // buffer its header claims.
  if (needed > buf.length) throw new Error("truncated DXT1 data");
  const out = new Uint8Array(width * height * 4);

  let p = off;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const c0 = buf[p] | (buf[p + 1] << 8);
      const c1 = buf[p + 2] | (buf[p + 3] << 8);
      const bits = buf[p + 4] | (buf[p + 5] << 8) | (buf[p + 6] << 16) | (buf[p + 7] << 24);
      p += 8;

      const [r0, g0, b0] = rgb565(c0);
      const [r1, g1, b1] = rgb565(c1);
      const colors: [number, number, number, number][] = [
        [r0, g0, b0, 255],
        [r1, g1, b1, 255],
        [0, 0, 0, 255],
        [0, 0, 0, 255],
      ];
      if (c0 > c1) {
        colors[2] = [(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3, 255];
        colors[3] = [(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3, 255];
      } else {
        colors[2] = [(r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2, 255];
        colors[3] = [0, 0, 0, 0]; // transparent
      }

      for (let i = 0; i < 16; i++) {
        const idx = (bits >>> (i * 2)) & 0x3;
        const [r, g, b, a] = colors[idx];
        putPixel(out, width, height, bx * 4 + (i & 3), by * 4 + (i >> 2), r | 0, g | 0, b | 0, a);
      }
    }
  }
  return out;
}

/** Shared BC color block for DXT3/DXT5 (4-color mode, no 1-bit alpha). */
function decodeColorBlock565(buf: Uint8Array, p: number, outColors: [number, number, number][]): void {
  const c0 = buf[p] | (buf[p + 1] << 8);
  const c1 = buf[p + 2] | (buf[p + 3] << 8);
  const [r0, g0, b0] = rgb565(c0);
  const [r1, g1, b1] = rgb565(c1);
  outColors[0] = [r0, g0, b0];
  outColors[1] = [r1, g1, b1];
  outColors[2] = [(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3];
  outColors[3] = [(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3];
}

function decodeDxt3(buf: Uint8Array, off: number, width: number, height: number): Uint8Array {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  if (off + blocksX * blocksY * 16 > buf.length) throw new Error("truncated DXT3 data");
  const out = new Uint8Array(width * height * 4);

  const colors: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  let p = off;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      // 8 bytes explicit 4-bit alpha, then 8 bytes color block
      const alphaLo = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24);
      const alphaHi = buf[p + 4] | (buf[p + 5] << 8) | (buf[p + 6] << 16) | (buf[p + 7] << 24);
      decodeColorBlock565(buf, p + 8, colors);
      const bits = buf[p + 12] | (buf[p + 13] << 8) | (buf[p + 14] << 16) | (buf[p + 15] << 24);
      p += 16;

      for (let i = 0; i < 16; i++) {
        const idx = (bits >>> (i * 2)) & 0x3;
        const [r, g, b] = colors[idx];
        // 4-bit alpha nibble
        let a4: number;
        if (i < 8) a4 = (alphaLo >>> (i * 4)) & 0xf;
        else a4 = (alphaHi >>> ((i - 8) * 4)) & 0xf;
        const a = (a4 << 4) | a4;
        putPixel(out, width, height, bx * 4 + (i & 3), by * 4 + (i >> 2), r | 0, g | 0, b | 0, a);
      }
    }
  }
  return out;
}

function decodeDxt5(buf: Uint8Array, off: number, width: number, height: number): Uint8Array {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  if (off + blocksX * blocksY * 16 > buf.length) throw new Error("truncated DXT5 data");
  const out = new Uint8Array(width * height * 4);

  const colors: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const alpha = new Uint8Array(8);
  let p = off;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const a0 = buf[p];
      const a1 = buf[p + 1];
      alpha[0] = a0;
      alpha[1] = a1;
      if (a0 > a1) {
        alpha[2] = (6 * a0 + 1 * a1) / 7;
        alpha[3] = (5 * a0 + 2 * a1) / 7;
        alpha[4] = (4 * a0 + 3 * a1) / 7;
        alpha[5] = (3 * a0 + 4 * a1) / 7;
        alpha[6] = (2 * a0 + 5 * a1) / 7;
        alpha[7] = (1 * a0 + 6 * a1) / 7;
      } else {
        alpha[2] = (4 * a0 + 1 * a1) / 5;
        alpha[3] = (3 * a0 + 2 * a1) / 5;
        alpha[4] = (2 * a0 + 3 * a1) / 5;
        alpha[5] = (1 * a0 + 4 * a1) / 5;
        alpha[6] = 0;
        alpha[7] = 255;
      }
      // 6 bytes = 48 bits of 3-bit alpha indices
      const aLo = buf[p + 2] | (buf[p + 3] << 8) | (buf[p + 4] << 16); // 24 bits
      const aHi = buf[p + 5] | (buf[p + 6] << 8) | (buf[p + 7] << 16); // 24 bits

      decodeColorBlock565(buf, p + 8, colors);
      const bits = buf[p + 12] | (buf[p + 13] << 8) | (buf[p + 14] << 16) | (buf[p + 15] << 24);
      p += 16;

      for (let i = 0; i < 16; i++) {
        const idx = (bits >>> (i * 2)) & 0x3;
        const [r, g, b] = colors[idx];
        let aIdx: number;
        if (i < 8) aIdx = (aLo >>> (i * 3)) & 0x7;
        else aIdx = (aHi >>> ((i - 8) * 3)) & 0x7;
        putPixel(out, width, height, bx * 4 + (i & 3), by * 4 + (i >> 2), r | 0, g | 0, b | 0, alpha[aIdx]);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// BC7 decoder (full 8-mode)
// ---------------------------------------------------------------------------

// Partition tables (BC7 spec). 2-subset: 64 patterns; 3-subset: 64 patterns.
// Each entry is 16 subset indices (one per texel in row-major 4x4).
const BC7_PARTITIONS_2: number[][] = [
  [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1],
  [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
  [0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1],
  [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1],
  [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1],
  [0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1],
  [0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1],
  [0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1],
  [0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
  [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
  [0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1],
  [0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0],
  [0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0],
  [0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1],
  [0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0],
  [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0],
  [0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0],
  [0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0],
  [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
  [0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0],
  [0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0],
  [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
  [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1],
  [0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0],
  [0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0],
  [0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0],
  [0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0],
  [0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1],
  [0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1],
  [0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 0],
  [0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0],
  [0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0],
  [0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0],
  [0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1],
  [0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1],
  [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0],
  [0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0],
  [0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0],
  [0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1],
  [0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1],
  [0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0],
  [0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0],
  [0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1],
  [0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1],
  [0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1],
  [0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1],
  [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1],
  [0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0],
  [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1],
];

const BC7_PARTITIONS_3: number[][] = [
  [0, 0, 1, 1, 0, 0, 1, 1, 0, 2, 2, 1, 2, 2, 2, 2],
  [0, 0, 0, 1, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 2, 1],
  [0, 0, 0, 0, 2, 0, 0, 1, 2, 2, 1, 1, 2, 2, 1, 1],
  [0, 2, 2, 2, 0, 0, 2, 2, 0, 0, 1, 1, 0, 1, 1, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2],
  [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 2, 2, 0, 0, 2, 2],
  [0, 0, 2, 2, 0, 0, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1],
  [0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2],
  [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2],
  [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2],
  [0, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2],
  [0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2],
  [0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 2],
  [0, 0, 1, 1, 0, 1, 1, 2, 1, 1, 2, 2, 1, 2, 2, 2],
  [0, 0, 1, 1, 2, 0, 0, 1, 2, 2, 0, 0, 2, 2, 2, 0],
  [0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 2, 1, 1, 2, 2],
  [0, 1, 1, 1, 0, 0, 1, 1, 2, 0, 0, 1, 2, 2, 0, 0],
  [0, 0, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2],
  [0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 2, 2, 1, 1, 1, 1],
  [0, 1, 1, 1, 0, 1, 1, 1, 0, 2, 2, 2, 0, 2, 2, 2],
  [0, 0, 0, 1, 0, 0, 0, 1, 2, 2, 2, 1, 2, 2, 2, 1],
  [0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 2, 2, 0, 1, 2, 2],
  [0, 0, 0, 0, 1, 1, 0, 0, 2, 2, 1, 0, 2, 2, 1, 0],
  [0, 1, 2, 2, 0, 1, 2, 2, 0, 0, 1, 1, 0, 0, 0, 0],
  [0, 0, 1, 2, 0, 0, 1, 2, 1, 1, 2, 2, 2, 2, 2, 2],
  [0, 1, 1, 0, 1, 2, 2, 1, 1, 2, 2, 1, 0, 1, 1, 0],
  [0, 0, 0, 0, 0, 1, 1, 0, 1, 2, 2, 1, 1, 2, 2, 1],
  [0, 0, 2, 2, 1, 1, 0, 2, 1, 1, 0, 2, 0, 0, 2, 2],
  [0, 1, 1, 0, 0, 1, 1, 0, 2, 0, 0, 2, 2, 2, 2, 2],
  [0, 0, 1, 1, 0, 1, 2, 2, 0, 1, 2, 2, 0, 0, 1, 1],
  [0, 0, 0, 0, 2, 0, 0, 0, 2, 2, 1, 1, 2, 2, 2, 1],
  [0, 0, 0, 0, 0, 0, 0, 2, 1, 1, 2, 2, 1, 2, 2, 2],
  [0, 2, 2, 2, 0, 0, 2, 2, 0, 0, 1, 2, 0, 0, 1, 1],
  [0, 0, 1, 1, 0, 0, 1, 2, 0, 0, 2, 2, 0, 2, 2, 2],
  [0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 0],
  [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0],
  [0, 1, 2, 0, 2, 0, 1, 2, 1, 2, 0, 1, 0, 1, 2, 0],
  [0, 0, 1, 1, 2, 2, 0, 0, 1, 1, 2, 2, 0, 0, 1, 1],
  [0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0, 0, 1, 1],
  [0, 1, 0, 1, 0, 1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2],
  [0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 2, 1, 2, 1, 2, 1],
  [0, 0, 2, 2, 1, 1, 2, 2, 0, 0, 2, 2, 1, 1, 2, 2],
  [0, 0, 2, 2, 0, 0, 1, 1, 0, 0, 2, 2, 0, 0, 1, 1],
  [0, 2, 2, 0, 1, 2, 2, 1, 0, 2, 2, 0, 1, 2, 2, 1],
  [0, 1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 0, 1, 0, 1],
  [0, 0, 0, 0, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1],
  [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 2, 2, 2, 2],
  [0, 2, 2, 2, 0, 1, 1, 1, 0, 2, 2, 2, 0, 1, 1, 1],
  [0, 0, 0, 2, 1, 1, 1, 2, 0, 0, 0, 2, 1, 1, 1, 2],
  [0, 0, 0, 0, 2, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2],
  [0, 2, 2, 2, 0, 1, 1, 1, 0, 1, 1, 1, 0, 2, 2, 2],
  [0, 0, 0, 2, 1, 1, 1, 2, 1, 1, 1, 2, 0, 0, 0, 2],
  [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 2, 2, 2, 2],
  [0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 1, 2, 2, 1, 1, 2],
  [0, 1, 1, 0, 0, 1, 1, 0, 2, 2, 2, 2, 2, 2, 2, 2],
  [0, 0, 2, 2, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 2, 2],
  [0, 0, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2, 0, 0, 2, 2],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 1, 2],
  [0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1],
  [0, 2, 2, 2, 1, 2, 2, 2, 0, 2, 2, 2, 1, 2, 2, 2],
  [0, 1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  [0, 1, 1, 1, 2, 0, 1, 1, 2, 2, 0, 1, 2, 2, 2, 0],
];

// Anchor index tables (index that has an implicit high bit = 0).
const BC7_ANCHOR_2: number[] = [
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8,
  2, 2, 15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6, 6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2,
  2, 15,
];
const BC7_ANCHOR_3_1: number[] = [
  3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3, 3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5, 15, 15, 8,
  15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15, 15, 3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3,
];
const BC7_ANCHOR_3_2: number[] = [
  15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8, 15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6, 10, 15, 15,
  10, 8, 15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8, 15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
  3, 15, 15, 8,
];

interface Bc7ModeInfo {
  subsets: number;
  partitionBits: number;
  rotationBits: number;
  idxModeBits: number;
  colorBits: number;
  alphaBits: number;
  endpointPBits: number; // per-endpoint p-bit
  sharedPBits: number; // shared p-bit per subset (mode 1)
  indexBits: number;
  index2Bits: number;
}

// Per-mode configuration (modes 0..7).
const BC7_MODES: Bc7ModeInfo[] = [
  {
    subsets: 3,
    partitionBits: 4,
    rotationBits: 0,
    idxModeBits: 0,
    colorBits: 4,
    alphaBits: 0,
    endpointPBits: 1,
    sharedPBits: 0,
    indexBits: 3,
    index2Bits: 0,
  }, // 0
  {
    subsets: 2,
    partitionBits: 6,
    rotationBits: 0,
    idxModeBits: 0,
    colorBits: 6,
    alphaBits: 0,
    endpointPBits: 0,
    sharedPBits: 1,
    indexBits: 3,
    index2Bits: 0,
  }, // 1
  {
    subsets: 3,
    partitionBits: 6,
    rotationBits: 0,
    idxModeBits: 0,
    colorBits: 5,
    alphaBits: 0,
    endpointPBits: 0,
    sharedPBits: 0,
    indexBits: 2,
    index2Bits: 0,
  }, // 2
  {
    subsets: 2,
    partitionBits: 6,
    rotationBits: 0,
    idxModeBits: 0,
    colorBits: 7,
    alphaBits: 0,
    endpointPBits: 1,
    sharedPBits: 0,
    indexBits: 2,
    index2Bits: 0,
  }, // 3
  {
    subsets: 1,
    partitionBits: 0,
    rotationBits: 2,
    idxModeBits: 1,
    colorBits: 5,
    alphaBits: 6,
    endpointPBits: 0,
    sharedPBits: 0,
    indexBits: 2,
    index2Bits: 3,
  }, // 4
  {
    subsets: 1,
    partitionBits: 0,
    rotationBits: 2,
    idxModeBits: 0,
    colorBits: 7,
    alphaBits: 8,
    endpointPBits: 0,
    sharedPBits: 0,
    indexBits: 2,
    index2Bits: 2,
  }, // 5
  {
    subsets: 1,
    partitionBits: 0,
    rotationBits: 0,
    idxModeBits: 0,
    colorBits: 7,
    alphaBits: 7,
    endpointPBits: 1,
    sharedPBits: 0,
    indexBits: 4,
    index2Bits: 0,
  }, // 6
  {
    subsets: 2,
    partitionBits: 6,
    rotationBits: 0,
    idxModeBits: 0,
    colorBits: 5,
    alphaBits: 5,
    endpointPBits: 1,
    sharedPBits: 0,
    indexBits: 2,
    index2Bits: 0,
  }, // 7
];

/** Little-endian bit reader over a 16-byte block. */
class BitReader {
  private bytes: Uint8Array;
  private pos = 0; // bit position
  constructor(bytes: Uint8Array, offset: number) {
    this.bytes = bytes.subarray(offset, offset + 16);
  }
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const bit = (this.bytes[this.pos >> 3] >> (this.pos & 7)) & 1;
      v |= bit << i;
      this.pos++;
    }
    return v >>> 0;
  }
  get bitPos(): number {
    return this.pos;
  }
}

function bc7Interp(e0: number, e1: number, index: number, indexBits: number): number {
  // interpolation weights
  const W2 = [0, 21, 43, 64];
  const W3 = [0, 9, 18, 27, 37, 46, 55, 64];
  const W4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];
  const w = indexBits === 2 ? W2[index] : indexBits === 3 ? W3[index] : W4[index];
  return (e0 * (64 - w) + e1 * w + 32) >> 6;
}

function decodeBc7Block(
  buf: Uint8Array,
  off: number,
  out: Uint8Array,
  bx: number,
  by: number,
  width: number,
  height: number
): void {
  const br = new BitReader(buf, off);

  // Find mode: number of leading zero bits before the first 1.
  let mode = 0;
  while (mode < 8 && br.read(1) === 0) mode++;
  if (mode === 8) {
    // Invalid block -> fill transparent black
    for (let i = 0; i < 16; i++) {
      putPixel(out, width, height, bx * 4 + (i & 3), by * 4 + (i >> 2), 0, 0, 0, 0);
    }
    return;
  }

  const info = BC7_MODES[mode];
  const numSubsets = info.subsets;

  const partition = info.partitionBits > 0 ? br.read(info.partitionBits) : 0;
  const rotation = info.rotationBits > 0 ? br.read(info.rotationBits) : 0;
  const idxMode = info.idxModeBits > 0 ? br.read(info.idxModeBits) : 0;

  const numEndpoints = numSubsets * 2;

  // Read endpoint color components (R, G, B), then alpha if present.
  const r: number[] = new Array(numEndpoints);
  const g: number[] = new Array(numEndpoints);
  const b: number[] = new Array(numEndpoints);
  const a: number[] = new Array(numEndpoints).fill(255);

  for (let i = 0; i < numEndpoints; i++) r[i] = br.read(info.colorBits);
  for (let i = 0; i < numEndpoints; i++) g[i] = br.read(info.colorBits);
  for (let i = 0; i < numEndpoints; i++) b[i] = br.read(info.colorBits);
  if (info.alphaBits > 0) {
    for (let i = 0; i < numEndpoints; i++) a[i] = br.read(info.alphaBits);
  }

  // P-bits
  const pbits: number[] = new Array(numEndpoints).fill(0);
  if (info.endpointPBits > 0) {
    for (let i = 0; i < numEndpoints; i++) pbits[i] = br.read(1);
  } else if (info.sharedPBits > 0) {
    // one p-bit per subset, shared by its 2 endpoints
    for (let s = 0; s < numSubsets; s++) {
      const pb = br.read(1);
      pbits[s * 2] = pb;
      pbits[s * 2 + 1] = pb;
    }
  }

  // Assemble full-precision endpoints (unquantize).
  const colorPrec = info.colorBits + (info.endpointPBits > 0 || info.sharedPBits > 0 ? 1 : 0);
  const alphaPrec =
    info.alphaBits + (info.alphaBits > 0 && (info.endpointPBits > 0 || info.sharedPBits > 0) ? 1 : 0);

  function unquant(val: number, bits: number, pbit: number, usePbit: boolean): number {
    let v = val;
    let precision = bits;
    if (usePbit) {
      v = (v << 1) | pbit;
      precision += 1;
    }
    // shift up to 8 bits and replicate high bits
    v = v << (8 - precision);
    v |= v >> precision;
    return v & 0xff;
  }

  const usePbit = info.endpointPBits > 0 || info.sharedPBits > 0;
  const R = new Array(numEndpoints);
  const G = new Array(numEndpoints);
  const B = new Array(numEndpoints);
  const A = new Array(numEndpoints);
  for (let i = 0; i < numEndpoints; i++) {
    R[i] = unquant(r[i], info.colorBits, pbits[i], usePbit);
    G[i] = unquant(g[i], info.colorBits, pbits[i], usePbit);
    B[i] = unquant(b[i], info.colorBits, pbits[i], usePbit);
    if (info.alphaBits > 0) {
      A[i] = unquant(a[i], info.alphaBits, pbits[i], usePbit);
    } else {
      A[i] = 255;
    }
  }
  void colorPrec;
  void alphaPrec;

  // Determine partition indices per texel.
  let partTable: number[];
  if (numSubsets === 1) {
    partTable = new Array(16).fill(0);
  } else if (numSubsets === 2) {
    partTable = BC7_PARTITIONS_2[partition];
  } else {
    partTable = BC7_PARTITIONS_3[partition];
  }

  // Anchor indices per subset.
  const anchors: number[] = [0];
  if (numSubsets === 2) {
    anchors.push(BC7_ANCHOR_2[partition]);
  } else if (numSubsets === 3) {
    anchors.push(BC7_ANCHOR_3_1[partition]);
    anchors.push(BC7_ANCHOR_3_2[partition]);
  }
  function isAnchor(texel: number): boolean {
    for (let s = 0; s < numSubsets; s++) if (anchors[s] === texel) return true;
    return false;
  }

  // Read color indices (and alpha indices for modes 4/5).
  const colorIdx = new Array(16).fill(0);
  const alphaIdx = new Array(16).fill(0);

  const primaryBits = info.indexBits;
  for (let i = 0; i < 16; i++) {
    // anchor texels lose the MSB
    const bits = isAnchorForSubset(i, partTable, anchors) ? primaryBits - 1 : primaryBits;
    colorIdx[i] = br.read(bits);
  }

  const hasSecondary = info.index2Bits > 0;
  if (hasSecondary) {
    // for modes 4/5, the second index set is for the single subset, anchor = texel 0
    for (let i = 0; i < 16; i++) {
      const bits = i === 0 ? info.index2Bits - 1 : info.index2Bits;
      alphaIdx[i] = br.read(bits);
    }
  }
  void isAnchor;

  // Emit pixels.
  for (let i = 0; i < 16; i++) {
    const subset = partTable[i];
    const e0 = subset * 2;
    const e1 = subset * 2 + 1;

    let outR: number;
    let outG: number;
    let outB: number;
    let outA: number;

    if (hasSecondary) {
      // mode 4/5: color uses indexBits (or swapped by idxMode), alpha uses index2Bits
      let cIdxBits = info.indexBits;
      let aIdxBits = info.index2Bits;
      let cIdxVal = colorIdx[i];
      let aIdxVal = alphaIdx[i];
      if (idxMode === 1) {
        // swap roles
        [cIdxBits, aIdxBits] = [aIdxBits, cIdxBits];
        [cIdxVal, aIdxVal] = [aIdxVal, cIdxVal];
      }
      outR = bc7Interp(R[e0], R[e1], cIdxVal, cIdxBits);
      outG = bc7Interp(G[e0], G[e1], cIdxVal, cIdxBits);
      outB = bc7Interp(B[e0], B[e1], cIdxVal, cIdxBits);
      outA = bc7Interp(A[e0], A[e1], aIdxVal, aIdxBits);
    } else {
      const idx = colorIdx[i];
      outR = bc7Interp(R[e0], R[e1], idx, primaryBits);
      outG = bc7Interp(G[e0], G[e1], idx, primaryBits);
      outB = bc7Interp(B[e0], B[e1], idx, primaryBits);
      outA = info.alphaBits > 0 ? bc7Interp(A[e0], A[e1], idx, primaryBits) : 255;
    }

    // Apply rotation (swaps a channel with alpha).
    if (rotation === 1) {
      [outA, outR] = [outR, outA];
    } else if (rotation === 2) {
      [outA, outG] = [outG, outA];
    } else if (rotation === 3) {
      [outA, outB] = [outB, outA];
    }

    putPixel(out, width, height, bx * 4 + (i & 3), by * 4 + (i >> 2), outR, outG, outB, outA);
  }
}

/** Is texel `i` an anchor of the subset it belongs to? Anchors drop their index MSB. */
function isAnchorForSubset(i: number, partTable: number[], anchors: number[]): boolean {
  const subset = partTable[i];
  return anchors[subset] === i;
}

function decodeBc7(buf: Uint8Array, off: number, width: number, height: number): Uint8Array {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  if (off + blocksX * blocksY * 16 > buf.length) throw new Error("truncated BC7 data");
  const out = new Uint8Array(width * height * 4);
  let p = off;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      decodeBc7Block(buf, p, out, bx, by, width, height);
      p += 16;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Uncompressed decoders
// ---------------------------------------------------------------------------

function decodeBgra8(
  buf: Uint8Array,
  off: number,
  width: number,
  height: number,
  hasAlpha: boolean
): Uint8Array {
  const need = off + width * height * 4;
  if (need > buf.length) throw new Error("truncated BGRA8 data");
  const out = new Uint8Array(width * height * 4);
  let s = off;
  for (let i = 0; i < width * height; i++) {
    const bch = buf[s];
    const gch = buf[s + 1];
    const rch = buf[s + 2];
    const ach = buf[s + 3];
    s += 4;
    const o = i * 4;
    out[o] = rch;
    out[o + 1] = gch;
    out[o + 2] = bch;
    out[o + 3] = hasAlpha ? ach : 255;
  }
  return out;
}

function decodeRgba8(buf: Uint8Array, off: number, width: number, height: number): Uint8Array {
  const need = off + width * height * 4;
  if (need > buf.length) throw new Error("truncated RGBA8 data");
  const out = new Uint8Array(width * height * 4);
  out.set(buf.subarray(off, need));
  return out;
}

function decodeRgb8(buf: Uint8Array, off: number, width: number, height: number): Uint8Array {
  const need = off + width * height * 3;
  if (need > buf.length) throw new Error("truncated RGB8 data");
  const out = new Uint8Array(width * height * 4);
  let s = off;
  for (let i = 0; i < width * height; i++) {
    // D3DFMT_R8G8B8 is stored B,G,R in memory
    const bch = buf[s];
    const gch = buf[s + 1];
    const rch = buf[s + 2];
    s += 3;
    const o = i * 4;
    out[o] = rch;
    out[o + 1] = gch;
    out[o + 2] = bch;
    out[o + 3] = 255;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Decode the top mip / first array slice of a DDS to RGBA8. Throws on unsupported formats. */
export function decodeDds(buf: Uint8Array): DecodedImage {
  const parsed = parseHeader(buf);
  if (!parsed) throw new Error("not a valid DDS file");
  const { width, height, kind, dataOffset } = parsed;

  let pixels: Uint8Array;
  switch (kind.k) {
    case "dxt1":
      pixels = decodeDxt1(buf, dataOffset, width, height);
      break;
    case "dxt3":
      pixels = decodeDxt3(buf, dataOffset, width, height);
      break;
    case "dxt5":
      pixels = decodeDxt5(buf, dataOffset, width, height);
      break;
    case "bc7":
      pixels = decodeBc7(buf, dataOffset, width, height);
      break;
    case "bgra8":
      pixels = decodeBgra8(buf, dataOffset, width, height, kind.hasAlpha);
      break;
    case "rgba8":
      pixels = decodeRgba8(buf, dataOffset, width, height);
      break;
    case "rgb8":
      pixels = decodeRgb8(buf, dataOffset, width, height);
      break;
  }
  return { width, height, pixels };
}
