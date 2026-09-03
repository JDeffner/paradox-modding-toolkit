/**
 * Reading and writing one `culture = { ... }` block, as text.
 *
 * A creator that re-serialized the whole definition would reformat a file the
 * modder did not ask it to touch, so this keeps every statement it did not
 * change VERBATIM: a loaded block is split into chunks (a statement, a comment,
 * a blank line), the form binds to the chunks whose key it models, and a save
 * rewrites only the chunks whose value actually changed. Statements the form
 * has no widget for stay exactly where and how they were (AD-5: annotate,
 * never hide).
 *
 * The value shapes are the vanilla file's, not a style choice:
 * game/common/culture/cultures/00_arabic.txt writes `coa_gfx = {
 * arabic_group_coa_gfx }` on one line, `traditions = { … }` one entry per line,
 * `ethnicities = { 100 = arab }` as weighted rows, `color = { 0.3 0.95 0.3 }`
 * as three 0..1 components (levantine) or a named color (`color = bedouin`,
 * defined in common/named_colors/culture_colors.txt), and
 * `house_coa_mask_offset = { 0.0 -0.03 }` as two numbers.
 *
 * Self-contained on purpose: this is browser code, so it carries its own
 * scanner rather than pulling the server's parser (and its Node decoder) into
 * the webview bundle.
 */

/** One piece of a block body: a statement the form may bind to, or raw text. */
export interface BlockChunk {
  /** The source, verbatim, without its trailing newline. */
  text: string;
  /** The statement's key, for the FIRST chunk of each key; absent otherwise. */
  key?: string;
  /** The statement's value, raw script text (`{ a b }`, `ethos_stoic`). */
  value?: string;
}

export interface ParsedBlock {
  name: string;
  chunks: BlockChunk[];
  /** First value per key, the one a form field binds to. */
  values: Map<string, string>;
}

/** The indentation one level inside a top-level block: script is tab-indented. */
const TAB = "\t";

/** Braces of a line, ignoring a trailing comment and quoted text. */
function braceDelta(line: string): number {
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (c === "#") break;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
  }
  return depth;
}

/**
 * Split `name = { ... }` into its name and the chunks of its body. Returns null
 * when the text is not one block, which is what a caller starting from nothing
 * gets.
 */
export function readBlock(source: string): ParsedBlock | null {
  const open = source.indexOf("{");
  const close = source.lastIndexOf("}");
  if (open < 0 || close < open) return null;
  const head = source.slice(0, open);
  const name = head.split("=")[0].trim();
  if (name === "") return null;

  const body = source.slice(open + 1, close);
  const lines = body.split("\n");
  // A body starts right after `{` and ends right before `}`, so the first and
  // last lines are the remains of those two lines: drop them when blank.
  if (lines.length > 0 && lines[0].trim() === "") lines.shift();
  if (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

  const chunks: BlockChunk[] = [];
  const values = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      chunks.push({ text: line });
      continue;
    }
    const start = i;
    let depth = braceDelta(line);
    while (depth > 0 && i + 1 < lines.length) {
      i++;
      depth += braceDelta(lines[i]);
    }
    const text = lines.slice(start, i + 1).join("\n");
    const eq = text.indexOf("=");
    if (eq < 0) {
      chunks.push({ text });
      continue;
    }
    const key = text.slice(0, eq).trim();
    const value = text.slice(eq + 1).trim();
    const first = !values.has(key);
    if (first) values.set(key, value);
    // Only the first statement of a key is bound: a culture may write
    // `name_list` twice (_cultures.info: "You can have multiple of these
    // entries"), and the ones the form does not hold stay verbatim.
    chunks.push(first ? { text, key, value } : { text });
  }
  return { name, chunks, values };
}

/**
 * The block text to write.
 *
 * `values` is what the form says now, `loaded` what it said when the block was
 * read (both raw script text, null = the key is not written). A chunk whose key
 * is missing from `values`, or whose value did not change, is copied verbatim;
 * the rest is rewritten, and keys the block does not have yet are appended in
 * `order` (the harvest's own key order, which is vanilla usage order).
 */
export function buildBlock(
  name: string,
  chunks: readonly BlockChunk[],
  values: ReadonlyMap<string, string | null>,
  loaded: ReadonlyMap<string, string | null>,
  order: readonly string[]
): string {
  const written = new Set<string>();
  const lines: string[] = [];
  for (const chunk of chunks) {
    if (chunk.key === undefined || !values.has(chunk.key)) {
      lines.push(chunk.text);
      continue;
    }
    written.add(chunk.key);
    const value = values.get(chunk.key) ?? null;
    if (value === null) continue; // the modder cleared the field: drop the statement
    if (value === (loaded.get(chunk.key) ?? null)) lines.push(chunk.text);
    else lines.push(`${TAB}${chunk.key} = ${value}`);
  }
  for (const key of order) {
    if (written.has(key)) continue;
    const value = values.get(key);
    if (value === undefined || value === null) continue;
    lines.push(`${TAB}${key} = ${value}`);
  }
  return `${name} = {\n${lines.map((l) => `${l}\n`).join("")}}`;
}

/** The keys whose value changed, as `paradox/definitionEdit` setProperties wants them. */
export function changedProperties(
  values: ReadonlyMap<string, string | null>,
  loaded: ReadonlyMap<string, string | null>
): { key: string; value: string | null }[] {
  const out: { key: string; value: string | null }[] = [];
  for (const [key, value] of values) {
    if (value !== (loaded.get(key) ?? null)) out.push({ key, value });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Values: raw script text <-> what a field holds
// ---------------------------------------------------------------------------

/** The bare words of `{ a b }`, or the single word of `a`. */
export function tokensOf(raw: string | undefined): string[] {
  if (!raw) return [];
  const inner = raw.startsWith("{") ? raw.slice(1, raw.lastIndexOf("}")) : raw;
  return inner
    .split("#")[0]
    .split(/\s+/)
    .filter((t) => t !== "");
}

/** One `weight = name` row per entry of `{ 100 = arab }`. */
export function weightRowsOf(raw: string | undefined): { weight: number; value: string }[] {
  if (!raw) return [];
  const rows: { weight: number; value: string }[] = [];
  for (const m of raw.matchAll(/(-?[\d.]+)\s*=\s*([A-Za-z_][\w]*)/g)) {
    rows.push({ weight: Number(m[1]), value: m[2] });
  }
  return rows;
}

/** The numbers of `{ 0.0 -0.03 }`. */
export function numbersOf(raw: string | undefined): number[] {
  return tokensOf(raw)
    .map((t) => Number(t))
    .filter((n) => Number.isFinite(n));
}

/** `{ a b }` on one line, the way vanilla writes the gfx sets and `parents`. */
export function inlineList(values: readonly string[]): string | null {
  return values.length === 0 ? null : `{ ${values.join(" ")} }`;
}

/** One entry per line, the way vanilla writes `traditions`. */
export function multiList(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  return `{\n${values.map((v) => `${TAB}${TAB}${v}\n`).join("")}${TAB}}`;
}

/** `{\n\t\t100 = arab\n\t}`, the way vanilla writes `ethnicities`. */
export function weightList(rows: readonly { weight: number; value: string }[]): string | null {
  const real = rows.filter((r) => r.value.trim() !== "");
  if (real.length === 0) return null;
  return `{\n${real.map((r) => `${TAB}${TAB}${r.weight} = ${r.value.trim()}\n`).join("")}${TAB}}`;
}

/** `{ 0.0 -0.03 }`: the mask offset and scale pairs. */
export function numberList(values: readonly (number | null)[]): string | null {
  if (values.some((v) => v === null)) return null;
  return `{ ${values.join(" ")} }`;
}

/**
 * `{ 0.3 0.95 0.3 }`: the three components vanilla writes for an unnamed
 * culture color (00_arabic.txt, levantine). The picker works in bytes, the file
 * in 0..1, and three decimals is the precision vanilla itself uses.
 */
export function rgbList(rgb: readonly [number, number, number]): string {
  return `{ ${rgb.map((c) => Number((c / 255).toFixed(3))).join(" ")} }`;
}

/** The bytes of `{ 0.3 0.95 0.3 }`, or null when the value is not three numbers. */
export function rgbOf(raw: string | undefined): [number, number, number] | null {
  const nums = numbersOf(raw);
  if (!raw?.startsWith("{") || nums.length !== 3) return null;
  // A component above 1 is already a byte: vanilla writes both
  // (`baranis = { 161 67 0 }` in common/named_colors/culture_colors.txt).
  const scale = nums.some((n) => n > 1) ? 1 : 255;
  return nums.map((n) => Math.round(n * scale)) as unknown as [number, number, number];
}

/** A loc key pattern (`$_prefix`) with the definition name filled in. */
export function locKeyFor(pattern: string, name: string): string {
  return pattern.replace("$", name);
}
