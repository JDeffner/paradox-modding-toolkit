/**
 * Custom LSP protocol between client and server: method names and payload
 * shapes. Everything crossing the process boundary is declared here so both
 * sides compile against one source of truth. docs/PROTOCOL.md documents the
 * contract for non-VSCode clients; treat changes here as API changes.
 *
 * No `vscode` / `vscode-languageserver` imports: plain wire types only.
 */
// Referenced only from the {@link IndexStats} doc link below, which ESLint's
// unused-vars analysis does not see.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { IndexStats } from "./types";

/** Resolved extension settings, computed client-side (path validation, Steam
 * detection fallbacks, workspace-folder default) and pushed to the server. */
export interface ParadoxSettings {
  /** Game profile id; absent/unknown ids fall back to the server's default
   * game. Detected client-side per workspace (descriptor file, else setting). */
  gameId?: string;
  gamePath: string | null;
  logsPath: string | null;
  modPath: string | null;
  /** Parent/dependency mod roots (load order, base first) indexed as source "parent"
   * — the submod / compatibility-patch workflow. */
  parentPaths: string[];
  /** Workspace mod roots (subset of parentPaths): mods the user is EDITING in
   * this workspace, so they get the mod treatment — reference indexing and
   * reference diagnostics — on top of the parent definition scan. */
  workspaceMods?: string[];
  locLanguage: string;
  /** Show inferred scope after scope-changing block openers (off by default). */
  scopeInlayHints: boolean;
  /** Our diagnostic codes to suppress everywhere. */
  diagnosticsIgnore: string[];
  /** Glob patterns (workspace-relative paths) whose diagnostics are suppressed. */
  diagnosticsIgnorePatterns: string[];
  /** When false (default) mod-only: never diagnose files under the game path. */
  diagnosticsVanilla: boolean;
}

/**
 * What the connected client can do beyond plain LSP. Every capability is
 * independent and off by default, so a bare client gets the degraded shape
 * without declaring anything and a rich client opts in to exactly the parts
 * it implements.
 */
export interface ParadoxClientCapabilities {
  /**
   * The client renders the sanitized `<span style="color:var(--vscode-*)">`
   * markup in hover markdown (VSCode theme variables). Default false: hover
   * cards are plain markdown, with the same content.
   */
  hoverHtml?: boolean;
  /**
   * The command ids the client registers, from {@link clientCommands}. The
   * server emits `command:` links and command-carrying code actions ONLY for
   * ids listed here; for the rest it falls back to plain text or a real
   * WorkspaceEdit. Default: none.
   */
  commands?: string[];
  /**
   * The client watches the mod tree itself and pushes
   * {@link modFileChangedNotification}. The server then does NOT register its
   * own `workspace/didChangeWatchedFiles` watcher. Default false: the server
   * registers one whenever the client supports dynamic registration.
   */
  ownFileWatcher?: boolean;
}

/** initializationOptions passed at LanguageClient start. All fields optional:
 * the server has fail-soft fallbacks for bare clients. */
export interface ParadoxInitOptions {
  /** Server-side cache directory (the extension's global storage path). */
  storageDir?: string;
  /** What this client can do; see {@link ParadoxClientCapabilities}. Absent
   * fields default to off (the plain-LSP-client shape). */
  client?: ParadoxClientCapabilities;
  /**
   * @deprecated Send {@link ParadoxInitOptions.client} instead. `true` is an
   * alias for `{ hoverHtml: true, commands: <every id in clientCommands>,
   * ownFileWatcher: true }` (what the VSCode extension declared before the
   * capabilities object existed); false/absent means all-off. Ignored when
   * `client` is present.
   */
  clientCommands?: boolean;
  /**
   * Root holding the bundled per-game data directories: the server reads
   * `<dataDir>/<gameId>/wikidocs/` and `<dataDir>/<gameId>/freqs.json`.
   * Normally omitted: the server uses `data/` next to its own bundle. Set it
   * when the data ships apart from the server bundle (an embedder unpacking
   * both separately). Re-resolved against the new `gameId` whenever the game
   * changes, so it stays profile-correct.
   */
  dataDir?: string;
  /**
   * @deprecated Send {@link ParadoxInitOptions.dataDir} instead. Overrides the
   * wikidocs/ folder ALONE — freqs.json still comes from `dataDir`/the bundle —
   * and, being one fixed folder, it does NOT follow a `gameId` change.
   */
  wikidocsDir?: string;
  settings?: ParadoxSettings;
}

// ---- client command ids ----------------------------------------------------

/**
 * Client commands the server references in code actions and hover links (part
 * of the wire contract: a client that implements one must register exactly
 * this id and list it in {@link ParadoxClientCapabilities.commands}). They
 * carry the "px." prefix: these are public extension command ids with shipped
 * default keybindings. The prefix was renamed in the Paradox Toolkit rebrand
 * and no fallback to the old ids is registered.
 */
export const clientCommands = {
  editLocalization: "px.editLocalization",
  openLocalizationSideBySide: "px.openLocalizationSideBySide",
  showReferences: "px.showReferences",
} as const;

/** Every id in {@link clientCommands}: what a fully capable client registers. */
export const allClientCommandIds: string[] = Object.values(clientCommands);

// ---- client -> server ------------------------------------------------------

/** Notification: settings changed; payload {@link ParadoxSettings}. */
export const configChangedNotification = "paradox/configChanged";

/** Notification: a mod file changed on disk; payload {@link ModFileChangeParams}. */
export const modFileChangedNotification = "paradox/modFileChanged";
export interface ModFileChangeParams {
  /** Absolute filesystem path (not a URI). */
  fsPath: string;
}

/** Request: re-parse script_docs logs; payload {@link ReloadDocsParams} -> {@link ReloadDocsResult}. */
export const reloadDocsRequest = "paradox/reloadDocs";
export interface ReloadDocsParams {
  force: boolean;
}
export interface ReloadDocsResult {
  tokens: number;
}

/** Request: index statistics; no payload -> {@link IndexStats}. */
export const indexStatsRequest = "paradox/indexStats";

/** Request: look up localization entries for a key; {@link LookupLocParams} -> {@link LocEntryInfo}[].
 * Mod entries shadow vanilla ones (the full list is returned, mod first). */
export const lookupLocRequest = "paradox/lookupLoc";
export interface LookupLocParams {
  key: string;
}
export interface LocEntryInfo {
  file: string;
  /** 0-based. */
  line: number;
  source: "vanilla" | "parent" | "mod";
  value?: string;
}

// ---- server -> client ------------------------------------------------------

/** Notification: data health for the status bar; payload {@link StatusPayload}. */
export const statusNotification = "paradox/status";
export interface StatusPayload {
  tokens: number;
  tokensFromScriptDocs: boolean;
  definitions: number;
  /** True while a (re)scan is running. */
  indexing: boolean;
}

/** Notification: the definition index changed (debounced server-side); no payload.
 * Overview views re-query on this signal. */
export const indexChangedNotification = "paradox/indexChanged";

// ---- overview suite (Phase 4) ------------------------------------------------

/** Shared param for the mod-scoped overview requests: restrict the result to
 * one workspace mod (absolute root path). Absent/null = all workspace mods. */
export interface ModScopedParams {
  modRoot?: string | null;
}

/** Request: mod content inventory; {@link ModScopedParams} -> {@link ModOverview}. */
export const modOverviewRequest = "paradox/modOverview";
export interface OverviewDef {
  name: string;
  file: string;
  line: number;
}
export interface OverviewKind {
  kind: string;
  count: number;
  /** Capped list (first N alphabetically); `count` is the real total. */
  defs: OverviewDef[];
}
export interface ModOverview {
  kinds: OverviewKind[];
  totalDefs: number;
  totalRefs: number;
}

/** Request: localization coverage; {@link ModScopedParams} -> {@link LocCoverage}[]. */
export const locCoverageRequest = "paradox/locCoverage";
export interface LocIssue {
  key: string;
  file?: string;
  /** 0-based. */
  line?: number;
  /** For untranslated: the source-language text. */
  value?: string;
}
export interface LocCoverage {
  language: string;
  defined: number;
  /** Referenced by mod script / required by schema but not defined anywhere. */
  missing: LocIssue[];
  /** Defined in the mod but never referenced and not overriding vanilla. */
  orphaned: LocIssue[];
  /** Value identical to the source language (only for non-source languages). */
  untranslated: LocIssue[];
}

/** Request: override/conflict map; {@link ModScopedParams} -> {@link OverrideInfo}[]. */
export const overridesRequest = "paradox/overrides";
export interface OverrideSite {
  source: "vanilla" | "parent" | "mod";
  /** Display label: the owning mod's descriptor name when known, else `source`. */
  label?: string;
  file: string;
  line: number;
}
export interface OverrideInfo {
  name: string;
  kind: string;
  mod: OverrideSite;
  shadowed: OverrideSite[];
  /** Folder rule: script is last-in-wins, GUI is first-in-wins. */
  rule: "LIOS" | "FIOS";
  winner: "mod" | "other";
  note?: string;
}

/** Request: full event detail for the graph inspector; {@link EventDetailParams} -> {@link EventDetail} | null. */
export const eventDetailRequest = "paradox/eventDetail";
export interface EventDetailParams {
  id: string;
}
/** A localizable field: key, resolved text, and (for mod entries) the editable site. */
export interface EventLocField {
  key: string;
  text?: string;
  /** Present only when the entry lives in the mod (in-place editable). */
  file?: string;
  line?: number;
  /** The value comes from a dynamic block (first_valid / triggered_desc), not a plain key. */
  dynamic?: boolean;
}
/**
 * One flattened line of a rendered block: enough to print an event's logic
 * back as readable pseudo-script without the client re-parsing anything.
 */
export interface EventScriptLine {
  /** Nesting depth inside the rendered block (0 = a direct child). */
  depth: number;
  /** The statement without indentation: `key = value`, `key = {`, `}`, or a bare scalar. */
  text: string;
  /** 0-based source line. */
  line: number;
}

/**
 * A reference inside a block that hands control to another event or on_action:
 * the step-into edge of an event walkthrough. Collected from the schema's
 * event/on_action reference fields (`trigger_event`, `on_action`, `events`,
 * `random_events`, …), so a game profile that names them differently is
 * covered without a hard-coded key list.
 */
export interface EventStepTarget {
  /** The key that produced the reference (`trigger_event`, `on_action`, …). */
  via: string;
  /** Referenced event id / on_action name, exactly as written. */
  name: string;
  /** What the index says `name` is. "unknown" = not indexed; say so, do not guess. */
  kind: "event" | "on_action" | "unknown";
  /** 0-based line of the reference, in the file that contains it (for a
   * {@link EventStepTarget.fires} entry that is the on_action's own file). */
  line: number;
  /** Definition site, when the name is indexed. */
  file?: string;
  defLine?: number;
  /** Definition sites of that kind, when more than one. on_actions merge
   * across files (a mod extending a vanilla on_action), so `fires` reflects
   * only the site at {@link EventStepTarget.file}. */
  defCount?: number;
  /**
   * on_action targets only: what that on_action itself fires, read from its own
   * definition. Empty when the definition names nothing. Absent when there was
   * nothing to read: the name is not an indexed on_action, its file could not
   * be parsed, or this target already IS one level deep (resolution stops
   * there, so a self-chaining pair cannot recurse).
   */
  fires?: EventStepTarget[];
  /** Real target count before `fires` was capped. */
  firesTotal?: number;
}

export interface EventSectionInfo {
  name: string;
  /** 0-based line of the section key. */
  line: number;
  /** Top-level keys inside the section (capped). */
  keys: string[];
  /** The section rendered as pseudo-script, capped (`totalLines` is the truth). */
  lines: EventScriptLine[];
  totalLines: number;
  /** Events / on_actions this section hands control to, capped. */
  targets: EventStepTarget[];
  /** Real target count before `targets` was capped. */
  targetsTotal: number;
}
export interface EventOptionInfo {
  line: number;
  name?: EventLocField;
  effectKeys: string[];
  hasTrigger: boolean;
  hasAiChance: boolean;
  /** The option's effects rendered as pseudo-script (name/trigger/ai_chance/
   * ai_value dropped: they gate the option, they are not its effect), capped. */
  lines: EventScriptLine[];
  totalLines: number;
  /** Events / on_actions this option hands control to, capped. */
  targets: EventStepTarget[];
  /** Real target count before `targets` was capped. */
  targetsTotal: number;
}
export interface EventRefInfo {
  name: string;
  kind: "saved_scope" | "variable" | "scripted_effect" | "scripted_trigger" | "script_value" | "event";
  /** First use inside the event, 0-based. */
  line: number;
  defFile?: string;
  defLine?: number;
  /** Number of definition/save sites. */
  defCount?: number;
}
export interface EventDetail {
  id: string;
  file: string;
  line: number;
  /** Line of the event's closing brace (option-scaffold insertion point). */
  endLine: number;
  type?: string;
  hidden?: boolean;
  theme?: string;
  title?: EventLocField;
  desc?: EventLocField;
  sections: EventSectionInfo[];
  options: EventOptionInfo[];
  refs: EventRefInfo[];
}

/** Request: GUI widget tree for a .gui document; {@link GuiTreeParams} -> {@link GuiTree}. */
export const guiTreeRequest = "paradox/guiTree";
export interface GuiTreeParams {
  /** For display only; the text is authoritative. */
  uri: string;
  text: string;
}
export interface GuiTreeNode {
  /** Widget type or declaration header (window, flowcontainer, "template NAME"…). */
  key: string;
  /** name = "..." when present. */
  name?: string;
  /** For `type x = base { }` / tagged blocks: the base widget type. */
  base?: string;
  /** using = template references. */
  using?: string[];
  /** decl = template/types/type/blockoverride/block headers; state = animation states. */
  kind: "widget" | "state" | "decl";
  /** 0-based line of the key. */
  line: number;
  children: GuiTreeNode[];
}
export interface GuiTree {
  nodes: GuiTreeNode[];
  /** Total node count across all depths. */
  count: number;
}

/**
 * Request: rendered GUI layout for a .gui document;
 * {@link GuiLayoutParams} -> {@link GuiLayoutResult}. Rectangles come from
 * the measured layout engine (docs/gui-designer/calibration/spec.md), with
 * templates/types resolved against the vanilla + mod gui tree.
 */
export const guiLayoutRequest = "paradox/guiLayout";
export interface GuiLayoutParams {
  /** For display only; the text is authoritative. */
  uri: string;
  text: string;
}
export interface GuiLayoutFill {
  texture?: string;
  /** rgba 0..1, straight sRGB multiply (rendered = round(v*255)). */
  color?: [number, number, number, number];
  /**
   * Nine-slice border widths [left, top, right, bottom] in texture pixels
   * (from `spriteborder`/`spriteborder_<side>`). Present => draw corners
   * unscaled, stretch the edges; absent => stretch the whole texture.
   */
  border?: [number, number, number, number];
}
export interface GuiLayoutText {
  text: string;
  fontsize: number;
  offsetX: number;
  offsetY: number;
  lines: string[];
  color?: [number, number, number, number];
}
export interface GuiLayoutNode {
  key: string;
  name?: string;
  rect: { x: number; y: number; w: number; h: number };
  /** Scrollarea viewport: children are clipped to the rect. */
  clip: boolean;
  bg?: GuiLayoutFill;
  fill?: GuiLayoutFill;
  text?: GuiLayoutText;
  /** 0-based line of the instance statement in the requested document. */
  line?: number;
  /** Placed via anchor+position rules (position honored -> draggable). */
  positioned: boolean;
  /**
   * `line` is the widget's own statement in this document (safe to edit);
   * false for children spliced from type definitions.
   */
  editable: boolean;
  /** Raw `position = { x y }` source values, when present. */
  srcPosition?: [number, number];
  /** Raw `size = { w h }` source values, when present. */
  srcSize?: [number, number];
  /**
   * Placeholder copy of a datamodel item template (the list has no runtime
   * rows in a static preview). The renderer draws it at reduced opacity; it is
   * never editable. Presentation only, not a measured layout rule.
   */
  ghost?: boolean;
  children: GuiLayoutNode[];
}
export interface GuiLayoutResult {
  nodes: GuiLayoutNode[];
  /** Distinct texture paths referenced anywhere in the tree (mod-relative). */
  textures: string[];
  /** Total node count across all depths. */
  nodeCount: number;
  /** How many .gui files fed the template/type store (0 = no game path). */
  defsFiles: number;
}

/**
 * Request: text edit for a preview interaction (drag / property change);
 * {@link GuiWidgetEditParams} -> {@link GuiWidgetEditResult} (null when the
 * widget or property cannot be edited). The client applies the offsets via
 * WorkspaceEdit so undo and the live preview loop stay in the editor.
 */
export const guiWidgetEditRequest = "paradox/guiWidgetEdit";
export interface GuiWidgetEditParams {
  uri: string;
  /** Authoritative document text the offsets refer to. */
  text: string;
  /** 0-based line of the widget's instance statement (GuiLayoutNode.line). */
  line: number;
  /** Pair property to set. */
  property: "position" | "size";
  values: [number, number];
}
export interface GuiWidgetEditResult {
  /** UTF-16 offsets into the request text. */
  start: number;
  end: number;
  newText: string;
}

/** Request: event graph; {@link EventGraphParams} -> {@link EventGraph}. */
export const eventGraphRequest = "paradox/eventGraph";
export interface EventGraphParams {
  /** Focus definition (event id / on_action name); with namespace, either works. */
  root?: string;
  /** Restrict to an event namespace. */
  namespace?: string;
  /** Restrict to one workspace mod (absolute root path). */
  modRoot?: string | null;
  maxNodes?: number;
}
export interface EventGraphNode {
  id: string;
  kind: string;
  source: "vanilla" | "parent" | "mod";
  file?: string;
  line?: number;
  /** Localized title (best-effort: <id>.t / <id>_t / <id>.title lookups). */
  title?: string;
}
export interface EventGraphEdge {
  from: string;
  to: string;
  /** The referencing field (trigger_event, events, on_actions...). */
  via: string;
  /** Where in the source event the reference sits: an option's text, or immediate/after/… */
  label?: string;
}
export interface EventGraph {
  nodes: EventGraphNode[];
  edges: EventGraphEdge[];
  truncated: boolean;
}

/**
 * Request: dependency explorer for any indexed definition;
 * {@link DependenciesParams} -> {@link DependenciesResult}. Cursor-driven
 * (uri + position) or by name (optionally disambiguated by kind).
 */
export const dependenciesRequest = "paradox/dependencies";
export interface DependenciesParams {
  /** Resolve the definition under this cursor position. */
  uri?: string;
  position?: { line: number; character: number };
  /** Fallback: look the definition up by name (optionally by kind). */
  name?: string;
  kind?: string;
}
export interface DependencyDef {
  name: string;
  kind: string;
  file: string;
  /** 0-based. */
  line: number;
}
export interface DependencyItem {
  name: string;
  file: string;
  /** 0-based. */
  line: number;
}
export interface DependencyGroup {
  kind: string;
  items: DependencyItem[];
}
export interface DependenciesResult {
  /** The resolved definition, or null when nothing matches the cursor/name. */
  def: DependencyDef | null;
  /** Mod definitions/sites that reference `def` (mod files only; vanilla
   * references aren't indexed — AD-4). Grouped by the containing definition's
   * kind, else by file. */
  dependents: DependencyGroup[];
  /** Named definitions referenced inside `def`'s block, grouped by target kind. */
  dependencies: DependencyGroup[];
}

/**
 * Request: the inferred scope chain at a cursor position;
 * {@link ScopeAtParams} -> {@link ScopeAtResult} | null. Answers for OPEN
 * script documents only (the server reads the client's text, not the disk);
 * null means "not open / not a script document", which a status bar renders as
 * nothing rather than as an error.
 *
 * This is a read-out of the same inference completion, hover and inlay hints
 * run at a position: it ranks and annotates, never diagnoses, and never
 * asserts more than the derived link tables actually say.
 */
export const scopeAtRequest = "paradox/scopeAt";
export interface ScopeAtParams {
  uri: string;
  /** 0-based, as in LSP. */
  position: { line: number; character: number };
}

/** One resolved step of the walk from the root scope down to the cursor. */
export interface ScopeChainStep {
  /**
   * The key that produced the step: a link (`liege`), an iterator
   * (`every_vassal`), `root`/`prev`, a `scope:x` / `var:x` anchor, or a data
   * link abbreviated as `culture:…`. Absent on the FIRST step only, which is
   * the enclosing definition's root scope and comes from no key.
   */
  entryKeyword?: string;
  /** Scopes after this step; empty = unknown. */
  scopes: string[];
}

/** A saved scope visible in the document, with the type it resolves to. */
export interface SavedScopeInfo {
  name: string;
  /** Scopes the name resolves to; empty = unknown. */
  scopes: string[];
}

export interface ScopeAtResult {
  /**
   * Scopes at the position. A SET, not one name: a link or iterator with
   * several documented output scopes stays ambiguous instead of guessing, and
   * an EMPTY array means unknown, which is a first-class answer here. Render
   * several as `a|b` and none as "unknown".
   */
  scopes: string[];
  /** The walk, outermost (root) first, one entry per scope-changing step. */
  chain: ScopeChainStep[];
  /**
   * Saved scopes visible in the document, name-sorted: every `save_scope_as` /
   * `save_scope_value_as` site in the file plus the engine-provided ambient
   * scopes of its definition kind. NOT flow-sensitive — a save further down
   * the file is listed too, matching what completion and hover already offer.
   */
  savedScopes: SavedScopeInfo[];
}
