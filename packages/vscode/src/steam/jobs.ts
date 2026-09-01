/**
 * The wire between workshop.ts / the Workshop panel host and the bridge child
 * process (bridge.ts -> dist/steamBridge.js). Types only - the bridge is
 * bundled separately and must not pull extension-host code in.
 *
 * stdin:  one JSON BridgeJob.
 * stdout: newline-delimited JSON BridgeEvents, ending in `done` or `error`.
 */

/** ISteamUGC ERemoteStoragePublishedFileVisibility, as steamworks.js numbers them. */
export type WorkshopVisibility = 0 | 1 | 2 | 3;
export const VISIBILITY = { public: 0, friendsOnly: 1, private: 2, unlisted: 3 } as const;

/**
 * One SubmitItemUpdate call. With `language` set, `title`/`description` land
 * as that language's translation instead of the default text - such a submit
 * carries no content. The bridge REFUSES `language` when the bundled
 * steamworks.js predates per-language updates, because an older native layer
 * would silently drop the field and overwrite the default-language text.
 */
export interface SubmitSpec {
  title?: string;
  description?: string;
  changeNote?: string;
  previewPath?: string;
  contentPath?: string;
  tags?: string[];
  visibility?: WorkshopVisibility;
  /** Steam API language code (`german`, `schinese`, ...). */
  language?: string;
}

export type BridgeJob =
  | { action: "create"; appId: number }
  /** Sequential SubmitItemUpdate calls in one Steam session (details, then translations). */
  | { action: "publish"; appId: number; itemId: string; submits: SubmitSpec[] }
  /** The item's live details, plus its title/description per requested language. */
  | { action: "query"; appId: number; itemId: string; languages?: string[] }
  /** The user's own published items of this app (to link an existing item). */
  | { action: "list"; appId: number };

/** The live item details the toolkit shows (bigints already stringified). */
export interface ItemDetails {
  itemId: string;
  title: string;
  description: string;
  visibility: WorkshopVisibility;
  tags: string[];
  previewUrl: string | null;
  timeCreated: number;
  timeUpdated: number;
  banned: boolean;
  numUpvotes: number;
  numDownvotes: number;
  numSubscriptions: number | null;
  numFavorites: number | null;
  numUniqueWebsiteViews: number | null;
  numComments: number | null;
}

export type BridgeEvent =
  | {
      type: "progress";
      status: string;
      uploaded: number;
      total: number;
      /** 1-based submit position, for multi-submit publish jobs. */
      submit: number;
      submits: number;
    }
  | { type: "done"; result: BridgeDone }
  | { type: "error"; message: string };

export type BridgeDone =
  | { action: "create"; itemId: string; needsToAcceptAgreement: boolean }
  | { action: "publish"; itemId: string; needsToAcceptAgreement: boolean }
  | {
      action: "query";
      item: ItemDetails | null;
      /** Title/description as Steam serves each requested language (its default-language fallback included). */
      translations: Record<string, { title: string; description: string }>;
    }
  | { action: "list"; items: { itemId: string; title: string; timeUpdated: number }[]; total: number };

/** Dotted-number version compare: `a` >= `b`. Non-numeric parts compare as 0. */
export function versionAtLeast(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}
