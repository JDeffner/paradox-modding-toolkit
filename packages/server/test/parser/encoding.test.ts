import { describe, it, expect } from "vitest";
import { hasUtf8Bom, isValidUtf8, decode } from "../../src/parser/index";

function bytes(...b: number[]): Uint8Array {
  return new Uint8Array(b);
}

describe("encoding", () => {
  it("detects UTF-8 BOM", () => {
    expect(hasUtf8Bom(bytes(0xef, 0xbb, 0xbf, 0x41))).toBe(true);
    expect(hasUtf8Bom(bytes(0x41, 0x42))).toBe(false);
    expect(hasUtf8Bom(bytes())).toBe(false);
  });

  it("validates UTF-8", () => {
    const utf8 = new TextEncoder().encode("héllo £ € 𝔘 中文");
    expect(isValidUtf8(utf8)).toBe(true);
    // valid with BOM
    const withBom = bytes(0xef, 0xbb, 0xbf, ...utf8);
    expect(isValidUtf8(withBom)).toBe(true);
    // invalid: lone continuation byte
    expect(isValidUtf8(bytes(0x80))).toBe(false);
    // invalid: 0xC0 overlong
    expect(isValidUtf8(bytes(0xc0, 0x80))).toBe(false);
    // invalid: truncated multibyte
    expect(isValidUtf8(bytes(0xe2, 0x82))).toBe(false);
  });

  it("decodes plain UTF-8", () => {
    const r = decode(new TextEncoder().encode("hello"));
    expect(r.text).toBe("hello");
    expect(r.hadBom).toBe(false);
    expect(r.encoding).toBe("utf8");
  });

  it("decodes UTF-8 with BOM and strips it", () => {
    const body = new TextEncoder().encode("l_english:");
    const r = decode(bytes(0xef, 0xbb, 0xbf, ...body));
    expect(r.text).toBe("l_english:");
    expect(r.hadBom).toBe(true);
    expect(r.encoding).toBe("utf8-bom");
    expect(r.text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("falls back to latin1 on invalid UTF-8", () => {
    // 0xE9 = é in Latin-1, invalid as a lone UTF-8 lead byte here
    const r = decode(bytes(0x63, 0x61, 0x66, 0xe9)); // "caf" + 0xE9
    expect(r.encoding).toBe("latin1-fallback");
    expect(r.text).toBe("café");
    expect(r.hadBom).toBe(false);
  });
});
