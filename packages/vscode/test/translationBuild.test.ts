/**
 * Translation-mod generator (packages/protocol/src/translationMod.ts): path retargeting
 * into localization/<lang>/replace/, blanked values, descriptor with the
 * source dependency, playset, and the TRANSLATE.md prompt invariants.
 */
import { describe, expect, it } from "vitest";
import { buildTranslationMod, targetLocPath } from "../src/translationBuild";

const BOM = "﻿";

const SRC = `${BOM}l_english:
 # section comment
 my_mod_title:0 "The Grand Title"
 my_mod_desc:0 "Hello [ROOT.Char.GetFirstName], you gain $VALUE$ £gold£ #P prestige#!"
 my_mod_empty:0 ""
`;

function build(files: Array<{ relPath: string; content: string }>) {
  return buildTranslationMod({
    gameName: "Crusader Kings III",
    gameShortName: "CK3",
    tigerName: "ck3-tiger",
    configDirName: ".ck3modding",
    sourceName: "Big Mod",
    supportedVersion: "1.19.*",
    sourceLang: "english",
    targetLang: "german",
    sourceRootRelative: "../big_mod",
    files,
  });
}

describe("targetLocPath", () => {
  it("retargets language folder and filename marker into replace/", () => {
    expect(targetLocPath("localization/english/foo_l_english.yml", "english", "german")).toBe(
      "localization/german/replace/foo_l_german.yml"
    );
  });

  it("keeps subfolders and collapses an existing replace segment", () => {
    expect(targetLocPath("localization/english/replace/sub/foo_l_english.yml", "english", "german")).toBe(
      "localization/german/replace/sub/foo_l_german.yml"
    );
  });

  it("handles files without a language folder and windows separators", () => {
    expect(targetLocPath("localization\\foo_l_english.yml", "english", "german")).toBe(
      "localization/german/replace/foo_l_german.yml"
    );
  });
});

describe("buildTranslationMod", () => {
  const result = build([
    { relPath: "localization/english/big_l_english.yml", content: SRC },
    { relPath: "localization/french/big_l_french.yml", content: SRC.replace("l_english", "l_french") },
  ]);
  const byPath = new Map(result.files.map((f) => [f.relPath, f.content]));

  it("mirrors only source-language files, blanked, with BOM and new header", () => {
    expect(result.locFiles).toBe(1);
    const loc = byPath.get("localization/german/replace/big_l_german.yml")!;
    expect(loc.startsWith(`${BOM}l_german:`)).toBe(true);
    expect(loc).toContain('my_mod_title:0 "" # english: The Grand Title');
    // Script/format tokens survive inside the comment for the translator.
    expect(loc).toContain("[ROOT.Char.GetFirstName]");
    expect(loc).toContain("$VALUE$");
  });

  it("counts translatable entries (blank-valued source entries are not counted)", () => {
    expect(result.entries).toBe(2);
  });

  it("writes a descriptor with dependency, tag and supported_version", () => {
    const desc = byPath.get("descriptor.mod")!;
    expect(desc).toContain('name="Big Mod (German Translation)"');
    expect(desc).toContain('"Big Mod"');
    expect(desc).toContain("dependencies={");
    expect(desc).toContain('"Translation"');
    expect(desc).toContain('supported_version="1.19.*"');
  });

  it("writes a relative playset so the source mod indexes when opened alone", () => {
    const playset = JSON.parse(byPath.get(".ck3modding/playset.json")!);
    expect(playset.parents).toEqual(["../big_mod"]);
  });

  it("TRANSLATE.md carries the workflow, the per-file checklist and the prompt rules", () => {
    const md = byPath.get("TRANSLATE.md")!;
    expect(md).toContain("- [ ] `localization/german/replace/big_l_german.yml` (2 entries)");
    expect(md).toContain("Localization Coverage");
    // Prompt invariants an AI must obey: verbatim tokens, header, output shape.
    expect(md).toContain("$variables$");
    expect(md).toContain("[bracketed script]");
    expect(md).toContain("l_german:");
    expect(md).toContain("Output ONLY the file content");
    expect(md).toContain("from english to german");
  });
});
