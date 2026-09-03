/**
 * The value shapes one `culture = { ... }` block writes, and the writer that
 * puts them back.
 *
 * The mechanics - scanning a block, keeping every span the form did not touch,
 * diffing what changed - are `../shared/scriptBlock`. What is here is the part
 * only a culture knows: how vanilla writes each value.
 *
 * Those shapes are the vanilla file's, not a style choice:
 * game/common/culture/cultures/00_arabic.txt writes `coa_gfx = {
 * arabic_group_coa_gfx }` on one line, `traditions = { … }` one entry per line,
 * `ethnicities = { 100 = arab }` as weighted rows, `color = { 0.3 0.95 0.3 }`
 * as three 0..1 components (levantine) or a named color (`color = bedouin`,
 * defined in common/named_colors/culture_colors.txt), and
 * `house_coa_mask_offset = { 0.0 -0.03 }` as two numbers.
 */
import { writeBlock, type BlockWrite, type ParsedBlock } from "../../shared/scriptBlock";

/** The indentation one level inside a top-level block: script is tab-indented. */
const TAB = "\t";

/**
 * The block text to write.
 *
 * `values` is what the form says now, `loaded` what it said when the block was
 * read (both raw script text, null = the key is not written). A statement whose
 * key is missing from `values`, or whose value did not change, is copied out of
 * `source` verbatim; the rest is rewritten, and keys the block does not have
 * yet are appended in `order` (the harvest's own key order, which is vanilla
 * usage order).
 */
export function buildBlock(
  name: string,
  source: ParsedBlock | null,
  values: ReadonlyMap<string, string | null>,
  loaded: ReadonlyMap<string, string | null>,
  order: readonly string[]
): string {
  const rank = (key: string): number => {
    const at = order.indexOf(key);
    return at < 0 ? order.length : at;
  };
  const writes: BlockWrite[] = [...values]
    .map(([key, value]) => ({
      key,
      lines: value === null ? [] : [`${key} = ${value}`],
      changed: value !== (loaded.get(key) ?? null),
    }))
    .sort((a, b) => rank(a.key) - rank(b.key));
  return writeBlock(name, source, writes);
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
