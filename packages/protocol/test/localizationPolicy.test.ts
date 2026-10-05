import { describe, expect, it } from "vitest";
import {
  generatedLocalizationSource,
  parseLocalizationDefaults,
  suggestLocalizationTarget,
  upsertLocalizationText,
  type LocalizationDocument,
  type LocalizationTargetInput,
} from "../src/localizationPolicy";

const doc = (path: string, keys: string[], language = "english"): LocalizationDocument => ({
  path,
  text: `\uFEFFl_${language}:\n${keys.map((key) => ` ${key}: "value"\n`).join("")}`,
});
const suggest = (documents: LocalizationDocument[], options: Partial<LocalizationTargetInput> = {}) =>
  suggestLocalizationTarget({
    key: "agot_dragon_birth_desc",
    language: "english",
    locRoots: ["localization"],
    documents,
    subject: "example",
    ...options,
  });

describe("localization defaults", () => {
  it("accepts automatic choices and supported templates", () => {
    expect(parseLocalizationDefaults(undefined)).toEqual({});
    expect(
      parseLocalizationDefaults({
        language: "",
        newKeyFile: "",
        overrideFile: "localization/{language}/replace/{subject}_{source}_l_{language}.yml",
        entryVersion: "none",
      })
    ).toEqual({
      newKeyFile: "",
      overrideFile: "localization/{language}/replace/{subject}_{source}_l_{language}.yml",
      entryVersion: "none",
    });
  });

  it("omits an automatic language so callers retain their effective language", () => {
    expect(parseLocalizationDefaults({ language: "" })).toEqual({});
    expect(parseLocalizationDefaults({ language: "german" })).toEqual({ language: "german" });
  });

  it.each([
    null,
    [],
    "english",
    { version: 2 },
    { language: "English" },
    { language: "../english" },
    { newKeyFile: 42 },
    { entryVersion: "1" },
    { entryVersion: "" },
    { newKeyFile: "/tmp/test.yml" },
    { newKeyFile: "C:/test.yml" },
    { newKeyFile: "localization/../test.yml" },
    { newKeyFile: "localization//test.yml" },
    { newKeyFile: "localization\\test.yml" },
    { newKeyFile: "localization/{game}.yml" },
    { newKeyFile: "localization/{source.yml" },
  ])("rejects invalid defaults: %j", (defaults) => {
    expect(() => parseLocalizationDefaults(defaults)).toThrow();
  });
});

describe("localization target policy", () => {
  it("keeps the shared replace layout across multiple feature directories", () => {
    const result = suggest(
      [
        doc("localization/english/replace/events/travel_l_english.yml", ["travel_name"]),
        doc("localization/english/replace/culture/faith_l_english.yml", ["faith_name"]),
      ],
      { sourcePath: "events/new_feature.txt" }
    );
    expect(result).toEqual({
      path: "localization/english/replace/new_feature_l_english.yml",
      reason: "observed layout",
    });
  });
  it("recognizes ownership of valid values with bare inner quotes", () => {
    const existing = {
      path: "localization/dialogue_l_english.yml",
      text: 'l_english:\n dialogue: ""Direct speech," she said." # note\n',
    };
    expect(suggest([existing], { key: "dialogue" })).toEqual({
      path: existing.path,
      reason: "existing key",
    });
  });

  it("keeps automatic ownership, family inference, and fresh files in the source stage", () => {
    const other = doc("in_game/localization/english/game_l_english.yml", [
      "agot_dragon_birth_desc",
      "agot_dragon_birth_title",
    ]);
    const options = {
      locRoots: ["in_game/localization", "main_menu/localization"],
      sourcePath: "main_menu/events/menu.txt",
    };
    expect(suggest([other], options)).toEqual({
      path: "main_menu/localization/english/menu_l_english.yml",
      reason: "new file",
    });
    const existing = doc("main_menu/localization/english/menu_l_english.yml", ["agot_dragon_birth_desc"]);
    expect(suggest([other, existing], options)).toEqual({ path: existing.path, reason: "existing key" });
    expect(
      suggest([other], {
        ...options,
        defaults: { newKeyFile: "in_game/localization/english/explicit_l_english.yml" },
        key: "other_new_key",
      }).path
    ).toBe("in_game/localization/english/explicit_l_english.yml");
  });

  it("names a fresh mod's localization file after the source script before the subject", () => {
    expect(suggest([], { sourcePath: "events/dragon_birth.txt", subject: "Example Mod" })).toEqual({
      path: "localization/english/dragon_birth_l_english.yml",
      reason: "new file",
    });
    expect(suggest([], { sourcePath: undefined, subject: "Example Mod" }).path).toBe(
      "localization/english/example_mod_l_english.yml"
    );
    expect(suggest([], { sourcePath: undefined, subject: undefined }).path).toBe(
      "localization/english/mod_l_english.yml"
    );
  });

  it("keeps an existing entry in its file before consulting defaults or replace gates", () => {
    const existing = doc("localization/english/events_l_english.yml", ["agot_dragon_birth_desc"]);
    expect(
      suggest([existing], {
        override: true,
        defaults: { overrideFile: "localization/replace/another_l_{language}.yml" },
      })
    ).toEqual({ path: existing.path, reason: "existing key" });
  });

  it("returns duplicate owners as candidates instead of selecting one", () => {
    const a = doc("localization/a_l_english.yml", ["agot_dragon_birth_desc"]);
    const b = doc("localization/replace/b_l_english.yml", ["agot_dragon_birth_desc"]);
    expect(suggest([b, a])).toEqual({ path: "", reason: "existing key", candidates: [a.path, b.path] });
  });

  it("prefers exact sibling references over a longer unrelated family match", () => {
    const sibling = doc("localization/english/sibling_l_english.yml", ["dragon_name"]);
    const family = doc("localization/english/family_l_english.yml", ["agot_dragon_birth_title"]);
    expect(suggest([family, sibling], { relatedKeys: ["dragon_name"] }).path).toBe(sibling.path);
  });

  it("prefers the longest meaningful family rather than the busiest prefix", () => {
    const broad = doc("localization/broad_l_english.yml", ["agot_dragon_name", "agot_dragon_age"]);
    const close = doc("localization/close_l_english.yml", ["agot_dragon_birth_title"]);
    expect(suggest([broad, close])).toEqual({ path: close.path, reason: "key family" });
  });

  it("does not select the largest unrelated file or a mod-wide single token prefix", () => {
    const unrelated = doc(
      "localization/english/large_l_english.yml",
      Array.from({ length: 100 }, (_, index) => `agot_unrelated_${index}`)
    );
    expect(suggest([unrelated])).toEqual({
      path: "localization/english/example_l_english.yml",
      reason: "new file",
    });
  });

  it("reports equally related files as candidates", () => {
    const a = doc("localization/a_l_english.yml", ["agot_dragon_birth_title"]);
    const b = doc("localization/b_l_english.yml", ["agot_dragon_birth_name"]);
    expect(suggest([b, a]).candidates).toEqual([a.path, b.path]);
    expect(suggest([a, b]).path).toBe("");
  });

  it("uses an exact source stem when no sibling or family exists", () => {
    const source = doc("localization/english/dragon_events_l_english.yml", ["other_key"]);
    expect(suggest([source], { sourcePath: "events/dragon_events.txt" })).toEqual({
      path: source.path,
      reason: "source file",
    });
  });

  it.each([
    "localization/replace/english/dragon_l_english.yml",
    "localization/english/replace/dragon_l_english.yml",
    "localization/replace/dragon_l_english.yml",
  ])("supports existing new-key families and overrides in %s", (path) => {
    const existing = doc(path, ["agot_dragon_birth_title"]);
    expect(suggest([existing]).path).toBe(path);
    expect(suggest([existing], { override: true }).path).toBe(path);
  });

  it("limits new override candidates to replace paths", () => {
    const normal = doc("localization/english/dragon_l_english.yml", ["agot_dragon_birth_title"]);
    const replace = doc("localization/replace/english/dragon_l_english.yml", ["agot_dragon_name"]);
    expect(suggest([normal, replace], { override: true }).path).toBe(replace.path);
  });

  it.each([
    ["localization/english/replace/events_l_english.yml", "localization/german/replace/events_l_german.yml"],
    ["localization/replace/english/events_l_english.yml", "localization/replace/german/events_l_german.yml"],
    ["localization/events_l_english.yml", "localization/events_l_german.yml"],
  ])("uses a language counterpart of %s", (original, target) => {
    expect(suggest([doc(original, ["agot_dragon_birth_title"])], { language: "german" })).toEqual({
      path: target,
      reason: "language counterpart",
    });
  });

  it("uses a foreign exact key as a counterpart even without a key family", () => {
    expect(
      suggest([doc("localization/names_l_english.yml", ["dragon"])], {
        key: "dragon",
        language: "german",
      }).path
    ).toBe("localization/names_l_german.yml");
  });

  it("honors new-key and override templates before family inference", () => {
    const family = doc("localization/english/family_l_english.yml", ["agot_dragon_birth_title"]);
    const defaults = {
      newKeyFile: "localization/replace/{subject}_{source}_l_{language}.yml",
      overrideFile: "localization/{language}/replace/overrides_l_{language}.yml",
    };
    expect(suggest([family], { defaults, subject: "Dragon Mod", sourcePath: "events/birth.txt" }).path).toBe(
      "localization/replace/dragon_mod_birth_l_english.yml"
    );
    expect(suggest([family], { defaults, override: true }).path).toBe(
      "localization/english/replace/overrides_l_english.yml"
    );
  });

  it("rejects incomplete templates, invalid file suffixes, and non-replace override targets", () => {
    expect(() => suggest([], { defaults: { newKeyFile: "localization/{source}_l_{language}.yml" } })).toThrow(
      /source/
    );
    expect(() => suggest([], { defaults: { newKeyFile: "localization/invalid.yml" } })).toThrow(/end in/);
    expect(() =>
      suggest([], { override: true, defaults: { overrideFile: "localization/test_l_{language}.yml" } })
    ).toThrow(/replace/);
  });

  it("excludes generated files and generated language counterparts from automatic placement", () => {
    const generated = doc("localization/generated_l_english.yml", ["agot_dragon_birth_title"]);
    generated.text = "# Generated by build-loc.py. DO NOT EDIT\n" + generated.text.slice(1);
    expect(suggest([generated]).path).toBe("localization/english/example_l_english.yml");
    const source = doc("localization/generated_l_german.yml", ["agot_dragon_birth_title"], "german");
    expect(suggest([source, generated]).path).toBe("localization/example_l_english.yml");
    expect(() => suggest([generated], { defaults: { newKeyFile: generated.path } })).toThrow(/generated/);
  });

  it("keeps generated key ownership so the caller can warn before editing", () => {
    const generated = doc("localization/generated_l_english.yml", ["agot_dragon_birth_desc"]);
    generated.text = "# DO NOT EDIT\n" + generated.text.slice(1);
    expect(suggest([generated]).path).toBe(generated.path);
    expect(generatedLocalizationSource(generated.text)).toBe("DO NOT EDIT");
  });

  it("recognizes a generated marker after the language header", () => {
    const generated = {
      path: "localization/calendar_l_english.yml",
      text: '\uFEFFl_english:\n# Automatically generated calendar. DO NOT EDIT\n agot_dragon_birth_title: "Title"\n',
    };
    expect(generatedLocalizationSource(generated.text)).toBe("Automatically generated calendar. DO NOT EDIT");
    expect(suggest([generated]).path).toBe("localization/english/example_l_english.yml");
    expect(
      generatedLocalizationSource('l_english:\n key: "value"\n# DO NOT EDIT this entry\n')
    ).toBeUndefined();
  });

  it("does not infer generated content from filenames or ordinary comments", () => {
    expect(generatedLocalizationSource("# Keys for generated events\nl_english:\n")).toBeUndefined();
    expect(suggest([doc("localization/generated_l_english.yml", ["agot_dragon_birth_title"])]).path).toBe(
      "localization/generated_l_english.yml"
    );
  });

  it.each([
    "localization/english/replace",
    "localization/replace/english",
    "localization/replace",
    "localization",
  ])("uses the observed %s layout without selecting unrelated contents", (directory) => {
    const unrelated = doc(`${directory}/other_l_english.yml`, ["unrelated"]);
    expect(suggest([unrelated]).path).toBe(`${directory}/example_l_english.yml`);
  });

  it("respects observed profile roots and a present fallback file", () => {
    const normal = doc("localization/example_l_english.yml", ["unrelated"]);
    const fallback = doc("localisation/manual_l_english.yml", ["elsewhere"]);
    expect(
      suggest([normal, fallback], {
        locRoots: ["localisation"],
        fallbackPath: fallback.path,
      }).path
    ).toBe(fallback.path);
  });
});

describe("localization text editing", () => {
  it("edits valid bare inner quotes using the last quote, preserving other values and trailing content", () => {
    const text =
      'l_english:\n dialogue:2 ""Direct speech," she said." # note\n other: "A bare "quote" stays"\n';
    expect(upsertLocalizationText(text, "english", "dialogue", 'A new "quote"')).toBe(
      'l_english:\n dialogue:2 "A new \\"quote\\"" # note\n other: "A bare "quote" stays"\n'
    );
    expect(
      upsertLocalizationText('l_english:\n key: "old" ignored trailing content\n', "english", "key", "new")
    ).toBe('l_english:\n key: "new" ignored trailing content\n');
  });

  it("preserves BOM, header, EOLs, comments, spacing, version marker, and unrelated lines", () => {
    const text =
      '\uFEFF# translators\r\nl_english: # language\r\n\tmy_key:12  "old" # note\r\n\r\n other: "keep"\r\n';
    expect(upsertLocalizationText(text, "english", "my_key", 'new "quote"', "none")).toBe(
      text.replace('"old"', '"new \\"quote\\""')
    );
  });

  it("preserves mixed existing line endings and a missing final newline", () => {
    const text = 'l_english:\r\n key: "old"\n other:0 "keep"';
    expect(upsertLocalizationText(text, "english", "key", "new")).toBe(
      'l_english:\r\n key: "new"\n other:0 "keep"'
    );
  });

  it("preserves empty values and existing escaped quotes", () => {
    const text = 'l_english:\n key: "old"\n';
    expect(upsertLocalizationText(text, "english", "key", "")).toBe('l_english:\n key: ""\n');
    expect(upsertLocalizationText(text, "english", "key", 'say \\"yes\\"\r\nnext\nlast')).toBe(
      'l_english:\n key: "say \\"yes\\"\\nnext\\nlast"\n'
    );
  });

  it("inserts beside the closest key family with its indentation and version style", () => {
    const text = 'l_english:\n\tagot_dragon_birth_title:2 "title"\n\n# other section\n other_key: "other"\n';
    expect(upsertLocalizationText(text, "english", "agot_dragon_birth_desc", "desc")).toBe(
      'l_english:\n\tagot_dragon_birth_title:2 "title"\n\tagot_dragon_birth_desc:2 "desc"\n\n# other section\n other_key: "other"\n'
    );
  });

  it("uses file style for unrelated additions while retaining trailing comments and blank lines", () => {
    const text = 'l_english:\r\n\told_key: "old"\r\n# end\r\n\r\n';
    expect(upsertLocalizationText(text, "english", "new_key", "new")).toBe(text + '\tnew_key: "new"\r\n');
  });

  it.each([
    ["none", ""],
    ["zero", "0"],
  ] as const)("applies explicit %s style to new entries", (style, version) => {
    const text = 'l_english:\n old_key:7 "old"\n';
    expect(upsertLocalizationText(text, "english", "new_key", "new", style)).toBe(
      text + ` new_key:${version} "new"\n`
    );
  });

  it("creates an unnumbered entry for an empty file and preserves its BOM presence", () => {
    expect(upsertLocalizationText("", "english", "key", "value")).toBe('l_english:\n key: "value"\n');
    expect(upsertLocalizationText("\uFEFF", "english", "key", "")).toBe('\uFEFFl_english:\n key: ""\n');
  });

  it("supports the existing apostrophe key alphabet", () => {
    expect(upsertLocalizationText("l_english:\n", "english", "character's_name", "name")).toContain(
      ' character\'s_name: "name"'
    );
  });

  it.each([
    ['l_german:\n key: "old"\n', "english", "key"],
    ['key: "old"\n', "english", "key"],
    ["# only a comment\n", "english", "key"],
    ["l_english:\nl_german:\n", "english", "key"],
    ["l_english:\n", "English", "key"],
    ["l_english:\n", "english", "bad key"],
    ['l_english:\n key: "one"\n key:0 "two"\n', "english", "key"],
    ["l_english:\n key: missing_quotes\n", "english", "key"],
  ])("rejects invalid headers, inputs, duplicate or malformed target entries", (text, language, key) => {
    expect(() => upsertLocalizationText(text, language, key, "new")).toThrow();
  });
});
