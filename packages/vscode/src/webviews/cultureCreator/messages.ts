/**
 * The wire between the Culture Creator host (panel.ts) and its app
 * (app/main.ts). The app never touches the filesystem and never talks to the
 * language server: it asks for a culture to be loaded, or for the one it has
 * drawn to be written, and the host does both.
 */
import type { CalendarSetting } from "@px-lsp/protocol/calendar";
import type { DefinitionForm } from "@px-lsp/protocol/protocol";
import type {
  CreatorChangeTargetRequest,
  CreatorCopyRequest,
  CreatorImagesReply,
  CreatorImagesRequest,
  CreatorTargetReply,
} from "../shared/creatorMessages";

/**
 * One tradition, as the game's own files describe it beyond what the definition
 * index can say. Measured in game/common/culture/traditions/*.txt:
 * `tradition_winter_warriors = { category = combat layers = { 0 = learning
 * 1 = western 4 = fight.dds } … }`.
 */
export interface TraditionInfo {
  /** `category = combat`: how the game's own Add Tradition view groups them. */
  category?: string;
  /**
   * The icon layers as game-relative FILES, in the index order the engine
   * stacks them (the folders come from CULTURE_TRADITION_LAYER_PATHS in
   * common/defines/00_defines.txt). An index that names a folder rather than a
   * file is one the game randomizes; the host resolves it to that folder's
   * first entry so the picture is stable while the form is open.
   */
  layers: string[];
}

/**
 * What the panel read out of the game and mod folders for the pickers, once
 * per panel: none of it is in paradox/definitionForm, and all of it is what
 * turns a list of keys into something a modder can recognize.
 */
export interface CultureCatalog {
  /** Tradition key -> its category and its icon layers. */
  traditions: Record<string, TraditionInfo>;
  /**
   * `<key>_desc` for every pillar and tradition that has one. Measured: the
   * ethos and martial_custom pillars and every tradition localize a desc,
   * heritage / language / head_determination do not, so a key missing here is
   * the normal case and not an error.
   */
  descs: Record<string, string>;
  /** The `requires_dlc_flag` values the game's own cultures write. */
  dlcFlags: string[];
}

/** How a save reaches the file. */
export type SaveMode =
  /** A culture that does not exist yet: write the whole block. */
  | "create"
  /** The mod's own culture, loaded: write only the keys that changed. */
  | "edit"
  /** A game culture, under a new name: write the whole block into the mod. */
  | "duplicate"
  /** A game culture, under ITS name: the mod's copy replaces the game's. */
  | "override";

export interface CultureInit {
  /** Everything paradox/definitionForm answered for kind "culture". */
  form: DefinitionForm;
  /** px.locLanguage: which localization file a loc value lands in. */
  locLanguage: string;
  /** The prefix the New Content flow remembers; the name is prefilled with it. */
  prefix: string;
  /**
   * Named colors of the game and the mods, mod first, as `name -> r,g,b` bytes:
   * a culture may write `color = bedouin` instead of three components
   * (game/common/named_colors/culture_colors.txt).
   */
  namedColors: Record<string, [number, number, number]>;
  /** What the game's own files say about the pillars and traditions offered. */
  catalog: CultureCatalog;
  /** px.calendar, when the workspace configures one: `created` is checked against it. */
  calendar?: CalendarSetting;
  /** No mod folder in the workspace: nothing can be written yet. */
  noMod: boolean;
  /** No game folder: the pickers still work, but nothing has a picture. */
  noGame: boolean;
}

export type HostToApp =
  | { type: "init"; init: CultureInit }
  | { type: "loading" }
  /** The save landed; the app clears its "changed" marks. */
  | { type: "saved"; name: string }
  /** The save did not happen (cancelled at the file pick, or refused). */
  | { type: "idle" }
  | { type: "error"; message: string }
  /** The decoded pictures for the asset paths the app asked about. */
  | CreatorImagesReply
  /** Where the next save lands, for the top bar's target line. */
  | CreatorTargetReply
  /** Something the host did and the app should say (a copy, a refusal). */
  | { type: "toast"; message: string; variant?: "destructive" };

export type AppToHost =
  | { type: "ready" }
  /** Start over on a blank culture (the toolbar's New). */
  | { type: "new" }
  /** Load this culture into the form (the mod's copy first, else the game's). */
  | { type: "load"; name: string }
  /** Turn game asset paths into pictures the preview and the pickers can show. */
  | CreatorImagesRequest
  /** Open the Examples Wiki on a name the form shows. */
  /** Open the Examples Wiki; a culture key is no article, so no target is sent. */
  | { type: "openExamples" }
  /** Open the Tradition Creator on this tradition, or on a blank form when the name is empty. */
  | { type: "editTradition"; name: string }
  /** Put the generated block on the clipboard; a webview cannot reach it. */
  | CreatorCopyRequest
  /** The target line was clicked: ask where the next save should go. */
  | CreatorChangeTargetRequest
  | {
      type: "save";
      name: string;
      mode: SaveMode;
      /** The whole `name = { … }` block, for create / duplicate / override. */
      block: string;
      /** Only the keys that changed, for an edit. */
      changed?: { key: string; value: string | null }[];
      loc: { key: string; value: string }[];
    };
