/**
 * How a modifier row reads once the game's own format rules are applied. The
 * formats here are CK3's own, copied from the blocks
 * common/modifier_definition_formats/00_definitions.txt writes for these
 * modifiers, so what is pinned is the arithmetic and the tone rule, not an
 * invented table.
 */
import { describe, expect, it } from "vitest";
import type { ModifierFormat } from "@px-lsp/protocol/protocol";
import { modifierLine } from "../src/webviews/shared/modifierLines";

// `diplomacy = { decimals = 0 prefix = MOD_DIPLOMACY_PREFIX }`, with the
// prefix already resolved to the texticon the concept loc points at.
const DIPLOMACY: ModifierFormat = {
  label: "Diplomacy",
  decimals: 0,
  color: "good",
  prefix: [{ icon: { texture: "gfx/interface/icons/icon_skills.dds", uv: [0, 0, 0.167, 1] } }],
};
// `monthly_income = { decimals = 2 ... suffix = MOD_MONTHLY_POSTFIX }`.
const INCOME: ModifierFormat = {
  label: "Monthly Income",
  decimals: 2,
  color: "good",
  suffix: [{ text: "/month" }],
};
// `stress_gain_mult = { percent = yes decimals = 0 color = bad }`.
const STRESS: ModifierFormat = { label: "Stress Gain", decimals: 0, percent: true, color: "bad" };
// `hostile_scheme_phase_duration_add`: no sign, and the suffix says the direction.
const PHASE: ModifierFormat = {
  label: "Scheme Phase Duration",
  decimals: 0,
  color: "bad",
  noSign: true,
  suffix: [{ text: " days slower" }],
  negativeSuffix: [{ text: " days faster" }],
};

describe("modifierLine", () => {
  it("signs and rounds to the format's own decimals", () => {
    expect(modifierLine("diplomacy", 2, DIPLOMACY).value).toBe("+2");
    expect(modifierLine("monthly_income", 0.3, INCOME).value).toBe("+0.30");
    expect(modifierLine("monthly_income", -0.3, INCOME).value).toBe("-0.30");
    expect(modifierLine("diplomacy", 2, DIPLOMACY).prefix).toEqual(DIPLOMACY.prefix);
  });

  it("scales a percent modifier by 100 and prints the sign", () => {
    expect(modifierLine("stress_gain_mult", -0.1, STRESS).value).toBe("-10%");
    // already_percent means the number IS the percentage: no scaling.
    const already: ModifierFormat = { label: "Advantage", decimals: 0, alreadyPercent: true, color: "good" };
    expect(modifierLine("advantage", 25, already).value).toBe("+25%");
  });

  it("hides the sign and swaps the suffix when the game says the direction in words", () => {
    const faster = modifierLine("hostile_scheme_phase_duration_add", -5, PHASE);
    expect(faster.value).toBe("5");
    expect(faster.suffix).toEqual(PHASE.negativeSuffix);
    expect(modifierLine("hostile_scheme_phase_duration_add", 5, PHASE).suffix).toEqual(PHASE.suffix);
  });

  it("tones by what is good FOR THE PLAYER, not by the sign", () => {
    expect(modifierLine("diplomacy", 2, DIPLOMACY).tone).toBe("good");
    expect(modifierLine("diplomacy", -2, DIPLOMACY).tone).toBe("bad");
    // color = bad flips it: less stress gained is the good news.
    expect(modifierLine("stress_gain_mult", -0.1, STRESS).tone).toBe("good");
    expect(modifierLine("stress_gain_mult", 0.1, STRESS).tone).toBe("bad");
    expect(modifierLine("diplomacy", 0, DIPLOMACY).tone).toBe("neutral");
  });

  it("falls back to the game's defaults for a modifier no format block names", () => {
    const line = modifierLine("some_new_modifier", 1, undefined);
    // _definitions.info: decimals defaults to 2, color to bad.
    expect(line).toMatchObject({ label: "Some New Modifier", value: "+1.00", tone: "bad" });
    expect(line.prefix).toEqual([]);
  });

  it("shows a script value's name verbatim, with no sign and no tone", () => {
    expect(modifierLine("monthly_income", "my_income_value", INCOME)).toMatchObject({
      value: "my_income_value",
      tone: "neutral",
    });
  });
});
