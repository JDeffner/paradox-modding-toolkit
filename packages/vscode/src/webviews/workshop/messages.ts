/**
 * The wire between the Workshop panel host (panel.ts) and its app (app/).
 * Everything the app knows about the mod arrives in `init`/`info` (read from
 * disk); the item's live state arrives in `live` after the host asked Steam
 * through the bridge. The app never touches the disk or Steam itself.
 */
import type { ItemDetails, WorkshopVisibility } from "../../steam/jobs";

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
  /** False when the bundled steamworks.js cannot set per-language text yet. */
  languageUploadOk: boolean;
  requiredSteamworksVersion: string;
  steamLanguages: SteamLanguage[];
  /** Steam codes guessed from the mod's localization folders, to offer first. */
  suggestedLanguages: string[];
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
  | { type: "uploadState"; busy: boolean; message?: string }
  | { type: "toast"; message: string; variant?: "default" | "destructive" };

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
      languages: string[];
      changeNote: string;
      visibility: WorkshopVisibility | null;
    }
  | { type: "openPage" }
  | { type: "linkExisting" }
  | { type: "createDescriptor" };
