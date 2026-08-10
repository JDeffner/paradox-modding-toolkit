/**
 * Document symbols (outline / breadcrumbs / sticky scroll), free with the CST:
 * the full nested block tree of a script or `.gui` file, and loc entries
 * grouped under the language header.
 */
import { SymbolKind, type DocumentSymbol, type Range as LspRange } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { AssignmentNode, LineIndex, Range, Statement } from "../parser";
import { EVENT_ID } from "../index/indexer";
import { DECL_MARKERS, SLOT_KEYS } from "../gui/declMarkers";
import { PROPERTY_BLOCKS } from "../gui/layoutEngine";
import { getLocParse, getParse } from "../parseCache";

function toLspRange(lines: LineIndex, range: Range): LspRange {
  return { start: lines.positionAt(range.start), end: lines.positionAt(range.end) };
}

function childBlockStatements(stmt: AssignmentNode): Statement[] {
  if (stmt.value?.kind === "block") return stmt.value.statements;
  if (stmt.value?.kind === "tagged-block") return stmt.value.block.statements;
  return [];
}

/** The scalar value of a direct child assignment named `key`, if any. */
function childScalar(statements: Statement[], key: string): string | null {
  for (const s of statements) {
    if (s.kind === "assignment" && !s.key.quoted && s.key.text === key && s.value?.kind === "scalar") {
      return s.value.text;
    }
  }
  return null;
}

export function provideDocumentSymbols(document: TextDocument): DocumentSymbol[] {
  if (document.languageId === "paradox-loc") return locSymbols(document);
  if (document.languageId === "paradox-gui") return guiSymbols(document);
  return scriptSymbols(document);
}

/**
 * PdxGui outline: the declaration markers (`types Group`, `template Name`,
 * `type name = base`) plus the FULL nested widget-block tree. Nesting is what
 * sticky scroll pins headers from and breadcrumbs navigate by. Property
 * blocks (`size = {...}`, `state`, `modify_texture`, ... — the engine's
 * PROPERTY_BLOCKS, the same "data, not children" split guiTree draws) emit no
 * symbol: measured over vanilla, they were 33% of hud.gui's and 14% of
 * custom_tooltip.gui's entries, pure noise between the widget headers. The
 * cap guards degenerate files; with the property filter the largest measured
 * vanilla file (right_click_menu.gui, ~3.7k widget blocks) fits under it.
 */
const GUI_SYMBOL_CAP = 6000;

/** A quoted scalar's text without its quotes (widget `name = "x"` details). */
function unquote(text: string): string {
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
}

function guiSymbols(document: TextDocument): DocumentSymbol[] {
  const { result, lineIndex } = getParse(document);
  const budget = { left: GUI_SYMBOL_CAP };
  return guiBlockSymbols(result.root.statements, lineIndex, budget);
}

function guiBlockSymbols(
  statements: Statement[],
  lineIndex: LineIndex,
  budget: { left: number }
): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  let marker: { word: string; start: number } | null = null;
  for (const stmt of statements) {
    if (budget.left <= 0) break;
    // `types X { }` / `template X { }` / `type x = base { }` /
    // `blockoverride "slot" { }` lex as a loose scalar marker followed by the
    // named assignment (guiDefs and the source model read them the same way).
    if (stmt.kind === "value") {
      if (stmt.value.kind === "scalar" && DECL_MARKERS.has(stmt.value.text.toLowerCase())) {
        marker = { word: stmt.value.text.toLowerCase(), start: stmt.range.start };
      } else if (stmt.value.kind === "block") {
        // An anonymous list block: no symbol of its own, but the widgets
        // inside still reach the outline.
        marker = null;
        symbols.push(...guiBlockSymbols(stmt.value.statements, lineIndex, budget));
      } else {
        marker = null;
      }
      continue;
    }
    const declared = marker?.word ?? null;
    const declaredStart = marker?.start;
    marker = null;
    if (stmt.kind !== "assignment") continue;
    const value = stmt.value;
    const block = value?.kind === "block" ? value : value?.kind === "tagged-block" ? value.block : null;
    if (!block) continue;
    const base = value?.kind === "tagged-block" ? value.tag.text : null;
    const lower = stmt.key.text.toLowerCase();
    // Property blocks are data, not structure (guiTree's split): no symbol,
    // no recursion — unless the key is a declared slot or the assignment
    // spelling of one (`blockoverride = "name" { ... }`).
    if (!declared && PROPERTY_BLOCKS.has(lower) && !(SLOT_KEYS.has(lower) && base)) continue;
    budget.left--;
    const children = guiBlockSymbols(block.statements, lineIndex, budget);
    let name = stmt.key.text;
    let detail: string | undefined;
    let kind: SymbolKind = SymbolKind.Object;
    if (declared === "types") {
      name = `types ${stmt.key.text}`;
      kind = SymbolKind.Namespace;
    } else if (declared === "template" || declared === "local_template") {
      name = `${declared} ${stmt.key.text}`;
      kind = SymbolKind.Class;
    } else if (declared === "block" || declared === "blockoverride") {
      name = `${declared} ${unquote(stmt.key.text)}`;
      kind = SymbolKind.Field;
    } else if (SLOT_KEYS.has(lower) && base) {
      // The assignment spelling of a slot: `blockoverride = "name" { ... }`.
      name = `${stmt.key.text} ${unquote(base)}`;
      kind = SymbolKind.Field;
    } else if (declared === "type" || base) {
      detail = base ? `= ${base}` : undefined;
      kind = SymbolKind.Class;
    } else {
      // A widget instance: its `name = "..."` property is how modders and the
      // game's error log identify it.
      const widgetName = childScalar(block.statements, "name");
      detail = widgetName ? unquote(widgetName) : undefined;
    }
    symbols.push({
      name,
      detail,
      kind,
      // A declaration's range starts at its marker word (`types`, `template`,
      // `blockoverride`...) so cursor-on-the-keyword still resolves to the
      // symbol; the marker is a sibling statement, so containment holds.
      range: toLspRange(lineIndex, { start: declaredStart ?? stmt.range.start, end: stmt.range.end }),
      selectionRange: toLspRange(lineIndex, stmt.key.range),
      children,
    });
  }
  return symbols;
}

/**
 * Script outline: every top-level definition and, under it, the FULL nested
 * block tree. The nesting is the point: sticky scroll pins its headers and
 * breadcrumbs walk it, so a `limit` eight levels down inside an event needs
 * every block above it named, not just the event.
 *
 * The cap guards degenerate files. It is spent on nesting only: top-level
 * definitions are always emitted, so a file past the budget degrades to the
 * old flat outline instead of going blank halfway down. Measured over the
 * vanilla corpus (3785 script files), only four exceed it (the giant history
 * and landed_titles files, worst case 21,677 blocks in
 * history/characters/japanese.txt, 103k lines).
 */
const SCRIPT_SYMBOL_CAP = 12000;

function scriptSymbols(document: TextDocument): DocumentSymbol[] {
  const { result, lineIndex } = getParse(document);
  const budget = { left: SCRIPT_SYMBOL_CAP };
  const symbols: DocumentSymbol[] = [];
  for (const stmt of result.root.statements) {
    if (stmt.kind !== "assignment" || stmt.key.quoted) continue;
    const name = stmt.key.text;
    if (name === "namespace") continue;
    const isEvent = EVENT_ID.test(name);
    const stmts = childBlockStatements(stmt);
    const detail = isEvent ? childScalar(stmts, "type") : childScalar(stmts, "name");
    symbols.push({
      name,
      detail: detail ? unquote(detail) : undefined,
      kind: isEvent ? SymbolKind.Event : SymbolKind.Function,
      range: toLspRange(lineIndex, stmt.range),
      selectionRange: toLspRange(lineIndex, stmt.key.range),
      children: scriptChildSymbols(stmts, lineIndex, budget),
    });
  }
  return symbols;
}

function scriptChildSymbols(
  statements: Statement[],
  lineIndex: LineIndex,
  budget: { left: number }
): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  for (const stmt of statements) {
    if (budget.left <= 0) break;
    if (stmt.kind !== "assignment") continue;
    const value = stmt.value;
    const block = value?.kind === "block" ? value : value?.kind === "tagged-block" ? value.block : null;
    if (!block) continue;
    // Two kinds of block earn no row, the same "data, not structure" split
    // guiSymbols draws with PROPERTY_BLOCKS: one holding nothing but bare
    // values (`traits = { brave shy }`, `color = { 0.5 0.5 0.5 }`), and one
    // that opens and closes on a single line, which can never be a sticky
    // header and only pads the outline.
    if (block.statements.length === 0 || block.statements.every((s) => s.kind === "value")) continue;
    const openLine = lineIndex.positionAt(block.openBrace).line;
    const closeLine = lineIndex.positionAt(block.closeBrace ?? block.range.end).line;
    if (closeLine <= openLine) continue;
    budget.left--;
    const named = childScalar(block.statements, "name");
    symbols.push({
      name: stmt.key.text,
      detail: named ? unquote(named) : undefined,
      kind: stmt.key.text === "option" ? SymbolKind.EnumMember : SymbolKind.Field,
      range: toLspRange(lineIndex, stmt.range),
      selectionRange: toLspRange(lineIndex, stmt.key.range),
      children: scriptChildSymbols(block.statements, lineIndex, budget),
    });
  }
  return symbols;
}

function locSymbols(document: TextDocument): DocumentSymbol[] {
  const { result, lineIndex } = getLocParse(document);
  const entries: DocumentSymbol[] = result.entries.map((e) => ({
    name: e.key,
    detail: e.value.length > 60 ? e.value.slice(0, 59) + "…" : e.value,
    kind: SymbolKind.String,
    range: toLspRange(lineIndex, { start: e.keyRange.start, end: e.valueRange.end + 1 }),
    selectionRange: toLspRange(lineIndex, e.keyRange),
  }));
  if (result.language !== null && result.headerRange) {
    return [
      {
        name: `l_${result.language}`,
        kind: SymbolKind.Namespace,
        range: {
          start: lineIndex.positionAt(result.headerRange.start),
          end: lineIndex.positionAt(Number.MAX_SAFE_INTEGER),
        },
        selectionRange: toLspRange(lineIndex, result.headerRange),
        children: entries,
      },
    ];
  }
  return entries;
}
