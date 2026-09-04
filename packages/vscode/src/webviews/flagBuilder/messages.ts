/**
 * The wire between the flag builder host (panel.ts) and its app (app/).
 * Everything the app knows about the game arrives in `init`; textures are
 * fetched on demand as webview URLs because the app cannot read the disk.
 */
import type { CoaFlag, DesignerEntry, Rgb } from "@px-lsp/server/coa/coa";

export type TextureKind = "patterns" | "colored_emblems" | "textured_emblems";

/** One palette swatch: the game's color name and what it resolves to. */
export interface DesignerPaletteColor {
  name: string;
  rgb: Rgb;
}

/** A preview frame: `<id>.dds` drawn over the arms masked by `<id>_mask.dds`. */
export interface DesignerFrame {
  id: string;
  label: string;
  /**
   * The gui type that draws the frame, from the cultures that name it
   * (`house_coa_frame` / `dynasty_coa_frame`). It decides how much of the frame
   * cell the arms fill; absent when no culture names the frame.
   */
  family?: "house" | "dynasty";
  /** Heritage ids of the cultures wearing it, most cultures first: the label's words. */
  heritages?: string[];
}

/** A whole coat of arms written against the layouts file's placeholders. */
export interface DesignerLayout {
  name: string;
  flag: CoaFlag;
}

/**
 * What the game's own Coat of Arms designer offers, read from the files that
 * drive it (see @px-lsp/server/coa/coaDesigner). Only built when the panel
 * asking for the database is the designer; the Flag Builder never needs it.
 */
export interface DesignerCatalog {
  /** Visible patterns, in file order; `colors` is how many color buttons to show. */
  patterns: DesignerEntry[];
  /** Visible emblems, in file order, each carrying its category. */
  emblems: DesignerEntry[];
  /** Category ids in the order the emblem file first uses them. */
  categories: string[];
  palette: DesignerPaletteColor[];
  layouts: DesignerLayout[];
  /** The layouts file's own `@name = value` defaults: what a layout thumbnail draws with. */
  layoutDefaults: Record<string, string>;
  /** "Start From Scratch": the `coa_designer_blank_default` template, or null. */
  template: CoaFlag | null;
  frames: DesignerFrame[];
  /** The emblem that means "no emblem" (`colors = 0`), or "" when the catalog has none. */
  emptyEmblem: string;
}

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
  /** Present only when the caller asked for it (the Coat of Arms Designer). */
  designer?: DesignerCatalog;
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

/**
 * What the arms the panel opens on are for. `name` is the key the game reads
 * them under; `label` ("Karling (dynasty)") is what the modder called it. It
 * rides on `init` so that re-targeting an already open panel is the same one
 * message as opening a new one.
 */
export interface FlagTarget {
  name: string;
  label?: string;
}

export type HostToApp =
  | { type: "init"; db: FlagDatabase; mods: ModTarget[]; ui?: UiState; target?: FlagTarget }
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
