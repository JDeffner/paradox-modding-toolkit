/**
 * Reading blocks back OUT of a script file, for the two things the Dynasty
 * Tree needs that no index answers: a character's `dna_data` block (CK3 does
 * not index that folder, and must not start to: the files are large and
 * nothing else wants them) and a trait's own statements when its picker row
 * has to show what the trait does.
 *
 * A brace scanner rather than the tolerant parser: the caller wants the block's
 * VERBATIM text (a pasted DNA is copied on again, byte for byte) and the offsets
 * it sits at, and it wants them from files big enough that parsing every one of
 * them on a panel open would be felt. Comments and quoted strings are skipped,
 * which is all the syntax a `key = { … }` scan has to know about.
 *
 * No `vscode` imports: unit-tested in plain Node (test/dynastyScan.test.ts).
 */

/** One top-level `key = { … }`, with the offsets it occupies in the text. */
export interface ScriptBlock {
  key: string;
  /** Offset of the first character of the key. */
  start: number;
  /** Offset just past the closing brace. */
  end: number;
  /** `key = { … }` exactly as the file has it. */
  text: string;
}

/** A key character: what a definition name may be made of. */
const KEY_CHAR = /[A-Za-z0-9_.:@-]/;

/**
 * Every top-level block of a script file, by key. A key written twice keeps
 * the LAST block, which is the one the engine uses (script databases are
 * last-in-wins).
 */
export function scanBlocks(text: string): Map<string, ScriptBlock> {
  const out = new Map<string, ScriptBlock>();
  /** The name last read at depth 0: the block that opens next belongs to it. */
  let pending: { key: string; start: number } | null = null;
  /** The block currently open, once a `{` has claimed a pending name. */
  let open: { key: string; start: number } | null = null;
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "#") {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl + 1;
      continue;
    }
    if (ch === '"') {
      const close = text.indexOf('"', i + 1);
      i = close < 0 ? text.length : close + 1;
      continue;
    }
    if (ch === "{") {
      if (depth === 0 && pending) open = pending;
      pending = null;
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      i++;
      if (depth > 0) depth--;
      if (depth === 0 && open) {
        out.set(open.key, { key: open.key, start: open.start, end: i, text: text.slice(open.start, i) });
        open = null;
      }
      continue;
    }
    if (depth > 0) {
      i++;
      continue;
    }
    if (KEY_CHAR.test(ch)) {
      const start = i;
      while (i < text.length && KEY_CHAR.test(text[i])) i++;
      pending = { key: text.slice(start, i), start };
      continue;
    }
    // Only whitespace and the `=` may stand between a name and its block.
    if (!/\s/.test(ch) && ch !== "=") pending = null;
    i++;
  }
  return out;
}

/**
 * A name nothing already uses: `foo`, else `foo_2`, `foo_3`, … Pasting a DNA
 * must never replace one that is already in the file, because the block it
 * would replace is somebody's portrait.
 */
export function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * What the clipboard holds when a modder copies a portrait: the game's own
 * exports are a whole `<key> = { portrait_info = { … } }` block, an in-file
 * copy is often just the `portrait_info = { … }` half, and a modder who knows
 * the key of a DNA that already exists simply types its name.
 */
export type DnaPaste =
  | { kind: "name"; name: string }
  | { kind: "block"; key: string; body: string }
  | { kind: "portrait"; body: string };

/** A bare DNA name, as `dna = <name>` writes it. */
const DNA_NAME = /^[A-Za-z0-9_.:@-]+$/;

/** What the clipboard's text is, or null when it is neither shape. */
export function parseDnaPaste(clipboard: string): DnaPaste | null {
  const text = clipboard.trim();
  if (text === "") return null;
  if (DNA_NAME.test(text)) return { kind: "name", name: text };

  const blocks = [...scanBlocks(text).values()];
  if (blocks.length === 0) return null;
  const portrait = blocks.find((b) => b.key === "portrait_info");
  if (portrait) return { kind: "portrait", body: portrait.text };
  // A whole definition: the one that carries a portrait, else the first, so a
  // block written in a shape this panel has not seen is still pasted verbatim.
  const block = blocks.find((b) => b.text.includes("portrait_info")) ?? blocks[0];
  return { kind: "block", key: block.key, body: braces(block.text) };
}

/** `key = { … }` reduced to its `{ … }`. */
function braces(block: string): string {
  const at = block.indexOf("{");
  return at < 0 ? block : block.slice(at);
}

/**
 * The script a paste writes, under the key it was given. A whole block keeps
 * its own body verbatim; a bare `portrait_info` is wrapped in one. `enabled =
 * yes` is NOT added: 296 of the 431 vanilla `common/dna_data` blocks write it
 * and 135 do not (measured, CK3 1.19), so it is optional and inventing it
 * would be writing game knowledge nobody asked for.
 */
export function dnaPasteBlock(key: string, paste: DnaPaste): string | null {
  if (paste.kind === "name") return null;
  if (paste.kind === "block") return `${key} = ${paste.body}`;
  const body = paste.body
    .split(/\r?\n/)
    .map((line) => (line.trim() === "" ? line : `\t${line}`))
    .join("\n");
  return `${key} = {\n${body}\n}`;
}
