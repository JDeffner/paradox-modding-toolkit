/**
 * Best-effort scope inference at a cursor position (rework plan AD-5): walk
 * the CST key stack from the schema-declared root scope through iterators,
 * links, dot-chains and scope:x references.
 *
 * The result RANKS and ANNOTATES, it never hides a completion and never
 * produces a diagnostic. "unknown" is a first-class outcome.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import { classifyKeyword, isExplicitKeyword } from "../contextKeywords";
import { walkStatements, type ParseResult, type Statement } from "../parser";
import { blockPathFromParse } from "../context";
import type { SchemaEntry, KeySpec } from "../schema/types";
import { activeProfile } from "../games/active";
import type { Scope, ScopeModel } from "./model";

export interface ScopeInference {
  /** Possible scopes at the cursor; null = unknown. */
  scopes: Set<Scope> | null;
  /** Human-readable chain, e.g. ["character", "every_held_title → landed_title"]. */
  chain: string[];
}

/** Extra context for inference (all optional; absence degrades to the old behavior). */
export interface InferenceContext {
  /** The file's schema entry: enables per-definition root-scope declarations
   *  (event `scope = X`, custom loc `type = X`, scripted_gui `scope = X`),
   *  structure keys with a documented block scope, and on_action roots. */
  entry?: SchemaEntry | null;
  /** on_action name → expected root scope (parsed from the user's on_actions.log). */
  onActionScopes?: ReadonlyMap<string, string>;
  /** Variable value types: "var:x" / "local_var:x" / "global_var:x" → scope set. */
  varTypes?: ReadonlyMap<string, Set<Scope> | null>;
  /** Variable-list ITEM types (same keying): resolves `every_in_list = { variable = x }`. */
  varListItemTypes?: ReadonlyMap<string, Set<Scope> | null>;
  /** Ad-hoc list ITEM types keyed by plain list name, resolved from the
   *  add_to_list/add_to_temporary_list set-sites indexed mod-wide:
   *  `every_in_list = { list = x }` resolves through it. */
  adhocListItemTypes?: ReadonlyMap<string, Set<Scope> | null>;
  /** Saved-scope types merged across all indexed save sites of the workspace
   *  mods: the fallback for scope: names not saved in the current file. */
  savedScopeTypes?: ReadonlyMap<string, Set<Scope> | null>;
  /** Calling scopes of scripted effects/triggers/modifiers aggregated from
   *  their call sites: the root fallback when no `@scope` tag declares one. */
  callSiteScopes?: ReadonlyMap<string, Set<Scope>>;
  /** PdxDoc `@scope` tag of a definition (scripted effects/triggers/values):
   *  lets modders declare the calling scope of reusable script. */
  defScopeTag?: (name: string) => Set<Scope> | null;
}

/** Kinds whose root scope is the CALL SITE's, a PdxDoc `@scope` tag declares it. */
const SCOPE_TAG_KINDS = new Set(["scripted_effect", "scripted_trigger", "script_value", "scripted_modifier"]);

/** Keys that never change scope (grammar keywords, control flow, weights). */
function isScopeTransparent(key: string): boolean {
  const cls = classifyKeyword(key);
  if (cls === "trigger" || cls === "effect" || cls === "value" || cls === "transparent") {
    // Iterators are classified trigger/effect by classifyKeyword but DO change
    // scope; they are handled before this check.
    return true;
  }
  return false;
}

const ITERATOR = /^(?:every|any|random|ordered)_/;
const IN_LIST_ITERATOR = /^(?:every|any|random|ordered)_in_(?:global_|local_)?list$/;

/**
 * Script-value math keys: as BLOCK keys they open math/desc blocks whose
 * triggers evaluate in the CALLING scope, they must never be resolved as the
 * same-named event-target links (`value` is a wildcard number link, `max` etc.).
 */
const MATH_KEYS = new Set([
  "value",
  "add",
  "factor",
  "base",
  "min",
  "max",
  "multiply",
  "divide",
  "subtract",
  "modulo",
  "round",
  "floor",
  "ceiling",
  "desc",
  "format",
]);

const VAR_PREFIX = /^(var|local_var|global_var):(.+)$/;

/**
 * Per-definition root-scope declarations, per game (profile.defRootKeys): a key
 * inside the top-level definition body names the root scope of that definition's
 * script blocks. A declared value of `none`/`all` means "any scope" → null.
 */

/**
 * Effective root scopes for the definition enclosing `offset`: per-definition
 * declarations and on_action names override the schema's per-kind rootScopes.
 */
export function rootScopesAt(
  parse: ParseResult,
  offset: number,
  fallback: Set<Scope> | null,
  ctx?: InferenceContext
): Set<Scope> | null {
  const kind = ctx?.entry?.kind;
  if (!kind) return fallback;
  const spec = activeProfile().defRootKeys?.[kind];
  if (!spec && kind !== "on_action" && !SCOPE_TAG_KINDS.has(kind)) return fallback;

  // Find the enclosing top-level statement.
  let top: Statement | null = null;
  for (const stmt of parse.root.statements) {
    if (offset >= stmt.range.start && offset <= stmt.range.end) {
      top = stmt;
      break;
    }
  }
  if (!top || top.kind !== "assignment") return fallback;

  if (kind === "on_action") {
    const scope = ctx?.onActionScopes?.get(top.key.text);
    if (scope && scope !== "none") return new Set([scope.toLowerCase()]);
    return fallback;
  }
  if (SCOPE_TAG_KINDS.has(kind)) {
    // The author's @scope tag wins; otherwise the calling scope aggregated
    // from the mod's call sites of this definition (varTypes.ts).
    return ctx?.defScopeTag?.(top.key.text) ?? ctx?.callSiteScopes?.get(top.key.text) ?? fallback;
  }

  if (top.value?.kind === "block") {
    for (const s of top.value.statements) {
      if (s.kind !== "assignment" || s.key.quoted || s.key.text !== spec!.key) continue;
      if (s.value?.kind !== "scalar" || s.value.quoted) continue;
      const declared = s.value.text.toLowerCase();
      if (declared === "none" || declared === "all") return null;
      const scope = spec!.values ? spec!.values[declared] : declared;
      if (scope) return new Set([scope]);
      break;
    }
  }
  return spec!.default ? new Set([spec!.default]) : fallback;
}

/** Structure key with a documented block scope for the entry's kind, if any. */
function structureKeyScope(entry: SchemaEntry | null | undefined, key: string): string | undefined {
  const structure = entry?.structure;
  if (!structure) return undefined;
  const find = (specs: KeySpec[] | undefined): string | undefined => {
    if (!specs) return undefined;
    for (const s of specs) if (s.key === key && s.scope) return s.scope;
    return undefined;
  };
  const top = find(structure.topLevel);
  if (top) return top;
  for (const specs of Object.values(structure.blocks ?? {})) {
    const hit = find(specs);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Saved-scope types for a file: run the stack walk at each save_scope_as site.
 * One level only (no recursive scope: resolution) to stay cheap and total.
 * `save_scope_value_as` sites save value/boolean/flag scopes;
 * `save_temporary_value_as` (script-value math) always saves a value scope.
 */
export function collectSavedScopeTypes(
  parse: ParseResult,
  model: ScopeModel,
  rootScopes: Set<Scope> | null,
  ambient?: ReadonlyArray<{ name: string; type: string }>,
  ctx?: InferenceContext
): Map<string, Set<Scope> | null> {
  const result = new Map<string, Set<Scope> | null>();
  // Ambient (engine-provided) scopes seed the map so `scope:actor = { … }`
  // infers character even though nothing save_scope_as's it (§B3). Real saves
  // below merge on top.
  for (const a of ambient ?? []) result.set(a.name, new Set([a.type]));
  const merge = (name: string, scopes: Set<Scope> | null) => {
    const prev = result.get(name);
    if (prev !== undefined) {
      if (prev === null || scopes === null) result.set(name, null);
      else for (const s of scopes) prev.add(s);
    } else {
      result.set(name, scopes ? new Set(scopes) : null);
    }
  };
  walkStatements(parse.root, (stmt) => {
    if (stmt.kind !== "assignment" || stmt.key.quoted) return;
    const key = stmt.key.text;
    if (key === "save_scope_as" || key === "save_temporary_scope_as") {
      if (stmt.value?.kind !== "scalar" || stmt.value.quoted) return;
      // Seed the walk with what is known so far, so a save inside
      // `scope:earlier_save = { … }` resolves (ambient names included).
      const inferred = inferScopeAt(parse, stmt.key.range.start, model, rootScopes, result, ctx);
      merge(stmt.value.text, inferred.scopes ? new Set(inferred.scopes) : null);
      return;
    }
    if (key === "save_temporary_value_as") {
      // Script-value math: saves the current numeric value, read back as scope:x.
      if (stmt.value?.kind !== "scalar" || stmt.value.quoted) return;
      merge(stmt.value.text, new Set(["value"]));
      return;
    }
    if (key === "save_scope_value_as" || key === "save_temporary_scope_value_as") {
      if (stmt.value?.kind !== "block") return;
      let name: string | null = null;
      let valueText: string | null = null;
      for (const s of stmt.value.statements) {
        if (s.kind !== "assignment" || s.key.quoted || s.value?.kind !== "scalar") continue;
        if (s.key.text === "name") name = s.value.text;
        else if (s.key.text === "value") valueText = s.value.text;
      }
      if (!name) return;
      merge(name, new Set([valueScopeType(valueText)]));
    }
  });
  return result;
}

/** The scope type a save_scope_value_as value produces (value/boolean/flag). */
function valueScopeType(valueText: string | null): Scope {
  if (valueText === "yes" || valueText === "no") return "boolean";
  if (valueText?.startsWith("flag:")) return "flag";
  return "value";
}

export function inferScopeAt(
  parse: ParseResult,
  offset: number,
  model: ScopeModel,
  rootScopes: Set<Scope> | null,
  savedScopes: Map<string, Set<Scope> | null>,
  ctx?: InferenceContext
): ScopeInference {
  const path = blockPathFromParse(parse, offset);
  const chain: string[] = [];
  const effectiveRoot = rootScopesAt(parse, offset, rootScopes, ctx);
  const rootSet = effectiveRoot ? new Set(effectiveRoot) : null;
  let current: Set<Scope> | null = rootSet ? new Set(rootSet) : null;
  const prevStack: Array<Set<Scope> | null> = [];
  if (rootSet) chain.push([...rootSet].join("|"));
  else chain.push("unknown");

  const apply = (segment: string, node?: Statement | null): void => {
    if (segment === "<anon>") return;
    // Dot-chains fold FIRST, so `scope:host.culture` resolves scope:host then
    // the culture link (the prefix checks below must see single segments).
    if (segment.includes(".")) {
      for (const part of segment.split(".")) apply(part);
      return;
    }
    const seg = segment; // keep original case for scope:x names
    const lower = seg.toLowerCase();

    if (lower === "root") {
      prevStack.push(current);
      current = rootSet ? new Set(rootSet) : null;
      chain.push(`root → ${fmt(current)}`);
      return;
    }
    if (lower === "this") return;
    if (lower === "prev") {
      // Scope-changing segments push the OLD scope; prev pops back to it, so
      // `prev.prev` walks two levels (each prev consumes one stack entry).
      current = prevStack.length > 0 ? (prevStack.pop() as Set<Scope> | null) : null;
      current = current ? new Set(current) : null;
      chain.push(`prev → ${fmt(current)}`);
      return;
    }
    if (seg.startsWith("scope:")) {
      const name = seg.slice(6);
      prevStack.push(current);
      // This file's save sites first; scopes saved elsewhere in the mod fall
      // back to the mod-wide static analysis (`??` also covers a local save
      // the walk could not type, the global merge includes that site too).
      const saved = savedScopes.get(name) ?? ctx?.savedScopeTypes?.get(name);
      current = saved ? new Set(saved) : null;
      chain.push(`scope:${name} → ${fmt(current)}`);
      return;
    }
    const varMatch = VAR_PREFIX.exec(seg);
    if (varMatch) {
      prevStack.push(current);
      const typed = ctx?.varTypes?.get(`${varMatch[1]}:${varMatch[2]}`);
      current = typed ? new Set(typed) : null;
      chain.push(`${seg} → ${fmt(current)}`);
      return;
    }
    // Script-value math keys open math blocks in the calling scope; never treat
    // them as the same-named links (`value` is a wildcard number link).
    if (MATH_KEYS.has(lower)) return;

    // Structure keys with a documented block scope (activity `is_valid` runs in
    // activity scope, building blocks in county scope, …) win over links.
    const structScope = structureKeyScope(ctx?.entry, lower);
    if (structScope) {
      prevStack.push(current);
      current = structScope === "none" || structScope === "all" ? null : new Set([structScope]);
      chain.push(`${lower} → ${fmt(current)}`);
      return;
    }

    if (ITERATOR.test(lower)) {
      // Explicitly-listed keywords that only LOOK like iterators keep the
      // scope: random_list / random_valid are weighted wrappers, not lists.
      if (isExplicitKeyword(lower)) return;
      const out = model.outputOf(lower);
      if (out) {
        prevStack.push(current);
        current = new Set(out);
        chain.push(`${lower} → ${fmt(current)}`);
        return;
      }
      if (IN_LIST_ITERATOR.test(lower)) {
        // Variable lists carry an item type from their add_to_*_variable_list
        // set-sites: `every_in_list = { variable = x }` resolves through it.
        // Ad-hoc `list = x` lists resolve through the mod-wide add_to_list
        // site analysis (ctx.adhocListItemTypes).
        let item: Set<Scope> | null = null;
        const varName = node ? childScalar(node, "variable") : null;
        if (varName && ctx?.varListItemTypes) {
          const ns = lower.includes("_in_global_")
            ? "global_var"
            : lower.includes("_in_local_")
              ? "local_var"
              : "var";
          item = ctx.varListItemTypes.get(`${ns}:${varName}`) ?? null;
        }
        if (!item) {
          const listName = node ? childScalar(node, "list") : null;
          if (listName && ctx?.adhocListItemTypes) item = ctx.adhocListItemTypes.get(listName) ?? null;
        }
        prevStack.push(current);
        current = item ? new Set(item) : null;
        chain.push(`${lower} → ${fmt(current)}`);
        return;
      }
      // Unknown every_/any_/random_/ordered_ name: most are structure keys or
      // scripted lists we could not resolve, keep the scope (never fatal).
      return;
    }
    const link = model.links.get(lower);
    if (link) {
      prevStack.push(current);
      current = link.outputs ? new Set(link.outputs) : null;
      chain.push(`${lower} → ${fmt(current)}`);
      return;
    }
    // Data links used with an argument: `culture:czech`, `special_guest:host`,
    // `title:k_france` …, the link table is keyed by the bare prefix.
    const colon = seg.indexOf(":");
    if (colon > 0) {
      const dataLink = model.links.get(lower.slice(0, colon));
      if (dataLink) {
        prevStack.push(current);
        current = dataLink.outputs ? new Set(dataLink.outputs) : null;
        chain.push(`${lower.slice(0, colon)}:… → ${fmt(current)}`);
        return;
      }
    }
    if (isScopeTransparent(lower)) return;
    // Unknown block key (scripted effect call, block-argument effect like
    // add_opinion): assume it keeps the scope, best effort, never fatal.
  };

  for (const node of path) {
    apply(node && node.kind === "assignment" ? node.key.text : "<anon>", node);
  }
  return { scopes: current, chain };
}

/**
 * Statically resolve a chain of enclosing block keys (outermost first, dotted
 * segments allowed) from a root-scope seed: the resolver behind ad-hoc list
 * item typing (`add_to_list` sites, varTypes.ts). Mirrors inferScopeAt's key
 * handling minus the CST/saved-scope/structure context, scope:/var: anchors
 * resolve to unknown, unknown keys keep the scope (best effort, never fatal).
 */
export function resolveKeyChainScopes(
  segments: readonly string[],
  model: ScopeModel,
  rootScopes: Set<Scope> | null
): Set<Scope> | null {
  const rootSet = rootScopes ? new Set(rootScopes) : null;
  let current: Set<Scope> | null = rootSet ? new Set(rootSet) : null;
  const prevStack: Array<Set<Scope> | null> = [];

  const apply = (segment: string): void => {
    if (segment.includes(".")) {
      for (const part of segment.split(".")) apply(part);
      return;
    }
    const seg = segment;
    const lower = seg.toLowerCase();
    if (lower === "" || lower === "this") return;
    if (lower === "root") {
      prevStack.push(current);
      current = rootSet ? new Set(rootSet) : null;
      return;
    }
    if (lower === "prev") {
      current = prevStack.length > 0 ? (prevStack.pop() as Set<Scope> | null) : null;
      current = current ? new Set(current) : null;
      return;
    }
    if (seg.startsWith("scope:") || VAR_PREFIX.test(seg)) {
      // Saved scopes / variables are per-file runtime context, unknowable here.
      prevStack.push(current);
      current = null;
      return;
    }
    if (MATH_KEYS.has(lower)) return;
    if (ITERATOR.test(lower)) {
      if (isExplicitKeyword(lower)) return;
      const out = model.outputOf(lower);
      if (out) {
        prevStack.push(current);
        current = new Set(out);
        return;
      }
      if (IN_LIST_ITERATOR.test(lower)) {
        prevStack.push(current);
        current = null;
        return;
      }
      return;
    }
    const link = model.links.get(lower);
    if (link) {
      prevStack.push(current);
      current = link.outputs ? new Set(link.outputs) : null;
      return;
    }
    const colon = seg.indexOf(":");
    if (colon > 0) {
      const dataLink = model.links.get(lower.slice(0, colon));
      if (dataLink) {
        prevStack.push(current);
        current = dataLink.outputs ? new Set(dataLink.outputs) : null;
        return;
      }
    }
    // Grammar keywords and unknown effect/trigger keys keep the scope.
  };

  for (const seg of segments) apply(seg);
  return current;
}

/** Direct child `key = <scalar>` of a statement's block value, if any. */
function childScalar(stmt: Statement, key: string): string | null {
  if (stmt.kind !== "assignment" || stmt.value?.kind !== "block") return null;
  for (const s of stmt.value.statements) {
    if (
      s.kind === "assignment" &&
      !s.key.quoted &&
      s.key.text === key &&
      s.value?.kind === "scalar" &&
      !s.value.quoted
    ) {
      return s.value.text;
    }
  }
  return null;
}

function fmt(scopes: Set<Scope> | null): string {
  if (!scopes || scopes.size === 0) return "unknown";
  return [...scopes].join("|");
}
