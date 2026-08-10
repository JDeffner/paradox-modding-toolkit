/**
 * The palette's list: which of the host's vocabulary entries a panel shows.
 *
 * PURE (no DOM, no host). The entries themselves are never invented here — they
 * come from `paradox/guiVocabulary`, which is the bundled vanilla harvest plus
 * the document's own declarations — so this module only filters and orders what
 * it was handed.
 *
 * The order the host sends is already meaningful (the document's own
 * declarations first, then vanilla usage), so a filter PRESERVES it and only
 * lifts prefix matches over interior ones: typing `vb` should reach `vbox`
 * before `hbox_vbox_sort_ledger`, and typing nothing should show the widgets
 * the game uses most.
 */
import type { GuiVocabularyEntry } from "@px-lsp/protocol/protocol";

/**
 * How many rows a filtered palette shows. A UI budget, like the tree's and the
 * layers panel's: 300 harvested types is more than a list is worth scrolling,
 * and the filter box is the way to the rest.
 */
export const PALETTE_MAX_ROWS = 40;

/**
 * What a drop can WRITE as a declaration. A `template` is not one: it is
 * applied to an existing widget with `using = Name`, and writing it as
 * `Name = { }` would declare a widget type the game does not know. The
 * vocabulary carries templates anyway, because they are the document's reuse
 * surface and stage 2's gallery is about them.
 */
export function isInsertable(entry: GuiVocabularyEntry): boolean {
  return entry.kind !== "template";
}

/**
 * The rows for a query: prefix matches first, then substring matches, each
 * group keeping the host's own order. An empty query is the head of the list.
 */
export function paletteRows(
  entries: readonly GuiVocabularyEntry[],
  query: string,
  limit = PALETTE_MAX_ROWS
): GuiVocabularyEntry[] {
  const usable = entries.filter(isInsertable);
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return usable.slice(0, limit);
  const prefix: GuiVocabularyEntry[] = [];
  const inside: GuiVocabularyEntry[] = [];
  for (const entry of usable) {
    const at = entry.name.toLowerCase().indexOf(needle);
    if (at === 0) prefix.push(entry);
    else if (at > 0) inside.push(entry);
  }
  return [...prefix, ...inside].slice(0, limit);
}

/**
 * The entries a "wrap in a container" menu offers: the types the vanilla tree
 * writes widgets inside, plus this document's own types (an author's own type
 * is theirs to nest, and no harvest can know whether it holds children). Never
 * a hand-written list of container names.
 */
export function containerRows(
  entries: readonly GuiVocabularyEntry[],
  limit = PALETTE_MAX_ROWS
): GuiVocabularyEntry[] {
  return entries.filter((e) => isInsertable(e) && (e.container || e.local)).slice(0, limit);
}

/** The label a row shows: the name, plus what makes it worth telling apart. */
export function paletteLabel(entry: GuiVocabularyEntry): string {
  if (entry.local) return `${entry.name} (this file${entry.base ? `, a ${entry.base}` : ""})`;
  return entry.name;
}
