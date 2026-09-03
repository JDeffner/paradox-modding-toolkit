/**
 * The files behind the game's own Coat of Arms designer, parsed.
 *
 * Everything the designer offers is script the game ships, and every list in
 * it is ordered by the file rather than alphabetically (both catalog files say
 * so in their own header comment), so these readers keep file order:
 *
 * - `gfx/coat_of_arms/patterns/50_coa_designer_patterns.txt` and
 *   `gfx/coat_of_arms/colored_emblems/50_coa_designer_emblems.txt`:
 *   `file.dds = { colors = N visible = no category = animals }`. `colors` is
 *   how many color buttons the entry shows, `visible = no` keeps an entry out
 *   of the grid while still declaring its color count, `category` groups the
 *   emblem grid (emblems only).
 * - `gfx/coat_of_arms/color_palettes/50_coa_designer_palettes.txt`:
 *   `coa_designer_background_colors = { red = {} ... }`, names into
 *   `common/named_colors`.
 * - `gfx/coat_of_arms/emblem_layouts/50_coa_designer_emblem_layouts.txt`:
 *   whole coats of arms written against the `@pattern`, `@color_1..3`,
 *   `@texture_1..2` placeholders defined at the top of that file. They are
 *   read UNRESOLVED (parseCoaFile leaves a non-numeric `@name` as it stands),
 *   which is exactly what a layout is: a shape with holes for the design's own
 *   pattern, colors and emblems.
 * - `common/coat_of_arms/coat_of_arms/99_coa_designer_templates.txt`: the
 *   `template = { }` block holding `coa_designer_blank_default`, whose colors
 *   are `list "normal_colors"` references into
 *   `common/coat_of_arms/template_lists/color_lists.txt`.
 *
 * Measured against the vanilla files (game version 1.19.0.6): 42 pattern rows
 * of which 38 are visible, 1578 emblem rows of which 1576 are visible across 13
 * categories, 13 palette colors, 35 layouts and 1 template.
 *
 * Host and test side only (it parses script), like coaParse.ts.
 */
import { parseScript } from "../parser/parser";
import type { BlockNode } from "../parser/cst";
import { parseFlag } from "./coaParse";
import type { CoaFlag, DesignerEntry } from "./coa";

export type { DesignerEntry };

/** Every `@name = value` at the top of a designer file, as raw text. */
export function parseAtDefaults(text: string): Record<string, string> {
  const { root } = parseScript(text);
  const out: Record<string, string> = {};
  for (const s of root.statements) {
    if (s.kind !== "assignment" || !s.value || s.value.kind !== "scalar") continue;
    if (s.key.text.startsWith("@")) out[s.key.text] = s.value.text;
  }
  return out;
}

/**
 * A designer catalog file (patterns or emblems). `maxColors` fills in the
 * count for a row that names none, which the files' own header calls "assume
 * maximum number of colors".
 */
export function parseDesignerCatalog(text: string, maxColors: number): DesignerEntry[] {
  const { root } = parseScript(text);
  const out: DesignerEntry[] = [];
  for (const s of root.statements) {
    if (s.kind !== "assignment" || s.value?.kind !== "block") continue;
    const entry: DesignerEntry = { file: s.key.text, colors: maxColors, visible: true, category: "" };
    for (const a of s.value.statements) {
      if (a.kind !== "assignment" || a.value?.kind !== "scalar") continue;
      if (a.key.text === "colors") {
        const n = Number(a.value.text);
        if (Number.isFinite(n)) entry.colors = n;
      } else if (a.key.text === "visible") entry.visible = a.value.text !== "no";
      else if (a.key.text === "category") entry.category = a.value.text;
    }
    out.push(entry);
  }
  return out;
}

/** The palette's color names, in list order: `coa_designer_background_colors = { red = {} … }`. */
export function parseDesignerPalette(text: string): string[] {
  const { root } = parseScript(text);
  for (const s of root.statements) {
    if (s.kind !== "assignment" || s.key.text !== "coa_designer_background_colors") continue;
    if (s.value?.kind !== "block") continue;
    return s.value.statements
      .filter((c) => c.kind === "assignment")
      .map((c) => (c as { key: { text: string } }).key.text);
  }
  return [];
}

/**
 * The first color of each `color_lists` entry: what a template's
 * `list "normal_colors"` resolves to here. The game rolls a weight
 * (`30 = "red"`) against the character; a designer that has no character picks
 * the list's first entry, which is also the heaviest one in every vanilla list.
 */
export function parseColorLists(text: string): Record<string, string> {
  const { root } = parseScript(text);
  const out: Record<string, string> = {};
  for (const s of root.statements) {
    if (s.kind !== "assignment" || s.key.text !== "color_lists" || s.value?.kind !== "block") continue;
    for (const list of s.value.statements) {
      if (list.kind !== "assignment" || list.value?.kind !== "block") continue;
      for (const row of list.value.statements) {
        if (row.kind !== "assignment" || row.value?.kind !== "scalar") continue;
        if (!/^\d+$/.test(row.key.text)) continue;
        out[list.key.text] = row.value.text;
        break;
      }
    }
  }
  return out;
}

/**
 * The designer templates of a `template = { }` file. `list "x"` colors are
 * replaced by `colorLists[x]` before parsing, so the caller gets a plain flag.
 */
export function parseDesignerTemplates(text: string, colorLists: Record<string, string>): CoaFlag[] {
  const resolved = text.replace(/\blist\s+"([^"]+)"/g, (whole, name: string) =>
    colorLists[name] !== undefined ? `"${colorLists[name]}"` : whole
  );
  const { root } = parseScript(resolved);
  const out: CoaFlag[] = [];
  for (const s of root.statements) {
    if (s.kind !== "assignment" || s.key.text !== "template" || s.value?.kind !== "block") continue;
    for (const t of s.value.statements) {
      if (t.kind !== "assignment" || t.value?.kind !== "block") continue;
      out.push(parseFlag(t.key.text, t.value as BlockNode));
    }
  }
  return out;
}
