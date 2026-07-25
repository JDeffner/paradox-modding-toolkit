/**
 * Variable value-type resolution: what scope does `var:x` produce?
 *
 * Set-sites indexed by references.ts carry the raw value expression
 * (`set_variable = { name = x value = <expr> }` → Definition.value = expr).
 * This module resolves those expressions STATICALLY — literals, flags and
 * link chains anchored at root or a global data link — and merges the types
 * across all set-sites of a name. Anything anchored in a runtime scope
 * (`scope:…`, `this`, bare links) stays unknown: annotate, never guess (AD-5).
 *
 * The full map is rebuilt lazily once per index revision (variables only —
 * cheap even for AGOT-sized mods) and consumed by scope inference
 * (`ctx.varTypes`), hover and completion detail.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import type { Definition, Reference } from "@paradox-lsp/protocol/types";
import type { SchemaEntry } from "../schema/types";
import type { ServerData } from "../serverData";
import { resolveKeyChainScopes, type InferenceContext } from "./inference";
import type { Scope, ScopeModel } from "./model";

const VAR_KIND_PREFIX: Record<string, string> = {
  variable: "var",
  local_variable: "local_var",
  global_variable: "global_var",
};

/** Variable-list item types, keyed `var:x`-style by the LIST's storage class. */
const LIST_KIND_PREFIX: Record<string, string> = {
  variable_list: "var",
  local_variable_list: "local_var",
  global_variable_list: "global_var",
};

const NUMBER = /^-?\d+(?:\.\d+)?$/;

export interface VariableTypeInfo {
  /** `var:x` / `local_var:x` / `global_var:x` → merged value types (null = unknown). */
  types: Map<string, Set<Scope> | null>;
  /** `var:x`-keyed ITEM types of variable lists (for in-list iterator hovers). */
  listItemTypes: Map<string, Set<Scope> | null>;
  /** Plain-named ITEM types of ad-hoc lists (add_to_list/add_to_temporary_list
   * sites): the set-site's enclosing key chain resolved statically. */
  adhocListItemTypes: Map<string, Set<Scope> | null>;
  /** Saved-scope types merged across ALL indexed save sites of the workspace
   * mods — the cross-file fallback when a scope: name is not saved in the
   * current file. Sites carry a discriminated hint in Definition.value
   * (index/references.ts): "chain:" key chains, "expr:" value expressions,
   * "type:value" script-value saves. */
  savedScopeTypes: Map<string, Set<Scope> | null>;
}

interface Cache {
  revision: number;
  info: VariableTypeInfo;
}

const cache = new WeakMap<ServerData, Cache>();

/**
 * PdxDoc `@scope` tag of a definition (`# @scope character` above a scripted
 * effect/trigger/value): the calling scope the author declared. Null when the
 * definition carries no tag.
 */
export function defScopeTag(data: ServerData, name: string): Set<Scope> | null {
  for (const def of data.index.lookup(name)) {
    const tag = def.tags?.find((t) => t.tag === "scope");
    if (tag && tag.text.trim()) {
      const scopes = tag.text
        .split(/[|,\s/]+/)
        .map((x) => x.trim().toLowerCase())
        .filter((x) => x !== "");
      if (scopes.length > 0) return new Set(scopes);
    }
  }
  return null;
}

/**
 * The one canonical InferenceContext for a file. Every feature (completion,
 * hover, inlay hints, audit script) MUST build its context through here:
 * getSavedScopes caches its result per document version, so callers passing
 * divergent contexts would make hover/completion results depend on which
 * request happened to arrive first.
 */
export function inferenceContextFor(data: ServerData, entry: SchemaEntry | null): InferenceContext {
  const varInfo = variableTypes(data, data.rootScopesForFile);
  return {
    entry,
    onActionScopes: data.onActionScopes,
    varTypes: varInfo.types,
    varListItemTypes: varInfo.listItemTypes,
    adhocListItemTypes: varInfo.adhocListItemTypes,
    savedScopeTypes: varInfo.savedScopeTypes,
    callSiteScopes: callSiteScopes(data, data.rootScopesForFile),
    defScopeTag: (name) => defScopeTag(data, name),
  };
}

interface CallSiteCache {
  revision: string;
  map: Map<string, Set<Scope>>;
}

const callSiteCache = new WeakMap<ServerData, CallSiteCache>();

/**
 * Calling scopes of scripted effects/triggers/modifiers aggregated from their
 * indexed call sites (rebuilt when either index changes). The root-scope
 * fallback for definitions without a PdxDoc `@scope` tag.
 */
export function callSiteScopes(
  data: ServerData,
  rootScopesForFile: (file: string) => Set<Scope> | null
): Map<string, Set<Scope>> {
  const revision = `${data.index.revision}:${data.refIndex.revision}`;
  const cached = callSiteCache.get(data);
  if (cached && cached.revision === revision) return cached.map;
  const map = buildCallSiteScopes(data.refIndex.all(), data.scopeModel, rootScopesForFile);
  callSiteCache.set(data, { revision, map });
  return map;
}

/**
 * Union of the statically resolved scopes at every call site of a name.
 * Unresolved sites (unknown-root files, dynamic anchors) contribute NOTHING —
 * unlike the variable/list maps this does not poison, because an unresolved
 * call site carries no information about the calling scope. One level only:
 * calls inside other untyped scripted effects stay unresolved (no transitive
 * closure). Ranking/annotation input only, never a diagnostic (AD-5).
 */
export function buildCallSiteScopes(
  refs: Iterable<Reference>,
  model: ScopeModel,
  rootScopesForFile: (file: string) => Set<Scope> | null
): Map<string, Set<Scope>> {
  const map = new Map<string, Set<Scope>>();
  for (const ref of refs) {
    if (!ref.call || ref.chain === undefined) continue;
    const resolved = resolveKeyChainScopes(ref.chain.split("."), model, rootScopesForFile(ref.file));
    if (!resolved || resolved.size === 0) continue;
    const prev = map.get(ref.name);
    if (prev) for (const s of resolved) prev.add(s);
    else map.set(ref.name, new Set(resolved));
  }
  return map;
}

/** The variable type map for the current index revision (cached). */
export function variableTypes(
  data: ServerData,
  rootScopesForFile: (file: string) => Set<Scope> | null
): VariableTypeInfo {
  const cached = cache.get(data);
  if (cached && cached.revision === data.index.revision) return cached.info;
  const info = buildVariableTypes(
    data.index.entries(
      (d) =>
        d.kind in VAR_KIND_PREFIX ||
        d.kind in LIST_KIND_PREFIX ||
        d.kind === "list" ||
        d.kind === "saved_scope"
    ),
    data.scopeModel,
    rootScopesForFile
  );
  cache.set(data, { revision: data.index.revision, info });
  return info;
}

export function buildVariableTypes(
  defs: Iterable<Definition>,
  model: ScopeModel,
  rootScopesForFile: (file: string) => Set<Scope> | null
): VariableTypeInfo {
  const types = new Map<string, Set<Scope> | null>();
  const listItemTypes = new Map<string, Set<Scope> | null>();
  const adhocListItemTypes = new Map<string, Set<Scope> | null>();
  const savedScopeTypes = new Map<string, Set<Scope> | null>();
  const merge = (map: Map<string, Set<Scope> | null>, key: string, resolved: Set<Scope> | null) => {
    const prev = map.get(key);
    if (prev === undefined) {
      map.set(key, resolved ? new Set(resolved) : null);
    } else if (prev === null || resolved === null) {
      map.set(key, null);
    } else {
      for (const s of resolved) prev.add(s);
    }
  };
  for (const def of defs) {
    // Ad-hoc lists: def.value is the set-site's enclosing key chain (dotted,
    // outermost first — see index/references.ts), resolved from the file root.
    if (def.kind === "list") {
      if (def.value === undefined) continue;
      const resolved = resolveKeyChainScopes(def.value.split("."), model, rootScopesForFile(def.file));
      merge(adhocListItemTypes, def.name, resolved);
      continue;
    }
    // Saved scopes: typed per save form via the discriminated value hint.
    if (def.kind === "saved_scope") {
      merge(savedScopeTypes, def.name, resolveSavedScopeHint(def, model, rootScopesForFile));
      continue;
    }
    const varPrefix = VAR_KIND_PREFIX[def.kind];
    const listPrefix = LIST_KIND_PREFIX[def.kind];
    if (!varPrefix && !listPrefix) continue;
    // Defs without an expression (change_variable sites, dual-indexed list
    // shadows) contribute nothing — they evidence existence, not type.
    if (def.value === undefined) continue;
    const resolved = resolveValueExpr(def.value, def.file, model, rootScopesForFile);
    if (varPrefix) merge(types, `${varPrefix}:${def.name}`, resolved);
    else merge(listItemTypes, `${listPrefix}:${def.name}`, resolved);
  }
  return { types, listItemTypes, adhocListItemTypes, savedScopeTypes };
}

/** Resolve one save site's discriminated type hint; null = unknown. Sites
 * without a hint (older index rows) contribute unknown, poisoning the merge —
 * annotate, never guess (AD-5). */
function resolveSavedScopeHint(
  def: Definition,
  model: ScopeModel,
  rootScopesForFile: (file: string) => Set<Scope> | null
): Set<Scope> | null {
  const hint = def.value;
  if (hint === undefined) return null;
  if (hint === "type:value") return new Set(["value"]);
  if (hint.startsWith("expr:")) {
    return resolveValueExpr(hint.slice(5), def.file, model, rootScopesForFile);
  }
  if (hint.startsWith("chain:")) {
    return resolveKeyChainScopes(hint.slice(6).split("."), model, rootScopesForFile(def.file));
  }
  return null;
}

/**
 * Statically resolve a set_variable value expression to the scope type(s) it
 * produces; null = unknown. Handles literals (value/boolean/flag) and link
 * chains anchored at `root` (the set-file's root scope) or a global data link
 * (`culture:x.head_of_faith` …). Runtime anchors resolve to null.
 */
export function resolveValueExpr(
  expr: string,
  file: string,
  model: ScopeModel,
  rootScopesForFile: (file: string) => Set<Scope> | null
): Set<Scope> | null {
  if (NUMBER.test(expr)) return new Set(["value"]);
  if (expr === "yes" || expr === "no") return new Set(["boolean"]);
  if (expr.startsWith("flag:")) return new Set(["flag"]);
  if (expr.includes("$")) return null; // macro parameter

  const parts = expr.split(".");
  let current: Set<Scope> | null;

  const first = parts[0];
  if (first === "root") {
    current = rootScopesForFile(file);
  } else if (
    first.startsWith("scope:") ||
    first.startsWith("var:") ||
    first.startsWith("local_var:") ||
    first.startsWith("global_var:") ||
    first === "this" ||
    first === "prev"
  ) {
    return null; // runtime anchor — unknowable statically
  } else {
    // Global/data link anchor: culture:x, faith:x, character:123, title:k_x …
    const colon = first.indexOf(":");
    const linkName = colon > 0 ? first.slice(0, colon) : first;
    const link = model.links.get(linkName.toLowerCase());
    if (!link || !link.outputs) return null;
    // A bare link (no data argument) needs an input scope — unknowable here.
    if (colon <= 0 && link.inputs !== null) return null;
    current = new Set(link.outputs);
  }
  if (!current) return null;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].toLowerCase();
    const colon = part.indexOf(":");
    const link = model.links.get(colon > 0 ? part.slice(0, colon) : part);
    if (!link || !link.outputs) return null;
    current = new Set(link.outputs);
  }
  return current;
}
