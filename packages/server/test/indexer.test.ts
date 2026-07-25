import { describe, expect, it } from "vitest";
import * as path from "path";
import {
  DefinitionIndex,
  classifyFile,
  isWantedLocFile,
  parseLocDefinitions,
  parseScriptDefinitions,
  scanRoot,
} from "../src/index/indexer";

const MOD = path.join(__dirname, "fixtures", "mod");
const GAME = path.join(__dirname, "fixtures", "game");

describe("parseScriptDefinitions", () => {
  it("finds only top-level assignments", () => {
    const content = "outer = {\n\tinner = {\n\t\tdeep = yes\n\t}\n}\nsecond = { x = 1 }\n";
    const defs = parseScriptDefinitions(content, "scripted_effect", "f.txt", "mod");
    expect(defs.map((d) => [d.name, d.line])).toEqual([
      ["outer", 0],
      ["second", 5],
    ]);
  });

  it("is not fooled by braces in strings or comments", () => {
    const content = 'a = {\n\ttext = "closing } brace"\n\t# comment with }\n}\nb = { }\n';
    const defs = parseScriptDefinitions(content, "scripted_trigger", "f.txt", "mod");
    expect(defs.map((d) => d.name)).toEqual(["a", "b"]);
  });

  it("records only namespace.NNNN blocks as events", () => {
    const content = "namespace = my_mod\n\nmy_mod.0001 = {\n}\nsome_helper = {\n}\n";
    const defs = parseScriptDefinitions(content, "event", "f.txt", "mod");
    expect(defs.map((d) => d.name)).toEqual(["my_mod.0001"]);
  });

  it("finds valueless script values", () => {
    const content = "flat_value = 25\nblock_value = {\n\tvalue = 1\n}\n";
    const defs = parseScriptDefinitions(content, "script_value", "f.txt", "mod");
    expect(defs.map((d) => d.name)).toEqual(["flat_value", "block_value"]);
  });
});

describe("parseLocDefinitions", () => {
  it("parses keys, version suffixes and values, skipping the header", () => {
    const content = '﻿l_english:\n key_a:0 "Text A"\n key_b:12 "Text [ROOT.Char.GetName] \\"quoted\\""\n';
    const defs = parseLocDefinitions(content, "loc.yml", "mod");
    expect(defs).toHaveLength(2);
    expect(defs[0]).toMatchObject({ name: "key_a", kind: "loc_key", line: 1, value: "Text A" });
    expect(defs[1].value).toContain("quoted");
  });
});

describe("scanRoot on the fixture mod", () => {
  const defs = scanRoot(MOD, "mod", { locLanguage: "english" });
  const byName = (name: string) => defs.filter((d) => d.name === name);

  it("finds a scripted effect with correct file and line", () => {
    const [def] = byName("my_mod_marriage_effect");
    expect(def).toBeDefined();
    expect(def.kind).toBe("scripted_effect");
    expect(def.file).toContain("my_mod_effects.txt");
    expect(def.line).toBe(2);
  });

  it("finds event IDs, on_actions, script values and triggers", () => {
    expect(byName("my_mod.0001")[0]?.kind).toBe("event");
    expect(byName("my_mod.0002")[0]?.kind).toBe("event");
    expect(byName("my_mod_on_marriage")[0]?.kind).toBe("on_action");
    expect(byName("my_mod_dowry_value")[0]?.kind).toBe("script_value");
    expect(byName("my_mod_can_marry_trigger")[0]?.kind).toBe("scripted_trigger");
  });

  it("finds loc keys with values", () => {
    const [def] = byName("my_mod_greeting");
    expect(def.kind).toBe("loc_key");
    expect(def.value).toContain("Greetings");
  });
});

describe("DefinitionIndex", () => {
  const makeIndex = () => {
    const index = new DefinitionIndex();
    index.addAll(scanRoot(GAME, "vanilla", { locLanguage: "english" }));
    index.addAll(scanRoot(MOD, "mod", { locLanguage: "english" }));
    return index;
  };

  it("mod definitions shadow vanilla definitions with the same name", () => {
    const index = makeIndex();
    const defs = index.lookup("shared_effect");
    expect(defs).toHaveLength(1);
    expect(defs[0].source).toBe("mod");
    expect(defs[0].file).toContain(path.join("mod", "common", "scripted_effects"));
    // lookupAll still exposes both.
    expect(index.lookupAll("shared_effect")).toHaveLength(2);
  });

  it("vanilla-only definitions remain visible", () => {
    const index = makeIndex();
    expect(index.lookup("vanilla_only_effect")[0]?.source).toBe("vanilla");
  });

  it("removeFile supports incremental re-indexing", () => {
    const index = makeIndex();
    const file = index.lookup("my_mod_marriage_effect")[0].file;
    index.removeFile(file);
    expect(index.lookup("my_mod_marriage_effect")).toHaveLength(0);
    // shared_effect now resolves to vanilla again
    expect(index.lookup("shared_effect")[0].source).toBe("vanilla");
    index.addAll(parseScriptDefinitions("my_mod_marriage_effect = {}\n", "scripted_effect", file, "mod"));
    expect(index.lookup("my_mod_marriage_effect")).toHaveLength(1);
  });

  it("reports stats", () => {
    const stats = makeIndex().stats();
    expect(stats.total).toBeGreaterThan(5);
    expect(stats.byKind.scripted_effect).toBeGreaterThanOrEqual(3);
    expect(stats.bySource.mod).toBeGreaterThan(0);
    expect(stats.bySource.vanilla).toBeGreaterThan(0);
  });
});

describe("file classification", () => {
  it("classifies files under whitelisted folders", () => {
    expect(classifyFile(MOD, path.join(MOD, "common", "scripted_effects", "x.txt"))?.kind).toBe(
      "scripted_effect"
    );
    expect(classifyFile(MOD, path.join(MOD, "events", "sub", "x.txt"))?.kind).toBe("event");
    expect(classifyFile(MOD, path.join(MOD, "localization", "english", "x_l_english.yml"))?.kind).toBe(
      "loc_key"
    );
    expect(classifyFile(MOD, path.join(MOD, "gfx", "x.txt"))).toBeNull();
    expect(classifyFile(MOD, path.join("elsewhere", "x.txt"))).toBeNull();
  });

  it("filters localization files by language", () => {
    expect(isWantedLocFile(path.join("localization", "english", "a_l_english.yml"), "english")).toBe(true);
    expect(isWantedLocFile(path.join("localization", "replace", "english", "b.yml"), "english")).toBe(true);
    expect(isWantedLocFile(path.join("localization", "a_l_english.yml"), "english")).toBe(true);
    expect(isWantedLocFile(path.join("localization", "french", "a_l_french.yml"), "english")).toBe(false);
  });
});
