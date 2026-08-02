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
// Named import: the bundler inlines just the version string (not the whole
// manifest), and the same source works when tests import from src.
import { version as SERVER_VERSION } from "../package.json";
import type { Definition } from "@px-lsp/protocol/types";
import {
  configChangedNotification,
  indexChangedNotification,
  indexStatsRequest,
  lookupLocRequest,
  modFileChangedNotification,
  reloadDocsRequest,
  statusNotification,
  type ParadoxInitOptions,
  type ParadoxSettings,
  type StatusPayload,
  type LocEntryInfo,
  type LookupLocParams,
  type ModFileChangeParams,
  type ModScopedParams,
  type ReloadDocsParams,
  type ReloadDocsResult,
  eventDetailRequest,
  eventGraphRequest,
  guiTreeRequest,
  locCoverageRequest,
  modOverviewRequest,
  overridesRequest,
  type EventDetailParams,
  type EventGraphParams,
  type GuiTreeParams,
  guiLayoutRequest,
  type GuiLayoutParams,
  guiWidgetEditRequest,
  type GuiWidgetEditParams,
  guiSourceEditRequest,
  type GuiSourceEditParams,
  guiWidgetInfoRequest,
  type GuiWidgetInfoParams,
  dependenciesRequest,
  type DependenciesParams,
  scopeAtRequest,
  type ScopeAtParams,
  type ScopeAtResult,
} from "@px-lsp/protocol/protocol";
import { buildGuiTree } from "./features/guiTree";
import { computeGuiLayoutResult, getGuiDefs, invalidateGuiDefsCache } from "./gui/layoutService";
import { computeGuiWidgetEdit } from "./gui/widgetEdit";
import { computeGuiSourceEdit } from "./gui/sourceEditService";
import { computeGuiWidgetInfo } from "./gui/widgetInfo";
import { provideGuiCompletion, provideGuiHover } from "./features/guiLanguage";
import { provideGuiDefinition, type GuiPaths } from "./features/guiNavigation";
import { provideDataFnCompletion, provideDataFnHover, provideDataFnSignature } from "./features/datafunction";
import { getLineText } from "./documents";
import { computeEventDetail } from "./overview/eventDetail";
import { loadTokenData, parseOnActionsLog } from "./data/docsParser";
import { loadDataTypes } from "./data/dataTypes";
import { loadDataBindingMacros } from "./data/dataBindingMacros";
import { DefinesIndex } from "./data/defines";
import { TextFormattingIndex } from "./data/textFormatting";
import { provideFormatTagCompletion, provideFormatTagHover } from "./features/locFormatting";
import { loadDataFnUsageAsync } from "./data/dataFnUsage";
import { loadWikiTokens, mergeWikiTokens } from "./data/wikiDocs";
import { loadFreqs } from "./schema/freqs";
import {
  DefinitionIndex,
  classifyFile,
  detectGameVersion,
  isWantedLocFile,
  listFiles,
  loadIndexCache,
  saveIndexCache,
} from "./index/indexer";
import { extractDefinitions } from "./index/extract";
import { extractReferences } from "./index/references";
import { LazyReferenceScanner, type LazyRefRoot } from "./index/lazyRefs";
import { ModOriginResolver } from "./index/modOrigin";
import { loadSchema, type SchemaData } from "./schema/loader";
import { VARIABLE_KINDS } from "./games/jomini/variables";
import { activeProfile, setActiveProfile } from "./games/active";
import { resolveProfile } from "./games/registry";
import type { SchemaEntry } from "./schema/types";
import { URI } from "vscode-uri";
import { ServerData } from "./serverData";
import { CompletionFeature } from "./features/completion";
import { provideHover } from "./features/hover";
import { provideTextureHover } from "./features/textureHover";
import { provideDefinition, provideLocDefinition } from "./features/definition";
import { SEMANTIC_LEGEND, provideSemanticTokens } from "./features/semanticTokens";
import { provideInlayHints } from "./features/inlayHints";
import { computeScopeAt } from "./features/scopeAt";
import { provideCodeActions } from "./features/codeActions";
import { provideSignatureHelp } from "./features/signatureHelp";
import { provideDocumentSymbols } from "./features/symbols";
import { provideFoldingRanges } from "./features/folding";
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
import { resolveClientCapabilities, setClientCapabilities } from "./clientMode";
import { isIgnoredByConfig, isSuppressedInline, scanInlineSuppressions } from "@px-lsp/protocol/suppression";
import { computeModOverview } from "./overview/modOverview";
import { computeLocCoverage } from "./overview/locCoverage";
import { computeOverrides } from "./overview/overrides";
import { computeEventGraph } from "./overview/eventGraph";
import { computeDependencies } from "./overview/dependencies";
import { wordRangeAt } from "./wordAt";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

function defaultSettings(): ParadoxSettings {
  return {
    gamePath: null,
    logsPath: null,
    modPath: null,
    parentPaths: [],
    workspaceMods: [],
    locLanguage: "english",
    scopeInlayHints: false,
    diagnosticsIgnore: [],
    diagnosticsIgnorePatterns: [],
    diagnosticsVanilla: false,
  };
}
let settings: ParadoxSettings = defaultSettings();
let storageDir = "";
let wikidocsDir = "";
let freqsDir = "";
let tokensFromScriptDocs = false;
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
  const wsMods = new Set(workspaceModRoots().map((r) => r.toLowerCase()));
  const roots: LazyRefRoot[] = parentRoots()
    .filter((r) => !wsMods.has(r.toLowerCase()))
    .map((root) => ({ root, source: "parent" as const }));
  if (settings.gamePath) roots.push({ root: settings.gamePath, source: "vanilla" });
  lazyRefs.setRoots(roots, isEngineToken);
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

/** parentRoots() runs on every request (via contentRoots); with 20 workspace
 * mods the per-mod playset fs probes need a cache. Cleared on reindex. */
const playsetCache = new Map<string, string[]>();
function readPlaysetCached(modRoot: string): string[] {
  const key = modRoot.toLowerCase();
  let v = playsetCache.get(key);
  if (!v) playsetCache.set(key, (v = readPlayset(modRoot)));
  return v;
}

/** Content roots in precedence order: mod, parents, vanilla. */
function contentRoots(): string[] {
  return [settings.modPath, ...parentRoots(), settings.gamePath].filter((r): r is string => r !== null);
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

/** Schema-declared root scopes for the folder a file lives in (AD-5 seed). */
function rootScopesForFile(fsPath: string): Set<string> | null {
  const entry = schemaEntryForFile(fsPath);
  if (!entry?.rootScopes || entry.rootScopes.length === 0) return null;
  return new Set(entry.rootScopes.map((s) => s.toLowerCase()));
}
// Static variable-type resolution (scopes/varTypes.ts) resolves root-anchored
// set_variable values through the set-file's schema root scopes.
data.rootScopesForFile = rootScopesForFile;

function log(msg: string): void {
  connection.console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// ---- status / refresh plumbing ---------------------------------------------

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

let lastLoggedStatus = "";

function sendStatus(): void {
  const payload: StatusPayload = {
    tokens: data.tokens.length,
    tokensFromScriptDocs,
    definitions: data.index.stats().total,
    indexing,
  };
  void connection.sendNotification(statusNotification, payload);
  // Mirror into window/logMessage so bare clients (no paradox/status handler)
  // can tell an empty index from a cold one. Only on transitions: scans fire
  // many status updates, but the interesting line is start/end of indexing.
  const line = `status: ${payload.tokens} tokens (${payload.tokensFromScriptDocs ? "script_docs" : "bundled"}), ${
    payload.definitions
  } definitions${payload.indexing ? ", indexing…" : ""}`;
  const key = `${payload.indexing}|${payload.tokens === 0}|${payload.definitions === 0}`;
  if (key !== lastLoggedStatus) {
    lastLoggedStatus = key;
    log(line);
  }
}

data.onDidChange(() => {
  sendStatus();
  // Debounce editor refreshes and the index-changed signal: scans fire many changes.
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    void connection.sendNotification(indexChangedNotification);
    connection.languages.semanticTokens.refresh().catch(() => {});
    connection.languages.inlayHint.refresh().catch(() => {});
  }, 300);
});

// ---- data loading -----------------------------------------------------------

function loadDocs(force: boolean): void {
  tokensFromScriptDocs = false;
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
  } else {
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
  const merged = mergeWikiTokens(scriptTokens, wikiTokens);
  data.setTokens(merged);
  log(`wiki docs: ${wikiTokens.length} tokens, merged total ${merged.length} (${Date.now() - t1}ms)`);

  data.onActionScopes = settings.logsPath ? parseOnActionsLog(settings.logsPath) : new Map();
  if (data.onActionScopes.size > 0) log(`on_actions.log: ${data.onActionScopes.size} on_action root scopes`);

  data.dataTypes = loadDataTypes(settings.logsPath);
  // Promote game (+ every workspace mod's) data_binding macros as global [ … ] functions.
  const macroRoots = [settings.gamePath, settings.modPath, ...workspaceModRoots()].filter(
    (r): r is string => r !== null
  );
  const macros = loadDataBindingMacros(macroRoots, data.dataTypes);
  if (macros > 0) log(`data_binding macros: ${macros} promoted into data-function completion/hover`);
  if (data.dataTypes.source === "bundled wiki") {
    log(
      `data types: ${data.dataTypes.count} entries from the bundled wiki tables ` +
        `(run "DumpDataTypes" in the game console for the complete, version-exact set)`
    );
  } else {
    log(`data types: ${data.dataTypes.count} entries incl. data_types.log`);
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
 * In-memory harvest of engine/game/mod `define:` constants and `#tag` loc
 * text-formats (small — a few thousand entries; not persisted into the vanilla
 * index cache). Rebuilt fresh so a paths change / mod edit cannot leave stale
 * layers. Engine (jomini) is the lowest layer, the mod the highest (last-wins).
 */
function harvestEngineData(): void {
  const t0 = Date.now();
  // Every workspace mod is a "mod" layer (multi-mod workspaces), added after
  // engine + game so mod definitions win.
  const modLayerRoots = [...(settings.modPath ? [settings.modPath] : []), ...workspaceModRoots()];
  const defines = new DefinesIndex();
  for (const root of engineRoots()) defines.addLayer(root, "jomini");
  if (settings.gamePath) defines.addLayer(settings.gamePath, "game");
  for (const root of modLayerRoots) defines.addLayer(root, "mod");
  data.defines = defines;
  const tDef = Date.now() - t0;

  const t1 = Date.now();
  const textFormatting = new TextFormattingIndex();
  for (const root of engineRoots()) textFormatting.addLayer(root, "jomini");
  if (settings.gamePath) textFormatting.addLayer(settings.gamePath, "game");
  for (const root of modLayerRoots) textFormatting.addLayer(root, "mod");
  data.textFormatting = textFormatting;
  log(
    `harvested defines: ${defines.count} constants (${tDef}ms), ` +
      `loc text formats: ${textFormatting.count} tags (${Date.now() - t1}ms)`
  );
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
  const defs: Definition[] = [];
  const work: Array<{ entry: SchemaData["entries"][number]; files: string[] }> = [];
  let totalFiles = 0;
  for (const entry of schema.entries) {
    const dir = path.join(root, ...entry.path.split("/"));
    let files = listFiles(dir, entry.ext ?? ".txt");
    if (entry.kind === "loc_key") {
      files = files.filter((f) => isWantedLocFile(path.relative(root, f), settings.locLanguage));
    }
    work.push({ entry, files });
    totalFiles += files.length;
  }
  let done = 0;
  const BATCH = 150;
  for (const { entry, files } of work) {
    for (let i = 0; i < files.length; i += BATCH) {
      if (generation !== scanGeneration) return null; // superseded
      const batch = files.slice(i, i + BATCH);
      for (const file of batch) {
        const content = readFileStripBom(file);
        if (content !== null) defs.push(...extractDefinitions(content, entry, file, source));
      }
      done += batch.length;
      onProgress?.(totalFiles === 0 ? 100 : Math.round((done / totalFiles) * 100), entry.path);
      await yieldNow();
    }
  }
  return defs;
}

/** Reference pass over every .txt in a workspace mod root (references live
 * everywhere, not just schema folders). Runs for the mod AND every other
 * workspace mod, so find-references/usage counts span multi-mod workspaces. */
async function scanModReferences(
  root: string,
  source: "mod" | "parent",
  generation: number
): Promise<boolean> {
  const t0 = Date.now();
  const files = listFiles(root, ".txt");
  const BATCH = 150;
  let refCount = 0;
  for (let i = 0; i < files.length; i += BATCH) {
    if (generation !== scanGeneration) return false;
    for (const file of files.slice(i, i + BATCH)) {
      const content = readFileStripBom(file);
      if (content === null) continue;
      const extracted = extractReferences(content, file, source, schema, isEngineToken);
      data.refIndex.addAll(extracted.references);
      if (extracted.implicitDefs.length > 0) data.index.addAll(extracted.implicitDefs);
      if (extracted.namespaces.length > 0) namespacesByFile.set(file.toLowerCase(), extracted.namespaces);
      refCount += extracted.references.length;
    }
    await yieldNow();
  }
  rebuildModNamespaces();
  log(
    `indexed ${path.basename(root)} references: ` +
      `${refCount} usage sites in ${files.length} files (${Date.now() - t0}ms)`
  );
  return true;
}

function rebuildModNamespaces(): void {
  data.modNamespaces.clear();
  for (const list of namespacesByFile.values()) {
    for (const ns of list) data.modNamespaces.add(ns);
  }
}

/** Ordered parent-mod roots from <mod>/<configDir>/playset.json, if present. */
function readPlayset(modPath: string): string[] {
  const file = path.join(modPath, activeProfile().configDirName, "playset.json");
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
  const generation = ++scanGeneration;
  playsetCache.clear();
  schema = loadSchema([...(settings.modPath ? [settings.modPath] : []), ...workspaceModRoots()], log);
  data.completableKinds = new Set([
    ...schema.entries.filter((e) => e.completable !== false).map((e) => e.kind),
    "saved_scope",
    ...VARIABLE_KINDS,
  ]);
  data.index = new DefinitionIndex();
  data.refIndex.clear();
  namespacesByFile.clear();
  data.modNamespaces.clear();
  refreshModOrigin();
  refreshLazyRefs();
  harvestEngineData();
  indexing = true;
  sendStatus();

  try {
    if (settings.modPath) {
      const t0 = Date.now();
      const defs = await scanRootChunked(settings.modPath, "mod", generation);
      if (defs === null) return;
      data.index.addAll(defs);
      if (!(await scanModReferences(settings.modPath, "mod", generation))) return;
      data.notifyIndexChanged();
      log(`indexed mod: ${defs.length} definitions (${Date.now() - t0}ms)`);
    }

    const wsMods = new Set(workspaceModRoots().map((r) => r.toLowerCase()));
    for (const parent of parentRoots()) {
      const t1 = Date.now();
      // Workspace mods are edited mods like any other: source "mod" (full
      // reference indexing, views, ranking). Only dependency parents from
      // the parent-mods setting / playset.json are read-only "parent" context.
      const isWorkspaceMod = wsMods.has(parent.toLowerCase());
      const parentDefs = await scanRootChunked(parent, isWorkspaceMod ? "mod" : "parent", generation);
      if (parentDefs === null) return;
      data.index.addAll(parentDefs);
      if (isWorkspaceMod) {
        if (!(await scanModReferences(parent, "mod", generation))) return;
      }
      data.notifyIndexChanged();
      log(
        `indexed ${isWorkspaceMod ? "workspace mod" : "parent mod"} ${path.basename(parent)}: ` +
          `${parentDefs.length} definitions (${Date.now() - t1}ms)`
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
            engineDefs.push(...d);
          }
          defs = await scanRootChunked(gamePath, "vanilla", generation, (pct, msg) =>
            progress.report(pct, msg)
          );
          if (defs !== null && engineDefs.length > 0) {
            log(`indexed engine layer (jomini): ${engineDefs.length} definitions`);
            defs = [...engineDefs, ...defs];
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
      data.notifyIndexChanged();
    }
  } finally {
    if (generation === scanGeneration) {
      indexing = false;
      sendStatus();
    }
  }
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

  data.index.removeFile(fsPath);
  const content = fs.existsSync(fsPath) ? readFileStripBom(fsPath) : null;

  if (entry && content !== null) {
    data.index.addAll(extractDefinitions(content, entry, fsPath, source));
  }
  // References and namespaces are tracked for every workspace mod (matching
  // buildIndex); read-only dependency parents stay definition-only.
  const isWorkspaceMod = wsRoot !== null;
  if (isWorkspaceMod && isScript) {
    data.refIndex.removeFile(fsPath);
    namespacesByFile.delete(fsPath.toLowerCase());
    if (content !== null) {
      const extracted = extractReferences(content, fsPath, source, schema, isEngineToken);
      data.refIndex.addAll(extracted.references);
      data.index.addAll(extracted.implicitDefs);
      if (extracted.namespaces.length > 0) namespacesByFile.set(fsPath.toLowerCase(), extracted.namespaces);
    }
    rebuildModNamespaces();
  }
  data.notifyIndexChanged();
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
}
let clientDataDir = "";
let clientWikidocsDir = "";
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
  const clientCaps = resolveClientCapabilities(init);
  setClientCapabilities(clientCaps);
  clientOwnFileWatcher = clientCaps.ownFileWatcher;
  clientWatchedFilesDynamic =
    params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
  // Merge onto the defaults: bare clients may send partial settings (e.g.
  // only gameId), and every downstream consumer assumes the full shape.
  if (init.settings) settings = { ...defaultSettings(), ...init.settings };
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
  completion.setFreqs(loadFreqs(freqsDir));
  completion.setSettings(settings);
  loadDocs(false);
  void buildIndex();
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
    completion.setFreqs(loadFreqs(freqsDir));
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
  completion.setSettings(settings);
  if (pathsChanged) {
    log("paths changed; rebuilding data...");
    loadDocs(false);
    void buildIndex();
  }
  // Re-validate open documents so suppression/vanilla changes apply immediately.
  if (diagChanged || pathsChanged) {
    for (const doc of documents.all()) validateDocument(doc);
  }
});

function handleModFileChange(fsPath: string): void {
  rescanModFile(fsPath);
  const lower = fsPath.toLowerCase();
  if (lower.endsWith(".mod") || lower.endsWith("metadata.json")) refreshModOrigin();
  if (lower.endsWith(".gui")) invalidateGuiDefsCache();
  // Cheap full re-harvest when a mod defines file or a gui textformatting file changed.
  if (lower.replace(/\\/g, "/").includes("common/defines/") || lower.endsWith(".gui")) harvestEngineData();
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

connection.onRequest(guiTreeRequest, (params: GuiTreeParams) => buildGuiTree(params.text ?? ""));

connection.onRequest(guiLayoutRequest, (params: GuiLayoutParams) =>
  computeGuiLayoutResult(
    params.text ?? "",
    settings.gamePath,
    settings.modPath,
    settings.parentPaths,
    engineRoots()
  )
);

/** The type chain a size guard resolves through is the same store the preview lays out with. */
function guiDefsForEdits() {
  return getGuiDefs(settings.gamePath, settings.modPath, settings.parentPaths, engineRoots());
}

connection.onRequest(guiSourceEditRequest, (params: GuiSourceEditParams) =>
  computeGuiSourceEdit(params.text ?? "", params.op, guiDefsForEdits())
);

// The inspector reads through the same store the preview lays out with, so a
// row it shows is a value the canvas used.
connection.onRequest(guiWidgetInfoRequest, (params: GuiWidgetInfoParams) =>
  computeGuiWidgetInfo(params.text ?? "", params.line, guiDefsForEdits())
);

// Deprecated: the narrow position/size shape, over the same core.
connection.onRequest(guiWidgetEditRequest, (params: GuiWidgetEditParams) =>
  computeGuiWidgetEdit(params.text ?? "", params.line, params.property, params.values, guiDefsForEdits())
);

connection.onRequest(eventDetailRequest, (params: EventDetailParams) =>
  params?.id ? computeEventDetail(data, schema, params.id) : null
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
  if (!name) return { def: null, dependents: [], dependencies: [] };
  return computeDependencies(data, schema, name, kind);
});

connection.onRequest(scopeAtRequest, (params: ScopeAtParams): ScopeAtResult | null => {
  // Open documents only: the client's text is the authority, and a status bar
  // asking about a closed/loc/gui document gets "nothing to show", not an error.
  const doc = params?.uri ? documents.get(params.uri) : undefined;
  if (!doc || doc.languageId !== "paradox" || !params.position) return null;
  const entry = schemaEntryForFile(URI.parse(doc.uri).fsPath);
  return computeScopeAt(
    data,
    doc,
    params.position,
    entry?.rootScopes?.length ? new Set(entry.rootScopes.map((s) => s.toLowerCase())) : null,
    entry
  );
});

connection.onRequest(lookupLocRequest, (params: LookupLocParams): LocEntryInfo[] => {
  return data.index
    .lookup(params.key)
    .filter((d) => d.kind === "loc_key")
    .map((d) => ({ file: d.file, line: d.line, source: d.source, value: d.value }));
});

// ---- language features ----------------------------------------------------------

connection.onCompletion((params) => {
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
  if (doc.languageId !== "paradox") return [];
  const entry = schemaEntryForFile(URI.parse(doc.uri).fsPath);
  const result = completion.provide(
    doc,
    doc.offsetAt(params.position),
    entry?.rootScopes?.length ? new Set(entry.rootScopes.map((s) => s.toLowerCase())) : null,
    entry
  );
  return { isIncomplete: result.isIncomplete, items: result.items };
});

connection.onCompletionResolve((item) => completion.resolve(item));

connection.onHover((params) => {
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
  if (doc.languageId !== "paradox") return null;
  const fsPath = URI.parse(doc.uri).fsPath;
  const entry = schemaEntryForFile(fsPath);
  const texture = provideTextureHover(settings, doc, params.position, entry?.kind);
  if (texture) return texture;
  return provideHover(
    data,
    doc,
    params.position,
    entry?.rootScopes?.length ? new Set(entry.rootScopes.map((s) => s.toLowerCase())) : null,
    entry,
    () => schema
  );
});

connection.onDefinition((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  // Loc files: navigate [ ... ] datafunction names (custom loc, saved scopes).
  // Plain loc-key jumps stay with the client-side script-usage provider.
  if (doc.languageId === "paradox-loc") return provideLocDefinition(data, doc, params.position);
  if (doc.languageId !== "paradox" && doc.languageId !== "paradox-gui") return [];
  if (doc.languageId === "paradox-gui") {
    // Types, templates and blockoverride targets resolve through the FIOS
    // store first (what the game actually uses); loc keys etc. fall through.
    const gui = provideGuiDefinition(doc, params.position, guiPaths());
    if (gui) return gui;
  }
  return provideDefinition(data, doc, params.position);
});

connection.onSignatureHelp((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  if (doc.languageId === "paradox-gui" || doc.languageId === "paradox-loc") {
    const lineText = getLineText(doc, params.position.line);
    return provideDataFnSignature(data.dataTypes, data.dataFnUsage, lineText, params.position.character);
  }
  if (doc.languageId !== "paradox") return null;
  return provideSignatureHelp(data, doc, params.position);
});

connection.onCodeAction((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc || doc.languageId !== "paradox") return [];
  return provideCodeActions(data, doc, params.range, params.context.diagnostics, {
    locLanguage: settings.locLanguage,
    modRootOf: workspaceRootOf,
    locRoots: schema.entries.filter((e) => e.kind === "loc_key").map((e) => e.path),
  });
});

connection.languages.inlayHint.on((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const entry = schemaEntryForFile(URI.parse(doc.uri).fsPath);
  const rootScopes = entry?.rootScopes?.length ? new Set(entry.rootScopes.map((s) => s.toLowerCase())) : null;
  return provideInlayHints(data, settings, doc, params.range, rootScopes, entry);
});

connection.languages.semanticTokens.on((params) => {
  const doc = documents.get(params.textDocument.uri);
  // gui files benefit too: template/type names classify via the index.
  if (!doc || (doc.languageId !== "paradox" && doc.languageId !== "paradox-gui")) return { data: [] };
  const entry = doc.languageId === "paradox" ? schemaEntryForFile(URI.parse(doc.uri).fsPath) : null;
  return provideSemanticTokens(data, doc, schema.refFields, entry, schema.structures);
});

connection.onReferences((params) => {
  const doc = documents.get(params.textDocument.uri);
  // Loc files too: references on a loc key line list its script usage sites.
  if (!doc || (doc.languageId !== "paradox" && doc.languageId !== "paradox-loc")) return [];
  return provideReferences(data, doc, params.position, params.context.includeDeclaration, (name) =>
    lazyRefs.lookup(name)
  );
});

connection.onPrepareRename((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc || doc.languageId !== "paradox") return null;
  return prepareRename(data, doc, params.position);
});

connection.onRenameRequest((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc || doc.languageId !== "paradox") return null;
  return provideRename(data, doc, params.position, params.newName, (uri) => documents.get(uri));
});

connection.onWorkspaceSymbol((params) => provideWorkspaceSymbols(data, params.query));

connection.onDocumentSymbol((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return provideDocumentSymbols(doc);
});

connection.onDocumentFormatting((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc || doc.languageId !== "paradox") return [];
  return provideFormattingEdits(doc);
});

connection.onFoldingRanges((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return provideFoldingRanges(doc);
});

// ---- structural diagnostics -----------------------------------------------------

/** BOM state per open document, read from disk (editors strip the BOM from the buffer). */
const bomByUri = new Map<string, boolean | null>();
const validationTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
  } else if (doc.languageId === "paradox") {
    const { result, lineIndex } = getParse(doc);
    diagnostics = computeScriptDiagnostics(result, lineIndex, ctx);
    // Conservative index-backed checks, for workspace mod files only.
    const owner = workspaceRootOf(ctx.fsPath);
    if (owner) {
      const text = doc.getText();
      const extracted = extractReferences(text, ctx.fsPath, "mod", schema, isEngineToken);
      diagnostics.push(...computeReferenceDiagnostics(extracted.references, data));
      const entry = classifyFile(owner, ctx.fsPath, schema.entries);
      if (entry?.requiredLoc && entry.kind !== "loc_key") {
        const defs = extractDefinitions(text.replace(/^﻿/, ""), entry, ctx.fsPath, "mod");
        diagnostics.push(...computeRequiredLocDiagnostics(defs, entry, data));
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
  bomByUri.set(e.document.uri, readBomFromDisk(e.document.uri));
  validateDocument(e.document);
});

documents.onDidClose((e) => {
  const uri = e.document.uri;
  const timer = validationTimers.get(uri);
  if (timer) clearTimeout(timer);
  validationTimers.delete(uri);
  bomByUri.delete(uri);
  evictParse(uri);
  void connection.sendDiagnostics({ uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();
