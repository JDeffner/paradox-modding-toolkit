/**
 * Completion v3 regression suite: key position offers verbs only, value/prefix
 * positions offer nouns, server-side filter+cap matches the client's matcher,
 * cross-kind name collisions stay visible (the vanilla `brave` bug), and the
 * match predicate stays in lockstep with VS Code's fuzzyScore (test/vscodeFuzzy).
 */
import { afterEach, describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionFeature, matchesTypedWord, MAX_ITEMS } from "../src/features/completion";
import { ServerData } from "../src/serverData";
import { loadSchema } from "../src/schema/loader";
import type { ParadoxInitOptions } from "@px-lsp/protocol/protocol";
import type { Definition, TokenData } from "@px-lsp/protocol/types";
import { resolveClientCapabilities, setClientCapabilities } from "../src/clientMode";
import { fuzzyScore, FuzzyScoreOptionsDefault } from "./vscodeFuzzy";

/** Install the capabilities a client declaring `init` would get. */
const asClient = (init: Partial<ParadoxInitOptions>): void =>
  setClientCapabilities(resolveClientCapabilities(init));

// The module default is all-on (the pure-render default); restore it so the
// suites that do not care about capabilities keep seeing the rich output.
afterEach(() => asClient({ clientCommands: true }));

let uriCounter = 0;
const uri = () => `file:///mod/events/v3-${uriCounter++}.txt`;

function tok(name: string, kind: TokenData["kind"], scopes: string[] = []): TokenData {
  return { name, kind, doc: `doc for ${name}`, scopes };
}

function def(name: string, kind: string, extra: Partial<Definition> = {}): Definition {
  return { name, kind, file: `F:/mod/common/${kind}/x.txt`, line: 1, source: "mod", ...extra };
}

function makeEnv() {
  const schema = loadSchema(null);
  const data = new ServerData();
  data.setTokens([
    tok("has_trait", "trigger", ["character"]),
    tok("exists", "trigger"),
    tok("age", "trigger", ["character"]),
    tok("add_gold", "effect", ["character"]),
    tok("save_scope_as", "effect"),
    tok("add_trait", "effect", ["character"]),
    tok("mother", "event_target", ["character"]),
    // Deliberate duplicate name across kinds (like vanilla `death`):
    tok("dynasty", "event_target", ["character"]),
    tok("dynasty", "trigger", ["character"]),
    tok("monthly_income", "modifier"),
  ]);
  data.index.addAll([
    def("my_effect", "scripted_effect"),
    def("my_trigger", "scripted_trigger"),
    def("my_value", "script_value"),
    def("tradition_base_cost", "script_value", { source: "vanilla" }),
    def("mymod.0001", "event"),
    def("my_on_action", "on_action"),
    def("czech", "culture", { source: "vanilla" }),
    // The `brave` collision: a vanilla loc key AND a vanilla trait share the name.
    def("brave", "loc_key", { source: "vanilla", value: "Brave" }),
    def("brave", "trait", { source: "vanilla" }),
    def("my_loc_key", "loc_key"),
  ]);
  const completion = new CompletionFeature(data, () => schema);
  return { data, schema, completion };
}

function provideAt(env: ReturnType<typeof makeEnv>, text: string, marker = "|", limit?: number) {
  const cursor = text.indexOf(marker);
  const clean = text.slice(0, cursor) + text.slice(cursor + marker.length);
  const doc = TextDocument.create(uri(), "paradox", 1, clean);
  return env.completion.provide(doc, cursor, new Set(["character"]), null, limit ?? MAX_ITEMS);
}

describe("completion v3 — key position offers verbs only", () => {
  it("trigger block: triggers + scripted triggers, no effects/nouns", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "e.1 = {\n\ttrigger = {\n\t\t|\n\t}\n}");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("has_trait");
    expect(labels).toContain("my_trigger");
    expect(labels).not.toContain("add_gold");
    expect(labels).not.toContain("my_effect");
    expect(labels).not.toContain("my_value"); // script values are not trigger keys
    expect(labels).not.toContain("mymod.0001");
    expect(labels).not.toContain("my_loc_key");
  });

  it("effect block: effects + scripted effects, no triggers/nouns", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "e.1 = {\n\timmediate = {\n\t\t|\n\t}\n}");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("add_gold");
    expect(labels).toContain("my_effect");
    expect(labels).not.toContain("has_trait");
    expect(labels).not.toContain("my_trigger");
    expect(labels).not.toContain("my_value");
    expect(labels).not.toContain("mymod.0001"); // events complete at trigger_event = |
  });

  it("duplicate token names merge into one item", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "e.1 = {\n\ttrigger = {\n\t\t|\n\t}\n}");
    const dynasty = items.filter((i) => i.label === "dynasty");
    expect(dynasty).toHaveLength(1);
  });
});

describe("completion v3 — value positions offer nouns", () => {
  it("has_trait = | offers the trait even when a loc_key shares its name", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "e.1 = {\n\ttrigger = {\n\t\thas_trait = |\n\t}\n}");
    const brave = items.find((i) => i.label === "brave");
    expect(brave).toBeDefined();
    expect(brave!.detail).toContain("trait");
  });

  it("unknown key value falls back to yes/no + event targets + script values, not the key soup", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "e.1 = {\n\timmediate = {\n\t\tadd_gold = |\n\t}\n}");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("yes");
    expect(labels).toContain("mother");
    expect(labels).toContain("my_value");
    expect(labels).not.toContain("add_trait"); // effects are not values
    // The duplicate event target appears once.
    expect(items.filter((i) => i.label === "dynasty")).toHaveLength(1);
  });

  it("trigger_event = { id = | } completes event ids", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "e.1 = {\n\timmediate = {\n\t\ttrigger_event = { id = | }\n\t}\n}");
    expect(items.map((i) => i.label)).toContain("mymod.0001");
  });

  it("on_actions = { | } completes on_action names (list-form ref)", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "on_birth = {\n\ton_actions = {\n\t\t|\n\t}\n}");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("my_on_action");
    expect(labels).not.toContain("add_gold");
  });

  it("culture:| completes culture names via prefixRefs", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "e.1 = {\n\ttrigger = {\n\t\tculture = culture:|\n\t}\n}");
    expect(items.map((i) => i.label)).toContain("czech");
  });

  it("flag:| offers nothing (freeform prefix) instead of the key soup", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "e.1 = {\n\timmediate = {\n\t\tadd_character_flag = flag:|\n\t}\n}");
    expect(items).toHaveLength(0);
  });
});

describe("completion v3 — value blocks (ai_chance, ai_will_do, weight)", () => {
  it("ai_chance block offers math keys first, not effects", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "e.1 = {\n\toption = {\n\t\tai_chance = {\n\t\t\t|\n\t\t}\n\t}\n}");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("add");
    expect(labels).toContain("factor");
    expect(labels).toContain("modifier");
    expect(labels).not.toContain("add_gold");
    expect(labels).not.toContain("save_scope_as");
    // Math keys are the top tier.
    const sorted = [...items].sort((a, b) => ((a.sortText ?? a.label) < (b.sortText ?? b.label) ? -1 : 1));
    expect(sorted[0].label).toBe("value");
  });

  it("modifier inside ai_chance switches back to trigger grammar", () => {
    const env = makeEnv();
    const { items } = provideAt(
      env,
      "e.1 = {\n\toption = {\n\t\tai_chance = {\n\t\t\tmodifier = {\n\t\t\t\t|\n\t\t\t}\n\t\t}\n\t}\n}"
    );
    const labels = items.map((i) => i.label);
    expect(labels).toContain("has_trait");
    expect(labels).not.toContain("add_gold");
  });

  it("a script_value definition body is a value block", () => {
    const env = makeEnv();
    const schemaEntry = env.schema.entries.find((e) => e.kind === "script_value") ?? null;
    const text = "my_sv = {\n\t|\n}";
    const cursor = text.indexOf("|");
    const clean = text.replace("|", "");
    const doc = TextDocument.create("file:///mod/common/script_values/v3-sv.txt", "paradox", 1, clean);
    const { items } = env.completion.provide(doc, cursor, null, schemaEntry);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("value");
    expect(labels).toContain("modifier");
    expect(labels).not.toContain("add_gold");
  });
});

describe("completion v3 — server-side filter, cap and isIncomplete", () => {
  it("typed word filters like the client and marks the list incomplete", () => {
    const env = makeEnv();
    const { items, isIncomplete } = provideAt(env, "e.1 = {\n\ttrigger = {\n\t\thas|\n\t}\n}");
    expect(isIncomplete).toBe(true);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("has_trait");
    expect(labels).not.toContain("exists");
  });

  it("caps at the limit and reports incomplete", () => {
    const env = makeEnv();
    const { items, isIncomplete } = provideAt(env, "e.1 = {\n\ttrigger = {\n\t\t|\n\t}\n}", "|", 2);
    expect(items).toHaveLength(2);
    expect(isIncomplete).toBe(true);
  });

  it("small complete lists (empty word, under cap) are marked complete", () => {
    const env = makeEnv();
    const { isIncomplete } = provideAt(env, "e.1 = {\n\ttrigger = {\n\t\t|\n\t}\n}");
    expect(isIncomplete).toBe(false);
  });

  it("documentation resolves lazily", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "e.1 = {\n\ttrigger = {\n\t\t|\n\t}\n}");
    const item = items.find((i) => i.label === "has_trait")!;
    expect(item.documentation).toBeUndefined();
    const resolved = env.completion.resolve(item);
    expect(resolved.documentation).toContain("doc for has_trait");
  });
});

describe("matchesTypedWord stays in lockstep with VS Code's fuzzyScore", () => {
  const labels = [
    "add_trait",
    "add_prestige",
    "has_trait",
    "has_title",
    "save_scope_as",
    "tradition_base_cost",
    "trigger_event",
    "traveler_danger_xp_effect",
    "natural_disaster.0110",
    "set_variable",
    "age",
    "is_ai",
    "ai_chance",
    "on_accept",
    "GetHerHis",
    "x",
  ];
  const words = ["tra", "ad", "add_", "has_t", "sav", "xyz", "a", "aic", "ghh", "natural.0", "t"];

  it("accepts exactly the labels fuzzyScore accepts (default suggest options)", () => {
    for (const word of words) {
      const wordLow = word.toLowerCase();
      for (const label of labels) {
        const vs = fuzzyScore(word, wordLow, 0, label, label.toLowerCase(), 0, FuzzyScoreOptionsDefault);
        const ours = matchesTypedWord(wordLow, label);
        expect(ours, `word="${word}" label="${label}"`).toBe(vs !== undefined);
      }
    }
  });
});

describe("completion — scripted param snippets", () => {
  it("a scripted effect with $PARAM$s completes as a ready-to-fill block", () => {
    const env = makeEnv();
    env.data.index.addAll([def("my_param_effect", "scripted_effect", { params: ["TARGET", "AMOUNT"] })]);
    env.data.notifyIndexChanged();
    const { items } = provideAt(env, "e.1 = {\n\timmediate = {\n\t\tmy_param|\n\t}\n}");
    const item = items.find((i) => i.label === "my_param_effect")!;
    expect(item.insertText).toBe("my_param_effect = {\n\tTARGET = ${1:TARGET}\n\tAMOUNT = ${2:AMOUNT}\n}");
    expect(item.insertTextFormat).toBe(2); // InsertTextFormat.Snippet
    expect(item.detail).toContain("params: TARGET, AMOUNT");
  });

  it("a paramless scripted effect completes as a yes|no choice", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "e.1 = {\n\timmediate = {\n\t\tmy_eff|\n\t}\n}");
    const item = items.find((i) => i.label === "my_effect")!;
    expect(item.insertText).toBe("my_effect = ${1|yes,no|}");
    expect(item.insertTextFormat).toBe(2);
  });

  it("a paramless scripted trigger gets the same yes|no choice", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "e.1 = {\n\ttrigger = {\n\t\tmy_tr|\n\t}\n}");
    const item = items.find((i) => i.label === "my_trigger")!;
    expect(item.insertText).toBe("my_trigger = ${1|yes,no|}");
  });

  it("no snippet when the line already continues with = after the cursor", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "e.1 = {\n\timmediate = {\n\t\tmy_eff| = yes\n\t}\n}");
    const item = items.find((i) => i.label === "my_effect")!;
    expect(item.insertText).toBeUndefined();
    expect(item.insertTextFormat).toBeUndefined();
  });

  it("an engine token without a usable usage example stays a bare word", () => {
    const env = makeEnv();
    const { items } = provideAt(env, "e.1 = {\n\timmediate = {\n\t\tadd_g|\n\t}\n}");
    const item = items.find((i) => i.label === "add_gold")!;
    expect(item.insertText).toBeUndefined();
  });
});

describe("completion — engine block templates from usage examples", () => {
  /** An effect block env carrying the two shapes the extractor must separate. */
  function templateEnv() {
    const schema = loadSchema(null);
    const data = new ServerData();
    data.setTokens([
      { ...tok("if", "effect"), usage: "if = { limit = { <triggers> } <effects> }" },
      // Pseudo-key weights: the extractor must refuse to guess a template.
      { ...tok("random_list", "effect"), usage: "random_list = { X1 = { effect1 } X2 = { effect2 } ... }" },
      tok("add_gold", "effect", ["character"]),
    ]);
    return { data, schema, completion: new CompletionFeature(data, () => schema) };
  }

  it("a token whose example qualifies completes as that block", () => {
    const env = templateEnv();
    const { items } = provideAt(env, "e.1 = {\n\timmediate = {\n\t\ti|\n\t}\n}");
    const item = items.find((i) => i.label === "if")!;
    expect(item.insertText).toBe("if = {\n\tlimit = {\n\t\t${1:triggers}\n\t}\n\t${2:effects}\n}");
    expect(item.insertTextFormat).toBe(2);
  });

  it("a token whose example does not qualify stays a bare word", () => {
    const env = templateEnv();
    const { items } = provideAt(env, "e.1 = {\n\timmediate = {\n\t\trandom_l|\n\t}\n}");
    const item = items.find((i) => i.label === "random_list")!;
    expect(item.insertText).toBeUndefined();
  });
});

describe("completion — a client that did not declare snippetSupport", () => {
  /** Every insert form the provider can emit, in one event body. */
  function allItems() {
    const env = makeEnv();
    env.data.index.addAll([def("my_param_effect", "scripted_effect", { params: ["TARGET"] })]);
    env.data.notifyIndexChanged();
    const entry = env.schema.entries.find((e) => e.kind === "event") ?? null;
    const text = "namespace = v3\n\nv3.1 = {\n\t\n}";
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    return env.completion.provide(doc, text.indexOf("\n\t\n") + 2, new Set(["character"]), entry).items;
  }

  it("never emits `${` and never claims InsertTextFormat.Snippet", () => {
    asClient({ client: {} });
    const items = allItems();
    expect(items.length).toBeGreaterThan(10);
    for (const item of items) {
      expect(item.insertTextFormat, item.label).toBeUndefined();
      expect(item.insertText ?? "", item.label).not.toContain("${");
    }
  });

  it("still gets a usable skeleton: block keys, param blocks and the yes form", () => {
    asClient({ client: {} });
    const items = allItems();
    expect(items.find((i) => i.label === "immediate")!.insertText).toBe("immediate = {\n\t\n}");
    expect(items.find((i) => i.label === "my_param_effect")!.insertText).toBe(
      "my_param_effect = {\n\tTARGET = TARGET\n}"
    );
    expect(items.find((i) => i.label === "my_effect")!.insertText).toBe("my_effect = yes");
  });

  it("a snippet-capable client keeps the tabstop forms", () => {
    asClient({ clientCommands: true });
    const items = allItems();
    expect(items.find((i) => i.label === "immediate")!.insertText).toBe("immediate = {\n\t$0\n}");
    expect(items.find((i) => i.label === "immediate")!.insertTextFormat).toBe(2);
  });
});

describe("define: prefix completion", () => {
  function envWithDefines() {
    const env = makeEnv();
    env.data.defines.harvestText(
      `NGame = {\n\tEND_DATE = "1453.1.1"\n}\nNCharacter = {\n\tMAX_STRESS_LEVEL = 3\n\tMALE_ADULT_AGE = 16\n}`,
      "F:/game/common/defines/00_defines.txt",
      "game"
    );
    return env;
  }

  it("define: offers namespaces", () => {
    const env = envWithDefines();
    // `‸` avoids clashing with the literal `|` in the define syntax.
    const { items } = provideAt(env, "e.1 = {\n\timmediate = {\n\t\tadd = define:‸\n\t}\n}", "‸");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("NGame");
    expect(labels).toContain("NCharacter");
  });

  it("define:NCharacter| offers that namespace's constants with values", () => {
    const env = envWithDefines();
    const { items } = provideAt(env, "e.1 = {\n\timmediate = {\n\t\tadd = define:NCharacter|‸\n\t}\n}", "‸");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("MAX_STRESS_LEVEL");
    expect(labels).toContain("MALE_ADULT_AGE");
    expect(labels).not.toContain("END_DATE"); // belongs to NGame
    expect(items.find((i) => i.label === "MAX_STRESS_LEVEL")!.detail).toBe("= 3");
  });
});
