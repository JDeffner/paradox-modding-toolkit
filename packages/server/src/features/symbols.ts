/**
 * Document symbols (outline / breadcrumbs), free with the CST: top-level
 * definitions with their interesting children (event options with their loc
 * name, immediate/trigger/option blocks), and loc entries grouped under the
 * language header.
 */
import { SymbolKind, type DocumentSymbol, type Range as LspRange } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { AssignmentNode, LineIndex, Range, Statement } from "../parser";
import { EVENT_ID } from "../index/indexer";
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

const INTERESTING_CHILD_BLOCKS = new Set([
  "option",
  "immediate",
  "trigger",
  "after",
  "effect",
  "on_actions",
  "events",
  "random_events",
  "first_valid",
]);

export function provideDocumentSymbols(document: TextDocument): DocumentSymbol[] {
  if (document.languageId === "paradox-loc") return locSymbols(document);
  return scriptSymbols(document);
}

function scriptSymbols(document: TextDocument): DocumentSymbol[] {
  const { result, lineIndex } = getParse(document);
  const symbols: DocumentSymbol[] = [];
  for (const stmt of result.root.statements) {
    if (stmt.kind !== "assignment" || stmt.key.quoted) continue;
    const name = stmt.key.text;
    if (name === "namespace") continue;
    const isEvent = EVENT_ID.test(name);
    const children: DocumentSymbol[] = [];
    const stmts = childBlockStatements(stmt);
    for (const child of stmts) {
      if (child.kind !== "assignment" || child.key.quoted) continue;
      if (!INTERESTING_CHILD_BLOCKS.has(child.key.text)) continue;
      if (child.value?.kind !== "block") continue;
      let label = child.key.text;
      let detail: string | undefined;
      if (child.key.text === "option") {
        detail = childScalar(child.value.statements, "name") ?? undefined;
      }
      children.push({
        name: label,
        detail,
        kind: child.key.text === "option" ? SymbolKind.EnumMember : SymbolKind.Field,
        range: toLspRange(lineIndex, child.range),
        selectionRange: toLspRange(lineIndex, child.key.range),
      });
    }
    symbols.push({
      name,
      detail: isEvent ? (childScalar(stmts, "type") ?? undefined) : undefined,
      kind: isEvent ? SymbolKind.Event : SymbolKind.Function,
      range: toLspRange(lineIndex, stmt.range),
      selectionRange: toLspRange(lineIndex, stmt.key.range),
      children,
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
