/**
 * The game type schema (rework plan AD-3): a *small*, declarative,
 * community-editable table describing what lives in each game folder — how
 * definitions are named, which loc keys a type requires, what scope its
 * script blocks run in, and which assignment keys cross-reference other
 * definitions.
 *
 * This is deliberately NOT a validation-rule language (that was CWTools'
 * mistake); deep semantic validation is the tiger validator's job. The schema feeds
 * navigation, completion, hover, references, rename, coverage and (very
 * conservative) structural diagnostics.
 */

/** How definition names are extracted from files in a folder. */
export type NameExtraction =
  /** One definition per top-level assignment key (`my_thing = { ... }`). */
  | "top-level-key"
  /** Event files: only `namespace.NNN` top-level keys are definitions. */
  | "event-id"
  /** Landed titles: keys matching /^[ekdcb]_/ at any nesting depth. */
  | "nested-title"
  /** GUI files: `type X = base { ... }` and `template X { ... }` statements. */
  | "gui-type"
  /** Localization yml entries. */
  | "loc-key";

/**
 * One documented key inside a definition's body or a named sub-block (v1.1 §B2).
 * `values` is a coarse value hint ("enum:a|b|c" for enumerations); `freq` is the
 * per-context usage count used for ranking (Workstream C).
 */
export interface KeySpec {
  key: string;
  doc?: string;
  values?: "loc" | "bool" | "block" | `enum:${string}`;
  freq?: number;
  /**
   * Root scope of the block this key opens, when the game's `_*.info` doc
   * declares one (`# root = the activity` → "activity"). Scope inference sets
   * the current scope to this when walking through the key.
   */
  scope?: string;
  /**
   * Hand-curated entry (structures.ts): its position in the curated list is
   * deliberate and outranks any harvested key. Harvested `.info` freqs count
   * usage at ANY depth in the folder, so re-sorting curated top-level keys by
   * them lets option-level keys (name, modifier…) bury the real top-level
   * vocabulary — the completion regression rank-eval caught in 2026-07.
   */
  curated?: boolean;
}

/** The document shape of a definition kind: top-level keys plus named sub-blocks. */
export interface StructureSpec {
  topLevel: KeySpec[];
  /** Named sub-blocks (option, send_option, cost…) with their own keys. */
  blocks?: Record<string, KeySpec[]>;
}

/** An engine-provided saved scope available in a kind's script blocks (v1.1 §B3). */
export interface AmbientScope {
  name: string;
  type: string;
  doc: string;
}

export interface SchemaEntry {
  /** Folder relative to the game/mod root, forward slashes, no trailing slash. */
  path: string;
  /** Definition kind, singular snake_case (e.g. "trait", "decision"). */
  kind: string;
  /** File extension, default ".txt". */
  ext?: string;
  /** Name extraction mode, default "top-level-key". */
  extraction?: NameExtraction;
  /**
   * Loc keys the game requires per definition; `$` is the definition name
   * (e.g. "trait_$", "$_desc"). Used for conservative missing-loc diagnostics
   * and loc coverage — only include patterns that ≥95% of vanilla definitions
   * of this kind actually define.
   */
  requiredLoc?: string[];
  /** Scope(s) a definition of this type pushes as root in its script blocks (Phase 3). */
  rootScopes?: string[];
  /** Include definitions of this kind in completion lists (default true).
   * False for huge/noisy kinds (history characters, provinces). */
  completable?: boolean;
  /**
   * Block-local structural keys for this kind (v1.1 §B2). Sourced from the game's
   * `_*.info` files. Static, not harvested at runtime. Not yet overlayable (F5).
   */
  structure?: StructureSpec;
  /** Engine-provided saved scopes for this kind (v1.1 §B3). Not yet overlayable (F5). */
  ambientScopes?: AmbientScope[];
}

/** Form a cross-reference field takes. */
export type RefFieldForm =
  /** `key = name` */
  | "scalar"
  /** `key = { name_a name_b ... }` */
  | "list"
  /** either of the above */
  | "both";

/** An assignment key whose value references definitions of the given kinds. */
export interface RefField {
  key: string;
  kinds: string[];
  form?: RefFieldForm; // default "scalar"
}

/** JSON shape of the optional workspace overlay at <configDir>/schema.json. */
export interface SchemaOverlay {
  entries?: SchemaEntry[];
  refFields?: RefField[];
  prefixRefs?: Record<string, string[]>;
}
