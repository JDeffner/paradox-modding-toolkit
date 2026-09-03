/**
 * The wire between the Wiki host (panel.ts) and its app (app/main.ts). The
 * host reads the article files, knows the active game and can build the mod
 * report; the app filters, renders and asks for a command to run. Articles
 * arrive once, in full, so search costs no round trip. The mod report is the
 * one page fetched on demand: it reads the live index, so it is built when
 * the page opens, not when the panel does.
 */
import type { IconName } from "../shared/icons";

/** One article: markdown from a file, never text written here. */
export interface WikiArticle {
  /** Stable id, used by px.imageGuidelines to open straight at an article. */
  id: string;
  title: string;
  section: string;
  /** A short label after the title in the list, when the file states one. */
  badge?: string;
  /** The first sentence of the page, for index tables. */
  summary?: string;
  markdown: string;
}

/**
 * One hub card and table-of-contents row. A `command` entry opens another
 * view; a `page` entry opens a page inside the wiki (an article id, or one
 * of the app's built-in pages: "diagnostics", "mod-report").
 */
export interface WikiHubEntry {
  label: string;
  icon: IconName;
  /** One sentence: the card text, and the row tooltip. */
  tip: string;
  target: { command: string } | { page: string };
}

export type HostToApp =
  | { type: "content"; hub: WikiHubEntry[]; articles: WikiArticle[]; select: string | null }
  | { type: "select"; id: string }
  | { type: "modReport"; markdown: string };

export type AppToHost = { type: "ready" } | { type: "run"; command: string } | { type: "modReport" };
