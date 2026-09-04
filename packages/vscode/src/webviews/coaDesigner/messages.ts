/**
 * The wire between the Coat of Arms Designer host (panel.ts) and its app.
 *
 * The database, the mod list and the target are the Flag Builder's (both
 * panels edit the same `coat_of_arms` definitions and save through the same
 * flow), so those types are imported rather than restated. What is new here is
 * the designer catalog on `db.designer` and the preview FRAME keys: a frame is
 * a `frames/<id>` texture drawn over the arms masked by `masks/<id>`, and it
 * is decoration for the preview only, never written into the script.
 */
import type { DesignerFrame, FlagDatabase, FlagEntry, FlagTarget, ModTarget } from "../flagBuilder/messages";
import type { CoaFlag } from "@px-lsp/server/coa/coa";
import type { CreatorSaveTarget } from "../shared/creatorMessages";

export type { FlagDatabase, FlagEntry, FlagTarget, ModTarget };

/**
 * One file of the designer's library (library.ts reads them). `flag` is null
 * for a file that does not hold a coat of arms, which the overlay shows as a
 * tile that says so rather than hiding it: a file the modder put there and
 * cannot see back is worse than an unreadable tile.
 */
export interface LibraryItem {
  /** The design's name: the definition's key, else the file's stem. */
  name: string;
  file: string;
  flag: CoaFlag | null;
}

/** Which of the game's three designer tabs the panel is showing. */
export type DesignerTab = "background" | "layout" | "emblems";

/** Per-user layout the host remembers across sessions. */
export interface DesignerUiState {
  /** The RIGHT panel (the Background / Layout / Emblems tabs). */
  panelWidth: number;
  panelCollapsed: boolean;
  /** The LEFT panel (library, frame, grid and placement). */
  leftWidth?: number;
  leftCollapsed?: boolean;
  /** The mod arms are saved into (its path), when the workspace has several. */
  savePath?: string;
  /** The preview frame, "" for none. */
  frame?: string;
  /**
   * Which cell of a frame sheet the preview draws, 1-based. House and dynasty
   * frames are one 160px cell per title tier (house_frame_26.dds is 960x160,
   * measured on 1.19); a single-cell frame ignores this.
   */
  frameTier?: number;
  /** The grid over the arms: whether it is drawn and snapped to, and how fine. */
  grid?: boolean;
  /** Cells per axis, one of app/groups.ts GRID_DIVISIONS. */
  gridDiv?: number;
  tab?: DesignerTab;
}

export type HostToApp =
  | { type: "init"; db: FlagDatabase; mods: ModTarget[]; ui?: DesignerUiState; target?: FlagTarget }
  /** The clipboard held a definition; the app asks before replacing its own. */
  | { type: "pasted"; flag: CoaFlag }
  /** "Adjust Existing Design": what the modder picked out of the host's list. */
  | { type: "opened"; entry: FlagEntry; flag: CoaFlag }
  | { type: "textures"; urls: Record<string, string | null>; thumbs: boolean }
  /**
   * The same frames the `init` database carried, relabelled once the loc index
   * has answered: a frame's words are the heritages that wear it, and those
   * names arrive after the panel is already usable.
   */
  | { type: "frames"; frames: DesignerFrame[] }
  /** Where the next save lands, for the top bar to SHOW (shared/saveTarget.ts). */
  | { type: "target"; target: CreatorSaveTarget | null }
  /** What the library folder holds, for the Import overlay. `dir` is shown when it is empty. */
  | { type: "library"; dir: string; items: LibraryItem[] }
  | { type: "toast"; message: string };

export type AppToHost =
  | { type: "ready" }
  /** `keys` are `<kind>/<file>`, plus `frames/<id>` and `masks/<id>` for the preview frame. */
  | { type: "textures"; keys: string[]; thumbs: boolean }
  | { type: "copy"; text: string }
  | { type: "uiState"; state: DesignerUiState }
  /** Where it lands is the host's `target`, in the top bar since the panel opened. */
  | { type: "save"; name: string; script: string; modPath: string }
  | { type: "paste" }
  /** The target line was clicked: open the picker for the file a save writes. */
  | { type: "changeTarget" }
  /**
   * "Adjust Existing Design". The picker is the host's QuickPick rather than a
   * menu in the page: the list is every definition the game and the mods ship
   * (2850 on a stock 1.19 install), which is a size VS Code's own picker is
   * built for and an in-page list is not.
   */
  | { type: "open" }
  /** Read the library folder; the answer is a `library` message. */
  | { type: "libraryList" }
  /** Pick the library folder; the host writes px.coaLibraryDir. */
  | { type: "libraryDir" }
  /** Store this design in the library as `<name>.txt`; replacing asks first. */
  | { type: "libraryExport"; name: string; script: string }
  | { type: "exportPng"; name: string; dataUrl: string };

/** Emblem and pattern grid tiles are decoded small; the game's grid wraps 5. */
export const THUMB_DIM = 96;
export const GRID_COLUMNS = 5;
