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
import type { Definition, Reference } from "@px-lsp/protocol/types";
import type { SchemaEntry } from "../schema/types";
import type { ServerData } from "../serverData";
import type { DefinitionIndex } from "../index/indexer";
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
  /** The index the info was built from. buildIndex installs a FRESH
   * DefinitionIndex whose revision restarts at 0, so a revision match alone
   * can hand back a map built from the previous index once the new one climbs
   * back to the same number. */
  index: DefinitionIndex;
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
  // chainedCalls(), not all(): the builder skips everything else anyway, and on
  // a big workspace that skip was 96% of a 4.1M-reference walk (perf round 2).
  const map = buildCallSiteScopes(data.refIndex.chainedCalls(), data.scopeModel, rootScopesForFile);
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
  /**
   * (root scopes, chain) → resolution, for the length of this build.
   *
   * Call sites repeat their chain relentlessly: an `immediate` or
   * `option.effect` chain occurs in every event file of a mod, and every file
   * of one schema folder shares one root-scope Set. Resolving each one from
   * scratch allocates several Sets per call site, and on game + AGOT that is
   * 175,373 resolutions collapsing to a few hundred distinct pairs.
   *
   * Keyed on the Set's IDENTITY, which is sound because rootScopesForFile
   * memoizes per file and hands back the same instance (server.ts). A caller
   * that returned fresh Sets would only lose the sharing, never correctness.
   * The cached Set is never handed out: both branches below copy it.
   */
  const byRoot = new Map<Set<Scope> | null, Map<string, Set<Scope> | null>>();
  // Call sites arrive grouped by file (ReferenceIndex.chainedCalls), so
  // remembering the last one answers for a whole file at a time: the lookup
  // itself has to lower-case a long path, and that measured 1.1 s of a request
  // when it ran per reference. Correct for ungrouped input too, just slower.
  let lastFile: string | undefined;
  let lastRootScopes: Set<Scope> | null = null;
  for (const ref of refs) {
    if (!ref.call || ref.chain === undefined) continue;
    if (ref.file !== lastFile) {
      lastFile = ref.file;
      lastRootScopes = rootScopesForFile(ref.file);
    }
    const rootScopes = lastRootScopes;
    let byChain = byRoot.get(rootScopes);
    if (!byChain) byRoot.set(rootScopes, (byChain = new Map()));
    let resolved = byChain.get(ref.chain);
    if (resolved === undefined) {
      resolved = resolveKeyChainScopes(ref.chain.split("."), model, rootScopes);
      byChain.set(ref.chain, resolved);
    }
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
  if (cached && cached.index === data.index && cached.revision === data.index.revision) return cached.info;
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
  cache.set(data, { index: data.index, revision: data.index.revision, info });
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
