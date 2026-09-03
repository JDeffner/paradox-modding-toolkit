/**
 * The wire between the flag builder host (panel.ts) and its app (app/).
 * Everything the app knows about the game arrives in `init`; textures are
 * fetched on demand as webview URLs because the app cannot read the disk.
 */
import type { CoaFlag, Rgb } from "@px-lsp/server/coa/coa";

export type TextureKind = "patterns" | "colored_emblems" | "textured_emblems";

/** One flag of the database: where it comes from is what the browser shows. */
export interface FlagEntry {
  name: string;
  /** "game" or the mod folder's name. */
  source: string;
  file: string;
}

export interface FlagDatabase {
  gameName: string;
  /** Texture file names per kind, mod entries first, deduplicated. */
  textures: Record<TextureKind, string[]>;
  namedColors: Record<string, Rgb>;
  flags: FlagEntry[];
  /** Every flag's definition, by name (last root wins, like the game). */
  definitions: Record<string, CoaFlag>;
  /** True when the game folder was not found: the database is the mod alone. */
  gameMissing: boolean;
}

/** Per-user layout the host remembers across sessions. */
export interface UiState {
  panelWidth: number;
  panelCollapsed: boolean;
  /** The mod flags are saved into (its path), when the workspace has several. */
  savePath?: string;
  /** The canvas zoom and pan are frozen; unset (the default) means they are live. */
  viewFrozen?: boolean;
}

/** A mod the flag can be saved into. */
export interface ModTarget {
  label: string;
  path: string;
}

export type HostToApp =
  | { type: "init"; db: FlagDatabase; mods: ModTarget[]; ui?: UiState }
  /** The clipboard held a flag definition; the app asks before replacing its own. */
  | { type: "pasted"; flag: CoaFlag }
  | { type: "clipboard"; text: string }
  | { type: "textures"; urls: Record<string, string | null>; thumbs: boolean }
  | { type: "toast"; message: string };

/** The Flag Builder is a port of Chris Kaiser's PDX Flag Editor (see THIRD-PARTY-NOTICES.md). */
export const FLAG_EDITOR_CREDIT = {
  text: "Ported from PDX Flag Editor by Chris Kaiser",
  url: "https://github.com/kaiser-chris/pdx-flag-builder",
} as const;

export type AppToHost =
  | { type: "ready" }
  /** `keys` are `<kind>/<file>`; thumbs are small decodes for the browser grid. */
  | { type: "textures"; keys: string[]; thumbs: boolean }
  | { type: "copy"; text: string }
  | { type: "uiState"; state: UiState }
  /** `sourceFile`: the coa file the flag was opened from, offered as the save target for overrides. */
  | { type: "save"; name: string; script: string; modPath: string; sourceFile?: string }
  | { type: "paste" }
  | { type: "readClipboard" }
  /** Open the upstream credit link (the host allows only the known URL). */
  | { type: "openCredit" }
  | { type: "exportPng"; name: string; dataUrl: string };

export const THUMB_DIM = 96;
