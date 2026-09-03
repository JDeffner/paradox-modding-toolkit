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
} from "@px-lsp/protocol/protocol";
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

export type HostToApp =
  | {
      type: "init";
      gameName: string;
      mods: ModTarget[];
      /** Set when the workspace cannot be written to yet; the app says so. */
      setupProblem?: string;
    }
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
  | { type: "coa"; name: string };
