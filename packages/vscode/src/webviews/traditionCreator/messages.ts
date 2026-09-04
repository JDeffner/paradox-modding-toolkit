/**
 * The wire between the Tradition Creator's host (panel.ts) and its app (app/).
 *
 * The app draws a form and produces a block of script; it never reads a file,
 * never talks to the language server and never decides where anything goes.
 * What a tradition may contain arrives in `init.form` (paradox/definitionForm
 * for kind `culture_tradition`); what `definitionForm` cannot answer arrives in
 * `init.catalog`, read off the game and mod folders by the host, and the
 * pictures come back as webview URLs on request.
 */
import type { DefinitionForm, FormatPart, ModifierFormat } from "@px-lsp/protocol/protocol";
import type {
  CreatorChangeTargetRequest,
  CreatorCopyRequest,
  CreatorImagesReply,
  CreatorImagesRequest,
  CreatorOpenFileRequest,
  CreatorTargetReply,
} from "../shared/creatorMessages";

/** How the save writes: the app decides, the host obeys. */
export type SaveMode = "create" | "edit" | "duplicate" | "override";

/**
 * The loc key the game prints one currency's cost with. Measured in
 * game/localization/english/core_l_english.yml for all three currencies
 * `_cultural_traits.info` names: `GOLD_COST:0 "[gold_i] $VALUE|0$"`,
 * `PRESTIGE_COST:0 "[prestige_i] $VALUE|0$"`, `PIETY_COST:0 "[piety_i]
 * $VALUE|0$"`. The host asks `paradox/modifierFormats` for these as `lines`, and
 * the tile preview prints the cost from the parts that come back.
 */
export function costLocKey(currency: string): string {
  return `${currency.toUpperCase()}_COST`;
}

/** One entry a layer folder offers: what the block writes, and its picture. */
export interface TraditionLayerChoice {
  /** `fight.dds`, or the folder name `martial`. */
  value: string;
  /** The game-relative file to draw for it. */
  rel: string;
  /** True when `value` names a folder the engine picks a random file out of. */
  folder: boolean;
}

/** One layer of the picture, as the `layers` block indexes it. */
export interface TraditionLayerFolder {
  /** The index the block writes (`0 = martial`). */
  index: number;
  /** The game-relative folder, from CULTURE_TRADITION_LAYER_PATHS. */
  path: string;
  /** Its last segment (`0-background`): what the picker calls it. */
  label: string;
  choices: TraditionLayerChoice[];
}

/** What one existing tradition picked, for "start from this one". */
export interface TraditionEntry {
  category?: string;
  /** Layer index -> the value it writes, as the file says it. */
  layers: Record<string, string>;
}

/**
 * What the panel read out of the game and mod folders, once per panel: none of
 * it is in paradox/definitionForm, and all of it is what turns a list of keys
 * into something a modder can fill in without opening a vanilla file.
 */
export interface TraditionCatalog {
  /** The picture's layers, in the order the engine stacks them. */
  layers: TraditionLayerFolder[];
  /**
   * The currencies a `cost` block may name, as
   * `common/culture/_cultural_traits.info` documents them ("cost = { gold =
   * script value, prestige = ..., piety = ... }").
   */
  costKeys: string[];
  /**
   * The parameter names the game's own traditions set, most used first. The
   * definition form cannot offer them: `parameters` is a block, and the
   * harvest holds no sub-block entry for it.
   */
  parameters: string[];
  /** Every indexed tradition's category and layer picks. */
  traditions: Record<string, TraditionEntry>;
  /**
   * The shortest body the game's own traditions write for each script key
   * (`can_pick`, `is_shown`, `ai_will_do`): a real example for a placeholder.
   */
  examples: Record<string, string>;
}

export interface TraditionCreatorInit {
  form: DefinitionForm;
  /** The language the loc values are written for (`english`). */
  locLanguage: string;
  /** The prefix the New Content flow remembers; the default name starts with it. */
  prefix: string;
  catalog: TraditionCatalog;
  /** What is missing and how to fix it, when the workspace is not ready. */
  problem?: string;
}

export type HostToApp =
  | { type: "init"; init: TraditionCreatorInit }
  /** The answer to `load`: the same form with `current` filled (or not). */
  | { type: "form"; form: DefinitionForm }
  /** Where the next save lands, sent as the form loads and after every change. */
  | CreatorTargetReply
  /** A save finished. `ok` false leaves the form exactly as it was. */
  | { type: "saved"; ok: boolean; name: string }
  /**
   * How the game prints each modifier (`paradox/modifierFormats`), fetched
   * once per panel. `null` when the profile names no formats source: the
   * preview then title-cases the names instead of showing nothing.
   */
  | {
      type: "modifierFormats";
      formats: Record<string, ModifierFormat> | null;
      /** `costLocKey(currency)` -> the game's cost line as parts, for the currencies that resolved. */
      lines: Record<string, FormatPart[]>;
    }
  /** Pictures for the game-relative texture paths the app asked for. */
  | CreatorImagesReply
  /** Loc values for the keys asked for; a key nothing resolves is absent. */
  | {
      type: "loc";
      /** The value verbatim: what a loc field edits and what a save writes. */
      values: Record<string, string>;
      /**
       * The same values as the player READS them (paradox/locText): markup
       * stripped, the game's `[GetTrait('x').GetName( … )]` chains resolved
       * through the loc, definition and schema tables. Absent for a key the
       * server could not render, and for a server that predates the request.
       */
      texts?: Record<string, string>;
    }
  | { type: "toast"; message: string; variant?: "default" | "destructive" };

export type AppToHost =
  | { type: "ready" }
  /** Load an existing definition into the form (`current` comes back). */
  | { type: "load"; name: string }
  | { type: "save"; save: TraditionSave }
  /** The toolbar's "open the file this came from", at the block's own line. */
  | { type: "revealSource"; file: string; line: number }
  /**
   * A script box's "Edit in the file": save the definition, then open it in
   * the editor at its block. The whole save rides along, because the file the
   * modder is about to read has to hold what the form says (fields.ts
   * `scriptFoot`; a textarea has no completion, hover or highlighting).
   */
  | (CreatorOpenFileRequest & { save: TraditionSave })
  /** Deep link into the Examples Wiki for a modifier name. */
  | { type: "openExamples"; name: string }
  /** The script section was clicked, or its copy button. */
  | CreatorCopyRequest
  /** The target line was clicked: ask where the save should go. */
  | CreatorChangeTargetRequest
  /** Decode these game-relative texture paths (a layer, a texticon). */
  | CreatorImagesRequest
  /** Resolve these loc keys (a category's `tradition_group_<category>`). */
  | { type: "loc"; keys: string[] };

export interface TraditionSave {
  name: string;
  mode: SaveMode;
  /** The whole `name = { … }` block the app built. */
  block: string;
  /**
   * Edit mode only: the keys that changed, as raw script text (`null` removes
   * the key). The host sends these as a `setProperties` op so an edit rewrites
   * the lines it touched and nothing else in the modder's file.
   */
  changed?: { key: string; value: string | null }[];
  loc: { key: string; value: string }[];
  /** The file the definition was loaded from, offered first as the target. */
  sourceFile?: string;
}
