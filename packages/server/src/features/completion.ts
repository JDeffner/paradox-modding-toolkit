/**
 * Completion v3 (post-v1.1 "scrambled suggestions" overhaul; v2 was Workstream C).
 *
 * What changed vs v2, and why — all grounded in the fuzzy-diag measurements
 * (scripts/fuzzy-diag.ts) which replay VS Code's real suggest scoring
 * (test/vscodeFuzzy.ts) over the provider's output:
 *
 *  1. KEY POSITION OFFERS VERBS ONLY. v2 offered every completable definition
 *     kind as a key: typing `tra` in an effect block surfaced ten vanilla
 *     script VALUES (tradition_base_cost…) above add_trait, `na` in an option
 *     block surfaced event IDs (natural_disaster.0110). Script values, events,
 *     traits, loc keys, on_actions… are nouns: they are only valid on the right
 *     of `=` (or behind a prefix), so that is where they now complete — key
 *     position keeps engine triggers/effects/scope-changers, scripted
 *     effects/triggers, and the block's structure keys.
 *  2. SERVER-SIDE WORD FILTER + CAP + isIncomplete. v2 shipped the whole list
 *     (11k–38k items, 1.9–6 MB JSON per request); above 2000 items VS Code
 *     also downgrades its scorer. v3 filters with the same match predicate
 *     VS Code uses (strong-first subsequence), ranks by sortText, and caps at
 *     MAX_ITEMS with isIncomplete so the client re-queries per keystroke.
 *     Filtering here is NOT hiding in the AD-5 sense: the client would drop
 *     non-matching items anyway; the cap only defers cold items until a
 *     keystroke narrows the set.
 *  3. LAZY DOCUMENTATION. Token/definition docs resolve on selection
 *     (completionItem/resolve) instead of shipping with every item.
 *  4. VALUE POSITION ALWAYS ANSWERS. `key = |` completes, in order: schema ref
 *     fields (has_trait = <traits>), structure-key values (bool → yes/no,
 *     enums), loc-valued properties, else a generic value set (script values +
 *     event targets + yes/no) — never the key soup. `trigger_event = { id = | }`
 *     and list-form refs (`on_actions = { | }`) complete their target kinds.
 *  5. TYPED-KEY PREFIXES. `culture:|`, `faith:|`, `title:|` … complete from the
 *     definition index via schema.prefixRefs (previously only scope:/var:).
 *  6. DEDUP. Same-name tokens merge into one item; definitions shadowed by an
 *     engine token of the same name are skipped (the index `entries()` fix
 *     handles cross-kind name collisions like vanilla `brave`).
 *
 * sortText scheme (unchanged from v2 §C2): composed "<T><F><S><label>" —
 * slot tier T ("0" structure, "1" scope-valid, "2" neutral, "4" other-scope),
 * two-digit frequency bucket F (log2×6 scale; dense rank for structure keys),
 * source tiebreak S ("0" mod, "1" other), label as final alphabetical tiebreak.
 */
import { kindStyle } from "@px-lsp/protocol/kinds";
import {
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  type CompletionItem,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { Definition, DefSource, TokenData } from "@px-lsp/protocol/types";
import type { SchemaEntry, KeySpec, RefField } from "../schema/types";
import type { FreqContext, FreqData } from "../schema/freqs";
import { VAR_PREFIX_KINDS, dynamicRefKinds } from "../games/jomini/variables";
import { activeProfile } from "../games/active";
import { emptyFreqData } from "../schema/freqs";
import { isLocProperty } from "@px-lsp/protocol/locProperties";
import type { ServerData } from "../serverData";
import type { SchemaData } from "../schema/loader";
import {
  expandModifierTemplates,
  matchTemplatedModifier,
  templatedModifierDoc,
} from "../data/modifierTemplates";
import { detectContextFromParse, blockStackFromParse, type BlockContext } from "../context";
import { structureContextAt } from "../structure";
import type { ParseResult } from "../parser";
import { getParse, getSavedScopes } from "../parseCache";
import { inferScopeAt } from "../scopes/inference";
import { inferenceContextFor, variableTypes } from "../scopes/varTypes";
import type { Scope } from "../scopes/model";
import type { ParadoxSettings } from "@px-lsp/protocol/protocol";
import { assetDirContext, provideAssetDirCompletion, provideBareNameCompletion } from "./assetPaths";
import { snippetSupport } from "../clientMode";
import { blockTemplateFor } from "./blockSnippets";

/** Cap on items per response; the client re-queries per keystroke (isIncomplete). */
export const MAX_ITEMS = 1000;

export interface CompletionResult {
  isIncomplete: boolean;
  items: CompletionItem[];
}

/**
 * The suggest-widget icon for a kind, from the one shared map in
 * `@px-lsp/protocol/kinds`, so the completion list and the hover badge cannot
 * drift apart. Kinds the map does not name fall back to `Reference`, which is
 * also what the map's own default resolves to.
 *
 * This replaced two hand-maintained tables. The old one sent `trigger` to
 * `Function` and `effect` to `Method`, which share a codepoint in the codicon
 * font and take the same colour, so a condition and an action were drawn
 * identically in the suggest widget.
 */
export function itemKind(kind: string): CompletionItemKind {
  const name = kindStyle(kind).completionKind as keyof typeof CompletionItemKind;
  return CompletionItemKind[name] ?? CompletionItemKind.Reference;
}

const TIER_STRUCTURE = "0";
const TIER_VALID = "1";
const TIER_NEUTRAL = "2";
const TIER_OTHER = "4";

const SRC_MOD = "0";
const SRC_OTHER = "1";

/** Definition kinds whose completion expands to a parameter snippet. */
const SNIPPET_KINDS = new Set(["scripted_effect", "scripted_trigger", "scripted_modifier"]);

/** Two-digit frequency bucket: "00" hottest … "99" coldest. count ≤ 0 → coldest. */
function freqBucket(count: number | undefined): string {
  if (!count || count <= 0) return "99";
  const b = 99 - Math.min(99, Math.round(Math.log2(count + 1) * 6));
  return String(Math.max(0, b)).padStart(2, "0");
}

/** Dense freq-rank bucket for a structure key: 0-based rank among block keys, 2 digits. */
function rankBucket(rank: number): string {
  return String(Math.min(99, rank)).padStart(2, "0");
}

const STRUCTURE_VALUE_HINT: Record<string, string> = {
  loc: "loc key",
  bool: "yes/no",
  block: "{ … }",
};

function structureItem(spec: KeySpec, kind: string, rank: number, allowSnippet: boolean): CompletionItem {
  const item: CompletionItem = { label: spec.key, kind: CompletionItemKind.Keyword };
  const hint = spec.values
    ? spec.values.startsWith("enum:")
      ? spec.values.slice(5).replace(/\|/g, " / ")
      : STRUCTURE_VALUE_HINT[spec.values]
    : undefined;
  item.detail = `${kind.replace(/_/g, " ")} key${hint ? ` · ${hint}` : ""}`;
  if (spec.doc) item.documentation = spec.doc;
  // Structure tier: F is the dense freq-rank within the block; S fixed to SRC_MOD.
  item.sortText = TIER_STRUCTURE + rankBucket(rank) + SRC_MOD + spec.key;
  // A key the schema says opens a block inserts the block: zero inference, the
  // KeySpec already carries the fact.
  if (allowSnippet && spec.values === "block") {
    setInsert(item, `${spec.key} = {\n\t$0\n}`, `${spec.key} = {\n\t\n}`);
  }
  return item;
}

/**
 * Install a completion item's insert text in the form the client declared:
 * the `${…}` snippet where snippetSupport was announced, the plain skeleton
 * otherwise. `${` must never reach a client that did not declare snippets — it
 * would be inserted literally.
 */
function setInsert(item: CompletionItem, snippet: string, plain: string): void {
  if (snippetSupport()) {
    item.insertText = snippet;
    item.insertTextFormat = InsertTextFormat.Snippet;
  } else {
    item.insertText = plain;
  }
}

function tokenItem(t: TokenData): CompletionItem {
  const item: CompletionItem = { label: t.name, kind: itemKind(t.kind) };
  item.detail = t.kind + (t.scopes.length > 0 ? ` (${t.scopes.join(", ")})` : "");
  item.data = { t: "tok", k: t.kind, n: t.name };
  return item;
}

function defItem(d: Definition, origin: string = d.source): CompletionItem {
  const item: CompletionItem = {
    label: d.name,
    kind: itemKind(d.kind),
  };
  item.detail = `${d.kind.replace(/_/g, " ")} (${origin})`;
  item.data = { t: "def", k: d.kind, n: d.name };
  return item;
}

/**
 * Completion documentation for a definition with PdxDoc (§E3): prose first, then
 * `@param NAME — desc` lines. Returns undefined when the def carries no doc.
 */
export function defDocMarkdown(d: Definition): string | undefined {
  const parts: string[] = [];
  if (d.kind === "loc_key" && d.value) parts.push(d.value);
  if (d.doc) parts.push(d.doc);
  const params = (d.tags ?? []).filter((t) => t.tag === "param");
  if (params.length > 0) {
    parts.push(
      params
        .map((t) => {
          const m = /^(\S+)\s*(.*)$/.exec(t.text);
          if (!m) return `@param`;
          return m[2].trim() ? `@param ${m[1]} — ${m[2].trim()}` : `@param ${m[1]}`;
        })
        .join("  \n")
    );
  }
  const deprecated = (d.tags ?? []).find((t) => t.tag === "deprecated");
  if (deprecated) parts.push(deprecated.text ? `⚠ Deprecated — ${deprecated.text}` : `⚠ Deprecated`);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/**
 * VS Code's suggest match predicate (fuzzyScore with firstMatchCanBeWeak:false):
 * the word must be a case-insensitive subsequence of the label AND the first
 * word character must match at a "strong" position — label start, right after a
 * separator (_ . - : / space …), or an uppercase boundary. Items failing this
 * are dropped client-side anyway, so pre-filtering with the same rule is safe.
 */
export function matchesTypedWord(wordLow: string, label: string): boolean {
  if (wordLow.length === 0) return true;
  const labelLow = label.toLowerCase();
  if (wordLow.length > labelLow.length) return false;
  const first = wordLow.charCodeAt(0);
  const lastStart = labelLow.length - wordLow.length;
  for (let i = 0; i <= lastStart; i++) {
    if (labelLow.charCodeAt(i) !== first) continue;
    if (!isStrongPosition(label, labelLow, i)) continue;
    if (isSubsequence(wordLow, 1, labelLow, i + 1)) return true;
  }
  return false;
}

const SEPARATORS = new Set([
  "_",
  ".",
  "-",
  ":",
  " ",
  "/",
  "\\",
  "'",
  '"',
  "$",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "<",
  ">",
]);

function isStrongPosition(label: string, labelLow: string, i: number): boolean {
  if (i === 0) return true;
  if (SEPARATORS.has(labelLow[i - 1])) return true;
  // Uppercase boundary (rare in Paradox script, common in GUI names).
  return label[i] !== labelLow[i] && label[i - 1] === labelLow[i - 1];
}

function isSubsequence(wordLow: string, wordPos: number, labelLow: string, labelPos: number): boolean {
  while (wordPos < wordLow.length && labelPos < labelLow.length) {
    if (wordLow[wordPos] === labelLow[labelPos]) wordPos++;
    labelPos++;
  }
  return wordPos === wordLow.length;
}

const VALUE_POSITION = /([A-Za-z_][A-Za-z0-9_.-]*)\s*\??=\s*"?([A-Za-z0-9_.-]*)$/;
/** Any `prefix:name` being typed; dispatching on the prefix happens in provide(). */
const PREFIX_POSITION = /([A-Za-z_][A-Za-z0-9_]*):([A-Za-z0-9_.-]*)$/;
/** `define:NS|CONST` (pipe separator): group 1 namespace, group 2 present when a
 * `|` was typed, group 3 the constant. Handled ahead of PREFIX_POSITION because
 * the pipe form is not a plain `prefix:name`. */
const DEFINE_POSITION = /(?:^|[^A-Za-z0-9_])define:([A-Za-z0-9_]*)(\|([A-Za-z0-9_]*))?$/;
/** The word being typed at the cursor (mirrors the language's wordPattern). */
const WORD_AT_END = /[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/** Prefixes that reference freeform names (no index kind): offer nothing.
 * `define` is handled separately (its pipe form completes namespaces/constants). */
const FREEFORM_PREFIXES = new Set(["flag", "event_target", "list"]);

/** Cached per-context base items with the metadata needed to rank per request. */
interface BaseItems {
  items: CompletionItem[];
  /** Parallel: the source token (null for definitions). */
  tokens: (TokenData | null)[];
  /** Parallel: the definition source (null for tokens). */
  sources: (DefSource | null)[];
}

export class CompletionFeature {
  private cache = new Map<BlockContext, BaseItems>();
  private cacheRevision = -1;
  /** Bundled per-context frequency tables (§C3); empty until setFreqs / fail-soft. */
  private freqs: FreqData = emptyFreqData();
  /** Content roots for filesystem-backed asset-path completion; null until pushed. */
  private settings: ParadoxSettings | null = null;

  constructor(
    private readonly data: ServerData,
    private readonly getSchema: () => SchemaData,
    freqs?: FreqData
  ) {
    if (freqs) this.freqs = freqs;
    data.onDidChange(() => this.cache.clear());
  }

  /** Install the bundled frequency tables (loaded once at startup, like tokens). */
  setFreqs(freqs: FreqData): void {
    this.freqs = freqs;
    this.cache.clear();
  }

  /** Push the resolved settings (paths) used for asset-path completion. */
  setSettings(settings: ParadoxSettings): void {
    this.settings = settings;
  }

  /**
   * Merged frequency count for `name` (§C2): MAX of the bundled per-context count
   * and the live workspace usage count. O(1) — two map hits, no scan. `fctx` is
   * the frequency context (effect_block/trigger_block/…) or null to use the global
   * token table.
   */
  private mergedCount(name: string, fctx: FreqContext | null): number {
    const bundled = fctx
      ? (this.freqs.contexts[fctx][name] ?? this.freqs.tokens[name] ?? 0)
      : (this.freqs.tokens[name] ?? 0);
    const live = this.data.refIndex.usageCount(name);
    return bundled > live ? bundled : live;
  }

  provide(
    document: TextDocument,
    offset: number,
    rootScopes: Set<Scope> | null,
    entry: SchemaEntry | null = null,
    limit: number = MAX_ITEMS
  ): CompletionResult {
    const { result, lineIndex } = getParse(document);
    const pos = lineIndex.positionAt(offset);
    const linePrefix = document.getText({
      start: { line: pos.line, character: 0 },
      end: { line: pos.line, character: pos.character },
    });

    // `define:NS|CONST` (pipe form) → namespaces, then that namespace's constants.
    const defineMatch = DEFINE_POSITION.exec(linePrefix);
    if (defineMatch) {
      if (defineMatch[2] === undefined) return finalize(this.defineNamespaceItems(), defineMatch[1], limit);
      return finalize(this.defineConstantItems(defineMatch[1]), defineMatch[3], limit);
    }

    // Quoted/unquoted asset path (`icon = "gfx/interface/ico`) → directory drill-down.
    if (this.settings) {
      const assetPath = assetDirContext(linePrefix);
      if (assetPath !== null) return provideAssetDirCompletion(this.settings, assetPath);
    }
    // A stray "/" outside a path context must not fall through to the key soup.
    if (linePrefix.endsWith("/")) return { isIncomplete: false, items: [] };

    // `prefix:name` → saved scopes, variables, or index kinds via schema.prefixRefs.
    const prefixMatch = PREFIX_POSITION.exec(linePrefix);
    if (prefixMatch) {
      const handled = this.prefixItems(document, prefixMatch[1], rootScopes, entry);
      if (handled !== null) return finalize(handled, prefixMatch[2], limit);
    }

    // Value position: `key = |` → targeted completion, never the key soup.
    const valueMatch = VALUE_POSITION.exec(linePrefix);
    if (valueMatch) {
      const items = this.valueItems(valueMatch[1], result, offset, entry);
      return finalize(items, valueMatch[2], limit);
    }

    const typedWord = WORD_AT_END.exec(linePrefix)?.[0] ?? "";

    // Completing a name that already has `= …` after the cursor must not
    // insert a second block, so templates only apply on a bare line tail.
    const lineSuffix = document.getText({
      start: pos,
      end: { line: pos.line + 1, character: 0 },
    });
    const allowSnippet = !lineSuffix.includes("=");

    // Inside a list-form ref block (`on_actions = { | }`) → the target kinds.
    const listRef = this.listRefItems(result, offset, entry);
    if (listRef !== null) return finalize(listRef, typedWord, limit);

    // Structure keys of the current block (§B2), ranked above everything else.
    const structureItems = entry?.kind ? this.structureItems(result, offset, entry.kind, allowSnippet) : [];

    let { context } = detectContextFromParse(result, offset);
    // A script_value definition body IS a value block (its name is the only
    // enclosing keyword, which classifies as unknown).
    if (
      context === "unknown" &&
      entry?.kind === "script_value" &&
      blockStackFromParse(result, offset).some((s) => s !== "<anon>")
    ) {
      context = "value";
    }
    // Script-value math blocks (ai_chance, ai_will_do, weight…): fixed math keys
    // lead; the base list keeps only iterators and scope targets.
    if (context === "value") {
      const have = new Set(structureItems.map((s) => s.label));
      for (const m of valueMathItems()) if (!have.has(m.label)) structureItems.push(m);
    }
    const base = this.itemsFor(context);
    // Frequency context for the token/def list: trigger/effect blocks use their own
    // table; anything else falls back to the global token table (null).
    const fctx: FreqContext | null =
      context === "trigger" ? "trigger_block" : context === "effect" ? "effect_block" : null;

    // Scope-aware ranking: annotate, never hide (AD-5). Tier T from scope validity,
    // F from merged frequency, S from source — composed "<T><F><S><label>".
    const ictx = inferenceContextFor(this.data, entry);
    const inference = inferScopeAt(
      result,
      offset,
      this.data.scopeModel,
      rootScopes,
      getSavedScopes(document, this.data.scopeModel, rootScopes, entry?.ambientScopes, ictx),
      ictx
    );
    const current = inference.scopes && inference.scopes.size > 0 ? inference.scopes : null;

    // Filter with the client's own match predicate BEFORE ranking: with a typed
    // word most of the 10-20k base items drop here, keeping the per-keystroke
    // work (object spreads + sort) on the small matched set.
    const wordLow = typedWord.toLowerCase();
    const ranked: CompletionItem[] = [];
    for (let i = 0; i < base.items.length; i++) {
      const item = base.items[i];
      if (wordLow.length > 0 && !matchesTypedWord(wordLow, item.label)) continue;
      const token = base.tokens[i];
      const src = base.sources[i];
      const f = freqBucket(this.mergedCount(item.label, fctx));
      const s = src === "mod" ? SRC_MOD : SRC_OTHER;

      if (!token) {
        // A definition (scripted effect/trigger/modifier): context-valid when
        // scope context exists, neutral otherwise — and completed as a snippet
        // that materializes its $PARAM$ block (or a yes|no choice).
        const defItem = { ...item, sortText: (current ? TIER_VALID : TIER_NEUTRAL) + f + s + item.label };
        if (allowSnippet) this.applyParamSnippet(defItem);
        ranked.push(defItem);
        continue;
      }
      // No scope context: everything is neutral-tier, still frequency-ranked.
      let out: CompletionItem;
      if (!current) {
        out = { ...item, sortText: TIER_NEUTRAL + f + s + item.label };
      } else {
        const scopeAware = token.kind === "trigger" || token.kind === "effect";
        const supported =
          token.kind === "trigger" || token.kind === "effect"
            ? this.data.scopeModel.inputScopesOf(token.kind, token.name)
            : token.kind === "event_target"
              ? (this.data.scopeModel.links.get(token.name)?.inputs ?? null)
              : null;
        if (supported === null) {
          // A scope-agnostic trigger/effect (no declared input scopes) is valid in
          // any scope — tier VALID so hot universals (save_scope_as, custom_tooltip,
          // if…) aren't stranded behind scoped effects (§C2 intent). Other kinds with
          // unknown scope (modifiers) stay neutral.
          out = { ...item, sortText: (scopeAware ? TIER_VALID : TIER_NEUTRAL) + f + s + item.label };
        } else if (intersects(supported, current)) {
          out = { ...item, sortText: TIER_VALID + f + s + item.label };
        } else {
          out = {
            ...item,
            sortText: TIER_OTHER + f + s + item.label,
            detail: `${item.detail ?? ""} — other scope`,
          };
        }
      }
      // An engine token whose dumped `usage:` example qualifies completes as the
      // block that example shows (blockSnippets.ts); most tokens have none.
      if (allowSnippet) {
        const tmpl = blockTemplateFor(token);
        if (tmpl) setInsert(out, tmpl.snippet, tmpl.plain);
      }
      ranked.push(out);
    }
    const structured =
      structureItems.length > 0
        ? [...structureItems.filter((s) => matchesTypedWord(wordLow, s.label)), ...ranked]
        : ranked;
    return finalize(structured, typedWord, limit, /*alreadyFiltered*/ true);
  }

  /**
   * Completing a scripted effect/trigger/modifier inserts a ready-to-fill
   * block: one `PARAM = <tabstop>` line per $PARAM$ the definition's body
   * declares; paramless effects/triggers insert `name = yes|no` as a choice.
   */
  private applyParamSnippet(item: CompletionItem): void {
    const data = item.data as { t?: string; k?: string; n?: string } | undefined;
    if (!data || data.t !== "def" || !data.k || !data.n || !SNIPPET_KINDS.has(data.k)) return;
    const def = this.data.index.lookup(data.n).find((d) => d.kind === data.k);
    if (!def) return;
    if (def.params && def.params.length > 0) {
      const snippet = def.params.map((p, i) => `\t${p} = \${${i + 1}:${p}}`).join("\n");
      const plain = def.params.map((p) => `\t${p} = ${p}`).join("\n");
      setInsert(item, `${data.n} = {\n${snippet}\n}`, `${data.n} = {\n${plain}\n}`);
      item.detail = `${item.detail} · params: ${def.params.join(", ")}`;
    } else if (data.k !== "scripted_modifier") {
      // Bare scripted modifiers are referenced by name, not assigned yes/no.
      setInsert(item, `${data.n} = \${1|yes,no|}`, `${data.n} = yes`);
    }
  }

  /**
   * completionItem/resolve: attach documentation on selection. Token docs come
   * from script_docs/wiki data; definition docs from the index (PdxDoc §E3).
   */
  resolve(item: CompletionItem): CompletionItem {
    const data = item.data as { t?: string; k?: string; n?: string } | undefined;
    if (!data || !data.n) return item;
    if (data.t === "tok") {
      const token = this.data.tokenMap.get(data.n)?.find((t) => t.kind === data.k);
      if (token?.doc) item.documentation = token.doc;
      return item;
    }
    if (data.t === "tmpl") {
      const m = matchTemplatedModifier(data.n, this.data.modifierTemplates, (n) => this.data.index.lookup(n));
      if (m) item.documentation = { kind: MarkupKind.Markdown, value: templatedModifierDoc(m) };
      return item;
    }
    if (data.t === "def") {
      const def = this.data.index.lookup(data.n).find((d) => d.kind === data.k);
      if (def) {
        const doc = defDocMarkdown(def);
        if (doc) item.documentation = { kind: MarkupKind.Markdown, value: doc };
      }
    }
    return item;
  }

  /**
   * Structure keys of the current block (§B2), as Keyword items ranked first.
   * F is a dense freq-rank over the block's keys: sort by KeySpec.freq desc (keys
   * without freq fall to the tail, alphabetically) and assign 0-based ranks.
   */
  private structureItems(
    result: ParseResult,
    offset: number,
    kind: string,
    allowSnippet: boolean
  ): CompletionItem[] {
    const ctx = structureContextAt(result, offset, kind, this.getSchema().structures);
    if (!ctx) return [];
    // Curated keys keep their deliberate list order AHEAD of harvested ones:
    // harvested .info freqs count usage at any depth of the folder, so a raw
    // freq sort buries the real top-level vocabulary under sub-block keys
    // (rank-eval regression, 2026-07). Harvested extras stay freq-ranked.
    const all = [...ctx.keys.values()];
    const curated = all.filter((k) => k.curated);
    const harvested = all
      .filter((k) => !k.curated)
      .sort((a, b) => {
        const fa = a.freq ?? 0;
        const fb = b.freq ?? 0;
        if (fa !== fb) return fb - fa;
        return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      });
    return [...curated, ...harvested].map((spec, i) => structureItem(spec, ctx.kind, i, allowSnippet));
  }

  /**
   * Key-position base items per block context: engine tokens of the context's
   * kinds plus scripted effect/trigger definitions — verbs only (v3 change #1).
   * Same-name tokens merge; defs shadowed by a token name are skipped. sortText
   * is composed per request (scope validity + frequency).
   */
  private itemsFor(context: BlockContext): BaseItems {
    if (this.cacheRevision !== this.data.index.revision) {
      this.cache.clear();
      this.cacheRevision = this.data.index.revision;
    }
    const cached = this.cache.get(context);
    if (cached) return cached;

    const items: CompletionItem[] = [];
    const tokens: (TokenData | null)[] = [];
    const sources: (DefSource | null)[] = [];
    const byLabel = new Map<string, number>();
    for (const t of this.data.tokens) {
      if (context === "trigger" && (t.kind === "effect" || t.kind === "modifier")) continue;
      if (context === "effect" && (t.kind === "trigger" || t.kind === "modifier")) continue;
      // Value blocks: only iterators (every_realm_county = { add = … }) and
      // scope targets are valid keys besides the fixed math keys.
      if (context === "value" && !(t.kind === "event_target" || ITERATOR_NAME.test(t.name))) continue;
      const existing = byLabel.get(t.name);
      if (existing !== undefined) {
        // Same name, several token kinds (`death` is a trigger AND an event
        // target): one item, merged detail, first token wins for data/scopes.
        const prev = items[existing];
        if (!String(prev.detail).includes(t.kind)) prev.detail = `${prev.detail} · ${t.kind}`;
        continue;
      }
      byLabel.set(t.name, items.length);
      items.push(tokenItem(t));
      tokens.push(t);
      sources.push(null);
    }
    // Scripted lists generate iterators script_docs does not dump: offer
    // every_/random_/ordered_<list> as effects and any_<list> as a trigger.
    if (context !== "value") {
      const prefixes =
        context === "trigger"
          ? ["any"]
          : context === "effect"
            ? ["every", "random", "ordered"]
            : ["any", "every", "random", "ordered"];
      for (const d of this.data.index.entries((def) => def.kind === "scripted_list")) {
        for (const prefix of prefixes) {
          const label = `${prefix}_${d.name}`;
          if (byLabel.has(label)) continue; // engine iterator of the same name wins
          const targets = this.data.scopeModel.outputOf(label);
          byLabel.set(label, items.length);
          items.push({
            label,
            kind: prefix === "any" ? CompletionItemKind.Function : CompletionItemKind.Method,
            detail: `scripted list iterator${targets ? ` (${[...targets].join(", ")})` : ""} · ${this.data.originLabel(d)}`,
            data: { t: "def", k: "scripted_list", n: d.name },
          });
          tokens.push(null);
          sources.push(d.source);
        }
      }
    }
    // Templated modifiers ($CULTURE$_opinion → french_opinion) expand against
    // the definition index, but only where modifier tokens are offered at all
    // (unknown context, per the kind filters above). Rebuilt with this cache
    // per index revision — never materialized into tokenMap.
    if (context === "unknown") {
      for (const e of expandModifierTemplates(
        this.data.modifierTemplates,
        this.data.index,
        this.data.completableKinds
      )) {
        if (byLabel.has(e.name)) continue; // a concrete dumped modifier wins
        byLabel.set(e.name, items.length);
        items.push({
          label: e.name,
          kind: CompletionItemKind.Property,
          detail: `modifier · from ${e.template.name}`,
          data: { t: "tmpl", n: e.name },
        });
        tokens.push(null);
        sources.push(e.def?.source ?? "vanilla");
      }
    }
    for (const d of this.data.index.entries((def) => this.defAllowed(def, context))) {
      if (byLabel.has(d.name)) continue; // engine token shadows a same-name def
      byLabel.set(d.name, items.length);
      items.push(defItem(d, this.data.originLabel(d)));
      tokens.push(null);
      sources.push(d.source);
    }
    const entry: BaseItems = { items, tokens, sources };
    this.cache.set(context, entry);
    return entry;
  }

  /** Verbs only in key position: scripted effect/trigger (+ modifier in unknown). */
  private defAllowed(def: Definition, context: BlockContext): boolean {
    // Huge/noisy kinds opt out via the schema (history characters, coats of arms...).
    if (this.data.completableKinds.size > 0 && !this.data.completableKinds.has(def.kind)) return false;
    switch (context) {
      case "trigger":
        return def.kind === "scripted_trigger";
      case "effect":
        return def.kind === "scripted_effect";
      case "value":
        return false; // math keys + iterators only; script values complete as VALUES
      default:
        return (
          def.kind === "scripted_trigger" ||
          def.kind === "scripted_effect" ||
          def.kind === "scripted_modifier"
        );
    }
  }

  /**
   * `key = |` value completion (v3 change #4). Sources in priority order:
   * schema ref fields, structure-key value specs (bool/enum/loc), loc-valued
   * properties, generic value set. Never returns the key list.
   */
  private valueItems(
    key: string,
    result: ParseResult,
    offset: number,
    entry: SchemaEntry | null
  ): CompletionItem[] {
    // Bare-filename `.dds` field (trait icon, death-reason icon, building type_icon):
    // list *.dds from the engine-fixed base dirs across roots, mod-first.
    if (this.settings) {
      const bare = provideBareNameCompletion(this.settings, entry?.kind, key);
      if (bare) return bare;
    }

    const schema = this.getSchema();
    let field = schema.refFields.get(key);
    // Keys too generic for a global ref field (`id`, `reference`, `variable`)
    // resolve via their enclosing block: trigger_event = { id = <event> },
    // every_in_list = { variable = <variable list> }, …
    if (!field) {
      const named = blockStackFromParse(result, offset).filter((s) => s !== "<anon>");
      const block = named[named.length - 1]?.toLowerCase();
      const kinds = block ? activeProfile().blockRefFields[block]?.[key] : undefined;
      if (kinds) field = { key, kinds };
    }
    // Pattern families: has_character_flag = <flag>, has_variable = <variable>,
    // is_in_list = <list> … (open-ended key sets, see dynamicRefKinds).
    if (!field) {
      const kinds = dynamicRefKinds(key);
      if (kinds) field = { key, kinds };
    }
    if (field) {
      const items = this.refFieldItems(field);
      if (items.length > 0) return items;
    }

    // Structure-key value spec: bool → yes/no, enum → its members.
    if (entry?.kind) {
      const ctx = structureContextAt(result, offset, entry.kind, schema.structures);
      const spec = ctx?.keys.get(key);
      if (spec?.values === "bool") return boolItems();
      if (spec?.values?.startsWith("enum:")) {
        return spec.values
          .slice(5)
          .split("|")
          .map((v, i) => ({
            label: v,
            kind: CompletionItemKind.EnumMember,
            detail: `${spec.key} value`,
            sortText: TIER_VALID + rankBucket(i) + SRC_MOD + v,
          }));
      }
      if (spec?.values === "loc") return this.modLocItems();
    }

    if (isLocProperty(key)) return this.modLocItems();

    // Generic fallback: things that are valid on the right of `=` when we know
    // nothing about the key — script values, event targets/links, yes/no.
    const items: CompletionItem[] = boolItems();
    const seen = new Set<string>(["yes", "no"]);
    for (const t of this.data.tokens) {
      if (t.kind !== "event_target" || seen.has(t.name)) continue;
      seen.add(t.name);
      const f = freqBucket(this.mergedCount(t.name, null));
      items.push({ ...tokenItem(t), sortText: TIER_NEUTRAL + f + SRC_OTHER + t.name });
    }
    for (const d of this.data.index.entries((def) => def.kind === "script_value")) {
      if (seen.has(d.name)) continue;
      const f = freqBucket(this.mergedCount(d.name, null));
      const s = d.source === "mod" ? SRC_MOD : SRC_OTHER;
      items.push({ ...defItem(d, this.data.originLabel(d)), sortText: TIER_NEUTRAL + f + s + d.name });
    }
    return items;
  }

  /** Items for a ref field's target kinds, frequency-then-source ranked. */
  private refFieldItems(field: RefField): CompletionItem[] {
    const kinds = new Set(field.kinds);
    const items: CompletionItem[] = [];
    for (const d of this.data.index.entries((def) => kinds.has(def.kind))) {
      const f = freqBucket(this.mergedCount(d.name, null));
      const s = d.source === "mod" ? SRC_MOD : SRC_OTHER;
      items.push({ ...defItem(d, this.data.originLabel(d)), sortText: TIER_VALID + f + s + d.name });
    }
    return items;
  }

  /** Mod localization keys (vanilla loc is excluded: hundreds of thousands). */
  private modLocItems(): CompletionItem[] {
    const items: CompletionItem[] = [];
    for (const d of this.data.index.entries((def) => def.kind === "loc_key" && def.source === "mod")) {
      items.push({ ...defItem(d, this.data.originLabel(d)), sortText: TIER_VALID + "50" + SRC_MOD + d.name });
    }
    return items;
  }

  /**
   * Inside a list-form ref block (`on_actions = { | }`, `events = { | }`) the
   * bare words are names of the field's target kinds. Returns null when the
   * cursor is not in such a block. `first_valid` doubles as an event-desc
   * wrapper, so it only counts inside on_action files.
   */
  private listRefItems(
    result: ParseResult,
    offset: number,
    entry: SchemaEntry | null
  ): CompletionItem[] | null {
    const named = blockStackFromParse(result, offset).filter((s) => s !== "<anon>");
    const innermost = named[named.length - 1]?.toLowerCase();
    if (!innermost) return null;
    const field = this.getSchema().refFields.get(innermost);
    if (!field || (field.form !== "list" && field.form !== "both")) return null;
    if (innermost === "first_valid" && entry?.kind !== "on_action") return null;
    return this.refFieldItems(field);
  }

  /** `define:` → engine/game/mod define namespaces (alphabetical). */
  private defineNamespaceItems(): CompletionItem[] {
    return this.data.defines.namespaces().map((ns) => ({
      label: ns,
      kind: CompletionItemKind.Module,
      detail: "define namespace",
      sortText: ns.toLowerCase(),
    }));
  }

  /** `define:NS|` → that namespace's constants, detail = the resolved value. */
  private defineConstantItems(namespace: string): CompletionItem[] {
    return this.data.defines.constants(namespace).map((c) => ({
      label: c.name,
      kind: CompletionItemKind.Constant,
      detail: `= ${c.value}`,
      sortText: c.name.toLowerCase(),
    }));
  }

  /**
   * `prefix:name` completion. scope:/var: → saved scopes / variables (ambient +
   * file-local first); schema.prefixRefs prefixes (culture:, faith:, title:…) →
   * index kinds; freeform prefixes (flag:) → empty. Returns null for an
   * unrecognized prefix (falls through to value/key handling).
   */
  private prefixItems(
    document: TextDocument,
    prefix: string,
    rootScopes: Set<Scope> | null,
    entry: SchemaEntry | null
  ): CompletionItem[] | null {
    const p = prefix.toLowerCase();
    if (FREEFORM_PREFIXES.has(p)) return [];
    if (p === "scope" || p === "var" || p === "local_var" || p === "global_var") {
      // Each var prefix reads its own storage class (set_variable / set_local_
      // variable / set_global_variable are separate namespaces).
      const wantKinds = new Set(p === "scope" ? ["saved_scope"] : VAR_PREFIX_KINDS[p]);
      const items = new Map<string, CompletionItem>();
      if (p === "scope") {
        // Fixed boost (§C2): ambient (engine-provided) scopes first, then file-local
        // saves, then the mod-wide index. Composed sortText keeps them in that order:
        // structure tier "0", frequency slot reused as a rank slot (0 ambient, 1 file).
        for (const a of entry?.ambientScopes ?? []) {
          const item: CompletionItem = {
            label: a.name,
            kind: CompletionItemKind.Variable,
            detail: `ambient scope → ${a.type} (engine)`,
            sortText: TIER_STRUCTURE + "00" + SRC_MOD + a.name,
          };
          item.documentation = a.doc;
          items.set(a.name, item);
        }
        // File-local saves next, annotated with their inferred scope type.
        const ictx = inferenceContextFor(this.data, entry);
        const saved = getSavedScopes(document, this.data.scopeModel, rootScopes, entry?.ambientScopes, ictx);
        for (const [name, scopes] of saved) {
          if (items.has(name)) continue;
          items.set(name, {
            label: name,
            kind: CompletionItemKind.Variable,
            detail: `saved scope${scopes ? ` → ${[...scopes].join("|")}` : ""} (this file)`,
            sortText: TIER_STRUCTURE + "01" + SRC_MOD + name,
          });
        }
      }
      const varInfo = p === "scope" ? null : variableTypes(this.data, this.data.rootScopesForFile);
      for (const d of this.data.index.entries((def) => wantKinds.has(def.kind))) {
        if (items.has(d.name)) continue;
        const isList = d.kind.endsWith("_list");
        const typed = varInfo
          ? (isList ? varInfo.listItemTypes : varInfo.types).get(`${p}:${d.name}`)
          : undefined;
        const typeNote = typed
          ? ` → ${isList ? "list of " : ""}${[...typed].join("|")}`
          : isList
            ? " (list)"
            : "";
        items.set(d.name, {
          label: d.name,
          kind: CompletionItemKind.Variable,
          detail: `${d.kind.replace(/_/g, " ")}${typeNote}${d.container ? ` (in ${d.container})` : ""}`,
          sortText: TIER_VALID + "99" + SRC_MOD + d.name,
        });
      }
      return [...items.values()];
    }
    const kinds = this.getSchema().prefixRefs[p];
    if (kinds && kinds.length > 0) {
      const wanted = new Set(kinds);
      const items: CompletionItem[] = [];
      for (const d of this.data.index.entries((def) => wanted.has(def.kind))) {
        const f = freqBucket(this.mergedCount(d.name, null));
        const s = d.source === "mod" ? SRC_MOD : SRC_OTHER;
        items.push({ ...defItem(d, this.data.originLabel(d)), sortText: TIER_VALID + f + s + d.name });
      }
      return items;
    }
    return null;
  }
}

/**
 * Rank, filter and cap a provider list the way the client will consume it:
 * drop items the client's matcher would drop anyway, order by sortText (the
 * client's empty-prefix order / tiebreak), cap at `limit`. isIncomplete when
 * capped OR a word is typed — the client then re-queries per keystroke, so
 * items beyond the cap surface as the word narrows the set.
 */
export function finalize(
  items: CompletionItem[],
  typedWord: string,
  limit: number,
  alreadyFiltered = false
): CompletionResult {
  const wordLow = typedWord.toLowerCase();
  const matched =
    wordLow.length === 0 || alreadyFiltered
      ? items
      : items.filter((i) => matchesTypedWord(wordLow, i.filterText ?? i.label));
  matched.sort((a, b) => {
    const ka = a.sortText ?? a.label;
    const kb = b.sortText ?? b.label;
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
  if (matched.length <= limit) {
    return { isIncomplete: wordLow.length > 0, items: matched };
  }
  return { isIncomplete: true, items: matched.slice(0, limit) };
}

function boolItems(): CompletionItem[] {
  return [
    { label: "yes", kind: CompletionItemKind.Constant, sortText: TIER_VALID + "05" + SRC_MOD + "yes" },
    { label: "no", kind: CompletionItemKind.Constant, sortText: TIER_VALID + "05" + SRC_MOD + "no" },
  ];
}

const ITERATOR_NAME = /^(any|every|random|ordered)_/;

/** The fixed script-value math vocabulary, ordered by typical frequency. */
const VALUE_MATH_KEYS: Array<[key: string, doc: string]> = [
  ["value", "Set or override the running value."],
  ["add", "Add to the running value (number, script value, or a { } block)."],
  ["factor", "Multiply the FINAL value."],
  ["modifier", "Conditional block: triggers plus add/factor applied when they hold."],
  ["if", "Conditional math: limit = { … } plus add/factor/value."],
  ["min", "Clamp: lower bound."],
  ["max", "Clamp: upper bound."],
  ["multiply", "Multiply the running value."],
  ["else_if", "Chained conditional math."],
  ["else", "Fallback branch of an if."],
  ["base", "Starting value."],
  ["divide", "Divide the running value."],
  ["subtract", "Subtract from the running value."],
  ["compare_modifier", "Scaled modifier from comparing a value (target, multiplier, step)."],
  ["opinion_modifier", "Scaled modifier from an opinion (who, opinion_target, multiplier)."],
  ["save_temporary_value_as", "Save the running value under a name; read it back as scope:<name>."],
  ["fixed_range", "Uniformly random value between min and max."],
  ["integer_range", "Uniformly random integer between min and max."],
  ["desc", "Custom description shown in the value breakdown tooltip."],
  ["round", "Round to the nearest integer (yes/no)."],
  ["floor", "Round down (yes/no)."],
  ["ceiling", "Round up (yes/no)."],
];

function valueMathItems(): CompletionItem[] {
  return VALUE_MATH_KEYS.map(([key, doc], i) => ({
    label: key,
    kind: CompletionItemKind.Keyword,
    detail: "script value math",
    documentation: doc,
    sortText: TIER_STRUCTURE + rankBucket(i) + SRC_MOD + key,
  }));
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}
