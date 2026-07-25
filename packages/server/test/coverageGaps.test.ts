/**
 * Locks the fixes from the 2026-07 mod coverage audit
 * (scripts/audit-mod-coverage.ts): flags/lists/trait-groups/aliases as indexed
 * names, enum-value + namespace semantic coloring, and the hover fallback cards
 * (keywords, scope words, macro params, enum members, namespaces).
 */
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { provideHover } from "../src/features/hover";
import { provideSemanticTokens } from "../src/features/semanticTokens";
import { ServerData } from "../src/serverData";
import { loadSchema } from "../src/schema/loader";
import { extractReferences } from "../src/index/references";
import { extractDefinitions } from "../src/index/extract";
import { structureContextAt } from "../src/structure";
import { parseScript } from "../src/parser";
import { CK3_SCHEMA } from "../src/games/ck3/schema";

const schema = loadSchema(null);
const eventEntry = CK3_SCHEMA.find((e) => e.kind === "event")!;
const traitEntry = CK3_SCHEMA.find((e) => e.kind === "trait")!;
const conceptEntry = CK3_SCHEMA.find((e) => e.kind === "game_concept")!;

let uriCounter = 0;
const uri = () => `file:///mod/events/gaps-fixture-${uriCounter++}.txt`;

function hoverMd(
  data: ServerData,
  text: string,
  line: number,
  character: number,
  entry = eventEntry
): string | null {
  const doc = TextDocument.create(uri(), "paradox", 1, text);
  const hover = provideHover(data, doc, { line, character }, new Set(["character"]), entry, () => schema);
  return hover ? (hover.contents as { value: string }).value : null;
}

describe("implicit definitions: flags, lists, trait groups, aliases", () => {
  it("add_character_flag declares a flag; has_*_flag references it", () => {
    const text =
      "x = {\n\tadd_character_flag = my_flag\n\tadd_house_flag = { flag = house_flag days = 10 }\n\ttr = { has_character_flag = my_flag }\n}";
    const out = extractReferences(text, "C:\\m\\common\\decisions\\f.txt", "mod", schema);
    expect(out.implicitDefs.map((d) => `${d.kind}:${d.name}`)).toEqual(
      expect.arrayContaining(["flag:my_flag", "flag:house_flag"])
    );
    expect(out.references.some((r) => r.name === "my_flag" && r.kinds.includes("flag"))).toBe(true);
  });

  it("add_to_list declares a list; is_in_list and list = reference it", () => {
    const text =
      "x = {\n\tadd_to_list = characters\n\ttr = { is_in_list = characters }\n\tevery_in_list = { list = characters }\n}";
    const out = extractReferences(text, "C:\\m\\common\\decisions\\f.txt", "mod", schema);
    expect(out.implicitDefs.some((d) => d.kind === "list" && d.name === "characters")).toBe(true);
    expect(out.references.filter((r) => r.name === "characters" && r.kinds.includes("list"))).toHaveLength(2);
  });

  it("trait group = X indexes a trait_group definition", () => {
    const text = "realm_1 = {\n\tgroup = revealed_realm\n}\nrealm_2 = {\n\tgroup = revealed_realm\n}";
    const defs = extractDefinitions(text, traitEntry, "C:\\m\\common\\traits\\t.txt", "mod");
    const groups = defs.filter((d) => d.kind === "trait_group");
    expect(groups).toHaveLength(1); // deduped per file
    expect(groups[0].name).toBe("revealed_realm");
    expect(groups[0].container).toBe("realm_1");
  });

  it("game_concept alias entries index as game_concept definitions", () => {
    const text = "cultivator = {\n\talias = { cultivators dao_seeker }\n}";
    const defs = extractDefinitions(text, conceptEntry, "C:\\m\\common\\game_concepts\\c.txt", "mod");
    expect(defs.map((d) => d.name)).toEqual(["cultivator", "cultivators", "dao_seeker"]);
  });
});

describe("semantic coloring: enums and namespaces", () => {
  const ENUM_MEMBER = 6;
  const EVENT = 5;

  function tokensOf(text: string) {
    const data = new ServerData();
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    const raw = provideSemanticTokens(data, doc, schema.refFields, eventEntry, schema.structures).data;
    const out = [];
    let line = 0;
    let char = 0;
    for (let i = 0; i < raw.length; i += 5) {
      line += raw[i];
      char = raw[i] === 0 ? char + raw[i + 1] : raw[i + 1];
      out.push({ line, char, length: raw[i + 2], type: raw[i + 3] });
    }
    return out;
  }

  it("type = character_event colors as an enum member", () => {
    const tokens = tokensOf("my.1 = {\n\ttype = character_event\n}");
    expect(
      tokens.some((t) => t.line === 1 && t.length === "character_event".length && t.type === ENUM_MEMBER)
    ).toBe(true);
  });

  it("namespace values color as events", () => {
    const tokens = tokensOf("namespace = mymod\n");
    expect(tokens.some((t) => t.line === 0 && t.length === "mymod".length && t.type === EVENT)).toBe(true);
  });
});

describe("hover fallback cards", () => {
  it("grammar keywords: limit", () => {
    const md = hoverMd(new ServerData(), "my.1 = {\n\ttrigger = { limit = { } }\n}", 1, 14);
    expect(md).toContain("keyword");
    expect(md).toContain("restricts the enclosing");
  });

  it("scope words: ROOT (uppercase) and prevprev", () => {
    const md = hoverMd(new ServerData(), "my.1 = {\n\tleft_portrait = { character = ROOT }\n}", 1, 32);
    expect(md).toContain("scope");
    expect(md).toContain("started with");
    const md2 = hoverMd(new ServerData(), "my.1 = {\n\tx = prevprev\n}", 1, 6);
    expect(md2).toContain("2 scope-changes back");
  });

  it("macro params: AMOUNT resolves against the called scripted effect", () => {
    const data = new ServerData();
    data.index.addAll([
      {
        name: "apply_xp_effect",
        kind: "scripted_effect",
        file: "e.txt",
        line: 0,
        source: "mod",
        params: ["AMOUNT"],
      },
    ]);
    const md = hoverMd(data, "my.1 = {\n\tapply_xp_effect = { AMOUNT = 3 }\n}", 1, 22);
    expect(md).toContain("parameter");
    expect(md).toContain("apply_xp_effect");
  });

  it("enum members: character_event names its alternatives", () => {
    const md = hoverMd(new ServerData(), "my.1 = {\n\ttype = character_event\n}", 1, 10);
    expect(md).toContain("type value");
    expect(md).toContain("letter_event");
  });

  it("event namespaces", () => {
    const data = new ServerData();
    data.modNamespaces.add("mymod");
    const md = hoverMd(data, "namespace = mymod\n", 0, 14);
    expect(md).toContain("event namespace");
  });

  it("dot chains resolve the segment under the cursor", () => {
    const data = new ServerData();
    data.setTokens([{ name: "location", kind: "event_target", doc: "The location", scopes: ["province"] }]);
    const text = "my.1 = {\n\tx = root.location\n}";
    const col = text.split("\n")[1].indexOf("location");
    const md = hoverMd(data, text, 1, col + 2);
    expect(md).toContain("event target");
    expect(md).toContain("location");
  });
});

describe("structure additions from the audit", () => {
  it("customizable_localization text block: localization_key + setup_scope", () => {
    const text = "my_loc = {\n\ttype = character\n\ttext = {\n\t\t|\n\t}\n}";
    const parse = parseScript(text.replace("|", ""));
    const ctx = structureContextAt(parse, text.indexOf("|"), "customizable_localization", schema.structures);
    expect(ctx?.block).toBe("text");
    expect(ctx?.keys.has("localization_key")).toBe(true);
    expect(ctx?.keys.has("setup_scope")).toBe(true);
  });

  it("story_cycle effect_group and nested triggered_effect", () => {
    const text = "my_story = {\n\teffect_group = {\n\t\ttriggered_effect = {\n\t\t\t|\n\t\t}\n\t}\n}";
    const parse = parseScript(text.replace("|", ""));
    const ctx = structureContextAt(parse, text.indexOf("|"), "story_cycle", schema.structures);
    expect(ctx?.block).toBe("triggered_effect");
    expect(ctx?.keys.has("effect")).toBe(true);
  });

  it("interaction ai_targets block carries the ai_recipients enum", () => {
    const keys = schema.structures.keysByKindBlock.get("character_interaction")?.get("ai_targets");
    expect(keys?.get("ai_recipients")?.values).toContain("scripted_relations");
    expect(schema.structures.keysByKindBlock.get("character_interaction")?.get("")?.has("ai_frequency")).toBe(
      true
    );
  });

  it("KEY_PATCHES fill enums without reordering: trait valid_sex, scheme category", () => {
    expect(schema.structures.keysByKindBlock.get("trait")?.get("")?.get("valid_sex")?.values).toBe(
      "enum:all|male|female"
    );
    const category = schema.structures.keysByKindBlock.get("scheme_type")?.get("")?.get("category");
    expect(category?.values).toBe("enum:personal|contract|hostile");
    expect(category?.freq).toBe(71); // harvested metadata preserved
  });
});
