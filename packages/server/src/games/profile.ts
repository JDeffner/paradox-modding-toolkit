/**
 * The GameProfile boundary (docs/PLAN.md §3): everything game-specific lives
 * behind this interface, in one module per game under games/. The engine and
 * features never name a game — they read the active profile (games/active.ts)
 * or the SchemaData built from it (schema/loader.ts).
 *
 * CI enforces the boundary: outside packages/server/src/games/ and
 * packages/vscode/, game-name strings may not appear in source
 * (scripts/check-game-boundary.mjs).
 */
import type { RefField, SchemaEntry } from "../schema/types";
import type { PlaceholderSpec } from "../data/modifierTemplates";

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
  steamAppId: number;
  /** Whether event files declare `namespace = x` and use `ns.N` event ids. */
  eventNamespaces: boolean;
  /**
   * Load-stage folders at the mod root under which all content lives (EU5's
   * `in_game/` etc.). Schema paths carry the prefix explicitly; this list is
   * for mod detection. Absent = content sits directly at the mod root.
   */
  stageRoots?: string[];
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
  /** Trailing provenance note on bundled-wiki token hovers. */
  wikiNote: string;
  /** LSP diagnostic `source` label ("ck3-script"). */
  diagnosticSource: string;
}
