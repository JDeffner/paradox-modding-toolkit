/**
 * The wire between the Culture Creator host (panel.ts) and its app
 * (app/main.ts). The app never touches the filesystem and never talks to the
 * language server: it asks for a culture to be loaded, or for the one it has
 * drawn to be written, and the host does both.
 */
import type { CalendarSetting } from "@px-lsp/protocol/calendar";
import type { DefinitionForm } from "@px-lsp/protocol/protocol";

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
  /** The mod a save goes into by default, for the toolbar's target. */
  saveMod: string | null;
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
  /** px.calendar, when the workspace configures one: `created` is checked against it. */
  calendar?: CalendarSetting;
  /** No mod folder in the workspace: nothing can be written yet. */
  noMod: boolean;
}

export type HostToApp =
  | { type: "init"; init: CultureInit }
  | { type: "loading" }
  /** The save landed; the app clears its "changed" marks. */
  | { type: "saved"; name: string }
  /** The save did not happen (cancelled at the file pick, or refused). */
  | { type: "idle" }
  | { type: "error"; message: string };

export type AppToHost =
  | { type: "ready" }
  /** Load this culture into the form (the mod's copy first, else the game's). */
  | { type: "load"; name: string }
  /** Open the Examples Wiki on a name the form shows. */
  | { type: "openExamples"; name: string }
  | {
      type: "save";
      name: string;
      mode: SaveMode;
      /** The whole `name = { … }` block, for create / duplicate / override. */
      block: string;
      /** Only the keys that changed, for an edit. */
      changed?: { key: string; value: string | null }[];
      loc: { key: string; value: string }[];
      /** Bare file name the culture was loaded from, offered first on the pick. */
      sourceFile?: string;
    };
