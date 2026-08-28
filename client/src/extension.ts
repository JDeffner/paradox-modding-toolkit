/**
 * Client entry point: starts the CK3 language server and keeps for itself only
 * what must live in the editor process — language-mode switching, tiger process
 * management and downloads, setup/Steam detection, the status bar, and commands
 * that touch the VS Code UI. All parsing/indexing/analysis lives in the server.
 */
import * as vscode from "vscode";
import * as path from "path";
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";
import { modRootFor, readConfig, type Ck3Config } from "./config";
import { ensureFileAssociations, wireLanguageDetection } from "./languageMode";
import { findDownloadedTiger } from "./tigerDownload";
import { downloadTigerCommand, maybeNudgeSetup, runSetup, type SetupDeps } from "./setup";
import { maybeNudgeMigration, openParadoxToolkit } from "./migrate";
import { Ck3StatusBar } from "./statusBar";
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
import { createTranslationCommand } from "./translation";
import { createTranslationModCommand } from "./translationMod";
import { openInfoDocsCommand, openVanillaExamplesCommand, updateInfoDocContext } from "./infoDocs";
import { registerCk3Views } from "./views";
import { EventGraphPanel } from "./webviews/eventGraph/panel";
import { GuiTreePanel } from "./webviews/guiTree/panel";
import { GuiPreviewPanel } from "./webviews/guiPreview/panel";
import { DdsPreviewProvider } from "./ddsEditor";
import { convertToDdsCommand } from "./ddsConvert";
import { modReportCommand } from "./modReport";
import { generateTigerConfCommand } from "./tiger/conf";
import { ErrorLogWatcher, launchGameDebugCommand } from "./errorLog";
import { translateNextCommand } from "./translationLoop";
import { newContentCommand } from "./scaffold/command";
import { registerDescriptorMod } from "./descriptorMod";
import * as fs from "fs";
import {
  configChangedNotification,
  indexStatsRequest,
  lookupLocRequest,
  modFileChangedNotification,
  reloadDocsRequest,
  statusNotification,
  type Ck3InitOptions,
  type Ck3Settings,
  type Ck3StatusPayload,
  type LocEntryInfo,
  type LookupLocParams,
  type ReloadDocsResult,
  eventDetailRequest,
  eventGraphRequest,
  guiTreeRequest,
  guiLayoutRequest,
  type EventDetail,
  type EventDetailParams,
  type EventGraph,
  type EventGraphParams,
  type GuiTree,
  type GuiTreeParams,
  type GuiLayoutParams,
  type GuiLayoutResult,
  guiWidgetEditRequest,
  type GuiWidgetEditParams,
  type GuiWidgetEditResult,
  dependenciesRequest,
  type DependenciesParams,
  type DependenciesResult,
} from "../../shared/src/protocol";
import type { IndexStats } from "../../shared/src/types";

const LOC_SELECTOR: vscode.DocumentSelector = { language: "paradox-loc", scheme: "file" };

let output: vscode.LogOutputChannel;
let cfg: Ck3Config;
let client: LanguageClient | undefined;

function log(msg: string): void {
  output.appendLine(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function toSettings(c: Ck3Config): Ck3Settings {
  return {
    gamePath: c.gamePath,
    logsPath: c.logsPath,
    modPath: c.modPath,
    parentPaths: c.parentPaths,
    workspaceMods: c.workspaceMods,
    locLanguage: c.locLanguage,
    scopeInlayHints: c.scopeInlayHints,
    diagnosticsIgnore: c.diagnosticsIgnore,
    diagnosticsIgnorePatterns: c.diagnosticsIgnorePatterns,
    diagnosticsVanilla: c.diagnosticsVanilla,
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel("CK3 Modding Toolkit", { log: true });
  context.subscriptions.push(output);

  const storageDir = context.globalStorageUri.fsPath;

  // Effective tiger: explicit setting wins, else the copy we downloaded ourselves.
  const resolveConfig = () => {
    const c = readConfig();
    if (!c.tigerPath) c.tigerPath = findDownloadedTiger(storageDir);
    return c;
  };

  cfg = resolveConfig();
  if (cfg.warnings.length > 0) {
    // Fail soft: features degrade, extension still activates.
    void vscode.window.showWarningMessage(`CK3 Modding Toolkit: ${cfg.warnings.join(" — ")}`);
  }
  log(
    `activated. gamePath=${cfg.gamePath ?? "(none)"} logsPath=${cfg.logsPath ?? "(none)"} ` +
      `modPath=${cfg.modPath ?? "(none)"} workspaceMods=${cfg.workspaceMods.length} ` +
      `parents=${cfg.parentPaths.length} tigerPath=${cfg.tigerPath ?? "(none)"}`
  );

  // Multi-mod workspaces: mod-targeted commands act on the mod that owns the
  // active editor's file, falling back to the primary mod folder.
  const cfgForActive = (): Ck3Config => {
    const file = vscode.window.activeTextEditor?.document.uri.fsPath;
    const root = file ? modRootFor(file, cfg) : null;
    return root && root !== cfg.modPath ? { ...cfg, modPath: root } : cfg;
  };

  const reapplyLanguages = wireLanguageDetection(context, () => cfg);
  void ensureFileAssociations(cfg);

  const statusBar = new Ck3StatusBar();
  context.subscriptions.push(statusBar);
  let lastServerStatus: Ck3StatusPayload = {
    tokens: 0,
    tokensFromScriptDocs: false,
    definitions: 0,
    indexing: true,
  };
  const updateStatus = () => {
    // The visible surface (status bar, sidebar views, palette commands) follows
    // the workspace: present in CK3 workspaces, absent elsewhere. Both change
    // handlers below run through here, so this tracks folder/setting changes.
    statusBar.setVisible(cfg.isCk3Workspace);
    void vscode.commands.executeCommand("setContext", "ck3.isCk3Workspace", cfg.isCk3Workspace);
    statusBar.update({
      tokens: lastServerStatus.tokens,
      tokensFromScriptDocs: lastServerStatus.tokensFromScriptDocs,
      definitions: lastServerStatus.definitions,
      indexing: lastServerStatus.indexing,
      gameOk: cfg.gamePath !== null,
      modOk: cfg.modPath !== null,
      tigerOk: cfg.tigerPath !== null,
    });
  };
  updateStatus();

  // Baselines are per mod (multi-mod workspaces): each run suppresses the
  // baseline of the mod it validates, not one global file.
  const baselineFileFor = (root: string | null) =>
    root ? path.join(root, ".ck3modding", "tiger-baseline.json") : null;
  let tigerUnusedOnce = false;
  const tigerExtraArgs = (modRoot: string): string[] => {
    const args: string[] = [];
    const bl = baselineFileFor(modRoot);
    if (context.workspaceState.get<boolean>("ck3.tigerBaselineEnabled") && bl && fs.existsSync(bl)) {
      args.push("--suppress", bl);
    }
    if (tigerUnusedOnce) {
      args.push("--unused");
      tigerUnusedOnce = false;
    }
    return args;
  };
  const tiger = new TigerRunner(() => cfg, log, tigerExtraArgs);
  context.subscriptions.push(tiger);
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => tiger.onDidSaveDocument(doc)));

  // descriptor.mod: completion/hover/diagnostics + missing-descriptor error.
  const descriptorFeature = registerDescriptorMod(context, () => cfg, log);
  context.subscriptions.push(descriptorFeature);

  // ---- language server -----------------------------------------------------

  const serverModule = context.asAbsolutePath(path.join("dist", "server.js"));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };
  const initOptions: Ck3InitOptions = {
    storageDir,
    wikidocsDir: context.asAbsolutePath("wikidocs"),
    settings: toSettings(cfg),
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { language: "paradox", scheme: "file" },
      { language: "paradox-loc", scheme: "file" },
      { language: "paradox-gui", scheme: "file" },
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
      // exactly the one command our cards emit ("N references").
      provideHover: async (document, position, token, next) => {
        const hover = await next(document, position, token);
        if (hover) {
          for (const content of hover.contents) {
            if (content instanceof vscode.MarkdownString) {
              content.isTrusted = { enabledCommands: ["ck3.showReferences"] };
            }
          }
        }
        return hover;
      },
    },
  };
  const lc = new LanguageClient("ck3", "CK3 Modding", serverOptions, clientOptions);
  client = lc;

  lc.onNotification(statusNotification, (payload: Ck3StatusPayload) => {
    lastServerStatus = payload;
    updateStatus();
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
  // One watcher per root: the mod plus every parent mod, so edits in a parent
  // (multi-mod / compat-patch workspaces) re-index too.
  const wireModWatcher = () => {
    for (const w of modWatchers) w.dispose();
    modWatchers = [];
    for (const root of [cfg.modPath, ...cfg.parentPaths]) {
      if (!root) continue;
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

  const watchedRoots = (c: Ck3Config) => [c.modPath ?? "", ...c.parentPaths].join(";");

  // Recompute config-dependent state when settings change.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("ck3")) return;
      const oldRoots = watchedRoots(cfg);
      cfg = resolveConfig();
      tiger.resetErrorNotice();
      updateStatus();
      updateInfoDocContext(cfg);
      if (watchedRoots(cfg) !== oldRoots) {
        wireModWatcher();
        reapplyLanguages();
      }
      descriptorFeature.refresh();
      void lc.sendNotification(configChangedNotification, toSettings(cfg));
      // Re-run tiger so changed diagnostics suppression settings take effect.
      if (e.affectsConfiguration("ck3.diagnostics")) tiger.run(false);
    })
  );

  // Adding/removing workspace folders changes the parent-mod set (and possibly
  // the default modPath): recompute, rewire, re-run language detection.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      cfg = resolveConfig();
      updateStatus();
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
    vscode.languages.registerDefinitionProvider(LOC_SELECTOR, new LocFileDefinitionProvider(tracker, () => cfg))
  );

  // Title button "Open .info Reference" shows only when the active file maps to
  // a game folder that has a relevant _*.info doc.
  updateInfoDocContext(cfg);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => updateInfoDocContext(cfg))
  );

  // ---- commands ---------------------------------------------------------------

  context.subscriptions.push(
    vscode.commands.registerCommand("ck3.reloadScriptDocs", async () => {
      const result = await lc.sendRequest<ReloadDocsResult>(reloadDocsRequest, { force: true });
      void vscode.window.showInformationMessage(`CK3: reloaded script_docs data (${result.tokens} tokens).`);
    }),
    vscode.commands.registerCommand("ck3.dumpIndexStats", async () => {
      const stats = await lc.sendRequest<IndexStats>(indexStatsRequest);
      log(`index stats: ${JSON.stringify(stats, null, 2)}`);
      output.show(true);
    }),
    vscode.commands.registerCommand("ck3.runTiger", () => tiger.run(true)),
    // Target of the "N references" hover link: open the references peek for
    // the hovered site (the LSP reference provider supplies the locations).
    vscode.commands.registerCommand(
      "ck3.showReferences",
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
    vscode.commands.registerCommand("ck3.editLocalization", (arg?: unknown) =>
      editLocalizationCommand(lookupLoc, cfgForActive(), notifyModFileChanged, arg)
    ),
    vscode.commands.registerCommand("ck3.openLocalizationSideBySide", (arg?: unknown) =>
      openLocalizationSideBySide(lookupLoc, arg)
    ),
    vscode.commands.registerCommand("ck3.jumpToScriptReference", () => jumpToScriptReference(tracker, cfg)),
    vscode.commands.registerCommand("ck3.createTranslation", () => createTranslationCommand(cfgForActive(), log)),
    vscode.commands.registerCommand("ck3.createTranslationMod", () => createTranslationModCommand(cfg, log)),
    vscode.commands.registerCommand("ck3.openInfoDocs", () => openInfoDocsCommand(cfg)),
    vscode.commands.registerCommand("ck3.openVanillaExamples", () => openVanillaExamplesCommand()),
    vscode.commands.registerCommand("ck3.convertToDds", (arg?: vscode.Uri, multi?: vscode.Uri[]) =>
      convertToDdsCommand(arg, multi)
    ),
    vscode.commands.registerCommand("ck3.imageGuidelines", () =>
      vscode.commands.executeCommand(
        "markdown.showPreview",
        vscode.Uri.file(context.asAbsolutePath("media/image-guidelines.md"))
      )
    ),
    vscode.commands.registerCommand("ck3.tutorial", () =>
      vscode.commands.executeCommand(
        "markdown.showPreview",
        vscode.Uri.file(context.asAbsolutePath("media/tutorial/index.md"))
      )
    ),
    DdsPreviewProvider.register(context)
  );

  // ---- overview suite --------------------------------------------------------

  const views = registerCk3Views(context, lc, () => cfg);
  // Event-graph fetches carry the focus mod (unless a call already scoped it),
  // so the graph shows the mod the sidebar shows.
  const fetchGraph = (params: EventGraphParams) =>
    lc.sendRequest<EventGraph>(eventGraphRequest, { modRoot: views.focusRoot(), ...params });
  // Inspector actions: loc writes reuse the BOM-correct edit machinery; the
  // option scaffold inserts before the event's closing brace and creates loc.
  const graphActions = {
    fetchDetail: (id: string) =>
      lc.sendRequest<EventDetail | null>(eventDetailRequest, { id } satisfies EventDetailParams),
    async editLoc(key: string, value: string, file?: string, line?: number): Promise<void> {
      if (file !== undefined && line !== undefined) {
        if (!replaceLocLineValue(file, line, value)) throw new Error(`line ${line + 1} is not a loc entry anymore`);
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
      edit.insert(
        doc.uri,
        new vscode.Position(endLine, 0),
        `\toption = {\n\t\tname = ${optionKey}\n\t}\n`
      );
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
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("ck3.refreshViews", () => views.refreshAll()),
    vscode.commands.registerCommand("ck3.showDependencies", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "paradox") {
        void vscode.window.showWarningMessage("CK3: place the cursor on a definition in a script (.txt) file.");
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
      await vscode.commands.executeCommand("ck3.dependencies.focus");
      if (!result.def) {
        void vscode.window.showInformationMessage(
          "CK3: no indexed definition under the cursor."
        );
      }
    }),
    vscode.commands.registerCommand("ck3.showEventGraph", () => {
      // Seed the graph from where the user is: the event id under the cursor,
      // an on_action/decision name in the matching folders, or the file's
      // namespace — so opening from an applicable file shows related nodes.
      const editor = vscode.window.activeTextEditor;
      let params: EventGraphParams = {};
      if (editor && editor.document.languageId === "paradox") {
        const fsPath = editor.document.uri.fsPath.replace(/\\/g, "/").toLowerCase();
        const range = editor.document.getWordRangeAtPosition(
          editor.selection.active,
          /[A-Za-z0-9_.\-]+/
        );
        const word = range ? editor.document.getText(range) : "";
        if (/^[A-Za-z0-9_\-]+\.\d+$/.test(word)) {
          params = { root: word };
        } else if (/\/(on_action|decisions)\//.test(fsPath) && /^[A-Za-z0-9_\-]{3,}$/.test(word)) {
          params = { root: word };
        } else {
          const ns = /(?:^|\n)\s*namespace\s*=\s*([A-Za-z0-9_\-]+)/.exec(editor.document.getText());
          if (ns) params = { namespace: ns[1] };
        }
      }
      EventGraphPanel.show(context, fetchGraph, params, graphActions);
    }),
    vscode.commands.registerCommand("ck3.showGuiTree", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editor.document.uri.fsPath.toLowerCase().endsWith(".gui")) {
        void vscode.window.showWarningMessage("CK3: open a .gui file first.");
        return;
      }
      GuiTreePanel.show(
        (uri, text) =>
          lc.sendRequest<GuiTree>(guiTreeRequest, { uri: uri.toString(), text } satisfies GuiTreeParams),
        editor.document
      );
    }),
    vscode.commands.registerCommand("ck3.guiTreeToggleParents", () => GuiTreePanel.toggleParents()),
    vscode.commands.registerCommand("ck3.showGuiPreview", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editor.document.uri.fsPath.toLowerCase().endsWith(".gui")) {
        void vscode.window.showWarningMessage("CK3: open a .gui file first.");
        return;
      }
      GuiPreviewPanel.show(
        (uri, text) =>
          lc.sendRequest<GuiLayoutResult>(guiLayoutRequest, {
            uri: uri.toString(),
            text,
          } satisfies GuiLayoutParams),
        (uri, text, line, property, values) =>
          lc.sendRequest<GuiWidgetEditResult | null>(guiWidgetEditRequest, {
            uri: uri.toString(),
            text,
            line,
            property,
            values,
          } satisfies GuiWidgetEditParams),
        editor.document,
        // Textures resolve against the mod that owns the previewed .gui file.
        { gamePath: cfg.gamePath, modPath: modRootFor(editor.document.uri.fsPath, cfg) ?? cfg.modPath }
      );
    }),
    vscode.commands.registerCommand("ck3.modReport", () => modReportCommand(lc, views.focusRoot())),
    vscode.commands.registerCommand("ck3.tigerGenerateConf", () => generateTigerConfCommand(cfgForActive())),
    vscode.commands.registerCommand("ck3.tigerCreateBaseline", async () => {
      // The baseline belongs to the mod of the active editor (multi-mod).
      const bl = baselineFileFor(cfgForActive().modPath);
      if (!bl) {
        void vscode.window.showWarningMessage("CK3: no mod folder.");
        return;
      }
      const count = await tiger.createBaseline(bl);
      if (count !== null) {
        await context.workspaceState.update("ck3.tigerBaselineEnabled", true);
        void vscode.window.showInformationMessage(
          `CK3: baseline saved (${count} current reports suppressed). Tiger now shows new problems only.`
        );
        tiger.run(false);
      }
    }),
    vscode.commands.registerCommand("ck3.tigerToggleBaseline", async () => {
      const enabled = !context.workspaceState.get<boolean>("ck3.tigerBaselineEnabled");
      await context.workspaceState.update("ck3.tigerBaselineEnabled", enabled);
      void vscode.window.showInformationMessage(
        enabled
          ? "CK3: tiger baseline ON — only problems newer than the baseline are shown."
          : "CK3: tiger baseline OFF — all problems are shown."
      );
      tiger.run(false);
    }),
    vscode.commands.registerCommand("ck3.tigerUnused", () => {
      tigerUnusedOnce = true;
      tiger.run(true);
    })
  );

  // ---- workflow accelerators ---------------------------------------------------

  const errorLog = new ErrorLogWatcher(() => cfg, log);
  context.subscriptions.push(errorLog);
  context.subscriptions.push(
    vscode.commands.registerCommand("ck3.watchErrorLog", () => errorLog.toggle()),
    vscode.commands.registerCommand("ck3.launchGame", () => launchGameDebugCommand()),
    vscode.commands.registerCommand("ck3.translateNext", () =>
      translateNextCommand(lc, cfgForActive(), notifyModFileChanged)
    ),
    vscode.commands.registerCommand("ck3.newContent", () => newContentCommand(cfgForActive(), notifyModFileChanged))
  );

  // ---- onboarding ---------------------------------------------------------------

  const setupDeps: SetupDeps = {
    storageDir,
    getConfig: () => cfg,
    refresh: () => {
      cfg = resolveConfig();
      tiger.resetErrorNotice();
      updateStatus();
      void lc.sendNotification(configChangedNotification, toSettings(cfg));
    },
    log,
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("ck3.setup", () => runSetup(setupDeps)),
    vscode.commands.registerCommand("ck3.downloadTiger", () => downloadTigerCommand(setupDeps, false)),
    vscode.commands.registerCommand("ck3.openParadoxToolkit", () => openParadoxToolkit())
  );
  // Deprecated id: point the remaining users at JDeffner.px-toolkit, once. It
  // outranks the setup nudge — two popups at startup is one too many, and
  // configuring a dead extension is not the advice anyone needs now.
  if (!maybeNudgeMigration(context)) maybeNudgeSetup(context, cfg);
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
