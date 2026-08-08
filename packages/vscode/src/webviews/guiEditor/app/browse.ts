/**
 * The type and template browser: the same vocabulary the palette offers, read
 * as a catalogue instead of a drag source.
 *
 * PURE (no DOM, no host). It exists next to `palette.ts` rather than inside it
 * because the two want opposite things from the same list. The palette shows
 * what can be DROPPED, so it hides templates (a template is applied with
 * `using = Name`, never declared as a widget). The browser shows what the
 * document can REACH, so templates are the point of it, and the grouping is
 * what makes a 300-entry harvest navigable at all.
 *
 * Nothing here invents an entry: every name comes from `paradox/guiVocabulary`,
 * which is the bundled per-game harvest of the vanilla `gui/` tree plus this
 * document's own declarations.
 */
import type { GuiVocabularyEntry } from "@px-lsp/protocol/protocol";

/** How many entries a group lists before the filter box is the way to the rest. */
export const BROWSER_GROUP_MAX = 40;

export interface BrowserGroup {
  /** Stable id, so a collapsed group stays collapsed across a re-filter. */
  id: "local" | "template" | "builtin";
  title: string;
  entries: GuiVocabularyEntry[];
  /** Matches beyond the ones listed. */
  hidden: number;
}

/**
 * Three groups, in the order a designer looks in them: what this file declares
 * (theirs, and the thing they are most likely after), then the templates the
 * store knows, then the game's own widget types.
 *
 * A local entry appears ONLY in the local group even when it is a template:
 * showing it twice would make the browser look like it had found two things.
 */
export function browserGroups(
  entries: readonly GuiVocabularyEntry[],
  query: string,
  limit = BROWSER_GROUP_MAX
): BrowserGroup[] {
  const needle = query.trim().toLowerCase();
  const matches = (entry: GuiVocabularyEntry): boolean =>
    needle.length === 0 || entry.name.toLowerCase().includes(needle);

  const local: GuiVocabularyEntry[] = [];
  const templates: GuiVocabularyEntry[] = [];
  const builtin: GuiVocabularyEntry[] = [];
  for (const entry of entries) {
    if (!matches(entry)) continue;
    if (entry.local) local.push(entry);
    else if (entry.kind === "template") templates.push(entry);
    else builtin.push(entry);
  }
  return [
    group("local", "Declared in this file", local, limit),
    group("template", "Templates", templates, limit),
    group("builtin", "Widgets the game knows", builtin, limit),
  ].filter((g) => g.entries.length > 0);
}

function group(
  id: BrowserGroup["id"],
  title: string,
  entries: GuiVocabularyEntry[],
  limit: number
): BrowserGroup {
  return { id, title, entries: entries.slice(0, limit), hidden: Math.max(0, entries.length - limit) };
}

/**
 * What the vocabulary actually knows about one entry, as sentences. Deliberately
 * short: this is the whole of what was harvested, and a panel that padded it out
 * would imply the harvest carries documentation it does not.
 */
export function vocabularyDetail(entry: GuiVocabularyEntry): string[] {
  const lines: string[] = [];
  switch (entry.kind) {
    case "template":
      lines.push(
        entry.local
          ? "A template declared in this file. Apply it to a widget with `using`; it is not a widget of its own."
          : "A template from the template store. Apply it to a widget with `using`; it is not a widget of its own."
      );
      break;
    case "type":
      lines.push(
        `A type${entry.local ? " declared in this file" : ""}${entry.base ? `, deriving from ${entry.base}` : ""}. Inserting it writes an instance.`
      );
      break;
    case "builtin":
      lines.push("A widget the game itself knows, harvested from the vanilla gui tree.");
      break;
  }
  if (entry.count !== undefined) {
    lines.push(`The game's own gui files write it ${entry.count} time${entry.count === 1 ? "" : "s"}.`);
  }
  if (entry.container) {
    lines.push("The vanilla tree writes widgets inside it, so it can hold children.");
  }
  return lines;
}

/** The value a `using` write takes: a bare name, the way the vanilla tree writes it. */
export function usingValue(name: string): string {
  return name;
}
