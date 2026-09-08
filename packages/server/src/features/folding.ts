/**
 * Folding ranges from the CST: every `{}` block spanning multiple lines, plus
 * runs of consecutive comment lines and sections headed by 3+ hashes. Serves every brace language the client
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
function commentRuns(lines: { line: number; atLineStart: boolean; section?: boolean }[]): FoldingRange[] {
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
    // A section owns the fold on its heading line. Comment-only folds must
    // neither compete with it nor cross the next section heading.
    if (c.section) {
      flush(prevLine);
      prevLine = c.line;
      continue;
    }
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

const SECTION_HEADING = /^#{3,}[ \t]*[^#\s]/;

/** Headings are document-wide peers, regardless of indentation or hash count. */
function sectionRanges(headings: { line: number }[], lastLine: number): FoldingRange[] {
  return headings
    .map((heading, i) => ({
      startLine: heading.line,
      endLine: headings[i + 1] ? headings[i + 1].line - 1 : lastLine,
      kind: FoldingRangeKind.Region,
    }))
    .filter((r) => r.endLine > r.startLine);
}

/** Crossing folds cannot form an editor folding tree. Give explicit sections
 * priority over brace/body folds that would otherwise cut them short. */
function withSections(ranges: FoldingRange[], sections: FoldingRange[]): FoldingRange[] {
  const containing = (line: number): FoldingRange | undefined => {
    let low = 0;
    let high = sections.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (sections[mid].startLine <= line) low = mid + 1;
      else high = mid;
    }
    const section = sections[low - 1];
    return section && line <= section.endLine ? section : undefined;
  };
  return ranges
    .filter((range) => {
      const start = containing(range.startLine);
      const end = containing(range.endLine);
      return (
        !(start && range.startLine > start.startLine && range.endLine > start.endLine) &&
        !(end && range.startLine < end.startLine && range.endLine < end.endLine)
      );
    })
    .concat(sections);
}

export function provideFoldingRanges(document: TextDocument): FoldingRange[] {
  if (document.languageId === "paradox-loc") return locFoldingRanges(document);
  const { result, lineIndex } = getParse(document);
  const ranges: FoldingRange[] = [];
  const text = document.getText();

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

  const comments = result.comments.map((c) => ({
    line: c.line,
    atLineStart: /^[ \t\uFEFF]*$/.test(
      text.slice(lineIndex.offsetAt({ line: c.line, character: 0 }), c.range.start)
    ),
    section: SECTION_HEADING.test(c.text),
  }));
  ranges.push(...commentRuns(comments));
  return withSections(
    ranges,
    sectionRanges(
      comments.filter((c) => c.atLineStart && c.section),
      document.lineCount - 1
    )
  );
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
  const comments = lines
    .map((text, line) => ({ line, text: text.trimStart() }))
    .filter(({ text }) => text.startsWith("#"))
    .map(({ line, text }) => ({
      line,
      atLineStart: true,
      section: SECTION_HEADING.test(text),
    }));
  ranges.push(...commentRuns(comments));
  return withSections(
    ranges,
    sectionRanges(
      comments.filter((c) => c.section),
      lines.length - 1
    )
  );
}
