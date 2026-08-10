/**
 * Static keyword-to-context table for block-context detection.
 *
 * Extending behavior is a one-line change here; the walking logic in context.ts
 * never needs to be touched. Keywords are matched lowercase.
 */

/** Blocks whose direct content is written in trigger grammar. */
export const TRIGGER_BLOCK_KEYWORDS = new Set<string>([
  "trigger",
  "limit",
  "alternative_limit",
  "potential",
  "allow",
  "is_shown",
  "is_valid",
  "is_valid_showing_failures_only",
  "can_start",
  "can_join",
  "can_pick",
  "can_pick_phase",
  "is_highlighted",
  "valid",
  "filter",
  "trigger_if",
  "trigger_else_if",
  "trigger_else",
  "calc_true_if",
  "custom_description", // contains a trigger plus text/subject keys
  "modifier", // mtth/chance modifier blocks contain triggers (+ add/factor)
  "compare_modifier",
  "opinion_modifier",
  "is_visible",
  "is_valid_demand",
  "can_send",
  "can_be_picked",
  "can_be_picked_title",
  "on_invalidated_trigger",
  "cancellation_trigger",
  "hidden_trigger",
  "show_as_tooltip_trigger",
]);

/** Blocks whose direct content is written in effect grammar. */
export const EFFECT_BLOCK_KEYWORDS = new Set<string>([
  "effect",
  "immediate",
  "after",
  "option", // options mix metadata keys with effects; effect is the useful default
  "on_accept",
  "on_decline",
  "on_send",
  "on_start",
  "on_end",
  "on_join",
  "on_leave",
  "on_complete",
  "on_success",
  "on_failure",
  "on_invalidated",
  "on_cancel",
  "on_monthly",
  "on_yearly",
  "on_activate",
  "on_deactivate",
  "then",
  "fallback",
  "hidden_effect",
  "show_as_tooltip",
  "random",
  "random_list",
  "creation_effect",
  "removal_effect",
  "success",
  "abort_effect",
]);

/**
 * Blocks whose direct content is script-value math: base/add/factor/modifier
 * keys plus iterators — NOT effects or plain triggers. `modifier` children
 * switch back to trigger grammar via TRIGGER_BLOCK_KEYWORDS.
 *
 * The math instruction keys themselves are included for their BLOCK form
 * (`add = { value = x if = { … } }` inside an effect or trigger): a math key
 * opening a block always contains math, wherever it appears. Scalar forms
 * (`add = 5`) never enter the block stack, so this cannot misfire there.
 */
export const VALUE_BLOCK_KEYWORDS = new Set<string>([
  "ai_chance",
  "ai_will_do",
  "weight",
  "weight_multiplier",
  "chance",
  "ai_value",
  "ai_will_revoke_title",
  "join_chance",
  "value",
  "add",
  "subtract",
  "multiply",
  "divide",
  "modulo",
  "min",
  "max",
  "base",
  "factor",
  "fixed_range",
  "integer_range",
]);

/**
 * Blocks that keep their parent's context: control flow, boolean operators and
 * scope changes. The context walk skips over these and keeps going up.
 */
export const TRANSPARENT_KEYWORDS = new Set<string>([
  "if",
  "else_if",
  "else",
  "while",
  "switch",
  "trigger_switch",
  "and",
  "or",
  "not",
  "nor",
  "nand",
  "all_false",
  "any_false",
  "custom_tooltip",
  "first_valid",
  "random_valid",
  "triggered_desc",
  "desc",
  "root",
  "this",
  "prev",
  "from",
  "liege",
  "mother",
  "father",
  "primary_spouse",
  "primary_title",
  "capital_province",
  "capital_county",
  "faith",
  "culture",
  "dynasty",
  "house",
  "top_liege",
  "court_owner",
  "employer",
  "holder",
  "county",
  "duchy",
  "kingdom",
  "empire",
  "title_province",
  "location",
  "province_owner",
  "barony",
  "barony_controller",
  "county_controller",
  "religion",
]);

export type KeywordClass = "trigger" | "effect" | "value" | "transparent" | "unknown";

/**
 * True when the keyword is EXPLICITLY listed in one of the four sets above —
 * i.e. classified by curation rather than by prefix heuristics. Scope inference
 * uses this to divert iterator-shaped non-iterators (random_list, random_valid).
 */
export function isExplicitKeyword(rawKeyword: string): boolean {
  const kw = rawKeyword.toLowerCase();
  return (
    TRIGGER_BLOCK_KEYWORDS.has(kw) ||
    EFFECT_BLOCK_KEYWORDS.has(kw) ||
    VALUE_BLOCK_KEYWORDS.has(kw) ||
    TRANSPARENT_KEYWORDS.has(kw)
  );
}

/**
 * Grammar words that can never be the call site of a scripted effect/trigger:
 * the exact keyword sets plus iterator- and prev-shaped keys. Deliberately
 * NARROWER than classifyKeyword's "not unknown" — its naming-convention
 * buckets (X_trigger blocks, on_X blocks) match the names modders give their
 * scripted triggers/effects, and those keys ARE call sites (#3, #5:
 * tribute_mission_1000_can_give_treasury_trigger = yes).
 */
export function isStructuralKeyword(rawKeyword: string): boolean {
  const kw = rawKeyword.toLowerCase();
  if (isExplicitKeyword(kw)) return true;
  if (/^(any|every|random|ordered)_/.test(kw)) return true;
  return /^prev+$/.test(kw);
}

export function classifyKeyword(rawKeyword: string): KeywordClass {
  const kw = rawKeyword.toLowerCase();
  if (TRIGGER_BLOCK_KEYWORDS.has(kw)) return "trigger";
  if (EFFECT_BLOCK_KEYWORDS.has(kw)) return "effect";
  if (VALUE_BLOCK_KEYWORDS.has(kw)) return "value";
  if (TRANSPARENT_KEYWORDS.has(kw)) return "transparent";
  // Iterators: any_* blocks are triggers; every_/random_/ordered_ blocks are effects
  // (their `limit` child switches back to trigger and is found first by the walk).
  if (kw.startsWith("any_")) return "trigger";
  if (kw.startsWith("every_") || kw.startsWith("random_") || kw.startsWith("ordered_")) return "effect";
  // Naming conventions the game's own .info docs follow: X_trigger blocks hold
  // triggers (cancellation_trigger, ai_target_quick_trigger…); on_X blocks hold
  // effects (on_auto_accept, on_intermediary_accept, on_blocked_effect…) —
  // except on_action(s), which lists on_action NAMES, not effects.
  if (kw.endsWith("_trigger")) return "trigger";
  if (kw.startsWith("on_") && kw !== "on_action" && kw !== "on_actions") return "effect";
  // Scope changers keep the parent context.
  if (
    kw.startsWith("scope:") ||
    kw.startsWith("var:") ||
    kw.startsWith("local_var:") ||
    kw.startsWith("global_var:")
  )
    return "transparent";
  if (/^prev+$/.test(kw)) return "transparent";
  return "unknown";
}
