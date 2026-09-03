/**
 * The wire between the Dynasty Legacy Creator's host (panel.ts) and its app
 * (app/main.ts). The app draws the track and its perks and hands back the
 * blocks to write; the host does everything a browser page cannot: ask the
 * language server for the two forms, resolve icons, pick the files, apply the
 * edits and write the loc.
 */
import type { DefinitionForm, ModifierFormat } from "@px-lsp/protocol/protocol";
import type { CreatorImagesReply, CreatorImagesRequest, CreatorSaveTarget } from "../shared/creatorMessages";

/** One picture of the legacy icon folder, already decoded to a webview URL. */
export interface IconEntry {
  /** File name without the extension: the track key the game derives it from. */
  key: string;
  url: string;
  /** Where it came from ("game", or a mod's folder name). */
  source: string;
}

export interface CreatorInit {
  /** The `dynasty_legacy` form: folder, loc patterns, icon folder, keys. */
  legacy: DefinitionForm;
  /** The `dynasty_perk` form: the seven documented keys and the vocabularies. */
  perk: DefinitionForm;
  /** `px.locLanguage`: which loc file the values land in. */
  locLanguage: string;
  /** `scaffoldPrefix(cfg)`: what a fresh track's name is prefilled from. */
  prefix: string;
  /**
   * Perks per track in the game's own files, or null when the game folder is
   * not set. The app opens a new track with that many empty perk slots.
   */
  perksPerTrack: number | null;
  icons: IconEntry[];
  /**
   * How the GAME prints each modifier (`paradox/modifierFormats`), so a perk
   * tile's tooltip reads "+0.30 Positive Genetic Chance" and not the script.
   * Null when the profile names no formats source or the game folder is unset;
   * the tooltip then falls back to the key and a plain number.
   */
  formats: Record<string, ModifierFormat> | null;
  /**
   * Icon folder per ref kind a perk key names (`traits` -> `trait` ->
   * `gfx/interface/icons/traits`), read off THAT kind's own form so nothing
   * here hard-codes a game path. Absent kinds simply get no picture.
   */
  refIconFolders: Record<string, string>;
  /** Why nothing can be written yet (no mod folder), or null. */
  problem: string | null;
}

/** One perk of a loaded track: its block, verbatim, and where it lives. */
export interface LoadedPerk {
  name: string;
  file: string;
  source: "mod" | "vanilla" | "parent";
  text: string;
}

/** What the app asks the host to write. */
export interface SaveDefinition {
  name: string;
  /**
   * `edit` rewrites only the keys that moved (setProperties); everything else
   * writes the whole block (upsertBlock).
   */
  mode: "create" | "edit" | "override";
  /** The whole `name = { … }` block. */
  block: string;
  /** The keys that moved, for `edit`. */
  changed?: { key: string; value: string | null }[];
  loc: { key: string; value: string }[];
  /** The mod file it was loaded from, offered first when the target is picked. */
  sourceFile?: string;
}

/** A perk the modder dropped from a track that already exists on disk. */
export interface DroppedPerk {
  name: string;
  file: string;
}

/** The two files a legacy is written into. */
export type TargetKind = "track" | "perks";

export type AppToHost =
  | { type: "ready" }
  /** Load an existing track and its perks into the form. */
  | { type: "load"; name: string }
  /** Deep link into the Examples Wiki for a name the modder asked about. */
  | { type: "openExamples"; name: string }
  /** Pick a picture and convert it into the mod's icon folder under `track`. */
  | { type: "customIcon"; track: string }
  /** Decode game assets (a trait icon, the track frame) into webview URLs. */
  | CreatorImagesRequest
  /**
   * Resolve loc keys the app found in the script itself: a perk's effect prose
   * lives in `custom_description_no_bullet = { text = <key> }` and the tooltip
   * has to print the sentence, not the key.
   */
  | { type: "loc"; keys: string[] }
  /** Put the generated script on the clipboard (a webview cannot reach it). */
  | { type: "copy"; text: string }
  /**
   * The modder clicked one of the two save-target lines. A legacy is two files
   * (the track's and the perks'), so which one is being changed travels with it.
   */
  | { type: "changeTarget"; which: TargetKind }
  /**
   * Hand back the `effect` block of an existing perk, so a new perk can start
   * from what the game itself writes.
   */
  | { type: "perkEffect"; name: string }
  | {
      type: "save";
      track: SaveDefinition;
      perks: SaveDefinition[];
      dropped: DroppedPerk[];
      /**
       * The icon the modder picked from the grid, when it is not already the
       * track's own picture: the host copies it to <iconFolder>/<track>.dds.
       */
      icon: string | null;
    };

export type HostToApp =
  | { type: "init"; init: CreatorInit }
  | {
      type: "loaded";
      track: DefinitionForm;
      perks: LoadedPerk[];
      /** The loc the workspace already has for those keys, so the form shows it. */
      loc: Record<string, string>;
    }
  /** The icon folder was written into; `select` is the key to show as chosen. */
  | { type: "icons"; icons: IconEntry[]; select?: string }
  | CreatorImagesReply
  /** One entry per key the app asked for; a key with no loc is simply absent. */
  | { type: "locValues"; values: Record<string, string> }
  /**
   * Where each of the two files a save writes will land, resolved without
   * asking, so the top bar can SHOW it from the moment the form loads. Null =
   * there is no mod to write that file into.
   */
  | { type: "targets"; track: CreatorSaveTarget | null; perks: CreatorSaveTarget | null }
  /**
   * The block of the perk the modder picked as a template, verbatim, or null
   * when nothing is indexed under that name. The app takes the key it wants.
   */
  | { type: "perkEffect"; name: string; block: string | null }
  | { type: "saved" }
  | { type: "toast"; message: string; variant?: "default" | "destructive" };
