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
import { parseBlock, writeBlock } from "../src/webviews/shared/scriptBlock";
import {
  emptyState,
  loadTrait,
  nameProblem,
  readTriggeredOpinions,
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
  edit?.(loaded.specs, loaded);
  // The specs the LOAD settled, not the designed ones: a key this file writes
  // in a shape its designed widget cannot hold was promoted to script.
  const writes = traitWrites(loaded.specs, loaded.state, baseline);
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

/**
 * The two blocks kinslayer_1 writes in game/common/traits/00_traits.txt,
 * trimmed to one trait: a key the game reads several times over.
 */
const TRIGGERED =
  "px_kinslayer = {\n" +
  "\tcategory = fame\n" +
  "\ttriggered_opinion = {\n" +
  "\t\tparameter = kinslaying_shunned\n" +
  "\t\topinion_modifier = kinslayer_intolerant\n" +
  "\t}\n" +
  "\ttriggered_opinion = {\n" +
  "\t\topinion_modifier = kinslayer_crime_dynasty\n" +
  "\t\tsame_dynasty = yes\n" +
  "\t}\n" +
  "}\n";

/**
 * game/common/traits/00_traits.txt, verbatim: the rule key `immortal` (which
 * the game surfaces through no tooltip line of its own), four `flag`
 * statements, a dynamic `desc`, and two modifiers the docs never list.
 */
const IMMORTAL =
  "immortal = {\n" +
  '\ticon = "immortal.dds"\n' +
  "\t# This is definitely a very clever allusion to the 10k immortals and not just landing arbitrarily on a certain number of zeros.\n" +
  "\truler_designer_cost = 10000\n" +
  "\n" +
  "\topposites = { incapable }\n" +
  "\t\n" +
  "\tdesc = {\n" +
  "\t\tfirst_valid = {\n" +
  "\t\t\ttriggered_desc = {\n" +
  "\t\t\t\ttrigger = {\n" +
  "\t\t\t\t\tNOT = { exists = this }\n" +
  "\t\t\t\t}\n" +
  "\t\t\t\tdesc = trait_immortal_desc\n" +
  "\t\t\t}\n" +
  "\t\t\tdesc = trait_immortal_character_desc\n" +
  "\t\t}\n" +
  "\t}\n" +
  "\n" +
  "\timmortal = yes\n" +
  "\t# Dummy flags — just here for loc really.\n" +
  "\tflag = is_immortal\n" +
  "\tflag = immortal_visuals\n" +
  "\tflag = immortal_fertility\n" +
  "\tflag = immortal_incapability\n" +
  "\tlong_reign_bonus_mult = -1000\n" +
  "\tno_prowess_loss_from_age = yes\n" +
  "}\n";

describe("the vanilla traits load and come back unchanged", () => {
  it("five culture_modifier blocks, repeated flags, a comment after a brace and a rule key all survive", () => {
    // brave: five culture_modifier blocks, a desc block, a compatibility block.
    expect(roundTrip(BRAVE)).toBe(BRAVE);
    // education_martial_1: two flag statements of the same key.
    expect(roundTrip(EDUCATION)).toBe(EDUCATION);
    // child_of_concubine_female: a comment after an opening brace.
    expect(roundTrip(CONCUBINE)).toBe(CONCUBINE);
    // immortal: the rule key, four flags and a dynamic desc.
    expect(roundTrip(IMMORTAL)).toBe(IMMORTAL);
  });
});

describe("what the form actually read", () => {
  it("brave fills the widgets it can and gives the rest script boxes", () => {
    const loaded = loadTrait(SPECS, BRAVE, MODIFIERS)!;
    expect(loaded.state.values.category).toBe("personality");
    expect(loaded.state.values.opposites).toEqual(["craven"]);
    expect(loaded.state.values.martial).toBe(2);
    expect(loaded.state.values.flag).toEqual(["higher_chance_of_dying_in_battle"]);
    // Written five times, a dynamic desc, and compatibility rows whose values
    // are @script_values: no designed widget can hold those, so each key gets
    // a script field holding the file's own text. Nothing is left out.
    const promoted = loaded.specs.filter((spec) => spec.widget === "script").map((spec) => spec.key);
    for (const key of ["compatibility", "culture_modifier", "desc"]) expect(promoted).toContain(key);
    expect((loaded.state.values.culture_modifier as string[]).length).toBe(5);
    expect((loaded.state.values.desc as string[])[0]).toContain("first_valid");
  });

  it("a triggered_opinion written twice keeps both blocks, and reads for the preview", () => {
    const text = TRIGGERED;
    const loaded = loadTrait(SPECS, text, MODIFIERS)!;
    const blocks = loaded.state.values.triggered_opinion as string[];
    expect(blocks.length).toBe(2);
    expect(readTriggeredOpinions(blocks)).toEqual([
      { modifier: "kinslayer_intolerant", conditions: ["parameter = kinslaying_shunned"] },
      { modifier: "kinslayer_crime_dynasty", conditions: ["same_dynasty = yes"] },
    ]);
    expect(roundTrip(text)).toBe(text);
  });

  it("immortal reaches a control for every key the docs list", () => {
    const loaded = loadTrait(SPECS, IMMORTAL, MODIFIERS)!;
    // A rule the player never reads as a tooltip line is still a field: the
    // tri-state holds it, so the panel can put it in the hidden group with
    // _traits.info's own sentence about it.
    expect(loaded.state.values.immortal).toBe(true);
    expect(loaded.state.values.ruler_designer_cost).toBe(10000);
    expect(loaded.state.values.opposites).toEqual(["incapable"]);
    expect(loaded.state.values.flag).toEqual([
      "is_immortal",
      "immortal_visuals",
      "immortal_fertility",
      "immortal_incapability",
    ]);
    // `icon = "immortal.dds"` is quoted here and bare elsewhere; the picker
    // gets the file name either way.
    expect(loaded.state.values.icon).toBe("immortal.dds");
    // The dynamic desc is the only key of this file that needed a wider widget
    // than the harvest asks for: a loc key by design, script boxes here.
    expect(SPECS.find((spec) => spec.key === "desc")!.widget).toBe("text");
    expect(loaded.specs.find((spec) => spec.key === "desc")!.widget).toBe("script");
    const widened = loaded.specs.filter(
      (spec) => spec.widget !== SPECS.find((designed) => designed.key === spec.key)!.widget
    );
    expect(widened.map((spec) => spec.key)).toEqual(["desc"]);
    expect(loaded.state.modifiers).toEqual([{ name: "long_reign_bonus_mult", value: -1000 }]);
  });

  it("reads a zero, a no and a bare icon file name as themselves", () => {
    const education = loadTrait(SPECS, EDUCATION, MODIFIERS)!;
    expect(education.state.values.flag).toEqual(["level_1_education", "military_province"]);
    expect(education.state.values.add_commander_trait).toBe(true);
    // A cost of 0 is a value the file has, not an empty field.
    expect(education.state.values.ruler_designer_cost).toBe(0);

    const concubine = loadTrait(SPECS, CONCUBINE, MODIFIERS)!;
    expect(concubine.state.values.icon).toBe("child_of_concubine.dds");
    expect(concubine.state.values.shown_in_ruler_designer).toBe(false);
    expect(concubine.state.values.opposites).toEqual(["bastard", "legitimized_bastard", "wild_oat"]);
  });
});

describe("one changed field is one changed line", () => {
  it("a number is rewritten in place, a yes/no set to not-set loses its line", () => {
    const number = roundTrip(BRAVE, (_specs, loaded) => {
      loaded.state.values.martial = 4;
    });
    expect(number).toBe(BRAVE.replace("\tmartial = 2\n", "\tmartial = 4\n"));

    const cleared = roundTrip(EDUCATION, (_specs, loaded) => {
      loaded.state.values.add_commander_trait = null;
    });
    expect(cleared).toBe(EDUCATION.replace("\tadd_commander_trait = yes\n", ""));
  });

  it("a key the block never had is appended, and a chip list as one statement each", () => {
    const appended = roundTrip(CONCUBINE, (_specs, loaded) => {
      loaded.state.values.minimum_age = 16;
    });
    expect(appended).toBe(CONCUBINE.replace(/\}\n$/, "\tminimum_age = 16\n}\n"));

    const chips = roundTrip(CONCUBINE, (_specs, loaded) => {
      loaded.state.values.flag = ["px_first", "px_second"];
    });
    expect(chips).toContain("\tflag = px_first\n\tflag = px_second\n");
  });
});

describe("a block value sits one level in, like the rest of the block", () => {
  /**
   * The shape a saved trait came out as before `statementLines`: the nested
   * block's rows and its closing brace at column 0, while every statement
   * around them sat a tab in.
   */
  const NESTED =
    "mod_trait = {\n" +
    "\ticon = bastard_founder.dds\n" +
    "\tcompatibility = {\n" +
    "\t\talbino = 6\n" +
    "\t}\n" +
    "\tlearning = 16\n" +
    "}\n";

  it("indents a rewritten and an appended block, not just their first lines", () => {
    const rewritten = roundTrip(NESTED, (_specs, loaded) => {
      loaded.state.values.compatibility = [{ name: "albino", value: 6.5 }];
    });
    expect(rewritten).toBe(NESTED.replace("\t\talbino = 6\n", "\t\talbino = 6.5\n"));

    const appended = roundTrip(NESTED, (_specs, loaded) => {
      loaded.state.values.triggered_opinion = ["{\n\topinion_modifier = px_liked\n}"];
    });
    expect(appended).toContain("\ttriggered_opinion = {\n\t\topinion_modifier = px_liked\n\t}");
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
