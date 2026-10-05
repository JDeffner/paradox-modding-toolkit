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

function build(
  files: Array<{ relPath: string; content: string }>,
  overrides: Partial<Parameters<typeof buildTranslationMod>[0]> = {}
) {
  return buildTranslationMod({
    gameName: "Crusader Kings III",
    gameShortName: "CK3",
    tigerName: "ck3-tiger",
    configDirName: ".px-toolkit",
    descriptorKind: "mod",
    sourceName: "Big Mod",
    supportedVersion: "1.19.*",
    sourceLang: "english",
    targetLang: "german",
    sourceRootRelative: "../big_mod",
    files,
    ...overrides,
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

  it("writes a translation mod below the game's load stage", () => {
    const result = build(
      [{ relPath: "main_menu/localization/english/sub/big_l_english.yml", content: SRC }],
      {
        stageRoot: "main_menu",
      }
    );
    expect(result.files.find((file) => file.relPath.endsWith("big_l_german.yml"))?.relPath).toBe(
      "main_menu/localization/german/replace/sub/big_l_german.yml"
    );
    expect(result.files.find((file) => file.relPath === "TRANSLATE.md")?.content).toContain(
      "`main_menu/localization/german/replace/`"
    );
  });

  it("keeps source stages separate when their localization filenames match", () => {
    const result = build(
      [
        { relPath: "main_menu/localization/english/shared_l_english.yml", content: SRC },
        { relPath: "in_game/localization/english/shared_l_english.yml", content: SRC },
      ],
      { stageRoot: "in_game", stageRoots: ["in_game", "main_menu"] }
    );
    expect(result.locFiles).toBe(2);
    expect(result.files.map((file) => file.relPath)).toContain(
      "main_menu/localization/german/replace/shared_l_german.yml"
    );
    expect(result.files.map((file) => file.relPath)).toContain(
      "in_game/localization/german/replace/shared_l_german.yml"
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
    const playset = JSON.parse(byPath.get(".px-toolkit/playset.json")!);
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

  it("merges unique keys from plain and replace files with the same basename", () => {
    const files = [
      {
        relPath: "localization/english/shared_l_english.yml",
        content: 'l_english:\n shared:0 "Same"\n plain:0 "Plain source"\n',
      },
      {
        relPath: "localization/replace/english/shared_l_english.yml",
        content: 'l_english:\n shared:0 "Same"\n override:0 "Replace source"\n',
      },
    ];
    const result = build(files);
    const file = result.files.find(
      (item) => item.relPath === "localization/german/replace/shared_l_german.yml"
    )!;
    expect(result.locFiles).toBe(1);
    expect(result.entries).toBe(3);
    expect(file.content).toContain('plain:0 "" # english: Plain source');
    expect(file.content).toContain('override:0 "" # english: Replace source');
    expect(file.content.match(/^ shared:/gm)).toHaveLength(1);
    expect(build([...files].reverse())).toEqual(result);
  });

  it("reports conflicting values in collapsed source files instead of discarding one", () => {
    expect(() =>
      build([
        {
          relPath: "localization/english/shared_l_english.yml",
          content: 'l_english:\n shared:0 "Plain source"\n',
        },
        {
          relPath: "localization/replace/english/shared_l_english.yml",
          content: 'l_english:\n shared:0 "Replace source"\n',
        },
      ])
    ).toThrow("Conflicting source localization for shared");
  });
});

describe("buildTranslationMod, metadata-descriptor game", () => {
  const result = build([{ relPath: "localization/english/big_l_english.yml", content: SRC }], {
    gameName: "Victoria 3",
    gameShortName: "Vic3",
    tigerName: "vic3-tiger",
    configDirName: ".px-toolkit",
    descriptorKind: "metadata",
    sourceId: "com.github.example.Big-Mod",
    supportedVersion: "1.13.*",
  });
  const byPath = new Map(result.files.map((f) => [f.relPath, f.content]));

  it("writes metadata.json instead of descriptor.mod", () => {
    expect(byPath.has("descriptor.mod")).toBe(false);
    const meta = JSON.parse(byPath.get(".metadata/metadata.json")!);
    expect(meta.name).toBe("Big Mod (German Translation)");
    // Copied from the source mod, under the metadata convention's own key.
    expect(meta.supported_game_version).toBe("1.13.*");
    expect(meta.tags).toEqual(["Translation"]);
    expect(meta.relationships).toEqual([
      {
        rel_type: "dependency",
        id: "com.github.example.Big-Mod",
        display_name: "Big Mod",
        resource_type: "mod",
        version: "*",
      },
    ]);
  });

  it("leaves relationships empty when the source mod has no id to point at", () => {
    const noId = build([{ relPath: "localization/english/big_l_english.yml", content: SRC }], {
      descriptorKind: "metadata",
      sourceId: null,
    });
    const meta = JSON.parse(
      new Map(noId.files.map((f) => [f.relPath, f.content])).get(".metadata/metadata.json")!
    );
    expect(meta.relationships).toEqual([]);
  });

  it("the guide names the descriptor the game actually reads", () => {
    const md = byPath.get("TRANSLATE.md")!;
    expect(md).toContain(".metadata/metadata.json");
    expect(md).not.toContain("descriptor.mod");
  });
});
