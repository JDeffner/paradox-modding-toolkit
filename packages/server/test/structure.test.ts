/**
 * Unit tests (not corpus-gated) for the v1.1 §B2/§B3 block-schema layer:
 * the prefix-detection helper (wordAt), structure-context detection, ambient
 * seeding of inferScopeAt, and completion/hover wiring against a synthetic
 * character_interaction document.
 */
import { describe, expect, it } from "vitest";
import { CompletionItemKind } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parseScript } from "../src/parser";
import { ScopeModel } from "../src/scopes/model";
import { collectSavedScopeTypes, inferScopeAt } from "../src/scopes/inference";
import { scopePrefixBefore, wordRangeAt } from "../src/wordAt";
import { structureContextAt } from "../src/structure";
import { loadSchema } from "../src/schema/loader";
import { CK3_SCHEMA } from "../src/games/ck3/schema";
import { CompletionFeature } from "../src/features/completion";
import { provideHover } from "../src/features/hover";
import { ServerData } from "../src/serverData";
import type { SchemaEntry } from "../src/schema/types";

const schema = loadSchema(null);
const interactionEntry = CK3_SCHEMA.find((e) => e.kind === "character_interaction")!;
const eventEntry = CK3_SCHEMA.find((e) => e.kind === "event")!;

let uriCounter = 0;
const uri = () => `file:///mod/common/character_interactions/fixture-${uriCounter++}.txt`;

describe("scopePrefixBefore (wordAt §B3)", () => {
  function prefixAt(line: string, marker = "|"): string | null {
    const at = line.indexOf(marker);
    const text = line.replace(marker, "");
    const range = wordRangeAt(text, at);
    if (!range) throw new Error("no word at marker");
    return scopePrefixBefore(text, range);
  }

  it("detects scope: before the word", () => {
    expect(prefixAt("scope:|secondary_recipient = { }")).toBe("scope");
  });

  it("detects var: / global_var:", () => {
    expect(prefixAt("var:|my_var")).toBe("var");
    expect(prefixAt("global_var:|g")).toBe("global_var");
  });

  it("returns null for a bare word", () => {
    expect(prefixAt("is_|shown = { }")).toBeNull();
  });

  it("returns null when the colon belongs to a longer non-prefix token", () => {
    // `foo:bar` — `foo` is not a scope prefix.
    expect(prefixAt("foo:|bar")).toBeNull();
  });
});

describe("structureContextAt (§B2)", () => {
  function ctxAt(text: string) {
    const parse = parseScript(text.replace("|", ""));
    const offset = text.indexOf("|");
    return structureContextAt(parse, offset, "character_interaction", schema.structures);
  }

  it("resolves top-level inside an interaction body", () => {
    const ctx = ctxAt("my_interaction = {\n\t|\n}");
    expect(ctx?.block).toBe("");
    expect(ctx?.keys.has("is_shown")).toBe(true);
    expect(ctx?.keys.has("desc")).toBe(true);
  });

  it("resolves the send_option sub-block", () => {
    const ctx = ctxAt("my_interaction = {\n\tsend_option = {\n\t\t|\n\t}\n}");
    expect(ctx?.block).toBe("send_option");
    expect(ctx?.keys.has("localization")).toBe(true);
  });

  it("returns null for a kind with no structure", () => {
    const parse = parseScript("x = {}");
    // trait gained a harvested structure in the full .info sweep; use a kind
    // that genuinely has none.
    expect(structureContextAt(parse, 5, "kind_without_structure", schema.structures)).toBeNull();
  });
});

describe("dynamic description nodes (events/_events.info Descriptions)", () => {
  function ctxAt(text: string, kind: string) {
    const parse = parseScript(text.replace("|", ""));
    const offset = text.indexOf("|");
    return structureContextAt(parse, offset, kind, schema.structures);
  }

  it("offers triggered_desc/first_valid/random_valid inside an event desc block", () => {
    const ctx = ctxAt("my_event.1 = {\n\tdesc = {\n\t\t|\n\t}\n}", "event");
    expect(ctx?.block).toBe("desc");
    for (const key of ["desc", "triggered_desc", "first_valid", "random_valid"]) {
      expect(ctx?.keys.has(key), key).toBe(true);
    }
  });

  it("offers trigger + desc inside triggered_desc, at any nesting depth", () => {
    const ctx = ctxAt(
      "my_event.1 = {\n\tdesc = {\n\t\tfirst_valid = {\n\t\t\ttriggered_desc = {\n\t\t\t\t|\n\t\t\t}\n\t\t}\n\t}\n}",
      "event"
    );
    expect(ctx?.block).toBe("triggered_desc");
    expect(ctx?.keys.has("trigger")).toBe(true);
    expect(ctx?.keys.has("desc")).toBe(true);
  });

  it("offers count inside random_valid", () => {
    const ctx = ctxAt("my_event.1 = {\n\ttitle = {\n\t\trandom_valid = {\n\t\t\t|\n\t\t}\n\t}\n}", "event");
    expect(ctx?.keys.has("count")).toBe(true);
    expect(ctx?.keys.has("triggered_desc")).toBe(true);
  });

  it("covers option name blocks and decision desc fields too", () => {
    const name = ctxAt("my_event.1 = {\n\toption = {\n\t\tname = {\n\t\t\t|\n\t\t}\n\t}\n}", "event");
    expect(name?.keys.has("triggered_desc")).toBe(true);
    const dec = ctxAt("my_decision = {\n\tconfirm_text = {\n\t\t|\n\t}\n}", "decision");
    expect(dec?.keys.has("first_valid")).toBe(true);
  });
});

describe("event override_* blocks (_events.info)", () => {
  function ctxAt(text: string) {
    const parse = parseScript(text.replace("|", ""));
    const offset = text.indexOf("|");
    return structureContextAt(parse, offset, "event", schema.structures);
  }

  it("resolves reference/trigger inside override_background (and the other override blocks)", () => {
    const ctx = ctxAt("my.1 = {\n\toverride_background = {\n\t\t|\n\t}\n}");
    expect(ctx?.block).toBe("override_background");
    expect(ctx?.keys.has("reference")).toBe(true);
    expect(ctx?.keys.has("trigger")).toBe(true);
    for (const block of [
      "override_transition",
      "override_effect_2d",
      "override_icon",
      "override_header_background",
      "override_sound",
    ]) {
      const sub = ctxAt(`my.1 = {\n\t${block} = {\n\t\t|\n\t}\n}`);
      expect(sub?.keys.has("reference"), block).toBe(true);
    }
  });

  it("hover on `reference` renders the block-key doc", () => {
    const data = new ServerData();
    const text = 'my.1 = {\n\toverride_background = {\n\t\treference = "wilderness_mountains"\n\t}\n}';
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    const col = text.split("\n")[2].indexOf("reference");
    const hover = provideHover(
      data,
      doc,
      { line: 2, character: col + 1 },
      new Set(["character"]),
      eventEntry,
      () => schema
    );
    expect(hover).not.toBeNull();
    const md = (hover!.contents as { value: string }).value;
    expect(md).toContain("event key");
    expect(md).toContain("common/event_backgrounds");
  });

  it("completes event backgrounds after `reference = ` inside override_background", () => {
    const data = new ServerData();
    data.index.addAll([
      {
        name: "wilderness_mountains",
        kind: "event_background",
        file: "01_event_backgrounds.txt",
        line: 0,
        source: "vanilla",
      },
    ]);
    const completion = new CompletionFeature(data, () => schema);
    const text = "my.1 = {\n\toverride_background = {\n\t\treference = \n\t}\n}";
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    const offset = text.indexOf("reference = ") + "reference = ".length;
    const { items } = completion.provide(doc, offset, new Set(["character"]), eventEntry);
    expect(items.map((i) => i.label)).toContain("wilderness_mountains");
  });
});

describe("ambient seeding of inferScopeAt (§B3)", () => {
  const model = new ScopeModel([]);
  const ambient = interactionEntry.ambientScopes!;

  it("seeds scope:actor to character via collectSavedScopeTypes", () => {
    const text = "my_interaction = {\n\tis_shown = { scope:actor = { | } }\n}";
    const parse = parseScript(text.replace("|", ""));
    const offset = text.indexOf("|");
    const saved = collectSavedScopeTypes(parse, model, new Set(["character"]), ambient);
    expect(saved.get("actor")).toEqual(new Set(["character"]));
    const inf = inferScopeAt(parse, offset, model, new Set(["character"]), saved);
    expect(inf.scopes && [...inf.scopes]).toEqual(["character"]);
  });

  it("without ambient, scope:actor is unknown", () => {
    const text = "my_interaction = {\n\tis_shown = { scope:actor = { | } }\n}";
    const parse = parseScript(text.replace("|", ""));
    const offset = text.indexOf("|");
    const saved = collectSavedScopeTypes(parse, model, new Set(["character"]));
    const inf = inferScopeAt(parse, offset, model, new Set(["character"]), saved);
    expect(inf.scopes).toBeNull();
  });
});

describe("harvested structure layer (full .info sweep)", () => {
  it("covers trait keys like shown_in_ruler_designer with the game's own doc", () => {
    const traitKeys = schema.structures.keysByKindBlock.get("trait")?.get("");
    expect(traitKeys).toBeDefined();
    const spec = traitKeys!.get("shown_in_ruler_designer");
    expect(spec).toBeDefined();
    expect(spec!.doc).toContain("ruler designer");
    expect(spec!.values).toBe("bool");
  });

  it("covers dozens of kinds beyond the curated four", () => {
    expect(schema.structures.keysByKindBlock.size).toBeGreaterThan(50);
    // Curated docs win on collisions.
    const interaction = schema.structures.keysByKindBlock.get("character_interaction")!.get("")!;
    expect(interaction.get("is_shown")!.doc).toContain("Avoid actor-only");
  });
});

describe("completion wiring (§B2/§B3)", () => {
  const data = new ServerData();
  const completion = new CompletionFeature(data, () => schema);

  it("offers structure keys ranked above everything at interaction top level", () => {
    const text = "my_interaction = {\n\t\n}";
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    const offset = text.indexOf("\n\t") + 2;
    const { items } = completion.provide(doc, offset, new Set(["character"]), interactionEntry);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("is_shown");
    expect(labels).toContain("desc");
    // Structure keys are the top slot tier ("0"); everything else is tier ≥ "1"
    // (Workstream C composed scheme "<T><F><S><label>"), so a structure key sorts
    // ahead of every non-structure item.
    const sorted = [...items].sort((a, b) => (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label));
    const structLabels = new Set(
      items.filter((i) => i.kind === CompletionItemKind.Keyword).map((i) => i.label)
    );
    const firstNonStruct = sorted.findIndex((i) => !structLabels.has(i.label));
    const isShownRank = sorted.findIndex((i) => i.label === "is_shown");
    if (firstNonStruct >= 0) expect(isShownRank).toBeLessThan(firstNonStruct);
    expect(items.find((i) => i.label === "is_shown")!.sortText!.startsWith("0")).toBe(true);
  });

  it("offers ambient scopes after scope:", () => {
    const text = "my_interaction = {\n\tis_shown = { scope: }\n}";
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    const offset = text.indexOf("scope:") + "scope:".length;
    const { items } = completion.provide(doc, offset, new Set(["character"]), interactionEntry);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("actor");
    expect(labels).toContain("recipient");
    expect(labels).toContain("secondary_recipient");
  });
});

describe("hover wiring (§B2/§B3)", () => {
  const data = new ServerData();

  it("renders the doc for a structure key", () => {
    const text = "my_interaction = {\n\tis_shown = { }\n}";
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    const position = { line: 1, character: 2 }; // on `is_shown`
    const hover = provideHover(data, doc, position, new Set(["character"]), interactionEntry, () => schema);
    expect(hover).not.toBeNull();
    const md = (hover!.contents as { value: string }).value;
    expect(md).toContain("character interaction key");
    expect(md).toMatch(/character_interactions/);
  });

  it("renders a saved-scope card with type and ambient doc for scope:actor", () => {
    const text = "my_interaction = {\n\tis_shown = { scope:actor = { } }\n}";
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    const col = text.split("\n")[1].indexOf("actor");
    const hover = provideHover(
      data,
      doc,
      { line: 1, character: col + 1 },
      new Set(["character"]),
      interactionEntry,
      () => schema
    );
    expect(hover).not.toBeNull();
    const md = (hover!.contents as { value: string }).value;
    expect(md).toContain("scope:actor");
    expect(md).toContain("character");
    expect(md.toLowerCase()).toContain("sending the interaction");
  });

  it("shows the save site for a file-local saved scope", () => {
    const text =
      "my_interaction = {\n\tredirect = { save_scope_as = my_target }\n\ton_accept = { scope:my_target = { } }\n}";
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    const col = text.split("\n")[2].indexOf("my_target");
    const hover = provideHover(
      data,
      doc,
      { line: 2, character: col + 1 },
      new Set(["character"]),
      interactionEntry,
      () => schema
    );
    const md = (hover!.contents as { value: string }).value;
    expect(md).toContain("Saved in this file");
  });
});

describe("schema data shape (§B2/§B3)", () => {
  it("attaches structure + ambientScopes to the interaction entry", () => {
    const e: SchemaEntry = interactionEntry;
    expect(e.structure?.topLevel.some((k) => k.key === "send_option")).toBe(true);
    expect(e.structure?.blocks?.send_option?.length).toBeGreaterThan(0);
    expect(e.ambientScopes?.map((a) => a.name)).toContain("actor");
  });

  it("builds a structure index with the expected kinds", () => {
    expect(schema.structures.keysByKindBlock.has("character_interaction")).toBe(true);
    expect(schema.structures.keysByKindBlock.has("event")).toBe(true);
    expect(schema.structures.keysByKindBlock.has("decision")).toBe(true);
    expect(schema.structures.source("character_interaction")).toBe("character_interactions");
  });
});
