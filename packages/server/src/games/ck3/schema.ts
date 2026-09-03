/**
 * The bundled CK3 schema table (rework plan AD-3). One entry per game folder
 * we understand; community-editable in-repo, extendable per-workspace via
 * .px-toolkit/schema.json.
 *
 * Every entry was verified against a real CK3 install (game version with
 * common/ ~150 subfolders): the folder was listed, a file opened, and the
 * top-level key confirmed to be the name script actually references. Where a
 * folder's on-disk layout does not fit any extraction mode (see types.ts),
 * it is left out rather than indexed with wrong names — see the trailing
 * "Not covered" block. requiredLoc/rootScopes are only set where confirmed
 * from vanilla loc + the folder's `_*.info` docs.
 */
import type { SchemaEntry, RefField } from "../../schema/types";
import { JOMINI_VARIABLE_BLOCK_REFS } from "../jomini/variables";
import { STRUCTURES } from "./structures";
import { AMBIENT_SCOPES } from "./ambientScopes";

const CK3_SCHEMA_BASE: SchemaEntry[] = [
  // --- Core script folders (already wired in v0.3; keep as-is) ---
  { path: "common/scripted_effects", kind: "scripted_effect" },
  { path: "common/scripted_triggers", kind: "scripted_trigger" },
  { path: "common/on_action", kind: "on_action" },
  { path: "common/script_values", kind: "script_value" },
  { path: "common/scripted_modifiers", kind: "scripted_modifier" },
  // rootScopes: events default to character scope (character_event); other event
  // types differ, but scope inference only ranks/annotates, so best-effort is safe.
  { path: "events", kind: "event", extraction: "event-id", rootScopes: ["character"] },
  { path: "localization", kind: "loc_key", ext: ".yml", extraction: "loc-key" },

  // --- Characters, traits, interactions ---
  { path: "common/traits", kind: "trait", requiredLoc: ["trait_$"], rootScopes: ["character"] },
  {
    path: "common/character_interactions",
    kind: "character_interaction",
    rootScopes: ["character"],
  },
  { path: "common/character_backgrounds", kind: "character_background" },
  { path: "common/character_memory_types", kind: "character_memory_type", rootScopes: ["character"] },
  { path: "common/nicknames", kind: "nickname", requiredLoc: ["$"], rootScopes: ["character"] },
  { path: "common/deathreasons", kind: "death_reason" },
  { path: "common/secret_types", kind: "secret", rootScopes: ["secret"] },
  { path: "common/hook_types", kind: "hook_type" },
  {
    path: "common/scripted_character_templates",
    kind: "scripted_character_template",
  },

  // --- Decisions & interactions surfaces ---
  { path: "common/decisions", kind: "decision", rootScopes: ["character"] },
  { path: "common/suggestions", kind: "suggestion", rootScopes: ["character"] },
  { path: "common/important_actions", kind: "important_action", rootScopes: ["character"] },

  // --- Lifestyles & focuses ---
  { path: "common/lifestyles", kind: "lifestyle", rootScopes: ["character"] },
  {
    path: "common/lifestyle_perks",
    kind: "perk",
    requiredLoc: ["$_name"],
    rootScopes: ["character"],
  },
  { path: "common/focuses", kind: "focus", rootScopes: ["character"] },

  // --- Casus belli & warfare ---
  // casus_belli: `$` loc coverage measured ~92% in vanilla (many internal/debug
  // CBs lack a name loc key) — below the 95% bar, so no requiredLoc.
  { path: "common/casus_belli_types", kind: "casus_belli", rootScopes: ["character"] },
  { path: "common/casus_belli_groups", kind: "casus_belli_group" },
  { path: "common/men_at_arms_types", kind: "men_at_arms", requiredLoc: ["$"], rootScopes: ["character"] },
  { path: "common/combat_effects", kind: "combat_effect" },

  // --- Realm structure: laws, governments, titles, buildings, holdings ---
  // NOTE: common/laws top-level keys are law *groups* (e.g. title_succession_laws);
  // the individual laws (feudal_elective_succession_law) are second-level and are
  // NOT extractable with the current modes. We index the groups only.
  { path: "common/laws", kind: "law_group", rootScopes: ["character"] },
  { path: "common/governments", kind: "government", rootScopes: ["character"] },
  {
    path: "common/landed_titles",
    kind: "landed_title",
    extraction: "nested-title",
    rootScopes: ["character"],
  },
  { path: "common/buildings", kind: "building", requiredLoc: ["building_$"], rootScopes: ["province"] },
  { path: "common/holdings", kind: "holding_type" },
  { path: "common/great_projects/types", kind: "great_project", rootScopes: ["character", "great_project"] },
  { path: "common/terrain_types", kind: "terrain_type" },
  { path: "common/subject_contracts/contracts", kind: "subject_contract", rootScopes: ["character"] },
  { path: "common/subject_contracts/groups", kind: "subject_contract_group" },
  { path: "common/tax_slots/types", kind: "tax_slot_type", rootScopes: ["character"] },
  { path: "common/vassal_stances", kind: "vassal_stance", rootScopes: ["character"] },
  { path: "common/council_positions", kind: "council_position", rootScopes: ["character"] },
  { path: "common/council_tasks", kind: "council_task", rootScopes: ["character"] },
  { path: "common/court_positions/types", kind: "court_position", rootScopes: ["character"] },
  { path: "common/court_positions/tasks", kind: "court_position_task", rootScopes: ["character"] },
  { path: "common/court_amenities", kind: "court_amenity" },
  { path: "common/court_types", kind: "court_type" },

  // --- Culture ---
  { path: "common/culture/cultures", kind: "culture", requiredLoc: ["$"] },
  { path: "common/culture/pillars", kind: "culture_pillar" },
  {
    path: "common/culture/traditions",
    kind: "culture_tradition",
    // def names already carry the `tradition_` prefix; loc key is `<name>_name`.
    requiredLoc: ["$_name"],
    rootScopes: ["culture"],
  },
  { path: "common/culture/innovations", kind: "innovation", requiredLoc: ["$"], rootScopes: ["culture"] },
  { path: "common/culture/eras", kind: "culture_era" },

  // --- Religion ---
  // religion_types top-level keys are religions (akom_religion). Faiths are
  // NESTED under `faiths = { faith_x = {...} }` and cannot be extracted with the
  // current modes, so faiths are NOT indexed here (limitation).
  { path: "common/religion/religion_types", kind: "religion", requiredLoc: ["$"] },
  // doctrine_types top-level keys ARE the doctrine names (doctrine_monogamy),
  // which is exactly what `has_doctrine =` references. Doctrine *groups* live in
  // doctrine_group_types (indexed separately).
  { path: "common/religion/doctrine_types", kind: "doctrine", rootScopes: ["character", "faith"] },
  { path: "common/religion/doctrine_group_types", kind: "doctrine_group" },
  { path: "common/religion/holy_site_types", kind: "holy_site" },

  // --- Dynasties ---
  // dynasties top-level keys are numeric ids; huge and never typed → not completable.
  { path: "common/dynasties", kind: "dynasty", completable: false },
  { path: "common/dynasty_houses", kind: "dynasty_house", completable: false },
  { path: "common/dynasty_legacies", kind: "dynasty_legacy" },
  { path: "common/dynasty_perks", kind: "dynasty_perk" },

  // --- Activities & schemes ---
  { path: "common/activities/activity_types", kind: "activity_type", rootScopes: ["character"] },
  {
    path: "common/schemes/scheme_types",
    kind: "scheme_type",
    requiredLoc: ["$"],
    rootScopes: ["character", "scheme"],
  },
  { path: "common/travel/point_of_interest_types", kind: "point_of_interest", rootScopes: ["character"] },
  { path: "common/travel/travel_options", kind: "travel_option", rootScopes: ["character"] },

  // --- Artifacts ---
  { path: "common/artifacts/types", kind: "artifact_type" },
  { path: "common/artifacts/templates", kind: "artifact_template", rootScopes: ["character"] },
  { path: "common/artifacts/visuals", kind: "artifact_visual" },
  { path: "common/artifacts/slots", kind: "artifact_slot" },

  // --- Struggles, legends, situations ---
  { path: "common/struggle/struggles", kind: "struggle" },
  { path: "common/legends/legend_types", kind: "legend_type", rootScopes: ["legend", "character"] },
  { path: "common/legends/chronicles", kind: "chronicle" },
  { path: "common/situation/situations", kind: "situation", rootScopes: ["situation", "character"] },

  // --- Accolades, diarchies ---
  { path: "common/accolade_types", kind: "accolade_type", rootScopes: ["character"] },
  { path: "common/accolade_names", kind: "accolade_name", rootScopes: ["accolade"] },
  { path: "common/diarchies/diarchy_types", kind: "diarchy_type" },
  { path: "common/diarchies/diarchy_mandates", kind: "diarchy_mandate" },

  // --- Modifiers ---
  // common/modifiers are static modifiers referenced by add_*_modifier = x.
  { path: "common/modifiers", kind: "static_modifier" },
  { path: "common/opinion_modifiers", kind: "opinion_modifier" },

  // --- Events presentation ---
  { path: "common/event_backgrounds", kind: "event_background", rootScopes: ["character"] },
  { path: "common/event_themes", kind: "event_theme" },
  { path: "common/story_cycles", kind: "story_cycle", rootScopes: ["story"] },

  // --- Scripted helpers / rules ---
  { path: "common/scripted_guis", kind: "scripted_gui", rootScopes: ["character"] },
  { path: "common/scripted_rules", kind: "scripted_rule" },
  { path: "common/scripted_lists", kind: "scripted_list" },
  { path: "common/scripted_costs", kind: "scripted_cost" },
  { path: "common/customizable_localization", kind: "customizable_localization" },
  { path: "common/game_rules", kind: "game_rule" },
  { path: "common/flavorization", kind: "flavorization" },

  // --- GUI ---
  { path: "gui", kind: "gui_type", ext: ".gui", extraction: "gui-type" },

  // --- History (huge, never typed → not completable) ---
  { path: "history/characters", kind: "character", completable: false },
  { path: "history/provinces", kind: "province_history", completable: false },

  // --- Coat of arms (huge → not completable) ---
  { path: "common/coat_of_arms/coat_of_arms", kind: "coat_of_arms", completable: false },

  // --- 2026-07 coverage audit (scripts/audit-schema-coverage.ts): every
  // remaining common/ folder with a standard top-level `name = { ... }`
  // layout, verified by parsing vanilla files. Ordered by definition count.
  { path: "common/game_concepts", kind: "game_concept", requiredLoc: ["game_concept_$"] },
  { path: "common/domiciles/buildings", kind: "domicile_building", rootScopes: ["character", "domicile"] },
  { path: "common/domiciles/types", kind: "domicile_type", rootScopes: ["character"] },
  { path: "common/artifacts/features", kind: "artifact_feature" },
  { path: "common/artifacts/feature_groups", kind: "artifact_feature_group" },
  { path: "common/schemes/pulse_actions", kind: "scheme_pulse_action" },
  { path: "common/schemes/agent_types", kind: "scheme_agent_type", rootScopes: ["character"] },
  { path: "common/schemes/scheme_countermeasures", kind: "scheme_countermeasure" },
  { path: "common/message_filter_types", kind: "message_filter_type" },
  { path: "common/message_group_types", kind: "message_group_type" },
  { path: "common/messages", kind: "message" },
  { path: "common/culture/creation_names", kind: "culture_creation_name", rootScopes: ["culture"] },
  { path: "common/culture/name_lists", kind: "name_list" },
  { path: "common/culture/name_equivalency", kind: "name_equivalency", completable: false },
  { path: "common/culture/aesthetics_bundles", kind: "aesthetics_bundle" },
  { path: "common/struggle/catalysts", kind: "struggle_catalyst" },
  { path: "common/situation/catalysts", kind: "situation_catalyst" },
  { path: "common/situation/situation_group_types", kind: "situation_group_type" },
  { path: "common/trigger_localization", kind: "trigger_localization" },
  { path: "common/effect_localization", kind: "effect_localization" },
  { path: "common/dynasty_house_mottos", kind: "house_motto" },
  { path: "common/dynasty_house_motto_inserts", kind: "house_motto_insert" },
  { path: "common/task_contracts", kind: "task_contract", rootScopes: ["character"] },
  { path: "common/activities/guest_invite_rules", kind: "guest_invite_rule", rootScopes: ["character"] },
  { path: "common/activities/pulse_actions", kind: "activity_pulse_action" },
  { path: "common/activities/intents", kind: "activity_intent", rootScopes: ["character"] },
  { path: "common/activities/activity_group_types", kind: "activity_group_type" },
  { path: "common/activities/activity_locales", kind: "activity_locale" },
  { path: "common/bookmarks/bookmarks", kind: "bookmark" },
  { path: "common/bookmarks/groups", kind: "bookmark_group" },
  { path: "common/bookmarks/challenge_characters", kind: "challenge_character" },
  { path: "common/achievements", kind: "achievement" },
  { path: "common/legends/legend_seeds", kind: "legend_seed" },
  { path: "common/scripted_relations", kind: "scripted_relation", rootScopes: ["character"] },
  { path: "common/event_transitions", kind: "event_transition" },
  // Formatting for code-defined modifier types (2026-07 mod audit: mods add
  // formats for their dynamic modifiers). Names mirror code modifiers, so they
  // are indexed for hover/structure but not offered in completion.
  { path: "common/modifier_definition_formats", kind: "modifier_definition_format", completable: false },
  { path: "common/event_2d_effects", kind: "event_2d_effect" },
  { path: "common/house_aspirations", kind: "house_aspiration" },
  { path: "common/house_relation_types", kind: "house_relation_type" },
  { path: "common/house_unities", kind: "house_unity" },
  { path: "common/tutorial_lessons", kind: "tutorial_lesson" },
  { path: "common/tutorial_lesson_chains", kind: "tutorial_lesson_chain" },
  { path: "common/decision_group_types", kind: "decision_group_type" },
  { path: "common/character_interaction_categories", kind: "character_interaction_category" },
  { path: "common/playable_difficulty_infos", kind: "playable_difficulty_info" },
  { path: "common/combat_phase_events", kind: "combat_phase_event", rootScopes: ["character"] },
  { path: "common/inspirations", kind: "inspiration", rootScopes: ["inspiration", "character"] },
  { path: "common/legitimacy", kind: "legitimacy_level", rootScopes: ["character"] },
  { path: "common/tax_slots/obligations", kind: "tax_obligation", rootScopes: ["character"] },
  { path: "common/ai_war_stances", kind: "ai_war_stance" },
  { path: "common/confederation_types", kind: "confederation_type" },
  { path: "common/epidemics", kind: "epidemic", rootScopes: ["epidemic", "character"] },
  { path: "common/factions", kind: "faction", rootScopes: ["faction", "character"] },
  { path: "common/pool_character_selectors", kind: "pool_character_selector" },
  { path: "common/religion/religion_family_types", kind: "religion_family" },
  { path: "common/succession_appointment", kind: "succession_appointment", rootScopes: ["landed_title"] },
  { path: "common/succession_election", kind: "succession_election", rootScopes: ["landed_title"] },
  { path: "common/ruler_objective_advice_types", kind: "ruler_objective_advice" },
  { path: "common/raids/intents", kind: "raid_intent" },
  { path: "common/lease_contracts", kind: "lease_contract" },
  { path: "common/scripted_animations", kind: "scripted_animation" },

  // gfx/ surfaces with script-referenced names (layouts probed in vanilla):
  { path: "gfx/portraits/portrait_modifiers", kind: "portrait_modifier_group" },
  { path: "gfx/portraits/trait_portrait_modifiers", kind: "trait_portrait_modifier_group" },
  { path: "gfx/portraits/portrait_animations", kind: "portrait_animation" },
  { path: "gfx/court_scene/character_groups", kind: "court_scene_group" },
  { path: "gfx/court_scene/character_roles", kind: "court_scene_role" },
  { path: "gfx/court_scene/scene_cultures", kind: "court_scene_culture" },
  { path: "gfx/interface/illustrations/scripted_illustrations", kind: "scripted_illustration" },
];

/**
 * The bundled schema with the §B2 `structure` and §B3 `ambientScopes` layers
 * attached by kind (kept out of the table above so it stays readable). Static —
 * no runtime harvest — so completion/hover work without gamePath set.
 */
export const CK3_SCHEMA: SchemaEntry[] = CK3_SCHEMA_BASE.map((entry) => {
  const structure = STRUCTURES[entry.kind];
  const ambientScopes = AMBIENT_SCOPES[entry.kind];
  if (!structure && !ambientScopes) return entry;
  return { ...entry, ...(structure && { structure }), ...(ambientScopes && { ambientScopes }) };
});

// Not covered (layout doesn't fit any extraction mode, or wrong-data risk):
//  - Faiths: nested under religion_types' `faiths = { ... }` blocks; only the
//    top-level religions are indexable. Faiths would need a dedicated mode.
//  - Individual laws: common/laws top-level keys are law *groups*; the actual
//    laws are second-level (only law_group indexed).
//  - common/defines, common/named_colors,
//    common/genes, common/ethnicities, common/coat_of_arms/dynamic_definitions:
//    these are engine/data config, not script-referenced named definitions in
//    the usual sense.
//  - common/dna_data: keys are portrait ids referenced only via dna = "..." in
//    history; low modding traffic, skipped.
//  - 2026-07 audit deliberate skips: common/console_groups,
//    common/connection_arrows, common/modifier_icons, common/portrait_types,
//    common/graphical_unit_types, common/ai_goaltypes, common/guest_system,
//    common/courtier_guest_management, common/coat_of_arms/options and
//    template_lists (engine/UI config); common/bookmark_portraits (332 files
//    of portrait data, never referenced from script); common/accolade_icons
//    (no parseable defs); common/artifacts/blueprints and
//    common/province_terrain (non-standard layout, would need a mode).
//  - history/cultures|situations|struggles: top-level keys are DATES
//    (867.1.1 = { ... }); the identity comes from the filename, so standard
//    extraction would index garbage.
//  - music/ (.asset format), dlc_metadata, reader_export, and the remaining
//    gfx/ art-config folders (map styles, unit states, accessory_variations,
//    hud_skins, loading_screens): art/engine data, not script-referenced.
//    (Full gap list: scripts/audit-schema-coverage.ts.)

/** Assignment keys whose values reference other definitions. */
export const REF_FIELDS: RefField[] = [
  // Events & on_actions
  { key: "trigger_event", kinds: ["event"] }, // also block form { id = x }; `id` too generic to add safely
  { key: "on_action", kinds: ["on_action"] }, // trigger_event = { on_action = x }, scheme phases, travel…
  { key: "on_actions", kinds: ["on_action"], form: "list" },
  // Weighted block (`<weight> = <on_action>`) and fallback list, like random_events.
  { key: "random_on_action", kinds: ["on_action"], form: "list", weighted: true },
  { key: "first_valid_on_action", kinds: ["on_action"], form: "list" },
  { key: "events", kinds: ["event"], form: "list" },
  { key: "random_events", kinds: ["event"], form: "list", weighted: true },
  { key: "first_valid", kinds: ["event"], form: "list" },
  // `theme = X` in events: X is an event theme, never the faith/culture scope
  // link of the same name — the ref kind lets hover/semantic tokens disambiguate.
  { key: "theme", kinds: ["event_theme"] },

  // Traits. Trait GROUPS (`group = X` inside a trait) act as virtual traits in
  // these fields, so both kinds are carried.
  { key: "trait", kinds: ["trait", "trait_group"] },
  { key: "add_trait", kinds: ["trait"] },
  { key: "remove_trait", kinds: ["trait"] },
  { key: "has_trait", kinds: ["trait", "trait_group"] },

  // Nicknames
  { key: "give_nickname", kinds: ["nickname"] },
  { key: "set_nickname", kinds: ["nickname"] },
  { key: "has_nickname", kinds: ["nickname"] },

  // Perks / focuses / lifestyles
  { key: "add_perk", kinds: ["perk"] },
  { key: "remove_perk", kinds: ["perk"] },
  { key: "has_perk", kinds: ["perk"] },
  { key: "set_focus", kinds: ["focus"] },
  { key: "has_focus", kinds: ["focus"] },
  { key: "has_lifestyle", kinds: ["lifestyle"] },

  // Religion / faith / culture (scalar forms without prefix, common in history)
  { key: "doctrine", kinds: ["doctrine"] },
  { key: "has_doctrine", kinds: ["doctrine"] },
  { key: "religion", kinds: ["religion"] },
  { key: "set_religion", kinds: ["religion"] },
  { key: "faith", kinds: ["faith"] },
  { key: "set_faith", kinds: ["faith"] },
  { key: "culture", kinds: ["culture"] },
  { key: "set_culture", kinds: ["culture"] },

  // Culture innovations / traditions
  { key: "has_innovation", kinds: ["innovation"] },
  { key: "add_innovation", kinds: ["innovation"] },
  { key: "discover_innovation", kinds: ["innovation"] },
  { key: "has_cultural_tradition", kinds: ["culture_tradition"] },
  { key: "has_tradition", kinds: ["culture_tradition"] },
  { key: "add_tradition", kinds: ["culture_tradition"] },

  // Buildings / holdings
  { key: "has_building", kinds: ["building"] },
  { key: "has_building_or_higher", kinds: ["building"] },

  // Governments / laws
  { key: "government", kinds: ["government"] },
  { key: "change_government", kinds: ["government"] },
  { key: "has_government", kinds: ["government"] },

  // Modifiers. `modifier` and add_*_modifier can reference static/opinion/scripted
  // modifiers depending on context; carry all candidate kinds on the reference.
  {
    key: "add_character_modifier",
    kinds: ["static_modifier"],
  },
  { key: "remove_character_modifier", kinds: ["static_modifier"] },
  { key: "has_character_modifier", kinds: ["static_modifier"] },
  { key: "add_county_modifier", kinds: ["static_modifier"] },
  { key: "add_province_modifier", kinds: ["static_modifier"] },
  { key: "add_dynasty_modifier", kinds: ["static_modifier"] },
  { key: "add_house_modifier", kinds: ["static_modifier"] },
  {
    key: "modifier",
    kinds: ["static_modifier", "opinion_modifier", "scripted_modifier"],
  },
  { key: "add_opinion", kinds: ["opinion_modifier"] },
  { key: "reverse_add_opinion", kinds: ["opinion_modifier"] },

  // Casus belli
  { key: "casus_belli", kinds: ["casus_belli"] },
  { key: "using_cb", kinds: ["casus_belli"] },

  // Court positions
  { key: "court_position", kinds: ["court_position"] },
  { key: "has_court_position", kinds: ["court_position"] },
];

/**
 * Keys too generic for a global ref field, resolved by their enclosing block:
 * `id` means an event only inside `trigger_event = { … }`, `reference` names an
 * event background/transition/2d-effect only inside the matching override_*
 * block. (override_icon/_header_background/_sound references are texture paths
 * and sound events, not indexed definitions — nothing to offer.)
 */
export const BLOCK_REF_FIELDS: Record<string, Record<string, string[]>> = {
  trigger_event: { id: ["event"] },
  override_background: { reference: ["event_background"] },
  override_transition: { reference: ["event_transition"] },
  override_effect_2d: { reference: ["event_2d_effect"] },
  // Engine-level variable/list ops shared by every Jomini game.
  ...JOMINI_VARIABLE_BLOCK_REFS,
};

/** Scalar-value prefixes that reference definitions (`culture:czech` → culture). */
export const PREFIX_REFS: Record<string, string[]> = {
  culture: ["culture"],
  faith: ["faith"],
  religion: ["religion"],
  title: ["landed_title"],
  character: ["character"],
  dynasty: ["dynasty"],
  house: ["dynasty_house"],
};
