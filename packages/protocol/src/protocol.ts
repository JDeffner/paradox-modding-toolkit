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
   *, the submod / compatibility-patch workflow. */
  parentPaths: string[];
  /** Workspace mod roots (subset of parentPaths): mods the user is EDITING in
   * this workspace, so they get the mod treatment, reference indexing and
   * reference diagnostics, on top of the parent definition scan. */
  workspaceMods?: string[];
  locLanguage: string;
  /** Show inferred scope after scope-changing block openers (off by default). */
  scopeInlayHints: boolean;
  /**
   * How much a hover shows. `standard` applies every cap in the design;
   * `compact` drops prose and examples; `full` lifts the example cap and shows
   * every distinct meaning.
   */
  hoverDetail?: "compact" | "standard" | "full";
  /** Our diagnostic codes to suppress everywhere. */
  diagnosticsIgnore: string[];
  /** Glob patterns (workspace-relative paths) whose diagnostics are suppressed. */
  diagnosticsIgnorePatterns: string[];
  /** When false (default) mod-only: never diagnose files under the game path. */
  diagnosticsVanilla: boolean;
  /** `px.trace.perf`: wall clock for every request, rescan, index change and
   * scan phase into the output channel. Off by default (perf campaign §A2). */
  tracePerf?: boolean;
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
  /**
   * The client's hover renderer navigates `file:` links, so provenance lines
   * ("where is this defined") may be markdown links. Default false: the same
   * `file.txt:12` label is rendered as plain text, which reads correctly in a
   * client that would otherwise show a dead link.
   *
   * Note that `textDocument.completion.completionItem.snippetSupport` — the
   * other axis an embedder should declare — is a STANDARD LSP capability, not
   * one of these: send it in the initialize params, not here.
   */
  fileLinks?: boolean;
  /**
   * The client renders `$(codicon)` theme icons in hover markdown, i.e. it sets
   * `supportThemeIcons` on the MarkdownString. Default false, and the default
   * matters: a client without it prints the literal text `$(symbol-method)`,
   * which is worse than the plain `■` it would otherwise get. Implies
   * {@link ParadoxClientCapabilities.hoverHtml} is respected for colour.
   */
  hoverIcons?: boolean;
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
   * ownFileWatcher: true, fileLinks: true }` plus snippet support (what the
   * VSCode extension declared before the capabilities object existed);
   * false/absent means all-off. Ignored when `client` is present.
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
   * wikidocs/ folder ALONE, freqs.json still comes from `dataDir`/the bundle,
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
  /** True when the script_docs tokens came from the BUNDLED dump snapshot
   * (data/<gameId>/script_docs) rather than the user's own dump. */
  tokensFromBundledDumps?: boolean;
  definitions: number;
  /** Tokens the bundled wiki added that script_docs did not have. The wiki is
   * merged even when the user has their own dump, but its real contribution is
   * usage examples; the extra NAMES are mostly deprecated API. */
  tokensWikiOnly?: number;
  /** True while a (re)scan is running. */
  indexing: boolean;
}

/** Notification: the definition index changed (debounced server-side); no payload.
 * Overview views re-query on this signal. */
export const indexChangedNotification = "paradox/indexChanged";

/** Notification: a long-running server phase started or finished; payload
 * {@link ProgressPayload}. The status bar lists what is still loading, so a
 * cold workspace says which step it is on instead of looking idle. No
 * percentages: the phases are coarse and the client only shows their state. */
export const progressNotification = "paradox/progress";
export interface ProgressPayload {
  /** Stable phase id, so a "done" can find the "start" it belongs to. */
  phase: string;
  state: "start" | "done";
  /** Human-readable label for the phase, sent with "start". */
  detail?: string;
}

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

/**
 * A scalar `key = value` written directly in an event body or an option body,
 * with the line it sits on, so an editor can rewrite it in place instead of
 * re-parsing the file. Blocks are not fields: they are `sections` / `options`.
 */
export interface EventFieldInfo {
  key: string;
  value: string;
  /** 0-based source line. */
  line: number;
  /** The value was written in quotes and must be rewritten that way. */
  quoted?: boolean;
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
/** A gate block (trigger / ai_chance) rendered for in-place editing. */
export interface EventGateInfo {
  /** 0-based line of the block's key. */
  line: number;
  lines: EventScriptLine[];
  totalLines: number;
}
export interface EventOptionInfo {
  line: number;
  /** Line the option's first statement may be inserted before (0-based). */
  bodyLine: number;
  /** Scalar keys written in the option body, editable in place. */
  fields: EventFieldInfo[];
  name?: EventLocField;
  effectKeys: string[];
  hasTrigger: boolean;
  hasAiChance: boolean;
  /** The option's own trigger block, rendered, when it has one. */
  trigger?: EventGateInfo;
  /** The option's ai_chance block, rendered, when it has one. */
  aiChance?: EventGateInfo;
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
  /** Line a new top-level statement may be inserted before (0-based). */
  bodyLine: number;
  /** Scalar keys written at the event's top level, editable in place. */
  fields: EventFieldInfo[];
  type?: string;
  hidden?: boolean;
  theme?: string;
  title?: EventLocField;
  desc?: EventLocField;
  /** The event's third displayed string in the games whose events have one
   *  (top-level `flavor`); absent everywhere else. */
  flavor?: EventLocField;
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
 * the measured layout engine (docs/gui-designer/spec.md), with
 * templates/types resolved against the vanilla + mod gui tree.
 */
export const guiLayoutRequest = "paradox/guiLayout";
export interface GuiLayoutParams {
  /** For display only; the text is authoritative. */
  uri: string;
  text: string;
  /** Conditional-visibility preview mode; absent = `showAll`. */
  visibility?: GuiVisibilityOptions;
  /**
   * `resolve` (default): textbox keys show their localized value and
   * `[datafunctions]` their knowable text, and sizes follow. `raw`: the
   * `text =` value verbatim, as the file has it.
   */
  loc?: "resolve" | "raw";
  /** Modder-supplied preview text per `[...]` expression (the `.<game>modding/gui-preview-values.json` table). */
  previewValues?: Record<string, string>;
}

/**
 * How the layout treats a CONDITIONALLY visible widget, one whose `visible`
 * holds an expression a static preview cannot evaluate (`visible =
 * "[GetPlayer.IsAI]"`). A literal `visible = no` is deterministic and always
 * collapses; `visible = yes` always shows. Neither is a check.
 */
export type GuiVisibilityMode = "showAll" | "hideAll" | "evaluate";
export interface GuiVisibilityOptions {
  mode: GuiVisibilityMode;
  /**
   * `evaluate` only: per-check assignments. The KEY is the `visible` value
   * exactly as authored, minus its quotes (`[GetPlayer.IsAI]`). The source
   * string is the only identity a static preview has, so two widgets written
   * with the same condition share one toggle, and a key stays stable across
   * edits that do not touch the condition. A check with no assignment behaves
   * as `showAll` (shown).
   */
  checks?: Record<string, boolean>;
}
/** A conditional `visible` the layout met, for building a toggle UI. */
export interface GuiVisibilityCheck {
  /** The condition source string, the key {@link GuiVisibilityOptions.checks} takes. */
  key: string;
  /** Widgets carrying this condition in this document. */
  count: number;
  /** True when THIS run resolved the check to hidden. */
  hidden: boolean;
}
/** Server-side wall clock of one `paradox/guiLayout`, for a stats line. */
export interface GuiLayoutTimings {
  /** Parsing the document and collecting its own template/type declarations. */
  parseMs: number;
  /** Building the cross-file template/type store; 0 on a cache hit. */
  defsMs: number;
  /** Building the widget tree and arranging every rect. */
  layoutMs: number;
  /** The whole request, server side. */
  totalMs: number;
}
export interface GuiLayoutFill {
  texture?: string;
  /** rgba 0..1, straight sRGB multiply (rendered = round(v*255)). */
  color?: [number, number, number, number];
  /**
   * Nine-slice border widths [left, top, right, bottom] in texture pixels
   * (from `spriteborder`/`spriteborder_<side>`). The values as authored;
   * `mode` says whether they apply.
   */
  border?: [number, number, number, number];
  /**
   * How to draw the texture. Nine-slicing needs BOTH a `Cornered*` spriteType
   * AND a non-zero border; a border alone is ignored and the whole texture
   * stretches. `nineslice-*` = corners unscaled, edges and centre tiled or
   * stretched per the suffix; `tile` = repeat the whole texture.
   */
  mode?: "stretch" | "tile" | "nineslice-stretch" | "nineslice-tile";
  /** `framesize = { w h }` cell size when the texture is a frame sheet. */
  framesize?: [number, number];
  /** `alpha = x`: the fill's opacity, 0..1 (absent = 1). */
  alpha?: number;
  /**
   * `modify_texture` with `blend_mode = alphamultiply`: a texture whose alpha
   * multiplies the fill's, stretched over the rect. Listed in `textures` like
   * any other path. Other blend modes are not carried.
   */
  mask?: string;
  /** `fittype = centercrop`: cover the rect and crop to the centre instead of stretching. */
  fit?: "centercrop";
  /**
   * 1-based frame index into that sheet, row-major over the cols x rows grid
   * (cols = texW/w). Out-of-range values clamp to the first or last cell.
   */
  frame?: number;
}
/**
 * One piece of what a textbox shows. `loc`: a localization key the index
 * resolved (or not: `resolved` false shows the key itself). `datafn`: a
 * `[...]` expression; resolved through `Localize`/`Concept` or the modder's
 * preview values, else shown as its last chain segment with `resolved` false.
 * `source` is the key or the expression without brackets.
 */
export interface GuiTextSegment {
  text: string;
  kind: "literal" | "loc" | "datafn";
  source: string;
  resolved: boolean;
}
export interface GuiLayoutText {
  /** What is measured and drawn (resolved when the request asked for it). */
  text: string;
  /** The raw `text =` value; differs from `text` when something resolved. */
  raw?: string;
  segments?: GuiTextSegment[];
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
   * The widget's index among its parent body's REORDER SIBLINGS: exactly the
   * index a `reorder`, `insert` or `delete` op counts (see {@link GuiSourceOp}).
   * Those are the body's DECLARATIONS, which include the `blockoverride` /
   * `block` / `template` entries a preview never shows, so a client that ranks
   * the widgets it can see is off by one per intervening declaration.
   *
   * Absent whenever no index names the node: a template- or type-spliced child,
   * a datamodel ghost, the contents of a named slot, and a scrollarea's
   * pass-through children, whose ranks count a body their drawn parent does not
   * own. Absent means "not addressable by index"; do not fall back to counting.
   */
  srcIndex?: number;
  /**
   * Placeholder copy of a datamodel item template (the list has no runtime
   * rows in a static preview). The renderer draws it at reduced opacity; it is
   * never editable. Presentation only, not a measured layout rule.
   */
  ghost?: boolean;
  /**
   * The widget's `onclick` value as authored, minus its quotes, when it has
   * one. A static preview cannot run it; a client's interact mode reads the
   * `GetVariableSystem.*` calls out of it to drive the visibility checks, and
   * names the rest as what the game would run.
   */
  onclick?: string;
  /** The widget's `tooltip` value as authored (a loc key or a [datafunction]), when it has one. */
  tooltip?: string;
  /**
   * A root that is a `type name = base { }` DECLARATION laid out as one
   * instance of itself. Set only on roots, and only for a document that
   * instantiates nothing at top level, the shape whole panels are written in
   * by the games whose engine instantiates a window by name from code. The
   * declaration header is not editable; the children under it are ordinary
   * statements of the document and are.
   */
  declared?: boolean;
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
  /**
   * Every conditional `visible` the layout met, key-sorted. Reported in ALL
   * modes, `showAll` included, so a client can build the toggle UI before the
   * user has switched mode.
   */
  visibilityChecks: GuiVisibilityCheck[];
  /** Per-stage wall clock of this request. */
  timings: GuiLayoutTimings;
}

/**
 * Request: the properties of ONE widget, as the layout engine resolved them;
 * {@link GuiWidgetInfoParams} -> {@link GuiWidgetInfo}, null when the line
 * carries no widget of its own (a node spliced in from a template or a type has
 * no source here, the same answer `guiSourceEdit` refuses with).
 *
 * This is the designer inspector's READ side. It is a separate request rather
 * than a field on {@link GuiLayoutNode} because it is per-SELECTION data: a
 * vanilla window lays out 500+ widgets and carrying every widget's expanded
 * property list on every layout push would multiply the payload for rows one
 * widget at a time is ever shown.
 */
export const guiWidgetInfoRequest = "paradox/guiWidgetInfo";
export interface GuiWidgetInfoParams {
  /** For display only; the text is authoritative. */
  uri: string;
  text: string;
  /** 0-based line of the widget's own statement (`GuiLayoutNode.line`). */
  line: number;
  /**
   * Also answer "why is it here": run the layout with an explanation trace on
   * and return {@link GuiWidgetInfo.placement}. Off by default because it costs
   * a full layout of the document; the trace itself is what the flag gates, so
   * an ordinary `paradox/guiLayout` never pays for it.
   */
  placement?: boolean;
}
/** One step of the chain a property was spliced through. */
export interface GuiWidgetOrigin {
  kind: "type" | "template";
  /** The type or template name, as `expandWidget` resolved it. */
  name: string;
}
export interface GuiWidgetProperty {
  key: string;
  /**
   * The value as authored, rendered from the tokens: a quoted scalar keeps its
   * quotes, a block reads `{ a b }`. Blocks come from other files whose text
   * the store does not keep, so this is a rendering, not a byte copy.
   */
  value: string;
  /**
   * Definitions the entry was spliced through, INNERMOST first (`[template
   * PxDeco, type px_card]` = a template used inside a type). Empty means the
   * property is authored in the widget's own body, which is the only case
   * `setProperties` rewrites in place.
   */
  origin: GuiWidgetOrigin[];
  /**
   * The values this key SHADOWED, in expansion order (base-most first), so the
   * last entry is the one this row directly overrides. Present only when the
   * key was assigned more than once, which is exactly when the inspector can
   * say "this overrides `{ 100 50 }` from type px_card". Absent otherwise.
   */
  overrides?: GuiWidgetOverride[];
}
/** A value a later assignment of the same key replaced. */
export interface GuiWidgetOverride {
  /** Rendered the same way {@link GuiWidgetProperty.value} is. */
  value: string;
  /** Where the replaced value came from; empty = the widget's own body. */
  origin: GuiWidgetOrigin[];
}

/**
 * One contribution to a widget's final origin, in engine order. The `dx`/`dy`
 * of the terms sum to the rect's `x`/`y` exactly (see spec.md B1-B/C/D:
 * `x = parent.x + parentanchor.fx*parent.w - widgetanchor.fx*w + position.x`).
 */
export interface GuiPlacementTerm {
  kind: "parentOrigin" | "parentanchor" | "widgetanchor" | "position";
  /**
   * The authored spec behind the term (`bottom|right`, `{ -30 -30 }`). Absent
   * on `parentOrigin`, which is the parent's rect rather than a property, and
   * on a `widgetanchor` that was never written (it mirrors `parentanchor`,
   * B1-B/C), there `source` names the anchor it mirrored.
   */
  source?: string;
  dx: number;
  dy: number;
}

/**
 * The layout container that assigned a rect outright. The engine DROPS an
 * authored `position` on such a child and logs "Widget cannot have a position
 * in a layout" (probe 2026-08-02, parity-checklist L23), which is the single
 * most common "why is my widget not where I put it".
 */
export interface GuiPlacedBy {
  /** The parent's widget key (`hbox`, `flowcontainer`, `fixedgridbox`, …). */
  key: string;
  name?: string;
  layout: "box" | "flow" | "grid";
  /** The `position` the engine dropped, when the widget authored one. */
  droppedPosition?: [number, number];
}

/** Why a widget's rect is where it is. */
export interface GuiPlacement {
  /** The final rect, the same one `GuiLayoutNode.rect` carries. */
  rect: { x: number; y: number; w: number; h: number };
  /** What the terms are measured against: the parent's content rect, or the
   * viewport for a root widget. */
  parentRect: { x: number; y: number; w: number; h: number };
  /**
   * The anchor terms, summing to the rect origin. EMPTY when `placedBy` is
   * set: a layout container computes the slot, so there is no anchor sum to
   * show.
   */
  terms: GuiPlacementTerm[];
  placedBy?: GuiPlacedBy;
  /**
   * The innermost clipping ancestor (a scrollarea viewport, or any widget with
   * `scissor = yes`), when one clips this widget. The rect is the clip rect,
   * NOT the intersection: the geometry is true and the renderer clips.
   */
  clippedBy?: { key: string; name?: string; rect: { x: number; y: number; w: number; h: number } };
}

/**
 * A texture the widget draws, with its frame-sheet grid when it is one. The
 * sheet's pixel size comes from the DDS header alone (128 bytes read, no
 * decode); `columns`/`rows`/`cell` need it, so they are absent when the file
 * does not resolve under the configured roots.
 *
 * The grid is driven by `framesize`, the property the vanilla gui trees
 * actually carry (both harvested titles ship it; neither ships `noofframes`).
 */
export interface GuiTextureInfo {
  /** The path as authored, mod-relative, the way the engine reads it. */
  path: string;
  /** Which fill it belongs to. */
  source: "fill" | "background";
  /** Absolute file it resolved to: mod, then parent mods (last first), then the game. */
  file?: string;
  /** Sheet pixel size from the DDS header. */
  width?: number;
  height?: number;
  /** `framesize = { w h }`: the grid's cell size. */
  framesize?: [number, number];
  /** Grid shape, row-major: floor(width/cellW) x floor(height/cellH). */
  columns?: number;
  rows?: number;
  /** The 1-based frame the widget shows (`frame`, default 1), clamped to the grid. */
  frame?: number;
  /** That frame's cell in texture pixels. */
  cell?: { x: number; y: number; w: number; h: number };
}

export interface GuiWidgetInfo {
  key: string;
  name?: string;
  /** The base-type chain the key resolves through, derived-most first. */
  typeChain: string[];
  /**
   * Effective properties in expansion order, last-in-wins per key: exactly the
   * values the engine laid the widget out with, so the inspector cannot show a
   * row the canvas did not use.
   */
  properties: GuiWidgetProperty[];
  /**
   * Textures the widget draws (its own fill first, then its background), with
   * frame-sheet geometry. `[]` when it draws none; absent only from a server
   * that predates the field.
   */
  textures?: GuiTextureInfo[];
  /**
   * Why the widget's rect is where it is. Present only when the request asked
   * for it (`placement: true`) AND the layout actually reached the widget: a
   * declaration inside a `tooltipwidget` or a subtree the engine skips has a
   * source line but no rect.
   */
  placement?: GuiPlacement;
}

/**
 * Request: what a `.gui` document reaches on the SCRIPT side;
 * {@link GuiDependenciesParams} -> {@link GuiDependenciesResult}. The forward
 * half of the dependency surface; the reverse (script definition -> the .gui
 * paths using it) is `paradox/dependencies` with `guiUses: true`, so both
 * directions come out of the same scripted_gui link.
 */
export const guiDependenciesRequest = "paradox/guiDependencies";
export interface GuiDependenciesParams {
  /** For display only; the text is authoritative. */
  uri: string;
  text: string;
  /**
   * Restrict the answer to one widget's SOURCE subtree, addressed by the
   * 0-based line of its own statement (`GuiLayoutNode.line`). Absent = the
   * whole document. A line carrying no widget answers with empty lists.
   */
  line?: number;
}
/** A scripted_gui the document calls, and what it hands control to. */
export interface GuiScriptedGuiRow {
  name: string;
  /** Definition site; absent when the index has no scripted_gui by that name. */
  file?: string;
  line?: number;
  /** 0-based lines in the REQUESTED document that call it. */
  callLines: number[];
  /** Call sites across every `.gui` file the layout store scanned. */
  uses: number;
  /** Events / on_actions the scripted_gui's own blocks hand control to. */
  chains: GuiEventChain[];
}
/** An event or on_action a scripted_gui reaches, and how. */
export interface GuiEventChain {
  name: string;
  kind: "event" | "on_action";
  file?: string;
  line?: number;
  /**
   * The scripted effects traversed to get there, outermost first. Empty =
   * "directly"; `["effect_a", "effect_b"]` renders as "via effect_a -> effect_b".
   */
  via: string[];
}
/** A localization key the document names, checked against the loc index. */
export interface GuiLocRow {
  key: string;
  /** The gui property that named it (`text`, `tooltip`). */
  prop: string;
  /** 0-based line in the requested document. */
  line: number;
  /** No `loc_key` definition anywhere in the index. */
  missing: boolean;
  /** The resolved text, when the index has one. */
  value?: string;
}
export interface GuiDependenciesResult {
  /** The widget the answer is scoped to; absent for a whole-document answer. */
  widget?: { key: string; name?: string; line: number };
  scriptedGuis: GuiScriptedGuiRow[];
  locKeys: GuiLocRow[];
}

/**
 * Request: the widget names a designer palette may offer for THIS document;
 * {@link GuiVocabularyParams} -> {@link GuiVocabularyResult}.
 *
 * Every name is harvested, never listed by hand: the bundled per-game widget
 * schema (`data/<game>/guiSchema.json`, built from the vanilla `gui/` tree)
 * plus the requested document's own `template` and `type` declarations. A
 * palette entry is therefore always a widget the game knows.
 */
export const guiVocabularyRequest = "paradox/guiVocabulary";
export interface GuiVocabularyParams {
  /** For display only; the text is authoritative. */
  uri: string;
  text: string;
}
export interface GuiVocabularyEntry {
  name: string;
  /** `builtin` = the vanilla harvest; `type`/`template` = this document declares it. */
  kind: "builtin" | "type" | "template";
  /** How many times the vanilla gui tree writes it (`builtin` only). */
  count?: number;
  /** The base widget key a `type` derives from. */
  base?: string;
  /** Declared in the requested document itself. */
  local?: boolean;
  /**
   * The vanilla tree writes widgets inside it, so it can hold children: what a
   * "wrap in a container" menu offers. Derived from the harvest's own child
   * counts, not from a list of container names.
   */
  container?: boolean;
}
export interface GuiVocabularyResult {
  /**
   * The document's own declarations first, then the harvested types by vanilla
   * usage. Capped; `total` gives the real count, so a UI states what it hid.
   */
  entries: GuiVocabularyEntry[];
  total: number;
  /**
   * Widget type -> the property names the harvest saw on it, most used first
   * and capped: what an inspector's add-property row completes from. Only the
   * types THIS DOCUMENT names are here (the keys it writes blocks under, plus
   * the bases of its own `type X = base` declarations), because the harvest
   * holds hundreds of types and this answer is re-asked after every layout.
   * The server always sends it (empty for a game with no harvest); it is
   * optional only so older recorded responses stay type-valid.
   */
  properties?: Record<string, string[]>;
  /**
   * The vanilla tree's most-used property names overall, most used first and
   * capped: the fallback ranking for a widget whose type the harvest has never
   * seen, so completion still offers something real rather than nothing.
   */
  commonProperties?: string[];
}

/**
 * Render-ready previews of palette entries: one instance of each entry laid
 * out in a synthetic document that keeps the requested document's own
 * declarations (so a local template previews with its real base). The
 * result is an ordinary node tree the client draws with the same painter as
 * the canvas. Entries a synthetic document cannot stand up (nothing to show,
 * zero size, a type the store lacks) come back with `node: null` and a
 * `reason`. Capped per request (GUI_PREVIEW_MAX); ask for the visible page.
 */
export const guiPreviewRequest = "paradox/guiPreview";
export const GUI_PREVIEW_MAX = 48;
export interface GuiPreviewEntry {
  name: string;
  /** `raw`: `fragment` is `.gui` text (a saved component) laid out as is. */
  kind: "builtin" | "type" | "template" | "raw";
  fragment?: string;
}
export interface GuiPreviewParams {
  /** For display only; the text is authoritative. */
  uri: string;
  text: string;
  entries: GuiPreviewEntry[];
}
export interface GuiPreview {
  name: string;
  node: GuiLayoutNode | null;
  /** Texture paths the node tree references (mod-relative). */
  textures: string[];
  reason?: string;
}
export interface GuiPreviewResult {
  previews: GuiPreview[];
}

/**
 * Preview values read out of a save game, so a designer draws
 * `[GetPlayer.GetName]` as "Great Britain" instead of a placeholder chip.
 *
 * `values` is keyed by datafunction chain WITHOUT brackets, exactly the shape
 * {@link GuiLayoutParams.previewValues} takes, so a client hands the answer
 * straight back to the next layout request. A chain the save has no field for
 * is absent: a preview shows what is knowable and never invents a value.
 *
 * The server streams the file and parses only the few blocks it needs (a big
 * campaign runs ~115 MB), and caches the answer per file and mtime.
 * Ironman and binary saves are refused with `error` set; melting them is a
 * different tool.
 */
export const guiSaveValuesRequest = "paradox/guiSaveValues";
export interface GuiSaveValuesParams {
  /** Absolute path to the save file. */
  path: string;
}
export interface GuiSaveValuesResult {
  /** Datafunction chain without brackets -> display text. */
  values: Record<string, string>;
  /** What the values came from, for a UI to name the save it is showing. */
  source: {
    /** The campaign's name as the save's meta data states it. */
    name: string;
    /** The in-game date, already formatted ("21 January 1836"). */
    date: string;
    /** The game the values were read for. */
    game: string;
  };
  /** Set when the save cannot be read (ironman, binary, unreadable). */
  error?: string;
}

/**
 * Request: source edits for a `.gui` designer gesture;
 * {@link GuiSourceEditParams} -> {@link GuiSourceEditResult}, null when the
 * request itself makes no sense (an unknown op). The server never writes: it
 * returns offsets into the text it was handed and the host applies them, which
 * keeps undo, dirty state and the live preview in the editor (EMBEDDING.md,
 * host-owns-text).
 *
 * Every edit is surgical, over the exact span the source model recorded, so
 * untouched bytes stay byte-identical: comments, CRLF, tabs-vs-spaces and
 * single-line bodies all survive a write.
 */
export const guiSourceEditRequest = "paradox/guiSourceEdit";
export interface GuiSourceEditParams {
  /** For display only; the text is authoritative. */
  uri: string;
  /** Authoritative document text every offset refers to. */
  text: string;
  /** One op. Mutually exclusive with {@link ops}; sending both answers null. */
  op?: GuiSourceOp;
  /**
   * A BATCH: several ops computed against this one text and answered as one
   * edit set, which is what makes a multi-widget gesture one document change
   * and one undo step. Every op gets a verdict of its own in
   * {@link GuiSourceEditResult.results}, so a refusal is per op and the rest
   * still apply. Order matters: the ops are computed in the order given, and a
   * later one whose bytes a earlier one already changes is refused rather than
   * silently dropped.
   */
  ops?: GuiSourceOp[];
}

/** One surgical replacement: replace `[start, end)` with `newText`. */
export interface GuiTextEdit {
  /** UTF-16 offsets into the request text. */
  start: number;
  end: number;
  newText: string;
}

/**
 * What to do. `line` is the 0-based line of the target widget's own statement,
 * the same `line` {@link GuiLayoutNode} reports; a node with no line of its own
 * (spliced in from a template or a type) has no source to edit and is refused.
 * `index` counts SOURCE children, not the template-expanded ones a preview
 * shows; out of range appends.
 */
export type GuiSourceOp =
  /** Set or (with a null value) remove properties on one widget. */
  | { kind: "setProperties"; line: number; properties: { key: string; value: string | null }[] }
  /** Move a source child of the widget on `line` from one index to another. */
  | { kind: "reorder"; line: number; from: number; to: number }
  | { kind: "insert"; line: number; widget: GuiNewWidget; index?: number }
  /** Paste `.gui` text as a child, re-indented for the destination. */
  | { kind: "insertRaw"; line: number; fragment: string; index?: number }
  | { kind: "delete"; line: number }
  /** Copy the widget in as its own next sibling, optionally renamed. */
  | { kind: "duplicate"; line: number; name?: string }
  /** Wrap the widgets on `lines` (siblings) in a fresh container. */
  | { kind: "wrap"; lines: number[]; container: GuiNewWidget }
  /** Read-only: the widget's block, verbatim, for a clipboard. */
  | { kind: "blockText"; line: number };

/** A declaration to write: `type = { properties }`, properties in order. */
export interface GuiNewWidget {
  type: string;
  properties?: [string, string][];
}

/**
 * For a single `op`, exactly one of `edits` and `refused` is present. A refusal
 * is an ANSWER, not an error: it names why the gesture would not do what it
 * looks like it does (a box owns its children's slots, a content-sized type
 * ignores an explicit size, a type definition other files use). `warning` rides
 * along with a write that went ahead but is only half honoured.
 *
 * For a BATCH (`ops`), `results` is present with one entry per op in the same
 * order, `edits` is every applied op's edits together (apply them as ONE
 * change), and `warning` joins the warnings. Top-level `refused` then names
 * only a whole-request failure (a document that does not parse, an empty
 * batch): a per-op refusal lives in its own entry and does not stop the others.
 */
export interface GuiSourceEditResult {
  edits?: GuiTextEdit[];
  refused?: string;
  warning?: string;
  /** `blockText` only: the copied block. */
  blockText?: string;
  /** Batch only: one verdict per requested op, in request order. */
  results?: GuiSourceOpResult[];
}

/** One op's own answer inside a batch. */
export interface GuiSourceOpResult {
  /** Why this op wrote nothing. The others in the batch still applied. */
  refused?: string;
  /** This op wrote, and is only half honoured. */
  warning?: string;
  /** This op's contribution to the combined `edits`; empty when it wrote nothing. */
  edits: GuiTextEdit[];
  /** `blockText` only: the copied block. */
  blockText?: string;
}

/**
 * Request: text edit for a preview interaction (drag / property change);
 * {@link GuiWidgetEditParams} -> {@link GuiWidgetEditResult} (null when the
 * widget or property cannot be edited). The client applies the offsets via
 * WorkspaceEdit so undo and the live preview loop stay in the editor.
 *
 * @deprecated Use {@link guiSourceEditRequest} with a `setProperties` op. This
 * is a thin alias over the same core, kept for hosts already wired to it: it
 * can only write the `position`/`size` pair and returns one edit or null, so a
 * refusal reaches the caller as a bare null with no reason attached.
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
  /** Also read each mod event's `theme`. Off by default: it costs one parse per
   *  event file, and only a client that draws the theme's art needs it. */
  themes?: boolean;
}
/**
 * One row of a mod event's card, in EXECUTION order (immediate, then the
 * options, then after) rather than file order. `line` is the join key an edge
 * uses to anchor at the row that fires it ({@link EventGraphEdge.fromLine}).
 */
export interface EventGraphStep {
  phase: "immediate" | "option" | "after";
  /** Option ordinal within the event, 0-based. */
  index?: number;
  /** The option's localized text, when resolvable. */
  text?: string;
  /** 0-based line of the step's key in the event's file. */
  line: number;
}
export interface EventGraphNode {
  id: string;
  kind: string;
  source: "vanilla" | "parent" | "mod";
  file?: string;
  line?: number;
  /** Localized title (best-effort: <id>.t / <id>_t / <id>.title lookups). */
  title?: string;
  /** The event's declared `theme`, when the request asked for themes. */
  theme?: string;
  /** How many `option` blocks this definition has (mod-side definitions only). */
  options?: number;
  /** The first keys of its `trigger` block, e.g. `is_adult, has_trait…`; absent = no trigger. */
  triggerSummary?: string;
  /** How many other nodes of this graph it fires; absent when it fires none. */
  fires?: number;
  /** The card's rows (mod events only), capped; {@link EventGraphNode.options} is the true count. */
  steps?: EventGraphStep[];
}
export interface EventGraphEdge {
  from: string;
  to: string;
  /** The referencing field (trigger_event, events, on_actions...). */
  via: string;
  /** Where in the source event the reference sits: an option's text, or immediate/after/… */
  label?: string;
  /** The block the reference sits in, normalized (option/immediate/after/effect/…). */
  phase?: string;
  /** 0-based line of that block's key: matches a step's `line` on the source node. */
  fromLine?: number;
  /** The trigger_event delay at this site, pre-rendered short: "30d", "7–14d", "2mo", "1y". */
  delay?: string;
  /** random_events weight at this site (raw script number). */
  weight?: number;
}
/**
 * What a query box may offer: the whole mod-side vocabulary of the graph, NOT
 * the ids this particular query selected. It is the same pass that collects the
 * mod's graph definitions, so a client gets it without a second request.
 */
export interface EventGraphSuggestions {
  /** Mod-side event / on_action / decision ids, sorted, capped at 2000. */
  ids: string[];
  /** The event namespaces those ids belong to, sorted. */
  namespaces: string[];
}
export interface EventGraph {
  nodes: EventGraphNode[];
  edges: EventGraphEdge[];
  truncated: boolean;
  /** Absent from servers that predate it; a client must tolerate that. */
  suggestions?: EventGraphSuggestions;
  /**
   * Set only when the graph is empty AND the server knows why: the queried
   * namespace/root exists, but outside what the graph shows (another workspace
   * mod when a focus filter is on, a dependency mod, or vanilla). One
   * user-readable sentence; absent = the generic "nothing found" story.
   */
  emptyReason?: string;
}

/**
 * Request: the value sets an event editor may offer; {@link EventVocabularyParams}
 * to {@link EventVocabularyResult}.
 *
 * Everything in the answer is DERIVED: the key lists come from the active
 * profile's structure table, the field value sets from the schema's reference
 * fields resolved through the definition index, and the effect/trigger lists
 * from the user's script_docs (or the bundled wiki fallback). Nothing here is a
 * hand-written name list, so a game patch that adds a theme or an effect shows
 * up without a release.
 */
/**
 * Request: the illustration an event theme puts behind its window;
 * {@link EventBannerParams} to {@link EventBannerResult}.
 *
 * Resolved through the game's own two hops (event_themes -> event_backgrounds),
 * taking the last `background` block that carries no `trigger`, which is the
 * file's own unconditional fallback. `texture` is the engine's mod-relative
 * path, exactly as a `.gui` file would spell it, so a client resolves it with
 * the same mod-then-game lookup it uses for any other texture. A theme that
 * resolves to nothing answers `reason` instead: the caller is expected to say
 * so rather than draw a picture that is not the event's.
 */
export const eventBannerRequest = "paradox/eventBanner";
export interface EventBannerParams {
  /** Theme name as the event writes it (`theme = intrigue`). */
  theme: string;
}
export interface EventBannerResult {
  theme: string;
  /** Mod-relative texture path, absent when nothing resolved. */
  texture?: string;
  /** Why nothing resolved. Present exactly when `texture` is absent. */
  reason?: string;
}

export const eventVocabularyRequest = "paradox/eventVocabulary";
export interface EventVocabularyParams {
  /** Restrict definition-backed value sets to one workspace mod (plus vanilla). */
  modRoot?: string | null;
}
/** One offerable value with the one-line docs an editor shows beside it. */
export interface EventVocabularyItem {
  value: string;
  /** Documentation, capped. Empty when the source has none; never invented. */
  doc?: string;
  /** Dimmer right-hand label: where the value comes from (mod / vanilla / a kind). */
  hint?: string;
}
/** Caps: an editor lists a page at a time, and these ride on every open. */
export const EVENT_VOCABULARY_MAX_TOKENS = 600;
export const EVENT_VOCABULARY_MAX_VALUES = 400;

/**
 * Request: the value set a VALUE belongs to, resolved through the definition
 * index; {@link EventValueOptionsParams} -> {@link EventValueOptionsResult} |
 * null. The static vocabulary maps a KEY to its values, which only works where
 * the schema knows the key's context (an event's or option's own fields). Deep
 * inside an effect tree the same key name means something else (`type` in
 * `random_secret` is a secret, not an event type), so there the editor asks
 * about the value it already has: `secret_cultivator` is an indexed `secret`,
 * and the answer is every secret the index knows. Null = the value resolves to
 * nothing enumerable; the editor falls back to a free input.
 */
export const eventValueOptionsRequest = "paradox/eventValueOptions";
export interface EventValueOptionsParams {
  value: string;
  /** Restrict mod-side entries to one workspace mod (plus vanilla/parents). */
  modRoot?: string | null;
}
export interface EventValueOptionsResult {
  /** The definition kind the value resolved to (trait, secret, faith…). */
  kind: string;
  /** Every indexed definition of that kind, mod entries first, capped. */
  items: EventVocabularyItem[];
}
export interface EventVocabularyResult {
  /** Keys valid at an event's top level, most used first. */
  eventKeys: EventVocabularyItem[];
  /** Keys valid inside an `option` block, most used first. */
  optionKeys: EventVocabularyItem[];
  /**
   * Key to the values that key accepts, for the keys whose value set is known:
   * a declared enumeration, or a reference field resolved through the index
   * (`theme` gives every indexed event_theme). Keys with a free value are absent.
   */
  values: Record<string, EventVocabularyItem[]>;
  /** Effect tokens, most used first, capped at EVENT_VOCABULARY_MAX_TOKENS. */
  effects: EventVocabularyItem[];
  /** Trigger tokens, same ordering and cap. */
  triggers: EventVocabularyItem[];
  /** Saved scopes the mod writes (`save_scope_as`), sorted. */
  savedScopes: EventVocabularyItem[];
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
  /**
   * Also resolve {@link DependenciesResult.guiUses}: the `.gui` call sites that
   * reach this definition through a scripted_gui. Off by default, it walks the
   * scripted_gui definitions that any .gui file calls, which the plain
   * dependency answer does not need.
   */
  guiUses?: boolean;
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
   * references aren't indexed, AD-4). Grouped by the containing definition's
   * kind, else by file. */
  dependents: DependencyGroup[];
  /** Named definitions referenced inside `def`'s block, grouped by target kind. */
  dependencies: DependencyGroup[];
  /**
   * The GUI side of the same question, present only when `guiUses` was asked
   * for: which `.gui` files reach `def`, and through which scripted_gui. `[]`
   * is the honest "none found"; the field is absent when it was not requested.
   */
  guiUses?: GuiUseSite[];
}

/**
 * One `.gui` call site that reaches a script definition. The link is always a
 * scripted_gui: `.gui` invokes script through `GetScriptedGui('name')` and
 * nothing else, so the path is `file:line -> scripted_gui -> [effects] -> def`.
 */
export interface GuiUseSite {
  /** Absolute path of the `.gui` file holding the call. */
  file: string;
  /** 0-based line of the `GetScriptedGui(...)` call. */
  line: number;
  /** The scripted_gui the call names. */
  scriptedGui: string;
  /**
   * The scripted effects between that scripted_gui and the definition,
   * outermost first. Empty means the scripted_gui's own blocks name it
   * ("directly"); `["effect_a", "effect_b"]` renders as
   * "via effect_a -> effect_b".
   */
  via: string[];
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
   * scopes of its definition kind. NOT flow-sensitive, a save further down
   * the file is listed too, matching what completion and hover already offer.
   */
  savedScopes: SavedScopeInfo[];
}
