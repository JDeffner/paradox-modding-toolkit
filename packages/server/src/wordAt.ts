/**
 * Word extraction matching the language-configuration wordPattern
 * (`[A-Za-z0-9_][A-Za-z0-9_.\-]*`), so server-side lookups see the same words
 * the editor selects. No `vscode` imports.
 */

const WORD = /[A-Za-z0-9_][A-Za-z0-9_.-]*/g;

export interface WordRange {
  word: string;
  /** Character offsets on the line. */
  start: number;
  end: number;
}

/** The word at `character` on `lineText`, VS Code-style (position may touch either edge). */
export function wordRangeAt(lineText: string, character: number): WordRange | null {
  WORD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD.exec(lineText)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (character >= start && character <= end) return { word: m[0], start, end };
    if (start > character) break;
  }
  return null;
}

/** Prefixes that make the following word a saved-scope / variable reference. */
const SCOPE_PREFIXES = ["scope", "var", "local_var", "global_var"];

/**
 * If the word at `range` is immediately preceded by a `scope:` / `var:` (etc.)
 * prefix on the line, return that prefix; otherwise null. The wordPattern splits
 * at `:`, so hover would otherwise look up the bare name and lose the prefix
 * (update plan v1.1 §B3 hover work).
 */
export function scopePrefixBefore(lineText: string, range: WordRange): string | null {
  if (range.start === 0 || lineText[range.start - 1] !== ":") return null;
  const before = lineText.slice(0, range.start - 1);
  for (const p of SCOPE_PREFIXES) {
    if (before.endsWith(p)) {
      // Make sure the prefix is a whole token (not the tail of a longer word).
      const at = before.length - p.length;
      if (at === 0 || !/[A-Za-z0-9_.-]/.test(before[at - 1])) return p;
    }
  }
  return null;
}
