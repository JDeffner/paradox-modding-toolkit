/**
 * Client entry point: starts the Paradox language server and keeps for itself only
 * what must live in the editor process — language-mode switching, tiger process
 * management and downloads, setup/Steam detection, the status bar, and commands
 * that touch the VS Code UI. All parsing/indexing/analysis lives in the server.
 */
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import {
  CloseAction,
  LanguageClient,
  State,
  TransportKind,
  type ErrorHandler,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";
import { modRootFor, readConfig, type PxConfig } from "./config";
import { findStrayCalendar } from "./calendarSettingsCheck";
import { ensureFileAssociations, wireLanguageDetection } from "./languageMode";
import { isScriptLang, PARADOX_SCRIPT_LANGS } from "./langIds";
import { findDownloadedTiger, tigerFlavorFor } from "./tigerDownload";
import { creatorSupported, flagBuilderSupported, guiEditorSupported, metaFor } from "./meta";
import { downloadTigerCommand, maybeNudgeSetup, runSetup, type SetupDeps } from "./setup";
import { PxStatusBar } from "./statusBar";
import { TigerRunner } from "./tiger/runner";
import {
  editLocalizationCommand,
  openLocalizationSideBySide,
  replaceLocLineValue,
  upsertNewModLoc,
  writeLocSmart,
  type LocLookup,
} from "./locCommands";
import { LocFileDefinitionProvider, LocReferenceTracker, jumpToScriptReference } from "./locNavigation";
import { registerSimulateEventLens } from "./eventLens";
import { createTranslationCommand } from "./translation";
import { createTranslationModCommand } from "./translationMod";
import { openInfoDocsCommand, openVanillaExamplesCommand, updateInfoDocContext } from "./infoDocs";
import { FocusMod, registerPxViews } from "./views";
import { addDependencyModCommand } from "./dependencyMods";
import { registerDashboardView, hiddenRows } from "./webviews/dashboard/view";
import { actionGroups } from "./webviews/dashboard/actions";
import { EventGraphPanel } from "./webviews/eventGraph/panel";
import { ExampleWikiPanel, type ExampleWikiTarget } from "./webviews/exampleWiki/panel";
import { WikiPanel, IMAGE_GUIDELINES_ARTICLE } from "./webviews/wiki/panel";
import { CreditsPanel } from "./webviews/credits/panel";
import { EventSimPanel } from "./webviews/eventSim/panel";
import { GuiTreePanel } from "./webviews/guiTree/panel";
import { GuiEditorPanel } from "./webviews/guiEditor/panel";
import { generateCalendarLocCommand, insertDateCommand } from "./calendarInsert";
import { setTabIconRoot } from "./webviews/tabIcons";
import { FlagBuilderPanel } from "./webviews/flagBuilder/panel";
import { TraitCreatorPanel } from "./webviews/traitCreator/panel";
import { createCoatOfArmsCommand } from "./webviews/flagBuilder/create";
import { coaTargetArg } from "./webviews/flagBuilder/target";
import { DynastyTreePanel } from "./webviews/dynastyTree/panel";
import { CultureCreatorPanel } from "./webviews/cultureCreator/panel";
import { readModName } from "@px-lsp/protocol/modName";
import { migrateConfigDir } from "@px-lsp/protocol/configDir";
import type { FlagRoot } from "./webviews/flagBuilder/database";
import { DdsPreviewProvider } from "./ddsEditor";
import { convertToDdsCommand } from "./ddsConvert";
import { modReportCommand } from "./modReport";
import { generateTigerConfCommand } from "./tiger/conf";
import { ErrorLogWatcher } from "./errorLog";
import { launchGame, registerGameRun } from "./gameRun";
import { DEBUG_ARGS } from "./gameRunPresets";
import { serverHeapMb } from "./serverHeap";
import { planWatchRoots } from "./watchRoots";
import { bigWorkspaceWarning, measureWorkspace } from "./bigWorkspace";
import { reduceEditorLoadCommand } from "./reduceEditorLoad";
import { translateNextCommand } from "./translationLoop";
import { newContentCommand, scaffoldPrefix } from "./scaffold/command";
import { createModCommand } from "./modProjects/command";
import { registerDescriptorMod } from "./descriptorMod";
import { registerWorkshop } from "./steam/workshop";
import { registerBBCodeSupport } from "./bbcodeSupport";
import { WorkshopPanel } from "./webviews/workshop/panel";
import * as fs from "fs";
import {
  allClientCommandIds,
  configChangedNotification,
  indexStatsRequest,
  lookupLocRequest,
  modFileChangedNotification,
  progressNotification,
  reloadDocsRequest,
  statusNotification,
  type ParadoxInitOptions,
  type ParadoxSettings,
  type ProgressPayload,
  type StatusPayload,
  type LocEntryInfo,
  type LookupLocParams,
  type ReloadDocsResult,
  eventBannerRequest,
  eventDetailRequest,
  eventGraphRequest,
  definitionEditRequest,
  definitionFormRequest,
  type DefinitionEditParams,
  type DefinitionEditResult,
  type DefinitionForm,
  type DefinitionFormParams,
  exampleWikiRequest,
  exampleWikiEntryRequest,
  type ExampleWikiDetail,
  type ExampleWikiEntryParams,
  type ExampleWikiIndex,
  dynastyTreeRequest,
  eventVocabularyRequest,
  guiTreeRequest,
  guiLayoutRequest,
  type DynastyTreeResult,
  type EventDetail,
  type EventBannerParams,
  type EventBannerResult,
  type EventDetailParams,
  type EventGraph,
  type EventGraphParams,
  eventValueOptionsRequest,
  type EventValueOptionsParams,
  type EventValueOptionsResult,
  type EventVocabularyParams,
  type EventVocabularyResult,
  type GuiTree,
  type GuiTreeParams,
  type GuiLayoutParams,
  type GuiLayoutResult,
  guiSourceEditRequest,
  type GuiSourceEditParams,
  type GuiSourceEditResult,
  guiWidgetInfoRequest,
  type GuiWidgetInfo,
  type GuiWidgetInfoParams,
  guiVocabularyRequest,
  type GuiVocabularyParams,
  type GuiVocabularyResult,
  guiDependenciesRequest,
  type GuiDependenciesParams,
  type GuiDependenciesResult,
  guiPreviewRequest,
  type GuiPreviewParams,
  type GuiPreviewResult,
  guiSaveValuesRequest,
  type GuiSaveValuesParams,
  type GuiSaveValuesResult,
  dependenciesRequest,
  type DependenciesParams,
  type DependenciesResult,
} from "@px-lsp/protocol/protocol";
import type { IndexStats } from "@px-lsp/protocol/types";

const LOC_SELECTOR: vscode.DocumentSelector = { language: "paradox-loc", scheme: "file" };

let output: vscode.LogOutputChannel;
let cfg: PxConfig;
let client: LanguageClient | undefined;

function log(msg: string): void {
  output.appendLine(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function toSettings(c: PxConfig): ParadoxSettings {
  return {
    gameId: c.gameId,
    gamePath: c.gamePath,
    logsPath: c.logsPath,
    modPath: c.modPath,
    parentPaths: c.parentPaths,
    workspaceMods: c.workspaceMods,
    locLanguage: c.locLanguage,
    scopeInlayHints: c.scopeInlayHints,
    calendar: c.calendar,
    diagnosticsIgnore: c.diagnosticsIgnore,
    diagnosticsIgnorePatterns: c.diagnosticsIgnorePatterns,
    diagnosticsVanilla: c.diagnosticsVanilla,
    tracePerf: c.tracePerf,
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  setTabIconRoot(context.extensionUri);
  output = vscode.window.createOutputChannel("Paradox Modding Toolkit", { log: true });
  context.subscriptions.push(output);

  const storageDir = context.globalStorageUri.fsPath;

  // Effective tiger: explicit setting wins, else the copy we downloaded
  // ourselves (per-game flavor). Games with no tiger (EU5) have no flavor and
  // stay at tigerPath=null, which switches every tiger surface off.
  const resolveConfig = () => {
    const c = readConfig();
    const flavor = tigerFlavorFor(c.gameId);
    if (!flavor) c.tigerPath = null;
    else if (!c.tigerPath) c.tigerPath = findDownloadedTiger(storageDir, flavor);
    return c;
  };

  cfg = resolveConfig();
  if (cfg.warnings.length > 0) {
    // Fail soft: features degrade, extension still activates.
    void vscode.window.showWarningMessage(`Paradox Modding Toolkit: ${cfg.warnings.join(" — ")}`);
  }
  // One-time honesty note for EU5: the schema is community-sourced and not
  // yet verified against a live install.
  if (cfg.gameId === "eu5" && !context.globalState.get<boolean>("px.eu5Notice")) {
    void context.globalState.update("px.eu5Notice", true);
    void vscode.window.showInformationMessage(
      "EU5 support is community-sourced (folder mappings imported from cwtools-eu5-config) and not yet " +
        "verified against a live install. Wrong or missing mappings degrade navigation, never diagnostics. " +
        "Please report gaps; a .px-toolkit/schema.json overlay in your mod fixes them immediately."
    );
  }
  log(
    `activated. gamePath=${cfg.gamePath ?? "(none)"} logsPath=${cfg.logsPath ?? "(none)"} ` +
      `modPath=${cfg.modPath ?? "(none)"} workspaceMods=${cfg.workspaceMods.length} ` +
      `parents=${cfg.parentPaths.length} tigerPath=${cfg.tigerPath ?? "(none)"}`
  );

  // §C3: a workspace big enough to cost gigabytes per window says so once, and
  // names the two settings that make it cheaper. Always logged, notified once
  // per workspace so it cannot become noise.
  if (cfg.isCk3Workspace) {
    const bigWorkspace = bigWorkspaceWarning(measureWorkspace(cfg), cfg.tigerRunOn);
    if (bigWorkspace) {
      log(bigWorkspace);
      if (!context.workspaceState.get<boolean>("px.bigWorkspaceNotice")) {
        void context.workspaceState.update("px.bigWorkspaceNotice", true);
        void vscode.window
          .showWarningMessage(
            `Paradox Modding Toolkit: ${bigWorkspace}`,
            "Exclude Mods...",
            "Reduce VS Code Load",
            "Settings"
          )
          .then((choice) => {
            if (choice === "Exclude Mods...") void vscode.commands.executeCommand("px.excludeMods");
            else if (choice === "Reduce VS Code Load")
              void vscode.commands.executeCommand("px.reduceEditorLoad");
            else if (choice === "Settings")
              void vscode.commands.executeCommand("workbench.action.openSettings", "px.excludedMods");
          });
      }
    }
  }

  // A px.calendar declared in a mod's (or mod project's) own .vscode while the
  // OPENED folder has none: VS Code ignores that file, so every calendar
  // feature silently does nothing. The setting is window-scoped; say so once
  // per workspace and offer to adopt the calendar where it counts.
  if (cfg.isCk3Workspace && !cfg.calendar && !context.workspaceState.get<boolean>("px.strayCalendarNotice")) {
    const stray = findStrayCalendar(
      [...(cfg.modPath ? [cfg.modPath] : []), ...cfg.workspaceMods],
      (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
    );
    if (stray) {
      void context.workspaceState.update("px.strayCalendarNotice", true);
      const actions = stray.calendar ? ["Use This Calendar", "Open Settings File"] : ["Open Settings File"];
      void vscode.window
        .showWarningMessage(
          `Paradox Modding Toolkit: ${path.basename(path.dirname(path.dirname(stray.file)))} declares ` +
            "px.calendar in its own .vscode/settings.json, but VS Code only reads that file when the " +
            "folder itself is opened. Put the calendar in the settings of the folder you open " +
            "(or the .code-workspace) to activate the date preview.",
          ...actions
        )
        .then((choice) => {
          if (choice === "Use This Calendar") {
            void vscode.workspace
              .getConfiguration("px")
              .update("calendar", stray.calendar, vscode.ConfigurationTarget.Workspace);
          } else if (choice === "Open Settings File") {
            void vscode.window.showTextDocument(vscode.Uri.file(stray.file));
          }
        });
    }
  }

  // Multi-mod workspaces: mod-targeted commands act on the mod that owns the
  // active editor's file, falling back to the primary mod folder.
  const cfgForActive = (): PxConfig => {
    const file = vscode.window.activeTextEditor?.document.uri.fsPath;
    const root = file ? modRootFor(file, cfg) : null;
    return root && root !== cfg.modPath ? { ...cfg, modPath: root } : cfg;
  };

  const reapplyLanguages = wireLanguageDetection(context, () => cfg);
  void ensureFileAssociations(cfg);

  const statusBar = new PxStatusBar();
  context.subscriptions.push(statusBar);
  let lastServerStatus: StatusPayload = {
    tokens: 0,
    tokensFromScriptDocs: false,
    tokensFromBundledDumps: false,
    definitions: 0,
    indexing: true,
  };
  const updateStatus = () => {
    // The visible surface (status bar, sidebar views, palette commands) follows
    // the workspace: present in mod/game workspaces, absent elsewhere. Both change
    // handlers below run through here, so this tracks folder/setting changes.
    statusBar.setVisible(cfg.isCk3Workspace);
    void vscode.commands.executeCommand("setContext", "px.isCk3Workspace", cfg.isCk3Workspace);
    // Context keys for anything a `when` clause may want to gate on later.
    void vscode.commands.executeCommand("setContext", "px.hasTiger", metaFor(cfg.gameId).tiger !== undefined);
    void vscode.commands.executeCommand(
      "setContext",
      "px.guiEditorSupported",
      guiEditorSupported(cfg.gameId)
    );
    void vscode.commands.executeCommand(
      "setContext",
      "px.flagBuilderSupported",
      flagBuilderSupported(cfg.gameId)
    );
    // One key per creator the profile lists, so a palette entry appears only
    // where a panel was actually built against that game's own files.
    for (const creator of metaFor(cfg.gameId).creators ?? []) {
      void vscode.commands.executeCommand("setContext", `px.creator.${creator.kind}`, true);
    }
    statusBar.update({
      tokens: lastServerStatus.tokens,
      tokensFromScriptDocs: lastServerStatus.tokensFromScriptDocs,
      tokensFromBundledDumps: lastServerStatus.tokensFromBundledDumps ?? false,
      definitions: lastServerStatus.definitions,
      tokensWikiOnly: lastServerStatus.tokensWikiOnly,
      indexing: lastServerStatus.indexing,
      gameOk: cfg.gamePath !== null,
      modOk: cfg.modPath !== null,
      tigerOk: cfg.tigerPath !== null,
      tigerName: metaFor(cfg.gameId).tiger?.binaryName ?? null,
    });
  };
  updateStatus();

  // Baselines are per mod (multi-mod workspaces): each run suppresses the
  // baseline of the mod it validates, not one global file.
  const baselineFileFor = (root: string | null) =>
    root ? path.join(migrateConfigDir(root, metaFor(cfg.gameId)), "tiger-baseline.json") : null;
  let tigerUnusedOnce = false;
  const tigerExtraArgs = (modRoot: string): string[] => {
    const args: string[] = [];
    const bl = baselineFileFor(modRoot);
    if (context.workspaceState.get<boolean>("px.tigerBaselineEnabled") && bl && fs.existsSync(bl)) {
      args.push("--suppress", bl);
    }
    if (tigerUnusedOnce) {
      args.push("--unused");
      tigerUnusedOnce = false;
    }
    return args;
  };
  const tiger = new TigerRunner(() => cfg, log, tigerExtraArgs);
  tiger.refreshStatus();
  // Games with no tiger (EU5) get a clear no-op instead of a broken command.
  // TigerRunner.run / createBaseline and generateTigerConfCommand say it
  // themselves; this covers the commands that only toggle state.
  const requireTiger = (): boolean => {
    const meta = metaFor(cfg.gameId);
    if (meta.tiger) return true;
    void vscode.window.showInformationMessage(
      `Paradox Modding Toolkit: no tiger validator exists for ${meta.name} yet — tiger commands do nothing here.`
    );
    return false;
  };
  // Same gate, same wording, for every door into the Flag Builder: opening it
  // and creating a coat of arms are the same feature.
  const requireFlagBuilder = (): boolean => {
    if (flagBuilderSupported(cfg.gameId)) return true;
    void vscode.window.showInformationMessage(
      `Paradox Modding Toolkit: the Flag Builder has no coat-of-arms format for ${metaFor(cfg.gameId).name} yet.`
    );
    return false;
  };

  context.subscriptions.push(tiger);
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => tiger.onDidSaveDocument(doc)));

  // descriptor.mod: completion/hover/diagnostics + missing-descriptor error.
  const descriptorFeature = registerDescriptorMod(context, () => cfg, log);
  context.subscriptions.push(descriptorFeature);

  // ---- language server -----------------------------------------------------

  const serverModule = context.asAbsolutePath(path.join("dist", "server.js"));
  const heapArg = `--max-old-space-size=${serverHeapMb(os.totalmem())}`;
  /**
   * The index scan reads file batches with up to 16 reads in flight, but every
   * fs.promises.readFile runs on libuv's thread pool, which defaults to FOUR.
   * The scan was therefore never allowed more than four outstanding disk
   * requests however many it issued, and a cold index build is latency-bound,
   * not bandwidth-bound: measured on a game + 5 Workshop mods workspace
   * (87,250 files) with an evicted page cache, time to indexed was 142.9 s at
   * the default pool and 71.8 s at 16. Warm it changes nothing, because the
   * reads are served from RAM.
   *
   * The client merges this over process.env, so nothing inherited is lost.
   */
  const serverEnv = { UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE ?? "16" };
  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: [heapArg], env: serverEnv },
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009", heapArg], env: serverEnv },
    },
  };
  // dataDir/wikidocsDir are deliberately NOT sent: the server derives
  // data/<gameId>/ next to its bundle (identical folder in this vsix), which
  // keeps the bundled wiki/freqs profile-correct even when the game changes.
  const initOptions: ParadoxInitOptions = {
    storageDir,
    // This client registers every px.* command, renders the sanitized hover
    // HTML, navigates `file:` links in hover markdown, and runs its own tuned
    // file watcher (pushing paradox/modFileChanged). Clients declaring less get
    // plain markdown, plain provenance labels, WorkspaceEdits instead of
    // command actions, and a server-side watcher.
    client: {
      hoverHtml: true,
      hoverIcons: true,
      commands: allClientCommandIds,
      ownFileWatcher: true,
      fileLinks: true,
    },
    settings: toSettings(cfg),
  };
  // Server deaths were invisible: the client restarts silently up to five
  // times and then stops, leaving every LSP-backed feature dead while TextMate
  // highlighting keeps working. Log both halves (error and close) and delegate
  // the actual decision to the default handler, so behaviour is unchanged.
  let defaultErrorHandler: ErrorHandler | undefined;
  const fallback = (): ErrorHandler => (defaultErrorHandler ??= lc.createDefaultErrorHandler());
  const errorHandler: ErrorHandler = {
    error: (error, message, count) => {
      log(
        `language server error (#${count ?? 1}): ${error.message}${message ? ` on ${message.jsonrpc}` : ""}`
      );
      return fallback().error(error, message, count);
    },
    closed: async () => {
      const result = await fallback().closed();
      log(
        `language server connection closed (the server process exited); ` +
          `action=${CloseAction[result.action]}`
      );
      return result;
    },
  };
  const clientOptions: LanguageClientOptions = {
    errorHandler,
    documentSelector: [
      // Every per-game script id, not just the generic one: the server treats
      // them all as the script language (packages/server/src/documents.ts).
      ...PARADOX_SCRIPT_LANGS.map((language) => ({ language, scheme: "file" })),
      { language: "paradox-loc", scheme: "file" },
      { language: "paradox-gui", scheme: "file" },
      // Descriptor and format-doc files are jomini script too. They reach the
      // server for folding and the outline only — every other handler keys off
      // the script ids / `paradox-gui` / `paradox-loc` and returns nothing for
      // them, validation included.
      { language: "paradox-mod", scheme: "file" },
      { language: "paradox-info", scheme: "file" },
    ],
    initializationOptions: initOptions,
    outputChannel: output,
    progressOnInitialization: true,
    // Hover cards (§D) emit sanitized `<span style="color:var(--vscode-*)">` for
    // kind badges and scope pills. Opt in to the HTML subset; content degrades to
    // plain markdown on clients that strip it (client.js sanitizes, default off).
    markdown: { supportHtml: true },
    middleware: {
      // Hover markdown arrives untrusted, which strips command: links. Trust
      // exactly the commands our cards emit ("N references", "Examples Wiki").
      provideHover: async (document, position, token, next) => {
        const hover = await next(document, position, token);
        if (hover) {
          for (const content of hover.contents) {
            if (content instanceof vscode.MarkdownString) {
              content.isTrusted = { enabledCommands: ["px.showReferences", "px.showExamplesWiki"] };
              // Theme icons must be enabled per MarkdownString: the
              // `markdown: { supportHtml: true }` client option above does NOT
              // cover them. Without this the kind badges arrive as the literal
              // text `$(symbol-method)`, which is why the server gates them on
              // the `hoverIcons` capability we declare in initOptions.
              content.supportThemeIcons = true;
            }
          }
        }
        return hover;
      },
    },
  };
  const lc = new LanguageClient("px", "Paradox Modding Toolkit", serverOptions, clientOptions);
  client = lc;
  // Every start/stop transition is logged, so a restart loop is visible in the
  // output channel next to the server's own FATAL line.
  lc.onDidChangeState((e) => log(`language server: ${State[e.oldState]} -> ${State[e.newState]}`));

  lc.onNotification(statusNotification, (payload: StatusPayload) => {
    lastServerStatus = payload;
    updateStatus();
  });

  lc.onNotification(progressNotification, (payload: ProgressPayload) => {
    statusBar.setPhase(payload.phase, payload.state, payload.detail);
  });

  await lc.start();
  context.subscriptions.push({ dispose: () => void lc.stop() });

  const lookupLoc: LocLookup = (key) =>
    lc.sendRequest<LocEntryInfo[]>(lookupLocRequest, { key } satisfies LookupLocParams);

  // ---- mod file watching (forwarded to the server) --------------------------

  let modWatchers: vscode.FileSystemWatcher[] = [];
  const notifyModFileChanged = (fsPath: string) => {
    void lc.sendNotification(modFileChangedNotification, { fsPath });
  };
  // One watcher per DISTINCT TOP-LEVEL root (§B5): the mod plus every parent
  // mod, so edits in a parent (multi-mod / compat-patch workspaces) re-index
  // too, minus the nested and under-the-game roots whose recursive watcher
  // would only report the same file a second time.
  const wireModWatcher = () => {
    for (const w of modWatchers) w.dispose();
    modWatchers = [];
    const watchRoots = planWatchRoots([cfg.modPath, ...cfg.parentPaths], cfg.gamePath);
    log(`watching ${watchRoots.length} root(s) for mod file changes`);
    for (const root of watchRoots) {
      // .mod included so origin labels (descriptor name= in hovers) stay fresh.
      const w = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(root), "**/*.{txt,yml,gui,mod}")
      );
      w.onDidChange((uri) => notifyModFileChanged(uri.fsPath));
      w.onDidCreate((uri) => notifyModFileChanged(uri.fsPath));
      w.onDidDelete((uri) => notifyModFileChanged(uri.fsPath));
      modWatchers.push(w);
    }
  };
  wireModWatcher();
  context.subscriptions.push({ dispose: () => modWatchers.forEach((w) => w.dispose()) });

  const watchedRoots = (c: PxConfig) => [c.modPath ?? "", ...c.parentPaths].join(";");

  // Recompute config-dependent state when settings change.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("px")) return;
      const oldRoots = watchedRoots(cfg);
      cfg = resolveConfig();
      tiger.resetErrorNotice();
      tiger.refreshStatus();
      updateStatus();
      updateInfoDocContext(cfg);
      if (watchedRoots(cfg) !== oldRoots) {
        wireModWatcher();
        reapplyLanguages();
      }
      descriptorFeature.refresh();
      void lc.sendNotification(configChangedNotification, toSettings(cfg));
      // Re-run tiger so changed diagnostics suppression settings take effect.
      if (e.affectsConfiguration("px.diagnostics")) tiger.run(false);
    })
  );

  // Adding/removing workspace folders changes the parent-mod set (and possibly
  // the default modPath): recompute, rewire, re-run language detection.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      cfg = resolveConfig();
      updateStatus();
      // Same trigger the PX item's visibility uses: a folder change can turn
      // the workspace into (or out of) a mod workspace, and tiger's gate
      // must follow.
      tiger.refreshStatus();
      updateInfoDocContext(cfg);
      wireModWatcher();
      reapplyLanguages();
      descriptorFeature.refresh();
      void lc.sendNotification(configChangedNotification, toSettings(cfg));
    })
  );

  // ---- client-side providers -------------------------------------------------

  const tracker = new LocReferenceTracker();
  tracker.wire(context);
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      LOC_SELECTOR,
      new LocFileDefinitionProvider(tracker, () => cfg)
    ),
    registerSimulateEventLens(() => cfg.isCk3Workspace)
  );

  // Title button "Open .info Reference" shows only when the active file maps to
  // a game folder that has a relevant _*.info doc.
  updateInfoDocContext(cfg);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => updateInfoDocContext(cfg)));

  // ---- commands ---------------------------------------------------------------

  context.subscriptions.push(
    vscode.commands.registerCommand("px.reloadScriptDocs", async () => {
      const result = await lc.sendRequest<ReloadDocsResult>(reloadDocsRequest, { force: true });
      void vscode.window.showInformationMessage(
        `Paradox Modding Toolkit: reloaded script_docs data (${result.tokens} tokens).`
      );
    }),
    vscode.commands.registerCommand("px.dumpIndexStats", async () => {
      const stats = await lc.sendRequest<IndexStats>(indexStatsRequest);
      log(`index stats: ${JSON.stringify(stats, null, 2)}`);
      output.show(true);
    }),
    vscode.commands.registerCommand("px.runTiger", () => tiger.run(true)),
    // Target of the "N references" hover link: open the references peek for
    // the hovered site (the LSP reference provider supplies the locations).
    vscode.commands.registerCommand(
      "px.showReferences",
      async (uriStr: string, line: number, character: number) => {
        const uri = vscode.Uri.parse(uriStr);
        const position = new vscode.Position(line, character);
        const locations =
          (await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeReferenceProvider",
            uri,
            position
          )) ?? [];
        await vscode.commands.executeCommand("editor.action.showReferences", uri, position, locations);
      }
    ),
    vscode.commands.registerCommand("px.editLocalization", (arg?: unknown) =>
      editLocalizationCommand(lookupLoc, cfgForActive(), notifyModFileChanged, arg)
    ),
    vscode.commands.registerCommand("px.openLocalizationSideBySide", (arg?: unknown) =>
      openLocalizationSideBySide(lookupLoc, arg)
    ),
    vscode.commands.registerCommand("px.jumpToScriptReference", () => jumpToScriptReference(tracker, cfg)),
    vscode.commands.registerCommand("px.insertDate", () => insertDateCommand(cfgForActive().calendar)),
    vscode.commands.registerCommand("px.generateCalendarLoc", () =>
      generateCalendarLocCommand(cfgForActive())
    ),
    vscode.commands.registerCommand("px.createTranslation", () =>
      createTranslationCommand(cfgForActive(), log)
    ),
    vscode.commands.registerCommand("px.createTranslationMod", () => createTranslationModCommand(cfg, log)),
    vscode.commands.registerCommand("px.openInfoDocs", () => openInfoDocsCommand(cfg)),
    vscode.commands.registerCommand("px.openVanillaExamples", () => openVanillaExamplesCommand()),
    vscode.commands.registerCommand("px.convertToDds", (arg?: vscode.Uri, multi?: vscode.Uri[]) =>
      convertToDdsCommand(arg, multi)
    ),
    // The guidelines are one page of the Wiki now, so the palette entry opens
    // the hub there instead of a panel of its own.
    vscode.commands.registerCommand("px.imageGuidelines", () =>
      WikiPanel.show(context, metaFor(cfg.gameId), IMAGE_GUIDELINES_ARTICLE)
    ),
    DdsPreviewProvider.register(context)
  );

  // ---- overview suite --------------------------------------------------------

  // Created here (not with the watcher commands below) because the Project
  // webview shows the watcher switch and the focus mod.
  const errorLog = new ErrorLogWatcher(() => cfg, log);
  context.subscriptions.push(errorLog);
  const focus = new FocusMod(context.workspaceState, () => cfg);
  const views = registerPxViews(context, lc, () => cfg, focus);
  registerDashboardView(context, {
    getCfg: () => cfg,
    focus,
    errorLog,
    workspaceState: context.workspaceState,
  });
  context.subscriptions.push(
    // A wrapper, because a menu contribution cannot pass the filter query to
    // the built-in command. The `@ext:` query filters the Shortcuts UI to this
    // extension; if a VS Code build ever shows an empty list, "px." is the
    // fallback query.
    // The toolkit's community server: the Project panel's Info group and the
    // palette both land here. Permanent invite, so it never needs a refresh.
    vscode.commands.registerCommand("px.openDiscord", () =>
      vscode.env.openExternal(vscode.Uri.parse("https://discord.gg/ESstwqycug"))
    ),
    vscode.commands.registerCommand("px.openKeybindings", () =>
      vscode.commands.executeCommand("workbench.action.openGlobalKeybindings", "@ext:jdeffner.px-toolkit")
    ),
    // Workspace scope: the settings that matter here (paths, focus, excludes)
    // are per-project taste, and the User tab is one click away in the editor.
    // Since VS Code 1.135 the settings editor opens as a modal overlay whenever
    // workbench.editor.useModal is not "off" (default "some"); the preferences
    // service decides that before any command argument is read, and the group id
    // that would override it is stripped from the command's options. Merging the
    // modal part back into the main window is the only command-level route to a
    // normal tab, and the move carries the search query in the editor view state.
    vscode.commands.registerCommand("px.openSettings", async () => {
      await vscode.commands.executeCommand("workbench.action.openWorkspaceSettings", {
        query: "@ext:jdeffner.px-toolkit",
      });
      // Undefined on builds before 1.135, where neither the setting nor the
      // move command exists.
      const useModal = vscode.workspace.getConfiguration("workbench.editor").get<string>("useModal");
      if (useModal !== undefined && useModal !== "off")
        await vscode.commands.executeCommand("workbench.action.moveModalEditorToMain");
    }),
    // Checked = visible, so the setting stores the INVERSE of the picks. The
    // catalog is the panel's own row list for the active game, which is why it
    // is built with the live problem count. Global scope: panel taste is
    // personal, not per project. The config listener refreshes the panel.
    vscode.commands.registerCommand("px.customizeSidebar", async () => {
      type Item = vscode.QuickPickItem & { command: string };
      const hidden = new Set(hiddenRows());
      const items: Item[] = [
        ...actionGroups(metaFor(cfg.gameId), errorLog.problemCount).flatMap((g) =>
          g.items.map((it) => ({
            label: `${g.label}: ${it.label}`,
            description: it.command,
            picked: !hidden.has(it.command),
            command: it.command,
          }))
        ),
      ];
      const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        title: "Customize the Project panel rows",
        placeHolder: "Checked rows show in the Project panel; unchecked ones are hidden",
      });
      if (!picked) return;
      const visible = new Set(picked.map((i) => i.command));
      const next = items.filter((i) => !visible.has(i.command)).map((i) => i.command);
      // Ids for rows this game never shows (another game's tiger rows) are
      // kept, so switching games back restores what was hidden there.
      const unknown = hiddenRows().filter((id) => !items.some((i) => i.command === id));
      await vscode.workspace
        .getConfiguration("px")
        .update("sidebar.hidden", [...next, ...unknown], vscode.ConfigurationTarget.Global);
    })
  );
  // Event-graph fetches carry the focus mod (unless a call already scoped it),
  // so the graph shows the mod the sidebar shows.
  const fetchGraph = (params: EventGraphParams) =>
    lc.sendRequest<EventGraph>(eventGraphRequest, { modRoot: views.focusRoot(), ...params });
  const fetchEventDetail = (id: string) =>
    lc.sendRequest<EventDetail | null>(eventDetailRequest, { id } satisfies EventDetailParams);
  // Inspector actions: loc writes reuse the BOM-correct edit machinery; the
  // option scaffold inserts before the event's closing brace and creates loc.
  const graphActions = {
    fetchDetail: fetchEventDetail,
    // The dropdowns in the graph inspector offer only what the server knows:
    // the profile's structure table, the schema's reference fields resolved
    // through the index, and the script_docs tokens.
    fetchVocabulary: () =>
      lc.sendRequest<EventVocabularyResult>(eventVocabularyRequest, {
        modRoot: views.focusRoot(),
      } satisfies EventVocabularyParams),
    // A nested row's value resolved to the set it belongs to (a secret, a
    // trait…), so the inspector can offer the honest dropdown the static
    // key-name vocabulary cannot.
    fetchValueOptions: (value: string) =>
      lc.sendRequest<EventValueOptionsResult | null>(eventValueOptionsRequest, {
        value,
        modRoot: views.focusRoot(),
      } satisfies EventValueOptionsParams),
    fetchBanner: (theme: string) =>
      lc.sendRequest<EventBannerResult>(eventBannerRequest, { theme } satisfies EventBannerParams),
    textureRoots: () => ({ gamePath: cfg.gamePath, modPath: cfg.modPath }),
    notifyChanged: notifyModFileChanged,
    async editLoc(key: string, value: string, file?: string, line?: number): Promise<void> {
      if (file !== undefined && line !== undefined) {
        if (!replaceLocLineValue(file, line, value))
          throw new Error(`line ${line + 1} is not a loc entry anymore`);
        notifyModFileChanged(file);
        return;
      }
      if (!cfg.modPath) throw new Error("no mod folder configured");
      // Vanilla-only keys go to the replace override; new keys to the mod's
      // sibling loc file — never new keys into localization/replace.
      const target = await writeLocSmart(cfg, lookupLoc, key, value);
      notifyModFileChanged(target);
    },
    async addOption(id: string, file: string, endLine: number, count: number): Promise<void> {
      const optionKey = `${id}.${String.fromCharCode(97 + Math.min(count, 25))}`;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const edit = new vscode.WorkspaceEdit();
      edit.insert(doc.uri, new vscode.Position(endLine, 0), `\toption = {\n\t\tname = ${optionKey}\n\t}\n`);
      if (!(await vscode.workspace.applyEdit(edit))) throw new Error("edit rejected");
      await doc.save();
      notifyModFileChanged(file);
      // The loc key belongs to the mod that owns the event file (multi-mod).
      const owner = modRootFor(file, cfg);
      const locCfg = owner && owner !== cfg.modPath ? { ...cfg, modPath: owner } : cfg;
      if (locCfg.modPath) {
        const locFile = upsertNewModLoc(locCfg, optionKey, "New option");
        notifyModFileChanged(locFile);
      }
    },
    async createEvent(
      id: string,
      file: string | null,
      type: string,
      title: string,
      desc: string,
      options: number
    ): Promise<void> {
      const ns = id.split(".")[0];
      let target = file;
      if (!target) {
        if (!cfg.modPath) throw new Error("no mod folder configured");
        target = path.join(cfg.modPath, "events", `${ns}_events.txt`);
      }
      const letters = Array.from({ length: Math.min(options, 26) }, (_, i) => String.fromCharCode(97 + i));
      const optionBlocks = letters.map((l) => `\toption = {\n\t\tname = ${id}.${l}\n\t}\n`).join("");
      const block = `${id} = {\n\ttype = ${type}\n\ttitle = ${id}.t\n\tdesc = ${id}.desc\n${optionBlocks}}\n`;
      if (!fs.existsSync(target)) {
        // A fresh namespace file: the BOM and the namespace header the engine wants.
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, `\uFEFFnamespace = ${ns}\n\n${block}`, "utf8");
      } else {
        const text = fs.readFileSync(target, "utf8");
        const sep = text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
        fs.appendFileSync(target, `${sep}${block}`, "utf8");
      }
      notifyModFileChanged(target);
      const owner = modRootFor(target, cfg);
      const locCfg = owner && owner !== cfg.modPath ? { ...cfg, modPath: owner } : cfg;
      if (locCfg.modPath) {
        const writes: Array<[string, string]> = [
          [`${id}.t`, title || "New event"],
          [`${id}.desc`, desc || "Describe what is happening here."],
          ...letters.map((l): [string, string] => [`${id}.${l}`, "New option"]),
        ];
        for (const [key, value] of writes) notifyModFileChanged(upsertNewModLoc(locCfg, key, value));
      }
    },
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("px.refreshViews", () => views.refreshAll()),
    // Reads the FOCUSED mod's declared dependencies, so in a multi-mod
    // workspace the picker flags the right mod's parents.
    vscode.commands.registerCommand("px.addDependencyMod", () =>
      addDependencyModCommand(cfg, views.focusRoot())
    ),
    vscode.commands.registerCommand("px.reduceEditorLoad", () => reduceEditorLoadCommand()),
    vscode.commands.registerCommand("px.showDependencies", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isScriptLang(editor.document.languageId)) {
        void vscode.window.showWarningMessage(
          "Paradox Modding Toolkit: place the cursor on a definition in a script (.txt) file."
        );
        return;
      }
      const params: DependenciesParams = {
        uri: editor.document.uri.toString(),
        position: {
          line: editor.selection.active.line,
          character: editor.selection.active.character,
        },
      };
      const result = await lc.sendRequest<DependenciesResult>(dependenciesRequest, params);
      views.showDependencies(result);
      await vscode.commands.executeCommand("px.dependencies.focus");
      if (!result.def) {
        void vscode.window.showInformationMessage(
          "Paradox Modding Toolkit: no indexed definition under the cursor."
        );
      }
    }),
    // The id is optional: the CodeLens and the graph inspector name the event
    // they sit on, the palette entry resolves it from the cursor.
    vscode.commands.registerCommand("px.simulateEvent", async (arg?: unknown) => {
      const id = typeof arg === "string" && arg !== "" ? arg : await resolveEventIdAtCursor(lc);
      if (!id) return;
      EventSimPanel.show(fetchEventDetail, id);
    }),
    vscode.commands.registerCommand("px.showEventGraph", () => {
      EventGraphPanel.show(context, fetchGraph, seedGraphParams(cfg), graphActions);
    }),
    vscode.commands.registerCommand("px.openWiki", () => {
      WikiPanel.show(context, metaFor(cfg.gameId));
    }),
    vscode.commands.registerCommand("px.openCredits", () => {
      CreditsPanel.show();
    }),
    // The argument is optional: the palette entry and the Project panel open
    // the catalog, a hover link names the article it wants.
    vscode.commands.registerCommand("px.showExamplesWiki", (arg?: unknown) => {
      ExampleWikiPanel.show(
        context,
        {
          fetchIndex: () => lc.sendRequest<ExampleWikiIndex>(exampleWikiRequest, null),
          fetchEntry: (params: ExampleWikiEntryParams) =>
            lc.sendRequest<ExampleWikiDetail | null>(exampleWikiEntryRequest, params),
        },
        exampleWikiTarget(arg)
      );
    }),
    vscode.commands.registerCommand("px.showGuiTree", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editor.document.uri.fsPath.toLowerCase().endsWith(".gui")) {
        void vscode.window.showWarningMessage("Paradox Modding Toolkit: open a .gui file first.");
        return;
      }
      GuiTreePanel.show(
        (uri, text) =>
          lc.sendRequest<GuiTree>(guiTreeRequest, { uri: uri.toString(), text } satisfies GuiTreeParams),
        editor.document
      );
    }),
    vscode.commands.registerCommand("px.guiTreeToggleParents", () => GuiTreePanel.toggleParents()),
    vscode.commands.registerCommand("px.openGuiEditor", () => {
      // The editor draws real pixels, so it needs the game's own measured text
      // metrics; without them every text box would be sized by another game's
      // font. The .gui LANGUAGE features (completion, hovers, diagnostics, the
      // widget tree) need no calibration and stay on for every game.
      if (!guiEditorSupported(cfg.gameId)) {
        const meta = metaFor(cfg.gameId);
        void vscode.window.showInformationMessage(
          `Paradox Modding Toolkit: the GUI editor is not calibrated for ${meta.name} yet, ` +
            `so its canvas would place widgets wrongly. ` +
            `.gui editing and the GUI Widget Tree work for ${meta.name}.`
        );
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editor.document.uri.fsPath.toLowerCase().endsWith(".gui")) {
        void vscode.window.showWarningMessage("Paradox Modding Toolkit: open a .gui file first.");
        return;
      }
      GuiEditorPanel.show(
        context,
        (uri, text, visibility, textOptions) =>
          lc.sendRequest<GuiLayoutResult>(guiLayoutRequest, {
            uri: uri.toString(),
            text,
            visibility,
            loc: textOptions.loc,
            previewValues: textOptions.previewValues,
          } satisfies GuiLayoutParams),
        (uri, text, line, placement) =>
          lc.sendRequest<GuiWidgetInfo | null>(guiWidgetInfoRequest, {
            uri: uri.toString(),
            text,
            line,
            placement,
          } satisfies GuiWidgetInfoParams),
        (uri, text, request) =>
          lc.sendRequest<GuiSourceEditResult | null>(guiSourceEditRequest, {
            uri: uri.toString(),
            text,
            ...request,
          } satisfies GuiSourceEditParams),
        (uri, text) =>
          lc.sendRequest<GuiVocabularyResult>(guiVocabularyRequest, {
            uri: uri.toString(),
            text,
          } satisfies GuiVocabularyParams),
        (uri, text, line) =>
          lc.sendRequest<GuiDependenciesResult>(guiDependenciesRequest, {
            uri: uri.toString(),
            text,
            line,
          } satisfies GuiDependenciesParams),
        (uri, text, entries) =>
          lc.sendRequest<GuiPreviewResult>(guiPreviewRequest, {
            uri: uri.toString(),
            text,
            entries,
          } satisfies GuiPreviewParams),
        (file) =>
          lc.sendRequest<GuiSaveValuesResult>(guiSaveValuesRequest, {
            path: file,
          } satisfies GuiSaveValuesParams),
        // A mod's own key wins over the game's, which is the order lookupLoc answers in.
        async (key) => (await lookupLoc(key)).find((e) => e.value !== undefined)?.value,
        editor.document,
        { gamePath: cfg.gamePath, modPath: modRootFor(editor.document.uri.fsPath, cfg) ?? cfg.modPath },
        metaFor(cfg.gameId)
      );
    }),
    // The argument is optional: the palette entry and the Project panel open a
    // blank form, an "edit this trait" caller names the definition.
    vscode.commands.registerCommand("px.createTrait", (arg?: unknown) => {
      const meta = metaFor(cfg.gameId);
      if (!creatorSupported(cfg.gameId, "trait")) {
        void vscode.window.showInformationMessage(
          `Paradox Modding Toolkit: no Trait Creator has been built for ${meta.name} yet.`
        );
        return;
      }
      const named = typeof arg === "object" && arg !== null ? (arg as { name?: unknown }).name : undefined;
      TraitCreatorPanel.show(context, {
        cfg: cfgForActive(),
        meta,
        actions: {
          fetchForm: (params) => lc.sendRequest<DefinitionForm | null>(definitionFormRequest, params),
          editDefinition: (params) => lc.sendRequest<DefinitionEditResult>(definitionEditRequest, params),
        },
        lookupLoc,
        ...(typeof named === "string" && named !== "" ? { name: named } : {}),
      });
    }),
    // `arg` is the optional target ({ name, label }): the Dynasty Tree and
    // "New Coat of Arms…" open the panel straight on the arms they mean.
    vscode.commands.registerCommand("px.openFlagBuilder", (arg?: unknown) => {
      const meta = metaFor(cfg.gameId);
      if (!requireFlagBuilder()) return;
      // Game first, then dependency mods, then the workspace's own mods: the
      // load order, so a mod's flag of the same name wins like in the game.
      const roots: FlagRoot[] = [];
      if (cfg.gamePath) roots.push({ label: "game", path: cfg.gamePath });
      for (const p of [...cfg.parentPaths, ...cfg.workspaceMods, ...(cfg.modPath ? [cfg.modPath] : [])]) {
        if (!roots.some((r) => r.path === p)) roots.push({ label: readModName(p), path: p });
      }
      const mods = [...(cfg.modPath ? [cfg.modPath] : []), ...cfg.workspaceMods]
        .filter((p, i, all) => all.indexOf(p) === i)
        .map((p) => ({ label: readModName(p), path: p }));
      FlagBuilderPanel.show(context, {
        meta,
        roots,
        mods,
        gameMissing: cfg.gamePath === null,
        target: coaTargetArg(arg),
      });
    }),
    vscode.commands.registerCommand("px.createCoatOfArms", () => {
      if (!requireFlagBuilder()) return;
      void createCoatOfArmsCommand(lc, views.focusRoot());
    }),
    // The argument is optional: the palette entry opens the picker, a deep link
    // names the dynasty it wants.
    vscode.commands.registerCommand("px.openDynastyTree", (arg?: unknown) => {
      const mods = [...(cfg.modPath ? [cfg.modPath] : []), ...cfg.workspaceMods]
        .filter((p, i, all) => all.indexOf(p) === i)
        .map((p) => ({ label: readModName(p), path: p }));
      // Nothing to write into, or nothing to read: say which, in the words the
      // setup flow uses, instead of opening a panel that cannot do anything.
      const problems: string[] = [];
      if (mods.length === 0)
        problems.push(
          "No mod folder found. Open your mod folder (the one with the mod's descriptor) as a workspace folder."
        );
      if (!cfg.gamePath)
        problems.push(
          `No game folder set, so only your own dynasties are listed. Set px.gamePath to .../steamapps/common/${metaFor(cfg.gameId).name}/game`
        );
      DynastyTreePanel.show(
        context,
        {
          fetchTree: (params) => lc.sendRequest<DynastyTreeResult>(dynastyTreeRequest, params),
          fetchOptions: (params) =>
            lc.sendRequest<EventValueOptionsResult | null>(eventValueOptionsRequest, params),
          writeLoc: (key, value) => writeLocSmart(cfg, lookupLoc, key, value),
        },
        {
          meta: metaFor(cfg.gameId),
          gamePath: cfg.gamePath,
          mods,
          modRoot: views.focusRoot(),
          filePrefix: scaffoldPrefix(cfg),
          setupProblem: problems.join(" ") || undefined,
        },
        typeof arg === "object" && arg !== null && typeof (arg as { dynasty?: unknown }).dynasty === "string"
          ? (arg as { dynasty: string }).dynasty
          : undefined
      );
    }),
    // A creator row of the Create group. The profile decides which games have
    // one (GameMeta.creators); a game with no culture folder gets an honest
    // "nothing to write" from the form request rather than an empty panel.
    vscode.commands.registerCommand("px.createCulture", (arg?: unknown) => {
      const active = cfgForActive();
      if (!metaFor(active.gameId).creators?.some((c) => c.kind === "culture")) {
        void vscode.window.showInformationMessage(
          `Paradox Modding Toolkit: the Culture Creator is not built for ${metaFor(active.gameId).name} yet.`
        );
        return;
      }
      CultureCreatorPanel.show(
        context,
        active,
        {
          fetchForm: (params: DefinitionFormParams) =>
            lc.sendRequest<DefinitionForm | null>(definitionFormRequest, params),
          applyEdits: (params: DefinitionEditParams) =>
            lc.sendRequest<DefinitionEditResult>(definitionEditRequest, params),
          lookupLoc,
        },
        creatorName(arg)
      );
    }),
    vscode.commands.registerCommand("px.modReport", () => modReportCommand(lc, views.focusRoot())),
    vscode.commands.registerCommand("px.tigerGenerateConf", () => generateTigerConfCommand(cfgForActive())),
    vscode.commands.registerCommand("px.tigerCreateBaseline", async () => {
      // The baseline belongs to the mod of the active editor (multi-mod).
      const bl = baselineFileFor(cfgForActive().modPath);
      if (!bl) {
        void vscode.window.showWarningMessage(
          "Paradox Modding Toolkit: no mod folder found. Open your mod folder (the one with the mod's descriptor) as a workspace folder."
        );
        return;
      }
      const count = await tiger.createBaseline(bl);
      if (count !== null) {
        await context.workspaceState.update("px.tigerBaselineEnabled", true);
        void vscode.window.showInformationMessage(
          `Paradox Modding Toolkit: baseline saved (${count} current reports suppressed). Tiger now shows new problems only.`
        );
        tiger.run(false);
      }
    }),
    vscode.commands.registerCommand("px.tigerToggleBaseline", async () => {
      if (!requireTiger()) return;
      const enabled = !context.workspaceState.get<boolean>("px.tigerBaselineEnabled");
      await context.workspaceState.update("px.tigerBaselineEnabled", enabled);
      // The filter only bites when a baseline snapshot exists for the mod;
      // claiming "problems are filtered" without one would be a lie.
      const bl = baselineFileFor(cfgForActive().modPath);
      if (enabled && (!bl || !fs.existsSync(bl))) {
        void vscode.window
          .showInformationMessage(
            "Paradox Modding Toolkit: tiger baseline is ON, but this mod has no baseline snapshot yet — " +
              "all problems are still shown. Create one to snapshot today's problems.",
            "Create Baseline"
          )
          .then((choice) => {
            if (choice) void vscode.commands.executeCommand("px.tigerCreateBaseline");
          });
        return;
      }
      void vscode.window.showInformationMessage(
        enabled
          ? "Paradox Modding Toolkit: tiger baseline ON — only problems newer than the baseline are shown."
          : "Paradox Modding Toolkit: tiger baseline OFF — all problems are shown."
      );
      tiger.run(false);
    }),
    vscode.commands.registerCommand("px.tigerUnused", () => {
      if (!requireTiger()) return;
      tigerUnusedOnce = true;
      tiger.run(true);
    })
  );

  // ---- workflow accelerators ---------------------------------------------------

  // Steam Workshop (px.openWorkshopPage; publishing lives in the panel).
  registerWorkshop(context, { cfg: () => cfg, focusRoot: () => views.focusRoot(), log });
  registerBBCodeSupport(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("px.openWorkshopManager", () => {
      const mods = [...(cfg.modPath ? [cfg.modPath] : []), ...cfg.workspaceMods]
        .filter((p, i, all) => all.indexOf(p) === i)
        .map((p) => ({ label: readModName(p), path: p }));
      if (!mods.length) {
        void vscode.window.showWarningMessage(
          "Paradox Modding Toolkit: open a mod folder as a workspace folder first."
        );
        return;
      }
      WorkshopPanel.show(context, {
        gamePath: cfg.gamePath,
        meta: metaFor(cfg.gameId),
        mods,
        active: views.focusRoot() ?? cfg.modPath,
        log,
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("px.watchErrorLog", () => errorLog.toggle()),
    vscode.commands.registerCommand("px.clearGameProblems", () => errorLog.clear()),
    vscode.commands.registerCommand("px.launchGame", () => launchGame(cfgForActive(), errorLog, DEBUG_ARGS)),
    vscode.commands.registerCommand("px.translateNext", () =>
      translateNextCommand(lc, cfgForActive(), notifyModFileChanged)
    ),
    vscode.commands.registerCommand("px.newContent", () =>
      newContentCommand(cfgForActive(), notifyModFileChanged)
    ),
    vscode.commands.registerCommand("px.createMod", () => createModCommand(cfg, log))
  );
  registerGameRun(context, cfgForActive, errorLog);

  // ---- onboarding ---------------------------------------------------------------

  const setupDeps: SetupDeps = {
    storageDir,
    getConfig: () => cfg,
    refresh: () => {
      cfg = resolveConfig();
      tiger.resetErrorNotice();
      tiger.refreshStatus();
      updateStatus();
      void lc.sendNotification(configChangedNotification, toSettings(cfg));
    },
    log,
    showOutput: () => output.show(true),
    hasBundledDumps: (gameId: string) =>
      fs.existsSync(context.asAbsolutePath(path.join("data", gameId, "script_docs"))),
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("px.setup", () => runSetup(setupDeps)),
    vscode.commands.registerCommand("px.downloadTiger", () => downloadTigerCommand(setupDeps, false))
  );
  maybeNudgeSetup(context, cfg);
}

/**
 * The event id to simulate: the definition under the cursor, resolved exactly
 * the way Show Dependencies resolves one (server-side, from the indexed word).
 * When that is not an event the user is asked, pre-filled with the word under
 * the cursor when it is shaped like an id.
 */
/**
 * Where to open the event graph from. In order: the id the cursor sits ON, the
 * definition the cursor sits INSIDE (the common case, since you are editing an
 * event body and not its id line), then the file's namespace.
 *
 * The enclosing definition is read from the text rather than from the index: a
 * top-level `name = {` at column zero is exactly what the indexer calls a
 * definition in these folders, and this way the command answers without a round
 * trip to a server that may still be indexing.
 */
function seedGraphParams(cfg: PxConfig): EventGraphParams {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isScriptLang(editor.document.languageId)) return {};
  // The graph shows the mod the file belongs to, focus pin or no focus pin:
  // launching it from an AGOT file and getting "nothing indexed" because the
  // focus was pinned elsewhere reads as a bug, not as a filter.
  const owner = modRootFor(editor.document.uri.fsPath, cfg);
  const scoped = (p: EventGraphParams): EventGraphParams => (owner ? { ...p, modRoot: owner } : p);
  const fsPath = editor.document.uri.fsPath.replace(/\\/g, "/").toLowerCase();
  const named = /\/(on_action|decisions)\//.test(fsPath);
  const range = editor.document.getWordRangeAtPosition(editor.selection.active, /[A-Za-z0-9_.-]+/);
  const word = range ? editor.document.getText(range) : "";
  if (/^[A-Za-z0-9_-]+\.\d+$/.test(word)) return scoped({ root: word });
  if (named && /^[A-Za-z0-9_-]{3,}$/.test(word)) return scoped({ root: word });

  for (let line = editor.selection.active.line; line >= 0; line--) {
    const match = /^([A-Za-z][A-Za-z0-9_.-]*)\s*=\s*\{/.exec(editor.document.lineAt(line).text);
    if (!match) continue;
    if (/^[A-Za-z0-9_-]+\.\d+$/.test(match[1]) || named) return scoped({ root: match[1] });
    break;
  }
  const ns = /(?:^|\n)\s*namespace\s*=\s*([A-Za-z0-9_-]+)/.exec(editor.document.getText());
  return scoped(ns ? { namespace: ns[1] } : {});
}

/** The definition a creator command was asked to open, or nothing. */
function creatorName(arg: unknown): string | undefined {
  if (typeof arg === "string" && arg.trim() !== "") return arg.trim();
  if (arg && typeof arg === "object" && "name" in arg) {
    const name = (arg as { name?: unknown }).name;
    if (typeof name === "string" && name.trim() !== "") return name.trim();
  }
  return undefined;
}

/** The article a `px.showExamplesWiki` argument names, or nothing. The argument
 *  comes off a hover command link, so it is validated, not trusted. */
function exampleWikiTarget(arg: unknown): ExampleWikiTarget | undefined {
  if (typeof arg !== "object" || arg === null) return undefined;
  const { name, kind } = arg as { name?: unknown; kind?: unknown };
  if (typeof name !== "string" || name === "" || typeof kind !== "string") return undefined;
  return { name, kind: kind as ExampleWikiTarget["kind"] };
}

async function resolveEventIdAtCursor(lc: LanguageClient): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  let word = "";
  if (editor && isScriptLang(editor.document.languageId)) {
    const params: DependenciesParams = {
      uri: editor.document.uri.toString(),
      position: {
        line: editor.selection.active.line,
        character: editor.selection.active.character,
      },
    };
    const result = await lc.sendRequest<DependenciesResult>(dependenciesRequest, params);
    if (result.def?.kind === "event") return result.def.name;
    const range = editor.document.getWordRangeAtPosition(editor.selection.active, /[A-Za-z0-9_.-]+/);
    if (range) word = editor.document.getText(range);
  }
  const typed = await vscode.window.showInputBox({
    title: "Simulate Event",
    prompt: "Event id to walk through",
    placeHolder: "namespace.123",
    value: /^[A-Za-z][A-Za-z0-9_-]*\.\d+$/.test(word) ? word : "",
  });
  return typed?.trim() || undefined;
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
