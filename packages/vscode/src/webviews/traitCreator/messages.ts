/**
 * The wire between the Trait Creator's host (panel.ts) and its app (app/).
 *
 * The app draws a form and produces a block of script; it never reads a file,
 * never talks to the language server and never decides where anything goes.
 * Everything it knows about the game arrives in `init` (the form the server
 * answered, the loc language, the icon folder's file names) or in `target`
 * (where the next save lands), and the pictures come back as webview URLs on
 * request, because a webview cannot read the disk.
 */
import type { DefinitionForm, ModifierFormat } from "@px-lsp/protocol/protocol";
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

export interface TraitCreatorInit {
  form: DefinitionForm;
  /** The language the loc values are written for (`english`). */
  locLanguage: string;
  /** The prefix the New Content flow remembers; the default name starts with it. */
  prefix: string;
  /** File names in `form.iconFolder`, mod entries first. Thumbs on request. */
  iconKeys: string[];
  /** What is missing and how to fix it, when the workspace is not ready. */
  problem?: string;
}

export type HostToApp =
  | { type: "init"; init: TraitCreatorInit }
  /** The answer to `load`: the same form with `current` filled (or not). */
  | { type: "form"; form: DefinitionForm }
  /** Thumbnails for the icon keys that were asked for; null = undecodable. */
  | { type: "icons"; urls: Record<string, string | null> }
  /** Where the next save lands, sent as the form loads and after every change. */
  | CreatorTargetReply
  /**
   * A picture of the modder's own was written. `inPlace` is false when they
   * sent it somewhere other than the icon folder: the game cannot find it by
   * the trait's name there, so it is neither offered in the grid nor treated
   * as the trait's icon.
   */
  | { type: "iconWritten"; key: string; url: string | null; inPlace: boolean }
  /** A save finished. `ok` false leaves the form exactly as it was. */
  | { type: "saved"; ok: boolean; name: string }
  /**
   * How the game prints each modifier (`paradox/modifierFormats`), fetched
   * once per panel. `null` when the profile names no formats source: the
   * preview then title-cases the names instead of showing nothing.
   */
  | { type: "modifierFormats"; formats: Record<string, ModifierFormat> | null }
  /** Pictures for the game-relative texture paths the preview asked for. */
  | CreatorImagesReply
  /** Loc values for the keys asked for; a key nothing resolves is absent. */
  | { type: "loc"; values: Record<string, string> }
  | { type: "toast"; message: string; variant?: "default" | "destructive" };

export type AppToHost =
  | { type: "ready" }
  /** Load an existing definition into the form (`current` comes back). */
  | { type: "load"; name: string }
  /** Decode these icon file names to PNG and answer with webview URLs. */
  | { type: "icons"; keys: string[] }
  | { type: "save"; save: TraitSave }
  /** The toolbar's "open the file this came from", at the block's own line. */
  | { type: "revealSource"; file: string; line: number }
  /**
   * A script box's "Edit in the file": save the definition, then open it in
   * the editor at its block. The whole save rides along, because the file the
   * modder is about to read has to hold what the form says (fields.ts
   * `scriptFoot`; a textarea has no completion, hover or highlighting).
   */
  | (CreatorOpenFileRequest & { save: TraitSave })
  /** Deep link into the Examples Wiki for a trigger, effect or modifier name. */
  | { type: "openExamples"; name: string }
  /** The script section was clicked, or its copy button. */
  | CreatorCopyRequest
  /** The target line was clicked: ask where the save should go. */
  | CreatorChangeTargetRequest
  /** Pick an image and convert it into the mod's icon folder under `name`. */
  | { type: "convertIcon"; name: string }
  /** Decode these game-relative texture paths (a modifier line's texticon). */
  | CreatorImagesRequest
  /** Resolve these loc keys (a trait flag's `TRAIT_FLAG_DESC_<name>`). */
  | { type: "loc"; keys: string[] };

export interface TraitSave {
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
