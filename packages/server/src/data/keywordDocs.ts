/**
 * Curated docs for grammar/math keywords that no other layer serves: script_docs
 * documents triggers/effects but not the glue vocabulary (limit, NOT, base…),
 * which the 2026-07 mod-coverage audit measured as the single biggest source of
 * empty hovers (~1400 uses in one mid-size mod). Served by hover as a fallback
 * card, so a real token/definition with the same name always wins.
 */

export const KEYWORD_DOCS: Record<string, string> = {
  // Control flow (effects)
  if: "Conditional effect: runs its contents when its `limit = { … }` trigger holds.",
  else_if: "Runs when the preceding if/else_if did not, and its own `limit` holds.",
  else: "Runs when the preceding if/else_if did not.",
  while: "Loop effect: repeats while `limit` holds, or `count` times.",
  switch: "Branches on one trigger: `switch = { trigger = x case_a = { … } fallback = { … } }`.",
  // Control flow (triggers)
  trigger_if: "Conditional trigger: contents are only checked when its `limit` holds.",
  trigger_else_if: "Checked when the preceding trigger_if did not apply and its own `limit` holds.",
  trigger_else: "Checked when the preceding trigger_if did not apply.",
  limit:
    "Trigger block: restricts the enclosing if / iterator / random_list entry to cases where these triggers hold.",
  alternative_limit: "Additional trigger set an iterator accepts when `limit` fails.",
  // Logic connectives
  AND: "All child triggers must be true (the implicit default).",
  OR: "At least one child trigger must be true.",
  NOT: "True when the child trigger is false. Alias of NOR: with several children, true when none hold.",
  NOR: "True when none of the child triggers are true.",
  NAND: "True when at least one child trigger is false.",
  calc_true_if: "True when at least `amount = N` of the listed triggers hold.",
  // Script-value math
  base: "Starting value of a script-value block; later steps (add, multiply…) modify it.",
  value: "Sets the current value directly — a number, another script value, or a scope chain.",
  add: "Adds to the current value (number, script value, or `{ … }` block). Inside weights, raises the weight.",
  subtract: "Subtracts from the current value.",
  multiply: "Multiplies the current value.",
  divide: "Divides the current value.",
  modulo: "Remainder of dividing the current value.",
  min: "Lower clamp of the surrounding script value.",
  max: "Upper clamp of the surrounding script value.",
  round: "Round to the nearest integer (yes/no).",
  ceiling: "Round up to an integer (yes/no).",
  floor: "Round down to an integer (yes/no).",
  fixed_range: "A uniformly random value between `min` and `max` (re-rolls each evaluation).",
  integer_range: "A uniformly random integer between `min` and `max`.",
  save_temporary_value_as:
    "Saves the current value of this script-value calculation under a name; read it back later in the same calculation as `scope:<name>`.",
  factor: "Multiplies the surrounding weight/value when the enclosing modifier's trigger holds.",
  weight: "Weight of this entry when the game picks one of several candidates.",
  // Durations & chances
  days: "Duration in days: a number, a `{ min max }` range, or a script value.",
  weeks: "Duration in weeks: a number, a range, or a script value.",
  months: "Duration in months: a number, a range, or a script value.",
  years: "Duration in years: a number, a range, or a script value.",
  chance: "Percent chance, 0–100.",
  // Iterators / lists
  count: "How many list members must match (a number or `all`), or how many times to repeat.",
  percent: "Fraction of list members that must match (0–1).",
  order_by: "Script value an ordered_ iterator sorts by (descending).",
  position: "0-based index the ordered_ iterator picks after sorting.",
  // Descriptions & misc
  trigger: "Trigger block: conditions that must hold for the surrounding item to apply or fire.",
  effect: "Effect block: commands run when the surrounding item fires.",
  desc: "Description: a loc key, or a dynamic-description block (first_valid / triggered_desc / random_valid).",
  namespace: "Declares this file's event-id namespace: events are then named `<namespace>.<n>`.",
  alias: "Alternate names for this game concept — each works in loc [Concept|E] links.",
  // ai_will_do / ai_chance modifier vocabulary (_scripted_modifiers.info)
  who: "Character whose opinion is measured, in an opinion_modifier weight.",
  opinion_target: "Character the opinion is about, in an opinion_modifier weight.",
  multiplier: "Weight applied per opinion/value point in opinion_modifier / compare_modifier.",
  step: "compare_modifier: granularity — the value is divided into steps of this size.",
};

/** Lowercase logic words double the uppercase forms. */
for (const k of ["AND", "OR", "NOT", "NOR", "NAND"]) {
  KEYWORD_DOCS[k.toLowerCase()] = KEYWORD_DOCS[k];
}

export const SCOPE_WORD_DOCS: Record<string, string> = {
  root: "The scope this script context started with (for an event: usually the event's target character).",
  this: "The current scope.",
  prev: "The scope before the last scope change. Chain for more steps back (prevprev…).",
  from: "The sending scope in event chains. Chain for more steps back (fromfrom…).",
};

/** Doc for root/this/prev(prev…)/from(from…), any case; null when not a scope word. */
export function scopeWordDoc(word: string): { name: string; doc: string } | null {
  const lower = word.toLowerCase();
  if (SCOPE_WORD_DOCS[lower]) return { name: lower, doc: SCOPE_WORD_DOCS[lower] };
  if (/^(?:prev)+$/.test(lower)) {
    const n = lower.length / 4;
    return { name: lower, doc: `The scope ${n} scope-changes back (chained \`prev\`).` };
  }
  if (/^(?:from)+$/.test(lower)) {
    const n = lower.length / 4;
    return { name: lower, doc: `The sender ${n} steps back in the event chain (chained \`from\`).` };
  }
  return null;
}
