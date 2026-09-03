/**
 * paradox/definitionForm against the REAL bundled CK3 data: the whole point of
 * the request is that no field list is written for it, so a test with a stub
 * schema would prove nothing. These assertions are the harvest's own numbers
 * (data/ck3/structures.json) and the schema table's own rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { computeDefinitionForm } from "../src/creators/definitionForm";
import { loadSchema, type SchemaData } from "../src/schema/loader";
import { ServerData } from "../src/serverData";

const TRAITS_TXT = `# A mod trait.
px_stoic = {
	category = personality
	opposites = { craven }
	martial = 2
}
`;

// Two pillars of different families in ONE file, the way
// common/culture/pillars keeps them, and two cultures naming them.
const PILLARS_TXT = `ethos_stoic = {
	type = ethos
}

language_arabic = {
	type = language
}
`;

const CULTURES_TXT = `px_bedouin = {
	ethos = ethos_stoic
	language = language_arabic
	clothing_gfx = { mena_clothing_gfx }
	house_coa_mask_scale = { 0.95 0.95 }
	ethnicities = {
		100 = arab
	}
}

px_levantine = {
	ethos = ethos_stoic
	clothing_gfx = { mena_clothing_gfx dde_abbasid_clothing_gfx }
	ethnicities = {
		50 = arab
		50 = mediterranean
	}
}
`;

/**
 * `unrestricted_dynasty_legacies` VERBATIM out of common/game_rules/
 * 00_game_rules.txt (CK3 1.19.0.6). Its three settings ARE its inner blocks,
 * which is the only place a `has_game_rule` value list can come from
 * (_game_rules.info documents `categories` and `default` as the other two
 * keys).
 */
const GAME_RULES_TXT = `unrestricted_dynasty_legacies = {
	categories = { game_modes tweaks }

	default = unrestricted_dynasty_legacies_default

	unrestricted_dynasty_legacies_default = { }
	unrestricted_dynasty_legacies_player_only = { }
	unrestricted_dynasty_legacies_all = { }
}
`;

/**
 * `has_dlc_feature`'s own entry as triggers.log 1.19 writes it, with the
 * `Traits:` label the docs parser keeps in front of the enumeration.
 */
const DLC_FEATURE_TRAITS =
  "Traits: Valid Features: garments_of_the_hre, fashion_of_the_abbasid_court, " +
  "the_northern_lords, and songs_of_the_realm";

let dir: string;
let traitsFile: string;
const data = new ServerData();
const schema: SchemaData = loadSchema(null);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-form-"));
  traitsFile = path.join(dir, "px_traits.txt");
  fs.writeFileSync(traitsFile, TRAITS_TXT, "utf8");
  const pillarsFile = path.join(dir, "px_pillars.txt");
  fs.writeFileSync(pillarsFile, PILLARS_TXT, "utf8");
  const culturesFile = path.join(dir, "px_cultures.txt");
  fs.writeFileSync(culturesFile, CULTURES_TXT, "utf8");
  const rulesFile = path.join(dir, "00_game_rules.txt");
  fs.writeFileSync(rulesFile, GAME_RULES_TXT, "utf8");
  data.setTokens([
    { name: "has_dlc_feature", kind: "trigger", doc: "", scopes: [], traits: DLC_FEATURE_TRAITS },
  ]);
  data.index.addAll([
    { name: "unrestricted_dynasty_legacies", kind: "game_rule", file: rulesFile, line: 0, source: "vanilla" },
    {
      name: "can_start_new_legacy_track_trigger",
      kind: "scripted_trigger",
      file: "vanilla.txt",
      line: 0,
      source: "vanilla",
    },
    // The loc entries the labels come from: `trait_$` for a trait (the schema's
    // own first pattern), `$_name` for a pillar (its entry names none). One
    // trait deliberately has no loc entry at all.
    { name: "trait_px_stoic", kind: "loc_key", file: "loc.yml", line: 1, source: "mod", value: "Stoic" },
    { name: "trait_brave", kind: "loc_key", file: "loc.yml", line: 2, source: "vanilla", value: "Brave" },
    {
      name: "ethos_stoic_name",
      kind: "loc_key",
      file: "loc.yml",
      line: 3,
      source: "mod",
      value: "Stoic Ethos",
    },
    { name: "px_stoic", kind: "trait", file: traitsFile, line: 1, source: "mod" },
    { name: "brave", kind: "trait", file: "vanilla.txt", line: 0, source: "vanilla" },
    { name: "craven", kind: "trait", file: "vanilla.txt", line: 5, source: "vanilla" },
    { name: "ethos_stoic", kind: "culture_pillar", file: pillarsFile, line: 0, source: "mod" },
    { name: "language_arabic", kind: "culture_pillar", file: pillarsFile, line: 4, source: "mod" },
    { name: "px_bedouin", kind: "culture", file: culturesFile, line: 0, source: "mod" },
    { name: "px_levantine", kind: "culture", file: culturesFile, line: 10, source: "mod" },
  ]);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("computeDefinitionForm", () => {
  it("answers the trait form from the schema table and the bundled harvest", () => {
    const form = computeDefinitionForm(data, schema, { kind: "trait" })!;
    expect(form.folder).toBe("common/traits");
    // _traits.info: name key trait_<key>, desc key trait_<key>_desc, default
    // icon gfx/interface/icons/traits/<trait>.dds.
    expect(form.locPatterns).toEqual(["trait_$", "trait_$_desc"]);
    expect(form.iconFolder).toBe("gfx/interface/icons/traits");
    // The harvest's 60 documented trait keys, in its own order (most used first).
    expect(form.keys).toHaveLength(60);
    expect(form.keys.slice(0, 3).map((k) => k.key)).toEqual(["desc", "category", "culture_modifier"]);
    const category = form.keys.find((k) => k.key === "category")!;
    expect(category.doc).toContain("category");
    expect(category.freq).toBeGreaterThan(0);
  });

  it("carries the per-kind ref rows and one option list per kind they name", () => {
    const form = computeDefinitionForm(data, schema, { kind: "trait" })!;
    expect(form.keys.find((k) => k.key === "opposites")?.refKinds).toEqual(["trait"]);
    // Resolved through the index, mod entries first.
    expect(form.options.trait.map((i) => i.value)).toEqual(["px_stoic", "brave", "craven"]);
    expect(form.options.trait[0].hint).toBe("this mod");
  });

  it("lists every definition of the kind for the Open menu, the mod's first", () => {
    const form = computeDefinitionForm(data, schema, { kind: "trait" })!;
    // A creator opens a game trait to duplicate or override it, so vanilla is
    // offered too, behind the mod's own and labelled with where it comes from.
    expect(form.existing.map((d) => [d.name, d.source])).toEqual([
      ["px_stoic", "mod"],
      ["brave", "vanilla"],
      ["craven", "vanilla"],
    ]);
    expect(form.existing[0].file).toBe(traitsFile);
  });

  it("loads a named definition's block verbatim", () => {
    const form = computeDefinitionForm(data, schema, { kind: "trait", name: "px_stoic" })!;
    expect(form.current?.source).toBe("mod");
    expect(form.current?.line).toBe(1);
    expect(form.current?.text).toBe(TRAITS_TXT.split("\n").slice(1, 6).join("\n"));
  });

  it("names an unindexed definition without inventing a block", () => {
    const form = computeDefinitionForm(data, schema, { kind: "trait", name: "no_such_trait" })!;
    expect(form.current).toBeUndefined();
    expect(form.keys.length).toBe(60);
  });

  it("carries the culture ref rows the vanilla files justify", () => {
    const form = computeDefinitionForm(data, schema, { kind: "culture" })!;
    expect(form.folder).toBe("common/culture/cultures");
    expect(form.keys.find((k) => k.key === "traditions")?.refKinds).toEqual(["culture_tradition"]);
    expect(form.keys.find((k) => k.key === "parents")?.refKinds).toEqual(["culture"]);
  });

  it("labels each pillar option with the family its own block declares", () => {
    const form = computeDefinitionForm(data, schema, { kind: "culture" })!;
    // One folder holds all five families; `type = ethos` inside the block is
    // the only thing that tells them apart (schema groupKey on culture_pillar).
    expect(form.keys.find((k) => k.key === "ethos")?.refKinds).toEqual(["culture_pillar"]);
    expect(form.keys.find((k) => k.key === "name_list")?.refKinds).toEqual(["name_list"]);
    expect(form.options.culture_pillar.map((i) => [i.value, i.group])).toEqual([
      ["ethos_stoic", "ethos"],
      ["language_arabic", "language"],
    ]);
  });

  it("samples the values the indexed cultures write for keys no index answers", () => {
    const form = computeDefinitionForm(data, schema, { kind: "culture" })!;
    const key = (k: string): string[] | undefined => form.keys.find((x) => x.key === k)?.sampled;
    // Most used first: both cultures write mena, one adds dde_abbasid.
    expect(key("clothing_gfx")).toEqual(["mena_clothing_gfx", "dde_abbasid_clothing_gfx"]);
    // Weighted entries name the ethnicity, not the weight.
    expect(key("ethnicities")).toEqual(["arab", "mediterranean"]);
    // Numbers are coordinates, not a value set to offer.
    expect(key("house_coa_mask_scale")).toBeUndefined();
    // A key the index already answers keeps its option list and samples nothing.
    expect(key("ethos")).toBeUndefined();
  });

  it("carries the dynasty legacy rows the vanilla files justify", () => {
    // _dynasty_legacies.info states $_name; all 21 vanilla tracks also define
    // $_desc, and window_dynasty_legacy.gui reads the picture off the key.
    const legacy = computeDefinitionForm(data, schema, { kind: "dynasty_legacy" })!;
    expect(legacy.folder).toBe("common/dynasty_legacies");
    expect(legacy.locPatterns).toEqual(["$_name", "$_desc"]);
    expect(legacy.iconFolder).toBe("gfx/interface/icons/dynasty");
    expect(legacy.keys.map((k) => k.key)).toEqual(["is_shown"]);

    // _dynasty_perks.info: seven documented keys, $_name only, no icon folder.
    const perk = computeDefinitionForm(data, schema, { kind: "dynasty_perk" })!;
    expect(perk.folder).toBe("common/dynasty_perks");
    expect(perk.locPatterns).toEqual(["$_name"]);
    expect(perk.iconFolder).toBeUndefined();
    expect(perk.keys.map((k) => k.key)).toEqual([
      "legacy",
      "effect",
      "character_modifier",
      "can_be_picked",
      "ai_chance",
      "doctrine_character_modifier",
      "traits",
    ]);
    // `traits = { trait_name = int }`: the entry keys are trait names.
    expect(perk.keys.find((k) => k.key === "traits")?.refKinds).toEqual(["trait"]);
    expect(perk.options.trait.map((i) => i.value)).toEqual(["px_stoic", "brave", "craven"]);
  });

  it("answers each condition trigger from the source the profile names", () => {
    const form = computeDefinitionForm(data, schema, { kind: "dynasty_legacy" })!;
    const values = (trigger: string): string[] | undefined =>
      form.conditions?.[trigger]?.map((item) => item.value);
    // docList: the whole enumeration, INCLUDING the first entry, which the
    // `Traits:` label in front of `Valid Features:` used to swallow.
    expect(values("has_dlc_feature")).toEqual([
      "garments_of_the_hre",
      "fashion_of_the_abbasid_court",
      "the_northern_lords",
      "songs_of_the_realm",
    ]);
    // innerKeys: a game rule's settings, without `categories` and `default`.
    expect(values("has_game_rule")).toEqual([
      "unrestricted_dynasty_legacies_default",
      "unrestricted_dynasty_legacies_player_only",
      "unrestricted_dynasty_legacies_all",
    ]);
    // kind: the definition index, the same resolver the options use.
    expect(values("scripted_trigger")).toEqual(["can_start_new_legacy_track_trigger"]);
  });

  it("leaves a trigger nothing resolves for out of the table entirely", () => {
    // A trigger with an empty list would draw an empty picker; its ABSENCE is
    // what tells a creator to offer a free input instead.
    const bare = new ServerData();
    const form = computeDefinitionForm(bare, schema, { kind: "dynasty_legacy" })!;
    expect(form.conditions).toBeUndefined();
  });

  it("labels options and existing definitions with the loc the game reads", () => {
    const trait = computeDefinitionForm(data, schema, { kind: "trait" })!;
    // trait_$ is the schema's first loc pattern; craven has no loc entry, so it
    // gets no label rather than a title-cased guess.
    expect(trait.options.trait.map((i) => [i.value, i.label])).toEqual([
      ["px_stoic", "Stoic"],
      ["brave", "Brave"],
      ["craven", undefined],
    ]);
    expect(trait.existing.map((d) => d.label)).toEqual(["Stoic", "Brave", undefined]);

    // culture_pillar's schema entry names no loc pattern: $_name, then $.
    const culture = computeDefinitionForm(data, schema, { kind: "culture" })!;
    expect(culture.options.culture_pillar.map((i) => [i.value, i.label])).toEqual([
      ["ethos_stoic", "Stoic Ethos"],
      ["language_arabic", undefined],
    ]);
  });

  it("carries the literal the game writes most often for a key as its example", () => {
    const trait = computeDefinitionForm(data, schema, { kind: "trait" })!;
    expect(trait.keys.find((k) => k.key === "category")?.example).toBe("personality");
    expect(trait.keys.find((k) => k.key === "martial")?.example).toBe("2");
    // A key no indexed definition writes has no example to give.
    expect(trait.keys.find((k) => k.key === "desc")?.example).toBeUndefined();
  });

  it("answers null for a kind the active game's schema does not have", () => {
    expect(computeDefinitionForm(data, schema, { kind: "not_a_kind" })).toBeNull();
    expect(computeDefinitionForm(data, schema, { kind: "" })).toBeNull();
  });
});
