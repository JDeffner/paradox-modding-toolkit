/**
 * 2026-07 scope/variable audit fixes: dot-chains through scope:/var: prefixes,
 * iterator false-friends (random_list), prev-as-pop, math-key transparency,
 * data links with arguments, per-definition root scopes (event `scope = X`,
 * on_action expected scopes, `@scope` tags, structure key scopes), variable
 * namespaces (var/local_var/global_var + lists), save_scope_value_as, variable
 * value types, scripted-list iterators.
 */
import { describe, expect, it } from "vitest";
import { parseScript } from "../src/parser";
import { ScopeModel } from "../src/scopes/model";
import {
  collectSavedScopeTypes,
  inferScopeAt,
  resolveKeyChainScopes,
  type InferenceContext,
} from "../src/scopes/inference";
import { buildCallSiteScopes, buildVariableTypes, resolveValueExpr } from "../src/scopes/varTypes";
import { extractReferences } from "../src/index/references";
import { loadSchema } from "../src/schema/loader";
import type { SchemaEntry } from "../src/schema/types";
import type { Definition, TokenData } from "@px-lsp/protocol/types";

const TOKENS: TokenData[] = [
  { name: "liege", kind: "event_target", doc: "", scopes: ["input: character", "output: character"] },
  {
    name: "primary_title",
    kind: "event_target",
    doc: "",
    scopes: ["input: character", "output: landed_title"],
  },
  { name: "holder", kind: "event_target", doc: "", scopes: ["input: landed_title", "output: character"] },
  { name: "culture", kind: "event_target", doc: "", scopes: ["input: character", "output: culture"] },
  { name: "title", kind: "event_target", doc: "", scopes: ["output: landed_title"] },
  { name: "value", kind: "event_target", doc: "", scopes: ["output: value"] },
  {
    name: "every_held_title",
    kind: "effect",
    doc: "",
    scopes: ["character"],
    traits: "Supported Targets: landed_title",
  },
  { name: "random_list", kind: "effect", doc: "", scopes: ["none"] },
];

const model = new ScopeModel(TOKENS);
const CHARACTER = new Set(["character"]);

function scopesAt(
  snippet: string,
  rootScopes: Set<string> | null = CHARACTER,
  ctx?: InferenceContext
): string[] | null {
  const offset = snippet.indexOf("|");
  if (offset < 0) throw new Error("snippet needs a | marker");
  const text = snippet.replace("|", "");
  const parse = parseScript(text);
  const saved = collectSavedScopeTypes(parse, model, rootScopes, ctx?.entry?.ambientScopes, ctx);
  const result = inferScopeAt(parse, offset, model, rootScopes, saved, ctx);
  return result.scopes ? [...result.scopes].sort() : null;
}

describe("inference: dot-chains through prefixes", () => {
  it("scope:x.link folds the saved scope THEN the link", () => {
    const text =
      "e = {\n\tevery_held_title = { save_scope_as = the_title }\n\tscope:the_title.holder = {\n\t\t|\n\t}\n}";
    expect(scopesAt(text)).toEqual(["character"]);
  });

  it("scope:x.link.link chains fully", () => {
    const text =
      "e = {\n\tliege = { save_scope_as = big }\n\tscope:big.primary_title.holder = {\n\t\t|\n\t}\n}";
    expect(scopesAt(text)).toEqual(["character"]);
  });
});

describe("inference: iterator false-friends and math keys", () => {
  it("random_list keeps the scope (weighted wrapper, not a list iterator)", () => {
    expect(scopesAt("e = {\n\trandom_list = {\n\t\t10 = {\n\t\t\t|\n\t\t}\n\t}\n}")).toEqual(["character"]);
  });

  it("random_valid keeps the scope", () => {
    expect(scopesAt("e = {\n\trandom_valid = {\n\t\t|\n\t}\n}")).toEqual(["character"]);
  });

  it("in-list iterators are unknown (item type unknowable)", () => {
    expect(scopesAt("e = {\n\tevery_in_list = {\n\t\t|\n\t}\n}")).toBeNull();
  });

  it("`value` as a block key is math, not the value link", () => {
    expect(scopesAt("e = {\n\tsome_value = {\n\t\tvalue = {\n\t\t\t|\n\t\t}\n\t}\n}")).toEqual(["character"]);
  });
});

describe("inference: prev pops the scope stack", () => {
  it("prev.prev walks two levels back", () => {
    const text =
      "e = {\n\tprimary_title = {\n\t\tholder = {\n\t\t\tprev.prev = {\n\t\t\t\t|\n\t\t\t}\n\t\t}\n\t}\n}";
    expect(scopesAt(text)).toEqual(["character"]);
  });
});

describe("inference: data links with arguments", () => {
  it("culture:czech produces culture scope", () => {
    expect(scopesAt("e = {\n\tculture:czech = {\n\t\t|\n\t}\n}")).toEqual(["culture"]);
  });

  it("title:k_france.holder chains to character", () => {
    expect(scopesAt("e = {\n\ttitle:k_france.holder = {\n\t\t|\n\t}\n}")).toEqual(["character"]);
  });
});

describe("inference: per-definition root scopes", () => {
  it("event `scope = X` overrides the character default", () => {
    const entry = { path: "events", kind: "event" } as SchemaEntry;
    const text = "my.1 = {\n\tscope = artifact\n\timmediate = {\n\t\t|\n\t}\n}";
    expect(scopesAt(text, CHARACTER, { entry })).toEqual(["artifact"]);
  });

  it("events without scope= keep the character default", () => {
    const entry = { path: "events", kind: "event" } as SchemaEntry;
    expect(scopesAt("my.1 = {\n\timmediate = {\n\t\t|\n\t}\n}", CHARACTER, { entry })).toEqual(["character"]);
  });

  it("on_action roots come from on_actions.log expected scopes", () => {
    const entry = { path: "common/on_action", kind: "on_action" } as SchemaEntry;
    const ctx: InferenceContext = { entry, onActionScopes: new Map([["on_my_death", "character"]]) };
    expect(scopesAt("on_my_death = {\n\teffect = {\n\t\t|\n\t}\n}", null, ctx)).toEqual(["character"]);
  });

  it("scripted_effect roots come from the @scope doc tag", () => {
    const entry = { path: "common/scripted_effects", kind: "scripted_effect" } as SchemaEntry;
    const ctx: InferenceContext = {
      entry,
      defScopeTag: (name) => (name === "my_effect" ? new Set(["province"]) : null),
    };
    expect(scopesAt("my_effect = {\n\t|\n}", null, ctx)).toEqual(["province"]);
  });

  it("structure keys with a documented scope set the block root", () => {
    const entry = {
      path: "common/activities/activity_types",
      kind: "activity_type",
      rootScopes: ["character"],
      structure: { topLevel: [{ key: "is_valid", scope: "activity" }] },
    } as SchemaEntry;
    expect(scopesAt("act = {\n\tis_valid = {\n\t\t|\n\t}\n}", CHARACTER, { entry })).toEqual(["activity"]);
  });
});

describe("inference: variable value types", () => {
  it("var:x resolves through ctx.varTypes", () => {
    const ctx: InferenceContext = { varTypes: new Map([["var:her", new Set(["character"])]]) };
    expect(scopesAt("e = {\n\tvar:her = {\n\t\t|\n\t}\n}", CHARACTER, ctx)).toEqual(["character"]);
  });

  it("var:x.link chains from the variable's type", () => {
    const ctx: InferenceContext = { varTypes: new Map([["var:her", new Set(["character"])]]) };
    expect(scopesAt("e = {\n\tvar:her.primary_title = {\n\t\t|\n\t}\n}", CHARACTER, ctx)).toEqual([
      "landed_title",
    ]);
  });

  it("untyped var:x stays unknown", () => {
    expect(scopesAt("e = {\n\tvar:mystery = {\n\t\t|\n\t}\n}")).toBeNull();
  });
});

describe("collectSavedScopeTypes: save_scope_value_as", () => {
  it("types value/boolean/flag saves", () => {
    const text = [
      "e = {",
      "\tsave_scope_value_as = { name = my_num value = 5 }",
      "\tsave_scope_value_as = { name = my_bool value = yes }",
      "\tsave_scope_value_as = { name = my_flag value = flag:hello }",
      "}",
    ].join("\n");
    const saved = collectSavedScopeTypes(parseScript(text), model, CHARACTER);
    expect(saved.get("my_num")).toEqual(new Set(["value"]));
    expect(saved.get("my_bool")).toEqual(new Set(["boolean"]));
    expect(saved.get("my_flag")).toEqual(new Set(["flag"]));
  });

  it("saves inside scope:ambient blocks resolve through the ambient seed", () => {
    const text = "e = {\n\tscope:actor = {\n\t\tliege = { save_scope_as = boss }\n\t}\n}";
    const ambient = [{ name: "actor", type: "character" }];
    const saved = collectSavedScopeTypes(parseScript(text), model, null, ambient);
    expect(saved.get("boss")).toEqual(new Set(["character"]));
  });
});

describe("scripted-list iterators", () => {
  it("resolves every_<list> through the list's base, transitively", () => {
    const m = new ScopeModel(TOKENS);
    m.setScriptedLists([
      { name: "held_county", base: "held_title" },
      { name: "coastal_held_county", base: "held_county" },
    ]);
    expect(m.outputOf("every_held_county")).toEqual(new Set(["landed_title"]));
    expect(m.outputOf("random_coastal_held_county")).toEqual(new Set(["landed_title"]));
  });

  it("re-applying replaces the previous scripted-list set", () => {
    const m = new ScopeModel(TOKENS);
    m.setScriptedLists([{ name: "held_county", base: "held_title" }]);
    m.setScriptedLists([]);
    expect(m.outputOf("every_held_county")).toBeNull();
  });
});

describe("variable value-type resolution (varTypes)", () => {
  const noRoot = () => null;
  const charRoot = () => new Set(["character"]);

  it("resolves literals, flags and global link chains", () => {
    expect(resolveValueExpr("5", "f.txt", model, noRoot)).toEqual(new Set(["value"]));
    expect(resolveValueExpr("yes", "f.txt", model, noRoot)).toEqual(new Set(["boolean"]));
    expect(resolveValueExpr("flag:hi", "f.txt", model, noRoot)).toEqual(new Set(["flag"]));
    expect(resolveValueExpr("title:k_france.holder", "f.txt", model, noRoot)).toEqual(new Set(["character"]));
  });

  it("resolves root-anchored chains through the set-file's root scope", () => {
    expect(resolveValueExpr("root.primary_title", "f.txt", model, charRoot)).toEqual(
      new Set(["landed_title"])
    );
  });

  it("runtime anchors stay unknown", () => {
    expect(resolveValueExpr("scope:someone", "f.txt", model, noRoot)).toBeNull();
    expect(resolveValueExpr("this", "f.txt", model, noRoot)).toBeNull();
  });

  it("merges set-sites per namespace and keys lists separately", () => {
    const defs: Definition[] = [
      { name: "who", kind: "variable", file: "a.txt", line: 0, source: "mod", value: "title:k_x.holder" },
      { name: "who", kind: "variable", file: "b.txt", line: 0, source: "mod", value: "title:k_y" },
      { name: "who", kind: "local_variable", file: "c.txt", line: 0, source: "mod", value: "5" },
      {
        name: "crew",
        kind: "variable_list",
        file: "d.txt",
        line: 0,
        source: "mod",
        value: "title:k_x.holder",
      },
    ];
    const info = buildVariableTypes(defs, model, noRoot);
    expect(info.types.get("var:who")).toEqual(new Set(["character", "landed_title"]));
    expect(info.types.get("local_var:who")).toEqual(new Set(["value"]));
    expect(info.listItemTypes.get("var:crew")).toEqual(new Set(["character"]));
  });
});

describe("reference extraction: variable namespaces", () => {
  const schema = loadSchema(process.cwd());

  function extract(text: string) {
    return extractReferences(text, "f:/mod/common/scripted_effects/x.txt", "mod", schema);
  }

  it("splits set-sites by storage class and captures the value expression", () => {
    const { implicitDefs } = extract(
      [
        "eff = {",
        "\tset_variable = { name = a value = liege }",
        "\tset_local_variable = { name = b value = 5 }",
        "\tset_global_variable = { name = c value = yes }",
        "}",
      ].join("\n")
    );
    const byName = new Map(implicitDefs.map((d) => [d.name, d]));
    expect(byName.get("a")?.kind).toBe("variable");
    expect(byName.get("a")?.value).toBe("liege");
    expect(byName.get("b")?.kind).toBe("local_variable");
    expect(byName.get("c")?.kind).toBe("global_variable");
  });

  it("dual-indexes variable lists (list kind carries the item expr)", () => {
    const { implicitDefs } = extract("eff = {\n\tadd_to_variable_list = { name = crew target = liege }\n}");
    const kinds = implicitDefs.filter((d) => d.name === "crew").map((d) => d.kind);
    expect(kinds.sort()).toEqual(["variable", "variable_list"]);
    const listDef = implicitDefs.find((d) => d.kind === "variable_list");
    expect(listDef?.value).toBe("liege");
    const baseDef = implicitDefs.find((d) => d.kind === "variable");
    expect(baseDef?.value).toBeUndefined();
  });

  it("indexes save_scope_value_as as a saved_scope definition with an expr hint", () => {
    const { implicitDefs } = extract("eff = {\n\tsave_scope_value_as = { name = wealth value = 42 }\n}");
    const def = implicitDefs.find((d) => d.name === "wealth");
    expect(def?.kind).toBe("saved_scope");
    expect(def?.value).toBe("expr:42");
  });

  it("save_scope_as sites carry their enclosing key chain as a hint", () => {
    const { implicitDefs } = extract("eff = {\n\tliege = {\n\t\tsave_scope_as = boss\n\t}\n}");
    expect(implicitDefs.find((d) => d.name === "boss")?.value).toBe("chain:liege");
  });

  it("variable reads reference the right namespaces", () => {
    const { references } = extract(
      [
        "eff = {",
        "\thas_variable = a",
        "\thas_local_variable = b",
        "\tis_target_in_variable_list = { name = crew target = root }",
        "\tevery_in_list = {",
        "\t\tvariable = crew",
        "\t}",
        "}",
      ].join("\n")
    );
    const byName = new Map(references.map((r) => [r.name, r.kinds]));
    expect(byName.get("a")).toEqual(["variable", "variable_list"]);
    expect(byName.get("b")).toEqual(["local_variable", "local_variable_list"]);
    expect(byName.get("crew")).toEqual(["variable_list"]);
  });

  it("var prefixes reference their own storage class", () => {
    const { references } = extract("eff = {\n\ttrigger = { var:a > local_var:b }\n}");
    const byName = new Map(references.map((r) => [r.name, r.kinds]));
    expect(byName.get("a")).toEqual(["variable", "variable_list"]);
    expect(byName.get("b")).toEqual(["local_variable", "local_variable_list"]);
  });

  it("indexes save_temporary_value_as as a saved_scope definition typed value", () => {
    const { implicitDefs } = extract("val = {\n\tvalue = 5\n\tsave_temporary_value_as = diff\n}");
    const def = implicitDefs.find((d) => d.name === "diff");
    expect(def?.kind).toBe("saved_scope");
    expect(def?.value).toBe("type:value");
  });
});

describe("cross-file saved-scope types", () => {
  const charRoot = () => new Set(["character"]);

  it("buildVariableTypes resolves the three save-form hints", () => {
    const defs: Definition[] = [
      { name: "boss", kind: "saved_scope", file: "a.txt", line: 0, source: "mod", value: "chain:liege" },
      { name: "wealth", kind: "saved_scope", file: "a.txt", line: 1, source: "mod", value: "expr:42" },
      { name: "diff", kind: "saved_scope", file: "b.txt", line: 0, source: "mod", value: "type:value" },
    ];
    const info = buildVariableTypes(defs, model, charRoot);
    expect(info.savedScopeTypes.get("boss")).toEqual(new Set(["character"]));
    expect(info.savedScopeTypes.get("wealth")).toEqual(new Set(["value"]));
    expect(info.savedScopeTypes.get("diff")).toEqual(new Set(["value"]));
  });

  it("conflicting or unhinted save sites poison to unknown", () => {
    const defs: Definition[] = [
      { name: "x", kind: "saved_scope", file: "a.txt", line: 0, source: "mod", value: "chain:liege" },
      { name: "x", kind: "saved_scope", file: "b.txt", line: 0, source: "mod" },
    ];
    expect(buildVariableTypes(defs, model, charRoot).savedScopeTypes.get("x")).toBeNull();
  });

  it("scope:x saved in another file resolves through ctx.savedScopeTypes", () => {
    const ctx: InferenceContext = { savedScopeTypes: new Map([["boss", new Set(["character"])]]) };
    expect(scopesAt("e = {\n\tscope:boss = {\n\t\t|\n\t}\n}", CHARACTER, ctx)).toEqual(["character"]);
    // Chains keep working through the fallback type.
    expect(scopesAt("e = {\n\tscope:boss.primary_title = {\n\t\t|\n\t}\n}", CHARACTER, ctx)).toEqual([
      "landed_title",
    ]);
  });

  it("local save sites still win over the mod-wide fallback", () => {
    const ctx: InferenceContext = { savedScopeTypes: new Map([["boss", new Set(["culture"])]]) };
    const text = "e = {\n\tliege = { save_scope_as = boss }\n\tscope:boss = {\n\t\t|\n\t}\n}";
    expect(scopesAt(text, CHARACTER, ctx)).toEqual(["character"]);
  });
});

describe("call-site scope aggregation (scripted effects without @scope)", () => {
  const charRoot = () => new Set(["character"]);
  const callRef = (name: string, chain: string, file = "events/x.txt") => ({
    name,
    kinds: ["scripted_effect"],
    file,
    line: 0,
    startChar: 0,
    endChar: name.length,
    call: true as const,
    chain,
  });

  it("unions resolved call sites and ignores unresolved ones", () => {
    const refs = [
      callRef("my_eff", "immediate"), // character root, transparent chain
      callRef("my_eff", "immediate.every_held_title"), // landed_title
      callRef("my_eff", "immediate.scope:mystery"), // unresolved: contributes nothing
    ];
    const map = buildCallSiteScopes(refs, model, charRoot);
    expect(map.get("my_eff")).toEqual(new Set(["character", "landed_title"]));
  });

  it("names with no resolvable call site stay absent", () => {
    const map = buildCallSiteScopes([callRef("dark", "immediate.scope:mystery")], model, charRoot);
    expect(map.has("dark")).toBe(false);
  });

  it("an untagged scripted effect roots at its aggregated calling scope", () => {
    const entry = { path: "common/scripted_effects", kind: "scripted_effect" } as SchemaEntry;
    const ctx: InferenceContext = {
      entry,
      callSiteScopes: new Map([["my_effect", new Set(["province"])]]),
    };
    expect(scopesAt("my_effect = {\n\t|\n}", null, ctx)).toEqual(["province"]);
  });

  it("the @scope tag wins over call-site aggregation", () => {
    const entry = { path: "common/scripted_effects", kind: "scripted_effect" } as SchemaEntry;
    const ctx: InferenceContext = {
      entry,
      defScopeTag: (name) => (name === "my_effect" ? new Set(["artifact"]) : null),
      callSiteScopes: new Map([["my_effect", new Set(["province"])]]),
    };
    expect(scopesAt("my_effect = {\n\t|\n}", null, ctx)).toEqual(["artifact"]);
  });

  /**
   * Equivalence guard for the perf-round-2 rewrite of buildCallSiteScopes.
   *
   * That rewrite makes three assumptions, any of which would silently change
   * scope inference (and so completion ranking and hover) rather than fail:
   * that only chained call sites matter, that a (root scopes, chain) pair
   * resolves the same wherever it occurs, and that a SHARED root-scope Set is
   * as good as a fresh one per call. This reimplements the pre-optimization
   * version — walk everything, resolve every site, fresh Set every time — and
   * demands an identical map.
   */
  it("matches a naive full walk, including shared vs fresh root-scope Sets", () => {
    // Per-file root scopes, so several distinct Set identities are in play.
    const rootsOf = (file: string): Set<string> | null => {
      if (file.startsWith("events/")) return new Set(["character"]);
      if (file.startsWith("common/province/")) return new Set(["province"]);
      if (file.startsWith("common/untyped/")) return null; // unknown root
      return new Set(["character", "landed_title"]);
    };
    // The optimized path is handed ONE shared Set per file, as server.ts's
    // memoized rootScopesForFile now does.
    const shared = new Map<string, Set<string> | null>();
    const sharedRoots = (file: string) => {
      if (!shared.has(file)) shared.set(file, rootsOf(file));
      return shared.get(file)!;
    };
    // The naive path gets a fresh Set every single call, as the old code did.
    const freshRoots = (file: string) => {
      const r = rootsOf(file);
      return r ? new Set(r) : null;
    };

    const files = [
      "events/a.txt",
      "events/b.txt",
      "common/province/p.txt",
      "common/untyped/u.txt",
      "common/other/o.txt",
    ];
    const chains = [
      "immediate",
      "immediate.every_held_title",
      "immediate.scope:mystery", // unresolvable: must contribute nothing
      "immediate.liege.culture",
      "", // top-level chain
      "immediate.random_list",
    ];
    // Repeat the same (file, chain) pairs so the memo is actually exercised,
    // and interleave files so the per-file hoist sees the value change back.
    const refs = [];
    for (let round = 0; round < 3; round++) {
      for (const file of files) {
        for (let c = 0; c < chains.length; c++) {
          refs.push(callRef(`eff_${c % 4}`, chains[c], file));
        }
      }
    }
    // TWO names sharing ONE chain, in this order, inside one file. This is the
    // only shape that catches a memoized Set being handed out instead of
    // copied: `poll_a` takes the cached resolution of "immediate", its second
    // call site unions "landed_title" INTO that same object, and `poll_b` then
    // reads the corrupted entry. With each chain used by a single name the
    // corruption is self-consistent and invisible, which is how the first
    // version of this test passed against that bug.
    refs.push(callRef("poll_a", "immediate", "events/a.txt"));
    refs.push(callRef("poll_a", "immediate.every_held_title", "events/a.txt"));
    refs.push(callRef("poll_b", "immediate", "events/a.txt"));
    // Non-call and chain-less references: the optimized path never sees these
    // (ReferenceIndex filters them out), the naive one must skip them itself.
    const noise = refs.slice(0, 5).map((r) => ({ ...r, call: false as const }));
    const chainless = refs.slice(5, 9).map((r) => {
      const { chain: _drop, ...rest } = r;
      return rest as typeof r;
    });

    const naive = new Map<string, Set<string>>();
    for (const ref of [...refs, ...noise, ...chainless]) {
      if (!ref.call || ref.chain === undefined) continue;
      const resolved = resolveKeyChainScopes(ref.chain.split("."), model, freshRoots(ref.file));
      if (!resolved || resolved.size === 0) continue;
      const prev = naive.get(ref.name);
      if (prev) for (const s of resolved) prev.add(s);
      else naive.set(ref.name, new Set(resolved));
    }

    const optimized = buildCallSiteScopes(refs, model, sharedRoots);

    expect(optimized.size).toBe(naive.size);
    expect(optimized.size).toBeGreaterThan(0); // the fixture must actually resolve
    for (const [name, scopes] of naive) {
      expect([...(optimized.get(name) ?? [])].sort(), `scopes of ${name}`).toEqual([...scopes].sort());
    }
  });
});

describe("collectSavedScopeTypes: save_temporary_value_as", () => {
  it("types script-value saves as value scopes", () => {
    const text = [
      "some_value = {",
      "\tvalue = 10",
      "\tsubtract = 4",
      "\tsave_temporary_value_as = diff",
      "\tif = {",
      "\t\tlimit = { scope:diff >= 20 }",
      "\t\tvalue = 5",
      "\t}",
      "}",
    ].join("\n");
    const saved = collectSavedScopeTypes(parseScript(text), model, CHARACTER);
    expect(saved.get("diff")).toEqual(new Set(["value"]));
  });
});

describe("ad-hoc list item types (add_to_list sites)", () => {
  const schema = loadSchema(process.cwd());
  const charRoot = () => new Set(["character"]);

  it("resolveKeyChainScopes walks transparent keys, iterators and links", () => {
    expect(resolveKeyChainScopes(["option", "every_held_title"], model, CHARACTER)).toEqual(
      new Set(["landed_title"])
    );
    expect(resolveKeyChainScopes([""], model, CHARACTER)).toEqual(new Set(["character"]));
    expect(resolveKeyChainScopes(["liege.primary_title"], model, CHARACTER)).toEqual(
      new Set(["landed_title"])
    );
  });

  it("resolveKeyChainScopes treats scope:/var: anchors as unknown", () => {
    expect(resolveKeyChainScopes(["immediate", "scope:target"], model, CHARACTER)).toBeNull();
    expect(resolveKeyChainScopes(["var:someone"], model, CHARACTER)).toBeNull();
  });

  it("extractReferences captures the enclosing key chain at add_to_list sites", () => {
    const { implicitDefs } = extractReferences(
      "my.1 = {\n\toption = {\n\t\tevery_held_title = {\n\t\t\tadd_to_list = titles\n\t\t}\n\t}\n}",
      "f:/mod/events/x.txt",
      "mod",
      schema
    );
    const def = implicitDefs.find((d) => d.name === "titles");
    expect(def?.kind).toBe("list");
    expect(def?.value).toBe("option.every_held_title");
  });

  it("buildVariableTypes resolves ad-hoc list item types from the chain", () => {
    const defs: Definition[] = [
      {
        name: "titles",
        kind: "list",
        file: "f.txt",
        line: 0,
        source: "mod",
        value: "option.every_held_title",
      },
    ];
    const info = buildVariableTypes(defs, model, charRoot);
    expect(info.adhocListItemTypes.get("titles")).toEqual(new Set(["landed_title"]));
  });

  it("conflicting set-sites poison the item type to unknown", () => {
    const defs: Definition[] = [
      { name: "l", kind: "list", file: "f.txt", line: 0, source: "mod", value: "every_held_title" },
      { name: "l", kind: "list", file: "f.txt", line: 4, source: "mod", value: "immediate.scope:x" },
    ];
    const info = buildVariableTypes(defs, model, charRoot);
    expect(info.adhocListItemTypes.get("l")).toBeNull();
  });

  it("every_in_list = { list = x } resolves through ctx.adhocListItemTypes", () => {
    const ctx: InferenceContext = { adhocListItemTypes: new Map([["titles", new Set(["landed_title"])]]) };
    expect(scopesAt("e = {\n\tevery_in_list = {\n\t\tlist = titles\n\t\t|\n\t}\n}", CHARACTER, ctx)).toEqual([
      "landed_title",
    ]);
  });
});
