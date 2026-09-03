/**
 * paradox/modifierFormats against a fixture game folder whose files are copies
 * of CK3's own shapes: the format blocks of
 * `common/modifier_definition_formats/00_definitions.txt`, the loc entries
 * those blocks name, and the `texticon` blocks of `gui/texticons.gui` a
 * `[diplomacy_i]` in one of them resolves through. What is pinned is the
 * resolution chain, not a table written here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { clearModifierFormatsCache, computeModifierFormats } from "../src/creators/modifierFormats";
import { ServerData } from "../src/serverData";

const SOURCE = { folder: "common/modifier_definition_formats", textIcons: "gui/texticons.gui" };

const FORMATS_TXT = `diplomacy = {
	decimals = 0
	prefix = MOD_DIPLOMACY_PREFIX
}

monthly_income = {
	color = good
	prefix = MOD_MONTHLY_INCOME_PREFIX
	suffix = MOD_MONTHLY_POSTFIX
}

stress_gain_mult = {
	percent = yes
	decimals = 0
	color = bad
}

hidden_modifier = {
	hidden = yes
	no_difference_sign = yes
}
`;

// The two shapes a texticon takes in the game's file: a whole texture, and one
// frame of a strip named by a uv rectangle.
const TEXTICONS_GUI = `texticon = {
	icon = gold_icon
	iconsize = {
		texture = "gfx/interface/icons/icon_gold.dds"
		size = { 25 25 }
		fontsize = 16
	}
}

texticon = {
	icon = skill_diplomacy_icon
	iconsize = {
		texture = "gfx/interface/icons/icon_skills.dds"
		size = { 25 25 }
		fontsize = 16
		uv ={ 0 0 0.167 1 }
	}
}
`;

let dir: string;
const data = new ServerData();

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-formats-"));
  fs.mkdirSync(path.join(dir, SOURCE.folder), { recursive: true });
  fs.writeFileSync(path.join(dir, SOURCE.folder, "00_definitions.txt"), FORMATS_TXT, "utf8");
  fs.mkdirSync(path.join(dir, "gui"), { recursive: true });
  fs.writeFileSync(path.join(dir, SOURCE.textIcons), TEXTICONS_GUI, "utf8");
  clearModifierFormatsCache();

  data.setTokens(
    (
      [
        ["diplomacy", "modifier"],
        ["monthly_income", "modifier"],
        ["stress_gain_mult", "modifier"],
        ["hidden_modifier", "modifier"],
        ["positive_random_genetic_chance", "modifier"],
        ["add_gold", "effect"],
      ] as const
    ).map(([name, kind]) => ({ name, kind, doc: "", scopes: [] }))
  );

  const loc = (name: string, value: string): Parameters<typeof data.index.addAll>[0][number] => ({
    name,
    kind: "loc_key",
    file: path.join(dir, "loc.yml"),
    line: 0,
    source: "vanilla",
    value,
  });
  data.index.addAll([
    // The modifier's own word, and the MOD_ entry for a modifier with none.
    loc("diplomacy", "Diplomacy"),
    loc("monthly_income", "Monthly Income"),
    loc("MOD_POSITIVE_RANDOM_GENETIC_CHANCE", "Chance of new good [congenital_traits|E]"),
    loc("game_concept_congenital_traits", "Congenital Traits"),
    // Prefixes and suffixes, and the concept hop an icon reference takes.
    loc("MOD_DIPLOMACY_PREFIX", "[diplomacy_i]"),
    loc("game_concept_diplomacy_i", "@skill_diplomacy_icon!"),
    loc("MOD_MONTHLY_INCOME_PREFIX", "[gold_i]"),
    loc("game_concept_gold_i", "@gold_icon!"),
    loc("MOD_MONTHLY_POSTFIX", "/month"),
  ]);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  clearModifierFormatsCache();
});

describe("computeModifierFormats", () => {
  const all = (): Record<string, import("@px-lsp/protocol/protocol").ModifierFormat> =>
    computeModifierFormats(data, SOURCE, dir)!.formats;

  it("answers null when the profile names no source, or no game folder is set", () => {
    expect(computeModifierFormats(data, undefined, dir)).toBeNull();
    expect(computeModifierFormats(data, SOURCE, null)).toBeNull();
  });

  it("reads the flags out of the format block and defaults the rest", () => {
    const formats = all();
    expect(formats.diplomacy).toMatchObject({ label: "Diplomacy", decimals: 0, color: "bad" });
    expect(formats.stress_gain_mult).toMatchObject({ decimals: 0, percent: true, color: "bad" });
    expect(formats.hidden_modifier).toMatchObject({ hidden: true, noSign: true });
    // _definitions.info: decimals defaults to 2 and color to bad.
    expect(formats.monthly_income).toMatchObject({ decimals: 2, color: "good" });
    // Only modifiers: an effect token is not one.
    expect(formats.add_gold).toBeUndefined();
  });

  it("resolves a prefix icon through the concept entry to the texticon's sprite", () => {
    const formats = all();
    expect(formats.diplomacy.prefix).toEqual([
      { icon: { texture: "gfx/interface/icons/icon_skills.dds", uv: [0, 0, 0.167, 1] } },
    ]);
    // No uv in the block: the whole texture, and no rectangle invented for it.
    expect(formats.monthly_income.prefix).toEqual([
      { icon: { texture: "gfx/interface/icons/icon_gold.dds" } },
    ]);
    expect(formats.monthly_income.suffix).toEqual([{ text: "/month" }]);
  });

  it("falls back from the modifier's own loc to the MOD_ entry to the name", () => {
    const formats = all();
    // The MOD_ entry, with its concept reference resolved to the player's words.
    expect(formats.positive_random_genetic_chance.label).toBe("Chance of new good Congenital Traits");
    // Nothing to read: readable, but still the modifier's own name.
    expect(formats.hidden_modifier.label).toBe("Hidden Modifier");
  });
});
