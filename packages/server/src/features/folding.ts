/**
 * Folding ranges from the CST: every `{}` block spanning multiple lines, plus
 * runs of consecutive comment lines. Serves every brace language the client
 * routes here (script, .gui, and the descriptor/format-doc languages). The
 * provider being registered means VS Code never falls back to indentation
 * folding, so returning [] for a routed language actively disables folding
 * there. Loc files have no braces; they
 * fold the `l_<lang>:` body and comment banners instead.
 */
import { FoldingRangeKind, type FoldingRange } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { walkStatements, type BlockNode, type Statement } from "../parser";
import { getLocParse, getParse } from "../parseCache";

function blockOf(stmt: Statement): BlockNode | null {
  const v = stmt.value;
  if (!v) return null;
  if (v.kind === "block") return v;
  if (v.kind === "tagged-block") return v.block;
  return null;
}

/** Comment banners: 2+ consecutive full-line comments fold as one region. */
function commentRuns(lines: { line: number; atLineStart: boolean }[]): FoldingRange[] {
  const ranges: FoldingRange[] = [];
  let runStart = -1;
  let prevLine = -2;
  const flush = (lastLine: number) => {
    if (runStart >= 0 && lastLine > runStart) {
      ranges.push({ startLine: runStart, endLine: lastLine, kind: FoldingRangeKind.Comment });
    }
    runStart = -1;
  };
  for (const c of lines) {
    if (!c.atLineStart) continue;
    if (c.line === prevLine + 1 && runStart >= 0) {
      prevLine = c.line;
      continue;
    }
    flush(prevLine);
    runStart = c.line;
    prevLine = c.line;
  }
  flush(prevLine);
  return ranges;
}

export function provideFoldingRanges(document: TextDocument): FoldingRange[] {
  if (document.languageId === "paradox-loc") return locFoldingRanges(document);
  const { result, lineIndex } = getParse(document);
  const ranges: FoldingRange[] = [];

  walkStatements(result.root, (stmt) => {
    const block = blockOf(stmt);
    if (!block) return;
    const startLine = lineIndex.positionAt(block.openBrace).line;
    // Keep the closing brace visible when folded; an unclosed block (parser
    // recovery, range.end = EOF) has no brace to keep visible, so it folds
    // through its last line.
    const endLine =
      block.closeBrace != null
        ? lineIndex.positionAt(block.closeBrace).line - 1
        : lineIndex.positionAt(block.range.end).line;
    if (endLine > startLine) ranges.push({ startLine, endLine });
  });

  ranges.push(
    ...commentRuns(
      result.comments.map((c) => ({
        line: c.line,
        atLineStart: lineIndex.positionAt(c.range.start).character === 0,
      }))
    )
  );

  return ranges;
}

function locFoldingRanges(document: TextDocument): FoldingRange[] {
  const { result, lineIndex } = getLocParse(document);
  const ranges: FoldingRange[] = [];
  // The language body: header line down to the last entry.
  if (result.headerRange && result.entries.length > 0) {
    const startLine = lineIndex.positionAt(result.headerRange.start).line;
    const last = result.entries[result.entries.length - 1];
    const endLine = lineIndex.positionAt(last.valueRange.end).line;
    if (endLine > startLine) ranges.push({ startLine, endLine });
  }
  // Comment banners, by raw line scan (the loc parser keeps no comment list).
  // Vanilla indents body comments by one space, so any whitespace-then-`#`
  // line counts, matching the loc parser's own comment definition; a line-0
  // BOM is stripped first (line numbers are unaffected).
  const lines = document
    .getText()
    .replace(/^\uFEFF/, "")
    .split("\n");
  ranges.push(
    ...commentRuns(
      lines
        .map((text, line) => ({ line, text }))
        .filter(({ text }) => /^[ \t]*#/.test(text))
        .map(({ line }) => ({ line, atLineStart: true }))
    )
  );
  return ranges;
}
