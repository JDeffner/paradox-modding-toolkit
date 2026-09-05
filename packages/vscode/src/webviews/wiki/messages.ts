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
  /**
   * The game this page belongs to. An article without one shows for every
   * game; two articles for different games may share an id, so a page id
   * resolves to the alternate the selected game has.
   */
  game?: string;
  markdown: string;
  /**
   * Cards drawn after the markdown as one filterable grid (the Credits and
   * Modding Tools pages): the kinds on them become the filter chips.
   */
  cards?: WikiCard[];
  /** Markdown drawn after the cards (a closing note). */
  outro?: string;
}

/** One card of a reference page: a project or a tool, what it does, where it is. */
export interface WikiCard {
  title: string;
  /** Where the title leads. */
  url: string;
  /** What kind of thing it is (a tool category, a credit group): a filter, and the icon's tip. */
  kind: string;
  /** The kind's icon (shared/icons.ts), drawn before the title. */
  icon: IconName;
  /** Dimmer words beside the title: a license, who it is by. */
  meta?: string;
  text: string;
  /** Game ids the card is for; shown only while the switch is on one of them. Absent = every game. */
  games?: string[];
  /** Further links under the text, each named. */
  links?: { label: string; url: string }[];
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
  | {
      type: "content";
      hub: WikiHubEntry[];
      articles: WikiArticle[];
      /** Every supported game, for the sidebar's switch. */
      games: { id: string; name: string }[];
      /** The workspace's game: what the switch starts on. */
      game: string;
      select: string | null;
    }
  | { type: "select"; id: string }
  | { type: "modReport"; markdown: string };

export type AppToHost = { type: "ready" } | { type: "run"; command: string } | { type: "modReport" };
