/**
 * The Culture Creator's block writer, against two vanilla cultures copied
 * VERBATIM out of game/common/culture/cultures/00_arabic.txt (tabs, the blank
 * lines, and the trailing space after `coa_gfx = { … } ` included).
 *
 * The property under test is the one a reader cannot check by eye: a save that
 * changed nothing must give the file back byte for byte, and a save that
 * changed one pillar must touch one line. A writer that re-serialized the block
 * would pass neither, and would silently reformat every culture a modder opens.
 */
import { describe, expect, it } from "vitest";
import { changedProperties, firstValues, parseBlock } from "../src/webviews/shared/scriptBlock";
import {
  buildBlock,
  inlineList,
  multiList,
  numberList,
  numbersOf,
  rgbList,
  rgbOf,
  tokensOf,
  weightList,
  weightRowsOf,
} from "../src/webviews/cultureCreator/app/script";

const BEDOUIN =
  "bedouin = {\n\tcolor = bedouin\n\t\n\tethos = ethos_stoic\n\theritage = heritage_arabic\n\tlanguage = language_arabic\n\tmartial_custom = martial_custom_male_only\n\thead_determination = head_determination_domain\n\ttraditions = {\n\t\ttradition_tribe_unity\n\t\ttradition_desert_nomads\n\t\ttradition_mubarizuns\n\t\ttradition_caravaneers\n\t\ttradition_ep2_avid_falconers\n\t}\n\t\n\tname_list = name_list_bedouin\n\n\tcoa_gfx = { arabic_group_coa_gfx } \n\tbuilding_gfx = { arabic_group_building_gfx mena_building_gfx } \n\tclothing_gfx = { dde_abbasid_clothing_gfx mena_clothing_gfx } \n\tunit_gfx = { mena_unit_gfx }\n\thouse_coa_frame = house_frame_13\n\thouse_coa_mask_offset = { 0.0 -0.03 }\n\thouse_coa_mask_scale = { 0.95 0.95 }\n\n\tethnicities = {\n\t\t100 = arab\n\t}\n}";

const LEVANTINE =
  "levantine = {\n\tcolor = { 0.3 0.95 0.3 }\n\tcreated = 650.1.1\n\tparents = { bedouin assyrian }\n\t\n\tethos = ethos_spiritual\n\theritage = heritage_arabic\n\tlanguage = language_arabic\n\tmartial_custom = martial_custom_male_only\n\thead_determination = head_determination_domain\n\ttraditions = {\n\t\ttradition_philosopher_culture\n\t\ttradition_medicinal_plants\n\t\ttradition_mubarizuns\n\t\ttradition_dryland_dwellers\n\t\ttradition_ce1_ritual_washing\n\t}\n\t\n\tname_list = name_list_levantine\n\n\tcoa_gfx = { arabic_group_coa_gfx } \n\tbuilding_gfx = { arabic_group_building_gfx mena_building_gfx } \n\tclothing_gfx = { dde_abbasid_clothing_gfx mena_clothing_gfx } \n\tunit_gfx = { mena_unit_gfx } \n\thouse_coa_frame = house_frame_13\n\thouse_coa_mask_offset = { 0.0 -0.03 }\n\thouse_coa_mask_scale = { 0.95 0.95 }\n\n\tethnicities = {\n\t\t100 = arab\n\t}\n}";

/** Every key the form binds, with the value the loaded block gives it. */
function bindAll(source: string): { values: Map<string, string | null>; keys: string[] } {
  const values = new Map<string, string | null>();
  for (const [key, value] of firstValues(parseBlock(source)!)) values.set(key, value);
  return { values, keys: [...values.keys()] };
}

describe("culture block writer", () => {
  it("gives a vanilla block back byte for byte when nothing changed", () => {
    for (const source of [BEDOUIN, LEVANTINE]) {
      const parsed = parseBlock(source)!;
      const { values, keys } = bindAll(source);
      expect(buildBlock(parsed.name, parsed, values, values, keys)).toBe(source);
    }
  });

  it("rewrites exactly the line whose value changed", () => {
    const parsed = parseBlock(BEDOUIN)!;
    const { values, keys } = bindAll(BEDOUIN);
    const loaded = new Map(values);
    values.set("ethos", "ethos_bellicose");
    const after = buildBlock(parsed.name, parsed, values, loaded, keys);
    const before = BEDOUIN.split("\n");
    const now = after.split("\n");
    expect(now.length).toBe(before.length);
    const differing = now.map((line, i) => (line === before[i] ? null : i)).filter((i) => i !== null);
    expect(differing).toEqual([3]);
    expect(now[3]).toBe("\tethos = ethos_bellicose");
    expect(changedProperties(loaded, values)).toEqual([{ key: "ethos", value: "ethos_bellicose" }]);
  });

  it("drops the statement of a key the modder cleared", () => {
    const parsed = parseBlock(BEDOUIN)!;
    const { values, keys } = bindAll(BEDOUIN);
    const loaded = new Map(values);
    values.set("house_coa_frame", null);
    const after = buildBlock(parsed.name, parsed, values, loaded, keys);
    expect(after).not.toContain("house_coa_frame");
    expect(after.split("\n").length).toBe(BEDOUIN.split("\n").length - 1);
    expect(changedProperties(loaded, values)).toEqual([{ key: "house_coa_frame", value: null }]);
  });

  it("keeps a statement the form does not model, in place", () => {
    // A key no widget binds (here a comment and an unknown key) is copied out
    // of the source untouched: AD-5, annotate, never hide.
    const source = "px_x = {\n\t# hand written\n\tsome_future_key = yes\n\tethos = ethos_stoic\n}";
    const parsed = parseBlock(source)!;
    const values = new Map<string, string | null>([["ethos", "ethos_bellicose"]]);
    const loaded = new Map<string, string | null>([["ethos", "ethos_stoic"]]);
    expect(buildBlock("px_x", parsed, values, loaded, ["ethos"])).toBe(
      "px_x = {\n\t# hand written\n\tsome_future_key = yes\n\tethos = ethos_bellicose\n}"
    );
  });

  it("writes a culture that was typed from nothing in the harvest's key order", () => {
    const values = new Map<string, string | null>([
      ["color", rgbList([77, 242, 77])],
      ["ethos", "ethos_stoic"],
      ["traditions", multiList(["tradition_mubarizuns", "tradition_caravaneers"])],
      ["name_list", "name_list_bedouin"],
      ["coa_gfx", inlineList(["arabic_group_coa_gfx"])],
      ["unit_gfx", inlineList([])],
      ["house_coa_mask_scale", numberList([0.95, 0.95])],
      ["ethnicities", weightList([{ weight: 100, value: "arab" }])],
    ]);
    const block = buildBlock("px_test", null, values, new Map(), [
      "color",
      "ethos",
      "traditions",
      "name_list",
      "coa_gfx",
      "unit_gfx",
      "house_coa_mask_scale",
      "ethnicities",
    ]);
    expect(block).toBe(
      "px_test = {\n" +
        "\tcolor = { 0.302 0.949 0.302 }\n" +
        "\tethos = ethos_stoic\n" +
        "\ttraditions = {\n\t\ttradition_mubarizuns\n\t\ttradition_caravaneers\n\t}\n" +
        "\tname_list = name_list_bedouin\n" +
        "\tcoa_gfx = { arabic_group_coa_gfx }\n" +
        "\thouse_coa_mask_scale = { 0.95 0.95 }\n" +
        "\tethnicities = {\n\t\t100 = arab\n\t}\n" +
        "}"
    );
  });

  it("reads the value shapes the vanilla file writes", () => {
    const bedouin = firstValues(parseBlock(BEDOUIN)!);
    expect(tokensOf(bedouin.get("clothing_gfx"))).toEqual(["dde_abbasid_clothing_gfx", "mena_clothing_gfx"]);
    expect(tokensOf(bedouin.get("traditions"))).toHaveLength(5);
    expect(weightRowsOf(bedouin.get("ethnicities"))).toEqual([{ weight: 100, value: "arab" }]);
    expect(numbersOf(bedouin.get("house_coa_mask_offset"))).toEqual([0, -0.03]);
    // A named color is not three components, and must not be read as one.
    expect(rgbOf(bedouin.get("color"))).toBeNull();
    expect(rgbOf(firstValues(parseBlock(LEVANTINE)!).get("color"))).toEqual([77, 242, 77]);
  });
});
