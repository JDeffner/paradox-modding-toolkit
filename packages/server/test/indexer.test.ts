import { describe, expect, it } from "vitest";
import * as path from "path";
import type { Definition, DefSource } from "@px-lsp/protocol/types";
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

  it("indexes inline scripted_trigger/scripted_effect declarations in event files (#5)", () => {
    const content = [
      "namespace = my_mod",
      "",
      "scripted_trigger my_mod_can_pay_trigger = {",
      "\tgold >= $AMOUNT$",
      "}",
      "scripted_effect my_mod_pay_effect = {",
      "\tremove_short_term_gold = 5",
      "}",
      "my_mod.0001 = {",
      "\ttrigger = { my_mod_can_pay_trigger = yes }",
      "}",
      "",
    ].join("\n");
    const defs = parseScriptDefinitions(content, "event", "f.txt", "mod");
    expect(defs.map((d) => [d.name, d.kind, d.line])).toEqual([
      ["my_mod_can_pay_trigger", "scripted_trigger", 2],
      ["my_mod_pay_effect", "scripted_effect", 5],
      ["my_mod.0001", "event", 8],
    ]);
    expect(defs[0].params).toEqual(["AMOUNT"]);
  });

  it("finds inline declarations even when a parse hiccup nests them (#5)", () => {
    // An unclosed brace earlier in the file makes the tolerant parser nest
    // everything after it; the declarations must still be found.
    const content = [
      "namespace = my_mod",
      "broken = {",
      "\tdesc = oops",
      "",
      "scripted_trigger my_mod_nested_trigger = {",
      "\tgold >= 5",
      "}",
      "",
    ].join("\n");
    const defs = parseScriptDefinitions(content, "event", "f.txt", "mod");
    const trigger = defs.find((d) => d.name === "my_mod_nested_trigger");
    expect(trigger).toBeDefined();
    expect(trigger!.kind).toBe("scripted_trigger");
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
});

/**
 * §B2: `scriptedLists()` and the running `stats()` counters replaced two
 * full-index walks that ran on every save. Both are only allowed to be faster,
 * never different, so the property under test is equality with the full
 * rebuild over random add/remove sequences (file removal and shadow resolution
 * included).
 */
describe("incremental scripted-list tracking (§B2)", () => {
  /** Deterministic PRNG: a failure has to be replayable. */
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  const NAMES = ["alpha", "beta", "gamma", "delta", "epsilon"];
  const KINDS = ["scripted_list", "scripted_effect", "loc_key"];
  const SOURCES: DefSource[] = ["mod", "parent", "vanilla"];

  const key = (d: Definition) => `${d.name}|${d.kind}|${d.source}|${d.file}|${d.line}`;
  const sortedKeys = (defs: Iterable<Definition>) => [...defs].map(key).sort();
  /** What the old code did: walk every name, shadow-resolve, filter by kind. */
  const fullWalk = (index: DefinitionIndex) => sortedKeys(index.entries((d) => d.kind === "scripted_list"));

  it("equals the full walk (and a rebuilt index) over 400 random operations", () => {
    const rand = rng(20260807);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const index = new DefinitionIndex();
    /** Mirror of what is live, so the comparison index can be rebuilt from it. */
    const live = new Map<string, Definition[]>();

    for (let step = 0; step < 400; step++) {
      const file = `f${Math.floor(rand() * 12)}.txt`;
      if (live.has(file) && rand() < 0.45) {
        index.removeFile(file);
        live.delete(file);
      } else {
        // Re-adding a live file is what a rescan does: remove, then add.
        if (live.has(file)) {
          index.removeFile(file);
          live.delete(file);
        }
        const defs: Definition[] = [];
        const count = 1 + Math.floor(rand() * 4);
        for (let i = 0; i < count; i++) {
          defs.push({
            name: pick(NAMES),
            kind: pick(KINDS),
            file,
            line: i,
            source: pick(SOURCES),
            value: pick(NAMES),
          });
        }
        index.addAll(defs);
        live.set(file, defs);
      }

      expect(sortedKeys(index.scriptedLists()), `step ${step}`).toEqual(fullWalk(index));

      // The running counters must equal a full rebuild's, key for key
      // (a kind that drops to zero has to disappear, not linger as 0).
      const rebuilt = new DefinitionIndex();
      for (const defs of live.values()) rebuilt.addAll(defs);
      expect(index.stats(), `step ${step} stats`).toEqual(rebuilt.stats());
      expect(sortedKeys(index.scriptedLists()), `step ${step} rebuilt`).toEqual(
        sortedKeys(rebuilt.scriptedLists())
      );
    }
  });

  it("a higher-ranked non-list definition shadows a vanilla scripted list", () => {
    const index = new DefinitionIndex();
    index.addAll([{ name: "shared", kind: "scripted_list", file: "v.txt", line: 0, source: "vanilla" }]);
    expect(sortedKeys(index.scriptedLists())).toEqual(fullWalk(index));
    expect([...index.scriptedLists()]).toHaveLength(1);
    // The mod defines the same name as something else: mod rank wins, so the
    // vanilla list disappears from BOTH the walk and the tracked iteration.
    index.addAll([{ name: "shared", kind: "loc_key", file: "m.yml", line: 3, source: "mod" }]);
    expect([...index.scriptedLists()]).toHaveLength(0);
    expect(sortedKeys(index.scriptedLists())).toEqual(fullWalk(index));
    // ...and comes back when the shadowing file goes away.
    index.removeFile("m.yml");
    expect([...index.scriptedLists()]).toHaveLength(1);
    expect(sortedKeys(index.scriptedLists())).toEqual(fullWalk(index));
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
