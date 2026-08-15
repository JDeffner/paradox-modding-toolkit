import { afterEach, describe, expect, it } from "vitest";
import { parseScript } from "../src/parser";
import { ScopeModel } from "../src/scopes/model";
import { collectSavedScopeTypes, inferScopeAt, rootScopesAt } from "../src/scopes/inference";
import { activeProfile, setActiveProfile } from "../src/games/active";
import { resolveProfile } from "../src/games/registry";
import type { TokenData } from "@px-lsp/protocol/types";

/** A miniature link table shaped like real script_docs output. */
const TOKENS: TokenData[] = [
  { name: "liege", kind: "event_target", doc: "", scopes: ["input: character", "output: character"] },
  {
    name: "primary_title",
    kind: "event_target",
    doc: "",
    scopes: ["input: character", "output: landed_title"],
  },
  { name: "holder", kind: "event_target", doc: "", scopes: ["input: landed_title", "output: character"] },
  { name: "faith", kind: "event_target", doc: "", scopes: ["input: character", "output: faith"] },
  {
    name: "every_held_title",
    kind: "effect",
    doc: "",
    scopes: ["character"],
    traits: "Supported Targets: landed_title",
  },
  {
    name: "any_vassal",
    kind: "trigger",
    doc: "",
    scopes: ["character"],
    traits: "Supported Targets: character",
  },
  { name: "add_gold", kind: "effect", doc: "", scopes: ["character"] },
  { name: "change_development_level", kind: "effect", doc: "", scopes: ["county", "province"] },
];

const model = new ScopeModel(TOKENS);
const CHARACTER = new Set(["character"]);

function scopesAt(snippet: string, rootScopes: Set<string> | null = CHARACTER): string[] | null {
  const offset = snippet.indexOf("|");
  if (offset < 0) throw new Error("snippet needs a | marker");
  const text = snippet.replace("|", "");
  const parse = parseScript(text);
  const saved = collectSavedScopeTypes(parse, model, rootScopes);
  const result = inferScopeAt(parse, offset, model, rootScopes, saved);
  return result.scopes ? [...result.scopes].sort() : null;
}

describe("scope model", () => {
  it("builds links with inputs/outputs from script_docs shapes", () => {
    expect(model.links.get("primary_title")?.outputs).toEqual(new Set(["landed_title"]));
    expect(model.links.get("holder")?.inputs).toEqual(new Set(["landed_title"]));
  });

  it("derives iterator targets from Supported Targets metadata", () => {
    expect(model.outputOf("every_held_title")).toEqual(new Set(["landed_title"]));
    expect(model.outputOf("random_held_title")).toEqual(new Set(["landed_title"]));
    expect(model.outputOf("any_vassal")).toEqual(new Set(["character"]));
  });

  it("exposes token input scopes for ranking", () => {
    expect(model.inputScopesOf("effect", "add_gold")).toEqual(new Set(["character"]));
    expect(model.inputScopesOf("effect", "change_development_level")).toEqual(
      new Set(["county", "province"])
    );
    expect(model.inputScopesOf("effect", "unknown_thing")).toBeNull();
  });
});

describe("scope inference at cursor", () => {
  it("root scope at event top level", () => {
    expect(scopesAt("my.1 = {\n\timmediate = {\n\t\t|\n\t}\n}")).toEqual(["character"]);
  });

  it("iterator changes scope (every_held_title → landed_title)", () => {
    expect(scopesAt("my.1 = {\n\timmediate = {\n\t\tevery_held_title = {\n\t\t\t|\n\t\t}\n\t}\n}")).toEqual([
      "landed_title",
    ]);
  });

  it("limit inside an iterator keeps the iterated scope", () => {
    expect(
      scopesAt("my.1 = {\n\timmediate = {\n\t\tevery_held_title = {\n\t\t\tlimit = { | }\n\t\t}\n\t}\n}")
    ).toEqual(["landed_title"]);
  });

  it("links chain: liege stays character, primary_title goes to title", () => {
    expect(scopesAt("e = {\n\tliege = {\n\t\t|\n\t}\n}")).toEqual(["character"]);
    expect(scopesAt("e = {\n\tprimary_title = {\n\t\t|\n\t}\n}")).toEqual(["landed_title"]);
  });

  it("dot-chains fold left to right (liege.primary_title)", () => {
    expect(scopesAt("e = {\n\tliege.primary_title = {\n\t\t|\n\t}\n}")).toEqual(["landed_title"]);
  });

  it("root resets to the seed scope", () => {
    expect(scopesAt("e = {\n\tprimary_title = {\n\t\troot = {\n\t\t\t|\n\t\t}\n\t}\n}")).toEqual([
      "character",
    ]);
  });

  it("prev returns to the previous scope", () => {
    expect(scopesAt("e = {\n\tprimary_title = {\n\t\tprev = {\n\t\t\t|\n\t\t}\n\t}\n}")).toEqual([
      "character",
    ]);
  });

  it("scope:x resolves through save_scope_as in the same file", () => {
    const text =
      "my.1 = {\n\timmediate = {\n\t\tevery_held_title = {\n\t\t\tsave_scope_as = the_title\n\t\t}\n\t}\n\toption = {\n\t\tscope:the_title = {\n\t\t\t|\n\t\t}\n\t}\n}";
    expect(scopesAt(text)).toEqual(["landed_title"]);
  });

  it("unsaved scope:x is unknown, not wrong", () => {
    expect(scopesAt("e = {\n\tscope:never_saved = {\n\t\t|\n\t}\n}")).toBeNull();
  });

  it("var:x is unknown", () => {
    expect(scopesAt("e = {\n\tvar:mystery = {\n\t\t|\n\t}\n}")).toBeNull();
  });

  it("null root scopes stay unknown through transparent blocks", () => {
    expect(scopesAt("e = {\n\ttrigger = {\n\t\t|\n\t}\n}", null)).toBeNull();
  });

  it("unknown block keys keep the current scope (best effort)", () => {
    expect(scopesAt("e = {\n\tsome_scripted_effect_call = {\n\t\t|\n\t}\n}")).toEqual(["character"]);
  });

  it("control flow and boolean operators are scope-transparent", () => {
    expect(
      scopesAt("e = {\n\ttrigger = {\n\t\tNOT = {\n\t\t\tany_vassal = {\n\t\t\t\t|\n\t\t\t}\n\t\t}\n\t}\n}")
    ).toEqual(["character"]);
  });
});

describe("collectSavedScopeTypes", () => {
  it("merges multiple saves of the same name (conflict → union)", () => {
    const text =
      "e = {\n\tevery_held_title = { save_scope_as = thing }\n\tliege = { save_scope_as = thing }\n}";
    const parse = parseScript(text);
    const saved = collectSavedScopeTypes(parse, model, CHARACTER);
    expect(saved.get("thing")).toEqual(new Set(["landed_title", "character"]));
  });
});

/**
 * Per-definition root scopes come from the active profile (profile.defRootKeys),
 * not from a constant in the engine. This was a real, measured completion bug:
 * one game's events declare `scope = character` and default to character when
 * the key is absent, another's carry no `scope` at all and name their root
 * through `type = <x>_event`. Assuming the first spelling for both put every
 * event of the second game in a character scope, which pushed every correct
 * country effect and trigger into the "other scope" tier at the bottom of the
 * completion list (measured median rank 3963 → 111 once fixed).
 */
describe("per-definition root scope (profile.defRootKeys)", () => {
  const defaultProfileBefore = activeProfile();
  afterEach(() => setActiveProfile(defaultProfileBefore));

  function rootAt(gameId: string, kind: string, text: string): string[] | null {
    setActiveProfile(resolveProfile(gameId));
    const parse = parseScript(text);
    const entry = resolveProfile(gameId).schema.find((e) => e.kind === kind)!;
    const fallback = entry.rootScopes?.length ? new Set(entry.rootScopes) : null;
    const scopes = rootScopesAt(parse, text.indexOf("|"), fallback, { entry });
    return scopes ? [...scopes].sort() : null;
  }

  it("maps a declared value through the profile's vocabulary", () => {
    const text = "e.1 = {\n\ttype = country_event\n\timmediate = {\n\t\t|\n\t}\n}";
    expect(rootAt("vic3", "event", text)).toEqual(["country"]);
    expect(rootAt("vic3", "event", text.replace("country_event", "state_event"))).toEqual(["state"]);
  });

  it("falls back to the profile's default when the key is absent", () => {
    const text = "e.1 = {\n\timmediate = {\n\t\t|\n\t}\n}";
    expect(rootAt("ck3", "event", text)).toEqual(["character"]);
    expect(rootAt("vic3", "event", text)).toEqual(["country"]);
  });

  it("takes the declared value verbatim where the game spells it as the scope", () => {
    const text = "my_gui = {\n\tscope = country\n\teffect = {\n\t\t|\n\t}\n}";
    expect(rootAt("vic3", "scripted_gui", text)).toEqual(["country"]);
  });
});
