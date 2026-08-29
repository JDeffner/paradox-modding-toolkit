/**
 * The Victoria 3 schema table.
 *
 * Every entry was verified folder-by-folder against a real Victoria 3 install
 * (F:\SteamLibrary\...\Victoria 3\game, `common/` with 135 subfolders plus a
 * loose achievement_groups.txt, 2026-08-01 and re-swept 2026-08-15): the folder
 * was listed, at least one file opened, and the top-level key confirmed to be
 * the name script actually references. Folders whose on-disk layout fits none
 * of the extraction modes (see schema/types.ts) are left out rather than
 * indexed with wrong names, see the trailing "Not covered" block. All 135
 * subfolders are accounted for: 125 in the table, 10 in that block.
 *
 * The community CWT config (cwtools-vic3-config) was used as a *checklist*
 * only; where it disagreed with the install, the install won (the disagreements
 * are noted below).
 *
 * requiredLoc: every claim below was MEASURED against vanilla
 * localization/english (101 467 keys), the folder's definition names were
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
  // as in CK3, measured 0%).
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
  // $ 100% (419/419), $_reason 100% (419/419), `_reason` is the journal
  // entry's goal tooltip and the CWT config marks it required too.
  {
    path: "common/journal_entries",
    kind: "journal_entry",
    rootScopes: ["country"],
    requiredLoc: ["$", "$_reason"],
  },
  // $ 96.3% (26/27).
  { path: "common/journal_entry_groups", kind: "journal_entry_group", requiredLoc: ["$"] },

  // --- Objectives (the 1.6 "play objective" system) ---
  // Plain `name = { … }` folders, re-verified 2026-08-15. `objectives` names the
  // playthrough goal, `objective_subgoals` the individual tasks it lists in
  // `objective_subgoals = { … }`, and the categories group those. No
  // requiredLoc claimed anywhere in the 2026-08-15 sweep: the hit rates were
  // not measured, and an unmeasured claim would fire bogus missing-loc hints.
  { path: "common/objectives", kind: "objective" },
  { path: "common/objective_subgoals", kind: "objective_subgoal" },
  { path: "common/objective_subgoal_categories", kind: "objective_subgoal_category" },

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
  // Weighted naming tables for procedurally named companies, keyed by name.
  { path: "common/dynamic_company_names", kind: "dynamic_company_name" },
  // Droughts, floods, locust swarms… referenced by `incompatible_with = flood`
  // and by harvest-condition effects.
  { path: "common/harvest_condition_types", kind: "harvest_condition_type" },

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
  // $ 100% (3/3), only three vanilla definitions, so a weak sample.
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
  // The five discrimination tiers a pop can sit in (`violent_hostility` …
  // `full_acceptance`); each is a `name = { threshold = … }` block.
  { path: "common/acceptance_statuses", kind: "acceptance_status" },

  // --- Portraits & culture graphics ---
  // Re-checked 2026-08-15: unlike CK3's equivalents these three ARE plain
  // named-definition folders, not `@macro`/texture-path config.
  // `graphics = european` on a culture picks a culture_graphics entry (330
  // vanilla `graphics =` sites).
  { path: "common/culture_graphics", kind: "culture_graphics" },
  // 36 named ethnicities (plus `ethnicity_template`, referenced by the others
  // through `template = …`). Cultures pick them through a WEIGHTED block
  // (`ethnicity = { 10 = arab }`), so no scalar ref field resolves them.
  { path: "common/ethnicities", kind: "ethnicity" },
  // 583 one-off historical portraits, one `dna_<name> = { portrait_info = … }`
  // per file; `dna = dna_x` has 589 vanilla sites. Indexed for navigation only:
  // 6.2 MB / 584 files is the largest single folder in common/, and the names
  // are historical one-offs, so they stay out of completion.
  { path: "common/dna_data", kind: "dna", completable: false },

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
  // Named support sources a movement draws on (`movement_support_high_literacy
  // = { name = … }`); the folder's own header comment declares root =
  // political_movement, but the CWT config has no matching type, so no
  // rootScopes claim.
  { path: "common/political_movement_pop_support", kind: "political_movement_pop_support" },
  // Named appeasement events a lobby reacts to (`appeasement_alliance_formed`).
  { path: "common/political_lobby_appeasement", kind: "political_lobby_appeasement" },
  // Constitutional amendments; each names its `parent` law and allowed_laws.
  { path: "common/amendments", kind: "amendment" },
  // Threshold tiers (`legitimacy_level_contested = { threshold = … }`).
  { path: "common/legitimacy_levels", kind: "legitimacy_level" },
  // $ 100% (4/4), four vanilla definitions, weak sample but unambiguous.
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
  // Ranks a country can hold (`great_power = { rank_value = 7 … }`).
  { path: "common/country_ranks", kind: "country_rank" },
  // Cooldown/relevance categories a diplomatic catalyst declares via
  // `category = cc_relations_change`.
  { path: "common/diplomatic_catalyst_categories", kind: "diplomatic_catalyst_category" },
  // Subject liberty-desire tiers (`ld_level_low = { threshold = … }`).
  { path: "common/liberty_desire_levels", kind: "liberty_desire_level" },
  // The popup/notification shapes a proposal uses (`proposal_treaty = { … }`).
  { path: "common/proposal_types", kind: "proposal_type" },
  // Weighted naming tables for generated treaty names, keyed by name.
  { path: "common/dynamic_treaty_names", kind: "dynamic_treaty_name" },

  // --- Power blocs ---
  // Principles display their GROUP's name, so `$` is 0% while $_desc is
  // 100% (69/69), measured, not assumed.
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
  // Cohesion tiers (`cohesion_level_high = { threshold = … }`).
  { path: "common/cohesion_levels", kind: "cohesion_level" },
  // Sphere-of-influence interest tiers (`interest_tier_engaged = { rank = … }`).
  { path: "common/interest_tier_types", kind: "interest_tier_type" },
  // Named map patterns a bloc paints with (`pb_pattern_01 = { texture = … }`).
  { path: "common/power_bloc_map_textures", kind: "power_bloc_map_texture" },

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
  // Re-checked 2026-08-15: the three map folders below are NOT texture-path
  // config, each is a plain `name = { … }` folder whose keys script uses.
  // 25 terrain types (`plains`, `mountain`…), the value of `has_terrain = x`.
  { path: "common/terrain", kind: "terrain" },
  // Terrain conversion rules, each naming its `created_terrain`.
  { path: "common/terrain_manipulators", kind: "terrain_manipulator" },
  // Named canals and straits (`canal_suez = { type = artificial … }`).
  { path: "common/strait_definitions", kind: "strait_definition" },
  // Terrain/travel labels a state or province carries (`label_forested`).
  { path: "common/labels", kind: "label" },
  // Alternative country map colours chosen by trigger, keyed by name.
  { path: "common/dynamic_country_map_colors", kind: "dynamic_country_map_color" },
  // Map click behaviours (`build_building = { mapmode = … }`).
  { path: "common/map_interaction_types", kind: "map_interaction_type" },
  // On-map notification widgets. The file also holds one `@three_dee_map_zoom`
  // macro, which the extractor drops (names must start with a word character).
  { path: "common/map_notification_types", kind: "map_notification_type" },

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
  // are second-level and are NOT extractable with the current modes, the same
  // situation as CK3's common/laws. rule_$ 100% (15/15) confirms the top-level
  // key is the category (the settings use `setting_$`).
  { path: "common/game_rules", kind: "game_rule_category", requiredLoc: ["rule_$"] },

  // --- Military ---
  // Plain top-level-key folders, each re-checked against the install for 0.3.4
  // because the mod corpus edits them (they were skipped in 0.3.0 as
  // low-traffic). No requiredLoc claimed: the hit rates were never measured.
  { path: "common/combat_unit_types", kind: "combat_unit_type" },
  { path: "common/mobilization_options", kind: "mobilization_option" },
  { path: "common/mobilization_option_groups", kind: "mobilization_option_group" },
  { path: "common/ship_types", kind: "ship_type" },
  { path: "common/ship_modifications", kind: "ship_modification" },
  { path: "common/ship_modification_slots", kind: "ship_modification_slot" },
  // Named fleet-naming tables (`ship_names_historical_brazilian_capital_ships`),
  // not the ship names themselves.
  { path: "common/ship_name_definitions", kind: "ship_name_definition" },
  // Added 2026-08-15, same plain `name = { … }` shape as the rows above.
  // Land and naval battle modifiers (`battle_condition_mud = { modifier = … }`).
  { path: "common/battle_conditions", kind: "battle_condition" },
  { path: "common/naval_battle_conditions", kind: "naval_battle_condition" },
  // `combat_unit_group_infantry` etc.; combat unit types name their group.
  { path: "common/combat_unit_groups", kind: "combat_unit_group" },
  { path: "common/combat_unit_experience_levels", kind: "combat_unit_experience_level" },
  { path: "common/ship_groups", kind: "ship_group" },
  { path: "common/ship_veterancy_levels", kind: "ship_veterancy_level" },
  // Commander order buttons (`advance`, `defend_dig_in`).
  { path: "common/commander_orders", kind: "commander_order" },
  { path: "common/commander_ranks", kind: "commander_rank" },
  // Naval mission buttons (`naval_mission_type_blockade`).
  { path: "common/naval_mission_types", kind: "naval_mission_type" },
  // Formation banner icons (`army_01 = { icon = … type = army }`).
  { path: "common/military_formation_flags", kind: "military_formation_flag" },

  // --- AI, economy & tooling ---
  { path: "common/ai_strategies", kind: "ai_strategy" },
  { path: "common/buy_packages", kind: "buy_package" },
  { path: "common/console_command_macros", kind: "console_command_macro" },
  // AI stance towards a strategic region (`stance_conquer_region = { … }`).
  { path: "common/ai_strategic_region_stance_types", kind: "ai_strategic_region_stance_type" },

  // --- Alerts, notifications & UI shells ---
  // Added 2026-08-15. These are the named definitions gui/ and code look up;
  // all four are plain `name = { … }` folders.
  { path: "common/alert_types", kind: "alert_type" },
  // `isolated_states = {}` … empty bodies, but the name is what alert_types
  // and the GUI reference.
  { path: "common/alert_groups", kind: "alert_group" },
  // 469 notification definitions, the `post_notification = x` targets.
  { path: "common/messages", kind: "message" },
  // UI/papermap skins (`gui_skin_base = { category = ui_skin_theme … }`).
  { path: "common/themes", kind: "theme" },

  // --- Achievements & tutorial ---
  // Added 2026-08-15, plain `name = { possible = … happened = … }` folders.
  // (common/achievement_groups.txt is a LOOSE FILE in common/, not a folder,
  // so the folder-keyed table cannot reach it, see "Not covered".)
  { path: "common/achievements", kind: "achievement" },
  // Top-level keys are lesson names; the `lesson_x_1 = { … }` steps nest one
  // level down and are correctly not extracted.
  { path: "common/tutorial_lessons", kind: "tutorial_lesson" },
  // Only 3 of the 9 top-level keys are chains; the other 6 are `@timer` macros
  // the extractor drops.
  { path: "common/tutorial_lesson_chains", kind: "tutorial_lesson_chain" },

  // --- GUI ---
  { path: "gui", kind: "gui_type", ext: ".gui", extraction: "gui-type" },
];

// Not covered. Re-swept folder by folder on 2026-08-15: the previous
// "deliberate low-traffic skip" list is GONE, every folder on it has a plain
// `name = { … }` layout, so all 46 moved into the table above. What stays out
// stays out because the extraction would produce wrong names, not because the
// folder is quiet.
//  - Individual game rule settings: second-level keys under common/game_rules
//    (only the category is indexed, see above).
//  - common/history/*: 22 subfolders. Corrected 2026-08-15, the top-level key
//    is NOT a date or a tag but a single SHOUTY section marker per file
//    (`COUNTRIES = { c:ABS ?= { … } }`, `STATES`, `POPS`, `AI`…), repeated in
//    every file of the folder. Indexing it would yield one bogus "definition"
//    named COUNTRIES per file; the real identities are the scoped tags inside.
//  - common/coat_of_arms/*: `coat_of_arms/` keys are country TAGS plus `@macro`
//    soup (see the tag rule below), `options/` has one `atlas` key per file and
//    `template_lists/` five list containers (`color_lists` …).
//  - common/power_bloc_coa_pieces: top-level keys are .dds FILENAMES
//    (`pb_center_00.dds`), not identifiers.
//  - common/named_colors: every file's single top-level key is `colors`.
//  - common/defines: top-level keys are the NDefines GROUPS (`NGame`,
//    `NMilitary`); the settings script reads are second-level.
//  - common/genes: top-level keys are the four gene CONTAINERS (`color_genes`,
//    `special_genes`…); gene names sit two to three levels down.
//  - Country-TAG folders, common/country_creation (394 keys),
//    common/country_formation (74), common/dynamic_country_names (147) and
//    common/flag_definitions (446, mostly `@macro`): all fit the mode, but
//    their top-level keys are country tags that collide with
//    country_definitions. Four "definitions" per tag would make navigation
//    worse, not better. Revisit if a tag-aware mode lands.
//  - common/achievement_groups.txt: a loose FILE directly in common/, not a
//    folder. The table is keyed by folder, so no entry can name it; it would
//    need a file-level schema path.
//  - gfx/: unlike CK3 no gfx/ subfolder holds script-referenced names,
//    gfx/portraits, gfx/map/* etc. are pure art config. gui/ IS indexed (the
//    gui_type row): `type`/`template` names are what .gui files reference.
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
  { key: "random_events", kinds: ["event"], form: "list", weighted: true },
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
 * occurrences of `<prefix>:<name>` across common/ + events/.
 *
 * Re-measured 2026-08-15 by sweeping EVERY `<lowercase_prefix>:<name>` in
 * vanilla instead of checking a hand-written list, then resolving each name
 * against the real folder. The rule is now mechanical: a prefix is wired iff
 * its target kind is in the schema table AND 100% of its vanilla names resolve
 * to a definition of that kind. Twelve prefixes newly qualified (the three the
 * 0.3.1 note flagged as unmeasured, plus four unlocked by the folders added
 * this sweep and five that were simply never found); each carries its measured
 * "occurrences, distinct names" below.
 *
 * Still out, because no folder produces their names: `s:` (state regions live
 * in map_data/, not common/), `region_state:`, `p:` (province colours),
 * `define:` (common/defines is not indexed), and the engine enums
 * `relations_threshold:`, `infamy_threshold:`, `get_ruler_for:`. `scope:`,
 * `var:`, `global_var:` and `local_var:` are the variables layer
 * (games/jomini/variables.ts), not definition references.
 */
export const VIC3_PREFIX_REFS: Record<string, string[]> = {
  c: ["country_definition"], // 23543
  cu: ["culture"], // 12766
  law_type: ["law"], // 9009
  rel: ["religion"], // 5141
  ideology: ["ideology"], // 4111
  ig: ["interest_group"], // 2356
  sr: ["strategic_region"], // 1474
  unit_type: ["combat_unit_type"], // NEW 903, 18/18 resolve
  g: ["good"], // 654
  je: ["journal_entry"], // 613
  rank_value: ["country_rank"], // NEW 577, 7/7, needed common/country_ranks
  ig_trait: ["interest_group_trait"], // 201
  modifier: ["modifier_type"], // 178
  identity: ["power_bloc_identity"], // 158
  company_type: ["company_type"], // 144
  ship_type: ["ship_type"], // NEW 121, 10/10 resolve
  mg: ["good"], // 105, market goods, keyed by the goods name
  amendment_type: ["amendment"], // NEW 94, 60/60, needed common/amendments
  py: ["party"], // 91
  active_law: ["law_group"], // 77, `active_law:lawgroup_x.type…`
  movement_type: ["political_movement"], // 59
  sg: ["good"], // 59, state goods, keyed by the goods name
  bt: ["building"], // 55
  mobilization_option: ["mobilization_option"], // NEW 38, 10/10 resolve
  principle_group: ["power_bloc_principle_group"], // 32
  institution: ["institution"], // 31
  b: ["building"], // NEW 29, 14/14, the in-state building scope, `b:building_x`
  bg: ["building_group"], // 28
  principle: ["power_bloc_principle"], // 17
  pop_type: ["pop_type"], // 16
  cd: ["country_definition"], // NEW 16, 4/4, `country_definition = cd:LIP`
  company: ["company_type"], // NEW 13, 7/7, the company instance, keyed by type
  lobby_type: ["political_lobby"], // 8
  play_type: ["diplomatic_play"], // NEW 7, 5/5 resolve
  strait_type: ["strait_definition"], // NEW 6, 3/3, needed common/strait_definitions
  i: ["ideology"], // NEW 4, 3/3, short form of `ideology:`
  ship_group: ["ship_group"], // NEW 2, 1/1, needed common/ship_groups
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
