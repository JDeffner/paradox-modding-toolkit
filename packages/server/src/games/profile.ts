/**
 * The GameProfile boundary (docs/PLAN.md §3): everything game-specific lives
 * behind this interface, in one module per game under games/. The engine and
 * features never name a game, they read the active profile (games/active.ts)
 * or the SchemaData built from it (schema/loader.ts).
 *
 * CI enforces the boundary: outside packages/server/src/games/ and
 * packages/vscode/, game-name strings may not appear in source
 * (scripts/check-game-boundary.mjs).
 */
import type { CalendarLocSpec } from "@px-lsp/protocol/calendarLoc";
import type { DefRootKey, RefField, SchemaEntry, StructureSpec } from "../schema/types";
import type { PlaceholderSpec } from "../data/modifierTemplates";
import type { GuiLayoutQuirks, GuiTextMetrics } from "../gui/layoutEngine";
import type { SaveSchema } from "../gui/saveSchema";

/**
 * One "New Content" template: the content of a scaffold, as data, so the writer
 * (packages/vscode/src/scaffold/) stays game-neutral. Every text field expands
 * four placeholders: `$PREFIX$` (the mod prefix), `$NAME$` (the key or event id
 * the user gave), `$KEY$` (`$NAME$` with dots turned into underscores, for
 * games whose loc keys cannot carry a dot) and `$LANG$` (the loc language).
 *
 * Every template must be written from the game's OWN vanilla files: a scaffold
 * that names a key the game does not know is exactly the silent failure this
 * command exists to prevent.
 */
export interface ScaffoldTemplate {
  /** Stable kind id, also the quick-pick value ("event", "on_action"). */
  id: string;
  /** Quick-pick label including its codicon ("$(zap) Event"). */
  label: string;
  /** Quick-pick detail: where the content lands. */
  detail: string;
  /** Word for the name prompt ("event id", "decision"). */
  nameLabel: string;
  /** Shape `$NAME$` must have: a plain identifier or a `<prefix>.<number>` id. */
  nameKind: "identifier" | "eventId";
  /**
   * Fixed choices for `$NAME$` (the vanilla on_action names to hook), offered
   * as a quick-pick with a free-text escape instead of a bare input box.
   */
  picks?: string[];
  /** Script file, mod-relative with forward slashes. */
  scriptPath: string;
  /** The block written, and appended when the file already exists. */
  block: string;
  /** The (expanded) line inside `block` the cursor lands on. */
  cursorMarker: string;
  /** Line the script file MUST start with (the event namespace). */
  requiredHeader?: string;
  /** Loc file, when the content type needs loc keys. */
  locPath?: string;
  /** Loc entry lines (without the `l_<lang>:` header). */
  locBody?: string;
}

/**
 * Data-only identity and conventions of a supported game. Kept separate from
 * the knowledge tables so clients (the VSCode extension) can import a game's
 * meta without pulling the bundled schema/data into their bundle.
 */
export interface GameMeta {
  /** Stable id used on the wire (settings.gameId) and for data/<id>/ bundles. */
  id: string;
  /** Full display name ("Crusader Kings III"). */
  name: string;
  /** Short user-facing prefix for progress titles and messages ("CK3"). */
  shortName: string;
  engine: "jomini" | "clausewitz-classic";
  /** Mod descriptor convention: Paradox-launcher `.mod` file vs `.metadata/metadata.json`. */
  descriptor: "mod" | "metadata";
  /** Per-workspace config dir holding schema.json / playset.json overlays. */
  configDirName: string;
  /** Game folder under `Documents/Paradox Interactive/` (script_docs logs live in its logs/). */
  docsFolderName: string;
  /**
   * Subfolder of docsFolderName holding the script_docs dumps. Absent =
   * "logs" (the classic location); newer titles may write to "docs".
   */
  scriptDocsSubdir?: string;
  /**
   * Console command that dumps the data-type documentation. Absent =
   * "DumpDataTypes" (CK3's casing); newer Jomini titles use snake_case.
   * The dump lands under `<Documents>/<docsFolderName>/logs/` regardless of
   * where script_docs go.
   */
  dataTypesCommand?: string;
  steamAppId: number;
  /** Whether event files declare `namespace = x` and use `ns.N` event ids. */
  eventNamespaces: boolean;
  /**
   * Subfolder of docsFolderName the ENGINE writes error.log into. Absent =
   * "logs", which is where both live installs checked (2026-08-12) write it.
   * Independent of scriptDocsSubdir, which newer titles point at docs/.
   */
  errorLogSubdir?: string;
  /**
   * The game's default UI font file, relative to the game data dir, embedded by
   * the GUI editor so its canvas text looks like the game's. Absent = no font
   * is embedded and the webview falls back to a system serif.
   */
  uiFont?: string;
  /**
   * In-game-measured text metrics for the game's default GUI font, feeding the
   * layout engine's text measurer and the editor canvas. Absent = the game is
   * NOT calibrated: the engine assumes the default table
   * (gui/measuredMetrics.ts) and the GUI editor refuses to open. Measured via
   * docs/gui-designer/probes/.
   */
  guiTextMetrics?: GuiTextMetrics;
  /**
   * "New Content" templates offered for this game, in quick-pick order. Absent
   * or empty = no content type has been verified against the game's own files,
   * and the command says so instead of writing a guess.
   */
  scaffolds?: ScaffoldTemplate[];
  /**
   * Load-stage folders at the mod root under which all content lives (EU5's
   * `in_game/` etc.). Schema paths carry the prefix explicitly; this list is
   * for mod detection. Absent = content sits directly at the mod root.
   */
  stageRoots?: string[];
  /**
   * The game composes flags from `common/coat_of_arms` definitions over
   * `gfx/coat_of_arms/{patterns,colored_emblems,textured_emblems}` textures,
   * in the layout the flag builder renders. Absent = the Flag Builder does
   * not open for this game.
   */
  flagBuilder?: boolean;
  /**
   * Database entry-mode prefixes legal on top-level definition keys
   * (EU5's `REPLACE:key`). The indexer strips a leading `<MODE>:` before
   * treating the rest as the definition name. Absent = no such syntax.
   */
  entryModes?: string[];
  /**
   * script_docs dump dialect. Absent = the classic plain-text format
   * (`name - doc` entries with `----` separators). Newer Jomini titles emit
   * markdown (`## name`, `**Supported Scopes**`) and per-game modifier shapes:
   * "masked-block" (`tag:` + indented Mask/Name/Description) or "tag-line"
   * (`Tag: name, Categories: ...` lines).
   */
  scriptDocs?: { format: "classic" | "markdown"; modifiers: "classic" | "masked-block" | "tag-line" };
  /** External deep-validation tool (the tiger family), when one exists. */
  tiger?: { binaryName: string; repoSlug: string; confName: string };
  /**
   * The loc keys the game formats dates through, for generating a
   * `px.calendar` display calendar's game-side localization. Only for games
   * whose keys were verified in the game files/binary; absent = the
   * Generate Calendar Localization command is not offered.
   */
  calendarLoc?: CalendarLocSpec;
  /**
   * Game-specific launch presets offered as run configurations (and panel
   * rows), beyond the family-wide `-debug_mode -develop` default and the
   * vanilla no-options launch. Every flag must be verified in the game's own
   * binary; absent = only the shared presets are offered.
   */
  launchPresets?: { id: string; label: string; args: string[] }[];
  /**
   * Suffix for server-side cache filenames under storageDir ("" keeps the
   * pre-profile names so existing caches survive; non-empty for later games,
   * e.g. "-vic3", so games sharing one storageDir never collide).
   */
  cacheSuffix: string;
}

/** A game's full knowledge bundle: meta plus the tables the engine consumes. */
export interface GameProfile extends GameMeta {
  /** Folder→definition-kind table (see schema/types.ts). */
  schema: SchemaEntry[];
  /** Assignment keys whose values reference other definitions. */
  refFields: RefField[];
  /** Scalar-value prefixes that reference definitions (`culture:czech`). */
  prefixRefs: Record<string, string[]>;
  /** Block-local ref fields (outer key → inner key → kinds). */
  blockRefFields: Record<string, Record<string, string[]>>;
  /** Hover provenance labels per definition kind (`_*.info` folder names). */
  structureSources: Record<string, string>;
  /**
   * Block-schema `structure` layer per definition kind, attached to the matching
   * schema entries at load (schema/loader.ts). A game whose schema table already
   * carries `structure` on its entries (a hand-curated layer) needs nothing here;
   * those entries always win.
   */
  structures?: Record<string, StructureSpec>;
  /**
   * Definition kinds that declare their own root scope in their body, keyed by
   * kind (scopes/inference.ts). Absent = every kind's root scope comes from the
   * schema table alone.
   */
  defRootKeys?: Record<string, DefRootKey>;
  /** Templated-modifier placeholder table (data/modifierTemplates.ts). */
  modifierPlaceholders: Record<string, PlaceholderSpec>;
  /**
   * Bundled `[ ... ]` data-function tables (data/<id>/dataTypes.json), when the
   * game ships one. Shape is data/dataTypes.ts's bundled-JSON shape; typed
   * loosely here to keep profiles JSON-import-friendly.
   */
  bundledDataTypes?: unknown;
  /** Bundled .gui widget schema (data/<id>/guiSchema.json), when available. */
  guiSchema?: unknown;
  /**
   * In-game-measured layout rule divergences from the engine's defaults
   * (which are themselves in-game-measured for the default profile). Each
   * flag documents its probe in gui/layoutEngine.ts's GuiLayoutQuirks.
   */
  guiLayoutQuirks?: GuiLayoutQuirks;
  /**
   * How this game's save games are read for GUI preview values: the entity
   * mapping, the meta keys and the shape the streaming reader must expect
   * (gui/saveSchema.ts). Absent = a save answers the meta-only default rows.
   */
  saveSchema?: SaveSchema;
  /** Trailing provenance note on bundled-wiki token hovers. */
  wikiNote: string;
  /** LSP diagnostic `source` label ("ck3-script"). */
  diagnosticSource: string;
}
