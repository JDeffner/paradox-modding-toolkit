/**
 * The wire between the Wiki host (panel.ts) and its app (app/main.ts). The
 * host reads the article files, knows the active game and can build the mod
 * report; the app filters, renders and asks for a command to run. Articles
 * arrive in full, so search costs no round trip. Launch-options articles
 * refresh from the installed game files. The mod report is fetched on demand
 * from the live index when its page opens.
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
  /** Source history bundled at build time, absent for live or external references. */
  revision?: {
    /** ISO timestamp of the last committed change to this article's source. */
    lastEdited?: string;
    uncommitted: boolean;
  };
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
  /** Prefix the label and tooltip with the selected reference game. */
  selectedGame?: boolean;
  group: "Script reference" | "Images & formats" | "Troubleshooting" | "Community" | "More";
  /** Uses the workspace game, independently of the reference selector. */
  workspace?: boolean;
  target: { command: string } | { page: string };
}

export interface WikiLocation {
  page: string | null;
  game: string;
  query: string;
}

export interface WikiReadingState {
  version: 1;
  current: WikiLocation;
  back: WikiLocation[];
  forward: WikiLocation[];
  positions: Record<string, { scroll: number; cardKind: string | null }>;
  diagOpen: boolean;
}

export type HostToApp =
  | {
      type: "content";
      hub: WikiHubEntry[];
      articles: WikiArticle[];
      /** Every supported game, for the sidebar's switch. */
      games: { id: string; name: string; shortName?: string }[];
      /** The workspace's game: what the switch starts on. */
      game: string;
      select: string | null;
      state?: WikiReadingState;
    }
  | { type: "select"; id: string }
  | { type: "hub"; hub: WikiHubEntry[]; game: string }
  | { type: "launchOptions"; articles: WikiArticle[] }
  | { type: "modReport"; markdown: string };

export type AppToHost =
  | { type: "ready" }
  | { type: "run"; command: string; game?: string }
  | { type: "saveState"; state: WikiReadingState }
  | { type: "searchExamples"; query: string; game: string }
  | { type: "contribute"; game: string; article?: string }
  | { type: "refreshLaunchOptions" }
  | { type: "modReport" };
