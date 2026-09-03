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
import type { FlagDatabase, FlagEntry, FlagTarget, ModTarget } from "../flagBuilder/messages";
import type { CoaFlag } from "@px-lsp/server/coa/coa";

export type { FlagDatabase, FlagEntry, FlagTarget, ModTarget };

/** Which of the game's three designer tabs the panel is showing. */
export type DesignerTab = "background" | "layout" | "emblems";

/** Per-user layout the host remembers across sessions. */
export interface DesignerUiState {
  panelWidth: number;
  panelCollapsed: boolean;
  /** The mod arms are saved into (its path), when the workspace has several. */
  savePath?: string;
  /** The preview frame, "" for none. */
  frame?: string;
  tab?: DesignerTab;
}

export type HostToApp =
  | { type: "init"; db: FlagDatabase; mods: ModTarget[]; ui?: DesignerUiState; target?: FlagTarget }
  /** The clipboard held a definition; the app asks before replacing its own. */
  | { type: "pasted"; flag: CoaFlag }
  /** "Adjust Existing Design": what the modder picked out of the host's list. */
  | { type: "opened"; entry: FlagEntry; flag: CoaFlag }
  | { type: "textures"; urls: Record<string, string | null>; thumbs: boolean }
  | { type: "toast"; message: string };

export type AppToHost =
  | { type: "ready" }
  /** `keys` are `<kind>/<file>`, plus `frames/<id>` and `masks/<id>` for the preview frame. */
  | { type: "textures"; keys: string[]; thumbs: boolean }
  | { type: "copy"; text: string }
  | { type: "uiState"; state: DesignerUiState }
  /** `sourceFile`: the coa file the arms were opened from, offered as the save target. */
  | { type: "save"; name: string; script: string; modPath: string; sourceFile?: string }
  | { type: "paste" }
  /**
   * "Adjust Existing Design". The picker is the host's QuickPick rather than a
   * menu in the page: the list is every definition the game and the mods ship
   * (2850 on a stock 1.19 install), which is a size VS Code's own picker is
   * built for and an in-page list is not.
   */
  | { type: "open" }
  | { type: "exportPng"; name: string; dataUrl: string };

/** Emblem and pattern grid tiles are decoded small; the game's grid wraps 5. */
export const THUMB_DIM = 96;
export const GRID_COLUMNS = 5;
