import { describe, it, expect } from "vitest";
import { parseLoc } from "../../src/parser/index";

describe("parseLoc — happy path", () => {
  it("parses header, versioned + unversioned entries, escapes, trailing comments", () => {
    const text =
      "l_english:\n" +
      ' my_key:0 "value with $variables$, [GetPlayer.GetName], #bold#!, £gold£ icons"\n' +
      ' other_key: "no version number"   # trailing comment\n' +
      ' escaped:1 "he said \\"hi\\" to me"\n';
    const res = parseLoc(text);
    expect(res.language).toBe("english");
    expect(res.errors).toHaveLength(0);
    expect(res.entries).toHaveLength(3);

    const [k0, k1, k2] = res.entries;
    expect(k0.key).toBe("my_key");
    expect(k0.version).toBe(0);
    expect(text.slice(k0.valueRange.start, k0.valueRange.end)).toBe(
      "value with $variables$, [GetPlayer.GetName], #bold#!, £gold£ icons"
    );

    expect(k1.key).toBe("other_key");
    expect(k1.version).toBeNull();
    expect(text.slice(k1.valueRange.start, k1.valueRange.end)).toBe("no version number");

    expect(k2.key).toBe("escaped");
    expect(k2.version).toBe(1);
    // value range covers text inside quotes (escapes not unescaped)
    expect(text.slice(k2.valueRange.start, k2.valueRange.end)).toBe('he said \\"hi\\" to me');
  });

  it("key ranges slice out the key exactly", () => {
    const text = 'l_english:\n my.key-name:0 "v"\n';
    const res = parseLoc(text);
    const e = res.entries[0];
    expect(text.slice(e.keyRange.start, e.keyRange.end)).toBe("my.key-name");
  });
});

describe("parseLoc — inner quotes (value closes at the LAST quote on the line)", () => {
  it("doubled-quote speech idiom keeps the literal quotes", () => {
    // Shape of CK3 coronation_events.1004.bribe / Vic3 cholera.1.f.
    const text = 'l_english:\n bribe:0 ""How much for your silence?""\n';
    const res = parseLoc(text);
    expect(res.errors).toHaveLength(0);
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0].value).toBe('"How much for your silence?"');
    expect(text.slice(res.entries[0].valueRange.start, res.entries[0].valueRange.end)).toBe(
      '"How much for your silence?"'
    );
  });

  it("doubled-quote value followed by a trailing comment", () => {
    const text = 'l_english:\n cholera.1.f:0 ""The result of the inquiry."" # John Snow\n';
    const res = parseLoc(text);
    expect(res.errors).toHaveLength(0);
    expect(res.entries[0].value).toBe('"The result of the inquiry."');
  });

  it("bare quotes mid-value survive", () => {
    const text = 'l_english:\n k:0 "My opponent yawns. "More of a challenge, please." Then silence."\n';
    const res = parseLoc(text);
    expect(res.errors).toHaveLength(0);
    expect(res.entries[0].value).toBe('My opponent yawns. "More of a challenge, please." Then silence.');
  });

  it("genuinely empty value stays empty", () => {
    const text = 'l_english:\n coronation_phase_feast_desc: ""\n with_comment: "" # note\n';
    const res = parseLoc(text);
    expect(res.errors).toHaveLength(0);
    expect(res.entries).toHaveLength(2);
    expect(res.entries[0].value).toBe("");
    expect(res.entries[1].value).toBe("");
  });
});

describe("parseLoc — BOM", () => {
  it("hadBom true and offsets still line up", () => {
    const text = '﻿l_english:\n key:0 "hello"\n';
    const res = parseLoc(text);
    expect(res.hadBom).toBe(true);
    expect(res.language).toBe("english");
    expect(res.entries).toHaveLength(1);
    expect(text.slice(res.entries[0].valueRange.start, res.entries[0].valueRange.end)).toBe("hello");
  });

  it("hadBom false when no BOM", () => {
    const res = parseLoc('l_english:\n key:0 "hi"\n');
    expect(res.hadBom).toBe(false);
  });
});

describe("parseLoc — errors", () => {
  it("tab-indent error", () => {
    const text = 'l_english:\n\tkey:0 "v"\n';
    const res = parseLoc(text);
    expect(res.errors.some((e) => e.code === "tab-indent")).toBe(true);
  });

  it("missing header", () => {
    const res = parseLoc(' key:0 "v"\n');
    expect(res.errors.some((e) => e.code === "no-header")).toBe(true);
    expect(res.language).toBeNull();
  });

  it("content before header", () => {
    const text = 'garbage line\nl_english:\n key:0 "v"\n';
    const res = parseLoc(text);
    expect(res.errors.some((e) => e.code === "content-before-header")).toBe(true);
    expect(res.language).toBe("english");
    expect(res.entries).toHaveLength(1);
  });

  it("bad entry", () => {
    const text = 'l_english:\n this is not an entry\n key:0 "ok"\n';
    const res = parseLoc(text);
    expect(res.errors.some((e) => e.code === "bad-entry")).toBe(true);
    expect(res.entries).toHaveLength(1);
  });

  it("unterminated value", () => {
    const text = 'l_english:\n key:0 "no closing quote\n';
    const res = parseLoc(text);
    expect(res.errors.some((e) => e.code === "unterminated-value")).toBe(true);
  });

  it("comments and blank lines are ignored", () => {
    const text = '# top comment\nl_english:\n\n # indented comment\n key:0 "v"\n\n';
    const res = parseLoc(text);
    expect(res.errors).toHaveLength(0);
    expect(res.entries).toHaveLength(1);
  });
});
