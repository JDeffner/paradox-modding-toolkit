/**
 * PdxDoc doc comments (§E). A contiguous `#` comment block immediately above a
 * definition (no blank line between) documents it. Plain lines are prose;
 * `@tag` lines are structured.
 *
 * Extraction works off the raw file lines above a definition's line — no CST
 * re-parse, encoding-safe (BOM/CRLF handled by the caller splitting on \n and
 * this module trimming \r). Cost is near zero at index time.
 *
 * No `vscode` imports here: unit-tested in plain Node.
 */

/** Recognized structured tags (§E1). Unknown `@tags` render as prose. */
export const KNOWN_DOC_TAGS = new Set(["scope", "param", "saves", "returns", "example", "deprecated"]);

/** One structured tag line: `@scope`, `@param NAME desc`, `@example`, … */
export interface DocTag {
  /** Tag name without the leading `@` (e.g. "param", "scope"). */
  tag: string;
  /** Everything after the tag word (e.g. "DYNASTY_HOUSE the house…"). Empty for bare tags. */
  text: string;
}

export interface DocBlock {
  /** Prose lines joined; capped at PROSE_CAP. Empty string when no prose. */
  doc: string;
  tags: DocTag[];
}

/** Prose is capped so the index stays lean (~338 K defs on AGOT). */
export const PROSE_CAP = 1000;

/**
 * True for a separator line — a comment that is only `#`/punctuation/repeats
 * with no prose (`####`, `#---`, `# ===`, `# ***`). These are section dividers,
 * not documentation, and are skipped (§E2). A line with any letter/digit after
 * the `#` run is real prose, not a separator.
 */
function isSeparator(afterHash: string): boolean {
  const t = afterHash.trim();
  if (t === "") return false; // a blank comment line is a spacer, handled separately
  return !/[A-Za-z0-9]/.test(t);
}

/**
 * Parse a comment block (top-to-bottom, in file order) into prose + tags.
 * Lines must already be stripped of their trailing \r and be `#`-comment lines
 * (leading whitespace allowed). Separator lines are dropped.
 */
export function parseDocBlock(commentLines: string[]): DocBlock | null {
  const proseParts: string[] = [];
  const tags: DocTag[] = [];

  for (const raw of commentLines) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed.startsWith("#")) continue;
    const afterHash = trimmed.replace(/^#+[ \t]?/, "");
    if (isSeparator(trimmed.slice(1))) continue; // slice off first `#` for the check
    if (afterHash.trim() === "") continue; // blank comment line inside the block: skip

    const tagMatch = /^@([A-Za-z_][A-Za-z0-9_]*)\b[ \t]*(.*)$/.exec(afterHash);
    if (tagMatch && KNOWN_DOC_TAGS.has(tagMatch[1].toLowerCase())) {
      tags.push({ tag: tagMatch[1].toLowerCase(), text: tagMatch[2].trim() });
    } else {
      proseParts.push(afterHash.trim());
    }
  }

  if (proseParts.length === 0 && tags.length === 0) return null;

  let doc = proseParts.join(" ");
  if (doc.length > PROSE_CAP) doc = doc.slice(0, PROSE_CAP);
  return { doc, tags };
}

/**
 * Given all file lines (split on `\n`, so entries may retain trailing `\r`) and
 * the 0-based line of a definition, return its attached doc block or null.
 *
 * Walks upward collecting contiguous `#` comment lines. Stops at the first
 * blank/non-comment line — a blank line detaches the block (§E2). Separator
 * lines interrupt attachment too: a divider above the def is not documentation.
 */
export function docForDefinition(lines: string[], defLine: number): DocBlock | null {
  const collected: string[] = [];
  for (let i = defLine - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    const trimmed = line.replace(/\r$/, "").trim();
    if (trimmed === "") break; // blank line detaches
    if (!trimmed.startsWith("#")) break; // code line detaches
    // A pure separator directly adjacent detaches the block (a divider is not doc);
    // but a separator further up simply bounds an already-collected block.
    if (isSeparator(trimmed.slice(1))) {
      if (collected.length === 0) return null;
      break;
    }
    collected.push(line);
  }
  if (collected.length === 0) return null;
  collected.reverse();
  return parseDocBlock(collected);
}
