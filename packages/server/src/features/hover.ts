/**
 * Hover: engine-token docs (script_docs/wiki), indexed-definition summaries,
 * block-schema structure keys (§B2) and saved-scope cards for `scope:`/`var:`
 * references (§B3).
 *
 * The data-gathering here builds `CardInput` records; visual assembly (badges,
 * scope pills, fenced examples, the single shared scope footer) lives in
 * `hoverRender.ts` so the D2 layout is unit-tested without LSP types.
 */
import { MarkupKind, type Hover, type Position } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import * as path from "path";
import { URI } from "vscode-uri";
import type { SchemaEntry } from "../schema/types";
import type { TokenData } from "@px-lsp/protocol/types";
import { clientCommands } from "@px-lsp/protocol/protocol";
import { canRunCommand, fileLinks } from "../clientMode";
import type { ServerData } from "../serverData";
import type { SchemaData } from "../schema/loader";
import { scopePrefixBefore, wordRangeAt } from "../wordAt";
import { getLineText } from "../documents";
import { getParse, getSavedScopes } from "../parseCache";
import { structureContextAt } from "../structure";
import { inferScopeAt } from "../scopes/inference";
import { inferenceContextFor, variableTypes } from "../scopes/varTypes";
import { nodeAtOffset, walkStatements } from "../parser";
import type { RefField } from "../schema/types";
import { VAR_PREFIX_KINDS } from "../games/jomini/variables";
import { activeProfile } from "../games/active";
import { KEYWORD_DOCS, scopeWordDoc } from "../data/keywordDocs";
import { matchTemplatedModifier, templatedModifierDoc } from "../data/modifierTemplates";
import type { Scope } from "../scopes/model";
import {
  renderCard,
  renderDocBody,
  renderHover,
  scopeHereLine,
  scopePill,
  scopeType,
  type CardInput,
} from "./hoverRender";
import type { Definition } from "@px-lsp/protocol/types";
import type { DefineEntry } from "../data/defines";

export function provideHover(
  data: ServerData,
  document: TextDocument,
  position: Position,
  rootScopes: Set<Scope> | null,
  entry: SchemaEntry | null = null,
  getSchema?: () => SchemaData,
  /** Definitions extracted from the OPEN document itself, consulted when the
   * index has nothing for the word (same-file inline declarations, #5). */
  docDefs?: (word: string) => Definition[]
): Hover | null {
  const lineText = getLineText(document, position.line);

  // `define:NS|CONST` — reassemble the full token (wordPattern splits on `:`/`|`).
  const defineHit = defineRefAt(lineText, position.character);
  if (defineHit) {
    const card = definesCard(data, defineHit.namespace, defineHit.name);
    if (card) {
      return {
        contents: { kind: MarkupKind.Markdown, value: renderHover([card], null) },
        range: {
          start: { line: position.line, character: defineHit.start },
          end: { line: position.line, character: defineHit.end },
        },
      };
    }
  }

  let range = wordRangeAt(lineText, position.character);
  if (!range) return null;
  // Dot chains (`root.location.county`) resolve per segment under the cursor;
  // event ids (`namespace.5.a`, any all-digit segment) stay whole.
  if (range.word.includes(".") && !range.word.split(".").some((p) => /^\d+$/.test(p))) {
    let start = range.start;
    for (const part of range.word.split(".")) {
      const end = start + part.length;
      if (position.character <= end) {
        range = { word: part, start, end };
        break;
      }
      start = end + 1;
    }
  }
  const word = range.word;

  const cards: string[] = [];

  // Current scope at the cursor, computed once and shared by the pills and the
  // single footer line (§D2/§D3). null when we can't infer.
  const current = currentScopes(data, document, position, rootScopes, entry);

  // `scope:x` / `var:x` reference under the cursor → saved-scope card (§B3).
  const prefix = scopePrefixBefore(lineText, range);
  if (prefix === "scope") {
    const card = savedScopeCard(data, document, word, rootScopes, entry);
    if (card) cards.push(card);
  } else if (prefix === "var" || prefix === "local_var" || prefix === "global_var") {
    // Typed variable card: value type from the mod-wide set-site analysis, plus
    // set-site links (namespace-correct: var/local_var/global_var are distinct).
    const varInfo = variableTypes(data, data.rootScopesForFile);
    const typed = varInfo.types.get(`${prefix}:${word}`);
    const itemTyped = varInfo.listItemTypes.get(`${prefix}:${word}`);
    const headTail = typed
      ? `→ ${[...typed].map(scopeType).join(" | ")}`
      : itemTyped
        ? `→ list of ${[...itemTyped].map(scopeType).join(" | ")}`
        : itemTyped === null
          ? `→ list`
          : `· ${prefix.replace(/_/g, " ")}`;
    const setDefs = data.index
      .lookup(word)
      .filter((d) => VAR_PREFIX_KINDS[prefix].includes(d.kind))
      .slice(0, 3);
    const doc =
      setDefs.length > 0
        ? setDefs
            .map(
              (d) => `set in ${fileLink(d.file, `${path.basename(d.file)}:${d.line + 1}`, `L${d.line + 1}`)}`
            )
            .join("  \n")
        : undefined;
    cards.push(renderCard({ kind: "saved_scope", badgeLabel: "variable", name: word, headTail, doc }));
  }

  // When the word is the VALUE of a schema ref field (`theme = faith`,
  // `add_trait = brave`), the schema names the kinds it can reference — show
  // only those meanings instead of every same-named symbol (the `faith` event
  // target is noise on `theme = faith`). Falls through when nothing matches.
  const expected = getSchema ? refKindsAt(document, position, getSchema().refFields) : null;
  let defs = data.index.lookup(word);
  if (defs.length === 0 && docDefs) defs = docDefs(word);
  const expectedDefs = expected ? defs.filter((d) => expected.includes(d.kind)) : [];
  // Anchor for the "N references" command link: the hovered site itself, so
  // the client can drive the references view from it.
  const at = { uri: document.uri, line: position.line, character: range.start };

  // On the KEY of an assignment, the key's own structural meaning outranks
  // same-named value identities: a total conversion that saves a scope named
  // `type` in 33 places must not bury what `type =` means in an event.
  const keyPos = !prefix && atKeyPosition(document, position);
  const structureCard =
    keyPos && entry?.kind && getSchema ? structureKeyCard(document, position, word, entry, getSchema) : null;

  if (expectedDefs.length > 0) {
    cards.push(...definitionCards(data, expectedDefs, at));
  } else {
    if (structureCard) cards.push(structureCard);
    for (const token of data.tokenMap.get(word) ?? []) {
      cards.push(tokenCard(token, current));
    }
    let shownDefs = defs;
    if (keyPos && (cards.length > 0 || defs.some((d) => !VALUE_IDENTITY_KINDS.has(d.kind)))) {
      shownDefs = defs.filter((d) => !VALUE_IDENTITY_KINDS.has(d.kind));
    }
    cards.push(...definitionCards(data, shownDefs, at));
  }

  // Fallback cards, only when nothing else matched, so a real token/def with
  // the same name keeps precedence. Most-specific first: block structure key,
  // enum value of a structure key, macro parameter of the called scripted
  // effect/trigger, event namespace, scope keyword, grammar keyword.
  if (!prefix && cards.length === 0) {
    const card =
      (entry?.kind && getSchema ? structureKeyCard(document, position, word, entry, getSchema) : null) ??
      (entry?.kind && getSchema ? enumValueCard(document, position, word, entry, getSchema) : null) ??
      macroParamCard(data, document, position, word) ??
      relationTriggerCard(data, word) ??
      templatedModifierCard(data, word) ??
      namespaceCard(data, word) ??
      scopeWordCard(word) ??
      keywordCard(word) ??
      effectArgumentCard(data, document, position, word);
    if (card) cards.push(card);
  }

  if (cards.length === 0) return null;

  // Scope context appears once, last (§D2). Suppressed for a `scope:` hover
  // (its own card already carries the scope) to match the prior behavior.
  let footer: string | null = null;
  if (prefix !== "scope") {
    const scopes = current && current.size > 0 ? [...current].join(" | ") : "unknown";
    const inference = scopeInference(data, document, position, rootScopes, entry);
    const chain = inference.chain.length > 1 ? inference.chain.join(" · ") : null;
    footer = scopeHereLine(scopes, chain);
  }

  return {
    contents: { kind: MarkupKind.Markdown, value: renderHover(cards, footer) },
    range: {
      start: { line: position.line, character: range.start },
      end: { line: position.line, character: range.end },
    },
  };
}

/**
 * An engine-token card (§D2 mock 1). Teaches USAGE, not usage counts: what the
 * token does, the datatype its VALUE expects, a syntax example, and the scopes
 * it runs in / the scope it returns. No vanilla-frequency line — engine tokens
 * never carry one and the user does not want it.
 */
function tokenCard(token: TokenData, current: ReadonlySet<string> | null): string {
  const card: CardInput = { kind: token.kind, name: token.name };
  const { input, output, plain } = partitionScopes(token.scopes);

  // Event targets return a scope: surface it as the `→ type` head tail — it is
  // this token's real "datatype".
  if (output.length > 0) card.headTail = `→ ${output.map(scopeType).join(" | ")}`;

  // Description, then the expected value datatype (the user's core ask).
  const docParts: string[] = [];
  if (token.doc) docParts.push(token.doc);
  const shape = valueShape(token);
  if (shape) docParts.push(`Value: ${shape}`);
  if (docParts.length > 0) card.doc = docParts.join("\n\n");

  // Syntax example, fenced (from a script_docs `usage:` block or the wiki).
  if (token.usage) card.example = token.usage;

  // Remaining metadata (targets, categories, requires-data, wiki note); the
  // `Traits:` line is already folded into the value datatype above.
  const meta = otherTraitBits(token.traits);
  if (meta.length > 0) card.traits = meta.join(" · ");

  // Input scope(s) you call it from — matched against the current cursor scope.
  const scopeVals = plain.length > 0 ? plain : input;
  if (scopeVals.length > 0) {
    card.footer = [`Supported scopes: ${scopeVals.map((s) => scopePill(s, current)).join(" ")}`];
  }
  return renderCard(card);
}

/** Split raw scope strings into the input / output / plain buckets. */
function partitionScopes(scopes: string[]): { input: string[]; output: string[]; plain: string[] } {
  const input: string[] = [];
  const output: string[] = [];
  const plain: string[] = [];
  for (const s of scopes) {
    if (s.startsWith("input: ")) input.push(s.slice("input: ".length));
    else if (s.startsWith("output: ")) output.push(s.slice("output: ".length));
    else plain.push(s);
  }
  return { input, output, plain };
}

/**
 * Plain-language datatype for a token's VALUE, deduced from its `Traits:` line
 * and kind: boolean, comparison, scope target, database key, block. null when
 * the docs give no basis to say (e.g. a plain event target — the `→ type` head
 * already carries that).
 */
function valueShape(token: TokenData): string | null {
  const tMatch = /Traits:\s*([^\n]*)/i.exec(token.traits ?? "");
  const t = (tMatch ? tMatch[1] : "").trim();
  if (token.kind === "trigger") {
    if (/\byes\/no\b/i.test(t)) return "`yes`/`no` (boolean)";
    if (/valid date/i.test(t)) return "a date, or a comparison operator + date";
    if (/[<>]=?|!=/.test(t)) return "a number or script value (comparison: `<` `<=` `=` `!=` `>` `>=`)";
    const scopeM = /\b([A-Za-z_][A-Za-z0-9_]*)\s+(scope|target)\b/i.exec(t);
    if (scopeM) return `a ${scopeM[1]} ${scopeM[2].toLowerCase()}`;
    if (/\bkey\b/i.test(t)) return "a database key";
    if (t) return `one of: ${t}`;
    return null;
  }
  if (token.kind === "effect") {
    if (token.usage && token.usage.includes("{")) return "a block — see the example below";
    return null;
  }
  if (token.kind === "modifier") return "a number (the modifier's magnitude)";
  return null;
}

/** Metadata trait lines minus the `Traits:`/legacy `Example:` lines, flattened. */
function otherTraitBits(traits: string | undefined): string[] {
  if (!traits) return [];
  return traits
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !/^Traits:/i.test(l) && !/^Example:/i.test(l));
}

/** Definition kinds that name a VALUE-side identity (something you reference
 * with `scope:`/`var:` or as a list), never what an assignment KEY means. */
const VALUE_IDENTITY_KINDS = new Set(["saved_scope", "list", ...Object.values(VAR_PREFIX_KINDS).flat()]);

/** True when the cursor sits on the KEY of an unquoted assignment. */
function atKeyPosition(document: TextDocument, position: Position): boolean {
  const { result, lineIndex } = getParse(document);
  const offset = lineIndex.offsetAt(position);
  const hit = nodeAtOffset(result.root, offset);
  const last = hit?.path[hit.path.length - 1];
  return (
    !!last &&
    last.kind === "assignment" &&
    !last.key.quoted &&
    offset >= last.key.range.start &&
    offset <= last.key.range.end
  );
}

/**
 * Cards for a set of same-named definitions: one card per KIND, with N same-kind
 * sites collapsed into a single card ("33 sites") instead of 33 identical cards.
 * The name-wide reference count renders once, on the first card, because it is
 * a property of the name, not of any one definition.
 */
function definitionCards(
  data: ServerData,
  defs: Array<ReturnType<ServerData["index"]["lookup"]>[number]>,
  at?: { uri: string; line: number; character: number }
): string[] {
  const order: string[] = [];
  const byKind = new Map<string, typeof defs>();
  for (const def of defs) {
    let group = byKind.get(def.kind);
    if (!group) {
      byKind.set(def.kind, (group = []));
      order.push(def.kind);
    }
    group.push(def);
  }
  const cards: string[] = [];
  let withRefs = true;
  for (const kind of order) {
    const group = byKind.get(kind)!;
    cards.push(
      group.length === 1
        ? definitionCard(data, group[0], at, withRefs)
        : definitionGroupCard(data, group, at, withRefs)
    );
    withRefs = false;
  }
  return cards;
}

/** The "N references" command link for a name, once per hover. Clients that do
 * not register the references command get NOTHING: a count nobody can click
 * answers no question the card was not already answering. */
function referencesFooter(
  data: ServerData,
  name: string,
  at?: { uri: string; line: number; character: number }
): string | null {
  if (!canRunCommand(clientCommands.showReferences)) return null;
  const refs = data.refIndex.lookup(name).length;
  if (refs === 0) return null;
  const label = `${refs.toLocaleString("en-US")} reference${refs === 1 ? "" : "s"}`;
  return at
    ? `[${label}](command:${clientCommands.showReferences}?${encodeURIComponent(
        JSON.stringify([at.uri, at.line, at.character])
      )} "Show all references")`
    : label;
}

/** One card for N same-named, same-kind definitions: origin + site count up
 * front, the first few sites as links, the rest as a count. */
function definitionGroupCard(
  data: ServerData,
  group: Array<ReturnType<ServerData["index"]["lookup"]>[number]>,
  at?: { uri: string; line: number; character: number },
  withRefs = true
): string {
  const def = group[0];
  const origins = [...new Set(group.map((d) => data.originLabel(d)))];
  const card: CardInput = {
    kind: def.kind,
    badgeLabel: def.kind.replace(/_/g, " "),
    name: def.name,
    headTail:
      origins.length === 1
        ? `· ${origins[0]} (${group.length} sites)`
        : `· ${group.length} sites in ${origins.join(", ")}`,
  };
  const footer = group.slice(0, 3).map(provenance);
  if (group.length > 3) footer.push(`+${group.length - 3} more`);
  if (withRefs) {
    const refs = referencesFooter(data, def.name, at);
    if (refs) footer.push(refs);
  }
  card.footer = footer;
  return renderCard(card);
}

/** An indexed-definition card: badge, name, `· source`, provenance link (§D2 mock 2). */
function definitionCard(
  data: ServerData,
  def: ReturnType<ServerData["index"]["lookup"]>[number],
  at?: { uri: string; line: number; character: number },
  withRefs = true
): string {
  const card: CardInput = { kind: def.kind, badgeLabel: def.kind.replace(/_/g, " "), name: def.name };
  // Origin: the owning mod's descriptor name where known ("· My Mod"), the raw
  // source tag ("· vanilla") otherwise.
  const origin = data.originLabel(def);
  card.headTail = `· ${origin}`;
  if (def.kind === "loc_key" && def.value !== undefined) card.doc = `"${def.value}"`;
  // Ad-hoc lists carry a statically resolved item type (varTypes.ts).
  if (def.kind === "list") {
    const item = variableTypes(data, data.rootScopesForFile).adhocListItemTypes.get(def.name);
    if (item && item.size > 0) {
      card.headTail = `of ${[...item].map(scopeType).join(" | ")} · ${origin}`;
    }
  }

  // Doc-comment prose + structured tags (§E3). Prose first, then tags; `@example`
  // fills the fenced slot; `@deprecated` strikes the name. Empty when absent.
  const body = extractDoc(def);
  if (body.doc) card.doc = body.doc;
  if (body.example) card.example = body.example;
  if (body.deprecated) card.name = `~~${def.name}~~`;

  const footer: string[] = [provenance(def)];
  // Full count including key-position call sites (usageCount excludes those).
  // A command link opens the references view; the client's hover middleware
  // trusts exactly this command (extension.ts). Plain text without an anchor.
  // Only the hover's first definition card carries it: the count belongs to
  // the NAME, so repeating it per meaning taught nothing.
  if (withRefs) {
    const refs = referencesFooter(data, def.name, at);
    if (refs) footer.push(refs);
  }
  card.footer = footer;
  return renderCard(card);
}

/** `file.txt:line` provenance, as a markdown link when a file URI is feasible. */
function provenance(def: { file: string; line: number }): string {
  return fileLink(def.file, `${path.basename(def.file)}:${def.line + 1}`, String(def.line + 1));
}

/**
 * The single chokepoint for every `file:` link a hover card emits. Plain text
 * when no absolute path is available (fail-soft, e.g. synthetic defs) OR when
 * the client did not declare `fileLinks`: the same label, minus a link its
 * hover renderer would not navigate.
 */
function fileLink(file: string, label: string, fragment: string): string {
  if (!fileLinks() || !file || !path.isAbsolute(file)) return label;
  return `[${label}](${URI.file(file).with({ fragment }).toString()})`;
}

/**
 * Doc-comment / example extraction (§D2 mock 2, §E3). Reads the PdxDoc fields
 * captured at index time (`Definition.doc`/`.tags`) and renders prose + tags.
 * Fail-soft: an undocumented definition yields an empty body.
 */
function extractDoc(def: Definition): ReturnType<typeof renderDocBody> {
  return renderDocBody(def);
}

/** A saved-scope card: badge, name, `→ type`, save-site link, ambient doc (§D2 mock 3). */
function savedScopeCard(
  data: ServerData,
  document: TextDocument,
  name: string,
  rootScopes: Set<Scope> | null,
  entry: SchemaEntry | null
): string {
  const ambient = entry?.ambientScopes?.find((a) => a.name === name);
  const ictx = inferenceContextFor(data, entry);
  const saved = getSavedScopes(document, data.scopeModel, rootScopes, entry?.ambientScopes, ictx);
  const inferred = saved.get(name);
  // Cross-file fallback: types merged over every indexed save site of the mod.
  const global = inferred === undefined || inferred === null ? ictx.savedScopeTypes?.get(name) : undefined;
  const typed = inferred && inferred.size > 0 ? inferred : global && global.size > 0 ? global : null;
  const type = ambient?.type ?? (typed ? [...typed].join(" | ") : "unknown");

  const card: CardInput = {
    kind: "saved_scope",
    name: `scope:${name}`,
    headTail: `→ ${scopeType(type)}`,
  };

  const doc: string[] = [];
  if (ambient) doc.push(`${ambient.doc}${entry ? ` *(${entry.kind.replace(/_/g, " ")})*` : ""}`);

  const site = firstSaveSite(document, name);
  if (site !== null) doc.push(`Saved in this file: ${path.basename(URIToPath(document.uri))}:${site + 1}`);
  else if (ambient) doc.push(`Engine-provided (not saved in this file).`);
  else if (!inferred) {
    // Not saved here: link the mod's save sites (like the variable card does).
    const sites = data.index
      .lookup(name)
      .filter((d) => d.kind === "saved_scope")
      .slice(0, 3);
    if (sites.length > 0) {
      doc.push(
        sites
          .map(
            (d) => `saved in ${fileLink(d.file, `${path.basename(d.file)}:${d.line + 1}`, `L${d.line + 1}`)}`
          )
          .join("  \n")
      );
    } else {
      doc.push(`Saved elsewhere in the mod.`);
    }
  }

  if (doc.length > 0) card.doc = doc.join("  \n");
  return renderCard(card);
}

/** Line (0-based) of the first `save_scope_as`/`save_temporary_scope_as`/
 * `save_temporary_value_as = name` in the file. */
const SAVE_SITE_KEYS = new Set(["save_scope_as", "save_temporary_scope_as", "save_temporary_value_as"]);
function firstSaveSite(document: TextDocument, name: string): number | null {
  const { result, lineIndex } = getParse(document);
  let line: number | null = null;
  walkStatements(result.root, (stmt) => {
    if (line !== null) return;
    if (stmt.kind !== "assignment" || stmt.key.quoted) return;
    if (!SAVE_SITE_KEYS.has(stmt.key.text)) return;
    if (stmt.value?.kind === "scalar" && !stmt.value.quoted && stmt.value.text === name) {
      line = lineIndex.positionAt(stmt.value.range.start).line;
    }
  });
  return line;
}

/** A structure-key card: KeySpec doc plus provenance (§B2). */
function structureKeyCard(
  document: TextDocument,
  position: Position,
  word: string,
  entry: SchemaEntry,
  getSchema: () => SchemaData
): string | null {
  const { result, lineIndex } = getParse(document);
  const offset = lineIndex.offsetAt(position);
  const ctx = structureContextAt(result, offset, entry.kind, getSchema().structures);
  if (!ctx) return null;
  const spec = ctx.keys.get(word);
  if (!spec) return null;
  const source = getSchema().structures.source(entry.kind) ?? entry.kind;
  const where = ctx.block ? `in \`${ctx.block}\`` : "";
  const card: CardInput = {
    kind: "structure_key",
    badgeLabel: `${entry.kind.replace(/_/g, " ")} key`,
    name: word,
  };
  if (where) card.headTail = where;
  card.doc = spec.doc ? `${spec.doc} *(${source})*` : `*(${source})*`;
  return renderCard(card);
}

/** `type = character_event` — the value is a member of the key's structure enum. */
function enumValueCard(
  document: TextDocument,
  position: Position,
  word: string,
  entry: SchemaEntry,
  getSchema: () => SchemaData
): string | null {
  const { result, lineIndex } = getParse(document);
  const offset = lineIndex.offsetAt(position);
  const hit = nodeAtOffset(result.root, offset);
  const last = hit?.path[hit.path.length - 1];
  if (!last || last.kind !== "assignment" || last.key.quoted) return null;
  if (last.value?.kind !== "scalar" || last.value.quoted) return null;
  if (offset < last.value.range.start || offset > last.value.range.end) return null;
  const ctx = structureContextAt(result, offset, entry.kind, getSchema().structures);
  const spec = ctx?.keys.get(last.key.text);
  if (!spec?.values?.startsWith("enum:")) return null;
  const members = spec.values.slice(5).split("|");
  if (!members.includes(word)) return null;
  return renderCard({
    kind: "structure_key",
    badgeLabel: `${last.key.text} value`,
    name: word,
    doc: `One of: ${members.map((m) => (m === word ? `**${m}**` : m)).join(" · ")}`,
  });
}

/** `my_effect = { AMOUNT = 3 }` — the key is a $PARAM$ of the called scripted effect/trigger. */
function macroParamCard(
  data: ServerData,
  document: TextDocument,
  position: Position,
  word: string
): string | null {
  const { result, lineIndex } = getParse(document);
  const offset = lineIndex.offsetAt(position);
  const hit = nodeAtOffset(result.root, offset);
  const last = hit?.path[hit.path.length - 1];
  if (!last || last.kind !== "assignment" || last.key.quoted) return null;
  if (offset < last.key.range.start || offset > last.key.range.end) return null;
  const enclosing = hit!.path[hit!.path.length - 2];
  if (!enclosing || enclosing.kind !== "assignment" || enclosing.key.quoted) return null;
  const callee = enclosing.key.text;
  for (const def of data.index.lookup(callee)) {
    if (def.kind !== "scripted_effect" && def.kind !== "scripted_trigger") continue;
    if (!def.params?.includes(word)) continue;
    return renderCard({
      kind: "macro_param",
      badgeLabel: "parameter",
      name: word,
      headTail: `of ${def.kind.replace(/_/g, " ")} \`${callee}\``,
      doc: `Replaces \`$${word}$\` in the ${def.kind.replace(/_/g, " ")}'s body.`,
    });
  }
  return null;
}

/**
 * `has_relation_dao_guide` — triggers/effects the engine generates per scripted
 * relation (`has_relation_X`, `set_relation_X`, `remove_relation_X`).
 */
function relationTriggerCard(data: ServerData, word: string): string | null {
  const m = /^(has|set|remove)_relation_([A-Za-z0-9_]+)$/.exec(word);
  if (!m) return null;
  const def = data.index.lookup(m[2]).find((d) => d.kind === "scripted_relation");
  if (!def) return null;
  const verb =
    m[1] === "has"
      ? "Trigger: the scoped character has"
      : m[1] === "set"
        ? "Effect: gives the scoped character"
        : "Effect: removes the scoped character's";
  return renderCard({
    kind: m[1] === "has" ? "trigger" : "effect",
    name: word,
    headTail: `· generated from \`${m[2]}\``,
    doc: `${verb} the scripted relation \`${m[2]}\` (${path.basename(def.file)}:${def.line + 1}) with the target character.`,
  });
}

/**
 * `french_opinion` — modifiers the engine generates per definition, matched
 * lazily against the templated modifiers.log tags ($CULTURE$_opinion) and the
 * definition index (never materialized: AGOT-scale mods define thousands of
 * cultures).
 */
function templatedModifierCard(data: ServerData, word: string): string | null {
  const m = matchTemplatedModifier(word, data.modifierTemplates, (n) => data.index.lookup(n));
  if (!m) return null;
  const card: CardInput = {
    kind: "modifier",
    name: word,
    headTail: `· generated from \`${m.template.name}\``,
    doc: templatedModifierDoc(m),
  };
  if (m.template.traits) card.traits = m.template.traits.split("\n").join(" · ");
  return renderCard(card);
}

/**
 * `start_scheme = { target_character = … }` — the key is a block argument of an
 * engine effect/trigger call; surface the call's own doc, which describes its
 * arguments. Last-resort fallback: anything more specific wins.
 */
function effectArgumentCard(
  data: ServerData,
  document: TextDocument,
  position: Position,
  word: string
): string | null {
  const { result, lineIndex } = getParse(document);
  const offset = lineIndex.offsetAt(position);
  const hit = nodeAtOffset(result.root, offset);
  const last = hit?.path[hit.path.length - 1];
  if (!last || last.kind !== "assignment" || last.key.quoted) return null;
  if (offset < last.key.range.start || offset > last.key.range.end) return null;
  const enclosing = hit!.path[hit!.path.length - 2];
  if (!enclosing || enclosing.kind !== "assignment" || enclosing.key.quoted) return null;
  const token = data.tokenMap.get(enclosing.key.text)?.[0];
  if (!token) return null;
  const card: CardInput = {
    kind: "structure_key",
    badgeLabel: "argument",
    name: word,
    headTail: `of ${token.kind.replace(/_/g, " ")} \`${token.name}\``,
  };
  if (token.doc) card.doc = token.doc;
  return renderCard(card);
}

/** `cultivation_ruin` in `trigger_event = cultivation_ruin.5` etc. — a declared event namespace. */
function namespaceCard(data: ServerData, word: string): string | null {
  if (!data.modNamespaces.has(word)) return null;
  return renderCard({
    kind: "namespace",
    badgeLabel: "event namespace",
    name: word,
    doc: `Events in this namespace are named \`${word}.<n>\`.`,
  });
}

/** The `define:NS|CONST` reference spanning the cursor, or null. */
function defineRefAt(
  lineText: string,
  character: number
): { namespace: string; name: string; start: number; end: number } | null {
  const re = /define:([A-Za-z0-9_]+)\|([A-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lineText)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (character >= start && character <= end) return { namespace: m[1], name: m[2], start, end };
  }
  return null;
}

/** A define card: name, resolved value, source file + layer, "overrides <layer>". */
function definesCard(data: ServerData, namespace: string, name: string): string | null {
  const res = data.defines.resolve(namespace, name);
  if (!res) return null;
  const footer = [defineSourceLink(res.winner)];
  if (res.shadowed.length > 0) footer.push(`overrides ${res.shadowed.map((s) => s.layer).join(", ")}`);
  return renderCard({
    kind: "define",
    badgeLabel: "define",
    name: `${namespace}|${name}`,
    headTail: `= ${res.winner.value}`,
    footer,
  });
}

/** `<layer> · [common/defines/…:line](uri)` provenance for a define entry. */
function defineSourceLink(e: DefineEntry): string {
  const norm = e.file.replace(/\\/g, "/");
  const i = norm.toLowerCase().lastIndexOf("/common/defines/");
  const rel = i >= 0 ? `${norm.slice(i + 1)}:${e.line + 1}` : `${path.basename(e.file)}:${e.line + 1}`;
  return `${e.layer} · ${fileLink(e.file, rel, String(e.line + 1))}`;
}

/** root/ROOT/this/prev(prev…)/from(from…) — scope navigation keywords. */
function scopeWordCard(word: string): string | null {
  const hit = scopeWordDoc(word);
  if (!hit) return null;
  return renderCard({ kind: "scope_word", badgeLabel: "scope", name: hit.name, doc: hit.doc });
}

/** Grammar/math glue vocabulary (limit, NOT, base, days…): curated docs. */
function keywordCard(word: string): string | null {
  const doc = KEYWORD_DOCS[word];
  if (!doc) return null;
  return renderCard({ kind: "keyword", name: word, doc });
}

/**
 * The definition kinds a ref field expects at this position, when the cursor
 * sits on the VALUE of such a field (`theme = X` scalar form, `events = { X }`
 * list form). null anywhere else — key position, non-ref keys, quoted values.
 */
function refKindsAt(
  document: TextDocument,
  position: Position,
  refFields: Map<string, RefField>
): string[] | null {
  const { result, lineIndex } = getParse(document);
  const offset = lineIndex.offsetAt(position);
  const hit = nodeAtOffset(result.root, offset);
  if (!hit) return null;
  const last = hit.path[hit.path.length - 1];

  // `key = word` — scalar value of an assignment.
  if (
    last.kind === "assignment" &&
    !last.key.quoted &&
    last.value?.kind === "scalar" &&
    !last.value.quoted &&
    offset >= last.value.range.start &&
    offset <= last.value.range.end
  ) {
    const field = refFields.get(last.key.text);
    if (field) return field.form !== "list" ? field.kinds : null;
    // Block-scoped ref keys (`trigger_event = { id = X }`,
    // `override_background = { reference = X }`).
    const enclosing = hit.path[hit.path.length - 2];
    if (enclosing?.kind === "assignment" && !enclosing.key.quoted) {
      return activeProfile().blockRefFields[enclosing.key.text.toLowerCase()]?.[last.key.text] ?? null;
    }
    return null;
  }

  // `key = { word ... }` — bare list element; the owning assignment is one up.
  if (last.kind === "value" && last.value.kind === "scalar" && !last.value.quoted) {
    const parent = hit.path[hit.path.length - 2];
    if (parent?.kind === "assignment" && !parent.key.quoted) {
      const field = refFields.get(parent.key.text);
      return field && field.form !== "scalar" ? field.kinds : null;
    }
  }
  return null;
}

/** The inferred scope set at the cursor, or null when inference is unavailable. */
function currentScopes(
  data: ServerData,
  document: TextDocument,
  position: Position,
  rootScopes: Set<Scope> | null,
  entry: SchemaEntry | null
): Set<string> | null {
  const inference = scopeInference(data, document, position, rootScopes, entry);
  return inference.scopes && inference.scopes.size > 0 ? inference.scopes : null;
}

function scopeInference(
  data: ServerData,
  document: TextDocument,
  position: Position,
  rootScopes: Set<Scope> | null,
  entry: SchemaEntry | null
): ReturnType<typeof inferScopeAt> {
  const { result, lineIndex } = getParse(document);
  const offset = lineIndex.offsetAt(position);
  const ictx = inferenceContextFor(data, entry);
  return inferScopeAt(
    result,
    offset,
    data.scopeModel,
    rootScopes,
    getSavedScopes(document, data.scopeModel, rootScopes, entry?.ambientScopes, ictx),
    ictx
  );
}

function URIToPath(uri: string): string {
  return uri.replace(/^file:\/\/\/?/, "").replace(/\//g, path.sep);
}
