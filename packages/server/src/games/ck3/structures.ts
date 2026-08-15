/**
 * Block-schema `structure` layer (update plan v1.1 §B2): the document shape of a
 * few high-value definition kinds, the structural keys every modder types most,
 * which come from neither script_docs tokens nor the definition index.
 *
 * SOURCE: hand-curated from the game's own `_*.info` files (harvested by
 * scripts/build-structure.ts, regenerate there, curate here). Doc prose is the
 * game's own, trimmed. `freq` values are the AGOT per-context counts from the
 * plan's §B1 tables where available (used for ranking in Workstream C; a leading
 * subset here). This is STATIC TypeScript on purpose: users may not have gamePath
 * set, so nothing is harvested at runtime.
 *
 * Provenance strings for hover are the `.info` folder name (see STRUCTURE_SOURCES).
 */
import type { KeySpec, StructureSpec } from "../../schema/types";
// Bundled full harvest of every _*.info schema doc (scripts/build-structures-json.ts):
// ~70 kinds, ~1300 documented keys with vanilla usage counts. Merged UNDER the
// hand-curated specs below, curated docs always win on key collisions.
import HARVESTED_JSON from "../../../data/ck3/structures.json";

interface HarvestedShape {
  sources: Record<string, string>;
  kinds: Record<string, { topLevel: KeySpec[]; blocks?: Record<string, KeySpec[]> }>;
}
const HARVESTED = HARVESTED_JSON as unknown as HarvestedShape;

// Provenance shown in hover, keyed by schema kind (curated entries win).
export const STRUCTURE_SOURCES: Record<string, string> = {
  ...HARVESTED.sources,
  character_interaction: "character_interactions",
  decision: "decisions",
  event: "events",
  on_action: "on_action",
};

// --- dynamic description nodes (events/_events.info "Descriptions") ---
// desc/title/opening/option-name and the decision loc fields accept either a
// plain loc key or a dynamic-description block; nodes nest arbitrarily, and
// structureContextAt resolves by the innermost block name, so wiring each node
// name once per kind covers any nesting depth. `curated: true` keeps this
// deliberate order ahead of harvested any-depth keys.
const DESC_NODE: KeySpec[] = [
  {
    key: "desc",
    values: "loc",
    curated: true,
    doc: "Appends text: a loc key, or another nested dynamic-description block.",
  },
  {
    key: "triggered_desc",
    values: "block",
    curated: true,
    doc: "Conditional node: optional `trigger = { … }` plus `desc = …`; the desc is appended if the trigger passes.",
  },
  {
    key: "first_valid",
    values: "block",
    curated: true,
    doc: "Checks child entries in order and uses only the first valid one. Put a plain `desc = fallback_key` last as the fallback.",
  },
  {
    key: "random_valid",
    values: "block",
    curated: true,
    doc: "Collects all valid children and picks randomly (default count = 1; `count = N` picks up to N unique ones).",
  },
];
const TRIGGERED_DESC: KeySpec[] = [
  {
    key: "trigger",
    values: "block",
    curated: true,
    doc: "Trigger: if it passes (or is omitted), this node's desc is appended.",
  },
  {
    key: "desc",
    values: "loc",
    curated: true,
    doc: "The text: a loc key, or a nested dynamic-description block.",
  },
];
const RANDOM_VALID: KeySpec[] = [
  { key: "count", curated: true, doc: "How many unique valid children to pick (default 1; no replacement)." },
  ...DESC_NODE,
];
/** The desc-node blocks shared by every kind whose loc fields support them. */
const DESC_NODE_BLOCKS: Record<string, KeySpec[]> = {
  first_valid: DESC_NODE,
  random_valid: RANDOM_VALID,
  triggered_desc: TRIGGERED_DESC,
};

// --- character_interaction (common/character_interactions/_character_interactions.info) ---
const CHARACTER_INTERACTION: StructureSpec = {
  topLevel: [
    {
      key: "category",
      values: "loc",
      freq: 530,
      doc: "Required. Groups the interaction in this category in the interaction menu.",
    },
    { key: "desc", values: "loc", freq: 419, doc: "Short description of the interaction (loc key)." },
    {
      key: "is_shown",
      values: "block",
      freq: 535,
      doc: "Trigger: is the interaction available and visible. Available scopes: scope:actor, scope:recipient. Avoid actor-only or global tests here, put those in is_available.",
    },
    {
      key: "is_valid",
      values: "block",
      doc: "Trigger: is the interaction valid to be selected in its current setup. Available scopes: scope:actor, scope:recipient.",
    },
    {
      key: "is_valid_showing_failures_only",
      values: "block",
      freq: 379,
      doc: "Trigger: as is_valid, but only displays failures. Available scopes: scope:actor, scope:recipient.",
    },
    {
      key: "is_available",
      values: "block",
      doc: "Trigger: is this interaction available for the actor (AI and player). Root is the actor. Prefer this over is_shown for actor-only checks.",
    },
    {
      key: "is_highlighted",
      values: "block",
      doc: "Trigger: should the interaction be highlighted in the menu.",
    },
    {
      key: "auto_accept",
      values: "bool",
      freq: 473,
      doc: "Is the interaction automatically accepted (yes/no/trigger), or can the recipient decide.",
    },
    {
      key: "icon",
      values: "loc",
      freq: 469,
      doc: "Icon to use. Defaults to the interaction key's .dds in gfx/interface/icons/character_interactions.",
    },
    {
      key: "send_option",
      values: "block",
      freq: 921,
      doc: "Adds a toggleable option to the interaction window.",
    },
    { key: "on_accept", values: "block", freq: 537, doc: "Effect: executes when accepted by the recipient." },
    { key: "on_decline", values: "block", doc: "Effect: executes when declined by the recipient." },
    { key: "on_send", values: "block", doc: "Effect: executes as soon as the interaction is sent." },
    {
      key: "ai_targets",
      values: "block",
      freq: 416,
      doc: "Which characters the AI considers as recipients. Can be scripted multiple times to combine lists.",
    },
    { key: "ai_accept", values: "block", doc: "MTTH: will the AI accept a request for this interaction." },
    {
      key: "ai_will_do",
      values: "block",
      doc: "MTTH: how interested the AI is in sending this interaction (0-100, clamped).",
    },
    {
      key: "ai_potential",
      values: "block",
      doc: "Trigger: will the AI consider trying this interaction. Deprecated, use is_available.",
    },
    // Kept curated even though the harvest now carries it (cap fix, 2026-07):
    // the .info comment omits the unit and the 0-disables rule.
    { key: "ai_frequency", doc: "How often the AI considers this interaction, in months. 0 means never." },
    {
      key: "cooldown",
      values: "block",
      doc: "How long until the interaction can be used again (e.g. { years = x }).",
    },
    {
      key: "cost",
      values: "block",
      doc: "Scripted cost (gold/piety/prestige/renown). The interaction is disabled if the actor can't pay.",
    },
    {
      key: "redirect",
      values: "block",
      doc: "Effect: replace any of actor/secondary_actor/recipient/secondary_recipient/intermediary with another character. This is how the ambient scopes are re-bound.",
    },
    { key: "interface_priority", doc: "Sorts interactions in the menu (higher first)." },
    {
      key: "common_interaction",
      values: "bool",
      doc: "Common interactions are never placed in the More… submenu.",
    },
    { key: "greeting", values: "enum:positive|negative", doc: "Sets the tone in the request text." },
    { key: "notification_text", values: "loc", doc: "Request text shown to the recipient (loc key)." },
    { key: "prompt", values: "loc", doc: 'Text shown under the portrait, e.g. "Pick a Guardian" (loc key).' },
    { key: "can_send", values: "block", doc: "Trigger: can the interaction be sent." },
    {
      key: "can_be_blocked",
      values: "block",
      doc: "Trigger: can the interaction be blocked by the recipient (e.g. via a hook).",
    },
    {
      key: "populate_actor_list",
      values: "block",
      doc: "Populates the 'characters' selection list. Uses actor/recipient/secondary_actor/secondary_recipient scopes.",
    },
    {
      key: "target_type",
      values: "enum:title|artifact|men_at_arms|court_position_type|count",
      doc: "What kind of thing the interaction targets. Default: count.",
    },
    {
      key: "target_filter",
      doc: "Which titles/artifacts/regiments populate the target list (see the .info FAQ for values).",
    },
    { key: "hidden", values: "bool", doc: "Is the interaction hidden." },
    {
      key: "popup_on_receive",
      values: "bool",
      doc: "Have the interaction pop up for the recipient when received.",
    },
    {
      key: "send_name",
      values: "loc",
      doc: "Name of the interaction once sent. Defaults to the database key.",
    },
  ],
  blocks: {
    send_option: [
      {
        key: "is_shown",
        values: "block",
        doc: "Trigger: is this option shown. Independent, don't reference other option flags.",
      },
      { key: "is_valid", values: "block", doc: "Trigger: is this option selectable." },
      { key: "localization", values: "loc", doc: "Loc key for the option label." },
      { key: "current_description", values: "loc", doc: "Tooltip loc for the option." },
      { key: "flag", doc: "If selected, scope:<flag_name> is set to yes." },
      {
        key: "starts_enabled",
        values: "block",
        doc: "Trigger: whether this option is on when the window opens. Defaults to off.",
      },
      {
        key: "can_be_changed",
        values: "block",
        doc: "Trigger: whether this option can be changed from its default.",
      },
      {
        key: "can_invalidate_interaction",
        values: "bool",
        doc: "If yes, picking this option re-runs the full can-send check. Use with care (AI performance).",
      },
    ],
    ai_targets: [
      {
        key: "ai_recipients",
        values:
          "enum:known_secrets|scheme_targets|hooked_characters|neighboring_rulers|neighboring_rulers_including_tributary_borders|neighboring_top_overlords_including_tributary_borders|neighboring_top_overlords_connected_by_land|peer_vassals|guests|dynasty|courtiers|councillors|prisoners|confederation_house_heads|sub_realm_characters|realm_characters|vassals|tributaries|liege|top_liege|suzerain|top_suzerain|self|head_of_faith|spouses|family|children|primary_war_enemies|war_enemies|war_allies|scripted_relations|activity_host|activity_guests|contacts|domicile_location_top_ruler|domicile_location_top_realm_vassals|domicile_location_neighboring_top_rulers|domicile_location_neighboring_top_realm_vassals|top_realm_domicile_owners|sub_realm_domicile_owners|nearby_domicile_owners|situation_participant_group",
        doc: "Which characters the AI considers as recipients (the ai_targets list in _character_interactions.info).",
      },
      {
        key: "max",
        doc: "Maximum number of targets to consider; unset considers all (random subset when filtered).",
      },
      {
        key: "chance",
        doc: "0–1: chance each candidate is actually checked, a low value randomly excludes characters (performance).",
      },
      {
        key: "parameter",
        doc: "Extra detail for specific targets, for situation_participant_group, the situation key.",
      },
    ],
    // highlighted_reason etc. support dynamic descriptions per the .info.
    ...DESC_NODE_BLOCKS,
  },
};

// --- decision (common/decisions/_decisions.info) ---
const DECISION: StructureSpec = {
  topLevel: [
    {
      key: "picture",
      values: "block",
      freq: 470,
      doc: "A picture for the decision. The first entry whose trigger passes is used.",
    },
    {
      key: "effect",
      values: "block",
      freq: 397,
      doc: "Effect executed when the decision is taken. Scope: character.",
    },
    {
      key: "is_shown",
      values: "block",
      freq: 395,
      doc: "Trigger: is the decision available to the character. Scope: character. Default: always = yes.",
    },
    {
      key: "is_valid",
      values: "block",
      doc: "Trigger: can the decision be executed (shown under Requirements). Scope: character.",
    },
    {
      key: "is_valid_showing_failures_only",
      values: "block",
      doc: "Trigger: can execute, failures shown in the confirm tooltip. Scope: character.",
    },
    {
      key: "ai_will_do",
      values: "block",
      freq: 369,
      doc: "% chance the AI executes the decision (0 never, 100 always). Also sets the player default option.",
    },
    {
      key: "ai_potential",
      values: "block",
      freq: 336,
      doc: "Trigger: whether the AI should look at this decision at all.",
    },
    {
      key: "ai_check_interval",
      freq: 343,
      doc: "Months between AI checks. Required unless ai_goal = yes. 0 means never checked.",
    },
    {
      key: "ai_check_interval_by_tier",
      values: "block",
      doc: "AI check interval (months) per top-title tier. All tiers required. Used instead of ai_check_interval.",
    },
    {
      key: "ai_goal",
      values: "bool",
      doc: "The AI treats this as a goal, budgeting for it alongside major costs. Ignores ai_check_interval.",
    },
    {
      key: "desc",
      values: "loc",
      freq: 345,
      doc: 'Description. Default "<key>_desc". Supports dynamic descriptions. Scope: character.',
    },
    {
      key: "title",
      values: "loc",
      doc: 'Title override. Default "<key>". Supports dynamic descriptions. Scope: character.',
    },
    {
      key: "selection_tooltip",
      values: "loc",
      doc: 'Tooltip when selecting the decision. Default "<key>_tooltip". Scope: character.',
    },
    {
      key: "confirm_text",
      values: "loc",
      doc: 'Confirm-button text. Default "<key>_confirm". Scope: character.',
    },
    { key: "cost", values: "block", doc: "Cost values (gold/piety/prestige). Default: 0." },
    {
      key: "minimum_cost",
      values: "block",
      doc: "Like cost, but not applied, only blocks taking the decision if unaffordable.",
    },
    { key: "decision_group_type", doc: "Foldable decision group to place this in. Default: decisions." },
    { key: "sort_order", doc: "Sort order in the decision view (higher first)." },
    {
      key: "should_create_alert",
      values: "block",
      doc: "Should this decision raise an alert, on top of the usual requirements.",
    },
    {
      key: "widget",
      values: "block",
      doc: "Embed a custom widget in the decision (see the .info Custom Widgets section).",
    },
  ],
  blocks: {
    picture: [
      {
        key: "trigger",
        values: "block",
        doc: "Trigger: receives the character scope. Empty trigger always passes.",
      },
      { key: "reference", doc: "Path to the texture." },
      { key: "soundeffect", doc: "Sound played when showing the decision details." },
    ],
    // title/desc/selection_tooltip/confirm_text "support dynamic descriptions
    // like in events (first_valid, ...)" per _decisions.info.
    title: DESC_NODE,
    desc: DESC_NODE,
    selection_tooltip: DESC_NODE,
    confirm_text: DESC_NODE,
    ...DESC_NODE_BLOCKS,
  },
};

// --- event (events/_events.info) ---
// Portrait blocks (left_portrait, right_portrait, …) share the `X = { ... }`
// shape documented once in the .info; wired to every portrait key below.
const EVENT_PORTRAIT_KEYS: KeySpec[] = [
  { key: "character", doc: "The portrait character (an event target)." },
  {
    key: "trigger",
    values: "block",
    doc: "Trigger: controls visibility of this portrait, in the scope of the portrait character.",
  },
  { key: "animation", doc: "Default animation (see animations.txt). Used if no triggered_animation passes." },
  { key: "scripted_animation", doc: "Scripted-animation key, an alternative to animation." },
  {
    key: "triggered_animation",
    values: "block",
    doc: "First triggered animation whose trigger passes is used.",
  },
  { key: "triggered_outfit", values: "block", doc: "First triggered outfit whose trigger passes is used." },
  { key: "camera", doc: "Camera key, overrides the portrait camera." },
  { key: "outfit_tags", values: "block", doc: "Outfit tags for this portrait, in ascending priority." },
  {
    key: "remove_default_outfit",
    values: "bool",
    doc: "Disable portrait-modifier categories that match no event tag.",
  },
  { key: "hide_info", values: "bool", doc: "Show only the portrait, with no CoA/tooltips/clicks." },
  {
    key: "animate_if_dead",
    values: "bool",
    doc: "Allow the portrait to animate even if the character is dead.",
  },
];

// The six override_* blocks share the `{ trigger reference }` shape documented
// in _events.info; only what `reference` names differs per block.
const EVENT_OVERRIDE_KEYS = (referenceDoc: string): KeySpec[] => [
  {
    key: "trigger",
    values: "block",
    doc: "Trigger: receives the event scope; the first entry whose trigger passes is used.",
  },
  { key: "reference", doc: referenceDoc },
];

const EVENT: StructureSpec = {
  topLevel: [
    {
      key: "type",
      values: "enum:character_event|letter_event|court_event|activity_event",
      freq: 9438,
      doc: "Event type. Optional, defaults to character_event.",
    },
    { key: "title", values: "loc", freq: 8714, doc: "Event title (loc key or dynamic description block)." },
    {
      key: "desc",
      values: "loc",
      freq: 9238,
      doc: "Event description (loc key or dynamic description block).",
    },
    { key: "theme", freq: 8719, doc: "Event theme (see 00_event_themes.txt)." },
    {
      key: "immediate",
      values: "block",
      freq: 8534,
      doc: "Effect: runs immediately when the event fires, before options.",
    },
    { key: "trigger", values: "block", freq: 5612, doc: "Trigger: gates whether the event may fire." },
    {
      key: "option",
      values: "block",
      freq: 22714,
      doc: "An option the player/AI can pick. Effects go inline; use trigger = {} to gate it.",
    },
    {
      key: "left_portrait",
      freq: 7626,
      doc: "Character portrait on the left. An event target, or a { character = … } block.",
    },
    {
      key: "right_portrait",
      freq: 6123,
      doc: "Character portrait on the right. An event target, or a { character = … } block.",
    },
    {
      key: "override_background",
      values: "block",
      freq: 5571,
      doc: "Background shown for this event, overriding the theme's. First valid trigger wins.",
    },
    {
      key: "override_transition",
      values: "block",
      doc: "Transition shown when the event pops up, before options and backgrounds; overrides the theme's. First valid trigger wins.",
    },
    {
      key: "override_effect_2d",
      values: "block",
      doc: "2D effect on top of the background, overriding the theme's. First valid trigger wins.",
    },
    {
      key: "override_icon",
      values: "block",
      doc: "Icon shown when the event pops up, overriding the theme's. First valid trigger wins.",
    },
    {
      key: "override_header_background",
      values: "block",
      doc: "Header asset behind the event icon, overriding the theme's. First valid trigger wins.",
    },
    {
      key: "override_sound",
      values: "block",
      doc: "Sound played when the event pops up, overriding the theme's. First valid trigger wins.",
    },
    { key: "after", values: "block", doc: "Effect: runs after an option is chosen." },
    {
      key: "scope",
      values: "enum:none|character|artifact",
      doc: "Overrides the event's root scope. Optional, defaults to character.",
    },
    { key: "hidden", values: "bool", doc: "If yes, no event window is shown." },
    { key: "major", values: "bool", doc: "Marks the event as major." },
    { key: "major_trigger", values: "block", doc: "Trigger: whether the event counts as major." },
    {
      key: "cooldown",
      values: "block",
      doc: "Per-event cooldown; the recipient root gets a saved variable for the duration.",
    },
    { key: "window", doc: "Custom event-window name (gui/event_windows)." },
    { key: "content_source", doc: "DLC or mod this event belongs to, shown in the window if set." },
    { key: "center_portrait", doc: "Center character portrait (not used in all event types)." },
    { key: "lower_left_portrait", doc: "Lower-left character portrait." },
    { key: "lower_center_portrait", doc: "Lower-center character portrait." },
    { key: "lower_right_portrait", doc: "Lower-right character portrait." },
    { key: "sender", doc: "Sender portrait; required for letter events." },
    { key: "opening", values: "loc", doc: "Opening text for letter events (loc key or dynamic desc block)." },
    { key: "artifact", values: "block", doc: "An artifact shown in the event at a portrait position." },
    { key: "court_scene", values: "block", doc: "Court-scene behavior for court events." },
    {
      key: "on_trigger_fail",
      values: "block",
      doc: "Effect: runs if a queued/instant event fails its trigger checks.",
    },
    {
      key: "widgets",
      values: "block",
      doc: "Custom widgets embedded in the event (see the .info Custom Widgets section).",
    },
    {
      key: "orphan",
      values: "bool",
      doc: "Suppress the unreferenced-event error log. Useful for debug events.",
    },
  ],
  blocks: {
    option: [
      { key: "name", values: "loc", freq: 24333, doc: "Option label (loc key or dynamic name block)." },
      { key: "trigger", values: "block", freq: 10098, doc: "Trigger: whether the option is valid." },
      {
        key: "ai_chance",
        values: "block",
        freq: 14542,
        doc: "Weight the AI gives this option (base + modifier blocks). See _scripted_modifiers.info.",
      },
      {
        key: "custom_tooltip",
        values: "loc",
        freq: 4518,
        doc: "Loc key for a custom tooltip on the option.",
      },
      {
        key: "first_valid",
        values: "block",
        freq: 3597,
        doc: "Dynamic-description node: use the first valid child.",
      },
      {
        key: "show_as_unavailable",
        values: "block",
        doc: "Trigger: show the option (disabled) even when invalid.",
      },
      {
        key: "ai_will_select",
        values: "block",
        doc: "Script-value form of the AI option weight (takes priority over ai_chance).",
      },
      {
        key: "highlight_portrait",
        doc: "Highlight this character's portrait while the option is hovered (a scope).",
      },
      {
        key: "skill",
        values: "enum:diplomacy|martial|stewardship|intrigue|learning|prowess",
        doc: "Marks the option as skill-relevant in the unlock-reason UI.",
      },
      { key: "trait", doc: "Marks the option as trait-relevant in the unlock-reason UI." },
      { key: "flag", doc: "Arbitrary reason string, checked in the UI for special styling." },
      {
        key: "fallback",
        values: "bool",
        doc: "If no regular options are valid, fallback options are considered.",
      },
      {
        key: "exclusive",
        values: "bool",
        doc: "If any exclusive option is valid, non-exclusive options are ignored.",
      },
      { key: "clicksound", doc: "Sound played when selecting this option." },
    ],
    left_portrait: EVENT_PORTRAIT_KEYS,
    right_portrait: EVENT_PORTRAIT_KEYS,
    center_portrait: EVENT_PORTRAIT_KEYS,
    lower_left_portrait: EVENT_PORTRAIT_KEYS,
    lower_center_portrait: EVENT_PORTRAIT_KEYS,
    lower_right_portrait: EVENT_PORTRAIT_KEYS,
    override_background: EVENT_OVERRIDE_KEYS(
      "The event background to show (a key from common/event_backgrounds, e.g. wilderness_mountains)."
    ),
    override_transition: EVENT_OVERRIDE_KEYS(
      "The event transition to show (a key from common/event_transitions)."
    ),
    override_effect_2d: EVENT_OVERRIDE_KEYS("The 2d effect to show (a key from common/event_2d_effects)."),
    override_icon: EVENT_OVERRIDE_KEYS("Path to the icon texture."),
    override_header_background: EVENT_OVERRIDE_KEYS("Path to the header texture."),
    override_sound: EVENT_OVERRIDE_KEYS("The sound to play (an event:/ sound reference)."),
    // desc/title/opening and option `name` accept dynamic-description blocks.
    desc: DESC_NODE,
    title: DESC_NODE,
    opening: DESC_NODE,
    name: DESC_NODE,
    ...DESC_NODE_BLOCKS,
  },
};

// --- on_action (common/on_action/_on_actions.info) ---
const ON_ACTION: StructureSpec = {
  topLevel: [
    {
      key: "trigger",
      values: "block",
      doc: "Trigger: if it returns false when the on_action fires, nothing happens.",
    },
    {
      key: "events",
      values: "block",
      doc: "Events that always fire if their trigger passes. Supports delay = { … } entries.",
    },
    { key: "random_events", values: "block", doc: "A single event is picked to fire, weighted." },
    { key: "first_valid", values: "block", doc: "The first event whose trigger passes is fired." },
    {
      key: "on_actions",
      values: "block",
      doc: "Further on_actions to chain (the compat-safe wiring pattern).",
    },
    {
      key: "random_on_action",
      values: "block",
      doc: "A single chained on_action is picked to fire, weighted.",
    },
    {
      key: "weight_multiplier",
      values: "block",
      doc: "Adjusts this on_action's weight when it is a candidate in a random_on_actions list.",
    },
    {
      key: "fallback",
      doc: "Event fired if nothing else in a random_events / random_on_action list is valid.",
    },
    { key: "effect", values: "block", doc: "Effect run when the on_action fires." },
  ],
};

// --- customizable_localization (common/customizable_localization/_custom_loc.info) ---
const CUSTOMIZABLE_LOCALIZATION: StructureSpec = {
  topLevel: [
    {
      key: "type",
      values:
        "enum:character|artifact|landed_title|province|activity|secret|scheme|combat|combat_side|title_and_vassal_change|faith|dynasty|all",
      doc: "Scope type the custom loc command is used in. `all` accepts any scope, at the cost of run-time (not read-time) errors.",
    },
    {
      key: "text",
      values: "block",
      doc: "A candidate text: trigger + localization_key. The first valid entry is used (or a random one with random_valid = yes).",
    },
    { key: "random_valid", values: "bool", doc: "Pick a random valid text instead of the first valid one." },
    {
      key: "parent",
      doc: "Variant: the parent custom loc key's logic runs, then `suffix` is appended to its result.",
    },
    { key: "suffix", doc: "Suffix appended to the parent's resolved loc key." },
  ],
  blocks: {
    text: [
      {
        key: "trigger",
        values: "block",
        doc: "Interface triggers; the first text whose trigger passes returns its localization_key.",
      },
      {
        key: "localization_key",
        values: "loc",
        doc: "The loc key this entry returns. Scopes saved in setup_scope are accessible in it.",
      },
      {
        key: "setup_scope",
        values: "block",
        doc: "Interface effects run before the trigger, save scopes here to use in the trigger and the loc key.",
      },
      { key: "fallback", values: "bool", doc: "Picked when no other entry is valid." },
    ],
  },
};

// --- story_cycle (common/story_cycles/_story_cycles.info) ---
const STORY_TRIGGERED_EFFECT: KeySpec[] = [
  {
    key: "trigger",
    values: "block",
    doc: "Condition for this effect. Root: the active story cycle (scope:story).",
  },
  { key: "effect", values: "block", doc: "Effect run when the trigger holds. Root: the active story cycle." },
];

const STORY_CYCLE: StructureSpec = {
  topLevel: [
    {
      key: "on_setup",
      values: "block",
      doc: "Effect run when the story is created. Root: the active story cycle (scope:story).",
    },
    { key: "on_end", values: "block", doc: "Effect run when the story is ended by the end_story effect." },
    {
      key: "on_owner_death",
      values: "block",
      doc: "Effect run when the story owner dies, a good time to set a new owner.",
    },
    {
      key: "effect_group",
      values: "block",
      doc: "Recurring effects: every days/weeks/months/years interval, with optional chance, at most one triggered effect fires.",
    },
  ],
  blocks: {
    effect_group: [
      { key: "days", doc: "Interval between attempts: a number or { min max } range." },
      { key: "weeks", doc: "Interval between attempts: a number or { min max } range." },
      { key: "months", doc: "Interval between attempts: a number or { min max } range." },
      { key: "years", doc: "Interval between attempts: a number or { min max } range." },
      {
        key: "chance",
        doc: "Chance (0–100) the group fires on each interval tick; otherwise retried next tick.",
      },
      {
        key: "trigger",
        values: "block",
        doc: "The group only fires while this holds. Root: the active story cycle.",
      },
      {
        key: "triggered_effect",
        values: "block",
        doc: "trigger + effect; only one independent triggered_effect per group.",
      },
      {
        key: "first_valid",
        values: "block",
        doc: "Runs the first inner triggered_effect whose trigger holds.",
      },
      { key: "random_valid", values: "block", doc: "Runs one random valid inner triggered_effect." },
      { key: "fallback", values: "block", doc: "Effect run when no triggered effect fired." },
    ],
    triggered_effect: STORY_TRIGGERED_EFFECT,
    icon: [
      {
        key: "trigger",
        values: "block",
        doc: "Optional trigger; the first valid icon is chosen. scope:story is the story cycle.",
      },
      {
        key: "reference",
        doc: "Path to the icon texture. Defaults to gfx/interface/icons/story_cycles/<story key>.dds.",
      },
    ],
    background: [
      { key: "trigger", values: "block", doc: "Optional trigger; the first valid background is chosen." },
      { key: "reference", doc: "Path to the background texture." },
    ],
  },
};

// --- modifier_definition_format (common/modifier_definition_formats/_definitions.info) ---
const MODIFIER_DEFINITION_FORMAT: StructureSpec = {
  topLevel: [
    { key: "decimals", doc: "Decimal places shown. Default: 2." },
    {
      key: "color",
      values: "enum:good|neutral|bad",
      doc: "Which way the number is colored. Default: bad (higher = red).",
    },
    { key: "prefix", values: "loc", doc: "Loc key shown before the value." },
    { key: "suffix", values: "loc", doc: "Loc key shown after the value." },
    { key: "negative_suffix", values: "loc", doc: "Used instead of suffix for negative numbers, when set." },
    { key: "percent", values: "bool", doc: "Format as a percentage by scaling the value up." },
    { key: "already_percent", values: "bool", doc: "Format as a percentage; the value is already scaled." },
    { key: "hidden", values: "bool", doc: "Hide this modifier from display." },
    { key: "no_difference_sign", values: "bool", doc: "Hide the +/- sign." },
    { key: "dlc_feature", doc: "Only show when the user has this DLC feature (e.g. diverge_culture)." },
  ],
};

const CURATED: Record<string, StructureSpec> = {
  character_interaction: CHARACTER_INTERACTION,
  decision: DECISION,
  event: EVENT,
  on_action: ON_ACTION,
  customizable_localization: CUSTOMIZABLE_LOCALIZATION,
  story_cycle: STORY_CYCLE,
  modifier_definition_format: MODIFIER_DEFINITION_FORMAT,
};

/**
 * Enum/doc patches over HARVESTED keys (kind → key → fields to fill in): the
 * .info harvest rarely captures value enumerations, and re-curating the whole
 * kind would distort the curated-first completion ranking. Patched in place
 * (order and freq preserved); appended at the tail when the key is missing.
 */
const KEY_PATCHES: Record<string, Record<string, Partial<KeySpec> & { doc?: string }>> = {
  trait: {
    valid_sex: { values: "enum:all|male|female", doc: "Which sex can have the trait. Default: all." },
  },
  scheme_type: {
    category: { values: "enum:personal|contract|hostile" },
  },
  activity_type: {
    province_filter: {
      values:
        "enum:capital|domain|realm|top_realm|holy_sites|holy_sites_domain|holy_sites_realm|domicile|domicile_domain|domicile_realm|top_liege_border_inner|top_liege_border_outer|landed_title|geographical_region|all",
    },
    ai_province_filter: {
      values:
        "enum:capital|domain|realm|top_realm|holy_sites|holy_sites_domain|holy_sites_realm|domicile|domicile_domain|domicile_realm|top_liege_border_inner|top_liege_border_outer|landed_title|geographical_region|all",
    },
  },
};

/**
 * All bundled structures, keyed by schema kind: the full harvested layer with
 * the curated specs layered on top (curated keys keep their docs/order; extra
 * harvested keys append after them, freq-ranked).
 */
export const STRUCTURES: Record<string, StructureSpec> = (() => {
  const merged: Record<string, StructureSpec> = {};
  for (const [kind, spec] of Object.entries(HARVESTED.kinds)) {
    // Harvested sub-blocks are carried through; a curated `blocks` for the same
    // kind replaces them wholesale below. The committed structures.json predates
    // the harvester's sub-block pass and has none, so this is inert until it is
    // regenerated (see scripts/build-structures-json.ts).
    merged[kind] = { topLevel: [...spec.topLevel], ...(spec.blocks && { blocks: spec.blocks }) };
  }
  for (const [kind, spec] of Object.entries(CURATED)) {
    const harvested = merged[kind]?.topLevel ?? [];
    const have = new Set(spec.topLevel.map((k) => k.key));
    // Keys declared in the curated NESTED blocks are known deeper-level
    // vocabulary; a harvested top-level copy of them is depth noise from the
    // .info prose, not evidence they belong at the top level.
    const nested = new Set(Object.values(spec.blocks ?? {}).flatMap((keys) => keys.map((k) => k.key)));
    merged[kind] = {
      topLevel: [
        // Curated keys win on docs/order, but inherit a harvested block scope
        // (`# root = X` in the .info) when they don't declare one themselves.
        ...spec.topLevel.map((k) => {
          const h = harvested.find((x) => x.key === k.key);
          return { ...k, ...(h?.scope && !k.scope ? { scope: h.scope } : {}), curated: true };
        }),
        ...harvested.filter((k) => !have.has(k.key) && !nested.has(k.key)),
      ],
      blocks: spec.blocks,
    };
  }
  for (const [kind, patches] of Object.entries(KEY_PATCHES)) {
    const spec = merged[kind];
    if (!spec) continue;
    for (const [key, patch] of Object.entries(patches)) {
      const existing = spec.topLevel.find((k) => k.key === key);
      if (existing) Object.assign(existing, patch);
      else spec.topLevel.push({ key, ...patch });
    }
  }
  return merged;
})();
