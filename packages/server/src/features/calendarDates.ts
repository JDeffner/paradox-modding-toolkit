/**
 * Custom-calendar date display (px.calendar): inlay hints and hover that show
 * how a script date like `3000.1.1` reads in game under a total-conversion
 * mod's era system ("1000 BC"). Pure display; nothing here ever rewrites a
 * date. Mapping logic: @px-lsp/protocol/calendar.
 */
import {
  MarkupKind,
  type Hover,
  type InlayHint,
  type Position,
  type Range,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { displayDate, isValidScriptDate, monthsOf, type CalendarSetting } from "@px-lsp/protocol/calendar";
import { getLineText, isScriptLanguage } from "../documents";

interface DateToken {
  start: number;
  end: number;
  y: number;
  m: number;
  d: number;
}

// A bare Y.M.D run, not glued to a longer dotted token (event ids, decimals).
const DATE_TOKEN = /(?<![\w.])(\d{1,5})\.(\d{1,2})\.(\d{1,2})(?![\w.])/g;

/**
 * Calendar-valid date tokens on one line, comment tail and quoted strings
 * excluded (version strings like `"1.12.3"` are always quoted; unquoted digit
 * triplets in script are dates).
 */
export function dateTokensOnLine(cal: CalendarSetting, lineText: string): DateToken[] {
  // A `#` inside a quoted string is text, not a comment marker: find the
  // comment start with the quote state carried along.
  let quoted = false;
  let hash = -1;
  for (let i = 0; i < lineText.length && hash < 0; i++) {
    if (lineText[i] === '"') quoted = !quoted;
    else if (lineText[i] === "#" && !quoted) hash = i;
  }
  const code = hash >= 0 ? lineText.slice(0, hash) : lineText;
  const tokens: DateToken[] = [];
  DATE_TOKEN.lastIndex = 0;
  for (let match = DATE_TOKEN.exec(code); match; match = DATE_TOKEN.exec(code)) {
    const quotesBefore = (code.slice(0, match.index).match(/"/g) ?? []).length;
    if (quotesBefore % 2 === 1) continue;
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (!isValidScriptDate(cal, y, m, d)) continue;
    tokens.push({ start: match.index, end: match.index + match[0].length, y, m, d });
  }
  return tokens;
}

/** The in-game display form after every date token in the visible range. */
export function calendarHints(cal: CalendarSetting, document: TextDocument, range: Range): InlayHint[] {
  if (!isScriptLanguage(document.languageId)) return [];
  const hints: InlayHint[] = [];
  const lastLine = Math.min(range.end.line, document.lineCount - 1);
  for (let lineNo = range.start.line; lineNo <= lastLine; lineNo++) {
    for (const token of dateTokensOnLine(cal, getLineText(document, lineNo))) {
      const display = displayDate(cal, token.y, token.m, token.d);
      if (!display) continue;
      hints.push({
        position: { line: lineNo, character: token.end },
        label: display,
        paddingLeft: true,
      });
    }
  }
  return hints;
}

/** Hover on a date token: the display form plus the calendar rule in force. */
export function provideDateHover(
  cal: CalendarSetting | undefined,
  document: TextDocument,
  position: Position
): Hover | null {
  if (!cal || !isScriptLanguage(document.languageId)) return null;
  const lineText = getLineText(document, position.line);
  const token = dateTokensOnLine(cal, lineText).find(
    (t) => position.character >= t.start && position.character <= t.end
  );
  if (!token) return null;
  const display = displayDate(cal, token.y, token.m, token.d);
  if (!display) return null;
  const script = `${token.y}.${token.m}.${token.d}`;
  const eras = cal.before ? `${cal.before} / ${cal.after}` : cal.after;
  const value =
    `\`${script}\` → **${display}**\n\n` +
    `*px.calendar: epoch ${cal.epoch} (${eras}), ${monthsOf(cal).length} months*`;
  return {
    contents: { kind: MarkupKind.Markdown, value },
    range: {
      start: { line: position.line, character: token.start },
      end: { line: position.line, character: token.end },
    },
  };
}
