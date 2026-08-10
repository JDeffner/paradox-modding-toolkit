/**
 * Variable/flag/list vocabulary of the Jomini script engine, shared by every
 * Jomini game (same `set_variable` / `add_to_variable_list` / flag effects in
 * all of them). Consumed by reference extraction, completion, hover and
 * semantic tokens; game profiles spread {@link JOMINI_VARIABLE_BLOCK_REFS}
 * into their own block-ref tables.
 */

/**
 * Variable vocabulary shared by reference extraction (server) and completion.
 * `var:` reads what set_variable wrote on the current scope object,
 * `local_var:` / `global_var:` the other storage classes. Lists live in the
 * same storage (has_variable is true for a list) — see references.ts.
 */
export const VARIABLE_SET_KINDS: Record<string, string> = {
  set_variable: "variable",
  change_variable: "variable",
  set_local_variable: "local_variable",
  change_local_variable: "local_variable",
  set_global_variable: "global_variable",
  change_global_variable: "global_variable",
};
export const VARIABLE_LIST_SET_KINDS: Record<string, string> = {
  add_to_variable_list: "variable_list",
  add_to_local_variable_list: "local_variable_list",
  add_to_global_variable_list: "global_variable_list",
};
/** Effects/triggers that READ a variable by name (scalar or `{ name = X }`). */
export const VARIABLE_READ_KINDS: Record<string, string> = {
  has_variable: "variable",
  remove_variable: "variable",
  clamp_variable: "variable",
  round_variable: "variable",
  has_local_variable: "local_variable",
  remove_local_variable: "local_variable",
  clamp_local_variable: "local_variable",
  round_local_variable: "local_variable",
  has_global_variable: "global_variable",
  remove_global_variable: "global_variable",
  clamp_global_variable: "global_variable",
  round_global_variable: "global_variable",
  has_variable_list: "variable_list",
  clear_variable_list: "variable_list",
  variable_list_size: "variable_list",
  is_target_in_variable_list: "variable_list",
  remove_list_variable: "variable_list",
  has_local_variable_list: "local_variable_list",
  clear_local_variable_list: "local_variable_list",
  local_variable_list_size: "local_variable_list",
  is_target_in_local_variable_list: "local_variable_list",
  remove_list_local_variable: "local_variable_list",
  has_global_variable_list: "global_variable_list",
  clear_global_variable_list: "global_variable_list",
  global_variable_list_size: "global_variable_list",
  is_target_in_global_variable_list: "global_variable_list",
  remove_list_global_variable: "global_variable_list",
};
/** `var:x` → candidate definition kinds (scalar first, list second). */
export const VAR_PREFIX_KINDS: Record<string, string[]> = {
  var: ["variable", "variable_list"],
  local_var: ["local_variable", "local_variable_list"],
  global_var: ["global_variable", "global_variable_list"],
};
/** All variable definition kinds (index/completion registration). */
export const VARIABLE_KINDS = [
  "variable",
  "local_variable",
  "global_variable",
  "variable_list",
  "local_variable_list",
  "global_variable_list",
];

/**
 * Block-local ref fields for the variable ops: in-list iterators
 * (`every_in_list = { variable = X }`) and the block forms of the
 * change/clamp/round/membership effects. Spread into each profile's
 * blockRefFields table.
 */
export const JOMINI_VARIABLE_BLOCK_REFS: Record<string, Record<string, string[]>> = {
  // Variable list iterators: `variable = X` names a variable list of the
  // matching storage class; `list = X` names an add_to_list-style ad-hoc list.
  ...inListIteratorRefs(),
  // Block-form variable ops: `name = X` references an existing variable.
  is_target_in_variable_list: { name: ["variable_list"] },
  remove_list_variable: { name: ["variable_list"] },
  variable_list_size: { name: ["variable_list"] },
  is_target_in_local_variable_list: { name: ["local_variable_list"] },
  remove_list_local_variable: { name: ["local_variable_list"] },
  local_variable_list_size: { name: ["local_variable_list"] },
  is_target_in_global_variable_list: { name: ["global_variable_list"] },
  remove_list_global_variable: { name: ["global_variable_list"] },
  global_variable_list_size: { name: ["global_variable_list"] },
  change_variable: { name: ["variable"] },
  clamp_variable: { name: ["variable"] },
  round_variable: { name: ["variable"] },
  change_local_variable: { name: ["local_variable"] },
  clamp_local_variable: { name: ["local_variable"] },
  round_local_variable: { name: ["local_variable"] },
  change_global_variable: { name: ["global_variable"] },
  clamp_global_variable: { name: ["global_variable"] },
  round_global_variable: { name: ["global_variable"] },
};

function inListIteratorRefs(): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  for (const prefix of ["every", "any", "random", "ordered"]) {
    out[`${prefix}_in_list`] = { variable: ["variable_list"], list: ["list"] };
    out[`${prefix}_in_local_list`] = { variable: ["local_variable_list"], list: ["list"] };
    out[`${prefix}_in_global_list`] = { variable: ["global_variable_list"], list: ["list"] };
  }
  return out;
}

const FLAG_REF_KEY = /^(?:has|remove)_[a-z_]*flag$/;
const LIST_REF_KEYS = new Set(["is_in_list", "is_target_in_list", "remove_from_list", "list"]);

/**
 * Ref kinds for key families too open-ended to enumerate in a profile's
 * refFields: per-scope flag triggers/effects (`has_character_flag`,
 * `remove_house_flag`, … → flags declared at `add_*_flag` sites) and list
 * membership (`is_in_list`, the `list =` key of in-list iterators → names
 * declared at `add_to_list`).
 */
export function dynamicRefKinds(key: string): string[] | null {
  if (FLAG_REF_KEY.test(key)) return ["flag"];
  if (LIST_REF_KEYS.has(key)) return ["list"];
  const varKind = VARIABLE_READ_KINDS[key];
  if (varKind) {
    // Scalar reads accept lists too (has_variable is true for a list variable).
    return varKind.endsWith("_list") ? [varKind] : [varKind, `${varKind}_list`];
  }
  return null;
}
