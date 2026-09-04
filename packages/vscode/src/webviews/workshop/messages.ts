/**
 * The wire between the Workshop panel host (panel.ts) and its app (app/).
 * Everything the app knows about the mod arrives in `init`/`info` (read from
 * disk); the item's live state arrives in `live` after the host asked Steam
 * through the bridge. The app never touches the disk or Steam itself.
 */
import type { ItemDetails, WorkshopVisibility } from "../../steam/jobs";
/** One pre-upload finding. Declared here, not in steam/preflight.ts, so the
 * DOM-only webview typecheck never pulls Node types in through that module. */
export interface PreflightCheck {
  level: "error" | "warn";
  message: string;
}

/**
 * One language's local draft. Structurally the protocol's WorkshopTranslation
 * (workshopMeta.ts) - declared here because the app project (DOM, no node
 * types) cannot pull that fs-importing module in, even for a type.
 */
export interface TranslationDraft {
  title?: string;
  description?: string;
}

/** A mod of the workspace the panel can manage. */
export interface ModChoice {
  label: string;
  path: string;
}

/**
 * One DLC the grid offers as a requirement. Read from the game install when
 * the game path is known (which leaves Chapter bundles and the Subscription
 * out), else from Steam, which has no icons.
 */
export interface DlcChoice {
  steamId: number;
  name: string;
  /** Webview URI of the decoded icon, or null when there is none to show. */
  iconUri: string | null;
}

/** A changelog the mod already has, offered as the changenote source. */
export interface ChangelogCandidate {
  path: string;
  kind: "file" | "folder";
  /** True when px.workshop.changelog already points at it. */
  current: boolean;
}

export interface SteamLanguage {
  api: string;
  label: string;
}

/** What the mod's descriptor + workshop.json say, plus what upload can do. */
export interface WorkshopModInfo {
  root: string;
  gameName: string;
  /** True when the mod has no descriptor at all: nothing can upload. */
  descriptorMissing: boolean;
  /** The descriptor's name - the item's default-language title. */
  name: string | null;
  tags: string[];
  /** The launcher's tag vocabulary, for the add-tag dropdown (may be empty). */
  knownTags: string[];
  publishedId: string | null;
  /** Local copy of the default-language description (workshop.json). */
  description: string;
  /** Local translations (workshop.json), keyed by Steam API language code. */
  translations: Record<string, TranslationDraft>;
  /** Webview URI of the local preview image, and its file name. */
  previewUri: string | null;
  previewName: string | null;
  /** Steam rejects preview images of 1 MB or more; uploads then keep the current one. */
  previewTooLarge: boolean;
  changeNoteSuggestion: string;
  /** Changenote resolved from the changelog (px.workshop.changelog), if any. */
  changelogNote: { text: string; source: string } | null;
  /** Where the changelog lookup pointed (resolved px.workshop.changelog). */
  changelogPath: string;
  /** True when that path exists at all (a missing entry reads differently from a missing changelog). */
  changelogPresent: boolean;
  /** Changelogs found in the mod or the workshop folder, to point the setting at. */
  changelogCandidates: ChangelogCandidate[];
  /** The mod's own version (the next update's) and the supported game version. */
  version: string | null;
  supportedVersion: string | null;
  /** Resolved px.workshop.dir - where the listing lives as files. */
  workshopDir: string;
  /** True when px.workshop.dir is set, false for the default folder inside the mod. */
  workshopDirCustom: boolean;
  /** True when that folder exists: it is then the canonical listing store. */
  filesPresent: boolean;
  /**
   * Which descriptions the listing folder keeps as Markdown: the empty string
   * for the default one, else the Steam language code. The panel converts
   * those to BBCode before previewing, so the preview is what Steam gets.
   */
  markdown: string[];
  steamLanguages: SteamLanguage[];
  /** Steam codes guessed from the mod's localization folders, to offer first. */
  suggestedLanguages: string[];
  /** Steam names of the languages the game itself ships localization for (english excluded). */
  gameLanguages: string[];
  /** What would go wrong on upload, from the local files alone. */
  checks: PreflightCheck[];
  /** Extra previews from `<workshopDir>/previews/` (null = no such folder, Steam's gallery is left alone). */
  previews: { dir: string; images: { name: string; uri: string }[]; videos: string[] } | null;
  /** Required DLC and items from `<workshopDir>/dependencies.json` (null = never set, Steam's are left alone). */
  dependencies: { apps: number[]; items: string[] } | null;
  /** Installed Workshop mods the required-items picker offers first. */
  dependencyCandidates: { itemId: string; label: string; declared: boolean }[];
}

/** What a download from Steam writes into the listing folder; mirrors the publish parts. */
export interface PullParts {
  /** item.json: title, tags, visibility, id. */
  details: boolean;
  /** The default-language description file. */
  description: boolean;
  /** translations/<lang>/ for every language whose text differs from the default. */
  translations: boolean;
  /** previews/: the gallery images downloaded, videos.txt, order.txt. */
  previews: boolean;
  /** dependencies.json. */
  requirements: boolean;
  /** The main preview image, into the mod folder. */
  thumbnail: boolean;
}

/** Title/description as Steam serves one language (its fallback included). */
export interface LiveTranslation {
  title: string;
  description: string;
}

export type HostToApp =
  | { type: "init"; mods: ModChoice[]; active: string | null; info: WorkshopModInfo | null }
  | { type: "info"; active: string; info: WorkshopModInfo | null }
  | { type: "liveBegin" }
  | {
      type: "live";
      item: ItemDetails | null;
      translations: Record<string, LiveTranslation>;
      /** Steam unreachable or the query failed; disk data stays usable. */
      error: string | null;
    }
  /** A long job runs (buttons off). Its steps arrive as `progress`. */
  | { type: "uploadState"; busy: boolean }
  /**
   * One step of a running job: `step` names what is happening now, `done` of
   * `total` how far the job is. `step: null` ends the job's progress.
   */
  | { type: "progress"; job: ProgressJob; step: string | null; done: number; total: number }
  /** The game's DLC list, or why it could not be read. */
  | { type: "dlc"; list: DlcChoice[]; source: DlcSource; error: string | null }
  /** Titles of required Workshop items that are not installed (null = Steam does not know the id). */
  | { type: "itemTitles"; titles: Record<string, string | null> };

/** The long jobs that report progress. */
export type ProgressJob = "upload" | "download";

/** Where a DLC list came from: the install, Steam, or nowhere yet. */
export type DlcSource = "game" | "steam" | "none";

export type AppToHost =
  | { type: "ready" }
  | { type: "selectMod"; path: string }
  /** Ask Steam for the item + these languages' text. */
  | { type: "refresh"; languages: string[] }
  /** Persist the local drafts into <configDir>/workshop.json. */
  | { type: "saveLocal"; description: string; translations: Record<string, TranslationDraft> }
  /**
   * Upload what is checked. The app sends `saveLocal` first, so the host
   * reads the store; `visibility` is null while the user never picked one.
   */
  | {
      type: "upload";
      content: boolean;
      details: boolean;
      /** The gallery (images + videos), separate from the details and the thumbnail. */
      previews: boolean;
      /** dependencies.json: the required DLC and items, applied after the submits. */
      requirements: boolean;
      languages: string[];
      changeNote: string;
      visibility: WorkshopVisibility | null;
    }
  | { type: "openPage" }
  | { type: "createDescriptor" }
  /** Write a descriptor/metadata scalar (title = name, versions). */
  | { type: "setField"; field: "title" | "version" | "supportedVersion"; value: string }
  | { type: "setTags"; tags: string[] }
  /** Pick a new preview image (host opens the file dialog). */
  | { type: "pickPreview" }
  /** Open a listing file in the editor (null = the default description). */
  | { type: "openListingFile"; lang: string | null }
  /** Re-read everything from disk (the app already dropped its pending save). */
  | { type: "reload" }
  /** Surface a message as a VS Code notification (the app has no UI for it). */
  | { type: "notify"; message: string; warn?: boolean }
  /** Download the chosen parts of the live listing into the workshop folder (confirmed app-side). */
  | { type: "pullListing"; parts: PullParts }
  /** Write previews/order.txt (bare file names, gallery order). */
  | { type: "reorderPreviews"; names: string[] }
  /**
   * Ask for the game's DLC list. It is read from the install; `allowSteam`
   * lets the host fall back to the Steam client when the game path is unknown.
   */
  | { type: "loadDlc"; allowSteam: boolean }
  /** Ask Steam for the titles of required items that are not installed mods. */
  | { type: "resolveItems"; ids: string[] }
  /** Point px.workshop.changelog at an existing changelog (an absolute path from `changelogCandidates`). */
  | { type: "setChangelogSource"; path: string }
  /** Create `<workshopDir>/changelog/<version>.md` and open it. */
  | { type: "createChangelog" }
  /** Write dependencies.json (required DLC app ids, required Workshop item ids). */
  | { type: "setDependencies"; apps: number[]; items: string[] }
  /** Pick images to copy into the previews folder (host opens the file dialog). */
  | { type: "addPreviews" }
  /** Delete one file of the previews folder (a bare file name). */
  | { type: "removePreview"; name: string }
  /** Write previews/videos.txt. */
  | { type: "setVideos"; ids: string[] }
  /** Reveal the previews folder in the OS file manager, creating it first. */
  | { type: "openPreviewsFolder" }
  /** Open the wiki's BBCode page: which tags Steam renders in a description. */
  | { type: "bbcodeHelp" };
