/**
 * The source block of an indexed definition, for the hover.
 *
 * Asked for by a user: "I would love if it showed what the scripted trigger is
 * on hover." The index stores a definition's `file` and `line` but not its
 * body, so the hover reads it back on demand.
 *
 * Two things keep this off the hot path:
 *
 *  - **Scan, do not parse.** A full `parseScript` is O(file); brace-counting
 *    from the definition's own line is O(block). Vanilla `common/` files run to
 *    thousands of lines and a hover must not pay for all of them.
 *  - **Cache by path and mtime.** A hover repeats on every mouse move inside
 *    the same word, so the same block is asked for many times in a row. The
 *    cache is small and bounded; the mtime key means an edited file re-reads
 *    itself with no explicit invalidation.
 *
 * Measured against vanilla `common/scripted_triggers` (3,152 definitions):
 * median body 10 lines, p90 32, longest 232. Only 11% are 3 lines or shorter,
 * which is why the caller caps the inline part and discloses the rest rather
 * than truncating.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import * as fs from "fs";

/**
 * Bounded cache; hovers repeat on the same file far more often than they move.
 *
 * The cache holds the file already SPLIT INTO LINES, and memoizes each block it
 * has extracted. Caching the raw text instead measured 66 µs per warm hover,
 * because every call re-split a multi-thousand-line vanilla file and re-ran the
 * brace scan. Both are now paid once per file per mtime.
 */
const CACHE_MAX = 32;
interface Entry {
  mtimeMs: number;
  lines: string[];
  /** Extracted blocks by start line, so a repeated hover costs a Map lookup. */
  blocks: Map<number, string | null>;
}
const cache = new Map<string, Entry>();

function entryFor(file: string): Entry | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  const entry: Entry = { mtimeMs: stat.mtimeMs, lines: text.split(/\r?\n/), blocks: new Map() };
  cache.set(file, entry);
  return entry;
}

/** Drop `#` comments and quoted strings so their braces do not count. */
function significant(line: string): string {
  return line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/#.*$/, "");
}

/**
 * The full `name = { … }` block that starts at `line`, as source text.
 *
 * Returns null when the file cannot be read, the line does not open a block, or
 * the block never closes (a malformed file must not make the hover hang or
 * return the rest of the document). Assignments with no block, like
 * `my_value = 5`, return the single line.
 */
export function definitionBody(file: string, line: number, maxLines = 400): string | null {
  const entry = entryFor(file);
  if (entry === null) return null;
  const memo = entry.blocks.get(line);
  if (memo !== undefined) return memo;
  const body = extract(entry.lines, line, maxLines);
  entry.blocks.set(line, body);
  return body;
}

function extract(lines: string[], line: number, maxLines: number): string | null {
  if (line < 0 || line >= lines.length) return null;

  const first = significant(lines[line]);
  if (!first.includes("{")) {
    const trimmed = lines[line].trim();
    return trimmed === "" ? null : trimmed;
  }

  let depth = 0;
  const out: string[] = [];
  for (let i = line; i < lines.length && out.length < maxLines; i++) {
    out.push(lines[i]);
    for (const ch of significant(lines[i])) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth <= 0 && i > line) break;
    // A block that opens and closes on its own first line.
    if (depth === 0 && i === line) break;
  }
  if (depth > 0 && out.length < maxLines) return null; // never closed
  return out.join("\n").replace(/\s+$/, "");
}

/** Test seam: drop the cache so a test can rewrite a file and re-read it. */
export function clearDefinitionBodyCache(): void {
  cache.clear();
}
