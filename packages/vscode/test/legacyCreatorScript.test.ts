/**
 * The Dynasty Legacy Creator's block reader/writer, against blocks copied
 * VERBATIM out of the game's own files (game/common/dynasty_legacies/
 * 99_legacies.txt and 94_ce1_legacies.txt, game/common/dynasty_perks/
 * 00_dynasty_perks.txt, CK3 1.19.0.6). A generated fixture would prove nothing:
 * what has to hold is that a modder's real file survives a round trip through
 * the form, tab-only lines, trailing comments, `0.30` and all.
 */
import { describe, expect, it } from "vitest";
import {
  applyValues,
  changedProperties,
  doctrineOf,
  effectKeyFor,
  effectLocKey,
  parseChanceValue,
  parseConditions,
  parseEffectLines,
  writeChanceValue,
  writeConditions,
  writeEffectLines,
  modifierRows,
  newDefBlock,
  parseDefBlock,
  parseModifierBlock,
  perkNameFor,
  updateModifierRows,
  valueOf,
  withDoctrine,
  wrapBlockValue,
  writeDefBlock,
  writeModifierBlock,
} from "../src/webviews/legacyCreator/app/script";
import { commonPerkCount, perkLinks, perksOfTrack } from "../src/webviews/legacyCreator/perkIndex";

/** blood_legacy_track: a container with nothing but a tab on its one body line. */
const TRACK = "blood_legacy_track = {\n\t\n}";
/** ce1_heroic_track: the same kind with the one key the harvest documents. */
const GATED_TRACK = "ce1_heroic_track = {\n\tis_shown = {\n\t\thas_dlc_feature = legends\n\t}\n}";

const PERKS = [
  "blood_legacy_1 = { # Noble Veins\n" +
    "\tlegacy = blood_legacy_track\n" +
    "\n" +
    "\tcharacter_modifier = {\n" +
    "\t\tname = blood_legacy_1_modifier\n" +
    "\t\tpositive_random_genetic_chance = 0.30\n" +
    "\t\tpositive_inactive_inheritance_chance = 0.30\n" +
    "\t}\n" +
    "\t\n" +
    "\tai_chance = {\n" +
    "\t\tvalue = 11\n" +
    "\t\tif = {\n" +
    "\t\t\tlimit = {\n" +
    "\t\t\t\tcan_start_new_legacy_track_trigger = no\n" +
    "\t\t\t}\n" +
    "\t\t\tmultiply = 0\n" +
    "\t\t}\n" +
    "\t}\n" +
    "}",
  "blood_legacy_2 = { # Convergent Blood\n" +
    "\tlegacy = blood_legacy_track\n" +
    "\n" +
    "\tcharacter_modifier = {\n" +
    "\t\tgenetic_trait_strengthen_chance = 0.3\n" +
    "\t}\n" +
    "}",
  "blood_legacy_3 = { # Resilient Bloodline\n" +
    "\tlegacy = blood_legacy_track\n" +
    "\n" +
    "\tcharacter_modifier = {\n" +
    "\t\tname = blood_legacy_3_modifier\n" +
    "\t\tnegative_random_genetic_chance = -0.30\n" +
    "\t\tnegative_inactive_inheritance_chance = -0.30\n" +
    "\t}\n" +
    "}",
  "blood_legacy_4 = { # Architected Ancestry\n" +
    "\tlegacy = blood_legacy_track\n" +
    "\n" +
    "\teffect = {\n" +
    "\t\t# Effect is applied in the on action 'on_birth_child'\n" +
    "\t\tcustom_description_no_bullet = {\n" +
    "\t\t\ttext = blood_legacy_4_effect\n" +
    "\t\t}\n" +
    "\t}\n" +
    "\n" +
    "\ttraits = {\n" +
    "\t\tbeauty_good_1 = 100\n" +
    "\t\tintellect_good_1 = 100\n" +
    "\t\tphysique_good_1 = 100\n" +
    "\t\tfecund = 50\n" +
    "\t\talbino = 50\n" +
    "\t\tgiant = 10\n" +
    "\t\tdwarf = 1\n" +
    "\t\tscaly = 1\n" +
    "\t}\n" +
    "}",
  "blood_legacy_5 = { # Octogenarians\n" +
    "\tlegacy = blood_legacy_track\n" +
    "\n" +
    "\tcharacter_modifier = {\n" +
    "\t\tlife_expectancy = 5\n" +
    "\t}\n" +
    "}",
];

/** The harvest's own key order for a perk (data/ck3/structures.json). */
const PERK_KEYS = [
  "legacy",
  "effect",
  "character_modifier",
  "can_be_picked",
  "ai_chance",
  "doctrine_character_modifier",
  "traits",
];

describe("legacy creator: reading and writing a definition block", () => {
  it("round trips the vanilla track and its five perks byte for byte", () => {
    for (const source of [TRACK, GATED_TRACK, ...PERKS]) {
      const block = parseDefBlock(source);
      expect(block, source.slice(0, 30)).not.toBeNull();
      expect(writeDefBlock(block!)).toBe(source);
    }
  });

  it("keeps a perk's trailing comment, blank lines and tab-only line", () => {
    const block = parseDefBlock(PERKS[0])!;
    expect(block.name).toBe("blood_legacy_1");
    expect(block.head).toBe("# Noble Veins");
    expect(block.statements.map((s) => s.key)).toEqual(["legacy", "character_modifier", "ai_chance"]);
    // The blank line before the modifier and the tab-only line before ai_chance.
    expect(block.statements[1].before).toEqual([""]);
    expect(block.statements[2].before).toEqual(["\t"]);
  });

  it("changing one modifier number rewrites exactly one line", () => {
    const block = parseDefBlock(PERKS[0])!;
    const entries = parseModifierBlock(valueOf(block, "character_modifier")!);
    // `name = blood_legacy_1_modifier` is not a row; it is kept where it was.
    expect(entries[0]).toEqual({ kind: "raw", text: "name = blood_legacy_1_modifier" });
    expect(modifierRows(entries)).toEqual([
      { name: "positive_random_genetic_chance", value: 0.3 },
      { name: "positive_inactive_inheritance_chance", value: 0.3 },
    ]);

    const rows = modifierRows(entries);
    rows[0] = { name: rows[0].name, value: 0.5 };
    const next = applyValues(
      block,
      [{ key: "character_modifier", value: writeModifierBlock(updateModifierRows(entries, rows)) }],
      PERK_KEYS
    );
    const before = PERKS[0].split("\n");
    const after = writeDefBlock(next).split("\n");
    expect(after.length).toBe(before.length);
    const moved = after.filter((line, i) => line !== before[i]);
    expect(moved).toEqual(["\t\tpositive_random_genetic_chance = 0.5"]);
  });

  it("keeps 0.30 as 0.30 while the modder does not touch it", () => {
    const entries = parseModifierBlock(valueOf(parseDefBlock(PERKS[2])!, "character_modifier")!);
    expect(writeModifierBlock(updateModifierRows(entries, modifierRows(entries)))).toBe(
      "{\n" +
        "\t\tname = blood_legacy_3_modifier\n" +
        "\t\tnegative_random_genetic_chance = -0.30\n" +
        "\t\tnegative_inactive_inheritance_chance = -0.30\n" +
        "\t}"
    );
  });

  it("reads the traits block as rows because its values are AI chances", () => {
    const entries = parseModifierBlock(valueOf(parseDefBlock(PERKS[3])!, "traits")!);
    expect(modifierRows(entries).slice(0, 2)).toEqual([
      { name: "beauty_good_1", value: 100 },
      { name: "intellect_good_1", value: 100 },
    ]);
    expect(entries.every((e) => e.kind === "row")).toBe(true);
  });

  it("writes a new perk in the harvest's key order, with legacy first", () => {
    const block = applyValues(
      newDefBlock("px_blood_1"),
      [
        { key: "traits", value: null },
        {
          key: "character_modifier",
          value: writeModifierBlock([{ kind: "row", name: "prowess", value: 2, raw: "2" }]),
        },
        { key: "legacy", value: "px_blood_legacy_track" },
        { key: "effect", value: wrapBlockValue("add_prestige = 100") },
      ],
      PERK_KEYS
    );
    expect(writeDefBlock(block)).toBe(
      "px_blood_1 = {\n" +
        "\tlegacy = px_blood_legacy_track\n" +
        "\teffect = {\n" +
        "\t\tadd_prestige = 100\n" +
        "\t}\n" +
        "\tcharacter_modifier = {\n" +
        "\t\tprowess = 2\n" +
        "\t}\n" +
        "}"
    );
  });

  it("removing a key drops its line and leaves the rest alone", () => {
    const block = parseDefBlock(PERKS[4])!;
    const next = applyValues(block, [{ key: "character_modifier", value: null }], PERK_KEYS);
    expect(writeDefBlock(next)).toBe(
      "blood_legacy_5 = { # Octogenarians\n\tlegacy = blood_legacy_track\n\n}"
    );
  });

  it("an untouched form changes no property at all", () => {
    const block = parseDefBlock(PERKS[1])!;
    const entries = parseModifierBlock(valueOf(block, "character_modifier")!);
    const next = applyValues(
      block,
      [
        { key: "legacy", value: "blood_legacy_track" },
        {
          key: "character_modifier",
          value: writeModifierBlock(updateModifierRows(entries, modifierRows(entries))),
        },
      ],
      PERK_KEYS
    );
    expect(changedProperties(block, next, PERK_KEYS)).toEqual([]);
  });

  it("only braces the modder did not write are added", () => {
    expect(wrapBlockValue("  ")).toBeNull();
    expect(wrapBlockValue("{ has_trait = brave }")).toBe("{ has_trait = brave }");
    expect(wrapBlockValue("has_trait = brave")).toBe("{\n\t\thas_trait = brave\n\t}");
  });

  it("prefills a perk name off the track's own key", () => {
    expect(perkNameFor("blood_legacy_track", 0)).toBe("blood_legacy_1");
    expect(perkNameFor("px_mytrack", 4)).toBe("px_mytrack_5");
  });

  it("lifts the doctrine out of its block and puts it back where it was", () => {
    // The example _dynasty_perks.info itself documents for the block.
    const entries = parseModifierBlock(
      "{\n\t\tdoctrine = doctrine_theocracy_lay_clergy\n\t\tsame_faith_opinion = 3\n\t}"
    );
    expect(doctrineOf(entries)).toBe("doctrine_theocracy_lay_clergy");
    expect(modifierRows(entries)).toEqual([{ name: "same_faith_opinion", value: 3 }]);
    expect(writeModifierBlock(withDoctrine(entries, "doctrine_theocracy_lay_clergy"))).toBe(
      "{\n\t\tdoctrine = doctrine_theocracy_lay_clergy\n\t\tsame_faith_opinion = 3\n\t}"
    );
    expect(writeModifierBlock(withDoctrine(entries, "doctrine_gender_male_dominated"))).toBe(
      "{\n\t\tdoctrine = doctrine_gender_male_dominated\n\t\tsame_faith_opinion = 3\n\t}"
    );
    expect(writeModifierBlock(withDoctrine(entries, ""))).toBe("{\n\t\tsame_faith_opinion = 3\n\t}");
    expect(writeModifierBlock(withDoctrine(parseModifierBlock("{\n\t\tprowess = 1\n\t}"), "d_x"))).toBe(
      "{\n\t\tdoctrine = d_x\n\t\tprowess = 1\n\t}"
    );
  });

  it("finds the loc key a perk's effect prints, and nothing else", () => {
    expect(effectLocKey(valueOf(parseDefBlock(PERKS[3])!, "effect")!)).toBe("blood_legacy_4_effect");
    expect(effectLocKey(wrapBlockValue("add_prestige = 100")!)).toBeNull();
  });
});

/**
 * The blocks the no-code builders read and write, against the game's own
 * (CK3 1.19.0.6): every `is_shown` of common/dynasty_legacies, and the
 * `can_be_picked` / `effect` / `ai_chance` of common/dynasty_perks.
 */
describe("legacy creator: the blocks the builders read", () => {
  /** ep1_culture_legacy_track, 97_ep1_legacies.txt: the whole is_shown. */
  const DLC_ONLY = "{ has_dlc_feature = hybridize_culture }";
  /** The rule pair every gated track opens its OR with (82_tgp_legacies.txt). */
  const WITH_RULES =
    "{\n\t\thas_dlc_feature = all_under_heaven\n\t\tOR = {\n" +
    "\t\t\thas_game_rule = unrestricted_dynasty_legacies_all\n\t\t}\n\t}";
  /** tgp_china_legacy_track's real is_shown: an OR the rows cannot hold. */
  const NESTED =
    "{\n\t\thas_dlc_feature = all_under_heaven\n\t\tOR = {\n" +
    "\t\t\thas_game_rule = unrestricted_dynasty_legacies_all\n" +
    "\t\t\tdynasty = {\n\t\t\t\thas_dynasty_perk = tgp_chinese_legacy_1\n\t\t\t}\n\t\t}\n\t}";
  /** 08_tgp_dynasty_perks.txt: what 44 of the 54 can_be_picked blocks are. */
  const SCRIPTED = "{ eligible_for_tgp_china_legacy_trigger = yes }";

  it("reads the two shapes a track's is_shown really has", () => {
    expect(parseConditions(DLC_ONLY)).toEqual([{ kind: "dlc", value: "hybridize_culture" }]);
    expect(parseConditions(WITH_RULES)).toEqual([
      { kind: "dlc", value: "all_under_heaven" },
      { kind: "rules", values: ["unrestricted_dynasty_legacies_all"] },
    ]);
    expect(parseConditions(SCRIPTED)).toEqual([
      { kind: "trigger", name: "eligible_for_tgp_china_legacy_trigger", value: true },
    ]);
  });

  it("declines a condition it cannot show instead of dropping half of it", () => {
    expect(parseConditions(NESTED)).toBeNull();
    // A comment is content too: the rows have nowhere to put it back.
    expect(parseConditions("{\n\t\t# only with the DLC\n\t\thas_dlc_feature = legends\n\t}")).toBeNull();
    expect(parseConditions("")).toBeNull();
  });

  it("writes the rows back in the game's own shape", () => {
    expect(writeConditions(parseConditions(WITH_RULES)!)).toBe(WITH_RULES);
    expect(writeConditions([{ kind: "dlc", value: "legends" }])).toBe(
      "{\n\t\thas_dlc_feature = legends\n\t}"
    );
    expect(writeConditions([])).toBeNull();
    // A row nobody filled in writes nothing at all.
    expect(writeConditions([{ kind: "trigger", name: "", value: true }])).toBeNull();
  });

  it("reads a perk's effect as the sentences it prints", () => {
    // warfare_legacy_5, 00_dynasty_perks.txt: two tooltip lines, nothing else.
    const two =
      "{\n\t\tcustom_description_no_bullet = {\n\t\t\ttext = warfare_legacy_5_unlock_effect\n\t\t}\n" +
      "\t\tcustom_description_no_bullet = {\n\t\t\ttext = warfare_legacy_5_effect\n\t\t}\n\t}";
    expect(parseEffectLines(two)).toEqual(["warfare_legacy_5_unlock_effect", "warfare_legacy_5_effect"]);
    expect(writeEffectLines(parseEffectLines(two)!)).toBe(two);
    // An effect that does something stays script.
    expect(parseEffectLines("{\n\t\tadd_prestige = 100\n\t}")).toBeNull();
    expect(writeEffectLines([])).toBeNull();
  });

  it("reads a plain ai_chance as a number and leaves a weighted one alone", () => {
    expect(parseChanceValue("{\n\t\tvalue = 4\n\t}")).toBe(4);
    expect(writeChanceValue(4)).toBe("{\n\t\tvalue = 4\n\t}");
    expect(writeChanceValue(null)).toBeNull();
    // blood_legacy_1's own chance: a number and an if, so it stays script.
    expect(parseChanceValue(valueOf(parseDefBlock(PERKS[0])!, "ai_chance")!)).toBeNull();
  });

  it("names a perk's tooltip loc keys the way the game does", () => {
    expect(effectKeyFor("blood_legacy_4", 0)).toBe("blood_legacy_4_effect");
    expect(effectKeyFor("blood_legacy_4", 1)).toBe("blood_legacy_4_effect_2");
  });
});

describe("legacy creator: which perk belongs to which track", () => {
  // One file in the shape 00_dynasty_perks.txt has: a trailing comment on the
  // opening line, the link on the second line, nested blocks in between.
  const FILE = `${PERKS[0]}\n\n${PERKS[1]}\n`;

  it("reads the link off the perk's own legacy key", () => {
    expect(perkLinks(FILE)).toEqual([
      { name: "blood_legacy_1", track: "blood_legacy_track" },
      { name: "blood_legacy_2", track: "blood_legacy_track" },
    ]);
    expect(perksOfTrack(perkLinks(FILE), "blood_legacy_track")).toEqual(["blood_legacy_1", "blood_legacy_2"]);
    expect(perksOfTrack(perkLinks(FILE), "warfare_legacy_track")).toEqual([]);
  });

  it("takes the count most tracks share, not the first or the biggest", () => {
    const links = [
      ...["a1", "a2", "a3", "a4", "a5"].map((name) => ({ name, track: "a" })),
      ...["b1", "b2", "b3", "b4", "b5"].map((name) => ({ name, track: "b" })),
      { name: "c1", track: "c" },
    ];
    expect(commonPerkCount(links)).toBe(5);
    expect(commonPerkCount([])).toBeNull();
  });
});
