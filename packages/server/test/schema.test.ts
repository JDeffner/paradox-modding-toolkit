/**
 * Fixture tests for the CK3 schema table (packages/server/src/games/ck3/schema.ts).
 *
 * These always run: they feed small inline fixtures in the real vanilla file
 * shape through extractDefinitions and assert the expected names/containers,
 * plus a batch of structural sanity checks over CK3_SCHEMA / REF_FIELDS.
 */
import { describe, expect, it } from "vitest";
import { extractDefinitions } from "../src/index/extract";
import { CK3_SCHEMA, REF_FIELDS } from "../src/games/ck3/schema";
import { coerceFreqs } from "../src/schema/freqs";
import type { SchemaEntry } from "../src/schema/types";
import type { Definition } from "@px-lsp/protocol/types";

function entry(kind: string): SchemaEntry {
  const e = CK3_SCHEMA.find((s) => s.kind === kind);
  if (!e) throw new Error(`no schema entry for kind ${kind}`);
  return e;
}

function names(defs: Definition[]): string[] {
  return defs.map((d) => d.name);
}

describe("extractDefinitions — representative entries", () => {
  it("trait: top-level keys, ignores @variables", () => {
    const content = [
      "@pos_compat_high = 30",
      "diplomat = {",
      "\tcategory = personality",
      "\topposites = { shy }",
      "}",
      "brave = {",
      "\tcategory = personality",
      "}",
    ].join("\n");
    const defs = extractDefinitions(content, entry("trait"), "00_traits.txt", "vanilla");
    expect(names(defs)).toEqual(["diplomat", "brave"]);
  });

  it("decision: top-level keys", () => {
    const content = [
      "commission_artifact_decision = {",
      '\tpicture = { reference = "gfx/x.dds" }',
      "\tis_shown = { always = yes }",
      "}",
      "recruit_terrain_specialist_decision = { cost = { gold = 100 } }",
    ].join("\n");
    const defs = extractDefinitions(content, entry("decision"), "d.txt", "vanilla");
    expect(names(defs)).toEqual(["commission_artifact_decision", "recruit_terrain_specialist_decision"]);
  });

  it("event: only namespace.NNN ids, skips namespace= and helper keys", () => {
    const content = [
      "namespace = accolade",
      "accolade.0001 = {",
      "\ttype = character_event",
      "}",
      "scripted_effect_local = { x = 1 }",
      "accolade.0002 = { type = character_event }",
    ].join("\n");
    const defs = extractDefinitions(content, entry("event"), "e.txt", "mod");
    expect(names(defs)).toEqual(["accolade.0001", "accolade.0002"]);
  });

  it("landed_title: nested-title with container set to nearest title ancestor", () => {
    const content = [
      "e_empire = {",
      "\tcolor = { 1 2 3 }",
      "\tk_kingdom = {",
      "\t\td_duchy = {",
      "\t\t\tc_county = {",
      "\t\t\t\tb_barony = { province = 1 }",
      "\t\t\t}",
      "\t\t}",
      "\t}",
      "}",
    ].join("\n");
    const defs = extractDefinitions(content, entry("landed_title"), "00_landed_titles.txt", "vanilla");
    expect(names(defs)).toEqual(["e_empire", "k_kingdom", "d_duchy", "c_county", "b_barony"]);
    const byName = new Map(defs.map((d) => [d.name, d.container]));
    expect(byName.get("e_empire")).toBeUndefined();
    expect(byName.get("k_kingdom")).toBe("e_empire");
    expect(byName.get("d_duchy")).toBe("k_kingdom");
    expect(byName.get("b_barony")).toBe("c_county");
  });

  it("gui-type: type and template statements, including types-wrapped groups", () => {
    const content = [
      "types MyGroup {",
      "\ttype my_widget = widget { size = { 10 10 } }",
      "\ttype another_widget = button_normal {}",
      "}",
      "template my_template {",
      "\tsize = { 5 5 }",
      "}",
    ].join("\n");
    const defs = extractDefinitions(content, entry("gui_type"), "x.gui", "vanilla");
    expect(names(defs).sort()).toEqual(["another_widget", "my_template", "my_widget"].sort());
  });

  it("culture: top-level keys", () => {
    const content = ["kru = {\n\tcolor = hsv { 0 0 0 }\n}", "guan = { color = red }"].join("\n");
    const defs = extractDefinitions(content, entry("culture"), "cultures.txt", "vanilla");
    expect(names(defs)).toEqual(["kru", "guan"]);
  });

  it("doctrine: top-level keys are the doctrine names (not groups)", () => {
    const content = [
      "doctrine_monogamy = {",
      "\tparameters = { number_of_spouses = 1 }",
      "}",
      "doctrine_polygamy = { parameters = { number_of_spouses = 4 } }",
    ].join("\n");
    const defs = extractDefinitions(content, entry("doctrine"), "20_doctrines.txt", "vanilla");
    expect(names(defs)).toEqual(["doctrine_monogamy", "doctrine_polygamy"]);
  });

  it("static_modifier: top-level keys", () => {
    const content = [
      "feast_strategy_discussions_modifier = { monthly_prestige = 0.5 }",
      "murder_feast_murderer_modifier = { dread = 10 }",
    ].join("\n");
    const defs = extractDefinitions(content, entry("static_modifier"), "m.txt", "vanilla");
    expect(names(defs)).toEqual(["feast_strategy_discussions_modifier", "murder_feast_murderer_modifier"]);
  });
});

describe("CK3_SCHEMA sanity", () => {
  it("no duplicate paths", () => {
    const paths = CK3_SCHEMA.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("no duplicate kinds", () => {
    const kinds = CK3_SCHEMA.map((e) => e.kind);
    const dupes = kinds.filter((k, i) => kinds.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  it("every ext starts with '.'", () => {
    for (const e of CK3_SCHEMA) {
      if (e.ext !== undefined) expect(e.ext.startsWith(".")).toBe(true);
    }
  });

  it("every requiredLoc pattern contains '$'", () => {
    for (const e of CK3_SCHEMA) {
      for (const p of e.requiredLoc ?? []) expect(p).toContain("$");
    }
  });

  it("paths use forward slashes and no trailing slash", () => {
    for (const e of CK3_SCHEMA) {
      expect(e.path).not.toContain("\\");
      expect(e.path.endsWith("/")).toBe(false);
    }
  });
});

describe("REF_FIELDS / PREFIX_REFS sanity", () => {
  it("no duplicate REF_FIELD keys", () => {
    const keys = REF_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("coerceFreqs", () => {
  it("never lets a null table through, and keeps the tables that are usable", () => {
    // `typeof null === "object"`: a null tokens table reaching FreqData makes
    // completion throw on `freqs.tokens[name]`.
    const out = coerceFreqs({ contexts: { effect_block: { add_gold: 7 } }, tokens: null });
    expect(out.tokens).toEqual({});
    expect(out.contexts.effect_block).toEqual({ add_gold: 7 });
    expect(coerceFreqs({ contexts: null, tokens: { add_gold: 7 } }).contexts.effect_block).toEqual({});
    expect(coerceFreqs({ contexts: null, tokens: { add_gold: 7 } }).tokens).toEqual({ add_gold: 7 });
    expect(coerceFreqs(null).tokens).toEqual({});
  });
});
