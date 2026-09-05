/**
 * The wire between the Dynasty Tree host (panel.ts) and its app (app/main.ts).
 *
 * The app draws the tree and fills the forms; it never reads a file, never
 * calls the language server and never generates script. It sends a filled form
 * and the host turns it into a block, picks the file and applies the edit.
 */
import type {
  DynastyCharacter,
  DynastyHouse,
  DynastySummary,
  EventVocabularyItem,
  ModifierFormat,
} from "@px-lsp/protocol/protocol";
import type { CalendarSetting } from "@px-lsp/protocol/calendar";
import type { CreatorSaveTarget } from "../shared/creatorMessages";
import type { PreviewInput } from "../traitCreator/app/preview";
/** The forms the app fills in and blocks.ts turns into script. */
export interface CharacterForm {
  id: string;
  name: string;
  female: boolean;
  /** A character carries its house or its dynasty, not both. */
  dynasty?: string;
  house?: string;
  father?: string;
  mother?: string;
  culture?: string;
  religion?: string;
  /** `Y.M.D`; the date of the block that carries `birth = yes`. */
  birth?: string;
  death?: string;
  /** `dna = `, the portrait DNA name, without quotes. */
  dna?: string;
  /** Skill key -> value, for the keys the modder gave a number. */
  skills?: Record<string, number>;
  traits: string[];
  /** Spouse ids. */
  spouses: string[];
  /** Date written for a spouse the previous block did not already marry. */
  marriageDate?: string;
}

export interface DynastyForm {
  id: string;
  /** The loc key (`dynn_Foo`); its text is written through writeLocSmart. */
  nameKey: string;
  culture?: string;
}

export interface HouseForm {
  id: string;
  nameKey: string;
  dynasty: string;
}

/** A mod the panel can write into. */
export interface ModTarget {
  label: string;
  path: string;
}

/**
 * Value sets for the culture, faith and trait pickers. Resolved by the host
 * through `paradox/eventValueOptions`, which answers the set a VALUE belongs
 * to, so each set is seeded with a value the tree already contains. A set the
 * server could not seed is empty and its field stays a plain text input.
 */
export interface OptionSets {
  culture: EventVocabularyItem[];
  religion: EventVocabularyItem[];
  trait: EventVocabularyItem[];
}

/** Everything the app needs about one dynasty. */
export interface TreeData {
  dynasty: DynastySummary;
  houses: DynastyHouse[];
  characters: DynastyCharacter[];
  nextCharacterId: string;
}

/**
 * What the game's own tooltip for one trait needs, resolved by the host: the
 * player's words, the picture, and the trait's modifier rows. `renderTraitTip`
 * (traitCreator/app/preview.ts) turns it into the tooltip itself.
 */
export interface TraitTip {
  tip: PreviewInput;
  /** The game's print rules for the modifier names this tip carries. */
  formats: Record<string, ModifierFormat>;
  /** Texture path -> URL, for the texticons those rules name. */
  images: Record<string, string | null>;
}

/**
 * What a trait's PICKER ROW shows besides its name: the first few things the
 * trait does, read out of the trait's own block by the host and printed by
 * shared/modifierLines.ts through the same rules the tooltip uses.
 */
export interface TraitStats {
  /** The trait's first modifier rows, already cut to what a row shows. */
  modifiers: PreviewInput["modifiers"];
  formats: Record<string, ModifierFormat>;
  images: Record<string, string | null>;
  /** True when a workspace mod, not the game, defines this trait. */
  mod: boolean;
}

export type HostToApp =
  | {
      type: "init";
      gameName: string;
      mods: ModTarget[];
      /** The mod's calendar (calendar.json, else `px.calendar`), when there is one: how a date READS. */
      calendar?: CalendarSetting;
      /** Set when the workspace cannot be written to yet; the app says so. */
      setupProblem?: string;
    }
  /** One trait picture per requested key; `null` = no file resolved. */
  | { type: "traitIcons"; urls: Record<string, string | null> }
  /** The tooltip for one trait, or null when the server does not know it. */
  | { type: "traitTip"; name: string; tip: TraitTip | null }
  /** What each requested trait does, for its picker row; null = nothing read. */
  | { type: "traitStats"; rows: Record<string, TraitStats | null> }
  /** How far back and forward the panel's own write journal can go. */
  | { type: "journal"; undo: number; redo: number }
  /** A write landed: the inspector says so, instead of the file opening itself. */
  | { type: "saved"; name: string; file: string; line: number }
  /** Where the next character save lands (saveTarget.ts). */
  | { type: "target"; target: CreatorSaveTarget | null }
  /** The clipboard's text, for the field that asked for it. */
  | { type: "pasted"; field: "dna"; text: string }
  | { type: "loading"; what: string }
  | {
      type: "list";
      /** False when the active game's profile has no `dynasty` kind at all. */
      supported: boolean;
      dynasties: DynastySummary[];
      nextDynastyId: string;
      nextCharacterId: string;
      /** Wall clock of the server request, shown as the honest cost. */
      ms: number;
    }
  | { type: "tree"; tree: TreeData; ms: number }
  | { type: "options"; sets: OptionSets }
  | { type: "toast"; message: string; variant?: "default" | "destructive" }
  | { type: "error"; message: string };

export type AppToHost =
  | { type: "ready" }
  /** (Re)load the dynasty picker list. */
  | { type: "list" }
  | { type: "open"; dynasty: string }
  /** Open a file in the editor beside the panel. */
  | { type: "reveal"; file: string; line: number }
  /** Write a character. `file` = the file it already lives in (edit). */
  | { type: "saveCharacter"; form: CharacterForm; file?: string }
  /** Write a dynasty plus its name loc; `openTree` reloads onto it after. */
  | { type: "saveDynasty"; form: DynastyForm; name: string; file?: string; openTree: boolean }
  | { type: "saveHouse"; form: HouseForm; name: string; file?: string }
  /** Hand a dynasty id or house key to the Flag Builder. */
  | { type: "coa"; name: string }
  /** Pictures for the trait rows that are on screen; batched by the app. */
  | { type: "traitIcons"; names: string[] }
  /** The game's tooltip for one trait; answered once per name per panel. */
  | { type: "traitTip"; name: string }
  /** What the trait rows on screen do; batched by the app like the pictures. */
  | { type: "traitStats"; names: string[] }
  /** Put the panel's last write back, or make it again. */
  | { type: "undo" }
  | { type: "redo" }
  /** Open the `common/dna_data` block this DNA name refers to. */
  | { type: "dnaOpen"; key: string }
  /** Copy that block's whole text, so it can be pasted into another mod. */
  | { type: "dnaCopy"; key: string }
  /**
   * Take a DNA off the clipboard: a whole block or a bare `portrait_info` is
   * written into the mod's own `common/dna_data`, under a key derived from
   * `character` when the clipboard carries none. A bare name is just taken.
   */
  | { type: "dnaPaste"; character: string }
  /** Recompute the save target: `file` = the file the draft already lives in. */
  | { type: "target"; file?: string }
  /** The target line was clicked: open the picker. */
  | { type: "changeTarget" };
