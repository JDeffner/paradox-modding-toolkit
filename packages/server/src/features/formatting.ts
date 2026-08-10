/**
 * Conservative formatter (rework plan Phase 5): indentation only — one tab per
 * brace depth, computed from the lexer so strings and comments can never fool
 * it. Nothing but leading whitespace is ever touched, which makes idempotence
 * trivial and the diff reviewable.
 */
import type { TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { LineIndex, tokenize } from "../parser";

export function provideFormattingEdits(document: TextDocument): TextEdit[] {
  const text = document.getText();
  const lines = new LineIndex(text);
  const tokens = tokenize(text);

  // Depth at the start of each line, and whether the line's first token closes.
  const openBefore: number[] = new Array(lines.lineCount).fill(0);
  const closersAtStart: number[] = new Array(lines.lineCount).fill(0);
  let depth = 0;
  let tokenIdx = 0;
  for (let line = 0; line < lines.lineCount; line++) {
    openBefore[line] = depth;
    const lineEnd = line + 1 < lines.lineCount ? lines.lineStart(line + 1) : text.length;
    let leadingClosers = 0;
    let sawNonCloser = false;
    while (tokenIdx < tokens.length && tokens[tokenIdx].start < lineEnd) {
      const t = tokens[tokenIdx];
      if (t.kind === "lbrace") {
        depth++;
        sawNonCloser = true;
      } else if (t.kind === "rbrace") {
        depth = Math.max(0, depth - 1);
        if (!sawNonCloser) leadingClosers++;
      } else if (t.kind !== "eof") {
        sawNonCloser = true;
      }
      tokenIdx++;
    }
    closersAtStart[line] = leadingClosers;
  }

  const edits: TextEdit[] = [];
  for (let line = 0; line < lines.lineCount; line++) {
    const start = lines.lineStart(line);
    const end = line + 1 < lines.lineCount ? lines.lineStart(line + 1) : text.length;
    const lineText = text.slice(start, end).replace(/\r?\n$/, "");
    if (lineText.trim() === "") continue; // blank lines stay untouched
    const current = /^[\t ]*/.exec(lineText)![0];
    const target = "\t".repeat(Math.max(0, openBefore[line] - closersAtStart[line]));
    if (current === target) continue;
    edits.push({
      range: {
        start: { line, character: 0 },
        end: { line, character: current.length },
      },
      newText: target,
    });
  }
  return edits;
}
