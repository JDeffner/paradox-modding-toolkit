/**
 * Completion, hover and signature help for [ ... ] data-function expressions
 * in .gui and localization files. Three knowledge layers, best-first:
 *
 *  - the user's DumpDataTypes output (version-exact names, args, returns);
 *  - the bundled wiki baseline (packages/server/data/<game>/dataTypes.json);
 *  - vanilla usage harvested from the user's own game files (dataFnUsage.ts):
 *    names newer than both tables, usage counts for ranking, observed literal
 *    arguments, formatting suffixes, and real example sites.
 *
 * AD-5 applies: unknown names never produce diagnostics; unresolved chains
 * fall back to the vanilla member pool instead of going silent.
 */
import { CompletionItemKind, type CompletionItem, type SignatureHelp } from "vscode-languageserver/node";
import { describeDataFn } from "../data/dataFnDocs";
import {
  membersOf,
  producersOf,
  resolveChainType,
  type DataTypeMember,
  type DataTypesData,
} from "../data/dataTypes";
import type { DataFnUsage } from "../data/dataFnUsage";
import type { DefinitionIndex } from "../index/indexer";
import { finalize, MAX_ITEMS, type CompletionResult } from "./completion";
import { fileLink, renderCard, renderHover, scopeType, type CardInput } from "./hoverRender";
import * as path from "path";

/**
 * Functions whose single quoted argument names a script definition, so the
 * literal completes from the definition index (the mod's own defs plus vanilla)
 * rather than only from harvested vanilla literals. Keyed by the function name
 * (the last chain segment), so it fires for any owner: `Scope.ScriptValue`,
 * `TopScope.ScriptValue`, `GetPlayer.MakeScope.ScriptValue`, … all map alike.
 *
 * Add an entry only when the dump signature or a vanilla example proves the
 * argument's kind. Verified against the 1.19 DumpDataTypes output:
 *  - ScriptValue( Arg0 ) → CFixedPoint, macro "Calculates the named script
 *    value" — Arg0 is a script_value key;
 *  - GetTrait( Arg0 ) → Trait, "Get the Trait object with the provided key" —
 *    Arg0 is a trait key.
 */
const ARG_INDEX_KIND: Record<string, string> = {
  ScriptValue: "script_value",
  GetTrait: "trait",
};

/**
 * The expression text when `linePrefix` ends inside an unclosed [ ... ], else
 * null. Datafunction expressions never span lines, so the line prefix is
 * enough context.
 */
export function datafunctionExprAt(linePrefix: string): string | null {
  let open = -1;
  for (let i = 0; i < linePrefix.length; i++) {
    const ch = linePrefix[i];
    if (ch === "[") open = i;
    else if (ch === "]") open = -1;
  }
  return open >= 0 ? linePrefix.slice(open + 1) : null;
}

/**
 * The dotted chain being typed at the end of an expression: for
 * `Concat( 'x', Character.GetFather.` → ["Character","GetFather",""].
 * The last element is the (possibly empty) segment under the cursor.
 */
export function chainAtEnd(expr: string): string[] {
  // Cut at the last argument/string/formatting boundary; dots stay.
  let start = 0;
  for (let i = expr.length - 1; i >= 0; i--) {
    if ("('\", |".includes(expr[i]) || expr[i] === ")") {
      start = i + 1;
      break;
    }
  }
  const tail = expr.slice(start).trim();
  if (tail.length === 0) return [""];
  if (!/^[A-Za-z0-9_.]*$/.test(tail)) return [""];
  return tail.split(".");
}

/** The innermost function call still open at the end of `expr`, if any. */
export interface OpenCall {
  /** Dotted chain of the called name, e.g. ["Character","GetHouseAspiration"]. */
  chain: string[];
  /** 0-based index of the argument the cursor is in. */
  argIndex: number;
  /** Text typed inside an unclosed '...' literal, or null when not in one. */
  literalPrefix: string | null;
}

export function openCallAt(expr: string): OpenCall | null {
  interface Frame {
    chain: string[];
    argIndex: number;
  }
  const stack: Frame[] = [];
  let chain: string[] = [];
  let word = "";
  const flushWord = () => {
    if (word.length > 0) {
      chain.push(word);
      word = "";
    }
  };
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/[A-Za-z0-9_]/.test(ch)) {
      word += ch;
      i++;
    } else if (ch === ".") {
      flushWord();
      i++;
    } else if (ch === "(") {
      flushWord();
      stack.push({ chain, argIndex: 0 });
      chain = [];
      i++;
    } else if (ch === ")") {
      stack.pop();
      chain = [];
      word = "";
      i++;
    } else if (ch === ",") {
      if (stack.length > 0) stack[stack.length - 1].argIndex++;
      chain = [];
      word = "";
      i++;
    } else if (ch === "'") {
      const close = expr.indexOf("'", i + 1);
      if (close < 0) {
        const top = stack[stack.length - 1];
        if (!top || top.chain.length === 0) return null;
        return { chain: top.chain, argIndex: top.argIndex, literalPrefix: expr.slice(i + 1) };
      }
      i = close + 1;
    } else if (ch === " " || ch === "\t") {
      flushWord();
      i++;
    } else {
      flushWord();
      chain = [];
      i++;
    }
  }
  const top = stack[stack.length - 1];
  if (!top || top.chain.length === 0) return null;
  return { chain: top.chain, argIndex: top.argIndex, literalPrefix: null };
}

/**
 * Text of the unclosed `'...'` literal at the end of `expr`, or null when the
 * cursor is not inside one. Pairs quotes the same way `openCallAt` does, but
 * needs no enclosing call — so a cast literal like `'(CFixedPoint` is seen even
 * when it is not a function argument.
 */
export function openLiteralPrefix(expr: string): string | null {
  let open = -1;
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === "'") open = open === -1 ? i : -1;
  }
  return open === -1 ? null : expr.slice(open + 1);
}

// ---- ranking / rendering helpers ----------------------------------------------

/** Log-bucketed frequency rank: higher vanilla usage sorts first. */
function freq3(count: number): string {
  return String(999 - Math.min(998, Math.round(Math.log2(1 + count) * 55))).padStart(3, "0");
}

function memberDetail(member: DataTypeMember, owner?: string): string {
  const args = member.args && member.args.length > 0 ? `( ${member.args.join(", ")} )` : "";
  const ret = member.ret ? ` → ${member.ret}` : "";
  return `${owner ? owner + " " : ""}${member.kind}${args}${ret}`;
}

function usesSuffix(count: number): string {
  return count > 0 ? ` · ${count.toLocaleString("en-US")}× in vanilla` : "";
}

const SOURCE_LABEL: Record<string, string> = {
  dump: "your DumpDataTypes log",
  wiki: "bundled wiki tables",
  macro: "game data_binding macro",
};

/** Total vanilla-usage count of a name in any role. */
function usageCount(usage: DataFnUsage, name: string): number {
  return (usage.starts.get(name) ?? 0) + (usage.memberPool.get(name) ?? 0);
}

/** Member rank: type-specific pairs weigh more than the global pool. */
function memberRank(usage: DataFnUsage, owner: string | null, name: string): number {
  const pair = owner ? (usage.pairs.get(owner)?.get(name) ?? 0) : 0;
  return pair * 3 + (usage.memberPool.get(name) ?? 0);
}

// ---- completion ----------------------------------------------------------------

/** Cursor position for explicit replace ranges (line of `linePrefix`). */
export interface DataFnCursor {
  line: number;
  character: number;
}

/**
 * Completion inside a [ ... ] expression, or null when the cursor is not in
 * one (caller falls through to its normal provider).
 *
 * When `cursor` is given, every item carries a textEdit replacing exactly the
 * typed tail segment. Without it, the client derives the replace range from
 * its word pattern — which includes "." for gui/loc files, so after
 * `[GetPlayer.` the word is the whole dotted chain: member items neither match
 * the filter nor insert correctly (#2).
 */
export function provideDataFnCompletion(
  data: DataTypesData,
  usage: DataFnUsage,
  linePrefix: string,
  index?: DefinitionIndex,
  cursor?: DataFnCursor
): CompletionResult | null {
  const expr = datafunctionExprAt(linePrefix);
  if (expr === null) return null;

  /** finalize + anchor each survivor to replace exactly the typed `partial`. */
  const finish = (items: CompletionItem[], partial: string): CompletionResult => {
    const result = finalize(items, partial, MAX_ITEMS);
    if (cursor) {
      const range = {
        start: { line: cursor.line, character: cursor.character - partial.length },
        end: { line: cursor.line, character: cursor.character },
      };
      for (const item of result.items) {
        item.textEdit = { range, newText: item.insertText ?? item.label };
      }
    }
    return result;
  };

  // Inside a cast literal `'(CFixedPoint)…'`: complete the datatype name. Comes
  // before the function-argument branch, since the cast sits inside a call too
  // (`GreaterThan_CFixedPoint( x, '(CFixed` ).
  const literal = openLiteralPrefix(expr);
  if (literal !== null && literal.startsWith("(") && !literal.includes(")")) {
    const partial = literal.slice(1);
    const items: CompletionItem[] = [...data.types.keys()].map((type) => ({
      label: type,
      kind: CompletionItemKind.Class,
      detail: "datatype (cast)",
      sortText: type,
      data: { t: "dfn" },
    }));
    return finish(items, partial);
  }

  // Inside a '...' literal argument: the definition index for functions whose
  // argument names a script definition (ScriptValue → the mod's own script
  // values, first), merged with the observed vanilla literals.
  const call = openCallAt(expr);
  if (call && call.literalPrefix !== null) {
    const fn = call.chain[call.chain.length - 1];
    const items: CompletionItem[] = [];
    const seen = new Set<string>();
    const indexKind = ARG_INDEX_KIND[fn];
    if (indexKind && index) {
      const kindLabel = indexKind.replace(/_/g, " ");
      for (const def of index.entries((d) => d.kind === indexKind)) {
        if (seen.has(def.name)) continue;
        seen.add(def.name);
        const isMod = def.source === "mod";
        items.push({
          label: def.name,
          kind: CompletionItemKind.Value,
          detail: `${kindLabel} (${def.source})`,
          // Mod defs first, then vanilla literals (tier 1, below), then the
          // rest of the index defs (tier 2).
          sortText: (isMod ? "0" : "2") + def.name,
          data: { t: "dfn" },
        });
      }
    }
    const lits = usage.literals.get(fn);
    if (lits) {
      for (const [value, count] of lits) {
        if (seen.has(value)) continue;
        seen.add(value);
        items.push({
          label: value,
          kind: CompletionItemKind.Value,
          detail: `argument of ${fn}${usesSuffix(count)}`,
          sortText: "1" + freq3(count) + value,
          data: { t: "dfn" },
        });
      }
    }
    return finish(items, call.literalPrefix);
  }

  // After `|`: formatting suffixes observed in vanilla ( |E, |U, |V0, … ).
  const fmt = /\|([A-Za-z0-9+\-=*%.]*)$/.exec(expr);
  if (fmt) {
    const items: CompletionItem[] = [...usage.formats.entries()]
      .filter(([, count]) => count >= 3)
      .map(([suffix, count]) => ({
        label: suffix,
        kind: CompletionItemKind.EnumMember,
        detail: `format suffix${usesSuffix(count)}`,
        sortText: freq3(count) + suffix,
        data: { t: "dfn" },
      }));
    return finish(items, fmt[1]);
  }

  const chain = chainAtEnd(expr);
  const typed = chain[chain.length - 1];
  const items: CompletionItem[] = [];

  if (chain.length === 1) {
    // Chain start: data types, global promotes/functions, and names vanilla
    // uses that neither table knows yet. Ranked by vanilla frequency.
    const seen = new Set<string>();
    for (const type of data.types.keys()) {
      seen.add(type);
      const count = usage.starts.get(type) ?? 0;
      items.push({
        label: type,
        kind: CompletionItemKind.Class,
        detail: `data type${usesSuffix(count)}`,
        sortText: freq3(count) + type,
        data: { t: "dfn" },
      });
    }
    for (const [name, member] of data.globals) {
      if (seen.has(name)) continue;
      seen.add(name);
      const count = usage.starts.get(name) ?? 0;
      const doc = member.desc ?? describeDataFn(name, member);
      items.push({
        label: name,
        kind: member.kind === "promote" ? CompletionItemKind.Variable : CompletionItemKind.Function,
        detail: `global ${memberDetail(member)}${usesSuffix(count)}`,
        ...(doc ? { documentation: doc } : {}),
        sortText: freq3(count) + name,
        data: { t: "dfn" },
      });
    }
    for (const [name, count] of usage.starts) {
      if (seen.has(name)) continue;
      const called = usage.argCounts.has(name);
      const hasMembers = usage.pairs.has(name);
      const doc = describeDataFn(name, null);
      items.push({
        label: name,
        kind: hasMembers && !called ? CompletionItemKind.Class : CompletionItemKind.Function,
        detail: `vanilla usage${usesSuffix(count)} (not in the data-type tables)`,
        ...(doc ? { documentation: doc } : {}),
        sortText: freq3(count) + name,
        data: { t: "dfn" },
      });
    }
    return finish(items, typed);
  }

  // Member position: resolve the chain to a type when the tables allow it.
  const ownerSegments = chain.slice(0, -1);
  const ownerType = resolveChainType(data, ownerSegments);
  const pairOwner = ownerSegments.length === 1 ? ownerSegments[0] : null;
  if (ownerType) {
    const members = membersOf(data, ownerType) ?? new Map<string, DataTypeMember>();
    const seen = new Set<string>();
    for (const [name, member] of members) {
      seen.add(name);
      const doc = member.desc ?? describeDataFn(name, member) ?? undefined;
      items.push({
        label: name,
        kind: member.kind === "promote" ? CompletionItemKind.Property : CompletionItemKind.Method,
        detail: memberDetail(member, ownerType + ".") + usesSuffix(memberRank(usage, ownerType, name)),
        ...(doc ? { documentation: doc } : {}),
        sortText: freq3(memberRank(usage, ownerType, name)) + name,
        data: { t: "dfn" },
      });
    }
    // Members vanilla chains off this same start but the tables don't list.
    const harvested = usage.pairs.get(ownerType) ?? (pairOwner ? usage.pairs.get(pairOwner) : undefined);
    for (const [name, count] of harvested ?? []) {
      if (seen.has(name)) continue;
      const doc = describeDataFn(name, null);
      items.push({
        label: name,
        kind: CompletionItemKind.Method,
        detail: `vanilla usage on ${pairOwner ?? ownerType}${usesSuffix(count)}`,
        ...(doc ? { documentation: doc } : {}),
        sortText: freq3(count) + name,
        data: { t: "dfn" },
      });
    }
    return finish(items, typed);
  }

  // Chain the tables cannot resolve (unknown start, missing return type…):
  // offer the vanilla member pool rather than nothing — AD-5, annotate not hide.
  const harvestedPairs = pairOwner ? usage.pairs.get(pairOwner) : undefined;
  if (harvestedPairs && harvestedPairs.size > 0) {
    for (const [name, count] of harvestedPairs) {
      const doc = describeDataFn(name, null);
      items.push({
        label: name,
        kind: CompletionItemKind.Method,
        detail: `vanilla usage on ${pairOwner}${usesSuffix(count)}`,
        ...(doc ? { documentation: doc } : {}),
        sortText: freq3(count) + name,
        data: { t: "dfn" },
      });
    }
    return finish(items, typed);
  }
  for (const [name, count] of usage.memberPool) {
    items.push({
      label: name,
      kind: CompletionItemKind.Method,
      detail: `vanilla usage${usesSuffix(count)} (chain not resolved)`,
      sortText: freq3(count) + name,
      data: { t: "dfn" },
    });
  }
  return finish(items, typed);
}

// ---- hover ----------------------------------------------------------------------

export interface DataFnHoverInfo {
  markdown: string;
  start: number;
  end: number;
}

function exampleLines(usage: DataFnUsage, name: string, gameRoot: string | null): string[] {
  const examples = usage.examples.get(name);
  if (!examples || examples.length === 0) return [];
  const lines = ["", "Vanilla examples:"];
  for (const ex of examples) {
    const site = `${ex.file}:${ex.line}`;
    const link = gameRoot
      ? fileLink(path.join(gameRoot, ex.file), site, { fragment: String(ex.line) })
      : site;
    lines.push(`- \`${ex.text}\` — ${link}`);
  }
  return lines;
}

function literalLines(usage: DataFnUsage, name: string): string[] {
  const lits = usage.literals.get(name);
  if (!lits || lits.size === 0) return [];
  const top = [...lits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([v]) => `\`'${v}'\``);
  return ["", `Observed arguments: ${top.join(", ")}${lits.size > 8 ? ", …" : ""}`];
}

function provenance(member: DataTypeMember | null): string {
  if (member?.src && SOURCE_LABEL[member.src]) return SOURCE_LABEL[member.src];
  return "deduced from vanilla usage";
}

/**
 * Badge kind for a data-function entry: a promote reads as a stored value (blue,
 * like a saved scope), a function asks for something (purple), which is the same
 * split every other hover surface draws.
 */
function badgeKind(kind: DataTypeMember["kind"]): string {
  return kind === "promote" ? "promote" : "datafn";
}

/** Head tail for a member card: `( args )` as code, then the blue `→ Return`. */
function headTailOf(member: DataTypeMember): string | undefined {
  const parts: string[] = [];
  if (member.args?.length) parts.push(`\`( ${member.args.join(", ")} )\``);
  if (member.ret) parts.push(`→ ${scopeType(member.ret)}`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * The card's doc slot from the detail lines the branches collect. They already
 * carry their own blank-line separators, so only the outer padding is trimmed.
 */
function detailDoc(lines: string[]): string | undefined {
  const text = lines.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
  return text.length > 0 ? text : undefined;
}

/** Producers listed by name in a hover before the tail becomes a count. */
const MAX_PRODUCERS = 6;

/**
 * "Produced by" line for a data type: the inverse of the member list, i.e. how
 * you obtain one of these in the first place. Ranked by vanilla usage, so the
 * names people actually write come first, then capped with a `+N more` tail.
 *
 * The cap matters because the spread is extreme: `Story` has two producers and
 * `Character` has 320. A bare count would answer neither; six ranked names plus
 * the remainder answers both.
 *
 * A member producer is ranked by the QUALIFIED pair count (`Scope` -> `Story`),
 * not by the bare member name: the bare name also counts `Story` as a chain
 * start and as a member of other owners, which is a different thing. The bare
 * count is the fallback only where vanilla never wrote that pair.
 */
function producerLines(data: DataTypesData, usage: DataFnUsage, type: string): string[] {
  const all = producersOf(data, type);
  if (all.length === 0) return [];
  const rank = (q: string) => {
    const dot = q.indexOf(".");
    if (dot < 0) return usageCount(usage, q);
    const pair = usage.pairs.get(q.slice(0, dot))?.get(q.slice(dot + 1));
    return pair ?? usageCount(usage, q.slice(dot + 1));
  };
  const ranked = [...all].sort((a, b) => rank(b) - rank(a) || a.localeCompare(b));
  const shown = ranked
    .slice(0, MAX_PRODUCERS)
    .map((n) => `\`${n}\``)
    .join(" ");
  const rest = all.length - MAX_PRODUCERS;
  return ["", `Produced by: ${shown}${rest > 0 ? ` +${rest.toLocaleString("en-US")} more` : ""}`];
}

/** Top-8 `.member` names observed after `name` in vanilla, as one hover line. */
function topMemberLines(usage: DataFnUsage, name: string, label: string): string[] {
  const pairs = usage.pairs.get(name);
  if (!pairs || pairs.size === 0) return [];
  const top = [...pairs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([n]) => `\`${n}\``);
  return ["", `${label}: ${top.join(" ")}`];
}

/**
 * Footer for names the loaded tables do not resolve. Which advice applies
 * depends on what is loaded: without a dump, running DumpDataTypes is the fix;
 * with one loaded, saying so again would read as "your logs were not found".
 */
function dumpHintFor(data: DataTypesData): string {
  return data.source === "data_types.log"
    ? "*Not in your `DumpDataTypes` dump (which is loaded) — shown from vanilla usage instead.*"
    : "*Using the bundled wiki tables. Run `DumpDataTypes` in the game console to load the complete, version-exact definitions.*";
}

/** Shared hover tail: description, observed literals, vanilla example sites. */
function usageDetailLines(
  usage: DataFnUsage,
  name: string,
  desc: string | null | undefined,
  gameRoot: string | null
): string[] {
  const lines: string[] = [];
  if (desc) lines.push("", desc);
  lines.push(...literalLines(usage, name));
  lines.push(...exampleLines(usage, name, gameRoot));
  return lines;
}

/**
 * Hover info for the chain segment at `character` when it sits inside a
 * [ ... ] expression and is known to any layer; null lets the caller fall
 * through to its normal hover.
 *
 * One card per hover, in the same shape every other hover surface uses
 * (hoverRender.ts): badge + name + `→ Return` head, the description and the
 * harvested detail lines in the doc slot, provenance in the muted facts line.
 */
export function provideDataFnHover(
  data: DataTypesData,
  usage: DataFnUsage,
  lineText: string,
  character: number,
  gameRoot: string | null = null
): DataFnHoverInfo | null {
  // Inside an expression? The [ must be open where the cursor sits.
  const prefix = lineText.slice(0, character);
  if (datafunctionExprAt(prefix) === null && lineText[character] !== "[") return null;

  // The dotted chain around the cursor.
  const isWord = (ch: string) => /[A-Za-z0-9_.]/.test(ch);
  let start = character;
  while (start > 0 && isWord(lineText[start - 1])) start--;
  let end = character;
  while (end < lineText.length && isWord(lineText[end])) end++;
  const dotted = lineText.slice(start, end);
  if (!/^[A-Za-z0-9_.]+$/.test(dotted)) return null;

  // Which segment is under the cursor?
  const segments = dotted.split(".");
  let segStart = start;
  let index = 0;
  for (; index < segments.length; index++) {
    const segEnd = segStart + segments[index].length;
    if (character <= segEnd) break;
    segStart = segEnd + 1; // skip the dot
  }
  if (index >= segments.length) return null;
  const segment = segments[index];
  if (segment.length === 0) return null;

  const lines: string[] = [];
  const uses = usageCount(usage, segment);
  let card: CardInput;

  if (index === 0) {
    const typeMembers = membersOf(data, segment);
    if (typeMembers) {
      lines.push(...producerLines(data, usage, segment));
      lines.push(...topMemberLines(usage, segment, "Common members"));
      lines.push(...exampleLines(usage, segment, gameRoot));
      card = {
        kind: "data_type",
        name: segment,
        headTail: `· ${typeMembers.size.toLocaleString("en-US")} known members`,
        doc: detailDoc(lines),
      };
    } else {
      const global = data.globals.get(segment);
      if (global) {
        lines.push(
          ...usageDetailLines(usage, segment, global.desc ?? describeDataFn(segment, global), gameRoot)
        );
        card = {
          kind: badgeKind(global.kind),
          badgeLabel: `global ${global.kind}`,
          name: segment,
          headTail: headTailOf(global),
          doc: detailDoc(lines),
          facts: provenance(global),
        };
      } else if (uses > 0) {
        const desc = describeDataFn(segment, null);
        if (desc) lines.push("", desc);
        lines.push(...topMemberLines(usage, segment, "Members seen after it"));
        lines.push(...literalLines(usage, segment));
        lines.push(...exampleLines(usage, segment, gameRoot));
        card = {
          kind: "datafn",
          badgeLabel: "data function",
          name: segment,
          doc: detailDoc(lines),
          facts: `not in the data-type tables — ${provenance(null)}`,
          provenance: dumpHintFor(data),
        };
      } else {
        return null;
      }
    }
  } else {
    const ownerType = resolveChainType(data, segments.slice(0, index));
    const member = ownerType ? membersOf(data, ownerType)?.get(segment) : undefined;
    // The chain's owner type may not resolve (unknown start, missing return
    // type) while the member name is still in the tables — match by name so a
    // loaded dump keeps answering (dump names are near-unique per type).
    const byName: Array<{ owner: string; member: DataTypeMember }> = [];
    if (!member) {
      for (const [typeName, members] of data.types) {
        const m = members.get(segment);
        if (m) byName.push({ owner: typeName, member: m });
        if (byName.length >= 6) break;
      }
    }
    if (member && ownerType) {
      lines.push(
        ...usageDetailLines(usage, segment, member.desc ?? describeDataFn(segment, member), gameRoot)
      );
      card = {
        kind: badgeKind(member.kind),
        badgeLabel: `${member.kind} on ${ownerType}`,
        name: `${ownerType}.${segment}`,
        headTail: headTailOf(member),
        doc: detailDoc(lines),
        facts: provenance(member),
      };
    } else if (byName.length > 0) {
      const hit = byName[0];
      if (byName.length > 1) {
        lines.push(
          "",
          `Also defined on: ${byName
            .slice(1)
            .map((o) => `\`${o.owner}\``)
            .join(" ")}${byName.length >= 6 ? " …" : ""}`
        );
      }
      lines.push(
        ...usageDetailLines(usage, segment, hit.member.desc ?? describeDataFn(segment, hit.member), gameRoot)
      );
      card = {
        kind: badgeKind(hit.member.kind),
        badgeLabel: `${hit.member.kind} on ${hit.owner}`,
        name: `${hit.owner}.${segment}`,
        headTail: headTailOf(hit.member),
        doc: detailDoc(lines),
        facts: `${provenance(hit.member)}, matched by name (the chain before it did not resolve to a type)`,
      };
    } else if (uses > 0) {
      lines.push(...usageDetailLines(usage, segment, describeDataFn(segment, null), gameRoot));
      card = {
        kind: "datafn",
        badgeLabel: "member",
        name: segment,
        doc: detailDoc(lines),
        facts: provenance(null),
        provenance: dumpHintFor(data),
      };
    } else {
      return null;
    }
  }
  return {
    markdown: renderHover([renderCard(card)], null),
    start: segStart,
    end: segStart + segment.length,
  };
}

// ---- signature help ----------------------------------------------------------------

/**
 * Signature help for the innermost open call in a [ ... ] expression:
 * `ObjectsEqual( a, | )` shows the argument list with the active one
 * highlighted. Argument types come from the dump when known, else the
 * most-observed vanilla arity.
 */
export function provideDataFnSignature(
  data: DataTypesData,
  usage: DataFnUsage,
  lineText: string,
  character: number
): SignatureHelp | null {
  const prefix = lineText.slice(0, character);
  const expr = datafunctionExprAt(prefix);
  if (expr === null) return null;
  const call = openCallAt(expr);
  if (!call) return null;

  const fn = call.chain[call.chain.length - 1];
  let member: DataTypeMember | undefined;
  let owner: string | null = null;
  if (call.chain.length > 1) {
    owner = resolveChainType(data, call.chain.slice(0, -1));
    if (owner) member = membersOf(data, owner)?.get(fn);
  } else {
    member = data.globals.get(fn);
  }
  if (!member) {
    // Any type carrying this member (dump data makes this near-unique).
    for (const [typeName, members] of data.types) {
      const m = members.get(fn);
      if (m?.args && m.args.length > 0) {
        member = m;
        owner = typeName;
        break;
      }
    }
  }

  let argNames: string[];
  if (member?.args && member.args.length > 0) {
    argNames = member.args;
  } else {
    const arities = usage.argCounts.get(fn);
    if (!arities || arities.size === 0) return null;
    let best = 0;
    let bestCount = -1;
    for (const [arity, count] of arities) {
      if (count > bestCount) {
        best = arity;
        bestCount = count;
      }
    }
    if (best === 0) return null;
    argNames = Array.from({ length: best }, (_, i) => `arg${i + 1}`);
  }

  // Build the label with per-parameter offsets so duplicate type names
  // (CString, CString) still highlight the right one.
  let label = `${fn}( `;
  const params: Array<{ label: [number, number]; documentation?: string }> = [];
  argNames.forEach((arg, i) => {
    if (i > 0) label += ", ";
    const from = label.length;
    label += arg;
    params.push({ label: [from, label.length] });
  });
  label += " )";
  if (member?.ret) label += ` → ${member.ret}`;

  const docParts: string[] = [];
  const desc = member?.desc ?? describeDataFn(fn, member ?? null);
  if (desc) docParts.push(desc);
  const lits = usage.literals.get(fn);
  if (lits && lits.size > 0) {
    const top = [...lits.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([v]) => `'${v}'`);
    docParts.push(`Observed arguments: ${top.join(", ")}${lits.size > 6 ? ", …" : ""}`);
  }
  if (member === undefined)
    docParts.push(
      `Arity observed in vanilla usage (${usage.argCounts.get(fn)?.get(argNames.length) ?? 0} sites).`
    );

  return {
    signatures: [
      {
        label,
        ...(docParts.length > 0 ? { documentation: docParts.join("\n\n") } : {}),
        parameters: params,
      },
    ],
    activeSignature: 0,
    activeParameter: Math.min(call.argIndex, argNames.length - 1),
  };
}
