// Parser for Paradox's localization "YAML" dialect (it is NOT real YAML).
//
// Shape:
//   l_english:
//    key:0 "value with $variables$, [GetPlayer.GetName], #bold#!, £gold£"
//    other_key: "no version number"   # trailing comment
//
// Never throws. Offsets are UTF-16 code-unit offsets into the ORIGINAL text
// (including the BOM, if present) so ranges map back onto the source buffer.

import { Range } from "./cst.js";

export interface LocEntry {
  key: string;
  keyRange: Range;
  version: number | null;
  value: string; // text INSIDE the quotes (escapes NOT unescaped)
  valueRange: Range; // covers the text inside the quotes
  line: number; // 0-based
}

export type LocErrorCode =
  "no-header" | "bad-entry" | "tab-indent" | "unterminated-value" | "content-before-header";

export interface LocError {
  code: LocErrorCode;
  message: string;
  range: Range;
}

export interface LocParseResult {
  language: string | null; // "english" from `l_english:`; null if none found
  headerRange: Range | null;
  entries: LocEntry[];
  errors: LocError[];
  hadBom: boolean; // text started with the UTF-8 BOM char U+FEFF
}

// A header line: optional leading whitespace, `l_<name>:`, then only trailing
// whitespace / comment.
const HEADER_RE = /^[ \t]*l_([A-Za-z_]+):[ \t]*(#.*)?$/;

// Key characters: letters, digits, `_ . - '`.
function isKeyChar(c: string): boolean {
  return (
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    (c >= "0" && c <= "9") ||
    c === "_" ||
    c === "." ||
    c === "-" ||
    c === "'"
  );
}

export function parseLoc(text: string): LocParseResult {
  const hadBom = text.length > 0 && text.charCodeAt(0) === 0xfeff;
  // Work on the raw text but skip the BOM offset when scanning line content.
  // Offsets we emit are relative to the ORIGINAL text.
  const entries: LocEntry[] = [];
  const errors: LocError[] = [];
  let language: string | null = null;
  let headerRange: Range | null = null;

  const len = text.length;
  let lineStart = 0;
  let lineNo = 0;
  let headerFound = false;

  while (lineStart <= len) {
    // Find end of this line (exclusive of the newline).
    let lineEnd = lineStart;
    while (lineEnd < len) {
      const cc = text.charCodeAt(lineEnd);
      if (cc === 10 || cc === 13) break;
      lineEnd++;
    }

    // Compute where the next line starts (handle \r\n).
    let nextStart = lineEnd;
    if (nextStart < len) {
      if (text.charCodeAt(nextStart) === 13 && nextStart + 1 < len && text.charCodeAt(nextStart + 1) === 10) {
        nextStart += 2;
      } else {
        nextStart += 1;
      }
    } else {
      nextStart = len + 1; // ensure the loop terminates after the last line
    }

    // Slice the line; strip a leading BOM on the very first line.
    let sliceStart = lineStart;
    if (lineNo === 0 && hadBom && text.charCodeAt(sliceStart) === 0xfeff) {
      sliceStart += 1;
    }
    const rawLine = text.slice(sliceStart, lineEnd);

    processLine(rawLine, sliceStart);

    lineStart = nextStart;
    lineNo++;
    if (lineStart > len) break;
  }

  if (!headerFound) {
    errors.push({
      code: "no-header",
      message: "No localization header line (e.g. `l_english:`) found.",
      range: { start: hadBom ? 1 : 0, end: hadBom ? 1 : 0 },
    });
  }

  return { language, headerRange, entries, errors, hadBom };

  // ---- inner helpers (closures over the accumulators) ----

  function processLine(line: string, base: number): void {
    // base = offset in `text` of `line[0]`.
    // Determine indentation and whether tabs were used for it.
    let i = 0;
    let sawTab = false;
    while (i < line.length) {
      const ch = line[i];
      if (ch === " ") {
        i++;
      } else if (ch === "\t") {
        sawTab = true;
        i++;
      } else {
        break;
      }
    }

    const contentStart = i; // index within `line`
    // Blank line?
    if (contentStart >= line.length) return;
    // Comment-only line?
    if (line[contentStart] === "#") return;

    const trimmed = line.slice(contentStart);

    // Header?
    if (!headerFound) {
      const m = HEADER_RE.exec(line);
      if (m) {
        headerFound = true;
        language = m[1];
        // headerRange covers the `l_<name>:` token.
        const idx = line.indexOf("l_");
        const start = base + idx;
        const colon = line.indexOf(":", idx);
        const end = base + (colon >= 0 ? colon + 1 : line.length);
        headerRange = { start, end };
        return;
      }
      // Non-blank, non-comment content before the header.
      errors.push({
        code: "content-before-header",
        message: "Content appears before the localization header (e.g. `l_english:`).",
        range: { start: base + contentStart, end: base + line.length },
      });
      return;
    }

    // A second header-looking line after the first is just ignored as content;
    // but if it matches the header pattern we skip it silently.
    if (HEADER_RE.test(line)) {
      return;
    }

    // Tab indentation is rejected by the game.
    if (sawTab) {
      errors.push({
        code: "tab-indent",
        message: "Tabs are not allowed for indentation in localization files.",
        range: { start: base, end: base + contentStart },
      });
      // Continue trying to parse the entry anyway (best-effort).
    }

    // Parse an entry: key (:version)? "value"
    parseEntry(trimmed, base + contentStart, line, base);
  }

  function parseEntry(entryText: string, entryBase: number, fullLine: string, lineBase: number): void {
    // entryBase = offset in `text` of entryText[0].
    let j = 0;
    // Read key.
    while (j < entryText.length && isKeyChar(entryText[j])) j++;
    if (j === 0) {
      badEntry(fullLine, lineBase);
      return;
    }
    const key = entryText.slice(0, j);
    const keyRange: Range = { start: entryBase, end: entryBase + j };

    // Expect a colon.
    if (j >= entryText.length || entryText[j] !== ":") {
      badEntry(fullLine, lineBase);
      return;
    }
    j++; // consume ':'

    // Optional version number (digits).
    let version: number | null = null;
    const verStart = j;
    while (j < entryText.length && entryText[j] >= "0" && entryText[j] <= "9") {
      j++;
    }
    if (j > verStart) {
      version = Number(entryText.slice(verStart, j));
    }

    // Skip whitespace before the opening quote.
    while (j < entryText.length && (entryText[j] === " " || entryText[j] === "\t")) {
      j++;
    }

    // Expect opening quote.
    if (j >= entryText.length || entryText[j] !== '"') {
      badEntry(fullLine, lineBase);
      return;
    }
    const quoteOpen = j;
    j++; // consume opening quote
    const valueInnerStart = entryBase + j;

    // Scan for closing quote, honoring `\"` escapes.
    let closed = false;
    while (j < entryText.length) {
      const ch = entryText[j];
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === '"') {
        closed = true;
        break;
      }
      j++;
    }

    if (!closed) {
      errors.push({
        code: "unterminated-value",
        message: "Unterminated localization value (missing closing quote).",
        range: {
          start: entryBase + quoteOpen,
          end: lineBase + fullLine.length,
        },
      });
      // Still record the entry with whatever value we captured.
      const valueInnerEnd = entryBase + entryText.length;
      entries.push({
        key,
        keyRange,
        version,
        value: entryText.slice(quoteOpen + 1),
        valueRange: { start: valueInnerStart, end: valueInnerEnd },
        line: lineNo,
      });
      return;
    }

    const valueInnerEnd = entryBase + j;
    const value = entryText.slice(quoteOpen + 1, j);
    // Anything after the closing quote is ignored (trailing comments etc.).

    entries.push({
      key,
      keyRange,
      version,
      value,
      valueRange: { start: valueInnerStart, end: valueInnerEnd },
      line: lineNo,
    });
  }

  function badEntry(fullLine: string, lineBase: number): void {
    errors.push({
      code: "bad-entry",
      message: 'Malformed localization entry; expected `key: "value"`.',
      range: { start: lineBase, end: lineBase + fullLine.length },
    });
  }
}
