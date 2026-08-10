/**
 * The Victoria 3 schema table.
 *
 * Every entry was verified folder-by-folder against a real Victoria 3 install
 * (F:\SteamLibrary\...\Victoria 3\game, `common/` with 136 subfolders,
 * 2026-08-01): the folder was listed, at least one file opened, and the
 * top-level key confirmed to be the name script actually references. Folders
 * whose on-disk layout fits none of the extraction modes (see schema/types.ts)
 * are left out rather than indexed with wrong names — see the trailing
 * "Not covered" block.
 *
 * The community CWT config (cwtools-vic3-config) was used as a *checklist*
 * only; where it disagreed with the install, the install won (the disagreements
 * are noted below).
 *
 * requiredLoc: every claim below was MEASURED against vanilla
 * localization/english (101 467 keys) — the folder's definition names were
 * expanded through the pattern and looked up. Only patterns satisfied by ≥95%
 * of vanilla definitions are claimed, and each carries its measured hit rate.
 *
 * rootScopes: claimed only where the CWT config's type-level `replace_scope`
 * and the folder's own file contents agree. Omitted when unsure.
 *
 * No structure/ambientScopes layers: the Vic3 tree ships no `_*.info` docs
 * (see games/vic3/index.ts). Engine tokens come from the user's own script_docs
 * logs (same log format as CK3).
 */
import type { SchemaEntry, RefField } from "../../schema/types";
import { JOMINI_VARIABLE_BLOCK_REFS } from "../jomini/variables";

export const VIC3_SCHEMA: SchemaEntry[] = [
  // --- Core script surfaces ---
  // Events use `namespace = x` declarations and ns.N ids like CK3. Root scope
  // varies by event type (country/state/character), so none is claimed.
  { path: "events", kind: "event", extraction: "event-id" },
  { path: "localization", kind: "loc_key", ext: ".yml", extraction: "loc-key" },
  { path: "common/scripted_effects", kind: "scripted_effect" },
  { path: "common/scripted_triggers", kind: "scripted_trigger" },
  { path: "common/script_values", kind: "script_value" },
  // Vanilla ships ZERO .txt files here (only scripted_modifiers.md, which
  // documents the `name = { <factor blocks> }` layout). Indexed anyway so mod
  // definitions resolve; the folder is a normal top-level-key folder.
  { path: "common/scripted_modifiers", kind: "scripted_modifier" },
  // Vic3 reads the PLURAL folder (unlike CK3's common/on_action).
  { path: "common/on_actions", kind: "on_action" },
  // Each scripted_gui declares its own `scope = X`, so no fixed root scope.
  { path: "common/scripted_guis", kind: "scripted_gui" },
  { path: "common/scripted_lists", kind: "scripted_list" },
  { path: "common/scripted_rules", kind: "scripted_rule" },
  { path: "common/scripted_buttons", kind: "scripted_button", rootScopes: ["country"] },
  { path: "common/scripted_progress_bars", kind: "scripted_progress_bar", rootScopes: ["country"] },
  { path: "common/customizable_localization", kind: "customizable_localization" },
  // $ 100% (612/612), $_desc 100% (612/612). Vic3 names already carry the
  // `concept_` prefix, so the key is the bare name (no `game_concept_` prefix
  // as in CK3 — measured 0%).
  { path: "common/game_concepts", kind: "game_concept", requiredLoc: ["$", "$_desc"] },
  { path: "common/trigger_localization", kind: "trigger_localization" },
  { path: "common/effect_localization", kind: "effect_localization" },

  // --- Decisions & journal ---
  // $ 100% (60/60), $_desc 100% (60/60).
  {
    path: "common/decisions",
    kind: "decision",
    rootScopes: ["country"],
    requiredLoc: ["$", "$_desc"],
  },
  // $ 100% (419/419), $_reason 100% (419/419) — `_reason` is the journal
  // entry's goal tooltip and the CWT config marks it required too.
  {
    path: "common/journal_entries",
    kind: "journal_entry",
    rootScopes: ["country"],
    requiredLoc: ["$", "$_reason"],
  },
  // $ 96.3% (26/27).
  { path: "common/journal_entry_groups", kind: "journal_entry_group", requiredLoc: ["$"] },

  // --- Economy ---
  // $ 100% (115/115). No `$_desc` (0%) and no `building_` prefix (names carry it).
  {
    path: "common/buildings",
    kind: "building",
    rootScopes: ["building"],
    requiredLoc: ["$"],
  },
  // $ 100% (69/69).
  { path: "common/building_groups", kind: "building_group", requiredLoc: ["$"] },
  // $ 100% (436/436).
  { path: "common/production_methods", kind: "production_method", requiredLoc: ["$"] },
  // $ 100% (197/197).
  { path: "common/production_method_groups", kind: "production_method_group", requiredLoc: ["$"] },
  // $ 100% (53/53).
  { path: "common/goods", kind: "good", rootScopes: ["goods"], requiredLoc: ["$"] },
  // $ 100% (72/72).
  { path: "common/prestige_goods", kind: "prestige_good", requiredLoc: ["$"] },
  // $ 100% (15/15).
  { path: "common/pop_needs", kind: "pop_need", requiredLoc: ["$"] },
  // $ 100% (221/221).
  { path: "common/company_types", kind: "company_type", requiredLoc: ["$"] },
  // $ 100% (5/5), $_desc 100% (5/5).
  {
    path: "common/company_charter_types",
    kind: "company_charter_type",
    rootScopes: ["company"],
    requiredLoc: ["$", "$_desc"],
  },

  // --- Pops & society ---
  // $ 100% (15/15), $_desc 100% (15/15).
  {
    path: "common/pop_types",
    kind: "pop_type",
    rootScopes: ["pop"],
    requiredLoc: ["$", "$_desc"],
  },
  // $ 100% (14/14), $_desc 100% (14/14).
  { path: "common/social_classes", kind: "social_class", requiredLoc: ["$", "$_desc"] },
  // $ 100% (3/3) — only three vanilla definitions, so a weak sample.
  {
    path: "common/social_hierarchies",
    kind: "social_hierarchy",
    rootScopes: ["pop"],
    requiredLoc: ["$"],
  },
  // $ 100% (324/324). Covers heritages, languages and religious traditions.
  { path: "common/discrimination_traits", kind: "discrimination_trait", requiredLoc: ["$"] },
  // $ 100% (89/89).
  {
    path: "common/discrimination_trait_groups",
    kind: "discrimination_trait_group",
    requiredLoc: ["$"],
  },
  // $ 100% (317/317).
  { path: "common/cultures", kind: "culture", requiredLoc: ["$"] },
  // $ 100% (17/17).
  { path: "common/religions", kind: "religion", requiredLoc: ["$"] },

  // --- Politics ---
  // Unlike CK3, Vic3 splits laws and law groups into two folders, so BOTH the
  // individual law and its group are ordinary top-level keys.
  // $ 100% (138/138), $_desc 100% (138/138).
  {
    path: "common/laws",
    kind: "law",
    rootScopes: ["country"],
    requiredLoc: ["$", "$_desc"],
  },
  // $ 100% (26/26), $_desc 100% (26/26).
  {
    path: "common/law_groups",
    kind: "law_group",
    rootScopes: ["country"],
    requiredLoc: ["$", "$_desc"],
  },
  // $ 100% (172/172), $_desc 100% (172/172).
  { path: "common/ideologies", kind: "ideology", requiredLoc: ["$", "$_desc"] },
  // $ 100% (7/7), $_desc 100% (7/7).
  { path: "common/institutions", kind: "institution", requiredLoc: ["$", "$_desc"] },
  // $ 100% (8/8), $_desc 100% (8/8).
  {
    path: "common/interest_groups",
    kind: "interest_group",
    rootScopes: ["interest_group"],
    requiredLoc: ["$", "$_desc"],
  },
  // $ 100% (99/99), $_desc 100% (99/99).
  { path: "common/interest_group_traits", kind: "interest_group_trait", requiredLoc: ["$", "$_desc"] },
  // Party names are built from `name = { first_valid = … }`, not from a `$`
  // key, so no requiredLoc.
  { path: "common/parties", kind: "party", rootScopes: ["country"] },
  // $ 100% (39/39).
  { path: "common/political_movements", kind: "political_movement", requiredLoc: ["$"] },
  { path: "common/political_movement_categories", kind: "political_movement_category" },
  // $ 100% (4/4) — four vanilla definitions, weak sample but unambiguous.
  {
    path: "common/political_lobbies",
    kind: "political_lobby",
    rootScopes: ["country"],
    requiredLoc: ["$"],
  },
  // $ 100% (444/444), $_desc 99.8% (443/444).
  {
    path: "common/government_types",
    kind: "government_type",
    rootScopes: ["country"],
    requiredLoc: ["$", "$_desc"],
  },

  // --- Characters ---
  // $ 100% (121/121), $_desc 100% (121/121). Bare name, no `trait_` prefix (0%).
  { path: "common/character_traits", kind: "character_trait", requiredLoc: ["$", "$_desc"] },
  // $ 100% (21/21); $_desc only 61.9%, so not claimed.
  {
    path: "common/character_interactions",
    kind: "character_interaction",
    rootScopes: ["character"],
    requiredLoc: ["$"],
  },
  // $ 100% (10/10).
  {
    path: "common/character_roles",
    kind: "character_role",
    rootScopes: ["character"],
    requiredLoc: ["$"],
  },
  // 2011 vanilla templates, almost all historical one-offs referenced only from
  // their own history file → indexed for navigation, kept out of completion.
  { path: "common/character_templates", kind: "character_template", completable: false },

  // --- Country & diplomacy ---
  // 830 country tags; noisy in completion (`D00`… placeholder tags) and only
  // 88% have a `$` loc key, so neither completable nor a requiredLoc claim.
  { path: "common/country_definitions", kind: "country_definition", completable: false },
  // $ 100% (5/5).
  { path: "common/country_types", kind: "country_type", requiredLoc: ["$"] },
  // $ 100% (9/9).
  { path: "common/subject_types", kind: "subject_type", requiredLoc: ["$"] },
  // $ 100% (55/55), $_desc 100% (55/55).
  {
    path: "common/diplomatic_actions",
    kind: "diplomatic_action",
    rootScopes: ["country"],
    requiredLoc: ["$", "$_desc"],
  },
  // $ 98.1% (51/52); $_desc 86.5%, not claimed.
  {
    path: "common/diplomatic_plays",
    kind: "diplomatic_play",
    rootScopes: ["country"],
    requiredLoc: ["$"],
  },
  // $ 100% (77/77), $_desc 100% (77/77).
  {
    path: "common/diplomatic_catalysts",
    kind: "diplomatic_catalyst",
    rootScopes: ["country"],
    requiredLoc: ["$", "$_desc"],
  },
  // War goals take their display name from the play that carries them: only
  // 17.6% (6/34) have a `$` key, so no requiredLoc.
  { path: "common/war_goal_types", kind: "war_goal_type", rootScopes: ["country"] },
  // $ 100% (34/34), $_desc 100% (34/34).
  {
    path: "common/treaty_articles",
    kind: "treaty_article",
    rootScopes: ["country"],
    requiredLoc: ["$", "$_desc"],
  },

  // --- Power blocs ---
  // Principles display their GROUP's name, so `$` is 0% while $_desc is
  // 100% (69/69) — measured, not assumed.
  {
    path: "common/power_bloc_principles",
    kind: "power_bloc_principle",
    rootScopes: ["country"],
    requiredLoc: ["$_desc"],
  },
  // $ 100% (23/23), $_desc 100% (23/23).
  {
    path: "common/power_bloc_principle_groups",
    kind: "power_bloc_principle_group",
    requiredLoc: ["$", "$_desc"],
  },
  // $ 100% (6/6), $_desc 100% (6/6).
  {
    path: "common/power_bloc_identities",
    kind: "power_bloc_identity",
    rootScopes: ["country"],
    requiredLoc: ["$", "$_desc"],
  },
  // $ 100% (200/200).
  {
    path: "common/power_bloc_names",
    kind: "power_bloc_name",
    rootScopes: ["country"],
    requiredLoc: ["$"],
  },

  // --- Technology, states, map ---
  // The folder is `technology/` with two definition subfolders; the researchable
  // technologies live in technologies/. $ 100% (179/179), $_desc 100% (179/179).
  {
    path: "common/technology/technologies",
    kind: "technology",
    requiredLoc: ["$", "$_desc"],
  },
  // Eras have no loc keys of their own at all (measured 0%).
  { path: "common/technology/eras", kind: "technology_era" },
  // $ 100% (239/239).
  {
    path: "common/state_traits",
    kind: "state_trait",
    rootScopes: ["state"],
    requiredLoc: ["$"],
  },
  // $ 100% (11/11), $_desc 100% (11/11).
  {
    path: "common/decrees",
    kind: "decree",
    rootScopes: ["state"],
    requiredLoc: ["$", "$_desc"],
  },
  // $ 100% (142/142).
  { path: "common/strategic_regions", kind: "strategic_region", requiredLoc: ["$"] },
  // $ 100% (165/165).
  { path: "common/geographic_regions", kind: "geographic_region", requiredLoc: ["$"] },

  // --- Modifiers & rules ---
  // The `add_modifier = x` targets. 6127 vanilla definitions but every name is
  // unique and hand-written, so they stay completable. Only 67.7% have a `$`
  // loc key (code-applied containers have none), so no requiredLoc.
  { path: "common/static_modifiers", kind: "static_modifier" },
  // Formatting/metadata for code-defined modifier types (CK3's
  // modifier_definition_formats equivalent): names mirror engine modifiers, so
  // indexed for hover/navigation but not offered in completion.
  { path: "common/modifier_type_definitions", kind: "modifier_type", completable: false },
  { path: "common/opinion_modifiers", kind: "opinion_modifier" },
  // NOTE: top-level keys here are game rule *categories* (achievements,
  // ai_behavior); the individual settings that `has_game_rule = x` references
  // are second-level and are NOT extractable with the current modes — the same
  // situation as CK3's common/laws. rule_$ 100% (15/15) confirms the top-level
  // key is the category (the settings use `setting_$`).
  { path: "common/game_rules", kind: "game_rule_category", requiredLoc: ["rule_$"] },
];

// Not covered (layout doesn't fit any extraction mode, or wrong-data risk):
//  - Individual game rule settings: second-level keys under common/game_rules
//    (only the category is indexed, see above).
//  - common/history/*: 22 subfolders whose top-level keys are dates
//    (1836.1.1 = { … }) or country tags repeated per file; the identity comes
//    from the filename, so standard extraction would index garbage.
//  - common/coat_of_arms/* (coat_of_arms, options, template_lists): `@macro`
//    soup and texture-path lists rather than named definitions.
//  - common/power_bloc_coa_pieces: top-level keys are .dds FILENAMES
//    (`pb_center_00.dds`), not identifiers.
//  - common/named_colors: every file's single top-level key is `colors`.
//  - common/defines, common/genes, common/ethnicities, common/flag_definitions,
//    common/dna_data, common/culture_graphics, common/terrain,
//    common/terrain_manipulators, common/strait_definitions: engine/art data
//    config keyed by `@macro` blocks, province colours or texture paths.
//  - common/country_creation and common/country_formation: fit the mode, but
//    their top-level keys are country TAGS that collide with
//    country_definitions — three "definitions" per tag would make navigation
//    worse, not better. Revisit if a tag-aware mode lands.
//  - Deliberate low-traffic skips (standard layout, would just add noise):
//    achievements, ai_strategies, ai_strategic_region_stance_types,
//    acceptance_statuses, alert_types, alert_groups, amendments,
//    battle_conditions, buy_packages, cohesion_levels, combat_unit_types,
//    combat_unit_groups, combat_unit_experience_levels, commander_orders,
//    commander_ranks, console_command_macros, country_ranks,
//    diplomatic_catalyst_categories, dynamic_company_names,
//    dynamic_country_names, dynamic_country_map_colors, dynamic_treaty_names,
//    harvest_condition_types, interest_tier_types, labels, legitimacy_levels,
//    liberty_desire_levels, map_interaction_types, map_notification_types,
//    messages, military_formation_flags, mobilization_options,
//    mobilization_option_groups, naval_battle_conditions, naval_mission_types,
//    objectives, objective_subgoals, objective_subgoal_categories,
//    political_lobby_appeasement, political_movement_pop_support,
//    power_bloc_map_textures, proposal_types, ship_groups, ship_modifications,
//    ship_modification_slots, ship_name_definitions, ship_types,
//    ship_veterancy_levels, themes, tutorial_lessons, tutorial_lesson_chains.
//  - gui/ and gfx/: the Vic3 profile ships no gui/data-type layer (PLAN.md M4
//    cut), and unlike CK3 no gfx/ subfolder holds script-referenced names —
//    gfx/portraits, gfx/map/* etc. are pure art config.
//
// Where the CWT config disagreed with the install (install wins):
//  - CWT declares type[old_combat_unit_type] at common/old_combat_unit_types
//    and type[history_interest] at common/history/interests. Neither folder
//    exists in the install.
//  - CWT's type[achievement_group] points at bare "game/common"; there is no
//    such folder (achievement groups live inside common/achievements).
//  - CWT models common/history/* as game-root `history/`; in Vic3 it really is
//    common/history/ (verified on disk). Either way it is not indexed.

/**
 * Assignment keys whose values reference other definitions. Every entry was
 * counted across the vanilla common/ + events/ tree with the same rules the
 * reference extractor uses (unquoted scalar values, no `prefix:`); the counts
 * are the vanilla usage sites.
 */
export const VIC3_REF_FIELDS: RefField[] = [
  // Events & on_actions
  { key: "trigger_event", kinds: ["event"] }, // 57
  { key: "on_action", kinds: ["on_action"] }, // 1 (Vic3 mostly fires on_actions by name only)
  { key: "on_actions", kinds: ["on_action"], form: "list" }, // 7
  { key: "events", kinds: ["event"], form: "list" }, // 97
  // Vic3's random_events is WEIGHTED (`10 = ns.1`), so only the rare bare-list
  // form resolves through this field; kept because the bare form is still legal.
  { key: "random_events", kinds: ["event"], form: "list" },
  // NOT `first_valid`. common/on_actions/_on_actions.md documents it as an
  // on_action's "pick the first valid event" list, but all 405 vanilla sites
  // are the LOCALIZATION construct `desc = { first_valid = { triggered_desc
  // … } }`, zero are event lists. Claiming it would turn every localized
  // description into bogus event references. Same for `random_on_actions`,
  // `first_valid_on_action` and `fallback`: documented in that .md, zero
  // script sites, so nothing to resolve.

  // Technology
  { key: "has_technology_researched", kinds: ["technology"] }, // 1509
  { key: "add_technology_researched", kinds: ["technology"] }, // 220
  { key: "unlocking_technologies", kinds: ["technology"], form: "list" }, // 644
  { key: "era", kinds: ["technology_era"] }, // 179

  // Buildings & production
  { key: "has_building", kinds: ["building"] }, // 456
  { key: "building_types", kinds: ["building"], form: "list" }, // 395
  { key: "building_group", kinds: ["building_group"] }, // 115
  { key: "production_method", kinds: ["production_method"] }, // 105
  { key: "production_methods", kinds: ["production_method"], form: "list" }, // 591
  { key: "unlocking_production_methods", kinds: ["production_method"], form: "list" }, // 11
  { key: "goods", kinds: ["good"] }, // 62 scalar (the block form is a weighted table)

  // Politics
  { key: "unlocking_laws", kinds: ["law"], form: "list" }, // 64
  { key: "ideology", kinds: ["ideology"] }, // 2051
  { key: "ideologies", kinds: ["ideology"], form: "list" }, // 26
  { key: "character_ideologies", kinds: ["ideology"], form: "list" }, // 123
  { key: "institution", kinds: ["institution"] }, // 218
  { key: "pop_type", kinds: ["pop_type"] }, // 1097
  // `group = X` is a journal entry group on journal entries and a law group on
  // laws; both kinds ride the reference so either can resolve. 596 sites.
  { key: "group", kinds: ["journal_entry_group", "law_group"] },

  // Characters
  { key: "add_trait", kinds: ["character_trait"] }, // 237
  { key: "remove_trait", kinds: ["character_trait"] }, // 48
  { key: "has_trait", kinds: ["character_trait"] }, // 1014
  { key: "traits", kinds: ["character_trait"], form: "list" }, // 4493

  // Modifiers & misc
  { key: "add_modifier", kinds: ["static_modifier"] }, // 83
  { key: "remove_modifier", kinds: ["static_modifier"] }, // 477
  { key: "has_modifier", kinds: ["static_modifier"] }, // 1259
  { key: "war_goal", kinds: ["war_goal_type"] }, // 52
  { key: "subject_type", kinds: ["subject_type"] }, // 9
];

/**
 * Scalar-value prefixes that reference definitions (`cu:czech` → culture).
 * These are Vic3's dominant cross-reference idiom; counts are vanilla
 * occurrences of `<prefix>:<name>` across common/ + events/. Prefixes whose
 * target folder is not in the table above (`s:` state regions, `unit_type:`,
 * `ship_type:`, `amendment_type:`, `mobilization_option:`, `rank_value:`) are
 * left out — an unresolvable reference is worse than none.
 */
export const VIC3_PREFIX_REFS: Record<string, string[]> = {
  c: ["country_definition"], // 23543
  cu: ["culture"], // 12766
  law_type: ["law"], // 9009
  rel: ["religion"], // 5141
  ideology: ["ideology"], // 4111
  ig: ["interest_group"], // 2356
  sr: ["strategic_region"], // 1474
  g: ["good"], // 654
  je: ["journal_entry"], // 613
  ig_trait: ["interest_group_trait"], // 201
  modifier: ["modifier_type"], // 178
  identity: ["power_bloc_identity"], // 158
  company_type: ["company_type"], // 144
  mg: ["good"], // 105 — market goods, keyed by the goods name
  py: ["party"], // 91
  active_law: ["law_group"], // 77 — `active_law:lawgroup_x.type…`
  movement_type: ["political_movement"], // 59
  sg: ["good"], // 59 — state goods, keyed by the goods name
  bt: ["building"], // 55
  principle_group: ["power_bloc_principle_group"], // 32
  institution: ["institution"], // 31
  bg: ["building_group"], // 28
  principle: ["power_bloc_principle"], // 17
  pop_type: ["pop_type"], // 16
  lobby_type: ["political_lobby"], // 8
};

/**
 * Keys too generic for a global ref field, resolved by their enclosing block:
 * `id` means an event only inside `trigger_event = { … }`, and `template` names
 * a character template only inside `create_character = { … }` (elsewhere it is
 * an ethnicity or coat-of-arms template).
 */
export const VIC3_BLOCK_REF_FIELDS: Record<string, Record<string, string[]>> = {
  trigger_event: { id: ["event"] },
  create_character: { template: ["character_template"] },
  ...JOMINI_VARIABLE_BLOCK_REFS,
};
