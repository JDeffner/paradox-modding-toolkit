/**
 * Ambient (engine-provided) saved scopes per definition kind (update plan v1.1
 * §B3). These names are referenced via `scope:x` but are never `save_scope_as`'d
 * in script — the engine binds them — so a save-site index can't explain them.
 *
 * SOURCE: hand-curated from the game's `_*.info` files (2026-07 scope audit:
 * every folder's documented `scope:<name>` lines were swept and typed). Scope
 * type names are the canonical ones from event_scopes.log. Some ambient scopes
 * only exist in specific blocks of the kind; per AD-5 they are offered for the
 * whole file (rank/annotate, never hide) with the block noted in the doc.
 */
import type { AmbientScope } from "../../schema/types";

const CHAR = "character";

function s(name: string, type: string, doc: string): AmbientScope {
  return { name, type, doc };
}

/** Ambient scopes keyed by schema kind. */
export const AMBIENT_SCOPES: Record<string, AmbientScope[]> = {
  // common/character_interactions/_character_interactions.info
  character_interaction: [
    s("actor", CHAR, "The character sending the interaction (the initiator)."),
    s("recipient", CHAR, "The character receiving the interaction."),
    s(
      "secondary_actor",
      CHAR,
      "Present when the interaction declares a secondary actor (e.g. marriage) or a redirect saves one."
    ),
    s(
      "secondary_recipient",
      CHAR,
      "As secondary_actor, for the recipient side (e.g. the character being married off)."
    ),
    s(
      "intermediary",
      CHAR,
      "The intermediary who forwards the interaction, when one is used. Set/replaced via redirect."
    ),
  ],

  // common/activities/activity_types/_activity_type.info
  activity_type: [
    s("activity", "activity", "The activity (is_valid, on_* effect blocks, phases…)."),
    s("host", CHAR, "Host of the activity."),
    s(
      "special_option",
      "flag",
      "Flag of the selected special option; unset when the activity has no special option category."
    ),
    s("province", "province", "Phase blocks: the location the phase is at / being evaluated in."),
  ],
  // common/activities/guest_invite_rules/_invite_rules.info (root = host character)
  guest_invite_rule: [
    s(
      "special_option",
      "flag",
      "Flag of the selected special option; unset when the activity has no special option category."
    ),
  ],
  // common/activities/intents/_intents.info
  activity_intent: [
    s("target", CHAR, "The target of the intent."),
    s("activity", "activity", "The activity the intent applies to."),
    s("special_option", "flag", "Flag of the selected special option."),
  ],
  // common/activities/pulse_actions/_pulse_actions.info
  activity_pulse_action: [
    s("activity", "activity", "The activity."),
    s("host", CHAR, "Host of the activity."),
    s("province", "province", "Current activity location."),
    s("first", CHAR, "First saved character, shown in the pulse-action entry."),
    s("second", CHAR, "Second saved character, shown in the pulse-action entry."),
  ],
  // common/activities/activity_locales/_activity_locales.info
  activity_locale: [s("activity", "activity", "The activity."), s("host", CHAR, "Host of the activity.")],

  // common/schemes/scheme_types/_schemes.info
  scheme_type: [
    s("scheme", "scheme", "The scheme itself."),
    s(
      "owner",
      CHAR,
      "The scheme owner (same as scheme_owner, valid in an unbroken chain from the scheme scope)."
    ),
    s(
      "target",
      CHAR,
      "Whatever the scheme targets — a character for character-targeted schemes (title/culture/faith schemes target those types)."
    ),
    s(
      "target_title",
      "landed_title",
      "The targeted title, when the scheme targets a title (otherwise unset)."
    ),
    s("agent", CHAR, "An agent in the scheme (on_agent_exposed and similar per-agent effects)."),
  ],
  // common/schemes/agent_types/_agent_types.info
  scheme_agent_type: [
    s("owner", CHAR, "The owner of the scheme."),
    s("scheme", "scheme", "The scheme."),
    s("target", CHAR, "The target of the scheme."),
  ],
  // common/schemes/pulse_actions/_pulse_actions.info
  scheme_pulse_action: [
    s("activity", "scheme", "The scheme (the docs reuse the activity slot name)."),
    s("owner", CHAR, "Owner of the scheme."),
    s("first", CHAR, "First saved character, shown in the pulse-action entry."),
    s("second", CHAR, "Second saved character, shown in the pulse-action entry."),
  ],

  // common/secret_types/_secret_types.info (root = the secret)
  secret: [
    s("secret_owner", CHAR, "The character the secret is about."),
    s("secret_target", CHAR, "Optional character related to the secret (e.g. the lover in a lover secret)."),
    s(
      "target",
      CHAR,
      "is_shunned/is_criminal: the character checking whether they view the secret as shunned/criminal."
    ),
    s("discoverer", CHAR, "on_discover: the character who discovered the secret."),
    s("secret_exposer", CHAR, "on_expose: the character who exposed the secret."),
  ],

  // common/story_cycles/_story_cycles.info (root = the story)
  story_cycle: [s("story", "story", "The story cycle (same as root in its effect blocks).")],

  // common/situation/situations/_situations.info
  situation: [
    s("situation", "situation", "The situation."),
    s("situation_sub_region", "situation_sub_region", "The situation sub-region of the current block/phase."),
    s(
      "situation_participant_group",
      "situation_participant_group",
      "The participant group (participant blocks)."
    ),
  ],

  // common/casus_belli_types/_casus_belli.info
  casus_belli: [
    s("attacker", CHAR, "The attacker in the war."),
    s("defender", CHAR, "The defender in the war."),
    s("claimant", CHAR, "The claimant, for claim CBs."),
    s("target", "landed_title", "The target title, when the CB has one."),
  ],

  // common/council_tasks/_council_tasks.info
  council_task: [
    s("councillor", CHAR, "The councillor performing the task."),
    s("councillor_liege", CHAR, "The councillor's liege."),
    s("county", "landed_title", "County tasks: the county being worked."),
    s("province", "province", "Province tasks: the province being worked."),
    s("target_character", CHAR, "Character-targeted tasks: the target."),
  ],

  // common/buildings/_buildings.info (root = province)
  building: [s("holder", CHAR, "The holder of the province the building is in.")],

  // common/legends/legend_types/_legends.info
  legend_type: [
    s("legend", "legend", "The legend."),
    s("creator", CHAR, "The creator of the legend."),
    s("protagonist", CHAR, "The protagonist of the legend."),
  ],

  // common/epidemics/_epidemics.info
  epidemic: [
    s("epidemic", "epidemic", "The epidemic."),
    s("epidemic_type", "epidemic_type", "The epidemic's type."),
  ],

  // common/inspirations/_inspirations.info (root = inspiration)
  inspiration: [
    s("inspiration", "inspiration", "The inspiration."),
    s("inspiration_owner", CHAR, "The character who has the inspiration."),
    s("inspiration_sponsor", CHAR, "The sponsoring character, once sponsored."),
  ],

  // common/travel/travel_options/_travel_options.info (root = travel owner / plan)
  travel_option: [s("owner", CHAR, "The travel plan owner.")],
  // common/travel/point_of_interest_types/_travel_point_of_interest_types.info
  point_of_interest: [s("province", "province", "The point-of-interest province.")],

  // common/court_positions/types/_court_positions.info (root = character)
  court_position: [
    s("liege", CHAR, "The court owner employing the position."),
    s("employee", CHAR, "The character employed in the position."),
  ],
  court_position_task: [
    s("liege", CHAR, "The court owner employing the position."),
    s("employee", CHAR, "The character employed in the position."),
  ],

  // common/character_memory_types/_character_memories.info
  character_memory_type: [
    s("memory", "character_memory", "The memory."),
    s("new_memory", "character_memory", "The newly created memory (creation blocks)."),
    s("owner", CHAR, "The memory owner."),
  ],

  // common/great_projects/types/_great_project_types.info
  great_project: [
    s("great_project", "great_project", "The funded project (ongoing projects)."),
    s("owner", CHAR, "The project owner."),
    s("founder", CHAR, "The project founder."),
    s("province", "province", "The project's province."),
  ],

  // common/domiciles (root = owner character / the domicile)
  domicile_building: [s("owner", CHAR, "The domicile owner.")],
  domicile_type: [s("owner", CHAR, "The domicile owner.")],

  // common/task_contracts/_task_contracts.info
  task_contract: [s("employer", CHAR, "The character offering the contract.")],

  // common/subject_contracts + tax slots
  subject_contract: [
    s("liege", CHAR, "The liege side of the contract."),
    s("subject", CHAR, "The subject side of the contract."),
    s("vassal", CHAR, "The vassal (tax blocks)."),
    s("tax_collector", CHAR, "The tax collector."),
    s("tax_slot", "tax_slot", "The tax slot."),
  ],
  tax_obligation: [
    s("liege", CHAR, "The liege."),
    s("vassal", CHAR, "The vassal."),
    s("tax_collector", CHAR, "The tax collector."),
    s("tax_slot", "tax_slot", "The tax slot."),
  ],
  tax_slot_type: [
    s("liege", CHAR, "The liege."),
    s("vassal", CHAR, "The vassal."),
    s("tax_collector", CHAR, "The tax collector."),
    s("tax_slot", "tax_slot", "The tax slot."),
  ],

  // common/succession_election/_succession_election.info (root = the title)
  succession_election: [
    s("candidate", CHAR, "The candidate being evaluated."),
    s("holder", CHAR, "The current title holder."),
    s("holder_candidate", CHAR, "The holder as a candidate."),
    s("title", "landed_title", "The elective title."),
  ],
  succession_appointment: [s("title", "landed_title", "The title being appointed.")],

  // Misc single-scope kinds
  vassal_stance: [s("liege", CHAR, "The vassal's liege.")],
  legitimacy_level: [
    s("target", CHAR, "The character whose legitimacy is checked."),
    s("liege", CHAR, "The target's liege."),
  ],
  scripted_relation: [s("target", CHAR, "The other character of the relation.")],
  suggestion: [s("recipient", CHAR, "The character receiving the suggestion.")],
  important_action: [s("recipient", CHAR, "The character the alert is for (the player).")],
  house_aspiration: [s("house", "dynasty_house", "The house the aspiration belongs to.")],
  combat_phase_event: [s("combat_side", "combat_side", "The combat side of the phase event.")],
  culture_creation_name: [
    s("culture", "culture", "The culture being created."),
    s("other_culture", "culture", "The other parent culture (hybrid cultures)."),
  ],
  innovation: [s("character", CHAR, "The innovating culture's ruler (specific trigger blocks).")],

  // common/artifacts
  artifact_template: [s("artifact", "artifact", "The artifact.")],
  artifact_visual: [s("artifact", "artifact", "The artifact.")],

  // common/accolade_names/_accolade_name.info (root = the accolade)
  accolade_name: [
    s("accolade_type", "accolade_type", "The accolade's primary type."),
    s("owner", CHAR, "The accolade owner (the liege)."),
  ],
};
