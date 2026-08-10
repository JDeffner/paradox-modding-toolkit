/**
 * DDS encoder for the image → DDS converter: uncompressed A8R8G8B8 plus BC1
 * (DXT1) and BC3 (DXT5) via classic range-fit block compression — compact,
 * dependency-free, and good enough for GUI icons/illustrations. Round-trip
 * tested against decoder.ts.
 *
 * No `vscode` imports: unit-tested in plain Node, used by the client host.
 */

export type DdsEncodeFormat = "bc1" | "bc3" | "bgra8";

const DDSD_CAPS = 0x1;
const DDSD_HEIGHT = 0x2;
const DDSD_WIDTH = 0x4;
const DDSD_PITCH = 0x8;
const DDSD_PIXELFORMAT = 0x1000;
const DDSD_LINEARSIZE = 0x80000;
const DDPF_ALPHAPIXELS = 0x1;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;
const DDSCAPS_TEXTURE = 0x1000;

function fourCC(s: string): number {
  return (s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24)) >>> 0;
}

/** True when any pixel has alpha < 255 — drives the "auto" format choice. */
export function hasTransparency(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return true;
  return false;
}

/** Encode RGBA8 pixels as a DDS file (no mipmaps). */
export function encodeDds(
  width: number,
  height: number,
  rgba: Uint8Array,
  format: DdsEncodeFormat
): Uint8Array {
  if (rgba.length < width * height * 4) throw new Error("pixel buffer too small");
  const data =
    format === "bgra8" ? encodeBgra(width, height, rgba) : encodeBlocks(width, height, rgba, format);

  const header = new Uint8Array(128);
  const dv = new DataView(header.buffer);
  dv.setUint32(0, fourCC("DDS "), true);
  dv.setUint32(4, 124, true); // dwSize
  const compressed = format !== "bgra8";
  dv.setUint32(
    8,
    DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PIXELFORMAT | (compressed ? DDSD_LINEARSIZE : DDSD_PITCH),
    true
  );
  dv.setUint32(12, height, true);
  dv.setUint32(16, width, true);
  dv.setUint32(20, compressed ? data.length : width * 4, true); // linear size / pitch
  // depth, mipmaps, 11 reserved dwords stay 0
  const pf = 76; // pixel-format struct offset
  dv.setUint32(pf, 32, true); // pf size
  if (format === "bc1") {
    dv.setUint32(pf + 4, DDPF_FOURCC, true);
    dv.setUint32(pf + 8, fourCC("DXT1"), true);
  } else if (format === "bc3") {
    dv.setUint32(pf + 4, DDPF_FOURCC, true);
    dv.setUint32(pf + 8, fourCC("DXT5"), true);
  } else {
    dv.setUint32(pf + 4, DDPF_RGB | DDPF_ALPHAPIXELS, true);
    dv.setUint32(pf + 12, 32, true); // bit count
    dv.setUint32(pf + 16, 0x00ff0000, true); // R
    dv.setUint32(pf + 20, 0x0000ff00, true); // G
    dv.setUint32(pf + 24, 0x000000ff, true); // B
    dv.setUint32(pf + 28, 0xff000000, true); // A
  }
  dv.setUint32(108, DDSCAPS_TEXTURE, true);

  const out = new Uint8Array(128 + data.length);
  out.set(header, 0);
  out.set(data, 128);
  return out;
}

function encodeBgra(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = rgba[i * 4 + 2]; // B
    out[i * 4 + 1] = rgba[i * 4 + 1]; // G
    out[i * 4 + 2] = rgba[i * 4]; // R
    out[i * 4 + 3] = rgba[i * 4 + 3]; // A
  }
  return out;
}

function encodeBlocks(width: number, height: number, rgba: Uint8Array, format: "bc1" | "bc3"): Uint8Array {
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  const blockSize = format === "bc1" ? 8 : 16;
  const out = new Uint8Array(bw * bh * blockSize);
  const px = new Uint8Array(64); // 16 RGBA pixels
  let offset = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      // Gather the 4x4 block, clamping at edges.
      for (let y = 0; y < 4; y++) {
        const sy = Math.min(height - 1, by * 4 + y);
        for (let x = 0; x < 4; x++) {
          const sx = Math.min(width - 1, bx * 4 + x);
          const so = (sy * width + sx) * 4;
          const d = (y * 4 + x) * 4;
          px[d] = rgba[so];
          px[d + 1] = rgba[so + 1];
          px[d + 2] = rgba[so + 2];
          px[d + 3] = rgba[so + 3];
        }
      }
      if (format === "bc3") {
        writeAlphaBlock(px, out, offset);
        offset += 8;
      }
      writeColorBlock(px, out, offset);
      offset += 8;
    }
  }
  return out;
}

function to565(r: number, g: number, b: number): number {
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

function from565(c: number): [number, number, number] {
  const r = (c >> 11) & 0x1f;
  const g = (c >> 5) & 0x3f;
  const b = c & 0x1f;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

/**
 * Range-fit BC1 color block (always 4-color mode: c0 > c1). Endpoints are the
 * extremes of the block's principal luminance ordering; each pixel snaps to
 * the nearest of the 4 palette entries.
 */
function writeColorBlock(px: Uint8Array, out: Uint8Array, offset: number): void {
  // Find the two extreme pixels by projecting on the max-variance axis
  // (approximated by luminance — adequate for icon/illustration content).
  let minL = Infinity;
  let maxL = -Infinity;
  let minI = 0;
  let maxI = 0;
  for (let i = 0; i < 16; i++) {
    const l = px[i * 4] * 3 + px[i * 4 + 1] * 6 + px[i * 4 + 2];
    if (l < minL) {
      minL = l;
      minI = i;
    }
    if (l > maxL) {
      maxL = l;
      maxI = i;
    }
  }
  let c0 = to565(px[maxI * 4], px[maxI * 4 + 1], px[maxI * 4 + 2]);
  let c1 = to565(px[minI * 4], px[minI * 4 + 1], px[minI * 4 + 2]);
  if (c0 < c1) {
    const t = c0;
    c0 = c1;
    c1 = t;
  } else if (c0 === c1 && c1 > 0) {
    c1 = c1 - 1; // keep 4-color mode; palette entry 0 still matches exactly
  }
  const [r0, g0, b0] = from565(c0);
  const [r1, g1, b1] = from565(c1);
  const palette = [
    [r0, g0, b0],
    [r1, g1, b1],
    [(2 * r0 + r1 + 1) / 3, (2 * g0 + g1 + 1) / 3, (2 * b0 + b1 + 1) / 3],
    [(r0 + 2 * r1 + 1) / 3, (g0 + 2 * g1 + 1) / 3, (b0 + 2 * b1 + 1) / 3],
  ];
  let indices = 0;
  for (let i = 0; i < 16; i++) {
    let best = 0;
    let bestD = Infinity;
    for (let p = 0; p < 4; p++) {
      const dr = px[i * 4] - palette[p][0];
      const dg = px[i * 4 + 1] - palette[p][1];
      const db = px[i * 4 + 2] - palette[p][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    indices |= best << (i * 2);
  }
  const dv = new DataView(out.buffer, out.byteOffset + offset, 8);
  dv.setUint16(0, c0, true);
  dv.setUint16(2, c1, true);
  dv.setUint32(4, indices >>> 0, true);
}

/** BC3 alpha block: a0 > a1 (8-level) range fit with 3-bit indices. */
function writeAlphaBlock(px: Uint8Array, out: Uint8Array, offset: number): void {
  let a0 = 0;
  let a1 = 255;
  for (let i = 0; i < 16; i++) {
    const a = px[i * 4 + 3];
    if (a > a0) a0 = a;
    if (a < a1) a1 = a;
  }
  if (a0 === a1) {
    // Uniform alpha: endpoints equal would flip to the 6-level mode; nudge.
    if (a0 < 255) a0 = a0 + 1;
    else a1 = a1 - 1;
  }
  const palette = [a0, a1];
  for (let i = 1; i <= 6; i++) palette.push(Math.round(((7 - i) * a0 + i * a1) / 7));
  const idx: number[] = [];
  for (let i = 0; i < 16; i++) {
    const a = px[i * 4 + 3];
    let best = 0;
    let bestD = Infinity;
    for (let p = 0; p < 8; p++) {
      const d = Math.abs(a - palette[p]);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    idx.push(best);
  }
  out[offset] = a0;
  out[offset + 1] = a1;
  // Pack 16 × 3-bit indices little-endian into 6 bytes.
  let bits = 0n;
  for (let i = 15; i >= 0; i--) bits = (bits << 3n) | BigInt(idx[i]);
  for (let i = 0; i < 6; i++) out[offset + 2 + i] = Number((bits >> BigInt(i * 8)) & 0xffn);
}
