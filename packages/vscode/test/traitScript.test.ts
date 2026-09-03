/**
 * The trait block round trip: three real vanilla traits, copied verbatim out
 * of game/common/traits/00_traits.txt, loaded into the form and written back.
 *
 * The promise these pin is the one that makes a visual editor safe on a file a
 * modder already owns: opening a definition and saving it again changes NOTHING
 * (repeated `culture_modifier` blocks, a `desc = { first_valid … }` no widget
 * can hold, a comment after an opening brace, the blank lines and tabs), and
 * changing one field changes exactly one line.
 */
import { describe, expect, it } from "vitest";
import { parseBlock, readNumberRows, readTokenList, writeBlock } from "../src/webviews/shared/scriptBlock";
import {
  emptyState,
  loadTrait,
  nameProblem,
  traitFieldSpecs,
  traitWrites,
  type TraitFieldSpec,
} from "../src/webviews/traitCreator/app/traitModel";
import traitForm from "./fixtures/traitForm.json";
import type { DefinitionForm } from "@px-lsp/protocol/protocol";

const FORM = traitForm as unknown as DefinitionForm;
const SPECS = traitFieldSpecs(FORM);
const MODIFIERS = new Set(FORM.modifiers.map((m) => m.name));

/** Load, then write back with nothing touched. */
function roundTrip(
  text: string,
  edit?: (specs: TraitFieldSpec[], loaded: NonNullable<ReturnType<typeof loadTrait>>) => void
) {
  const loaded = loadTrait(SPECS, text, MODIFIERS)!;
  const baseline = JSON.parse(JSON.stringify(loaded.state)) as typeof loaded.state;
  edit?.(SPECS, loaded);
  const writes = traitWrites(SPECS, loaded.state, baseline, loaded.verbatim);
  return writeBlock(loaded.block.name, loaded.block, writes);
}

/** game/common/traits/00_traits.txt, verbatim. */
const BRAVE =
  "brave = {\n" +
  "\tcategory = personality\n" +
  "\topposites = {\n" +
  "\t\tcraven\n" +
  "\t}\n" +
  "\tmartial = 2\n" +
  "\tprowess = 3\n" +
  "\t\n" +
  "\tattraction_opinion = 10\n" +
  "\tglory_hound_opinion = 10\n" +
  "\topposite_opinion = -10\n" +
  "\tsame_opinion = 10\n" +
  "\t\n" +
  "\tculture_modifier = {\n" +
  "\t\tparameter = trait_county_opinion_modifiers\n" +
  "\t\tcounty_opinion_add = 10\n" +
  "\t}\n" +
  "\t\n" +
  "\tculture_modifier = {\n" +
  "\t\tparameter = mountain_trait_bonuses\n" +
  "\t\tmountains_max_combat_roll = 3\n" +
  "\t\tdesert_mountains_max_combat_roll = 3\n" +
  "\t}\n" +
  "\t\n" +
  "\tculture_modifier = {\n" +
  "\t\tparameter = winter_trait_bonuses\n" +
  "\t\twinter_movement_speed = 0.1\n" +
  "\t}\n" +
  "\t\n" +
  "\tculture_modifier = {\n" +
  "\t\tparameter = hill_trait_bonuses\n" +
  "\t\thills_advantage = 4\n" +
  "\t\thills_attrition_mult = -0.25\n" +
  "\t}\n" +
  "\t\n" +
  "\tculture_modifier = {\n" +
  "\t\tparameter = honorable_trait_bonuses\n" +
  "\t\tsame_culture_opinion = 10\n" +
  "\t\tmonthly_prestige_gain_mult = 0.05\n" +
  "\t}\n" +
  "\n" +
  "\truler_designer_cost = 40\n" +
  "\t\n" +
  "\tflag = higher_chance_of_dying_in_battle\n" +
  "\t\n" +
  "\tdesc = {\n" +
  "\t\tfirst_valid = {\n" +
  "\t\t\ttriggered_desc = {\n" +
  "\t\t\t\ttrigger = {\n" +
  "\t\t\t\t\tNOT = { exists = this }\n" +
  "\t\t\t\t}\n" +
  "\t\t\t\tdesc = trait_brave_desc\n" +
  "\t\t\t}\n" +
  "\t\t\tdesc = trait_brave_character_desc\n" +
  "\t\t}\n" +
  "\t}\n" +
  "\n" +
  "\tai_energy = low_positive_ai_value\n" +
  "\tai_boldness = dominant_positive_ai_value\n" +
  "\tai_rationality = low_negative_ai_value\n" +
  "\tai_sociability = low_positive_ai_value\n" +
  "\tai_amenity_target_baseline = 0.1\n" +
  "\n" +
  "\tcompatibility = {\n" +
  "\t\tbrave = @pos_compat_high\n" +
  "\t\tambitious = @pos_compat_medium\n" +
  "\t\trowdy = @pos_compat_medium\n" +
  "\t\tgallant = @pos_compat_low\n" +
  "\t\tlifestyle_blademaster = @pos_compat_low\n" +
  "\t\tstrategist = @pos_compat_low\n" +
  "\t\toverseer = @pos_compat_low\n" +
  "\t\tgallant = @pos_compat_low\n" +
  "\t\tcraven = @neg_compat_high\n" +
  "\t\tlazy = @neg_compat_medium\n" +
  "\t\tcalm = @neg_compat_low\n" +
  "\t\tcontent = @neg_compat_low\n" +
  "\t}\n" +
  "}\n";

/** game/common/traits/00_traits.txt, verbatim. */
const EDUCATION =
  "education_martial_1 = {\n" +
  "\tminimum_age = 16\n" +
  "\tmartial = 2\n" +
  "\tcategory = education\n" +
  "\tmonthly_martial_lifestyle_xp_gain_mult = 0.1\n" +
  "\tdomain_limit = -1\n" +
  "\t\n" +
  "\tculture_modifier = {\n" +
  "\t\tparameter = poorly_educated_leaders_distrusted\n" +
  "\t\tfeudal_government_opinion = -10\n" +
  "\t}\n" +
  "\t\n" +
  "\tculture_modifier = {\n" +
  "\t\tparameter = prowess_from_martial_education\n" +
  "\t\tprowess = 1\n" +
  "\t}\n" +
  "\t\n" +
  "\tculture_modifier = {\n" +
  "\t\tparameter = martial_education_more_valued\n" +
  "\t\tsame_culture_opinion = 1\n" +
  "\t\tattraction_opinion = 4\n" +
  "\t}\n" +
  "\t\n" +
  "\truler_designer_cost = 0\n" +
  "\t\n" +
  "\tdesc = {\n" +
  "\t\tfirst_valid = {\n" +
  "\t\t\ttriggered_desc = {\n" +
  "\t\t\t\ttrigger = {\n" +
  "\t\t\t\t\tNOT = { exists = this }\n" +
  "\t\t\t\t}\n" +
  "\t\t\t\tdesc = trait_education_martial_1_desc\n" +
  "\t\t\t}\n" +
  "\t\t\tdesc = trait_education_martial_1_character_desc\n" +
  "\t\t}\n" +
  "\t}\n" +
  "\n" +
  "\tgroup = education_martial\n" +
  "\tlevel = 1\n" +
  "\tflag = level_1_education\n" +
  "\tflag = military_province\n" +
  "\t\n" +
  "\tadd_commander_trait = yes\n" +
  "}\n";

/** game/common/traits/00_traits.txt, verbatim. */
const CONCUBINE =
  "child_of_concubine_female = {\n" +
  "\tcategory = fame\n" +
  "\tgroup = child_of_concubine\n" +
  "\tlevel = 1\n" +
  "\topposites = {\n" +
  "\t\tbastard\n" +
  "\t\tlegitimized_bastard\n" +
  "\t\twild_oat\n" +
  "\t}\n" +
  "\tdiplomacy = -1\n" +
  "\t\n" +
  "\tshown_in_ruler_designer = no\n" +
  "\t\n" +
  "\tname = trait_child_of_concubine\n" +
  "\tdesc = { # mother was a concubine (at time of birth)\n" +
  "\t\tfirst_valid = {\n" +
  "\t\t\ttriggered_desc = {\n" +
  "\t\t\t\ttrigger = {\n" +
  "\t\t\t\t\tNOT = { exists = this }\n" +
  "\t\t\t\t}\n" +
  "\t\t\t\tdesc = trait_child_of_concubine_desc\n" +
  "\t\t\t}\n" +
  "\t\t\tdesc = trait_child_of_concubine_character_desc\n" +
  "\t\t}\n" +
  "\t}\n" +
  "\ticon = child_of_concubine.dds\n" +
  "\n" +
  "\tai_energy = 15\n" +
  "}\n";

describe("the vanilla traits load and come back unchanged", () => {
  it("brave: five culture_modifier blocks, a desc block and a compatibility block survive", () => {
    expect(roundTrip(BRAVE)).toBe(BRAVE);
  });

  it("education_martial_1: two flag statements of the same key survive", () => {
    expect(roundTrip(EDUCATION)).toBe(EDUCATION);
  });

  it("child_of_concubine_female: a comment after an opening brace survives", () => {
    expect(roundTrip(CONCUBINE)).toBe(CONCUBINE);
  });
});

describe("what the form actually read", () => {
  it("brave fills the widgets it can and leaves the rest to the file", () => {
    const loaded = loadTrait(SPECS, BRAVE, MODIFIERS)!;
    expect(loaded.state.values.category).toBe("personality");
    expect(loaded.state.values.opposites).toEqual(["craven"]);
    expect(loaded.state.values.martial).toBe(2);
    expect(loaded.state.values.flag).toEqual(["higher_chance_of_dying_in_battle"]);
    // Repeated, and @script_value compatibility rows: the file keeps them.
    expect([...loaded.verbatim].sort()).toEqual(["compatibility", "culture_modifier", "desc"]);
  });

  it("education_martial_1 collects both flags into one chip list", () => {
    const loaded = loadTrait(SPECS, EDUCATION, MODIFIERS)!;
    expect(loaded.state.values.flag).toEqual(["level_1_education", "military_province"]);
    expect(loaded.state.values.add_commander_trait).toBe(true);
    expect(loaded.state.values.ruler_designer_cost).toBe(0);
  });

  it("child_of_concubine_female reads the bare icon file name and a no", () => {
    const loaded = loadTrait(SPECS, CONCUBINE, MODIFIERS)!;
    expect(loaded.state.values.icon).toBe("child_of_concubine.dds");
    expect(loaded.state.values.shown_in_ruler_designer).toBe(false);
    expect(loaded.state.values.opposites).toEqual(["bastard", "legitimized_bastard", "wild_oat"]);
  });
});

describe("one changed field is one changed line", () => {
  it("a number", () => {
    const out = roundTrip(BRAVE, (_specs, loaded) => {
      loaded.state.values.martial = 4;
    });
    expect(out).toBe(BRAVE.replace("\tmartial = 2\n", "\tmartial = 4\n"));
  });

  it("a yes/no set to not-set removes its line", () => {
    const out = roundTrip(EDUCATION, (_specs, loaded) => {
      loaded.state.values.add_commander_trait = null;
    });
    expect(out).toBe(EDUCATION.replace("\tadd_commander_trait = yes\n", ""));
  });

  it("a key the block never had is appended", () => {
    const out = roundTrip(CONCUBINE, (_specs, loaded) => {
      loaded.state.values.minimum_age = 16;
    });
    expect(out).toBe(CONCUBINE.replace(/\}\n$/, "\tminimum_age = 16\n}\n"));
  });

  it("a chip added writes a second statement of the same key", () => {
    const out = roundTrip(CONCUBINE, (_specs, loaded) => {
      loaded.state.values.flag = ["px_first", "px_second"];
    });
    expect(out).toContain("\tflag = px_first\n\tflag = px_second\n");
  });
});

describe("a new trait", () => {
  it("writes the fields that have a value, in the section order, and nothing else", () => {
    const state = emptyState(SPECS);
    state.modifiers = [{ name: "monthly_prestige", value: 0.5 }];
    state.values.category = "personality";
    state.values.opposites = ["craven"];
    const writes = traitWrites(SPECS, state, null);
    expect(writeBlock("px_stoic", null, writes)).toBe(
      "px_stoic = {\n\tcategory = personality\n\topposites = { craven }\n\tmonthly_prestige = 0.5\n}"
    );
  });
});

describe("the small readers", () => {
  it("reads a token list only when every entry is a bare token", () => {
    expect(readTokenList("{ craven ambitious }")).toEqual(["craven", "ambitious"]);
    expect(readTokenList("{ craven = 2 }")).toBeNull();
  });

  it("reads number rows only when every value is a literal number", () => {
    expect(readNumberRows("{ brave = 20\n drunkard = -5 }")).toEqual([
      { name: "brave", value: 20 },
      { name: "drunkard", value: -5 },
    ]);
    expect(readNumberRows("{ brave = @pos_compat_high }")).toBeNull();
  });

  it("refuses text that is not a definition block", () => {
    expect(parseBlock("not a block")).toBeNull();
    expect(loadTrait(SPECS, "nope", MODIFIERS)).toBeNull();
  });
});

describe("nameProblem", () => {
  it("takes the key shape the engine reads and refuses the rest", () => {
    expect(nameProblem("px_stoic")).toBeNull();
    expect(nameProblem("")).toContain("needs a name");
    expect(nameProblem("PxStoic")).toContain("lowercase");
    expect(nameProblem("2fast")).toContain("lowercase");
  });
});
