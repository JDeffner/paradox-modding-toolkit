/**
 * The wire between the Wiki host (panel.ts) and its app (app/main.ts). The
 * host reads the article files and knows the active game; the app filters,
 * renders and asks for a command to run. Articles arrive once, in full, so
 * search costs no round trip.
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
  markdown: string;
}

/** A sidebar row that opens another view instead of an article. */
export interface WikiLauncher {
  label: string;
  command: string;
  icon: IconName;
  tip: string;
}

export type HostToApp =
  | { type: "content"; launchers: WikiLauncher[]; articles: WikiArticle[]; select: string | null }
  | { type: "select"; id: string };

export type AppToHost = { type: "ready" } | { type: "run"; command: string };
