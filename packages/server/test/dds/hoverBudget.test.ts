/**
 * Texture-hover data-URI budget: the converter's own DDS output must never
 * produce a hover image URI that overflows VS Code's 100_000-char hover
 * truncation (see ddsToPngDataUri). A noisy 1592x848 event scene through any
 * supported encode format deflates to a large PNG; the budget must shrink the
 * preview so the emitted URI stays under the cap, and never emit a raw URI over
 * it. Regression guard for the "raw base64 spills into the hover" bug.
 */
import { describe, expect, it } from "vitest";
import { encodeDds, ddsToPngDataUri, decodeDds, type DdsEncodeFormat } from "../../src/dds";

/** Deterministic full-entropy RGBA (worst case for PNG deflate). */
function noisyRgba(w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  let s = 123456789 >>> 0;
  const rnd = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s & 0xff;
  };
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = rnd();
    out[i * 4 + 1] = rnd();
    out[i * 4 + 2] = rnd();
    out[i * 4 + 3] = 255;
  }
  return out;
}

const CAP = 90_000; // ddsToPngDataUri default budget, comfortably under VS Code's 100_000.

describe("texture hover data-URI budget", () => {
  const W = 1592;
  const H = 848;
  const rgba = noisyRgba(W, H);

  for (const fmt of ["bc1", "bc3", "bgra8"] as const satisfies readonly DdsEncodeFormat[]) {
    it(`noisy ${W}x${H} ${fmt} stays under the cap`, () => {
      const dds = encodeDds(W, H, rgba, fmt);
      // Decodes at full dimensions (sanity: header/format are sound).
      expect(decodeDds(dds).width).toBe(W);
      const uri = ddsToPngDataUri(dds);
      expect(uri).not.toBeNull();
      expect(uri!.startsWith("data:image/png;base64,")).toBe(true);
      expect(uri!.length).toBeLessThanOrEqual(CAP);
    });
  }

  it("respects an explicit tiny budget and can bottom out to null", () => {
    const dds = encodeDds(64, 64, noisyRgba(64, 64), "bgra8");
    // Absurdly small cap no PNG can meet → degrade signal for the hover.
    expect(ddsToPngDataUri(dds, 256, 200)).toBeNull();
  });
});
