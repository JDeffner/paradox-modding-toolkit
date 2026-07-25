/**
 * Templated modifier expansion ($CULTURE$_opinion → french_opinion): compile /
 * match / expand units, plus the hover fallback card and the unknown-context
 * completion items built on them. Placeholder→kind mappings are locked to what
 * was verified against vanilla 1.19 (common/modifier_definition_formats).
 */
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  compileModifierTemplates,
  expandModifierTemplates,
  matchTemplatedModifier,
  templatedModifierDoc,
} from "../src/data/modifierTemplates";
import { CompletionFeature } from "../src/features/completion";
import { provideHover } from "../src/features/hover";
import { ServerData } from "../src/serverData";
import { loadSchema } from "../src/schema/loader";
import type { Definition, TokenData } from "@px-lsp/protocol/types";

let uriCounter = 0;
const uri = () => `file:///mod/common/modifiers/tmpl-${uriCounter++}.txt`;

function tmpl(name: string, traits = "Use areas: character"): TokenData {
  return { name, kind: "modifier", doc: "", scopes: [], traits };
}

function def(name: string, kind: string, extra: Partial<Definition> = {}): Definition {
  return { name, kind, file: `F:/mod/common/${kind}/x.txt`, line: 4, source: "mod", ...extra };
}

const RAW = [
  tmpl("$CULTURE$_opinion"),
  tmpl("$RELIGIOUS_FAMILY$_opinion"),
  tmpl("$TERRAIN_TYPE$_advantage"),
  tmpl("$MEN_AT_ARMS_TYPE$_damage_add"),
  tmpl("stationed_$MEN_AT_ARMS_TYPE$_damage_add"),
  tmpl("$SUBJECT_SALARY$_whatever"), // unmapped placeholder: dropped
  tmpl("plain_modifier"), // not templated: dropped
];

function makeData(): ServerData {
  const data = new ServerData();
  data.setModifierTemplates(RAW);
  data.index.addAll([
    def("french", "culture"),
    def("rf_pagan", "religion_family", { source: "vanilla" }),
    def("plains", "terrain_type", { source: "vanilla" }),
    def("french", "loc_key", { value: "French" }), // same name, wrong kind: ignored
  ]);
  return data;
}

describe("compileModifierTemplates", () => {
  it("splits prefix/placeholder/suffix and drops unmapped or untemplated names", () => {
    const compiled = compileModifierTemplates(RAW);
    expect(compiled.map((t) => t.name)).toEqual([
      "$CULTURE$_opinion",
      "$RELIGIOUS_FAMILY$_opinion",
      "$TERRAIN_TYPE$_advantage",
      "$MEN_AT_ARMS_TYPE$_damage_add",
      "stationed_$MEN_AT_ARMS_TYPE$_damage_add",
    ]);
    const stationed = compiled.find((t) => t.prefix === "stationed_")!;
    expect(stationed.suffix).toBe("_damage_add");
    expect(stationed.placeholder).toBe("MEN_AT_ARMS_TYPE");
    expect(stationed.traits).toContain("Use areas");
  });

  it("stationed men-at-arms variants exclude nomadic_horde (verified absent in vanilla)", () => {
    const compiled = compileModifierTemplates(RAW);
    const plain = compiled.find((t) => t.name === "$MEN_AT_ARMS_TYPE$_damage_add")!;
    const stationed = compiled.find((t) => t.prefix === "stationed_")!;
    expect(plain.spec.values).toContain("nomadic_horde");
    expect(stationed.spec.values).not.toContain("nomadic_horde");
  });
});

describe("matchTemplatedModifier", () => {
  const data = makeData();
  const lookup = (n: string) => data.index.lookup(n);

  it("resolves an index-backed expansion to its definition", () => {
    const m = matchTemplatedModifier("french_opinion", data.modifierTemplates, lookup)!;
    expect(m.base).toBe("french");
    expect(m.def?.kind).toBe("culture");
    expect(templatedModifierDoc(m)).toContain("culture `french`");
    expect(templatedModifierDoc(m)).toContain("x.txt:5");
  });

  it("disambiguates shared suffixes by which lookup resolves", () => {
    const m = matchTemplatedModifier("rf_pagan_opinion", data.modifierTemplates, lookup)!;
    expect(m.template.name).toBe("$RELIGIOUS_FAMILY$_opinion");
    expect(m.def?.kind).toBe("religion_family");
  });

  it("matches fixed men-at-arms base types without an index lookup", () => {
    const m = matchTemplatedModifier("heavy_infantry_damage_add", data.modifierTemplates, lookup)!;
    expect(m.base).toBe("heavy_infantry");
    expect(m.def).toBeUndefined();
    expect(templatedModifierDoc(m)).toContain("built-in men-at-arms base type `heavy_infantry`");
    expect(
      matchTemplatedModifier("stationed_heavy_infantry_damage_add", data.modifierTemplates, lookup)
    ).not.toBeNull();
  });

  it("rejects unknown bases, excluded combinations, and empty placeholder slices", () => {
    expect(matchTemplatedModifier("martian_opinion", data.modifierTemplates, lookup)).toBeNull();
    expect(matchTemplatedModifier("armored_footmen_damage_add", data.modifierTemplates, lookup)).toBeNull();
    expect(
      matchTemplatedModifier("stationed_nomadic_horde_damage_add", data.modifierTemplates, lookup)
    ).toBeNull();
    expect(matchTemplatedModifier("_opinion", data.modifierTemplates, lookup)).toBeNull();
  });
});

describe("expandModifierTemplates", () => {
  it("expands index-backed kinds and fixed value sets in one pass", () => {
    const data = makeData();
    const names = expandModifierTemplates(data.modifierTemplates, data.index, new Set()).map((e) => e.name);
    expect(names).toContain("french_opinion");
    expect(names).toContain("rf_pagan_opinion");
    expect(names).toContain("plains_advantage");
    expect(names).toContain("pikemen_damage_add");
    expect(names).toContain("stationed_pikemen_damage_add");
    expect(names).not.toContain("stationed_nomadic_horde_damage_add");
    expect(names).not.toContain("french_advantage"); // kinds never cross templates
  });

  it("respects the completableKinds gate for index-backed kinds only", () => {
    const data = makeData();
    const names = expandModifierTemplates(data.modifierTemplates, data.index, new Set(["culture"])).map(
      (e) => e.name
    );
    expect(names).toContain("french_opinion");
    expect(names).not.toContain("plains_advantage");
    expect(names).toContain("heavy_infantry_damage_add"); // fixed sets are not gated
  });
});

describe("hover: templated modifier fallback card", () => {
  function hoverMd(data: ServerData, text: string, line: number, character: number): string | null {
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    const hover = provideHover(data, doc, { line, character }, new Set(["character"]), null);
    return hover ? (hover.contents as { value: string }).value : null;
  }

  it("french_opinion gets a card naming the template and the culture's file", () => {
    const md = hoverMd(makeData(), "my_modifier = {\n\tfrench_opinion = 10\n}", 1, 4);
    expect(md).toContain("french_opinion");
    expect(md).toContain("generated from");
    expect(md).toContain("$CULTURE$_opinion");
    expect(md).toContain("culture `french`");
    expect(md).toContain("Use areas: character");
  });

  it("a real token or definition with the same name wins over the fallback", () => {
    const data = makeData();
    data.setTokens([{ name: "french_opinion", kind: "modifier", doc: "concrete dump", scopes: [] }]);
    const md = hoverMd(data, "my_modifier = {\n\tfrench_opinion = 10\n}", 1, 4);
    expect(md).toContain("concrete dump");
    expect(md).not.toContain("generated from");
  });

  it("unmatched names still hover nothing", () => {
    expect(hoverMd(makeData(), "my_modifier = {\n\tmartian_opinion = 10\n}", 1, 4)).toBeNull();
  });
});

describe("completion: expansions in unknown (modifier) context only", () => {
  function makeEnv() {
    const data = makeData();
    data.setTokens([
      { name: "monthly_income", kind: "modifier", doc: "", scopes: [] },
      { name: "add_gold", kind: "effect", doc: "", scopes: ["character"] },
    ]);
    return { data, completion: new CompletionFeature(data, () => loadSchema(null)) };
  }

  function provideAt(env: ReturnType<typeof makeEnv>, text: string) {
    const cursor = text.indexOf("|");
    const clean = text.replace("|", "");
    const doc = TextDocument.create(uri(), "paradox", 1, clean);
    return env.completion.provide(doc, cursor, new Set(["character"]), null);
  }

  it("offers expansions where modifier tokens live, with resolvable docs", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "my_modifier = {\n\tfrench|\n}");
    const item = items.find((i) => i.label === "french_opinion")!;
    expect(item).toBeDefined();
    expect(item.detail).toContain("$CULTURE$_opinion");
    const resolved = env.completion.resolve(item);
    expect(JSON.stringify(resolved.documentation)).toContain("culture `french`");
  });

  it("does not offer expansions in trigger/effect blocks (mirrors modifier tokens)", () => {
    const env = makeEnv();
    const effect = provideAt(env, "e.1 = {\n\timmediate = {\n\t\tfrench|\n\t}\n}");
    expect(effect.items.map((i) => i.label)).not.toContain("french_opinion");
    const trigger = provideAt(env, "e.1 = {\n\ttrigger = {\n\t\tfrench|\n\t}\n}");
    expect(trigger.items.map((i) => i.label)).not.toContain("french_opinion");
  });
});
