/**
 * Schema-driven reference extraction over the CST: which names a script file
 * *uses* — cross-reference fields (trigger_event = ..., has_trait = ...),
 * prefixed values (culture:czech, scope:target), loc-key-valued properties —
 * plus the definitions that only exist as usage sites (save_scope_as,
 * set_variable) and the event namespaces a file declares.
 *
 * References power find-all-references, rename, unused detection, coverage
 * and the event graph. Extracted for mod (and parent) files only; vanilla
 * references are computed lazily on demand (rework plan AD-4).
 *
 * No `vscode` imports here: unit-tested in plain Node.
 */
import type { Definition, DefSource, Reference } from "@px-lsp/protocol/types";
import {
  dynamicRefKinds,
  VARIABLE_SET_KINDS,
  VARIABLE_LIST_SET_KINDS,
  VARIABLE_READ_KINDS,
  VAR_PREFIX_KINDS,
  variableReadKinds,
} from "../games/jomini/variables";
import { activeProfile } from "../games/active";
import { isLocProperty } from "@px-lsp/protocol/locProperties";
import { isStructuralKeyword } from "../contextKeywords";
import { intern, shareDefinitionStrings, shareReferenceStrings } from "./intern";
import type { SchemaData } from "../schema/loader";
import {
  LineIndex,
  parseScript,
  walkStatements,
  type AssignmentNode,
  type BlockNode,
  type RootNode,
  type ScalarNode,
  type Statement,
} from "../parser";

const NAME_OK = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
/** Words that are never references even in name position. */
const NOT_A_NAME = new Set(["yes", "no", "this", "root", "prev", "from"]);

const PREFIX_VALUE = /^([a-z_]+):([A-Za-z0-9_\-.']+)/;

/** `save_temporary_value_as` (script-value math) is read back as scope:x too. */
const SAVE_SCOPE_KEYS = new Set(["save_scope_as", "save_temporary_scope_as", "save_temporary_value_as"]);
const SAVE_SCOPE_VALUE_KEYS = new Set(["save_scope_value_as", "save_temporary_scope_value_as"]);
/** `add_character_flag = X` / `add_house_flag = { flag = X … }` — flag declarations. */
const FLAG_SET_KEY = /^(?:add|set)_[a-z_]*flag$/;
const LIST_SET_KEYS = new Set(["add_to_list", "add_to_temporary_list"]);

const VAR_PREFIXES = new Set(Object.keys(VAR_PREFIX_KINDS));

/** What a key-position call (`my_effect = yes`) may refer to. */
const CALL_KINDS = ["scripted_effect", "scripted_trigger", "scripted_modifier"];

/**
 * Shared `kinds` arrays for the sites that used to build one per reference
 * (perf round 3). Nothing mutates a reference's `kinds` — the only reader is
 * `ReferenceIndex.byKind` — so one array per distinct kind set is enough, and
 * at 7.5M references on a game + 5 mods workspace the per-reference array
 * header and backing store were worth hundreds of megabytes.
 */
const SAVED_SCOPE_KINDS = ["saved_scope"];
const LOC_KEY_KINDS = ["loc_key"];

export interface ExtractedRefs {
  references: Reference[];
  /** save_scope_as / set_variable sites, indexed as definitions. */
  implicitDefs: Definition[];
  /** `namespace = x` declarations in this file. */
  namespaces: string[];
}

export function extractReferences(
  content: string,
  file: string,
  source: DefSource,
  schema: SchemaData,
  /** Engine-token test (script_docs names): call sites of engine effects/
   * triggers are NOT indexed — they dominate large mods (AGOT: ~800k sites)
   * and their docs come from tokens, not the index. Absent = index all. */
  isEngineToken?: (name: string) => boolean
): ExtractedRefs {
  const { root } = parseScript(content);
  return extractReferencesParsed(root, new LineIndex(content), file, source, schema, isEngineToken);
}

/**
 * The body of `extractReferences` over a CST the caller already has.
 *
 * The mod scan reads and parses each script file once and feeds that parse to
 * both extractors (see `extractDefinitionsParsed`). `extractReferences` above
 * is the same function with the parse in front and stays the entry point for
 * the incremental rescan and for callers holding only text.
 */
export function extractReferencesParsed(
  root: RootNode,
  lines: LineIndex,
  file: string,
  source: DefSource,
  schema: SchemaData,
  isEngineToken?: (name: string) => boolean
): ExtractedRefs {
  const references: Reference[] = [];
  const implicitDefs: Definition[] = [];
  const namespaces: string[] = [];

  const pushRef = (name: string, kinds: string[], startOffset: number, call?: boolean, chain?: string) => {
    if (!NAME_OK.test(name) || NOT_A_NAME.has(name)) return;
    const pos = lines.positionAt(startOffset);
    const ref: Reference = {
      name,
      kinds,
      file,
      line: pos.line,
      startChar: pos.character,
      endChar: pos.character + name.length,
    };
    if (call) ref.call = true;
    if (chain !== undefined) ref.chain = chain;
    references.push(ref);
  };

  /** A scalar in value position: prefixed references and dotted chains. */
  const scanValueScalar = (scalar: ScalarNode) => {
    if (scalar.quoted) return;
    const text = scalar.text;
    const m = PREFIX_VALUE.exec(text);
    if (!m) return;
    const prefix = m[1];
    let name = m[2];
    // `culture:czech.some_link` — the reference is the segment before the dot.
    const dot = name.indexOf(".");
    if (dot >= 0) name = name.slice(0, dot);
    const offset = scalar.range.start + prefix.length + 1;
    if (VAR_PREFIXES.has(prefix)) {
      pushRef(name, VAR_PREFIX_KINDS[prefix], offset);
    } else if (prefix === "scope") {
      pushRef(name, SAVED_SCOPE_KINDS, offset);
    } else {
      const kinds = schema.prefixRefs[prefix];
      if (kinds) pushRef(name, kinds, offset);
    }
  };

  const topLevelName = (ancestors: readonly (AssignmentNode | BlockNode)[]): string | undefined => {
    for (const a of ancestors) {
      if (a.kind === "assignment" && !a.key.quoted) return a.key.text;
    }
    return undefined;
  };

  /** Enclosing key chain below the top-level definition, dotted, outermost
   * first — the static-resolution input for resolveKeyChainScopes. */
  const enclosingKeyChain = (ancestors: readonly (AssignmentNode | BlockNode)[]): string => {
    const chainKeys: string[] = [];
    let sawTopLevel = false;
    for (const a of ancestors) {
      if (a.kind !== "assignment") continue;
      if (!sawTopLevel) {
        sawTopLevel = true;
        continue;
      }
      if (!a.key.quoted) chainKeys.push(a.key.text);
    }
    return chainKeys.join(".");
  };

  walkStatements(root, (stmt: Statement, ancestors) => {
    if (stmt.kind === "value") {
      if (stmt.value.kind === "scalar") scanValueScalar(stmt.value);
      return;
    }
    // Assignment: the key itself may be a scope/var change (scope:x = { ... }).
    if (!stmt.key.quoted) {
      const keyText = stmt.key.text;
      const km = PREFIX_VALUE.exec(keyText);
      if (km) {
        const prefix = km[1];
        let name = km[2];
        const dot = name.indexOf(".");
        if (dot >= 0) name = name.slice(0, dot);
        const offset = stmt.key.range.start + prefix.length + 1;
        if (VAR_PREFIXES.has(prefix)) pushRef(name, VAR_PREFIX_KINDS[prefix], offset);
        else if (prefix === "scope") pushRef(name, SAVED_SCOPE_KINDS, offset);
      }
    }

    const key = stmt.key.quoted ? null : stmt.key.text;
    const value = stmt.value;

    // namespace declarations
    if (key === "namespace" && value?.kind === "scalar" && !value.quoted && ancestors.length === 0) {
      namespaces.push(value.text);
      return;
    }

    // save_scope_as = my_target  → implicit definition. def.value carries a
    // discriminated type hint for mod-wide saved-scope typing (varTypes.ts):
    // "chain:<keys>" = resolve the save site's enclosing key chain statically;
    // "type:value" = script-value math save (always a value scope).
    if (key !== null && SAVE_SCOPE_KEYS.has(key) && value?.kind === "scalar" && !value.quoted) {
      if (NAME_OK.test(value.text)) {
        // `value` and `container` go IN the literal (perf round 3): assigning
        // an optional field after the object is built moves it into a
        // PropertyArray, measured at 40 B against 16 B for two in-object slots.
        const def: Definition = {
          name: value.text,
          kind: "saved_scope",
          file,
          line: lines.positionAt(value.range.start).line,
          source,
          value: key === "save_temporary_value_as" ? "type:value" : `chain:${enclosingKeyChain(ancestors)}`,
          container: topLevelName(ancestors),
        };
        implicitDefs.push(def);
      }
      return;
    }

    // save_scope_value_as = { name = X value = … } → implicit saved_scope
    // definition (a value/boolean/flag scope, but referenced via scope:X all the same).
    if (key !== null && SAVE_SCOPE_VALUE_KEYS.has(key) && value?.kind === "block") {
      let nameScalar: ScalarNode | null = null;
      let exprScalar: ScalarNode | null = null;
      for (const s of value.statements) {
        if (s.kind !== "assignment" || s.key.quoted || s.value?.kind !== "scalar") continue;
        if (s.key.text === "name") nameScalar = s.value;
        else if (s.key.text === "value") exprScalar = s.value;
      }
      if (nameScalar && !nameScalar.quoted && NAME_OK.test(nameScalar.text)) {
        const def: Definition = {
          name: nameScalar.text,
          kind: "saved_scope",
          file,
          line: lines.positionAt(nameScalar.range.start).line,
          source,
        };
        // "expr:<expr>" — typed by resolving the value expression statically.
        if (exprScalar && !exprScalar.quoted) def.value = `expr:${exprScalar.text}`;
        const container = topLevelName(ancestors);
        if (container !== undefined) def.container = container;
        implicitDefs.push(def);
      }
      return;
    }

    // add_character_flag = x / add_*_flag = { flag = x } and add_to_list = x
    // → implicit definitions, referenced by has_*_flag / is_in_list.
    if (key !== null && value && (FLAG_SET_KEY.test(key) || LIST_SET_KEYS.has(key))) {
      const kind = LIST_SET_KEYS.has(key) ? "list" : "flag";
      let nameScalar: ScalarNode | null = null;
      if (value.kind === "scalar" && !value.quoted) nameScalar = value;
      else if (value.kind === "block" && kind === "flag") {
        for (const s of value.statements) {
          if (
            s.kind === "assignment" &&
            !s.key.quoted &&
            s.key.text === "flag" &&
            s.value?.kind === "scalar"
          ) {
            nameScalar = s.value;
            break;
          }
        }
      }
      if (
        nameScalar &&
        !nameScalar.quoted &&
        NAME_OK.test(nameScalar.text) &&
        !nameScalar.text.includes(":")
      ) {
        const def: Definition = {
          name: nameScalar.text,
          kind,
          file,
          line: lines.positionAt(nameScalar.range.start).line,
          source,
        };
        // List set-sites carry the enclosing key chain (below the top-level
        // definition, outermost first) so the item scope can be resolved
        // statically mod-wide (resolveKeyChainScopes in scopes/inference.ts).
        if (kind === "list") def.value = enclosingKeyChain(ancestors);
        const container = topLevelName(ancestors);
        if (container !== undefined) def.container = container;
        implicitDefs.push(def);
      }
      return;
    }

    // set_variable = { name = x value = y } / set_variable = x → implicit
    // definition(s) in the right namespace; list set-sites dual-index (see
    // VARIABLE_SET_KINDS docs in the shared schema).
    const setKind = key !== null ? (VARIABLE_SET_KINDS[key] ?? VARIABLE_LIST_SET_KINDS[key]) : undefined;
    if (key !== null && setKind && value) {
      let nameScalar: ScalarNode | null = null;
      let exprScalar: ScalarNode | null = null;
      if (value.kind === "scalar" && !value.quoted) nameScalar = value;
      else if (value.kind === "block") {
        for (const s of value.statements) {
          if (s.kind !== "assignment" || s.key.quoted || s.value?.kind !== "scalar") continue;
          if (s.key.text === "name") nameScalar = s.value;
          // set_variable stores `value = …`; add_to_*_variable_list stores `target = …`.
          else if (s.key.text === "value" || s.key.text === "target") exprScalar = s.value;
        }
      }
      if (
        nameScalar &&
        NAME_OK.test(nameScalar.text) &&
        !nameScalar.quoted &&
        !nameScalar.text.includes(":")
      ) {
        const line = lines.positionAt(nameScalar.range.start).line;
        const container = topLevelName(ancestors);
        // Only true set-sites carry the value expression (change_* holds a delta).
        const expr = key.startsWith("set_") || key.startsWith("add_to_") ? exprScalar : null;
        const kinds = VARIABLE_LIST_SET_KINDS[key]
          ? [VARIABLE_LIST_SET_KINDS[key], VARIABLE_LIST_SET_KINDS[key].replace("_list", "")]
          : [setKind];
        for (let i = 0; i < kinds.length; i++) {
          const def: Definition = { name: nameScalar.text, kind: kinds[i], file, line, source };
          // Expr only on the primary kind: the dual-indexed base-kind def of a
          // LIST set-site must not type `var:x` with the list's ITEM type.
          if (i === 0 && expr && !expr.quoted) def.value = expr.text;
          if (container !== undefined) def.container = container;
          implicitDefs.push(def);
        }
      }
      return;
    }

    // has_variable = x / is_target_in_variable_list = { name = x … } → references.
    const readKind = key !== null ? VARIABLE_READ_KINDS[key] : undefined;
    if (key !== null && readKind && value) {
      let nameScalar: ScalarNode | null = null;
      if (value.kind === "scalar" && !value.quoted) nameScalar = value;
      else if (value.kind === "block") {
        for (const s of value.statements) {
          if (
            s.kind === "assignment" &&
            !s.key.quoted &&
            s.key.text === "name" &&
            s.value?.kind === "scalar"
          ) {
            nameScalar = s.value;
            break;
          }
        }
      }
      if (
        nameScalar &&
        !nameScalar.quoted &&
        !nameScalar.text.includes(":") &&
        !nameScalar.text.includes("$")
      ) {
        // List reads accept only lists; scalar reads accept both (has_variable
        // is true for a list variable).
        const kinds = variableReadKinds(readKind);
        pushRef(nameScalar.text, kinds, nameScalar.range.start);
      }
      return;
    }

    // Key-position calls (`my_effect = yes`, `my_trigger = { ... }`): indexed
    // as call references so find-references and rename cover call sites, which
    // is where scripted effects/triggers/modifiers are actually used. Grammar
    // keywords and iterator-shaped keys are excluded via isStructuralKeyword —
    // NOT classifyKeyword, whose X_trigger/on_X convention buckets would drop
    // the call sites of conventionally named scripted triggers (#5); engine
    // tokens are filtered by the caller (memory: they dominate large mods).
    // Top-level keys are definitions, not calls. Excluded from the usage-count
    // ranking signal via the `call` flag.
    if (
      key !== null &&
      value != null &&
      ancestors.length > 0 &&
      !key.includes(".") &&
      !key.includes(":") &&
      !key.includes("$") &&
      !isStructuralKeyword(key) &&
      !schema.refFields.has(key) &&
      !isEngineToken?.(key)
    ) {
      // The chain lets call-site scope aggregation type the CALLED definition.
      pushRef(key, CALL_KINDS, stmt.key.range.start, true, enclosingKeyChain(ancestors));
    }

    if (value?.kind === "scalar") {
      scanValueScalar(value);
      if (key !== null && !value.quoted) {
        // Schema ref fields (scalar form), plus pattern families (flags, lists).
        const field = schema.refFields.get(key);
        if (field && field.form !== "list" && !value.text.includes(":")) {
          pushRef(value.text, field.kinds, value.range.start);
        } else if (!field && !value.text.includes(":")) {
          const kinds = dynamicRefKinds(key);
          if (kinds) {
            pushRef(value.text, kinds, value.range.start);
          } else if (!value.text.includes("$")) {
            // Keys too generic for a global ref field, resolved by their
            // enclosing block (BLOCK_REF_FIELDS): `variable` / `list` in an
            // in-list iterator, `id` in `trigger_event = { … }` (the delayed
            // form the event graph needs), `reference` in override_background.
            for (let i = ancestors.length - 1; i >= 0; i--) {
              const a = ancestors[i];
              if (a.kind === "assignment" && !a.key.quoted) {
                const blockKinds = activeProfile().blockRefFields[a.key.text.toLowerCase()]?.[key];
                if (blockKinds) pushRef(value.text, blockKinds, value.range.start);
                break;
              }
            }
          }
        }
      }
      // Loc-key-valued properties (both `desc = key` and `desc = "key"`).
      if (key !== null && isLocProperty(key) && NAME_OK.test(value.text)) {
        pushRef(value.text, LOC_KEY_KINDS, value.range.start + (value.quoted ? 1 : 0));
      }
    } else if (value?.kind === "block" && key !== null) {
      const field = schema.refFields.get(key);
      if (field && field.form !== "scalar") {
        for (const s of value.statements) {
          if (
            s.kind === "value" &&
            s.value.kind === "scalar" &&
            !s.value.quoted &&
            !s.value.text.includes(":")
          ) {
            pushRef(s.value.text, field.kinds, s.value.range.start);
          } else if (
            // Weighted entries: `random_events = { 100 = my.event }`. Only on
            // fields the schema marks weighted; elsewhere a numeric key is a
            // map entry, not a reference.
            field.weighted === true &&
            s.kind === "assignment" &&
            /^\d+$/.test(s.key.text) &&
            s.value?.kind === "scalar" &&
            !s.value.quoted &&
            !s.value.text.includes(":")
          ) {
            pushRef(s.value.text, field.kinds, s.value.range.start);
          }
        }
      }
    }
  });

  // Every string above is a slice of `content`, and a SlicedString pins its
  // parent: without this the index retains a copy of every file it read (§C2).
  shareReferenceStrings(references);
  shareDefinitionStrings(implicitDefs);
  for (let i = 0; i < namespaces.length; i++) namespaces[i] = intern(namespaces[i]);
  return { references, implicitDefs, namespaces };
}

// ---------------------------------------------------------------------------

export class ReferenceIndex {
  private byName = new Map<string, Reference[]>();
  private byFile = new Map<string, Reference[]>();
  /** Per-name count of non-call references (the §C2 ranking signal). */
  private rankCounts = new Map<string, number>();
  /**
   * Call sites carrying a key chain, per file — the ONLY references the scope
   * aggregation (buildCallSiteScopes) reads (perf round 2).
   *
   * It runs on every index change, i.e. every save, and used to iterate the
   * whole reference index to find them: measured on game + AGOT, 4,124,139
   * references of which 175,373 (4%) are chained call sites, so 96% of the
   * walk was `continue`. Same shape as DefinitionIndex.trackedNames (§B2).
   */
  private chainedCallsByFile = new Map<string, Reference[]>();
  revision = 0;

  addAll(refs: Reference[]): void {
    for (const ref of refs) {
      let list = this.byName.get(ref.name);
      if (!list) this.byName.set(ref.name, (list = []));
      list.push(ref);
      if (!ref.call) this.rankCounts.set(ref.name, (this.rankCounts.get(ref.name) ?? 0) + 1);
      const fkey = normFile(ref.file);
      let flist = this.byFile.get(fkey);
      if (!flist) this.byFile.set(fkey, (flist = []));
      flist.push(ref);
      if (ref.call && ref.chain !== undefined) {
        let clist = this.chainedCallsByFile.get(fkey);
        if (!clist) this.chainedCallsByFile.set(fkey, (clist = []));
        clist.push(ref);
      }
    }
    if (refs.length > 0) this.revision++;
  }

  /** Every chained call site, the input buildCallSiteScopes actually wants. */
  *chainedCalls(): IterableIterator<Reference> {
    for (const list of this.chainedCallsByFile.values()) yield* list;
  }

  /** Trim every bucket to its exact length. See DefinitionIndex.compact. */
  compact(): void {
    for (const [name, list] of this.byName) this.byName.set(name, list.slice());
    for (const [file, list] of this.byFile) this.byFile.set(file, list.slice());
    for (const [file, list] of this.chainedCallsByFile) this.chainedCallsByFile.set(file, list.slice());
  }

  /**
   * Drop every reference a file contributed.
   *
   * Grouped by name first (perf campaign §B2): a file that names the same
   * token 25 times used to rebuild that token's whole reference list 25 times.
   * On the AGOT-sized workspace one save of a small event file spent 490-510 ms
   * here — the entire remaining cost of the save — copying and discarding
   * megabytes of arrays for names with six-figure usage counts.
   */
  removeFile(file: string): void {
    const fkey = normFile(file);
    const refs = this.byFile.get(fkey);
    if (!refs) return;
    this.byFile.delete(fkey);
    this.chainedCallsByFile.delete(fkey);
    const dropped = new Map<string, Set<Reference>>();
    for (const ref of refs) {
      let set = dropped.get(ref.name);
      if (!set) dropped.set(ref.name, (set = new Set()));
      set.add(ref);
      if (!ref.call) {
        const n = (this.rankCounts.get(ref.name) ?? 0) - 1;
        if (n <= 0) this.rankCounts.delete(ref.name);
        else this.rankCounts.set(ref.name, n);
      }
    }
    for (const [name, set] of dropped) {
      const list = this.byName.get(name);
      if (!list) continue;
      const filtered = list.filter((r) => !set.has(r));
      if (filtered.length === 0) this.byName.delete(name);
      else this.byName.set(name, filtered);
    }
    this.revision++;
  }

  lookup(name: string): Reference[] {
    return this.byName.get(name) ?? [];
  }

  /**
   * How many times `name` is used across mod files (workspace usage count for
   * ranking, §C2). O(1) map hit. Call sites are excluded so the ranking signal
   * is unchanged by call-reference indexing; use `lookup(name).length` for the
   * user-facing "N references" count.
   */
  usageCount(name: string): number {
    return this.rankCounts.get(name) ?? 0;
  }

  /** All references in a file. */
  inFile(file: string): Reference[] {
    return this.byFile.get(normFile(file)) ?? [];
  }

  /** Iterate every reference (used by coverage/graph computations). */
  *all(): IterableIterator<Reference> {
    for (const list of this.byFile.values()) yield* list;
  }

  /** All references that may target the given kind. */
  allOfKind(kind: string): Reference[] {
    const out: Reference[] = [];
    for (const list of this.byFile.values()) {
      for (const ref of list) if (ref.kinds.includes(kind)) out.push(ref);
    }
    return out;
  }

  get size(): number {
    let n = 0;
    for (const list of this.byFile.values()) n += list.length;
    return n;
  }

  clear(): void {
    this.byName.clear();
    this.byFile.clear();
    this.rankCounts.clear();
    this.chainedCallsByFile.clear();
    this.revision++;
  }
}

function normFile(file: string): string {
  const n = file.replace(/\//g, "\\");
  return process.platform === "win32" ? n.toLowerCase() : file;
}
