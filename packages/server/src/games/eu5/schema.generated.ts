/**
 * GENERATED FILE, do not edit by hand. Europa Universalis V schema table,
 * imported from the community CWT rules for CWTools.
 *
 *   upstream:     https://github.com/kaiser-chris/cwtools-eu5-config
 *   commit:       7f2764a9536951dc9915c0b05509d0499408381a
 *   game version: EU5 1.3.4-beta
 *   imported:     2026-08-01
 *   license:      MIT, (c) 2025 Chris Kaiser (see THIRD-PARTY-NOTICES.md)
 *
 * Regenerate:
 *   npx esbuild scripts/import-cwt-types.ts --bundle --platform=node \
 *     --outfile=dist/import-cwt-types.cjs && node dist/import-cwt-types.cjs <clone>
 *
 * 518 entries across 131 kinds. EU5 loads content from a flat root plus
 * three load-stage roots (in_game/, main_menu/, loading_screen/); the CWT
 * config declares all four for nearly every type, so each becomes its own
 * entry. Nothing here has been verified against a live install; the table
 * is only as right as the upstream rules are.
 *
 * Path conflicts resolved at import time (two CWT types claiming one folder):
 *   - common/script_values: script_value vs static_value -> kept script_value
 *   - in_game/common/script_values: script_value vs static_value -> kept script_value
 *   - main_menu/common/script_values: script_value vs static_value -> kept script_value
 *   - loading_screen/common/script_values: script_value vs static_value -> kept script_value
 */
import type { SchemaEntry } from "../../schema/types";

export const EU5_SCHEMA: SchemaEntry[] = [
  // --- Flat root (content loaded in every stage) ---
  // requiredLoc: ["ACHIEVEMENT_$", "ACHIEVEMENT_DESC_$"] (CWT localisation block, unverified against vanilla)
  { path: "common/achievements", kind: "achievement" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/advances", kind: "advance" },
  // requiredLoc: ["$", "$_desc", "age_format_$"] (CWT localisation block, unverified against vanilla)
  { path: "common/age", kind: "age" },
  { path: "common/ai_diplochance", kind: "ai_diplochance" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/ai_personalities", kind: "ai_personality" },
  // requiredLoc: ["title"] (CWT localisation block, unverified against vanilla)
  { path: "common/alert_descriptions", kind: "alert_description" },
  { path: "common/area_preferences", kind: "area_preference" },
  // requiredLoc: ["ARTIST_TYPE_NAME_$", "ARTIST_TYPE_DESC_$"] (CWT localisation block, unverified against vanilla)
  { path: "common/artist_types", kind: "artist_type" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/artist_work", kind: "artist_work" },
  // requiredLoc: ["AUTO_MODIFIER_NAME_$"] (CWT localisation block, unverified against vanilla)
  { path: "common/auto_modifiers", kind: "auto_modifier" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/avatars", kind: "avatar" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/biases", kind: "bias" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/building_categories", kind: "building_category" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/building_types", kind: "building_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/bureaucracies", kind: "bureaucracy" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/cabinet_actions", kind: "cabinet_action" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/casus_belli", kind: "casus_belli" },
  // requiredLoc: ["$", "$_concept", "$_act", "$_desc_specific", "$_desc", "$_past", "$_act_past"] (CWT localisation block, unverified against vanilla)
  { path: "common/character_interactions", kind: "character_interaction" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/child_educations", kind: "child_education" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/chivalric_orders", kind: "chivalric_order" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/climates", kind: "climate" },
  { path: "common/coat_of_arms/coat_of_arms", kind: "coat_of_arm" },
  // requiredLoc: ["country_description_category_name_$", "country_description_category_desc_$"] (CWT localisation block, unverified against vanilla)
  { path: "common/country_description_categories", kind: "country_description_category" },
  // requiredLoc: ["$", "$_desc", "$_act", "$_effect_text", "$_effect_text_past"] (CWT localisation block, unverified against vanilla)
  { path: "common/country_interactions", kind: "country_interaction" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/country_ranks", kind: "country_rank" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/culture_groups", kind: "culture_group" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/cultures", kind: "culture" },
  { path: "common/customizable_localization", kind: "customizable_localization" },
  // requiredLoc: ["DEATH_REASON_$"] (CWT localisation block, unverified against vanilla)
  { path: "common/death_reason", kind: "death_reason" },
  // requiredLoc: ["HEIR_REASON_$"] (CWT localisation block, unverified against vanilla)
  { path: "common/designated_heir_reason", kind: "designated_heir_reason" },
  { path: "common/diplomatic_costs", kind: "diplomatic_cost" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/disasters", kind: "disaster" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/diseases", kind: "disease" },
  { path: "common/effect_localization", kind: "effect_localization" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/employment_systems", kind: "employment_system" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/estate_privileges", kind: "estate_privilege" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/estates", kind: "estate" },
  { path: "common/ethnicities", kind: "ethnicity" },
  { path: "common/flag_definitions", kind: "flag_definition" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/formable_countries", kind: "formable_country" },
  // requiredLoc: ["game_concept_$"] (CWT localisation block, unverified against vanilla)
  { path: "common/game_concepts", kind: "game_concept" },
  // requiredLoc: ["rule_$"] (CWT localisation block, unverified against vanilla)
  { path: "common/game_rules", kind: "game_rule_category" },
  { path: "common/generic_action_ai_lists", kind: "generic_action_ai_list" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/generic_actions", kind: "generic_action" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/gods", kind: "god" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/goods", kind: "good" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/goods_demand", kind: "goods_demand" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/goods_demand_category", kind: "goods_demand_category" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/government_reforms", kind: "government_reform" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/government_types", kind: "government_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/hegemons", kind: "hegemon" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/heir_selections", kind: "heir_selection" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/historical_scores", kind: "historical_score" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/holy_site_types", kind: "holy_site_type" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/holy_sites", kind: "holy_site" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/institution", kind: "institution" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/insults", kind: "insult" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  {
    path: "common/international_organization_land_ownership_rules",
    kind: "international_organization_land_ownership_rule",
  },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/international_organization_payments", kind: "international_organization_payment" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  {
    path: "common/international_organization_special_statuses",
    kind: "international_organization_special_status",
  },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/international_organizations", kind: "international_organization" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/join_war_rules", kind: "join_war_rule" },
  { path: "common/language_families", kind: "language_family" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/languages", kind: "language" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/laws", kind: "law" },
  { path: "common/levies", kind: "levy" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/location_ranks", kind: "location_rank" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/missions", kind: "mission" },
  { path: "common/modifier_icons", kind: "modifier_icon" },
  // requiredLoc: ["MODIFIER_TYPE_NAME_$", "MODIFIER_TYPE_DESC_$"] (CWT localisation block, unverified against vanilla)
  { path: "common/modifier_type_definitions", kind: "modifier_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/movements", kind: "movement" },
  // requiredLoc: ["$", "$_flavour"] (CWT localisation block, unverified against vanilla)
  { path: "common/music_player_tracks", kind: "music_player_track" },
  { path: "common/on_action", kind: "on_action" },
  // requiredLoc: ["$", "$_desc", "$_simple"] (CWT localisation block, unverified against vanilla)
  { path: "common/parliament_agendas", kind: "parliament_agenda" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/parliament_issues", kind: "parliament_issue" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/parliament_types", kind: "parliament_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/peace_treaties", kind: "peace_treaty" },
  { path: "common/persistent_dna", kind: "persistent_dna" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/pop_types", kind: "pop_type" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/prices", kind: "price" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/production_methods", kind: "production_method" },
  { path: "common/rebel_demands", kind: "rebel_demand" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/recruitment_method", kind: "recruitment_method" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/regencies", kind: "regency" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/religion_groups", kind: "religion_group" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/religions", kind: "religion" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/religious_aspects", kind: "religious_aspect" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/religious_factions", kind: "religious_faction" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/religious_figures", kind: "religious_figure" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/religious_focuses", kind: "religious_focus" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/religious_schools", kind: "religious_school" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/resolutions", kind: "resolution" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/rival_criteria", kind: "rival_criteria" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/road_types", kind: "road_type" },
  { path: "common/scenarios", kind: "scenario" },
  { path: "common/script_values", kind: "script_value" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/scriptable_hints", kind: "scriptable_hint" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/scripted_country_names", kind: "scripted_country_name" },
  { path: "common/scripted_diplomatic_objectives", kind: "scripted_diplomatic_objective" },
  { path: "common/scripted_effects", kind: "scripted_effect" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/scripted_geography", kind: "scripted_geography" },
  { path: "common/scripted_guis", kind: "scripted_gui" },
  { path: "common/scripted_lists", kind: "scripted_list" },
  // requiredLoc: ["$_relation", "$_relation_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/scripted_relations", kind: "scripted_relation" },
  { path: "common/scripted_triggers", kind: "scripted_trigger" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/situations", kind: "situation" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/societal_values", kind: "societal_value" },
  // requiredLoc: ["STATIC_MODIFIER_NAME_$"] (CWT localisation block, unverified against vanilla)
  { path: "common/static_modifiers", kind: "static_modifier" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/subject_military_stances", kind: "subject_military_stance" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/subject_types", kind: "subject_type" },
  { path: "common/tests", kind: "test" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/topography", kind: "topography" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/town_rights", kind: "town_right" },
  { path: "common/town_setups", kind: "town_setup" },
  { path: "common/trait_flavor", kind: "trait_flavor" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/traits", kind: "trait" },
  { path: "common/trigger_localization", kind: "trigger_localization" },
  { path: "common/tutorial_lesson_chains", kind: "tutorial_lesson_chain" },
  { path: "common/tutorial_lessons", kind: "tutorial_lesson" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/unit_abilities", kind: "unit_ability" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/unit_categories", kind: "unit_category" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "common/unit_formation_preference", kind: "unit_formation_preference" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/unit_types", kind: "unit_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "common/vegetation", kind: "vegetation" },
  // requiredLoc: ["war_goal_$"] (CWT localisation block, unverified against vanilla)
  { path: "common/wargoals", kind: "war_goal" },
  // requiredLoc: ["title", "desc"] (CWT localisation block, unverified against vanilla)
  { path: "events", kind: "event", extraction: "event-id" },
  // requiredLoc: ["mapmode_$_name", "mapmode_$"] (CWT localisation block, unverified against vanilla)
  { path: "gfx/map/map_modes", kind: "map_mode" },
  { path: "gfx/portraits/accessories", kind: "portrait_accessory" },
  { path: "gfx/portraits/portrait_modifiers", kind: "portrait_modifier" },
  { path: "localization", kind: "loc_key", ext: ".yml", extraction: "loc-key" },
  // requiredLoc: ["$", "$_ADJ"] (CWT localisation block, unverified against vanilla)
  { path: "setup/countries", kind: "country" },

  // --- in_game/ (gameplay stage) ---
  // requiredLoc: ["ACHIEVEMENT_$", "ACHIEVEMENT_DESC_$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/achievements", kind: "achievement" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/advances", kind: "advance" },
  // requiredLoc: ["$", "$_desc", "age_format_$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/age", kind: "age" },
  { path: "in_game/common/ai_diplochance", kind: "ai_diplochance" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/ai_personalities", kind: "ai_personality" },
  // requiredLoc: ["title"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/alert_descriptions", kind: "alert_description" },
  { path: "in_game/common/area_preferences", kind: "area_preference" },
  // requiredLoc: ["ARTIST_TYPE_NAME_$", "ARTIST_TYPE_DESC_$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/artist_types", kind: "artist_type" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/artist_work", kind: "artist_work" },
  // requiredLoc: ["AUTO_MODIFIER_NAME_$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/auto_modifiers", kind: "auto_modifier" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/avatars", kind: "avatar" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/biases", kind: "bias" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/building_categories", kind: "building_category" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/building_types", kind: "building_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/bureaucracies", kind: "bureaucracy" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/cabinet_actions", kind: "cabinet_action" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/casus_belli", kind: "casus_belli" },
  // requiredLoc: ["$", "$_concept", "$_act", "$_desc_specific", "$_desc", "$_past", "$_act_past"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/character_interactions", kind: "character_interaction" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/child_educations", kind: "child_education" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/chivalric_orders", kind: "chivalric_order" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/climates", kind: "climate" },
  { path: "in_game/common/coat_of_arms/coat_of_arms", kind: "coat_of_arm" },
  // requiredLoc: ["country_description_category_name_$", "country_description_category_desc_$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/country_description_categories", kind: "country_description_category" },
  // requiredLoc: ["$", "$_desc", "$_act", "$_effect_text", "$_effect_text_past"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/country_interactions", kind: "country_interaction" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/country_ranks", kind: "country_rank" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/culture_groups", kind: "culture_group" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/cultures", kind: "culture" },
  { path: "in_game/common/customizable_localization", kind: "customizable_localization" },
  // requiredLoc: ["DEATH_REASON_$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/death_reason", kind: "death_reason" },
  // requiredLoc: ["HEIR_REASON_$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/designated_heir_reason", kind: "designated_heir_reason" },
  { path: "in_game/common/diplomatic_costs", kind: "diplomatic_cost" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/disasters", kind: "disaster" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/diseases", kind: "disease" },
  { path: "in_game/common/effect_localization", kind: "effect_localization" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/employment_systems", kind: "employment_system" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/estate_privileges", kind: "estate_privilege" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/estates", kind: "estate" },
  { path: "in_game/common/ethnicities", kind: "ethnicity" },
  { path: "in_game/common/flag_definitions", kind: "flag_definition" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/formable_countries", kind: "formable_country" },
  // requiredLoc: ["game_concept_$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/game_concepts", kind: "game_concept" },
  // requiredLoc: ["rule_$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/game_rules", kind: "game_rule_category" },
  { path: "in_game/common/generic_action_ai_lists", kind: "generic_action_ai_list" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/generic_actions", kind: "generic_action" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/gods", kind: "god" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/goods", kind: "good" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/goods_demand", kind: "goods_demand" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/goods_demand_category", kind: "goods_demand_category" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/government_reforms", kind: "government_reform" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/government_types", kind: "government_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/hegemons", kind: "hegemon" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/heir_selections", kind: "heir_selection" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/historical_scores", kind: "historical_score" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/holy_site_types", kind: "holy_site_type" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/holy_sites", kind: "holy_site" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/institution", kind: "institution" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/insults", kind: "insult" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  {
    path: "in_game/common/international_organization_land_ownership_rules",
    kind: "international_organization_land_ownership_rule",
  },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/international_organization_payments", kind: "international_organization_payment" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  {
    path: "in_game/common/international_organization_special_statuses",
    kind: "international_organization_special_status",
  },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/international_organizations", kind: "international_organization" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/join_war_rules", kind: "join_war_rule" },
  { path: "in_game/common/language_families", kind: "language_family" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/languages", kind: "language" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/laws", kind: "law" },
  { path: "in_game/common/levies", kind: "levy" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/location_ranks", kind: "location_rank" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/missions", kind: "mission" },
  { path: "in_game/common/modifier_icons", kind: "modifier_icon" },
  // requiredLoc: ["MODIFIER_TYPE_NAME_$", "MODIFIER_TYPE_DESC_$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/modifier_type_definitions", kind: "modifier_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/movements", kind: "movement" },
  // requiredLoc: ["$", "$_flavour"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/music_player_tracks", kind: "music_player_track" },
  { path: "in_game/common/on_action", kind: "on_action" },
  // requiredLoc: ["$", "$_desc", "$_simple"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/parliament_agendas", kind: "parliament_agenda" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/parliament_issues", kind: "parliament_issue" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/parliament_types", kind: "parliament_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/peace_treaties", kind: "peace_treaty" },
  { path: "in_game/common/persistent_dna", kind: "persistent_dna" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/pop_types", kind: "pop_type" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/prices", kind: "price" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/production_methods", kind: "production_method" },
  { path: "in_game/common/rebel_demands", kind: "rebel_demand" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/recruitment_method", kind: "recruitment_method" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/regencies", kind: "regency" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/religion_groups", kind: "religion_group" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/religions", kind: "religion" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/religious_aspects", kind: "religious_aspect" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/religious_factions", kind: "religious_faction" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/religious_figures", kind: "religious_figure" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/religious_focuses", kind: "religious_focus" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/religious_schools", kind: "religious_school" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/resolutions", kind: "resolution" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/rival_criteria", kind: "rival_criteria" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/road_types", kind: "road_type" },
  { path: "in_game/common/scenarios", kind: "scenario" },
  { path: "in_game/common/script_values", kind: "script_value" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/scriptable_hints", kind: "scriptable_hint" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/scripted_country_names", kind: "scripted_country_name" },
  { path: "in_game/common/scripted_diplomatic_objectives", kind: "scripted_diplomatic_objective" },
  { path: "in_game/common/scripted_effects", kind: "scripted_effect" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/scripted_geography", kind: "scripted_geography" },
  { path: "in_game/common/scripted_guis", kind: "scripted_gui" },
  { path: "in_game/common/scripted_lists", kind: "scripted_list" },
  // requiredLoc: ["$_relation", "$_relation_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/scripted_relations", kind: "scripted_relation" },
  { path: "in_game/common/scripted_triggers", kind: "scripted_trigger" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/situations", kind: "situation" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/societal_values", kind: "societal_value" },
  // requiredLoc: ["STATIC_MODIFIER_NAME_$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/static_modifiers", kind: "static_modifier" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/subject_military_stances", kind: "subject_military_stance" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/subject_types", kind: "subject_type" },
  { path: "in_game/common/tests", kind: "test" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/topography", kind: "topography" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/town_rights", kind: "town_right" },
  { path: "in_game/common/town_setups", kind: "town_setup" },
  { path: "in_game/common/trait_flavor", kind: "trait_flavor" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/traits", kind: "trait" },
  { path: "in_game/common/trigger_localization", kind: "trigger_localization" },
  { path: "in_game/common/tutorial_lesson_chains", kind: "tutorial_lesson_chain" },
  { path: "in_game/common/tutorial_lessons", kind: "tutorial_lesson" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/unit_abilities", kind: "unit_ability" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/unit_categories", kind: "unit_category" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/unit_formation_preference", kind: "unit_formation_preference" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/unit_types", kind: "unit_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/vegetation", kind: "vegetation" },
  // requiredLoc: ["war_goal_$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/common/wargoals", kind: "war_goal" },
  // requiredLoc: ["title", "desc"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/events", kind: "event", extraction: "event-id" },
  { path: "in_game/localization", kind: "loc_key", ext: ".yml", extraction: "loc-key" },
  // requiredLoc: ["mapmode_$_name", "mapmode_$"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/map/map_modes", kind: "map_mode" },
  // requiredLoc: ["$", "$_ADJ"] (CWT localisation block, unverified against vanilla)
  { path: "in_game/setup/countries", kind: "country" },

  // --- main_menu/ (main-menu stage) ---
  // requiredLoc: ["ACHIEVEMENT_$", "ACHIEVEMENT_DESC_$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/achievements", kind: "achievement" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/advances", kind: "advance" },
  // requiredLoc: ["$", "$_desc", "age_format_$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/age", kind: "age" },
  { path: "main_menu/common/ai_diplochance", kind: "ai_diplochance" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/ai_personalities", kind: "ai_personality" },
  // requiredLoc: ["title"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/alert_descriptions", kind: "alert_description" },
  { path: "main_menu/common/area_preferences", kind: "area_preference" },
  // requiredLoc: ["ARTIST_TYPE_NAME_$", "ARTIST_TYPE_DESC_$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/artist_types", kind: "artist_type" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/artist_work", kind: "artist_work" },
  // requiredLoc: ["AUTO_MODIFIER_NAME_$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/auto_modifiers", kind: "auto_modifier" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/avatars", kind: "avatar" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/biases", kind: "bias" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/building_categories", kind: "building_category" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/building_types", kind: "building_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/bureaucracies", kind: "bureaucracy" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/cabinet_actions", kind: "cabinet_action" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/casus_belli", kind: "casus_belli" },
  // requiredLoc: ["$", "$_concept", "$_act", "$_desc_specific", "$_desc", "$_past", "$_act_past"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/character_interactions", kind: "character_interaction" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/child_educations", kind: "child_education" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/chivalric_orders", kind: "chivalric_order" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/climates", kind: "climate" },
  { path: "main_menu/common/coat_of_arms/coat_of_arms", kind: "coat_of_arm" },
  // requiredLoc: ["country_description_category_name_$", "country_description_category_desc_$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/country_description_categories", kind: "country_description_category" },
  // requiredLoc: ["$", "$_desc", "$_act", "$_effect_text", "$_effect_text_past"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/country_interactions", kind: "country_interaction" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/country_ranks", kind: "country_rank" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/culture_groups", kind: "culture_group" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/cultures", kind: "culture" },
  { path: "main_menu/common/customizable_localization", kind: "customizable_localization" },
  // requiredLoc: ["DEATH_REASON_$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/death_reason", kind: "death_reason" },
  // requiredLoc: ["HEIR_REASON_$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/designated_heir_reason", kind: "designated_heir_reason" },
  { path: "main_menu/common/diplomatic_costs", kind: "diplomatic_cost" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/disasters", kind: "disaster" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/diseases", kind: "disease" },
  { path: "main_menu/common/effect_localization", kind: "effect_localization" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/employment_systems", kind: "employment_system" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/estate_privileges", kind: "estate_privilege" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/estates", kind: "estate" },
  { path: "main_menu/common/ethnicities", kind: "ethnicity" },
  { path: "main_menu/common/flag_definitions", kind: "flag_definition" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/formable_countries", kind: "formable_country" },
  // requiredLoc: ["game_concept_$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/game_concepts", kind: "game_concept" },
  // requiredLoc: ["rule_$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/game_rules", kind: "game_rule_category" },
  { path: "main_menu/common/generic_action_ai_lists", kind: "generic_action_ai_list" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/generic_actions", kind: "generic_action" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/gods", kind: "god" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/goods", kind: "good" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/goods_demand", kind: "goods_demand" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/goods_demand_category", kind: "goods_demand_category" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/government_reforms", kind: "government_reform" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/government_types", kind: "government_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/hegemons", kind: "hegemon" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/heir_selections", kind: "heir_selection" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/historical_scores", kind: "historical_score" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/holy_site_types", kind: "holy_site_type" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/holy_sites", kind: "holy_site" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/institution", kind: "institution" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/insults", kind: "insult" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  {
    path: "main_menu/common/international_organization_land_ownership_rules",
    kind: "international_organization_land_ownership_rule",
  },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  {
    path: "main_menu/common/international_organization_payments",
    kind: "international_organization_payment",
  },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  {
    path: "main_menu/common/international_organization_special_statuses",
    kind: "international_organization_special_status",
  },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/international_organizations", kind: "international_organization" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/join_war_rules", kind: "join_war_rule" },
  { path: "main_menu/common/language_families", kind: "language_family" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/languages", kind: "language" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/laws", kind: "law" },
  { path: "main_menu/common/levies", kind: "levy" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/location_ranks", kind: "location_rank" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/missions", kind: "mission" },
  { path: "main_menu/common/modifier_icons", kind: "modifier_icon" },
  // requiredLoc: ["MODIFIER_TYPE_NAME_$", "MODIFIER_TYPE_DESC_$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/modifier_type_definitions", kind: "modifier_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/movements", kind: "movement" },
  // requiredLoc: ["$", "$_flavour"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/music_player_tracks", kind: "music_player_track" },
  { path: "main_menu/common/on_action", kind: "on_action" },
  // requiredLoc: ["$", "$_desc", "$_simple"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/parliament_agendas", kind: "parliament_agenda" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/parliament_issues", kind: "parliament_issue" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/parliament_types", kind: "parliament_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/peace_treaties", kind: "peace_treaty" },
  { path: "main_menu/common/persistent_dna", kind: "persistent_dna" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/pop_types", kind: "pop_type" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/prices", kind: "price" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/production_methods", kind: "production_method" },
  { path: "main_menu/common/rebel_demands", kind: "rebel_demand" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/recruitment_method", kind: "recruitment_method" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/regencies", kind: "regency" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/religion_groups", kind: "religion_group" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/religions", kind: "religion" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/religious_aspects", kind: "religious_aspect" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/religious_factions", kind: "religious_faction" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/religious_figures", kind: "religious_figure" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/religious_focuses", kind: "religious_focus" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/religious_schools", kind: "religious_school" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/resolutions", kind: "resolution" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/rival_criteria", kind: "rival_criteria" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/road_types", kind: "road_type" },
  { path: "main_menu/common/scenarios", kind: "scenario" },
  { path: "main_menu/common/script_values", kind: "script_value" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/scriptable_hints", kind: "scriptable_hint" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/scripted_country_names", kind: "scripted_country_name" },
  { path: "main_menu/common/scripted_diplomatic_objectives", kind: "scripted_diplomatic_objective" },
  { path: "main_menu/common/scripted_effects", kind: "scripted_effect" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/scripted_geography", kind: "scripted_geography" },
  { path: "main_menu/common/scripted_guis", kind: "scripted_gui" },
  { path: "main_menu/common/scripted_lists", kind: "scripted_list" },
  // requiredLoc: ["$_relation", "$_relation_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/scripted_relations", kind: "scripted_relation" },
  { path: "main_menu/common/scripted_triggers", kind: "scripted_trigger" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/situations", kind: "situation" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/societal_values", kind: "societal_value" },
  // requiredLoc: ["STATIC_MODIFIER_NAME_$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/static_modifiers", kind: "static_modifier" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/subject_military_stances", kind: "subject_military_stance" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/subject_types", kind: "subject_type" },
  { path: "main_menu/common/tests", kind: "test" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/topography", kind: "topography" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/town_rights", kind: "town_right" },
  { path: "main_menu/common/town_setups", kind: "town_setup" },
  { path: "main_menu/common/trait_flavor", kind: "trait_flavor" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/traits", kind: "trait" },
  { path: "main_menu/common/trigger_localization", kind: "trigger_localization" },
  { path: "main_menu/common/tutorial_lesson_chains", kind: "tutorial_lesson_chain" },
  { path: "main_menu/common/tutorial_lessons", kind: "tutorial_lesson" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/unit_abilities", kind: "unit_ability" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/unit_categories", kind: "unit_category" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/unit_formation_preference", kind: "unit_formation_preference" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/unit_types", kind: "unit_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/vegetation", kind: "vegetation" },
  // requiredLoc: ["war_goal_$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/common/wargoals", kind: "war_goal" },
  // requiredLoc: ["title", "desc"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/events", kind: "event", extraction: "event-id" },
  { path: "main_menu/localization", kind: "loc_key", ext: ".yml", extraction: "loc-key" },
  // requiredLoc: ["mapmode_$_name", "mapmode_$"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/map/map_modes", kind: "map_mode" },
  // requiredLoc: ["$", "$_ADJ"] (CWT localisation block, unverified against vanilla)
  { path: "main_menu/setup/countries", kind: "country" },

  // --- loading_screen/ (loading-screen stage) ---
  // requiredLoc: ["ACHIEVEMENT_$", "ACHIEVEMENT_DESC_$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/achievements", kind: "achievement" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/advances", kind: "advance" },
  // requiredLoc: ["$", "$_desc", "age_format_$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/age", kind: "age" },
  { path: "loading_screen/common/ai_diplochance", kind: "ai_diplochance" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/ai_personalities", kind: "ai_personality" },
  // requiredLoc: ["title"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/alert_descriptions", kind: "alert_description" },
  { path: "loading_screen/common/area_preferences", kind: "area_preference" },
  // requiredLoc: ["ARTIST_TYPE_NAME_$", "ARTIST_TYPE_DESC_$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/artist_types", kind: "artist_type" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/artist_work", kind: "artist_work" },
  // requiredLoc: ["AUTO_MODIFIER_NAME_$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/auto_modifiers", kind: "auto_modifier" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/avatars", kind: "avatar" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/biases", kind: "bias" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/building_categories", kind: "building_category" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/building_types", kind: "building_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/bureaucracies", kind: "bureaucracy" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/cabinet_actions", kind: "cabinet_action" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/casus_belli", kind: "casus_belli" },
  // requiredLoc: ["$", "$_concept", "$_act", "$_desc_specific", "$_desc", "$_past", "$_act_past"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/character_interactions", kind: "character_interaction" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/child_educations", kind: "child_education" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/chivalric_orders", kind: "chivalric_order" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/climates", kind: "climate" },
  { path: "loading_screen/common/coat_of_arms/coat_of_arms", kind: "coat_of_arm" },
  // requiredLoc: ["country_description_category_name_$", "country_description_category_desc_$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/country_description_categories", kind: "country_description_category" },
  // requiredLoc: ["$", "$_desc", "$_act", "$_effect_text", "$_effect_text_past"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/country_interactions", kind: "country_interaction" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/country_ranks", kind: "country_rank" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/culture_groups", kind: "culture_group" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/cultures", kind: "culture" },
  { path: "loading_screen/common/customizable_localization", kind: "customizable_localization" },
  // requiredLoc: ["DEATH_REASON_$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/death_reason", kind: "death_reason" },
  // requiredLoc: ["HEIR_REASON_$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/designated_heir_reason", kind: "designated_heir_reason" },
  { path: "loading_screen/common/diplomatic_costs", kind: "diplomatic_cost" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/disasters", kind: "disaster" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/diseases", kind: "disease" },
  { path: "loading_screen/common/effect_localization", kind: "effect_localization" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/employment_systems", kind: "employment_system" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/estate_privileges", kind: "estate_privilege" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/estates", kind: "estate" },
  { path: "loading_screen/common/ethnicities", kind: "ethnicity" },
  { path: "loading_screen/common/flag_definitions", kind: "flag_definition" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/formable_countries", kind: "formable_country" },
  // requiredLoc: ["game_concept_$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/game_concepts", kind: "game_concept" },
  // requiredLoc: ["rule_$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/game_rules", kind: "game_rule_category" },
  { path: "loading_screen/common/generic_action_ai_lists", kind: "generic_action_ai_list" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/generic_actions", kind: "generic_action" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/gods", kind: "god" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/goods", kind: "good" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/goods_demand", kind: "goods_demand" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/goods_demand_category", kind: "goods_demand_category" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/government_reforms", kind: "government_reform" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/government_types", kind: "government_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/hegemons", kind: "hegemon" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/heir_selections", kind: "heir_selection" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/historical_scores", kind: "historical_score" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/holy_site_types", kind: "holy_site_type" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/holy_sites", kind: "holy_site" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/institution", kind: "institution" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/insults", kind: "insult" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  {
    path: "loading_screen/common/international_organization_land_ownership_rules",
    kind: "international_organization_land_ownership_rule",
  },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  {
    path: "loading_screen/common/international_organization_payments",
    kind: "international_organization_payment",
  },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  {
    path: "loading_screen/common/international_organization_special_statuses",
    kind: "international_organization_special_status",
  },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/international_organizations", kind: "international_organization" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/join_war_rules", kind: "join_war_rule" },
  { path: "loading_screen/common/language_families", kind: "language_family" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/languages", kind: "language" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/laws", kind: "law" },
  { path: "loading_screen/common/levies", kind: "levy" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/location_ranks", kind: "location_rank" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/missions", kind: "mission" },
  { path: "loading_screen/common/modifier_icons", kind: "modifier_icon" },
  // requiredLoc: ["MODIFIER_TYPE_NAME_$", "MODIFIER_TYPE_DESC_$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/modifier_type_definitions", kind: "modifier_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/movements", kind: "movement" },
  // requiredLoc: ["$", "$_flavour"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/music_player_tracks", kind: "music_player_track" },
  { path: "loading_screen/common/on_action", kind: "on_action" },
  // requiredLoc: ["$", "$_desc", "$_simple"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/parliament_agendas", kind: "parliament_agenda" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/parliament_issues", kind: "parliament_issue" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/parliament_types", kind: "parliament_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/peace_treaties", kind: "peace_treaty" },
  { path: "loading_screen/common/persistent_dna", kind: "persistent_dna" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/pop_types", kind: "pop_type" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/prices", kind: "price" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/production_methods", kind: "production_method" },
  { path: "loading_screen/common/rebel_demands", kind: "rebel_demand" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/recruitment_method", kind: "recruitment_method" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/regencies", kind: "regency" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/religion_groups", kind: "religion_group" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/religions", kind: "religion" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/religious_aspects", kind: "religious_aspect" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/religious_factions", kind: "religious_faction" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/religious_figures", kind: "religious_figure" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/religious_focuses", kind: "religious_focus" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/religious_schools", kind: "religious_school" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/resolutions", kind: "resolution" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/rival_criteria", kind: "rival_criteria" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/road_types", kind: "road_type" },
  { path: "loading_screen/common/scenarios", kind: "scenario" },
  { path: "loading_screen/common/script_values", kind: "script_value" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/scriptable_hints", kind: "scriptable_hint" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/scripted_country_names", kind: "scripted_country_name" },
  { path: "loading_screen/common/scripted_diplomatic_objectives", kind: "scripted_diplomatic_objective" },
  { path: "loading_screen/common/scripted_effects", kind: "scripted_effect" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/scripted_geography", kind: "scripted_geography" },
  { path: "loading_screen/common/scripted_guis", kind: "scripted_gui" },
  { path: "loading_screen/common/scripted_lists", kind: "scripted_list" },
  // requiredLoc: ["$_relation", "$_relation_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/scripted_relations", kind: "scripted_relation" },
  { path: "loading_screen/common/scripted_triggers", kind: "scripted_trigger" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/situations", kind: "situation" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/societal_values", kind: "societal_value" },
  // requiredLoc: ["STATIC_MODIFIER_NAME_$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/static_modifiers", kind: "static_modifier" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/subject_military_stances", kind: "subject_military_stance" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/subject_types", kind: "subject_type" },
  { path: "loading_screen/common/tests", kind: "test" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/topography", kind: "topography" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/town_rights", kind: "town_right" },
  { path: "loading_screen/common/town_setups", kind: "town_setup" },
  { path: "loading_screen/common/trait_flavor", kind: "trait_flavor" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/traits", kind: "trait" },
  { path: "loading_screen/common/trigger_localization", kind: "trigger_localization" },
  { path: "loading_screen/common/tutorial_lesson_chains", kind: "tutorial_lesson_chain" },
  { path: "loading_screen/common/tutorial_lessons", kind: "tutorial_lesson" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/unit_abilities", kind: "unit_ability" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/unit_categories", kind: "unit_category" },
  // requiredLoc: ["$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/unit_formation_preference", kind: "unit_formation_preference" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/unit_types", kind: "unit_type" },
  // requiredLoc: ["$", "$_desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/vegetation", kind: "vegetation" },
  // requiredLoc: ["war_goal_$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/common/wargoals", kind: "war_goal" },
  // requiredLoc: ["title", "desc"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/events", kind: "event", extraction: "event-id" },
  { path: "loading_screen/localization", kind: "loc_key", ext: ".yml", extraction: "loc-key" },
  // requiredLoc: ["mapmode_$_name", "mapmode_$"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/map/map_modes", kind: "map_mode" },
  // requiredLoc: ["$", "$_ADJ"] (CWT localisation block, unverified against vanilla)
  { path: "loading_screen/setup/countries", kind: "country" },
];

// Not covered (importer skipped): CWT type constructs with no equivalent among
// the five NameExtraction modes. Importing them would yield wrong definition
// names rather than fewer, so they are dropped until a matching mode exists.
//   - achievement_group (config/common/achievement_groups.cwt): name_field = name (name comes from a body field, not the top-level key)
//   - attribute_column (config/common/attribute_columns.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - unique_production_method (config/common/building_types.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - coat_of_arm_template (config/common/coat_of_arms/coat_of_arms.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - coat_of_arms_template_list (config/common/coat_of_arms/template_lists.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - pattern_texture_list (config/common/coat_of_arms/template_lists.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - color_list (config/common/coat_of_arms/template_lists.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - textured_emblem_texture_list (config/common/coat_of_arms/template_lists.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - colored_emblem_texture_list (config/common/coat_of_arms/template_lists.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - define (config/common/defines.cwt): skip_root_key = any (definitions nest one level below the file root)
//   - game_rule (config/common/game_rules.cwt): skip_root_key = any (definitions nest one level below the file root)
//   - accessory_gene (config/common/genes/accessory_genes.cwt): skip_root_key = accessory_genes (definitions nest one level below the file root)
//   - special_accessory_gene (config/common/genes/accessory_genes.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - age_preset (config/common/genes/age_presets.cwt): skip_root_key = age_presets (definitions nest one level below the file root)
//   - color_gene (config/common/genes/color_genes.cwt): skip_root_key = color_genes (definitions nest one level below the file root)
//   - morph_gene (config/common/genes/morph_genes.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - special_morph_gene (config/common/genes/morph_genes.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - omen (config/common/gods.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - dialect (config/common/languages.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - named_color (config/common/named_colors.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - inline_scripted_effect (config/common/scripted_effects.cwt): type_key_prefix = scripted_effect (only prefixed keys are definitions)
//   - inline_scripted_trigger (config/common/scripted_triggers.cwt): type_key_prefix = scripted_trigger (only prefixed keys are definitions)
//   - event_namespace (config/events/event_namespaces.cwt): name_field = - (name comes from a body field, not the top-level key)
//   - font_definition (config/fonts/fonts.cwt): name_field = name (name comes from a body field, not the top-level key)
//   - dynamic_game_object (config/gfx/map/dynamic_game_objects.cwt): name_field = name (name comes from a body field, not the top-level key)
//   - entity (config/gfx/models/entity.cwt): name_field = name (name comes from a body field, not the top-level key)
//   - pdxmesh (config/gfx/models/pdxmesh.cwt): name_field = name (name comes from a body field, not the top-level key)
//   - text_format (config/gui/text_formats.cwt): name_field = name (name comes from a body field, not the top-level key)
//   - text_icon (config/gui/text_icons.cwt): name_field = icon (name comes from a body field, not the top-level key)
//   - continent (config/map_data/definitions.cwt): path_file = definitions.txt (one file, not a folder scan)
//   - sub_continent (config/map_data/definitions.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - region (config/map_data/definitions.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - area (config/map_data/definitions.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - province (config/map_data/definitions.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - character (config/setup/start/character_db.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - colony_manager (config/setup/start/colony_manager.cwt): ## type_key_filter = colony_manager (only that literal root key is a definition)
//   - country_setup (config/setup/start/country_setup.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - current_age (config/setup/start/country_setup.cwt): ## type_key_filter = current_age (only that literal root key is a definition)
//   - development (config/setup/start/development.cwt): ## type_key_filter = development (only that literal root key is a definition)
//   - diplomacy_manager (config/setup/start/diplomacy_manager.cwt): ## type_key_filter = diplomacy_manager (only that literal root key is a definition)
//   - disease_outbreak_manager (config/setup/start/disease_outbreak_manager.cwt): ## type_key_filter = disease_outbreak_manager (only that literal root key is a definition)
//   - dynasty (config/setup/start/dynasty_manager.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - exploration_manager (config/setup/start/exploration_manager.cwt): ## type_key_filter = exploration_manager (only that literal root key is a definition)
//   - institution_manager (config/setup/start/institution_manager.cwt): skip_root_key = { ... } (definitions nest one level below the file root)
//   - international_organization_manager (config/setup/start/international_organization_manager.cwt): ## type_key_filter = international_organization_manager (only that literal root key is a definition)
//   - locations (config/setup/start/locations.cwt): ## type_key_filter = locations (only that literal root key is a definition)
//   - market_manager (config/setup/start/market_manager.cwt): ## type_key_filter = market_manager (only that literal root key is a definition)
//   - religion_manager (config/setup/start/religion_manager.cwt): ## type_key_filter = religion_manager (only that literal root key is a definition)
//   - road_network (config/setup/start/road_network.cwt): ## type_key_filter = road_network (only that literal root key is a definition)
//   - situation_manager (config/setup/start/situation_manager.cwt): ## type_key_filter = situation_manager (only that literal root key is a definition)
//   - townrights_manager (config/setup/start/town_rights.cwt): ## type_key_filter = townrights_manager (only that literal root key is a definition)
//   - unit_manager (config/setup/start/unit_manager.cwt): ## type_key_filter = unit_manager (only that literal root key is a definition)
//   - war_manager (config/setup/start/war_manager.cwt): ## type_key_filter = war_manager (only that literal root key is a definition)
//   - work_of_art_manager (config/setup/start/work_of_art_manager.cwt): ## type_key_filter = work_of_art_manager (only that literal root key is a definition)
