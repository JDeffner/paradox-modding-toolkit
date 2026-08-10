/**
 * CK3's templated-modifier placeholder table ($CULTURE$_opinion, …), consumed
 * by data/modifierTemplates.ts via the game profile.
 *
 * Every placeholder mapping below was verified against vanilla 1.19:
 * `common/modifier_definition_formats/` enumerates the generated names, and
 * script usage (traditions, buildings, perks…) confirms the join rule is
 * `<definition name>` spliced verbatim into the template. Unverifiable
 * placeholders are deliberately absent — a wrong expansion is worse than a
 * missing one:
 *  - GEOGRAPHICAL_REGION (map_data) and TRAIT_TRACK (nested in traits) have no
 *    definition-index kind.
 *  - SUBJECT_SALARY expands to title tiers, but 40 of the 220 tier combinations
 *    do not exist in vanilla's formats.
 */
import type { PlaceholderSpec } from "../../data/modifierTemplates";

/**
 * MEN_AT_ARMS_TYPE expands to the engine's hardcoded base types (`type = …` in
 * a men-at-arms definition), NOT to common/men_at_arms_types names: vanilla
 * uses `heavy_infantry_damage_mult`, never `armored_footmen_damage_mult`.
 */
const MAA_BASE_TYPES = [
  "archer_cavalry",
  "archers",
  "camel_cavalry",
  "elephant_cavalry",
  "gunpowder",
  "heavy_cavalry",
  "heavy_infantry",
  "light_cavalry",
  "nomadic_horde",
  "pikemen",
  "siege_weapon",
  "skirmishers",
] as const;

export const CK3_MODIFIER_PLACEHOLDERS: Record<string, PlaceholderSpec> = {
  CULTURE: { kind: "culture", label: "culture" }, // akan_opinion
  // Faiths are nested under `faiths = { … }` and not indexed yet (see
  // schema.ts); the mapping is inert until they are, which is correct.
  FAITH: { kind: "faith", label: "faith" }, // mutazila_opinion
  GOVERNMENT_TYPE: { kind: "government", label: "government" }, // feudal_government_opinion
  HOLDING_TYPE: { kind: "holding_type", label: "holding type" }, // castle_holding_build_speed
  LIFESTYLE: { kind: "lifestyle", label: "lifestyle" }, // diplomacy_lifestyle_xp_gain_add
  MEN_AT_ARMS_TYPE: {
    values: MAA_BASE_TYPES,
    label: "men-at-arms base type",
    // Verified exception: stationed_* variants exist for every base type
    // EXCEPT nomadic_horde (absent from vanilla formats and script usage).
    excludeValues: { stationed_: ["nomadic_horde"] },
  },
  RELIGIOUS: { kind: "religion", label: "religion" }, // christianity_religion_opinion
  RELIGIOUS_FAMILY: { kind: "religion_family", label: "religion family" }, // rf_pagan_opinion
  SCHEME_TYPE: { kind: "scheme_type", label: "scheme type" }, // abduct_scheme_phase_duration_add
  SCRIPTED_RELATION: { kind: "scripted_relation", label: "scripted relation" }, // scheme_phase_duration_against_rival_add
  SITUATION_TYPE: { kind: "situation", label: "situation" }, // the_great_steppe_supply_limit_add
  TAX_SLOT_TYPE: { kind: "tax_slot_type", label: "tax slot type" }, // clan_tax_slot_add
  TERRAIN_TYPE: { kind: "terrain_type", label: "terrain type" }, // plains_advantage
  VASSAL_STANCE: { kind: "vassal_stance", label: "vassal stance" }, // courtly_opinion
};
