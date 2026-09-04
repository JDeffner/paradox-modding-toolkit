/**
 * Language server entry point: owns the script_docs token data and the
 * definition index, and answers completion/hover/definition/semantic-token/
 * inlay-hint/code-action requests plus the paradox/* custom protocol.
 * Game knowledge comes from the active GameProfile (games/).
 *
 * All heavy work (vanilla scan) runs here, out of the editor's extension host,
 * chunked so requests stay responsive, with LSP work-done progress.
 */
import {
  createConnection,
  DidChangeWatchedFilesNotification,
  MarkupKind,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
// Named import: the bundler inlines just the version string (not the whole
// manifest), and the same source works when tests import from src.
import { version as SERVER_VERSION } from "../package.json";
import type { Definition } from "@px-lsp/protocol/types";
import { pushAll } from "@px-lsp/protocol/arrays";
import { iterFiles } from "@px-lsp/protocol/fsWalk";
import {
  configChangedNotification,
  indexChangedNotification,
  indexStatsRequest,
  locTextRequest,
  lookupLocRequest,
  modFileChangedNotification,
  progressNotification,
  reloadDocsRequest,
  statusNotification,
  type ParadoxInitOptions,
  type ParadoxSettings,
  type StatusPayload,
  type LocEntryInfo,
  type LocTextParams,
  type LookupLocParams,
  type ModFileChangeParams,
  type ModScopedParams,
  type ReloadDocsParams,
  type ReloadDocsResult,
  eventBannerRequest,
  eventDetailRequest,
  exampleWikiRequest,
  exampleWikiEntryRequest,
  exampleWikiVariableKinds,
  type ExampleWikiEntryParams,
  type ExampleWikiKind,
  dynastyTreeRequest,
  eventGraphRequest,
  eventValueOptionsRequest,
  eventVocabularyRequest,
  definitionFormRequest,
  definitionEditRequest,
  modifierFormatsRequest,
  type ModifierFormatsParams,
  type DefinitionFormParams,
  type DefinitionEditParams,
  guiTreeRequest,
  locCoverageRequest,
  modOverviewRequest,
  overridesRequest,
  type DynastyTreeParams,
  type EventBannerParams,
  type EventDetailParams,
  type EventGraphParams,
  type EventValueOptionsParams,
  type EventVocabularyParams,
  type GuiTreeParams,
  guiLayoutRequest,
  type GuiLayoutParams,
  guiWidgetEditRequest,
  type GuiWidgetEditParams,
  guiSourceEditRequest,
  type GuiSourceEditParams,
  guiWidgetInfoRequest,
  type GuiWidgetInfoParams,
  guiDependenciesRequest,
  type GuiDependenciesParams,
  guiVocabularyRequest,
  guiPreviewRequest,
  GUI_PREVIEW_MAX,
  type GuiPreviewParams,
  type GuiPreviewResult,
  guiSaveValuesRequest,
  type GuiSaveValuesParams,
  type GuiSaveValuesResult,
  type GuiVocabularyParams,
  dependenciesRequest,
  type DependenciesParams,
  scopeAtRequest,
  type ScopeAtParams,
  snippetsRequest,
  type SnippetsParams,
  type SnippetsResult,
  type ScopeAtResult,
} from "@px-lsp/protocol/protocol";
import { buildGuiTree } from "./features/guiTree";
import { resolveGuiText, type ResolvedText } from "./gui/textResolve";
import { previewEntries } from "./gui/previewService";
import { readSaveValues } from "./gui/saveValues";
import {
  computeGuiLayoutResult,
  getGuiDefs,
  profileMeasurer,
  getGuiScriptLinks,
  invalidateGuiDefsCache,
  observeGuiStoreBuild,
  VIEWPORT,
} from "./gui/layoutService";
import { computeGuiWidgetEdit } from "./gui/widgetEdit";
import { computeGuiSourceEdit, computeGuiSourceEdits } from "./gui/sourceEditService";
import { computeGuiVocabulary } from "./gui/vocabulary";
import { computeGuiWidgetInfo } from "./gui/widgetInfo";
import { computeGuiDependencies, computeGuiUses } from "./gui/guiDependencies";
import { provideGuiCompletion, provideGuiHover } from "./features/guiLanguage";
import { provideGuiDefinition, type GuiPaths } from "./features/guiNavigation";
import { provideDataFnCompletion, provideDataFnHover, provideDataFnSignature } from "./features/datafunction";
import { getLineText, isScriptLanguage } from "./documents";
import { computeEventDetail } from "./overview/eventDetail";
import {
  buildExampleWikiIndex,
  computeExampleWikiEntry,
  SiteFinder,
  type ExampleWikiSources,
  type WikiVariable,
  type WikiVariableSite,
} from "./overview/exampleWiki";
import { LIST_KIND_PREFIX, VAR_KIND_PREFIX, variableTypes } from "./scopes/varTypes";
import { loadTokenData, parseOnActionsLog } from "./data/docsParser";
import { loadDataTypes } from "./data/dataTypes";
import { loadDataBindingMacros } from "./data/dataBindingMacros";
import { DefinesIndex } from "./data/defines";
import { TextFormattingIndex } from "./data/textFormatting";
import { provideFormatTagCompletion, provideFormatTagHover } from "./features/locFormatting";
import { loadDataFnUsageAsync } from "./data/dataFnUsage";
import { loadWikiTokens, mergeWikiTokens } from "./data/wikiDocs";
import { emptyFreqData, loadFreqs, type FreqData } from "./schema/freqs";
import {
  DefinitionIndex,
  classifyFile,
  detectGameVersion,
  isWantedLocFile,
  loadIndexCache,
  saveIndexCache,
} from "./index/indexer";
import { internedCount, resetInternTable } from "./index/intern";
import { extractDefinitions } from "./index/extract";
import { extractReferences } from "./index/references";
import { scanModRootFused } from "./index/fusedScan";
import { LazyReferenceScanner, type LazyRefRoot } from "./index/lazyRefs";
import { ModOriginResolver } from "./index/modOrigin";
import { loadSchema, type SchemaData } from "./schema/loader";
import { VARIABLE_KINDS } from "./games/jomini/variables";
import { activeProfile, setActiveProfile } from "./games/active";
import { resolveConfigDir } from "@px-lsp/protocol/configDir";
import { resolveProfile } from "./games/registry";
import type { SchemaEntry } from "./schema/types";
import { URI } from "vscode-uri";
import { ServerData } from "./serverData";
import { CompletionFeature } from "./features/completion";
import { provideHover } from "./features/hover";
import { setHoverDetail } from "./features/hoverRender";
import { provideDateHover } from "./features/calendarDates";
import { sanitizeCalendar } from "@px-lsp/protocol/calendar";
import { provideTextureHover } from "./features/textureHover";
import { provideDefinition, provideLocDefinition } from "./features/definition";
import { SEMANTIC_LEGEND, provideSemanticTokens } from "./features/semanticTokens";
import { provideInlayHints } from "./features/inlayHints";
import { computeScopeAt } from "./features/scopeAt";
import { provideCodeActions } from "./features/codeActions";
import { provideSignatureHelp } from "./features/signatureHelp";
import { provideDocumentSymbols } from "./features/symbols";
import { provideFoldingRanges } from "./features/folding";
import { provideColorPresentations, provideDocumentColors } from "./features/colors";
import { provideFormattingEdits } from "./features/formatting";
import {
  computeLocDiagnostics,
  computeReferenceDiagnostics,
  computeRequiredLocDiagnostics,
  computeScriptDiagnostics,
  type FileContext,
} from "./features/diagnostics";
import { provideReferences } from "./features/references";
import { prepareRename, provideRename } from "./features/rename";
import { provideWorkspaceSymbols } from "./features/workspaceSymbols";
import { evictParse, getLocParse, getParse } from "./parseCache";
import { buildSnippetList } from "./features/snippetList";
import { resolveClientCapabilities, setClientCapabilities } from "./clientMode";
import { isIgnoredByConfig, isSuppressedInline, scanInlineSuppressions } from "@px-lsp/protocol/suppression";
import { computeModOverview } from "./overview/modOverview";
import { computeLocCoverage } from "./overview/locCoverage";
import { computeOverrides } from "./overview/overrides";
import { computeEventGraph } from "./overview/eventGraph";
import { computeDynastyTree } from "./overview/dynastyTree";
import { computeEventVocabulary, computeValueOptions } from "./overview/eventVocabulary";
import { computeEventBanner } from "./overview/eventBanner";
import { computeDefinitionForm } from "./creators/definitionForm";
import { computeDefinitionEdits } from "./creators/definitionEdit";
import { computeModifierFormats } from "./creators/modifierFormats";
import { computeLocText, type LocTextDeps } from "./features/locText";
import { computeDependencies } from "./overview/dependencies";
import { wordRangeAt } from "./wordAt";

// The px-lsp bin, before the connection claims stdio:
//  - `px-lsp --version` answers and exits, so health checks and install
//    scripts do not need an LSP handshake.
//  - A bare `px-lsp` defaults to --stdio instead of dying with a stack trace
//    ("Connection input stream is not set"). Editors that spawn over node-ipc
//    (the VS Code client) pass --node-ipc themselves, and an ipc fork is
//    recognizable by process.send, so the default cannot misfire there.
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  process.stdout.write(SERVER_VERSION + "\n");
  process.exit(0);
}
const TRANSPORT_FLAGS = ["--node-ipc", "--stdio", "--socket", "--pipe"];
if (
  !process.send &&
  !process.argv.some((arg) => TRANSPORT_FLAGS.some((flag) => arg === flag || arg.startsWith(flag + "=")))
) {
  process.argv.push("--stdio");
}

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// ---- crash visibility (perf campaign §A1) -----------------------------------

/**
 * A throw on the scan path used to kill this process silently: the client
 * restarts it five times and then everything LSP-backed is dead for the rest
 * of the session while TextMate highlighting keeps working — the "only syntax
 * highlighting works" field reports. Both handlers log through the connection
 * AND raw stderr (the client pipes the server's stderr into the same output
 * channel), so a death leaves a stack behind instead of silence.
 */
function logFatal(what: string, err: unknown): void {
  const detail = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
  const line = `FATAL ${what}: ${detail}`;
  try {
    connection.console.error(line);
  } catch {
    // connection already torn down; stderr below still reaches the channel
  }
  try {
    process.stderr.write(`[px-lsp] ${line}\n`);
  } catch {
    /* nothing left to log to */
  }
}

process.on("unhandledRejection", (reason) => logFatal("unhandledRejection", reason));
process.on("uncaughtException", (err) => {
  logFatal("uncaughtException", err);
  // The process still dies (the client's restart logic stays the recovery
  // path); the delay only gives the log line time to reach the client.
  setTimeout(() => process.exit(1), 250);
});

/**
 * Fault injection for the crash-visibility test (§A1), read once at startup:
 * "sync" throws inside a folder scan, "async" throws from a timer during one
 * (the process-killing shape). Unset in every real client.
 */
const faultScan = process.env.PX_FAULT_SCAN ?? "";

function injectScanFault(): void {
  const err = new Error(`px fault injection: scan throw (PX_FAULT_SCAN=${faultScan})`);
  if (faultScan === "async")
    setImmediate(() => {
      throw err;
    });
  else throw err;
}

function defaultSettings(): ParadoxSettings {
  return {
    gamePath: null,
    logsPath: null,
    modPath: null,
    parentPaths: [],
    workspaceMods: [],
    locLanguage: "english",
    scopeInlayHints: false,
    hoverDetail: "standard",
    diagnosticsIgnore: [],
    diagnosticsIgnorePatterns: [],
    diagnosticsVanilla: false,
    tracePerf: false,
  };
}
let settings: ParadoxSettings = defaultSettings();
let storageDir = "";
let wikidocsDir = "";
let freqsDir = "";
let tokensFromScriptDocs = false;
let tokensFromBundledDumps = false;
let tokensWikiOnly = 0;
let indexing = false;
/** Bumped whenever paths change; in-flight scans abort when superseded. */
let scanGeneration = 0;
/** Bundled schema merged with the workspace overlay; reloaded on path changes. */
let schema: SchemaData = loadSchema(null);
/** namespace declarations per mod file, folded into data.modNamespaces. */
const namespacesByFile = new Map<string, string[]>();

const data = new ServerData();
const completion = new CompletionFeature(data, () => schema);
/** Mod display names for hover/completion origin labels ("· My Mod" instead of
 * "· mod"); roots re-resolved on path changes and descriptor.mod edits. */
const modOrigin = new ModOriginResolver();
data.originLabel = (def) => modOrigin.labelFor(def.file, def.source);
data.modRootOf = (file) => modOrigin.rootFor(file);

function refreshModOrigin(): void {
  modOrigin.setRoots([...(settings.modPath ? [settings.modPath] : []), ...parentRoots()]);
}

/** On-demand reference search over the roots buildIndex leaves out of the
 * ReferenceIndex: read-only dependency parents and vanilla (#3, AD-4). */
const lazyRefs = new LazyReferenceScanner();

function refreshLazyRefs(): void {
  const roots: LazyRefRoot[] = dependencyParentRoots().map((root) => ({
    root,
    source: "parent" as const,
  }));
  if (settings.gamePath) roots.push({ root: settings.gamePath, source: "vanilla" });
  lazyRefs.setRoots(roots, isEngineToken);
}

/** Bundled frequency tables: completion ranks with them, the Examples Wiki
 *  shows them as "how often the game itself writes this". */
let freqs: FreqData = emptyFreqData();
function applyFreqs(): void {
  freqs = loadFreqs(freqsDir);
  completion.setFreqs(freqs);
}

/** Example sites for the Examples Wiki, searched in the game's own files. */
const exampleSites = new SiteFinder();

function refreshExampleSites(): void {
  // Profile-driven, not a hardcoded folder list: the schema names the script
  // folders of the active game, and the kinds it marks uncompletable are the
  // bulk ones (history) whose files no newcomer wants as an example.
  const folders = [
    ...new Set(
      schema.entries.filter((e) => e.completable !== false && (e.ext ?? ".txt") === ".txt").map((e) => e.path)
    ),
  ];
  exampleSites.setRoots(settings.gamePath, folders);
}

/**
 * Variables and lists for the Examples Wiki, gathered from the definition
 * index, the reference index and the set-site type analysis.
 *
 * Rebuilt when either index moves, so an article follows a save; the catalog
 * request and every article request share one build.
 */
let wikiVariableCache: { revision: string; map: Map<string, WikiVariable> } | null = null;

/** Sites kept per article. A name read ten thousand times still shows six. */
const WIKI_VARIABLE_SITE_CAP = 50;

function wikiVariables(): Map<string, WikiVariable> {
  const revision = `${data.index.revision}:${data.refIndex.revision}`;
  if (wikiVariableCache && wikiVariableCache.revision === revision) return wikiVariableCache.map;
  const map = buildWikiVariables();
  wikiVariableCache = { revision, map };
  return map;
}

function buildWikiVariables(): Map<string, WikiVariable> {
  const kinds = new Set<string>(exampleWikiVariableKinds);
  // Names first: one walk of the definition index. entries() yields ONE
  // definition per name, so the sites come from lookupAll below.
  const names = new Set<string>();
  for (const def of data.index.entries((d) => kinds.has(d.kind))) names.add(def.name);
  const map = new Map<string, WikiVariable>();
  if (names.size === 0) return map;

  const varInfo = variableTypes(data, data.rootScopesForFile);
  const siteOf = (def: Definition): WikiVariableSite => {
    const site: WikiVariableSite = { file: def.file, line: def.line };
    if (def.container !== undefined) site.container = def.container;
    return site;
  };
  for (const name of names) {
    const byKind = new Map<string, Definition[]>();
    for (const def of data.index.lookupAll(name)) {
      if (!kinds.has(def.kind)) continue;
      let group = byKind.get(def.kind);
      if (!group) byKind.set(def.kind, (group = []));
      group.push(def);
    }
    for (const [kind, defs] of byKind) {
      // A list set-site is indexed under BOTH the list kind and the scalar kind
      // (index/references.ts), so the scalar shadow of a list must not become
      // an article of its own.
      const listGroup = byKind.get(`${kind}_list`);
      const sets = listGroup
        ? defs.filter((d) => !listGroup.some((l) => l.file === d.file && l.line === d.line))
        : defs;
      if (sets.length === 0) continue;
      map.set(`${kind}:${name}`, {
        name,
        kind: kind as ExampleWikiKind,
        sets: sets.slice(0, WIKI_VARIABLE_SITE_CAP).map(siteOf),
        setsTotal: sets.length,
        reads: [],
        readsTotal: 0,
        types: wikiVariableTypes(varInfo, kind, name),
        origins: [...new Set(sets.map((d) => data.originLabel(d)))],
      });
    }
  }
  // Read sites: one walk of the reference index, kept to the names that have
  // an article. A scalar read accepts a list too, so one reference can belong
  // to both the `variable` and the `variable_list` article.
  for (const ref of data.refIndex.all()) {
    if (!names.has(ref.name)) continue;
    for (const kind of ref.kinds) {
      const entry = map.get(`${kind}:${ref.name}`);
      if (!entry) continue;
      entry.readsTotal++;
      if (entry.reads.length < WIKI_VARIABLE_SITE_CAP) entry.reads.push({ file: ref.file, line: ref.line });
    }
  }
  return map;
}

/** The set-site types of one variable kind, in the namespace it lives in. */
function wikiVariableTypes(
  info: ReturnType<typeof variableTypes>,
  kind: string,
  name: string
): string[] | null {
  if (kind === "list") return scopeNames(info.adhocListItemTypes.get(name));
  const varPrefix = VAR_KIND_PREFIX[kind];
  if (varPrefix) return scopeNames(info.types.get(`${varPrefix}:${name}`));
  const listPrefix = LIST_KIND_PREFIX[kind];
  if (listPrefix) return scopeNames(info.listItemTypes.get(`${listPrefix}:${name}`));
  return [];
}

/** `undefined` (nothing typed it) reads as "no evidence"; `null` (a runtime
 *  anchor) stays unknown, which the article says out loud (AD-5). */
function scopeNames(types: Set<string> | null | undefined): string[] | null {
  if (types === undefined) return [];
  if (types === null) return null;
  return [...types];
}

/** What the two Examples Wiki requests read. */
function exampleWikiSources(): ExampleWikiSources {
  return {
    tokens: data.tokens,
    dataTypes: data.dataTypes,
    usage: data.dataFnUsage,
    counts: freqs.tokens,
    tokenSource: tokensFromScriptDocs
      ? tokensFromBundledDumps
        ? "the bundled script_docs snapshot. Run script_docs in the game console for the list your game version really has."
        : "your own script_docs logs, so they match your game version."
      : "the bundled wiki tables. Run script_docs in the game console for the full list your game version has.",
    needsScriptDocs: !tokensFromScriptDocs || tokensFromBundledDumps,
    gamePath: settings.gamePath,
    variables: wikiVariables(),
  };
}

/** Focus predicate for the mod-scoped overview requests: with a `modRoot`
 * param only that workspace mod's files pass; without one, every mod file. */
function focusFilter(modRoot: string | null | undefined): (file: string) => boolean {
  if (!modRoot) return () => true;
  const wanted = modRoot.toLowerCase();
  return (file) => modOrigin.rootFor(file)?.toLowerCase() === wanted;
}
/** Engine-token test for call-reference extraction: engine effect/trigger call
 * sites stay out of the reference index (memory guard for AGOT-sized mods). */
const isEngineToken = (name: string) => data.tokenMap.has(name);

/** Ordered parent-mod roots: settings (parent-mods setting / workspace
 * folders) merged with every workspace mod's <configDir>/playset.json, minus
 * mod/game roots. */
function parentRoots(): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return;
    if (settings.modPath && key === settings.modPath.toLowerCase()) return;
    if (settings.gamePath && key === settings.gamePath.toLowerCase()) return;
    seen.add(key);
    roots.push(p);
  };
  for (const p of settings.parentPaths ?? []) add(p);
  for (const mod of [...(settings.modPath ? [settings.modPath] : []), ...workspaceModRoots()]) {
    for (const p of readPlaysetCached(mod)) add(p);
  }
  return roots;
}

/** parentRoots() minus the workspace mods: the read-only dependency layer,
 * which the game loads after vanilla and before the mods being edited. */
function dependencyParentRoots(): string[] {
  const wsMods = new Set(workspaceModRoots().map((r) => r.toLowerCase()));
  return parentRoots().filter((r) => !wsMods.has(r.toLowerCase()));
}

/** parentRoots() runs on every request (via contentRoots); with 20 workspace
 * mods the per-mod playset fs probes need a cache. Cleared on reindex. */
const playsetCache = new Map<string, string[]>();
function readPlaysetCached(modRoot: string): string[] {
  const key = modRoot.toLowerCase();
  let v = playsetCache.get(key);
  if (!v) playsetCache.set(key, (v = readPlayset(modRoot)));
  return v;
}

/**
 * Content roots in precedence order: mod, parents, vanilla.
 *
 * Memoized with playsetCache (same lifetime, same clear): this is called once
 * per REFERENCE by the scope aggregation below, and rebuilding two arrays plus
 * a playset probe per mod, 4.1M times, was measured as seconds per request
 * (perf round 2).
 */
let contentRootsCache: string[] | null = null;
function contentRoots(): string[] {
  if (contentRootsCache) return contentRootsCache;
  return (contentRootsCache = [settings.modPath, ...parentRoots(), settings.gamePath].filter(
    (r): r is string => r !== null
  ));
}

/**
 * Root scopes per FILE, memoized (perf round 2).
 *
 * `buildCallSiteScopes` asks for every reference's file, and a mod holds
 * millions of references across thousands of files: the AGOT corpus measures
 * 4,124,139 usage sites in 3,944 files, a 1000:1 ratio of calls to distinct
 * answers. Each miss walks contentRoots, then every schema entry
 * (classifyFile), then allocates a Set. Cleared with playsetCache, so a
 * settings or schema change cannot serve a stale answer.
 *
 * The cached Set is shared, never copied per call. Safe because the only
 * consumer, resolveKeyChainScopes, copies it before touching it.
 */
const fileRootScopesCache = new Map<string, Set<string> | null>();

/** Drop everything derived from the current settings/schema (reindex path). */
function clearPathCaches(): void {
  playsetCache.clear();
  contentRootsCache = null;
  fileRootScopesCache.clear();
}

/** Engine-layer roots shipped next to `<game>`, lowest content priority
 * (real load order: clausewitz → jomini → game → mods). Only jomini is
 * included: it holds real script/gui content (trigger_localization, defines,
 * base textformatting, notification gui). clausewitz is deliberately excluded
 * because it contains only Paradox tooling UI (gui_editor, node_editor,
 * profilers) that no game or mod file references. */
function engineRoots(): string[] {
  if (!settings.gamePath) return [];
  const jomini = path.join(path.dirname(settings.gamePath), "jomini");
  return fs.existsSync(jomini) ? [jomini] : [];
}

/** Workspace mod roots beyond modPath: mods being edited (multi-mod workspaces).
 * They get reference indexing and reference diagnostics like the mod itself. */
function workspaceModRoots(): string[] {
  const mods: string[] = [];
  for (const p of settings.workspaceMods ?? []) {
    if (settings.modPath && p.toLowerCase() === settings.modPath.toLowerCase()) continue;
    mods.push(p);
  }
  return mods;
}

/** The workspace mod root a file lives under, or null. Every workspace mod is
 * a first-class editable mod (source "mod"); there is no primary-mod special
 * case — dependency parents (parent-mods setting / playset) stay "parent". */
function workspaceRootOf(fsPath: string): string | null {
  const lower = fsPath.toLowerCase();
  if (settings.modPath && lower.startsWith(settings.modPath.toLowerCase())) return settings.modPath;
  return workspaceModRoots().find((r) => lower.startsWith(r.toLowerCase())) ?? null;
}

/** Schema entry for the folder a file lives in (structure/ambient/root-scope seed). */
function schemaEntryForFile(fsPath: string): SchemaEntry | null {
  const lower = fsPath.toLowerCase();
  for (const root of contentRoots()) {
    if (lower.startsWith(root.toLowerCase())) return classifyFile(root, fsPath, schema.entries);
  }
  return null;
}

const entryRootScopesCache = new WeakMap<SchemaEntry, Set<string> | null>();

/** The shared lowercased root-scope Set of one schema entry. */
function entryRootScopes(entry: SchemaEntry): Set<string> | null {
  const hit = entryRootScopesCache.get(entry);
  if (hit !== undefined) return hit;
  const scopes =
    !entry.rootScopes || entry.rootScopes.length === 0
      ? null
      : new Set(entry.rootScopes.map((s) => s.toLowerCase()));
  entryRootScopesCache.set(entry, scopes);
  return scopes;
}

/** Schema-declared root scopes for the folder a file lives in (AD-5 seed).
 *  Memoized per file: see fileRootScopesCache. */
function rootScopesForFile(fsPath: string): Set<string> | null {
  const key = process.platform === "win32" ? fsPath.toLowerCase() : fsPath;
  const hit = fileRootScopesCache.get(key);
  if (hit !== undefined) return hit;
  const entry = schemaEntryForFile(fsPath);
  // One Set per schema ENTRY, not per file: there are ~156 entries against
  // tens of thousands of files, and a Set of one string costs 242 B. Safe to
  // share because buildCallSiteScopes keys on Set identity and copies before
  // mutating (varTypes.ts).
  const scopes = entry === null ? null : entryRootScopes(entry);
  fileRootScopesCache.set(key, scopes);
  return scopes;
}
// Static variable-type resolution (scopes/varTypes.ts) resolves root-anchored
// set_variable values through the set-file's schema root scopes.
data.rootScopesForFile = rootScopesForFile;

function log(msg: string): void {
  connection.console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// ---- perf tracing (§A2) ------------------------------------------------------

/** `px.trace.perf`: wall clock for requests, rescans, index changes and scan
 * phases into the output channel, so a slow save yields a ms timeline. */
function perfOn(): boolean {
  return settings.tracePerf === true;
}

function perf(msg: string): void {
  if (perfOn()) log(`perf ${msg}`);
}

/** Time `fn` and trace `<label> <ms>`; a no-op wrapper when tracing is off. */
function perfSpan<T>(label: string, fn: () => T): T {
  if (!perfOn()) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    log(`perf ${label} ${(performance.now() - t0).toFixed(1)}ms`);
  }
}

/** Filename for trace labels, without paying path.basename when tracing is off. */
function perfName(uriOrPath: string): string {
  return perfOn()
    ? uriOrPath.slice(Math.max(uriOrPath.lastIndexOf("/"), uriOrPath.lastIndexOf("\\")) + 1)
    : "";
}

/** Every index-change fan-out goes through here so the trace attributes it. */
function indexChanged(phase: string): void {
  perfSpan(`indexChanged (${phase})`, () => data.notifyIndexChanged());
}

// ---- status / refresh plumbing ---------------------------------------------

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

let lastLoggedStatus = "";

function sendStatus(): void {
  // stats() walks every definition in the index; it runs on every index change,
  // so its own cost is part of the trace (§A2).
  const total = perfSpan("sendStatus stats()", () => data.index.stats().total);
  const payload: StatusPayload = {
    tokens: data.tokens.length,
    tokensFromScriptDocs,
    tokensFromBundledDumps,
    definitions: total,
    tokensWikiOnly,
    indexing,
  };
  void connection.sendNotification(statusNotification, payload);
  // Mirror into window/logMessage so bare clients (no paradox/status handler)
  // can tell an empty index from a cold one. Only on transitions: scans fire
  // many status updates, but the interesting line is start/end of indexing.
  const source = payload.tokensFromBundledDumps
    ? "bundled script_docs"
    : payload.tokensFromScriptDocs
      ? "script_docs"
      : "bundled";
  const line = `status: ${payload.tokens} tokens (${source}), ${
    payload.definitions
  } definitions${payload.indexing ? ", indexing…" : ""}`;
  const key = `${payload.indexing}|${payload.tokens === 0}|${payload.definitions === 0}`;
  if (key !== lastLoggedStatus) {
    lastLoggedStatus = key;
    log(line);
  }
}

/**
 * One coarse phase of the cold-start work, for the client's status bar. Phases
 * are named on the wire, never numbered: the client owns the ordering it shows.
 */
function sendProgress(phase: string, state: "start" | "done", detail?: string): void {
  void connection.sendNotification(progressNotification, { phase, state, detail });
}

// The template/type store is built lazily, on the first request that needs it,
// so the phase is reported from where it happens rather than from a call site.
observeGuiStoreBuild((state) =>
  sendProgress("guiStore", state, state === "start" ? "building the GUI template store…" : undefined)
);

/**
 * Idle debounce for the global refresh (§B4). Raised from 300ms: one fire makes
 * EVERY visible editor re-request full-document semantic tokens and inlay
 * hints, and every server-backed sidebar view re-query the index.
 */
const REFRESH_DEBOUNCE_MS = 500;

function cancelRefreshTimer(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}

function fireRefresh(reason: string): void {
  cancelRefreshTimer();
  perf(`refresh fired (semanticTokens + inlayHint, ${reason})`);
  void connection.sendNotification(indexChangedNotification);
  connection.languages.semanticTokens.refresh().catch(() => {});
  connection.languages.inlayHint.refresh().catch(() => {});
}

data.onDidChange(() => {
  sendStatus();
  // §B4: a scan fires an index change per root, and each refresh puts a
  // full-document token request per visible editor plus every sidebar view's
  // index walk behind an already-saturated event loop — the "semantic
  // highlighting never arrives" reports. buildIndex's finally fires exactly
  // one refresh when the index is complete instead.
  if (indexing) return;
  // Debounce editor refreshes and the index-changed signal: scans fire many changes.
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    fireRefresh("idle");
  }, REFRESH_DEBOUNCE_MS);
});

// ---- data loading -----------------------------------------------------------

function loadDocs(force: boolean): void {
  tokensFromScriptDocs = false;
  tokensFromBundledDumps = false;
  let scriptTokens = [] as ReturnType<typeof loadTokenData>["tokens"];
  let modifierTemplates = [] as ReturnType<typeof loadTokenData>["templates"];
  if (settings.logsPath) {
    const t0 = Date.now();
    const docsCacheFile = path.join(storageDir, `docsCache${activeProfile().cacheSuffix}.json`);
    const result = loadTokenData(settings.logsPath, docsCacheFile, force);
    scriptTokens = result.tokens;
    modifierTemplates = result.templates;
    tokensFromScriptDocs = scriptTokens.length > 0;
    if (result.fromCache)
      log(`loaded token data from cache (${result.tokens.length} tokens, ${Date.now() - t0}ms)`);
    else log(`parsed script_docs logs (${result.tokens.length} tokens, ${Date.now() - t0}ms)`);
    if (result.missing.length > 0) {
      log(
        `missing log files in ${settings.logsPath}: ${result.missing.join(", ")} (run script_docs in the game console)`
      );
    }
  }
  // No usable user dump: fall back to the bundled script_docs snapshot (shipped
  // per game under data/<gameId>/script_docs). The user's own dump, once it
  // exists, wins outright — it matches their exact game version.
  if (scriptTokens.length === 0 && bundledDumpsDir) {
    const t0 = Date.now();
    const cacheFile = path.join(storageDir, `docsCacheBundled${activeProfile().cacheSuffix}.json`);
    const result = loadTokenData(bundledDumpsDir, cacheFile, force);
    scriptTokens = result.tokens;
    modifierTemplates = result.templates;
    tokensFromScriptDocs = scriptTokens.length > 0;
    tokensFromBundledDumps = tokensFromScriptDocs;
    log(
      `bundled script_docs snapshot: ${result.tokens.length} tokens ` +
        `(${result.fromCache ? "cache" : "parsed"}, ${Date.now() - t0}ms; ` +
        `dump your own script_docs to match your exact game version)`
    );
  }
  if (scriptTokens.length === 0 && !settings.logsPath) {
    log("script_docs logs path not found; engine tokens come from the bundled wiki docs only.");
  }
  data.setModifierTemplates(modifierTemplates);
  if (data.modifierTemplates.length > 0) {
    log(
      `templated modifiers: ${data.modifierTemplates.length} templates expand against the definition index`
    );
  }
  const t1 = Date.now();
  const wikiTokens = loadWikiTokens(wikidocsDir);
  // With the user's OWN dump loaded, a name the dump does not have does not
  // exist in their patch, so the wiki's extras are dropped rather than offered.
  // The bundled snapshot does not get this treatment: it may be older than the
  // user's game, so "not in the snapshot" is not evidence of anything.
  const ownDump = tokensFromScriptDocs && !tokensFromBundledDumps;
  const merged = mergeWikiTokens(scriptTokens, wikiTokens, { dropUnknownNames: ownDump });
  tokensWikiOnly = merged.added;
  data.setTokens(merged.tokens);
  log(
    `wiki docs: ${wikiTokens.length} tokens, ${merged.enriched} usage examples merged in, ` +
      `${merged.added} added${merged.dropped > 0 ? `, ${merged.dropped} dropped as absent from your script_docs` : ""}, ` +
      `total ${merged.tokens.length} (${Date.now() - t1}ms)`
  );

  // on_actions.log sits next to the other script_docs dumps; same fallback.
  const onActionsDir =
    settings.logsPath && fs.existsSync(path.join(settings.logsPath, "on_actions.log"))
      ? settings.logsPath
      : bundledDumpsDir || settings.logsPath;
  data.onActionScopes = onActionsDir ? parseOnActionsLog(onActionsDir) : new Map();
  if (data.onActionScopes.size > 0) log(`on_actions.log: ${data.onActionScopes.size} on_action root scopes`);

  // Lowest priority first: bundled snapshot, then the user's folders. Games
  // whose script_docs live outside logs/ (newer Jomini titles) still dump data
  // types to logs/, so the sibling logs folder of a docs-style logsPath is probed too.
  const dataTypeDirs: Array<string | null> = [bundledDataTypesDir || null];
  if (settings.logsPath) {
    const sibling = path.resolve(settings.logsPath, "..", "logs");
    if (sibling.toLowerCase() !== path.resolve(settings.logsPath).toLowerCase()) dataTypeDirs.push(sibling);
    dataTypeDirs.push(settings.logsPath);
  }
  data.dataTypes = loadDataTypes(dataTypeDirs);
  // Promote game, dependency-parent and mod data_binding macros as global
  // [ … ] functions, in load order (a framework mod's macros are the case that
  // matters: the mod being edited calls them but does not define them).
  const macroRoots = [
    settings.gamePath,
    ...dependencyParentRoots(),
    settings.modPath,
    ...workspaceModRoots(),
  ].filter((r): r is string => r !== null);
  const macros = loadDataBindingMacros(macroRoots, data.dataTypes);
  if (macros > 0) log(`data_binding macros: ${macros} promoted into data-function completion/hover`);
  if (data.dataTypes.source === "bundled wiki") {
    log(
      `data types: ${data.dataTypes.count} entries from the bundled wiki tables ` +
        `(run "${activeProfile().dataTypesCommand ?? "DumpDataTypes"}" in the game console for the ` +
        `complete, version-exact set)`
    );
  } else {
    log(`data types: ${data.dataTypes.count} entries incl. data-type dumps`);
  }

  const t2 = Date.now();
  const usageCache = storageDir
    ? path.join(storageDir, `dataFnUsage${activeProfile().cacheSuffix}.json`)
    : null;
  const generation = ++usageGeneration;
  void loadDataFnUsageAsync(settings.gamePath, settings.locLanguage, usageCache, force)
    .then((result) => {
      if (generation !== usageGeneration) return; // superseded by a newer load
      data.dataFnUsage = result.usage;
      if (result.usage.exprs > 0) {
        log(
          `data-function usage: ${result.usage.exprs} expressions, ${result.usage.starts.size} chain starts ` +
            `from ${result.usage.files} vanilla files (${result.fromCache ? "cache" : "scan"}, ${Date.now() - t2}ms)`
        );
      }
    })
    .catch((e) => log(`data-function usage harvest failed: ${String(e)}`));
}

let usageGeneration = 0;

/** Path bundle for gui navigation/hover (FIOS template/type store). */
function guiPaths(): GuiPaths {
  return {
    gamePath: settings.gamePath,
    modPath: settings.modPath,
    parentPaths: settings.parentPaths ?? [],
    engineRoots: engineRoots(),
  };
}

/**
 * In-memory harvest of engine/game/parent/mod `define:` constants and `#tag` loc
 * text-formats (small — a few thousand entries; not persisted into the vanilla
 * index cache). Rebuilt fresh so a paths change / mod edit cannot leave stale
 * layers. Engine (jomini) is the lowest layer, the mod the highest (last-wins).
 */
function harvestEngineData(): void {
  sendProgress("engine", "start", "harvesting engine tokens…");
  const t0 = Date.now();
  // Every workspace mod is a "mod" layer (multi-mod workspaces), added after
  // engine + game + dependency parents so mod definitions win.
  const parentLayerRoots = dependencyParentRoots();
  const modLayerRoots = [...(settings.modPath ? [settings.modPath] : []), ...workspaceModRoots()];
  const defines = new DefinesIndex();
  for (const root of engineRoots()) defines.addLayer(root, "jomini");
  if (settings.gamePath) defines.addLayer(settings.gamePath, "game");
  for (const root of parentLayerRoots) defines.addLayer(root, "parent");
  for (const root of modLayerRoots) defines.addLayer(root, "mod");
  data.defines = defines;
  const tDef = Date.now() - t0;

  const t1 = Date.now();
  const textFormatting = new TextFormattingIndex();
  for (const root of engineRoots()) textFormatting.addLayer(root, "jomini");
  if (settings.gamePath) textFormatting.addLayer(settings.gamePath, "game");
  for (const root of parentLayerRoots) textFormatting.addLayer(root, "parent");
  for (const root of modLayerRoots) textFormatting.addLayer(root, "mod");
  data.textFormatting = textFormatting;
  log(
    `harvested defines: ${defines.count} constants (${tDef}ms), ` +
      `loc text formats: ${textFormatting.count} tags (${Date.now() - t1}ms)`
  );
  sendProgress("engine", "done");
}

const yieldNow = () => new Promise<void>((resolve) => setImmediate(resolve));

function readFileStripBom(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  } catch {
    return null;
  }
}

/**
 * Read a batch of files with several reads in flight (perf round 2).
 *
 * The scan used readFileSync per file, so exactly one read was ever
 * outstanding and every file cost a full disk round trip. That is the whole
 * difference between a cold and a warm first open: measured on game + AGOT,
 * time-to-indexed was 185 s cold against 32 s warm, and a CPU profile
 * attributed 157 s of the cold run (80% of the process) to readFileUtf8
 * waiting. Reads issued together let the drive overlap them: on a 3,852-file
 * mod, 437 ms serial against 239 ms with this, warm, where there is no
 * latency left to hide.
 *
 * Bounded by libuv's thread pool (4 by default), so the concurrency here is
 * an upper bound, not a promise. Order is preserved and a failed read is
 * `null`, exactly like the serial version it replaces.
 */
async function readBatchStripBom(files: string[]): Promise<Array<string | null>> {
  const out = new Array<string | null>(files.length);
  let next = 0;
  const workers = Math.min(16, files.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const i = next++;
        if (i >= files.length) return;
        try {
          const content = await fs.promises.readFile(files[i], "utf8");
          out[i] = content.replace(/^﻿/, "");
        } catch {
          out[i] = null;
        }
      }
    })
  );
  return out;
}

/**
 * Chunked schema-driven folder scan: yields to the event loop between file
 * batches so requests keep flowing, reports progress and aborts when a newer
 * scan supersedes it.
 */
async function scanRootChunked(
  root: string,
  source: "vanilla" | "parent" | "mod",
  generation: number,
  onProgress?: (percent: number, message: string) => void
): Promise<Definition[] | null> {
  if (faultScan) injectScanFault();
  const tList = Date.now();
  const defs: Definition[] = [];
  const work: Array<{ entry: SchemaData["entries"][number]; files: string[] }> = [];
  let totalFiles = 0;
  for (const entry of schema.entries) {
    const dir = path.join(root, ...entry.path.split("/"));
    // The listing shares the read loop's yield budget below. It used to run to
    // completion first, and for its whole duration the server answered no
    // request: completion and hover stalled behind it.
    let files: string[] = [];
    for (const file of iterFiles(dir, entry.ext ?? ".txt")) {
      if (file === null) {
        if (generation !== scanGeneration) return null; // superseded
        await yieldNow();
      } else {
        files.push(file);
      }
    }
    if (entry.kind === "loc_key") {
      files = files.filter((f) => isWantedLocFile(path.relative(root, f), settings.locLanguage));
    }
    work.push({ entry, files });
    totalFiles += files.length;
  }
  perf(`scan ${path.basename(root)} listed ${totalFiles} files ${Date.now() - tList}ms`);
  const tRead = Date.now();
  let done = 0;
  const BATCH = 150;
  for (const { entry, files } of work) {
    for (let i = 0; i < files.length; i += BATCH) {
      if (generation !== scanGeneration) return null; // superseded
      const batch = files.slice(i, i + BATCH);
      const contents = await readBatchStripBom(batch);
      if (generation !== scanGeneration) return null; // superseded while reading
      for (let k = 0; k < batch.length; k++) {
        const content = contents[k];
        if (content !== null) pushAll(defs, extractDefinitions(content, entry, batch[k], source));
      }
      done += batch.length;
      onProgress?.(totalFiles === 0 ? 100 : Math.round((done / totalFiles) * 100), entry.path);
      await yieldNow();
    }
  }
  perf(
    `scan ${path.basename(root)} (${source}) read+extract ${defs.length} defs ` +
      `from ${totalFiles} files ${Date.now() - tRead}ms`
  );
  return defs;
}

/**
 * Definitions AND references for one workspace-mod root, from a single walk
 * that reads and parses each `.txt` once (perf round 3). Runs for the mod AND
 * every other workspace mod, so find-references/usage counts span multi-mod
 * workspaces. Read-only dependency parents stay definition-only and keep
 * `scanRootChunked`; so does vanilla, whose references are lazy (AD-4).
 *
 * Returns the definition count, or null when a newer scan superseded this one.
 */
async function scanModRootBoth(root: string, generation: number): Promise<number | null> {
  if (faultScan) injectScanFault();
  const t0 = Date.now();
  const result = await scanModRootFused(root, {
    schema,
    // Both callers are workspace mods; dependency parents never reach here.
    source: "mod",
    locLanguage: settings.locLanguage,
    isEngineToken,
    readBatch: readBatchStripBom,
    superseded: () => generation !== scanGeneration,
    yieldNow,
    addReferences: (refs) => data.refIndex.addAll(refs),
    setNamespaces: (file, ns) => namespacesByFile.set(file.toLowerCase(), ns),
  });
  if (result === null) return null;
  // Schema definitions first, then the implicit ones the reference pass finds,
  // which is the order the two passes added them in.
  data.index.addAll(result.defs);
  if (result.implicitDefs.length > 0) data.index.addAll(result.implicitDefs);
  rebuildModNamespaces();
  perf(`scan ${path.basename(root)} listed ${result.files} files ${result.listMs}ms`);
  perf(
    `scan ${path.basename(root)} (mod) read+extract ${result.defs.length} defs ` +
      `and ${result.references} refs from ${result.files} files ${Date.now() - t0 - result.listMs}ms`
  );
  log(
    `indexed ${path.basename(root)} references: ` +
      `${result.references} usage sites in ${result.scriptFiles} files (${Date.now() - t0}ms)`
  );
  return result.defs.length;
}

function rebuildModNamespaces(): void {
  data.modNamespaces.clear();
  for (const list of namespacesByFile.values()) {
    for (const ns of list) data.modNamespaces.add(ns);
  }
}

/** Ordered parent-mod roots from <mod>/<configDir>/playset.json, if present. */
function readPlayset(modPath: string): string[] {
  const file = path.join(resolveConfigDir(modPath, activeProfile()), "playset.json");
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const list: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.parents)
        ? parsed.parents
        : [];
    const roots: string[] = [];
    for (const p of list) {
      if (typeof p !== "string") continue;
      const abs = path.isAbsolute(p) ? p : path.join(modPath, p);
      if (fs.existsSync(abs)) roots.push(abs);
      else log(`playset parent not found, skipped: ${p}`);
    }
    return roots;
  } catch (err) {
    log(`playset.json ignored: ${String(err)}`);
    return [];
  }
}

async function buildIndex(): Promise<void> {
  const tBuild = Date.now();
  const generation = ++scanGeneration;
  clearPathCaches();
  schema = loadSchema([...(settings.modPath ? [settings.modPath] : []), ...workspaceModRoots()], log);
  data.completableKinds = new Set([
    ...schema.entries.filter((e) => e.completable !== false).map((e) => e.kind),
    "saved_scope",
    ...VARIABLE_KINDS,
  ]);
  data.index = new DefinitionIndex();
  // The shared identifiers of the index we are replacing die with it (§C2).
  resetInternTable();
  data.refIndex.clear();
  namespacesByFile.clear();
  data.modNamespaces.clear();
  refreshModOrigin();
  refreshLazyRefs();
  refreshExampleSites();
  harvestEngineData();
  rescanDigests.clear();
  indexing = true;
  sendProgress("index", "start", "indexing mod definitions…");
  // A refresh queued before the rebuild would land mid-scan (§B4).
  cancelRefreshTimer();
  sendStatus();

  try {
    if (settings.modPath) {
      const t0 = Date.now();
      const count = await scanModRootBoth(settings.modPath, generation);
      if (count === null) return;
      indexChanged("mod scan");
      log(`indexed mod: ${count} definitions (${Date.now() - t0}ms)`);
    }

    const wsMods = new Set(workspaceModRoots().map((r) => r.toLowerCase()));
    for (const parent of parentRoots()) {
      const t1 = Date.now();
      // Workspace mods are edited mods like any other: source "mod" (full
      // reference indexing, views, ranking). Only dependency parents from
      // the parent-mods setting / playset.json are read-only "parent" context.
      const isWorkspaceMod = wsMods.has(parent.toLowerCase());
      let count: number | null;
      if (isWorkspaceMod) {
        count = await scanModRootBoth(parent, generation);
      } else {
        const parentDefs = await scanRootChunked(parent, "parent", generation);
        count = parentDefs === null ? null : parentDefs.length;
        if (parentDefs !== null) data.index.addAll(parentDefs);
      }
      if (count === null) return;
      indexChanged(`parent scan ${path.basename(parent)}`);
      log(
        `indexed ${isWorkspaceMod ? "workspace mod" : "parent mod"} ${path.basename(parent)}: ` +
          `${count} definitions (${Date.now() - t1}ms)`
      );
    }

    if (settings.gamePath) {
      const gamePath = settings.gamePath;
      const t0 = Date.now();
      const version = detectGameVersion(gamePath);
      const cacheFile = path.join(
        storageDir,
        `vanillaIndex${activeProfile().cacheSuffix}-${settings.locLanguage}.json`
      );
      let defs = loadIndexCache(cacheFile, version);
      if (defs) {
        log(
          `loaded vanilla index from cache: ${defs.length} definitions, game ${version} (${Date.now() - t0}ms)`
        );
      } else {
        log(`indexing vanilla (game ${version})...`);
        const progress = await connection.window.createWorkDoneProgress();
        progress.begin(`${activeProfile().shortName}: indexing vanilla`, 0, "scanning...", false);
        try {
          // Engine layer first so game definitions come later (game shadows
          // jomini, matching load order). Cached together with vanilla.
          const engineDefs: Definition[] = [];
          for (const engine of engineRoots()) {
            const d = await scanRootChunked(engine, "vanilla", generation);
            if (d === null) return;
            pushAll(engineDefs, d);
          }
          defs = await scanRootChunked(gamePath, "vanilla", generation, (pct, msg) =>
            progress.report(pct, msg)
          );
          if (defs !== null && engineDefs.length > 0) {
            log(`indexed engine layer (jomini): ${engineDefs.length} definitions`);
            // Appended in place (engine first, so game shadows jomini): a third
            // array of a million definitions is pure heap pressure.
            pushAll(engineDefs, defs);
            defs = engineDefs;
          }
        } finally {
          progress.done();
        }
        if (defs === null) return; // superseded
        try {
          saveIndexCache(cacheFile, version, defs);
        } catch (err) {
          log(`could not write vanilla index cache: ${String(err)}`);
        }
        log(`indexed vanilla: ${defs.length} definitions (${Date.now() - t0}ms)`);
      }
      if (generation !== scanGeneration) return;
      data.index.addAll(defs);
      indexChanged("vanilla scan");
    }
  } finally {
    if (generation === scanGeneration) {
      // The scan built every bucket with `[]` + push, which leaves V8's
      // 16-slot growth capacity attached to names holding one entry (perf
      // round 3). Reclaim it once, here, rather than on every mutation.
      const tCompact = Date.now();
      data.index.compact();
      data.refIndex.compact();
      perf(`compacted index buckets ${Date.now() - tCompact}ms`);
      indexing = false;
      sendProgress("index", "done");
      sendStatus();
      // §B4: the build's one and only refresh, fired from the finally so a scan
      // that returned null (superseded root) or threw cannot strand the open
      // editors on TextMate colours forever.
      fireRefresh("index built");
      if (perfOn()) {
        // Post-GC only when the server was started with --expose-gc (the bench
        // harness does; a normal client does not, and reads a live-heap number).
        const gc = (globalThis as { gc?: () => void }).gc;
        gc?.();
        const mem = process.memoryUsage();
        perf(
          `index built: ${data.index.stats().total} definitions, ` +
            `${internedCount()} shared identifiers, ` +
            `heap ${(mem.heapUsed / 1048576).toFixed(0)} MB${gc ? " (post-gc)" : ""}, ` +
            `rss ${(mem.rss / 1048576).toFixed(0)} MB, ${Date.now() - tBuild}ms`
        );
      }
    }
  }
}

/** Fire-and-forget index build whose failure is logged and attributable (§A1):
 * a throw here used to leave the server alive with an empty index, or dead. */
function startIndexBuild(reason: string): void {
  void buildIndex().catch((err) => {
    logFatal(`index build failed (${reason})`, err);
  });
}

/**
 * Digest of the bytes the index currently holds per rescanned file (§B3).
 * A save fires the watcher more than once (the write plus its metadata update,
 * and once per overlapping watcher root), and re-parsing identical bytes only
 * buys another index-changed fan-out. Cleared whenever the index is rebuilt.
 */
const rescanDigests = new Map<string, string>();

function contentDigest(content: string | null): string {
  if (content === null) return "<deleted>";
  return `${content.length}:${createHash("sha1").update(content).digest("base64")}`;
}

function rescanModFile(fsPath: string): void {
  const lower = fsPath.toLowerCase();
  const wsRoot = workspaceRootOf(fsPath);
  const parentRoot = wsRoot ? null : parentRoots().find((r) => lower.startsWith(r.toLowerCase()));
  if (!wsRoot && !parentRoot) return;
  const root = wsRoot ?? parentRoot!;
  const source = wsRoot ? ("mod" as const) : ("parent" as const);

  const entry = classifyFile(root, fsPath, schema.entries);
  const isScript = lower.endsWith(".txt");
  if (!entry && !isScript) return;
  if (entry?.kind === "loc_key" && !isWantedLocFile(path.relative(root, fsPath), settings.locLanguage))
    return;

  const tParse = Date.now();
  const content = fs.existsSync(fsPath) ? readFileStripBom(fsPath) : null;
  const digest = contentDigest(content);
  if (rescanDigests.get(lower) === digest) {
    perf(`rescan ${path.basename(fsPath)} unchanged bytes, skipped ${Date.now() - tParse}ms`);
    return;
  }
  rescanDigests.set(lower, digest);
  // Sub-spans: the whole rescan is 3ms on a 1.9M-definition index and ~500ms on
  // the AGOT-sized one for the SAME file, so a save trace has to say which part
  // of it scales with the workspace (§B2).
  perfSpan("rescan defs", () => {
    data.index.removeFile(fsPath);
    if (entry && content !== null) {
      data.index.addAll(extractDefinitions(content, entry, fsPath, source));
    }
  });
  // References and namespaces are tracked for every workspace mod (matching
  // buildIndex); read-only dependency parents stay definition-only.
  const isWorkspaceMod = wsRoot !== null;
  if (isWorkspaceMod && isScript) {
    perfSpan("rescan refs remove", () => data.refIndex.removeFile(fsPath));
    namespacesByFile.delete(fsPath.toLowerCase());
    if (content !== null) {
      const extracted = perfSpan("rescan refs extract", () =>
        extractReferences(content, fsPath, source, schema, isEngineToken)
      );
      perfSpan("rescan refs add", () => {
        data.refIndex.addAll(extracted.references);
        data.index.addAll(extracted.implicitDefs);
      });
      if (extracted.namespaces.length > 0) namespacesByFile.set(fsPath.toLowerCase(), extracted.namespaces);
    }
    perfSpan("rescan namespaces", () => rebuildModNamespaces());
  }
  perf(`rescan ${path.basename(fsPath)} parse+extract ${Date.now() - tParse}ms`);
  indexChanged(`rescan ${path.basename(fsPath)}`);
  log(`re-indexed ${path.basename(fsPath)}`);
}

// ---- lifecycle ---------------------------------------------------------------

/**
 * Bundled-data locations for the ACTIVE profile: the per-game folder is
 * <root>/<gameId>/, where root is the client's dataDir or data/ next to the
 * bundle (dist/server.js sits next to data/ in the repo checkout, the .vsix
 * and the release tarball alike). wikidocs/ and freqs.json are derived
 * independently from it: a game may ship freqs without a wiki mirror, and the
 * deprecated wikidocsDir override moves the wiki mirror alone. Both fail soft
 * when the game bundles no data. Re-derived whenever the game profile changes.
 */
function deriveBundledDataDirs(): void {
  const gameDir = path.join(clientDataDir || path.resolve(__dirname, "..", "data"), activeProfile().id);
  wikidocsDir = clientWikidocsDir;
  if (!wikidocsDir) {
    const bundled = path.join(gameDir, "wikidocs");
    if (fs.existsSync(bundled)) wikidocsDir = bundled;
  }
  freqsDir = fs.existsSync(path.join(gameDir, "freqs.json")) ? gameDir : "";
  // Bundled script_docs / data-type dumps (data/<gameId>/script_docs,
  // data/<gameId>/data_types): the out-of-box fallback when the user has not
  // dumped their own. The user's own dumps always win.
  const dumps = path.join(gameDir, "script_docs");
  bundledDumpsDir = fs.existsSync(dumps) ? dumps : "";
  const dataTypes = path.join(gameDir, "data_types");
  bundledDataTypesDir = fs.existsSync(dataTypes) ? dataTypes : "";
}
let clientDataDir = "";
let clientWikidocsDir = "";
let bundledDumpsDir = "";
let bundledDataTypesDir = "";
let clientOwnFileWatcher = false;
let clientWatchedFilesDynamic = false;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const init = (params.initializationOptions ?? {}) as Partial<ParadoxInitOptions>;
  storageDir = init.storageDir ?? "";
  clientDataDir = init.dataDir ?? "";
  clientWikidocsDir = init.wikidocsDir ?? "";
  // Client capabilities (PROTOCOL.md §Initialization): rich hover markup,
  // command links and command actions are emitted only where the client
  // declared it implements them.
  const clientCaps = resolveClientCapabilities(init, params.capabilities);
  setClientCapabilities(clientCaps);
  clientOwnFileWatcher = clientCaps.ownFileWatcher;
  clientWatchedFilesDynamic =
    params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
  // Merge onto the defaults: bare clients may send partial settings (e.g.
  // only gameId), and every downstream consumer assumes the full shape.
  if (init.settings) settings = { ...defaultSettings(), ...init.settings };
  setHoverDetail(settings.hoverDetail ?? "standard");
  settings.calendar = sanitizeCalendar(settings.calendar);
  setActiveProfile(resolveProfile(settings.gameId));
  deriveBundledDataDirs();
  if (!storageDir) {
    storageDir = path.join(os.tmpdir(), "px-lsp");
    try {
      fs.mkdirSync(storageDir, { recursive: true });
    } catch {
      storageDir = "";
    }
  }
  if (!settings.modPath && !settings.workspaceMods?.length) {
    const rootUri = params.workspaceFolders?.[0]?.uri ?? params.rootUri ?? null;
    if (rootUri?.startsWith("file:")) settings.modPath = URI.parse(rootUri).fsPath;
  }

  return {
    serverInfo: { name: "px-lsp", version: SERVER_VERSION },
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: true,
      },
      completionProvider: { resolveProvider: true, triggerCharacters: [":", ".", "[", "'", "|", "#", "/"] },
      signatureHelpProvider: { triggerCharacters: ["{", "("], retriggerCharacters: ["=", ","] },
      hoverProvider: true,
      definitionProvider: true,
      codeActionProvider: true,
      inlayHintProvider: true,
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      colorProvider: true,
      referencesProvider: true,
      documentFormattingProvider: true,
      renameProvider: { prepareProvider: true },
      workspaceSymbolProvider: true,
      semanticTokensProvider: {
        legend: SEMANTIC_LEGEND,
        full: true,
        range: false,
      },
    },
  };
});

connection.onInitialized(() => {
  // Self-diagnosis for bare clients: the resolved bundled-data locations are
  // the difference between "knows the engine" and silent degraded mode.
  if (wikidocsDir || freqsDir) {
    log(`bundled data for '${activeProfile().id}': ${wikidocsDir || freqsDir}`);
  } else {
    log(
      `no bundled data found for '${activeProfile().id}' (looked next to the server bundle); ` +
        `engine tokens come from script_docs logs only`
    );
  }
  // A client declaring ownFileWatcher runs its own tuned watcher and pushes
  // paradox/modFileChanged; for every other client, watch the workspace
  // ourselves when the client supports dynamic registration.
  if (!clientOwnFileWatcher && clientWatchedFilesDynamic) {
    void connection.client.register(DidChangeWatchedFilesNotification.type, {
      watchers: [{ globPattern: "**/*.{txt,yml,gui,mod}" }, { globPattern: "**/metadata.json" }],
    });
  }
  // Bundled frequency tables for completion ranking (§C3); fail-soft to empty.
  applyFreqs();
  completion.setSettings(settings);
  loadDocs(false);
  startIndexBuild("startup");
});

connection.onDidChangeWatchedFiles((params) => {
  for (const change of params.changes) {
    if (!change.uri.startsWith("file:")) continue;
    handleModFileChange(URI.parse(change.uri).fsPath);
  }
});

// ---- custom protocol ----------------------------------------------------------

connection.onNotification(configChangedNotification, (incoming: ParadoxSettings) => {
  const newSettings: ParadoxSettings = { ...defaultSettings(), ...incoming };
  const gameChanged = resolveProfile(newSettings.gameId) !== activeProfile();
  if (gameChanged) {
    setActiveProfile(resolveProfile(newSettings.gameId));
    // Bundled wiki/freqs are per-game; re-derive and re-rank for the new one.
    deriveBundledDataDirs();
    applyFreqs();
  }
  const pathsChanged =
    gameChanged ||
    newSettings.gamePath !== settings.gamePath ||
    newSettings.logsPath !== settings.logsPath ||
    newSettings.modPath !== settings.modPath ||
    JSON.stringify(newSettings.parentPaths ?? []) !== JSON.stringify(settings.parentPaths ?? []) ||
    JSON.stringify(newSettings.workspaceMods ?? []) !== JSON.stringify(settings.workspaceMods ?? []) ||
    newSettings.locLanguage !== settings.locLanguage;
  const diagChanged =
    JSON.stringify(newSettings.diagnosticsIgnore) !== JSON.stringify(settings.diagnosticsIgnore) ||
    JSON.stringify(newSettings.diagnosticsIgnorePatterns) !==
      JSON.stringify(settings.diagnosticsIgnorePatterns) ||
    newSettings.diagnosticsVanilla !== settings.diagnosticsVanilla;
  settings = newSettings;
  setHoverDetail(settings.hoverDetail ?? "standard");
  settings.calendar = sanitizeCalendar(settings.calendar);
  completion.setSettings(settings);
  if (pathsChanged) {
    log("paths changed; rebuilding data...");
    loadDocs(false);
    startIndexBuild("paths changed");
  }
  // Re-validate open documents so suppression/vanilla changes apply immediately.
  if (diagChanged || pathsChanged) {
    for (const doc of documents.all()) validateDocument(doc);
  }
});

/**
 * Per-path debounce for watcher events (§B3). One Ctrl+S produces several:
 * the editor's write, the metadata update behind it, and one more per watcher
 * root that contains the file. ~150ms also keeps a half-written large file
 * from being parsed into the index and immediately parsed again.
 */
const MOD_CHANGE_DEBOUNCE_MS = 150;
const pendingModChanges = new Map<string, { fsPath: string; timer: ReturnType<typeof setTimeout> }>();

function handleModFileChange(fsPath: string): void {
  perf(`modFileChanged ${perfName(fsPath)}`);
  const key = fsPath.toLowerCase();
  const pending = pendingModChanges.get(key);
  if (pending) clearTimeout(pending.timer);
  pendingModChanges.set(key, {
    fsPath,
    timer: setTimeout(() => {
      pendingModChanges.delete(key);
      applyModFileChange(fsPath);
    }, MOD_CHANGE_DEBOUNCE_MS),
  });
}

/**
 * Freshness guard (§B3): a request that reads the index runs the pending
 * rescans first, so the debounce can never answer out of a stale index. Costs
 * a map size check except in the ~150ms after a save. The view/webview
 * requests do not call this: they are refreshed by the index-changed
 * notification the rescan itself fires.
 */
function flushModFileChanges(): void {
  if (pendingModChanges.size === 0) return;
  const pending = [...pendingModChanges.values()];
  pendingModChanges.clear();
  for (const { fsPath, timer } of pending) {
    clearTimeout(timer);
    applyModFileChange(fsPath);
  }
}

/** A traced handler that READS the index: pending rescans land first (§B3). */
function indexRead<T>(label: string, fn: () => T): T {
  flushModFileChanges();
  return perfSpan(label, fn);
}

function mentionsTextFormatting(fsPath: string): boolean {
  try {
    return fs.readFileSync(fsPath, "utf8").includes("textformatting");
  } catch {
    return false;
  }
}

function applyModFileChange(fsPath: string): void {
  rescanModFile(fsPath);
  const lower = fsPath.toLowerCase();
  if (lower.endsWith(".mod") || lower.endsWith("metadata.json")) refreshModOrigin();
  if (lower.endsWith(".gui")) invalidateGuiDefsCache();
  // Full re-harvest when a mod defines file or a gui file WITH textformatting
  // changed. Not on every .gui: the harvest reads only those out of gui/, and
  // autosave fires this after every GUI editor gesture.
  if (
    lower.replace(/\\/g, "/").includes("common/defines/") ||
    (lower.endsWith(".gui") && mentionsTextFormatting(fsPath))
  )
    harvestEngineData();
}

connection.onNotification(modFileChangedNotification, (params: ModFileChangeParams) => {
  handleModFileChange(params.fsPath);
});

connection.onRequest(reloadDocsRequest, (params: ReloadDocsParams): ReloadDocsResult => {
  loadDocs(params.force);
  return { tokens: data.tokens.length };
});

connection.onRequest(indexStatsRequest, () => data.index.stats());

connection.onRequest(modOverviewRequest, (params: ModScopedParams | null) =>
  computeModOverview(data, focusFilter(params?.modRoot))
);

connection.onRequest(locCoverageRequest, (params: ModScopedParams | null) => {
  // Coverage is inherently per-mod: default to the first workspace mod when
  // the client sends no focus (older clients, tests).
  const root = params?.modRoot ?? settings.modPath ?? workspaceModRoots()[0] ?? null;
  return computeLocCoverage(data, root, settings.locLanguage, schema.entries, focusFilter(root));
});

connection.onRequest(overridesRequest, (params: ModScopedParams | null) =>
  computeOverrides(data, settings.gamePath, focusFilter(params?.modRoot))
);

connection.onRequest(eventGraphRequest, (params: EventGraphParams) =>
  computeEventGraph(data, params ?? {}, focusFilter(params?.modRoot))
);

// The dynasty picker list, or one dynasty's houses and members. The whole
// character corpus is read once per index revision (see overview/dynastyTree.ts);
// a profile without a `dynasty` schema kind answers supported: false.
connection.onRequest(dynastyTreeRequest, (params: DynastyTreeParams | null) =>
  computeDynastyTree(data, params ?? {}, focusFilter(params?.modRoot))
);

// What an event editor may offer: the profile's structure table, the schema's
// reference fields resolved through the index, and the script_docs tokens.
// Never a hand-written name list.
connection.onRequest(eventVocabularyRequest, (params: EventVocabularyParams | null) =>
  computeEventVocabulary(data, schema, focusFilter(params?.modRoot))
);

// The value set one VALUE belongs to, for the graph inspector's nested rows:
// resolve the value through the index, answer every definition of its kind.
connection.onRequest(eventValueOptionsRequest, (params: EventValueOptionsParams | null) =>
  computeValueOptions(data, params?.value ?? "", focusFilter(params?.modRoot))
);

// The theme's illustration, through the game's own event_themes ->
// event_backgrounds hops. Answering "nothing resolved" is a real answer.
connection.onRequest(eventBannerRequest, (params: EventBannerParams) =>
  computeEventBanner(data, params?.theme ?? "")
);

// What a visual creator may offer for one definition kind: the schema entry,
// the harvested structure keys, the index (options and the mod's own
// definitions) and the modifier tokens. Never a hand-written field list.
connection.onRequest(definitionFormRequest, (params: DefinitionFormParams | null) =>
  computeDefinitionForm(data, schema, params ?? { kind: "" }, focusFilter(params?.modRoot))
);

// The script sibling of guiSourceEdit: the creators' writes as offsets into the
// text the host handed over, applied there as one WorkspaceEdit.
connection.onRequest(definitionEditRequest, (params: DefinitionEditParams | null) =>
  computeDefinitionEdits(params)
);

// How the game itself prints a modifier: the profile's format folder, the loc
// index and the game's own texticon blocks. A profile that names no formats
// source answers null instead of a made-up label.
connection.onRequest(modifierFormatsRequest, (params: ModifierFormatsParams | null) =>
  computeModifierFormats(data, activeProfile().modifierFormats, settings.gamePath, params?.lines)
);

connection.onRequest(guiTreeRequest, (params: GuiTreeParams) => buildGuiTree(params.text ?? ""));

/** Loc keys resolve through the index (configured language, english files as fallback). */
function locValue(key: string): string | undefined {
  return data.index.lookup(key).find((d) => d.kind === "loc_key" && d.value !== undefined)?.value;
}

function guiTextResolver(params: GuiLayoutParams): ((raw: string) => ResolvedText) | undefined {
  if (params.loc === "raw") return undefined;
  return (raw) => resolveGuiText(raw, { loc: locValue, previewValues: params.previewValues });
}

connection.onRequest(guiLayoutRequest, (params: GuiLayoutParams) =>
  computeGuiLayoutResult(
    params.text ?? "",
    settings.gamePath,
    settings.modPath,
    settings.parentPaths,
    engineRoots(),
    params.visibility,
    guiTextResolver(params)
  )
);

/** The type chain a size guard resolves through is the same store the preview lays out with. */
function guiDefsForEdits() {
  return getGuiDefs(settings.gamePath, settings.modPath, settings.parentPaths, engineRoots());
}

/** Texture paths resolve the way the game loads assets: mod over parents over game. */
function textureRoots() {
  return {
    gamePath: settings.gamePath,
    modPath: settings.modPath,
    parentPaths: settings.parentPaths,
    engineRoots: engineRoots(),
  };
}

/** The `GetScriptedGui(...)` index, cached alongside the template/type store. */
function guiLinks() {
  return getGuiScriptLinks(settings.gamePath, settings.modPath, settings.parentPaths, engineRoots());
}

// One op or a batch, never both: a request carrying the two shapes cannot say
// which one the caller meant, and guessing would write the wrong set.
connection.onRequest(guiSourceEditRequest, (params: GuiSourceEditParams) => {
  const text = params.text ?? "";
  const defs = guiDefsForEdits();
  if (params.ops) return params.op ? null : computeGuiSourceEdits(text, params.ops, defs);
  return computeGuiSourceEdit(text, params.op, defs);
});

// The inspector reads through the same store the preview lays out with, so a
// row it shows is a value the canvas used.
connection.onRequest(guiWidgetInfoRequest, (params: GuiWidgetInfoParams) =>
  computeGuiWidgetInfo(params.text ?? "", params.line, guiDefsForEdits(), {
    placement: params.placement === true,
    roots: textureRoots(),
    viewport: VIEWPORT,
  })
);

// What a designer palette may offer: the bundled harvest for the active game
// plus this document's own declarations. Never a hand-written name list.
connection.onRequest(guiVocabularyRequest, (params: GuiVocabularyParams) =>
  computeGuiVocabulary(params.text ?? "", activeProfile().guiSchema)
);

// Library tiles: one instance per entry, same store and measurer as the canvas.
connection.onRequest(guiPreviewRequest, (params: GuiPreviewParams): GuiPreviewResult => ({
  previews: previewEntries(
    params.text ?? "",
    (params.entries ?? []).slice(0, GUI_PREVIEW_MAX),
    guiDefsForEdits(),
    profileMeasurer()
  ),
}));

// Real values for the designer's `[...]` chips, read out of a save game.
// Cached per file and mtime: a re-layout asks again and pays nothing, while a
// save written since the last read is picked up on its own.
let saveValues: { key: string; result: GuiSaveValuesResult } | null = null;
connection.onRequest(
  guiSaveValuesRequest,
  async (params: GuiSaveValuesParams): Promise<GuiSaveValuesResult> => {
    const file = params?.path ?? "";
    let key = file;
    try {
      key = `${file}:${fs.statSync(file).mtimeMs}`;
    } catch {
      // Unreadable: the read below reports why, and every attempt asks again.
    }
    if (saveValues?.key === key) return saveValues.result;
    const profile = activeProfile();
    const result = await readSaveValues(file, {
      gameId: profile.id,
      schema: profile.saveSchema,
      loc: locValue,
    });
    saveValues = { key, result };
    return result;
  }
);

// The GUI half of the dependency explorer. Same document text the canvas is
// showing, so a selection answers about what the editor has, not what disk has.
connection.onRequest(guiDependenciesRequest, (params: GuiDependenciesParams) =>
  computeGuiDependencies(data, schema, params.text ?? "", params.line, guiLinks())
);

// Deprecated: the narrow position/size shape, over the same core.
connection.onRequest(guiWidgetEditRequest, (params: GuiWidgetEditParams) =>
  computeGuiWidgetEdit(params.text ?? "", params.line, params.property, params.values, guiDefsForEdits())
);

connection.onRequest(eventDetailRequest, (params: EventDetailParams) =>
  params?.id ? computeEventDetail(data, schema, params.id) : null
);

// The Examples Wiki: one row per name the server knows (the search catalog),
// and everything known about one of them (the reading pane).
connection.onRequest(exampleWikiRequest, () => buildExampleWikiIndex(exampleWikiSources()));

connection.onRequest(exampleWikiEntryRequest, (params: ExampleWikiEntryParams) =>
  computeExampleWikiEntry(exampleWikiSources(), params, exampleSites)
);

connection.onRequest(dependenciesRequest, (params: DependenciesParams) => {
  let name = params?.name;
  const kind = params?.kind;
  // Cursor-driven: resolve the word under the position in the open document.
  if (!name && params?.uri && params.position) {
    const doc = documents.get(params.uri);
    if (doc) {
      const range = wordRangeAt(getLineText(doc, params.position.line), params.position.character);
      if (range) name = range.word;
    }
  }
  const guiUses = params?.guiUses
    ? (target: string) => computeGuiUses(data, schema, guiLinks(), target)
    : undefined;
  if (!name) {
    return { def: null, dependents: [], dependencies: [], ...(guiUses ? { guiUses: [] } : {}) };
  }
  return computeDependencies(data, schema, name, kind, guiUses);
});

connection.onRequest(scopeAtRequest, (params: ScopeAtParams): ScopeAtResult | null => {
  // Open documents only: the client's text is the authority, and a status bar
  // asking about a closed/loc/gui document gets "nothing to show", not an error.
  const doc = params?.uri ? documents.get(params.uri) : undefined;
  if (!doc || !isScriptLanguage(doc.languageId) || !params.position) return null;
  const entry = schemaEntryForFile(URI.parse(doc.uri).fsPath);
  return computeScopeAt(
    data,
    doc,
    params.position,
    entry?.rootScopes?.length ? new Set(entry.rootScopes.map((s) => s.toLowerCase())) : null,
    entry
  );
});

connection.onRequest(snippetsRequest, (params: SnippetsParams): SnippetsResult => {
  // Open script documents only; anything else is an empty list, not an error:
  // a host that offers an "Insert Snippet" command asks from wherever the user
  // happens to be.
  const doc = params?.uri ? documents.get(params.uri) : undefined;
  if (!doc || !isScriptLanguage(doc.languageId) || !params.position) return { snippets: [] };
  const entry = schemaEntryForFile(URI.parse(doc.uri).fsPath);
  const { result } = getParse(doc);
  return {
    snippets: buildSnippetList(
      result,
      doc.offsetAt(params.position),
      entry?.kind ?? null,
      activeProfile().skeletons,
      data.tokens,
      freqs.tokens
    ),
  };
});

connection.onRequest(lookupLocRequest, (params: LookupLocParams): LocEntryInfo[] => {
  return data.index
    .lookup(params.key)
    .filter((d) => d.kind === "loc_key")
    .map((d) => ({ file: d.file, line: d.line, source: d.source, value: d.value }));
});

/**
 * What paradox/locText resolves a value with: the loc index for the words, the
 * definition index for the kind a `Get<Something>('name')` chain names, and the
 * active profile's schema for the loc key that kind's names take. A kind the
 * schema states nothing for falls back to the bare name inside locText.ts, so
 * every game answers from its own table with no per-game branch here.
 */
function locTextDeps(): LocTextDeps {
  return {
    loc: locValue,
    kindsOf: (name) => [
      ...new Set(
        data.index
          .lookup(name)
          .filter((d) => d.kind !== "loc_key")
          .map((d) => d.kind)
      ),
    ],
    patternsOf: (kind) => {
      const entry = schema.entries.find((e) => e.kind === kind);
      // The conservative `requiredLoc` first (the pattern nearly every
      // definition of the kind defines), then the full `locPatterns` set.
      return [entry?.requiredLoc?.[0], entry?.locPatterns?.[0]].filter((p): p is string => !!p);
    },
  };
}

// A loc value as the PLAYER reads it: markup stripped and the game's own
// datafunctions resolved through the loc, definition and schema tables.
connection.onRequest(locTextRequest, (params: LocTextParams | null) =>
  computeLocText(params?.keys ?? [], locTextDeps())
);

// ---- language features ----------------------------------------------------------

connection.onCompletion((params) =>
  indexRead(`completion ${perfName(params.textDocument.uri)}`, () => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    if (doc.languageId === "paradox-gui") {
      const result = provideGuiCompletion(data, doc, doc.offsetAt(params.position), settings);
      return { isIncomplete: result.isIncomplete, items: result.items };
    }
    if (doc.languageId === "paradox-loc") {
      // Loc lines complete inside [ ... ] datafunction expressions and #tag formats.
      const linePrefix = doc.getText({
        start: { line: params.position.line, character: 0 },
        end: params.position,
      });
      const result =
        provideDataFnCompletion(data.dataTypes, data.dataFnUsage, linePrefix, data.index, params.position) ??
        provideFormatTagCompletion(data.textFormatting, linePrefix);
      return result ? { isIncomplete: result.isIncomplete, items: result.items } : [];
    }
    if (!isScriptLanguage(doc.languageId)) return [];
    const entry = schemaEntryForFile(URI.parse(doc.uri).fsPath);
    const result = completion.provide(
      doc,
      doc.offsetAt(params.position),
      entry?.rootScopes?.length ? new Set(entry.rootScopes.map((s) => s.toLowerCase())) : null,
      entry
    );
    return { isIncomplete: result.isIncomplete, items: result.items };
  })
);

connection.onCompletionResolve((item) => completion.resolve(item));

connection.onHover((params) =>
  indexRead(`hover ${perfName(params.textDocument.uri)}`, () => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    if (doc.languageId === "paradox-gui") {
      const texture = provideTextureHover(settings, doc, params.position);
      if (texture) return texture;
      return provideGuiHover(data, doc, params.position, guiPaths());
    }
    if (doc.languageId === "paradox-loc") {
      const lineText = doc.getText({
        start: { line: params.position.line, character: 0 },
        end: { line: params.position.line + 1, character: 0 },
      });
      const flat = lineText.replace(/\r?\n$/, "");
      const dataFn =
        provideDataFnHover(
          data.dataTypes,
          data.dataFnUsage,
          flat,
          params.position.character,
          settings.gamePath
        ) ?? provideFormatTagHover(data.textFormatting, flat, params.position.character);
      if (!dataFn) return null;
      return {
        contents: { kind: MarkupKind.Markdown, value: dataFn.markdown },
        range: {
          start: { line: params.position.line, character: dataFn.start },
          end: { line: params.position.line, character: dataFn.end },
        },
      };
    }
    if (!isScriptLanguage(doc.languageId)) return null;
    const fsPath = URI.parse(doc.uri).fsPath;
    const entry = schemaEntryForFile(fsPath);
    const dateHover = provideDateHover(settings.calendar, doc, params.position);
    if (dateHover) return dateHover;
    const texture = provideTextureHover(settings, doc, params.position, entry?.kind);
    if (texture) return texture;
    return provideHover(
      data,
      doc,
      params.position,
      entry?.rootScopes?.length ? new Set(entry.rootScopes.map((s) => s.toLowerCase())) : null,
      entry,
      () => schema,
      (word) => docLocalDefs(doc).filter((d) => d.name === word)
    );
  })
);

/** Definitions extracted from an OPEN document, memoized per uri+version: the
 * index-free net behind hover/definition for same-file declarations — inline
 * scripted_triggers keep answering even when the vanilla index is stale,
 * missing, or still building (#5). */
const docDefsCache = new Map<string, Definition[]>();
function docLocalDefs(doc: TextDocument): Definition[] {
  const key = `${doc.uri}|${doc.version}`;
  let defs = docDefsCache.get(key);
  if (!defs) {
    if (docDefsCache.size >= 16) docDefsCache.clear();
    const fsPath = URI.parse(doc.uri).fsPath;
    // Outside every known root (unset gamePath, stray copy), an events-shaped
    // scan still nets the inline declarations plain files carry.
    const entry = schemaEntryForFile(fsPath) ?? {
      path: "events",
      kind: "event",
      extraction: "event-id" as const,
    };
    defs = extractDefinitions(doc.getText(), entry, fsPath, "vanilla");
    docDefsCache.set(key, defs);
  }
  return defs;
}

connection.onDefinition((params) =>
  indexRead(`definition ${perfName(params.textDocument.uri)}`, () => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    // Loc files: navigate [ ... ] datafunction names (custom loc, saved scopes).
    // Plain loc-key jumps stay with the client-side script-usage provider.
    if (doc.languageId === "paradox-loc") return provideLocDefinition(data, doc, params.position);
    if (!isScriptLanguage(doc.languageId) && doc.languageId !== "paradox-gui") return [];
    if (doc.languageId === "paradox-gui") {
      // Types, templates and blockoverride targets resolve through the FIOS
      // store first (what the game actually uses); loc keys etc. fall through.
      const gui = provideGuiDefinition(doc, params.position, guiPaths());
      if (gui) return gui;
    }
    return provideDefinition(data, doc, params.position, (word) =>
      docLocalDefs(doc).filter((d) => d.name === word)
    );
  })
);

connection.onSignatureHelp((params) => {
  flushModFileChanges();
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  if (doc.languageId === "paradox-gui" || doc.languageId === "paradox-loc") {
    const lineText = getLineText(doc, params.position.line);
    return provideDataFnSignature(data.dataTypes, data.dataFnUsage, lineText, params.position.character);
  }
  if (!isScriptLanguage(doc.languageId)) return null;
  return provideSignatureHelp(data, doc, params.position);
});

connection.onCodeAction((params) => {
  flushModFileChanges();
  const doc = documents.get(params.textDocument.uri);
  if (!doc || !isScriptLanguage(doc.languageId)) return [];
  return provideCodeActions(data, doc, params.range, params.context.diagnostics, {
    locLanguage: settings.locLanguage,
    modRootOf: workspaceRootOf,
    locRoots: schema.entries.filter((e) => e.kind === "loc_key").map((e) => e.path),
  });
});

connection.languages.inlayHint.on((params) =>
  indexRead(`inlayHint ${perfName(params.textDocument.uri)}`, () => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const entry = schemaEntryForFile(URI.parse(doc.uri).fsPath);
    const rootScopes = entry?.rootScopes?.length
      ? new Set(entry.rootScopes.map((s) => s.toLowerCase()))
      : null;
    return provideInlayHints(data, settings, doc, params.range, rootScopes, entry);
  })
);

connection.languages.semanticTokens.on((params) =>
  indexRead(`semanticTokens ${perfName(params.textDocument.uri)}`, () => {
    const doc = documents.get(params.textDocument.uri);
    // gui files benefit too: template/type names classify via the index.
    if (!doc || (!isScriptLanguage(doc.languageId) && doc.languageId !== "paradox-gui")) return { data: [] };
    const entry = isScriptLanguage(doc.languageId) ? schemaEntryForFile(URI.parse(doc.uri).fsPath) : null;
    return provideSemanticTokens(data, doc, schema.refFields, entry, schema.structures);
  })
);

connection.onReferences((params) =>
  indexRead(`references ${perfName(params.textDocument.uri)}`, () => {
    const doc = documents.get(params.textDocument.uri);
    // Loc files too: references on a loc key line list its script usage sites.
    if (!doc || (!isScriptLanguage(doc.languageId) && doc.languageId !== "paradox-loc")) return [];
    return provideReferences(data, doc, params.position, params.context.includeDeclaration, (name) =>
      lazyRefs.lookup(name)
    );
  })
);

connection.onPrepareRename((params) => {
  flushModFileChanges();
  const doc = documents.get(params.textDocument.uri);
  if (!doc || !isScriptLanguage(doc.languageId)) return null;
  return prepareRename(data, doc, params.position);
});

connection.onRenameRequest((params) => {
  flushModFileChanges();
  const doc = documents.get(params.textDocument.uri);
  if (!doc || !isScriptLanguage(doc.languageId)) return null;
  return provideRename(data, doc, params.position, params.newName, (uri) => documents.get(uri));
});

connection.onWorkspaceSymbol((params) => {
  flushModFileChanges();
  return provideWorkspaceSymbols(data, params.query);
});

connection.onDocumentSymbol((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  // One schema lookup per request, not per symbol: this runs on every keystroke.
  const defKind = isScriptLanguage(doc.languageId)
    ? (schemaEntryForFile(URI.parse(doc.uri).fsPath)?.kind ?? null)
    : null;
  return provideDocumentSymbols(doc, defKind);
});

connection.onDocumentFormatting((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc || !isScriptLanguage(doc.languageId)) return [];
  return provideFormattingEdits(doc);
});

connection.onFoldingRanges((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return provideFoldingRanges(doc);
});

// Color swatches + the native picker (issue #11). Script and .gui only: the
// descriptor and format-doc languages carry no colors.
function colorLanguage(languageId: string): boolean {
  return isScriptLanguage(languageId) || languageId === "paradox-gui";
}
connection.onDocumentColor((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc || !colorLanguage(doc.languageId)) return [];
  return provideDocumentColors(doc);
});
connection.onColorPresentation((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc || !colorLanguage(doc.languageId)) return [];
  return provideColorPresentations(doc, params.color, params.range);
});

// ---- structural diagnostics -----------------------------------------------------

/** BOM state per open document, read from disk (editors strip the BOM from the buffer). */
const bomByUri = new Map<string, boolean | null>();
const validationTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** What the published diagnostics of a document were computed from (§B3): the
 *  typing debounce and the save that follows it must not parse the same bytes
 *  against the same index twice. */
const validatedAt = new Map<string, { version: number; revision: number }>();

function readBomFromDisk(uri: string): boolean | null {
  try {
    const fsPath = URI.parse(uri).fsPath;
    const fd = fs.openSync(fsPath, "r");
    try {
      const buf = Buffer.alloc(3);
      const n = fs.readSync(fd, buf, 0, 3, 0);
      return n >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null; // unsaved / unreadable: unknown, no diagnostic
  }
}

/** Path used to match `ignorePatterns`: mod-relative when possible, else parent/game-relative, else basename. */
function relForPatterns(fsPath: string): string {
  const lower = fsPath.toLowerCase();
  for (const root of contentRoots()) {
    if (lower.startsWith(root.toLowerCase())) {
      return fsPath
        .slice(root.length)
        .replace(/^[\\/]+/, "")
        .replace(/\\/g, "/");
    }
  }
  return fsPath.replace(/\\/g, "/").split("/").pop() ?? "";
}

function validateDocument(doc: TextDocument): void {
  indexRead(`validate ${perfName(doc.uri)}`, () => validateDocumentNow(doc));
}

function validateDocumentNow(doc: TextDocument): void {
  validatedAt.set(doc.uri, { version: doc.version, revision: data.index.revision });
  const fsPath = URI.parse(doc.uri).fsPath;
  const ctx: FileContext = {
    fsPath,
    // Folder-layout checks apply to the workspace mod the file lives in
    // (multi-mod workspaces), falling back to the configured mod root.
    modPath: workspaceRootOf(fsPath) ?? settings.modPath,
    bomOnDisk: bomByUri.get(doc.uri) ?? null,
  };

  // F8: never diagnose vanilla files unless explicitly opted in.
  if (
    !settings.diagnosticsVanilla &&
    settings.gamePath &&
    ctx.fsPath.toLowerCase().startsWith(settings.gamePath.toLowerCase())
  ) {
    void connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
    return;
  }

  let diagnostics;
  if (doc.languageId === "paradox-loc") {
    const { result, lineIndex } = getLocParse(doc);
    diagnostics = computeLocDiagnostics(result, lineIndex, ctx);
  } else if (doc.languageId === "paradox-gui") {
    // Structural checks only (unbalanced braces silently break FIOS gui files).
    const { result, lineIndex } = getParse(doc);
    diagnostics = computeScriptDiagnostics(result, lineIndex, ctx);
  } else if (isScriptLanguage(doc.languageId)) {
    const { result, lineIndex } = getParse(doc);
    diagnostics = computeScriptDiagnostics(result, lineIndex, ctx);
    // Conservative index-backed checks, for workspace mod files only.
    const owner = workspaceRootOf(ctx.fsPath);
    if (owner) {
      const text = doc.getText();
      const extracted = extractReferences(text, ctx.fsPath, "mod", schema, isEngineToken);
      pushAll(diagnostics, computeReferenceDiagnostics(extracted.references, data));
      const entry = classifyFile(owner, ctx.fsPath, schema.entries);
      if (entry?.requiredLoc && entry.kind !== "loc_key") {
        const defs = extractDefinitions(text.replace(/^﻿/, ""), entry, ctx.fsPath, "mod");
        pushAll(diagnostics, computeRequiredLocDiagnostics(defs, entry, data));
      }
    }
  } else {
    return;
  }

  // F1/F2: settings-driven and inline-comment suppression (fail-soft).
  diagnostics = filterSuppressed(diagnostics, ctx.fsPath, doc.getText());
  void connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

/** Drop diagnostics muted by `diagnostics.ignore`/`ignorePatterns` or inline comments. */
function filterSuppressed(
  diagnostics: import("vscode-languageserver/node").Diagnostic[],
  fsPath: string,
  text: string
): import("vscode-languageserver/node").Diagnostic[] {
  const cfg = {
    ignore: settings.diagnosticsIgnore,
    ignorePatterns: settings.diagnosticsIgnorePatterns,
  };
  const rel = relForPatterns(fsPath);
  const inline = scanInlineSuppressions(text);
  return diagnostics.filter((d) => {
    const code = typeof d.code === "string" ? d.code : d.code !== undefined ? String(d.code) : undefined;
    if (isIgnoredByConfig(cfg, code, rel)) return false;
    if (isSuppressedInline(inline, d.range.start.line, code)) return false;
    return true;
  });
}

documents.onDidOpen((e) => {
  bomByUri.set(e.document.uri, readBomFromDisk(e.document.uri));
  validateDocument(e.document);
});

documents.onDidChangeContent((e) => {
  const uri = e.document.uri;
  const existing = validationTimers.get(uri);
  if (existing) clearTimeout(existing);
  validationTimers.set(
    uri,
    setTimeout(() => {
      validationTimers.delete(uri);
      const doc = documents.get(uri);
      if (doc) validateDocument(doc);
    }, 300)
  );
});

documents.onDidSave((e) => {
  const uri = e.document.uri;
  perf(`didSave ${perfName(uri)}`);
  // The typing debounce would otherwise validate the same bytes again 300ms
  // after the save (§B3).
  const pendingValidation = validationTimers.get(uri);
  if (pendingValidation) clearTimeout(pendingValidation);
  validationTimers.delete(uri);
  const bomBefore = bomByUri.get(uri);
  const bom = readBomFromDisk(uri);
  bomByUri.set(uri, bom);
  const done = validatedAt.get(uri);
  if (bom === bomBefore && done?.version === e.document.version && done.revision === data.index.revision) {
    perf(`didSave ${perfName(uri)} already validated at v${e.document.version}`);
    return;
  }
  validateDocument(e.document);
});

documents.onDidClose((e) => {
  const uri = e.document.uri;
  const timer = validationTimers.get(uri);
  if (timer) clearTimeout(timer);
  validationTimers.delete(uri);
  validatedAt.delete(uri);
  bomByUri.delete(uri);
  evictParse(uri);
  void connection.sendDiagnostics({ uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();
