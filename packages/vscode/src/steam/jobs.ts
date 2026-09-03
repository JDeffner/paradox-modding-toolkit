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
 * carries no content. Per-language updates are part of steamwand's generated
 * binding (see bridge.ts): the symbol resolves at load or the job fails,
 * never silently overwriting the default-language text.
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
  /** Developer metadata on the item, not shown to users (max 5000 bytes). */
  metadata?: string;
  /** Key/value tags; each key replaces the item's existing values for it. */
  keyValueTags?: Record<string, string>;
  /** Extra preview images to add (absolute paths, PNG/JPG/GIF). */
  previewImages?: string[];
  /** YouTube video ids to add as previews. */
  previewVideos?: string[];
  /** Indexes into the item's additional previews to remove before the adds. */
  removePreviewIndexes?: number[];
}

/** One DLC of the game as the Steam client lists it. */
export interface DlcEntry {
  appId: number;
  name: string;
  /** Owned by the logged-in account. Unowned DLC is still a valid requirement. */
  available: boolean;
}

/** An extra preview on the item: an image URL, or a YouTube video id (type 1). */
export interface AdditionalPreview {
  type: number;
  urlOrVideoId: string;
  originalFileName: string;
}

export type BridgeJob =
  | { action: "create"; appId: number }
  /** Sequential SubmitItemUpdate calls in one Steam session (details, then translations). */
  | { action: "publish"; appId: number; itemId: string; submits: SubmitSpec[] }
  /** The item's live details, plus its title/description per requested language. */
  | { action: "query"; appId: number; itemId: string; languages?: string[] }
  /** The game's DLC list from the Steam client. */
  | { action: "dlc"; appId: number }
  /** Required DLC and required items are keyed by the item, not by an update: applied as their own calls. */
  | {
      action: "setDependencies";
      appId: number;
      itemId: string;
      addApps: number[];
      removeApps: number[];
      addItems: string[];
      removeItems: string[];
    };

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
  /** Required DLC app ids. */
  appDependencies: number[];
  /** Required items (Workshop ids). */
  children: string[];
  additionalPreviews: AdditionalPreview[];
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
  | { action: "dlc"; dlc: DlcEntry[] }
  | { action: "setDependencies"; itemId: string };

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
