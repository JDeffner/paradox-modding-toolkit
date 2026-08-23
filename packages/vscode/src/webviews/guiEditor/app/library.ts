/**
 * The element library: what the left panel's tile grid lists, in which section,
 * and in what order. It replaced the palette's flat row list.
 *
 * PURE (no DOM, no host). Nothing here invents an entry: the vocabulary comes
 * from `paradox/guiVocabulary` and the saved components from the host's own
 * store, so this module only groups, filters and orders what it was handed.
 */
import type { GuiPreviewEntry, GuiVocabularyEntry } from "@px-lsp/protocol/protocol";
import type { SavedComponent } from "../messages";

export type LibrarySection = "all" | "local" | "templates" | "widgets" | "saved";

export const LIBRARY_SECTIONS: { id: LibrarySection; label: string; title: string }[] = [
  { id: "all", label: "All", title: "Everything, searched across every section" },
  { id: "local", label: "This file", title: "The types and templates this document declares" },
  { id: "templates", label: "Templates", title: "Templates the store knows; applied with `using`" },
  { id: "widgets", label: "Widgets", title: "The game's own widget types, most used first" },
  { id: "saved", label: "Saved", title: "Your saved components" },
];

/** How many tiles a page of the grid adds at a time. */
export const LIBRARY_PAGE = 60;

/** One tile. A vocabulary entry or a saved component, read the same way. */
export interface LibraryEntry {
  /** Stable across re-renders: `${kind}:${name}`, and what a preview is cached under. */
  key: string;
  name: string;
  kind: "builtin" | "type" | "template" | "saved";
  /** The muted line under the name: kind, base, usage count. */
  source: string;
  /** The vocabulary entry behind a builtin, type or template tile. */
  vocab?: GuiVocabularyEntry;
  /** The stored text behind a saved tile: what its preview lays out and what an insert writes. */
  text?: string;
}

export function libraryEntries(
  vocabulary: readonly GuiVocabularyEntry[],
  components: readonly SavedComponent[]
): Record<Exclude<LibrarySection, "all">, LibraryEntry[]> {
  const local: LibraryEntry[] = [];
  const templates: LibraryEntry[] = [];
  const widgets: LibraryEntry[] = [];
  for (const entry of vocabulary) {
    const tile = fromVocabulary(entry);
    if (entry.local) local.push(tile);
    else if (entry.kind === "template") templates.push(tile);
    else widgets.push(tile);
  }
  // The harvest order is by usage already, but the document's own entries are
  // sorted in front of it by the server; within this section count is the order.
  widgets.sort((a, b) => (b.vocab?.count ?? 0) - (a.vocab?.count ?? 0));
  const saved = components.map((c) => ({
    key: `saved:${c.name}`,
    name: c.name,
    kind: "saved" as const,
    source: `saved · ${c.widgets} widget${c.widgets === 1 ? "" : "s"}`,
    text: c.text,
  }));
  return { local, templates, widgets, saved };
}

function fromVocabulary(entry: GuiVocabularyEntry): LibraryEntry {
  const parts: string[] = [];
  if (entry.kind === "builtin") parts.push("widget");
  else parts.push(entry.local ? `${entry.kind}, this file` : entry.kind);
  if (entry.base) parts.push(entry.base);
  if (entry.count !== undefined) parts.push(`${entry.count} uses`);
  return {
    key: `${entry.kind}:${entry.name}`,
    name: entry.name,
    kind: entry.kind,
    source: parts.join(" · "),
    vocab: entry,
  };
}

/**
 * The tiles a section shows for a query: prefix matches first, then interior
 * ones, each group keeping the section's own order. "All" is every section in
 * the order a designer looks in them.
 */
export function libraryTiles(
  sections: ReturnType<typeof libraryEntries>,
  section: LibrarySection,
  query: string
): LibraryEntry[] {
  const pool =
    section === "all"
      ? [...sections.local, ...sections.templates, ...sections.widgets, ...sections.saved]
      : sections[section];
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return pool;
  const prefix: LibraryEntry[] = [];
  const inside: LibraryEntry[] = [];
  for (const entry of pool) {
    const at = entry.name.toLowerCase().indexOf(needle);
    if (at === 0) prefix.push(entry);
    else if (at > 0) inside.push(entry);
  }
  return [...prefix, ...inside];
}

/** What the server lays out for a tile (`paradox/guiPreview`). */
export function previewEntryFor(entry: LibraryEntry): GuiPreviewEntry {
  return entry.kind === "saved"
    ? { name: entry.name, kind: "raw", fragment: entry.text ?? "" }
    : { name: entry.name, kind: entry.kind };
}

/** The tooltip a tile carries. */
export function libraryTip(entry: LibraryEntry): string {
  const what =
    entry.kind === "template"
      ? "Drag onto a widget or click to apply it with `using`"
      : "Drag onto the canvas or click to insert";
  return `${entry.name}\n${entry.source}\n${what}`;
}

/** Split a request into the batches the wire accepts. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
