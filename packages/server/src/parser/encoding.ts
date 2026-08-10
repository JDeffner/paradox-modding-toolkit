// Encoding helpers for reading Paradox script / localization files.
//
// Paradox files are UTF-8 (often with a BOM). Some older or hand-edited files
// contain invalid UTF-8 byte sequences (typically Latin-1 / Windows-1252 text);
// for those we fall back to a latin1 decode so we still get usable text rather
// than U+FFFD replacement soup.

const UTF8_BOM_0 = 0xef;
const UTF8_BOM_1 = 0xbb;
const UTF8_BOM_2 = 0xbf;

export function hasUtf8Bom(buf: Uint8Array): boolean {
  return buf.length >= 3 && buf[0] === UTF8_BOM_0 && buf[1] === UTF8_BOM_1 && buf[2] === UTF8_BOM_2;
}

/**
 * Returns true if `buf` is entirely valid UTF-8 (ignoring a leading BOM).
 * Single pass, no allocations.
 */
export function isValidUtf8(buf: Uint8Array): boolean {
  let i = hasUtf8Bom(buf) ? 3 : 0;
  const len = buf.length;
  while (i < len) {
    const b0 = buf[i];
    if (b0 < 0x80) {
      i++;
      continue;
    }
    let extra: number;
    let min: number;
    let codepointHigh: number;
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      extra = 1;
      min = 0x80;
      codepointHigh = b0 & 0x1f;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      extra = 2;
      min = 0x800;
      codepointHigh = b0 & 0x0f;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      extra = 3;
      min = 0x10000;
      codepointHigh = b0 & 0x07;
    } else {
      // 0x80-0xC1 or 0xF5-0xFF: invalid lead byte.
      return false;
    }
    if (i + extra >= len) return false;
    let cp = codepointHigh;
    for (let k = 1; k <= extra; k++) {
      const b = buf[i + k];
      if ((b & 0xc0) !== 0x80) return false; // not a continuation byte
      cp = (cp << 6) | (b & 0x3f);
    }
    // Reject overlong encodings, surrogates, and out-of-range code points.
    if (cp < min) return false;
    if (cp >= 0xd800 && cp <= 0xdfff) return false;
    if (cp > 0x10ffff) return false;
    i += extra + 1;
  }
  return true;
}

/**
 * Decode a buffer to a string. Prefers UTF-8 (stripping a BOM). If the buffer
 * is not valid UTF-8, falls back to a latin1 decode and reports that.
 */
export function decode(buf: Uint8Array): {
  text: string;
  hadBom: boolean;
  encoding: "utf8" | "utf8-bom" | "latin1-fallback";
} {
  const bom = hasUtf8Bom(buf);
  if (isValidUtf8(buf)) {
    const body = bom ? buf.subarray(3) : buf;
    const text = utf8Decode(body);
    return { text, hadBom: bom, encoding: bom ? "utf8-bom" : "utf8" };
  }
  // latin1 fallback: each byte maps 1:1 to U+00xx.
  const text = latin1Decode(buf);
  return { text, hadBom: false, encoding: "latin1-fallback" };
}

function utf8Decode(body: Uint8Array): string {
  // Prefer Node's TextDecoder when available (fast, correct).
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8", { fatal: false }).decode(body);
  }
  // Fallback (should not be hit in Node/vitest): naive latin1.
  return latin1Decode(body);
}

function latin1Decode(buf: Uint8Array): string {
  // Build in chunks to avoid apply() stack limits on large buffers.
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, buf.length);
    let piece = "";
    for (let j = i; j < end; j++) {
      piece += String.fromCharCode(buf[j]);
    }
    out += piece;
  }
  return out;
}
