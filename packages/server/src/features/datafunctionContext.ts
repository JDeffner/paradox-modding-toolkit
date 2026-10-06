import type { TextDocument } from "vscode-languageserver-textdocument";
import { getLocParse } from "../parseCache";

/** The grammar protects single-quoted arguments, including escaped quotes and brackets. */
export function datafunctionLiteralEnd(text: string, start: number, end: number): number {
  let i = start + 1;
  while (i < end) {
    if (text[i] === "\\") i += 2;
    else if (text[i++] === "'") return i;
  }
  return end + 1;
}

function expressionEnd(text: string, start: number, end: number): number {
  let i = start;
  while (i < end) {
    if (text[i] === "'") i = datafunctionLiteralEnd(text, i, end);
    else if (text[i] === "\\") i += 2;
    else if (text[i] === "]" || text[i] === '"') break;
    else i++;
  }
  return Math.min(i, end);
}

/** Bracket ranges include delimiters and retain multiline GUI bindings. */
export function datafunctionExpressionRanges(document: TextDocument): { start: number; end: number }[] {
  const text = document.getText();
  const ranges: { start: number; end: number }[] = [];
  const scan = (start: number, end: number, gui: boolean) => {
    let quoted = false;
    let i = start;
    while (i < end) {
      const ch = text[i];
      if (ch === "\\") {
        i += 2;
      } else if (gui && ch === '"') {
        quoted = !quoted;
        i++;
      } else if (gui && !quoted && ch === "#") {
        while (i < end && text[i] !== "\n" && text[i] !== "\r") i++;
      } else if (ch === "[") {
        const close = expressionEnd(text, i + 1, end);
        const rangeEnd = close + (text[close] === "]" ? 1 : 0);
        ranges.push({ start: i, end: rangeEnd });
        i = rangeEnd;
      } else {
        i++;
      }
    }
  };
  if (document.languageId === "paradox-gui") {
    scan(0, text.length, true);
  } else if (document.languageId === "paradox-loc") {
    for (const entry of getLocParse(document).result.entries)
      scan(entry.valueRange.start, entry.valueRange.end, false);
  }
  return ranges;
}

/** Expression prefix at a document offset, independent of the cursor's line. */
export function datafunctionExpressionAt(document: TextDocument, offset: number): string | null {
  const text = document.getText();
  const range = datafunctionExpressionRanges(document).find(({ start, end }) => {
    const contentEnd = end - (text[end - 1] === "]" ? 1 : 0);
    return offset > start && offset <= contentEnd;
  });
  return range ? text.slice(range.start + 1, offset) : null;
}
