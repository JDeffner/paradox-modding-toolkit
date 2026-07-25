import { describe, expect, it } from "vitest";
import {
  buildTranslation,
  detectLocFileLanguage,
  mergeTranslation,
  retargetLocPath,
} from "../src/translationCore";

const BOM = "﻿";

describe("detectLocFileLanguage", () => {
  it("detects from the filename marker", () => {
    expect(detectLocFileLanguage("localization\\english\\my_mod_l_english.yml")).toBe("english");
    expect(detectLocFileLanguage("localization/whatever/foo_l_simp_chinese.yml")).toBe("simp_chinese");
  });
  it("falls back to a path segment", () => {
    expect(detectLocFileLanguage("localization\\german\\odd_name.yml")).toBe("german");
    expect(detectLocFileLanguage("localization\\odd_name.yml")).toBeNull();
  });
});

describe("retargetLocPath", () => {
  it("retargets folder segment and filename marker", () => {
    expect(retargetLocPath("F:\\mod\\localization\\english\\a_l_english.yml", "english", "german")).toBe(
      "F:\\mod\\localization\\german\\a_l_german.yml"
    );
  });
  it("handles replace folders and filename-only markers", () => {
    expect(retargetLocPath("F:\\mod\\localization\\replace\\english\\b.yml", "english", "french")).toBe(
      "F:\\mod\\localization\\replace\\french\\b.yml"
    );
    expect(retargetLocPath("F:\\mod\\localization\\c_l_english.yml", "english", "french")).toBe(
      "F:\\mod\\localization\\c_l_french.yml"
    );
  });
  it("returns null when nothing marks the language", () => {
    expect(retargetLocPath("F:\\mod\\localization\\plain.yml", "english", "german")).toBeNull();
  });
});

describe("buildTranslation", () => {
  it("switches the header, keeps entries/comments, guarantees a BOM", () => {
    const src = BOM + 'l_english:\n # section\n key_a:0 "Hello"\n key_b:1 "World"\n';
    const out = buildTranslation(src, "german");
    expect(out.startsWith(BOM + "l_german:")).toBe(true);
    expect(out).toContain(" # section");
    // Values are blanked; the source text stays visible as an inline comment.
    expect(out).toContain('key_a:0 "" # english: Hello');
    expect(out).not.toContain('key_a:0 "Hello"');
  });
  it("prepends a header when the source has none", () => {
    const out = buildTranslation(' key:0 "x"\n', "polish");
    expect(out.startsWith(BOM + "l_polish:")).toBe(true);
  });
});

describe("mergeTranslation", () => {
  const source = BOM + 'l_english:\n key_a:0 "A"\n key_b:0 "B"\n key_c:0 "C"\n';

  it("appends only missing keys under a marker and keeps existing lines untouched", () => {
    const target = BOM + 'l_german:\n key_a:0 "A-übersetzt"\n';
    const { content, added } = mergeTranslation(target, source, "english");
    expect(added).toBe(2);
    expect(content).toContain('key_a:0 "A-übersetzt"');
    expect(content).toContain("entries missing from this language");
    expect(content).toContain('key_b:0 "" # english: B');
    expect(content).toContain('key_c:0 "" # english: C');
    expect(content.startsWith(BOM)).toBe(true);
    // key_a must not be duplicated
    expect(content.match(/key_a/g)).toHaveLength(1);
  });

  it("is a no-op when the target already has all keys", () => {
    const target = BOM + 'l_german:\n key_a:0 "1"\n key_b:0 "2"\n key_c:0 "3"\n';
    const { content, added } = mergeTranslation(target, source, "english");
    expect(added).toBe(0);
    expect(content).toBe(target);
  });
});
