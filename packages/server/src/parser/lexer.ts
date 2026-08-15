// Hand-written, allocation-light, error-tolerant lexer for Paradox script.
//
// Single pass over the source; no per-character regex. Offsets are UTF-16
// code-unit offsets into the source string.

export type TokenKind =
  | "lbrace" // {
  | "rbrace" // }
  | "op" // = ?= == != < <= > >=
  | "string" // quoted "..." (text WITHOUT quotes stored separately via range)
  | "comment" // # to end of line (text includes leading #)
  | "word" // scalar run
  | "eof";

export interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  // For "op": the operator text ("=", "?=", ...).
  // For "word"/"string"/"comment": not populated (slice the source instead),
  // but we DO record `unterminated` on unterminated strings.
  value?: string;
  // Only meaningful for "string" tokens: true if the closing quote was missing
  // and the token was terminated at end-of-line / EOF.
  unterminated?: boolean;
}

/**
 * How many newlines one quoted string may cross while a `[` inside it is still
 * open. The longest multi-line data function measured across the shipped gui
 * trees is four lines; this is the backstop that keeps a genuinely broken `"[`
 * from turning the remainder of a file into one token.
 */
const MAX_STRING_SPAN = 32;

// Character classification helpers ----------------------------------------

function isWhitespace(c: number): boolean {
  // space, tab, newline, carriage return, form feed, vertical tab, and the BOM.
  // Callers strip a leading BOM where they can, but not every one does, and a
  // BOM glued to the first top-level key would swallow that whole block.
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11 || c === 0xfeff;
}

// Characters that terminate a bare word.
function isWordTerminator(c: number): boolean {
  return (
    isWhitespace(c) ||
    c === 123 /* { */ ||
    c === 125 /* } */ ||
    c === 35 /* # */ ||
    c === 34 /* " */ ||
    c === 61 /* = */ ||
    c === 60 /* < */ ||
    c === 62 /* > */ ||
    c === 33 /* ! */
    // NOTE: `?` is intentionally NOT a terminator on its own. `?=` is handled
    // specially: a `?` only starts an operator when immediately followed by `=`.
  );
}

/**
 * Lex the entire source into a token array (including a trailing eof token).
 * Never throws. Comments and strings are emitted as tokens; the parser decides
 * what to do with them.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const len = text.length;
  let i = 0;

  while (i < len) {
    const c = text.charCodeAt(i);

    // Whitespace (newlines are plain whitespace).
    if (isWhitespace(c)) {
      i++;
      continue;
    }

    // Comment: # to end of line.
    if (c === 35 /* # */) {
      const start = i;
      i++;
      while (i < len) {
        const cc = text.charCodeAt(i);
        if (cc === 10 || cc === 13) break;
        i++;
      }
      tokens.push({ kind: "comment", start, end: i });
      continue;
    }

    // Braces.
    if (c === 123 /* { */) {
      tokens.push({ kind: "lbrace", start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === 125 /* } */) {
      tokens.push({ kind: "rbrace", start: i, end: i + 1 });
      i++;
      continue;
    }

    // Quoted string.
    if (c === 34 /* " */) {
      const start = i;
      i++;
      let unterminated = false;
      // A `[ … ]` data-function expression may be written across several lines
      //, `visible = "[And(\n\tA,\n\tB\n)]"`, and the games accept it: one
      // shipped gui tree writes it, and the largest community framework on it
      // does so in 23 of its 52 .gui files. A newline therefore continues the
      // string ONLY while a `[` is still open: an ordinary unterminated string
      // recovers at end of line exactly as before, and a stray `"[` gives up
      // after MAX_STRING_SPAN lines instead of swallowing the rest of the file.
      let brackets = 0;
      let spanned = 0;
      while (true) {
        if (i >= len) {
          unterminated = true;
          break;
        }
        const cc = text.charCodeAt(i);
        if (cc === 92 /* backslash */) {
          // Escape: skip the next char (handles \" and \\ etc.).
          i += 2;
          continue;
        }
        if (cc === 34 /* " */) {
          i++; // consume closing quote
          break;
        }
        if (cc === 10 || cc === 13) {
          if (brackets === 0 || spanned >= MAX_STRING_SPAN) {
            // Unterminated: recover at end of line.
            unterminated = true;
            break;
          }
          if (cc === 10) spanned++;
          i++;
          continue;
        }
        if (cc === 91 /* [ */) brackets++;
        else if (cc === 93 /* ] */ && brackets > 0) brackets--;
        i++;
      }
      const tok: Token = { kind: "string", start, end: i };
      if (unterminated) tok.unterminated = true;
      tokens.push(tok);
      continue;
    }

    // Operators.
    if (c === 61 /* = */) {
      if (i + 1 < len && text.charCodeAt(i + 1) === 61 /* = */) {
        tokens.push({ kind: "op", start: i, end: i + 2, value: "==" });
        i += 2;
      } else {
        tokens.push({ kind: "op", start: i, end: i + 1, value: "=" });
        i += 1;
      }
      continue;
    }
    if (c === 33 /* ! */) {
      if (i + 1 < len && text.charCodeAt(i + 1) === 61 /* = */) {
        tokens.push({ kind: "op", start: i, end: i + 2, value: "!=" });
        i += 2;
        continue;
      }
      // Lone `!`, treat as a one-char word (rare; be tolerant).
      tokens.push({ kind: "word", start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (c === 60 /* < */) {
      if (i + 1 < len && text.charCodeAt(i + 1) === 61 /* = */) {
        tokens.push({ kind: "op", start: i, end: i + 2, value: "<=" });
        i += 2;
      } else {
        tokens.push({ kind: "op", start: i, end: i + 1, value: "<" });
        i += 1;
      }
      continue;
    }
    if (c === 62 /* > */) {
      if (i + 1 < len && text.charCodeAt(i + 1) === 61 /* = */) {
        tokens.push({ kind: "op", start: i, end: i + 2, value: ">=" });
        i += 2;
      } else {
        tokens.push({ kind: "op", start: i, end: i + 1, value: ">" });
        i += 1;
      }
      continue;
    }
    if (c === 63 /* ? */) {
      if (i + 1 < len && text.charCodeAt(i + 1) === 61 /* = */) {
        tokens.push({ kind: "op", start: i, end: i + 2, value: "?=" });
        i += 2;
        continue;
      }
      // Lone `?` not followed by `=`, fall through and treat as a word char.
      // (Do not `continue`; let the word scanner below pick it up.)
    }

    // Word (scalar). Includes inline-math `@[ ... ]` which may contain spaces.
    {
      const start = i;
      while (i < len) {
        const cc = text.charCodeAt(i);
        // Inline math bracket: `@[` ... `]` is ONE token, spaces allowed inside.
        if (cc === 64 /* @ */ && i + 1 < len && text.charCodeAt(i + 1) === 91 /* [ */) {
          i += 2;
          while (i < len && text.charCodeAt(i) !== 93 /* ] */) {
            // stop runaway at newline to stay tolerant
            const inner = text.charCodeAt(i);
            if (inner === 10 || inner === 13) break;
            i++;
          }
          if (i < len && text.charCodeAt(i) === 93) i++; // consume `]`
          continue;
        }
        // A lone `?` (not `?=`) is part of the word.
        if (cc === 63 /* ? */) {
          if (i + 1 < len && text.charCodeAt(i + 1) === 61 /* = */) break;
          i++;
          continue;
        }
        if (isWordTerminator(cc)) break;
        i++;
      }
      if (i === start) {
        // Defensive: unknown char we didn't advance past, consume one char as a
        // word so we never loop forever on pathological input.
        i++;
      }
      tokens.push({ kind: "word", start, end: i });
      continue;
    }
  }

  tokens.push({ kind: "eof", start: len, end: len });
  return tokens;
}
