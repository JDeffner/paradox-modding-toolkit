/**
 * paradox/locText rendering, over stubbed loc/definition/schema tables.
 *
 * The values are the shapes one game's own `culture_parameter_*` entries take,
 * measured over its 609 english values: 280 carry a real datafunction call,
 * of which `GetTrait('x').GetName( GetNullCharacter )` is 145,
 * `GetMaA('x').GetName` 56, `SelectLocalization(...)` 33, `GetTerrain('x')`
 * 20 and the court-position / scheme / decision / activity / law chains the
 * rest; 130 values nest another key as `$key$`. What is pinned is the
 * resolution chain, not a table of function names written here.
 */
import { describe, expect, it } from "vitest";
import { computeLocText, renderLocValue, type LocTextDeps } from "../src/features/locText";

const LOC: Record<string, string> = {
  trait_rough_terrain_expert: "Rough Terrain Expert",
  bowmen: "Bowmen",
  hills: "Hills",
  game_concept_commander_traits: "Commander Traits",
  game_concept_men_at_arms: "Men-at-Arms",
  game_concept_prestige: "Prestige",
  court_physician_court_position: "Personal Physician",
  murder: "Murder",
  DLC_ON: "with the expansion",
  DLC_OFF: "without it",
  SHARED_LINE: "the [prestige|E] sentence",
  FORMATTED: "#P plus five#! [prestige_i] [prestige|E]",
  // The shapes under test, as the game writes them.
  p_trait:
    "The [GetTrait('rough_terrain_expert').GetName( GetNullCharacter )] [commander_traits|E] is more common",
  p_maa: "Can recruit [GetMaA('bowmen').GetName] as [men_at_arms|E]",
  p_terrain: "Fights better in [GetTerrain( 'hills' ).GetName]",
  p_court: "Unlock the [GetCourtPositionType('court_physician_court_position').GetName()] one Tier earlier",
  p_scheme: "[GetScheme('murder').GetTypeName] is cheaper",
  p_select: "[SelectLocalization( HasDlcFeature( 'royal_court' ), 'DLC_ON', 'DLC_OFF' )]",
  p_icon: "Gain [prestige_i] [prestige|E]",
  p_nested: "Also: $SHARED_LINE$",
  p_unknown_key: "Also: $NO_SUCH_KEY$",
  p_script_value: "Gains [EmptyScope.ScriptValue('some_value')|0] a month",
  p_unknown_name: "Can recruit [GetMaA('px_new_unit').GetName] as [men_at_arms|E]",
};

/** The schema patterns the tested kinds state; every other kind states none. */
const PATTERNS: Record<string, string[]> = {
  trait: ["trait_$"],
  men_at_arms: ["$"],
  scheme_type: ["$"],
  game_concept: ["game_concept_$"],
};

/** What the definition index holds: the names, under their kinds. */
const KINDS: Record<string, string[]> = {
  rough_terrain_expert: ["trait"],
  bowmen: ["men_at_arms"],
  hills: ["terrain_type"],
  court_physician_court_position: ["court_position"],
  murder: ["scheme_type", "decision"],
};

const deps: LocTextDeps = {
  loc: (key) => LOC[key],
  kindsOf: (name) => KINDS[name] ?? [],
  patternsOf: (kind) => PATTERNS[kind] ?? [],
};

const text = (key: string): string => renderLocValue(LOC[key], deps).text;
const resolved = (key: string): boolean => renderLocValue(LOC[key], deps).resolved;

describe("locText rendering", () => {
  it("resolves a trait chain through the kind's own loc pattern", () => {
    expect(text("p_trait")).toBe("The Rough Terrain Expert Commander Traits is more common");
    expect(resolved("p_trait")).toBe(true);
  });

  it("resolves a kind whose loc key IS the name (men-at-arms, terrain, court position)", () => {
    expect(text("p_maa")).toBe("Can recruit Bowmen as Men-at-Arms");
    expect(text("p_terrain")).toBe("Fights better in Hills");
    expect(text("p_court")).toBe("Unlock the Personal Physician one Tier earlier");
  });

  it("prefers the kind the function name spells when a name carries several", () => {
    // `murder` is indexed as both a scheme_type and a decision; only
    // GetScheme names one of them, and both resolve through the bare `$`, so
    // what is pinned is that the preferred kind is asked first.
    const asked: string[] = [];
    const spy: LocTextDeps = { ...deps, patternsOf: (kind) => (asked.push(kind), PATTERNS[kind] ?? []) };
    expect(renderLocValue(LOC.p_scheme, spy).text).toBe("Murder is cheaper");
    expect(asked[0]).toBe("scheme_type");
  });

  it("takes the DLC-on branch of SelectLocalization", () => {
    expect(text("p_select")).toBe("with the expansion");
    expect(resolved("p_select")).toBe(true);
  });

  it("drops an icon tag and the space it leaves behind", () => {
    expect(text("p_icon")).toBe("Gain Prestige");
  });

  it("substitutes a nested $key$ one level and renders what it lands on", () => {
    expect(text("p_nested")).toBe("Also: the Prestige sentence");
    expect(resolved("p_nested")).toBe(true);
  });

  it("keeps an unfillable $key$ verbatim and says the value is unresolved", () => {
    expect(text("p_unknown_key")).toBe("Also: $NO_SUCH_KEY$");
    expect(resolved("p_unknown_key")).toBe(false);
  });

  it("falls back to the chain's own word for an expression only the game can evaluate", () => {
    expect(text("p_script_value")).toBe("Gains ScriptValue a month");
    expect(resolved("p_script_value")).toBe(false);
  });

  it("falls back to the definition name when nothing localizes it", () => {
    expect(text("p_unknown_name")).toBe("Can recruit px_new_unit as Men-at-Arms");
    expect(resolved("p_unknown_name")).toBe(false);
  });

  it("strips the game's colour markup from a plain value", () => {
    expect(text("FORMATTED")).toBe("plus five Prestige");
  });
});

describe("computeLocText", () => {
  it("answers one entry per known key and leaves an unknown key out", () => {
    const result = computeLocText(["p_maa", "px_absent", "p_maa"], deps);
    expect(Object.keys(result.values)).toEqual(["p_maa"]);
    expect(result.values.p_maa).toEqual({
      raw: LOC.p_maa,
      text: "Can recruit Bowmen as Men-at-Arms",
      resolved: true,
    });
  });
});
