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

/**
 * What each builtin widget type is FOR, in one sentence a new modder can act
 * on: the same job the game's own GUI-overview window does by showing every
 * element in use. Hand-written prose about the engine's own types (Jomini is
 * shared across the games), never an invented name: a type not in this table
 * simply shows no description.
 */
const WIDGET_DOCS: Record<string, string> = {
  widget:
    "The basic container: a rectangle with a size that holds children. Most windows are built from these.",
  window: "A top-level container the game can open, close and drag. Use it for a whole screen or popup.",
  container: "Groups children without a size of its own: it shrinks to fit whatever is inside.",
  hbox: "Lays its children out in a row, left to right, sized to fit them.",
  vbox: "Lays its children out in a column, top to bottom, sized to fit them.",
  flowcontainer:
    "Lays children one after another (set direction = vertical for a column); simpler than hbox/vbox, no resizing of children.",
  fixedgridbox:
    "A grid with fixed cell sizes: give it addcolumn/addrow sizes and it places children cell by cell.",
  dynamicgridbox:
    "A grid fed by a datamodel: one child template, repeated for every entry the game supplies.",
  overlappingitembox: "Overlaps its datamodel items when space runs out (rows of trait icons, army stacks).",
  scrollarea:
    "A viewport with scrollbars: put one child inside that is larger than the area, and it scrolls.",
  scrollbox:
    "A scrollarea with the game's standard scrollbars already wired in. Prefer it over a bare scrollarea.",
  textbox: "Shows text: set text = to a loc key or a [datafunction]. Use autoresize or give it a size.",
  editbox: "A text field the player can type into; ontextchanged/ontextedited run script on input.",
  button:
    "A clickable area: give it a texture and an onclick. Use button_standard-style templates for the game's look.",
  checkbutton: "A button with an on/off state (checked/unchecked frames); used for toggles and radio rows.",
  icon: "Draws a texture at its size. The plain image element: frames, portraits and symbols are icons.",
  background:
    "A fill drawn behind the widget's own box, usually with `using` on a parent rather than standalone.",
  progressbar: "A bar filled to `value` between min and max; set its texture for the game's bar looks.",
  progresspie: "Like a progressbar, but fills radially as a pie.",
  piechart: "Draws datamodel entries as pie slices; each entry supplies a value and a color.",
  dropdown: "A collapsed list: a button that opens a list of options the player picks from.",
  slider: "Drags a handle along a track to set a value between min and max.",
  scrollbar: "The bar a scrollarea uses; rarely placed by hand outside scrollbar templates.",
  portrait_button: "A button that renders a character portrait; used wherever a character can be clicked.",
  tree: "Renders a node tree from a datamodel with connecting lines (dynasty trees, tech trees).",
  minimap: "The map overview element; it renders the campaign map into its box.",
  tooltipwidget:
    "A widget shown as a tooltip: attach it with tooltipwidget = { ... } on the hovered element.",
  margin_widget: "A widget that carves margins off its parent's box before placing children.",
  overlappingbox: "Overlaps its plain children (not datamodel-fed) when they exceed the available width.",
  text_occluder: "Hides the text under it; a technical helper for redacted or masked text.",
  zoomarea: "A container whose contents the player can zoom and pan, like the lens pages.",
};

/** One-line kind explanations for the non-builtin cards. */
export function libraryDoc(entry: LibraryEntry): string | undefined {
  if (entry.kind === "saved")
    return "A piece you saved from a document: inserting it pastes its stored text verbatim.";
  if (entry.kind === "template") {
    return entry.vocab?.local
      ? "A template this file declares. Click to apply it to the selected widget with `using`."
      : "A template from the store: a bundle of properties applied to a widget with `using`.";
  }
  if (entry.kind === "type") {
    return entry.vocab?.local
      ? `A type this file declares${entry.vocab.base ? `, based on ${entry.vocab.base}` : ""}: insert it to reuse the whole definition.`
      : `A declared type${entry.vocab?.base ? ` based on ${entry.vocab.base}` : ""}.`;
  }
  return WIDGET_DOCS[entry.name.toLowerCase()];
}

/**
 * The showcase group a widgets-section card belongs to, in display order: the
 * grouping the game's GUI-overview window uses, so a designer looks where the
 * element's JOB is rather than scanning an alphabet.
 */
export const WIDGET_GROUPS = [
  "Containers & layout",
  "Text",
  "Buttons & input",
  "Images & bars",
  "Lists & data",
  "Other widgets",
] as const;
export type WidgetGroup = (typeof WIDGET_GROUPS)[number];

const GROUP_OF: Record<string, WidgetGroup> = {
  widget: "Containers & layout",
  window: "Containers & layout",
  container: "Containers & layout",
  hbox: "Containers & layout",
  vbox: "Containers & layout",
  flowcontainer: "Containers & layout",
  margin_widget: "Containers & layout",
  scrollarea: "Containers & layout",
  scrollbox: "Containers & layout",
  zoomarea: "Containers & layout",
  textbox: "Text",
  editbox: "Text",
  text_occluder: "Text",
  button: "Buttons & input",
  checkbutton: "Buttons & input",
  dropdown: "Buttons & input",
  slider: "Buttons & input",
  scrollbar: "Buttons & input",
  portrait_button: "Buttons & input",
  icon: "Images & bars",
  background: "Images & bars",
  progressbar: "Images & bars",
  progresspie: "Images & bars",
  piechart: "Images & bars",
  fixedgridbox: "Lists & data",
  dynamicgridbox: "Lists & data",
  overlappingitembox: "Lists & data",
  overlappingbox: "Lists & data",
  tree: "Lists & data",
  minimap: "Other widgets",
  tooltipwidget: "Other widgets",
};

/** The group a card shows under. Non-builtin kinds have one group per kind. */
export function libraryGroup(entry: LibraryEntry): string {
  if (entry.kind === "saved") return "Saved components";
  if (entry.kind === "template") return entry.vocab?.local ? "This file's templates" : "Templates";
  if (entry.kind === "type") return "Declared types";
  return GROUP_OF[entry.name.toLowerCase()] ?? "Other widgets";
}

/** Split a request into the batches the wire accepts. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
