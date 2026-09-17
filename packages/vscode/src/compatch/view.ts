import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { parseLoc } from "@px-lsp/server/parser";
import type { PxConfig } from "../config";
import { gameDataDir } from "../config";
import { metaFor } from "../meta";
import { locTargetFile, writeLocSmart, type LocLookup } from "../locCommands";
import { inspectRecovery } from "./recovery";
import {
  identifySession,
  readSessionStore,
  inputKey,
  entryInputs,
  refreshFiles,
  applyRelocations,
  queueState,
  queueEntries,
  mergeEligible,
  recordReview,
  replacementCandidates,
  hasConflictMarkers,
  type SessionStore,
} from "./session";
import {
  type Entry,
  type Inventory,
  type Kind,
  type Session,
  type Side,
  type Site,
  emptyInventory,
  scan,
  status,
  fingerprint,
  validateRoots,
  resultPath,
  createResult,
  seedFile,
  hasVanillaLoc,
  isScannableFile,
} from "./core";
import { gameUpdateStatus, mergeGameUpdate, mergeEventUpdate, needsGameUpdate } from "./gameUpdate";

type Row = { root: Side } | { group: Kind } | { entry: Entry } | { page: Kind; direction: number };
export interface CompatchSources {
  sourceA?: string;
  sourceB?: string;
  modRoot?: string;
  oldGame?: string;
  newGame?: string;
}
interface Resolution {
  sessionId: string;
  entryId: string;
  target: vscode.Uri;
  document: vscode.TextDocument;
  original: string;
  version: number;
  disk: string;
  inputs: { file: string; text: string }[];
  result: vscode.Uri;
  relocation?: string;
}
const PAGE_SIZE = 200;
const labels: Record<Kind, string> = {
  event: "Events by ID",
  localization: "Localization by language and key",
  file: "Files by path",
};

class CompatchView implements vscode.TreeDataProvider<Row>, vscode.TextDocumentContentProvider {
  private readonly changes = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changes.event;
  private readonly snapshots = new Map<string, { text: string; label: string; filename: string }>();
  private readonly comparisonStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  private inventory: Inventory = emptyInventory();
  private session: Session | undefined;
  private store: SessionStore = { version: 2, sessions: [] };
  private stateFilter = "all";
  private lens: "file" | "definition" = "file";
  private selected: string | undefined;
  private readonly dirtyInputs = new Set<string>();
  private inputRevision = 0;
  private watchers: vscode.Disposable[] = [];
  private readonly resolutions = new Map<string, Resolution>();
  private busy = false;
  private saveQueue: Promise<void> = Promise.resolve();
  private filter = "";
  private pages: Record<Kind, number> = { event: 0, localization: 0, file: 0 };
  private rows: Partial<Record<Kind, Entry[]>> = {};
  private readonly entryRows = new Map<string, { entry: Entry }>();
  private readonly groupRows: Record<Kind, { group: Kind }> = {
    file: { group: "file" },
    event: { group: "event" },
    localization: { group: "localization" },
  };
  private readonly view: vscode.TreeView<Row>;
  private readonly log = vscode.window.createOutputChannel("Paradox Compatch");
  private readonly stateFile: string | undefined;

  constructor(
    context: vscode.ExtensionContext,
    private readonly getCfg: () => PxConfig
  ) {
    this.stateFile = context.storageUri && path.join(context.storageUri.fsPath, "compatch.json");
    this.view = vscode.window.createTreeView("px.compatch", {
      treeDataProvider: this,
      showCollapseAll: true,
    });
    this.view.message = "Update a mod for a new game version, or compare two sources into a separate result.";
    context.subscriptions.push(
      this.view,
      this.changes,
      this.log,
      this.comparisonStatus,
      { dispose: () => this.watchers.forEach((watcher) => watcher.dispose()) },
      vscode.workspace.onDidChangeTextDocument((event) => this.invalidate(event.document.uri)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.updateComparisonStatus()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateComparisonStatus()),
      vscode.window.tabGroups.onDidChangeTabs(() => this.updateComparisonStatus()),
      vscode.workspace.registerTextDocumentContentProvider("px-compatch", this),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme === "px-compatch")
          setTimeout(() => {
            if (
              !vscode.workspace.textDocuments.some((open) => open.uri.toString() === document.uri.toString())
            )
              this.snapshots.delete(document.uri.toString());
          }, 0);
      })
    );
    const commands: Record<string, (row?: Row & CompatchSources) => Promise<unknown>> = {
      "px.openCompatch": () => this.open(),
      "px.newCompatch": (sources) => this.setup(sources),
      "px.updateModForGame": (sources) =>
        this.setup({ ...sources, modRoot: sources?.modRoot ?? this.getCfg().modPath ?? undefined }),
      "px.compatchSessions": () => this.chooseSession(),
      "px.compatchRenameSession": () => this.renameSession(),
      "px.compatchQueue": () => this.chooseQueue(),
      "px.compatchLens": () => this.chooseLens(),
      "px.compatchNext": () => this.next(),
      "px.compatchRefreshChanged": () => this.refreshChanged(),
      "px.compatchRecovery": () => this.recovery(),
      "px.compatchCoverage": () => this.coverage(),
      "px.compatchValidate": () => this.validate(),
      "px.compatchRuntimeTest": () => this.runtimeTest(),
      "px.compatchApplyResolved": () => this.applyResolved(),
      "px.compatchNextConflict": () => this.nextConflict(),
      "px.compatchPreviousConflict": () => this.nextConflict(-1),
      "px.compatchResolutionInputs": () => this.resolutionInputs(),
      "px.compatchMarkReviewed": (row) => this.review(row, "reviewed"),
      "px.compatchSkip": (row) => this.review(row, "skipped"),
      "px.compatchReopen": (row) => this.reopen(row),
      "px.compatchOpen": (row) => (row && "entry" in row ? this.openEntry(row.entry) : Promise.resolve()),
      "px.compatchRelocate": (row) => (row && "entry" in row ? this.relocate(row.entry) : Promise.resolve()),
      "px.compatchPreviewKey": (row) =>
        row && "entry" in row ? this.createLocalization(row.entry, "B", false) : Promise.resolve(),
      "px.compatchApplyKey": (row) =>
        row && "entry" in row ? this.createLocalization(row.entry, "B", true) : Promise.resolve(),
      "px.refreshCompatch": () => this.refresh(),
      "px.filterCompatch": () => this.setFilter(),
      "px.compatchLanguage": async () => {
        if (!this.session || this.busy) return;
        if (!metaFor(this.session.gameId).compatch) return;
        const language = await vscode.window.showInputBox({
          title: "Compatch localization language",
          value: this.session.localizationLanguage,
          prompt:
            "Language name from l_<language>, such as english, french or german. Rescans sources; reviews for other languages are retained.",
          validateInput: (value) =>
            /^[a-z_]+$/.test(value)
              ? undefined
              : "Use a language name with lowercase letters and underscores.",
        });
        if (language) await this.refresh({ ...this.session, localizationLanguage: language });
      },
      "px.compatchPage": async (row) => {
        if (row && "page" in row) {
          this.pages[row.page] = Math.max(0, this.pages[row.page] + row.direction);
          this.changes.fire();
          await this.persist();
        }
      },
      "px.compatchActions": (row) => this.actions(row),
      "px.compareCompatch": async (row) => {
        if (row && "entry" in row && this.session && !this.busy) {
          if (this.session.mode === "game-update") await this.editMod(row.entry, "B");
          else await this.compare(row.entry, "A", "B");
        }
      },
      "px.compatchFiles": async (row) => {
        if (row && "root" in row) await this.files(row.root);
      },
      "px.compatchGameChanges": async (row) => {
        if (row && "entry" in row) await this.compare(row.entry, "base", "B");
      },
      "px.compatchModChanges": async (row) => {
        if (row && "entry" in row) await this.editMod(row.entry, "base");
      },
      "px.compatchPreviewMerge": async (row) => {
        if (row && "entry" in row) await this.mergeMod(row.entry, false);
      },
      "px.compatchApplyMerge": async (row) => {
        if (row && "entry" in row) await this.mergeMod(row.entry, true);
      },
      "px.compatchEditorActions": async () => {
        const info =
          vscode.window.activeTextEditor && this.sourceForUri(vscode.window.activeTextEditor.document.uri);
        if (!info) return;
        const file = this.inventory.entries.get(JSON.stringify(["file", info.filename]));
        const candidates = [...this.inventory.entries.values()].filter(
          (entry) =>
            entry.kind === "event" &&
            needsGameUpdate(entry) &&
            Object.values(entry.sites)
              .flat()
              .some((site) => site.path === info.filename)
        );
        const entry =
          file && (this.session?.mode !== "game-update" || needsGameUpdate(file))
            ? file
            : candidates.length === 1
              ? candidates[0]
              : (
                  await vscode.window.showQuickPick(
                    candidates.map((entry) => ({ label: entry.name, entry })),
                    { title: "Choose the event to compatch" }
                  )
                )?.entry;
        if (entry) await this.actions({ entry });
      },
      "px.compatchSourceControl": async () => {
        await vscode.commands.executeCommand("workbench.view.scm");
      },
      "px.compatchScanNotes": async () => {
        this.log.show(true);
      },
    };
    for (const [id, action] of Object.entries(commands)) {
      context.subscriptions.push(
        vscode.commands.registerCommand(id, async (row?: Row & CompatchSources) => {
          try {
            if (
              this.session &&
              !["px.newCompatch", "px.updateModForGame", "px.compatchSessions"].includes(id) &&
              this.session.gameId !== this.getCfg().gameId
            )
              throw new Error("The active game changed. Use New Compatch Workspace.");
            if (this.session && this.getCfg().gamePath)
              this.session.protectedRoots = [this.getCfg().gamePath!];
            await action(row);
          } catch (error) {
            this.log.appendLine(`Compatch: ${error instanceof Error ? error.message : String(error)}`);
            void vscode.window.showErrorMessage(
              `Compatch: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        })
      );
    }
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return (
      this.snapshots.get(uri.toString())?.text ??
      "Snapshot closed. Reopen the comparison from the Compatch view."
    );
  }

  private async snapshot(text: string, label: string, filename: string): Promise<vscode.Uri> {
    const uri = vscode.Uri.from({
      scheme: "px-compatch",
      path: `/${label}/${createHash("sha256").update(`${this.session?.id}:${filename}:${text}`).digest("hex").slice(0, 24)}/${path.basename(filename)}`,
    });
    this.snapshots.set(uri.toString(), { text, label, filename });
    const doc = await vscode.workspace.openTextDocument(uri);
    const language = filename.endsWith(".yml")
      ? "paradox-loc"
      : filename.endsWith(".gui")
        ? "paradox-gui"
        : filename.endsWith(".txt")
          ? `paradox-${this.session!.gameId}`
          : "plaintext";
    await vscode.languages.setTextDocumentLanguage(doc, language);
    return uri;
  }

  private sourceForUri(uri: vscode.Uri): { label: string; filename: string; editable: boolean } | undefined {
    const snapshot = this.snapshots.get(uri.toString());
    if (snapshot) return { ...snapshot, editable: false };
    if (uri.scheme !== "file" || this.session?.mode !== "game-update") return;
    for (const side of ["A", "base", "B"] as const) {
      const root = this.session.roots[side];
      if (!root) continue;
      const relative = path.relative(root, uri.fsPath);
      if (
        relative &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      )
        return {
          label: this.sideLabel(side),
          filename: relative.replaceAll(path.sep, "/"),
          editable: side === "A",
        };
    }
  }

  private updateComparisonStatus(): void {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const editor = vscode.window.activeTextEditor;
    const active = editor && this.sourceForUri(editor.document.uri);
    void vscode.commands.executeCommand("setContext", "px.compatchEditor", !!active);
    void vscode.commands.executeCommand("setContext", "px.compatchResolution", !!this.activeResolution());
    this.comparisonStatus.name = "Compatch comparison sources";
    this.comparisonStatus.command = "px.compatchEditorActions";
    if (input instanceof vscode.TabInputTextDiff) {
      const left = this.sourceForUri(input.original),
        right = this.sourceForUri(input.modified);
      if (left && right) {
        this.comparisonStatus.text = `$(git-compare) ${left.label} (left)  |  ${right.label}${right.editable ? " (right, editable)" : " (right)"}`;
        this.comparisonStatus.tooltip = `Left: ${left.label}\n${left.filename}\n\nRight: ${right.label}\n${right.filename}\n\nClick for Compatch actions. Source roles remain visible while scrolling.`;
        this.comparisonStatus.show();
        return;
      }
    }
    if (active) {
      this.comparisonStatus.text = `$(git-compare) ${active.label}${active.editable ? " (editable)" : " (comparison source)"}`;
      this.comparisonStatus.tooltip = `${active.filename}\nClick for Compatch actions.`;
      this.comparisonStatus.show();
    } else this.comparisonStatus.hide();
  }

  getTreeItem(row: Row): vscode.TreeItem {
    if ("root" in row) {
      const item = new vscode.TreeItem(this.sideLabel(row.root));
      item.description = this.session!.roots[row.root]
        ? path.basename(this.session!.roots[row.root]!)
        : "Not selected";
      item.tooltip = this.session!.roots[row.root] ?? "Not selected";
      item.iconPath = new vscode.ThemeIcon("folder-opened");
      item.command = { command: "px.compatchFiles", title: "Browse files", arguments: [row] };
      return item;
    }
    if ("group" in row) {
      const item = new vscode.TreeItem(labels[row.group], vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `group:${row.group}`;
      item.description = String(this.entries(row.group).length);
      return item;
    }
    if ("page" in row) {
      const item = new vscode.TreeItem(row.direction > 0 ? "Next 200 entries" : "Previous 200 entries");
      item.iconPath = new vscode.ThemeIcon(row.direction > 0 ? "arrow-right" : "arrow-left");
      item.command = { command: "px.compatchPage", title: "Change page", arguments: [row] };
      return item;
    }
    const entry = row.entry;
    const state = this.entryStatus(entry);
    const item = new vscode.TreeItem(entry.name);
    item.id = entry.id;
    item.contextValue = `px.compatchEntry${this.session?.mode === "game-update" ? ".update" : ""}${mergeEligible(entry) && this.session?.mode === "game-update" ? ".merge" : ""}${entry.kind === "localization" ? ".key" : ""}${!entry.sites.B.length && entry.kind === "file" ? ".missing" : ""}${this.session?.relocations?.[entry.id] ? ".linked" : ""}${this.session?.reviews[entry.id] ? ".reviewed" : ""}`;
    item.description = state;
    item.iconPath = new vscode.ThemeIcon(
      state === "reviewed"
        ? "check"
        : state === "skipped"
          ? "debug-step-over"
          : state === "same"
            ? "dash"
            : "diff"
    );
    item.tooltip = [
      state,
      ...(this.session?.relocations?.[entry.id]
        ? [
            `Linked replacement: ${this.session.relocations[entry.id]}. The mod file stays at its original path.`,
          ]
        : []),
      ...(this.session?.mode === "game-update" && !entry.sites.B.length
        ? [
            "No matching source was found. Check for a renamed file or moved definition before removing mod content.",
          ]
        : []),
      ...(["A", "B", "base"] as const).flatMap((side) =>
        entry.sites[side].map((site) => `${this.sideLabel(side)}: ${site.path}:${site.line}`)
      ),
      this.session?.mode === "game-update"
        ? "Select to compare New Game Version with your editable Mod. Row actions show Old Game Version changes and a merge preview."
        : "Select to compare. Use the row actions to edit a result or record your review.",
    ].join("\n");
    item.command = { command: "px.compareCompatch", title: "Compare changes", arguments: [row] };
    return item;
  }

  private entries(kind: Kind): Entry[] {
    return (this.rows[kind] ??= (this.session ? queueEntries(this.inventory, this.session) : [])
      .filter(
        (entry) =>
          entry.kind === kind &&
          (this.stateFilter === "all" || this.reviewState(entry) === this.stateFilter) &&
          (!this.filter ||
            `${entry.name} ${this.entryStatus(entry)} ${Object.values(entry.sites)
              .flat()
              .map((s) => s.path)
              .join(" ")}`
              .toLowerCase()
              .includes(this.filter.toLowerCase()))
      )
      .sort((a, b) => a.name.localeCompare(b.name)));
  }

  getChildren(row?: Row): Row[] {
    if (!this.session) return [];
    if (!row) {
      const roots: Row[] = [
        { root: "A" },
        ...(this.session.roots.base ? [{ root: "base" as const }] : []),
        { root: "B" },
      ];
      return [
        ...roots,
        ...(["file", "event", "localization"] as const)
          .filter(
            (kind) => (this.lens === "file" ? kind === "file" : kind !== "file") && this.entries(kind).length
          )
          .map((group) => this.groupRows[group]),
      ];
    }
    if (!("group" in row)) return [];
    const entries = this.entries(row.group);
    const page = Math.min(this.pages[row.group], Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1));
    this.pages[row.group] = page;
    const result: Row[] = entries
      .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      .map((entry) => this.rowFor(entry));
    if (page > 0) result.unshift({ page: row.group, direction: -1 });
    if ((page + 1) * PAGE_SIZE < entries.length) result.push({ page: row.group, direction: 1 });
    return result;
  }

  private changed(): void {
    this.rows = {};
    this.updateSummary();
    this.changes.fire();
  }

  private sideLabel(side: Side): string {
    return this.session?.mode === "game-update"
      ? { A: "Mod", B: "New Game Version", base: "Old Game Version" }[side]
      : this.session?.roots[side]
        ? `${side === "base" ? "Base" : "Source"}: ${path.basename(this.session.roots[side]!)}`
        : "Base";
  }

  private entryStatus(entry: Entry): string {
    if (this.hasDirtyDocument(entry)) return "Unsaved source edits";
    if (entryInputs(entry).some(({ side, relative }) => this.dirtyInputs.has(inputKey(side, relative))))
      return "Sources Changed";
    const review = this.session?.reviews[entry.id];
    if (!review && this.session?.manual?.includes(entry.id)) return "Needs manual review";
    return this.session?.mode === "game-update" && !review ? gameUpdateStatus(entry) : status(entry, review);
  }

  private async persist(): Promise<void> {
    if (!this.stateFile || !this.session) return;
    const filename = this.stateFile;
    identifySession(this.session);
    this.session.lastUsed = new Date().toISOString();
    this.session.navigation = {
      filter: this.filter,
      state: this.stateFilter,
      lens: this.lens,
      pages: this.pages,
      selected: this.selected,
    };
    this.store.sessions = this.store.sessions.filter((session) => session.id !== this.session!.id);
    this.store.sessions.push(this.session);
    this.store.active = this.session.id;
    const text = JSON.stringify(this.store);
    const save = async () => {
      await fs.mkdir(path.dirname(filename), { recursive: true });
      const temporary = `${filename}.tmp`;
      await fs.writeFile(temporary, text, "utf8");
      await fs.rename(temporary, filename);
    };
    this.saveQueue = this.saveQueue.then(save, save);
    await this.saveQueue;
  }

  private async folder(title: string, role?: "mod" | "game"): Promise<string | undefined> {
    const cfg = this.getCfg();
    const candidates: { label: string; description: string; folder: string }[] = [];
    const add = (label: string, folder: string | null | undefined) => {
      if (folder && !candidates.some((item) => item.folder === folder))
        candidates.push({ label, description: folder, folder });
    };
    add("Active mod", cfg.modPath);
    for (const mod of cfg.workspaceMods ?? []) add(`Mod: ${path.basename(mod)}`, mod);
    for (const folder of vscode.workspace.workspaceFolders ?? []) add(folder.name, folder.uri.fsPath);
    add("Installed game", cfg.gamePath);
    for (const mod of cfg.parentPaths ?? []) add(`Dependency: ${path.basename(mod)}`, mod);
    for (const side of ["base", "B", "A"] as const)
      add(`Previous ${this.sideLabel(side)}`, this.session?.roots[side]);
    const choice = await vscode.window.showQuickPick(
      [
        ...candidates,
        { label: "Browse for another folder…", description: "Choose a folder on disk", folder: "" },
      ],
      {
        title,
        matchOnDescription: true,
        placeHolder: "Type a project, mod or game folder name",
      }
    );
    if (!choice) return;
    if (choice.folder)
      return fs.realpath(role === "game" ? (gameDataDir(choice.folder) ?? choice.folder) : choice.folder);
    const pick = await vscode.window.showOpenDialog({
      title,
      defaultUri: candidates[0] ? vscode.Uri.file(candidates[0].folder) : undefined,
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: "Use folder",
    });
    if (!pick?.[0]) return;
    if (pick[0].scheme !== "file") throw new Error("Choose a folder on the local filesystem.");
    return fs.realpath(role === "game" ? (gameDataDir(pick[0].fsPath) ?? pick[0].fsPath) : pick[0].fsPath);
  }

  private async open(): Promise<void> {
    if (!this.session && this.stateFile) {
      try {
        this.store = readSessionStore(JSON.parse(await fs.readFile(this.stateFile, "utf8")));
        const saved = this.store.sessions.find(
          (session) => session.id === this.store.active && session.gameId === this.getCfg().gameId
        );
        if (saved) await this.refresh(saved);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (!this.session && this.getCfg().modPath) {
      const mod = this.getCfg().modPath!;
      const presetFile = path.join(mod, metaFor(this.getCfg().gameId).configDirName, "compatch.json");
      const presetText = await fs.readFile(presetFile, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (presetText !== undefined) {
        const preset = JSON.parse(presetText);
        if (preset.version !== 1 || typeof preset.vanilla !== "string" || typeof preset.newGame !== "string")
          throw new Error("Project compatch.json needs version: 1, vanilla and newGame folder paths.");
        await this.refresh({
          version: 1,
          mode: "game-update",
          gameId: this.getCfg().gameId,
          localizationLanguage: this.getCfg().locLanguage,
          roots: { A: mod, base: path.resolve(mod, preset.vanilla), B: path.resolve(mod, preset.newGame) },
          output: mod,
          protectedRoots: [],
          reviews: {},
          results: {},
        });
      }
    }
    if (!this.session) await this.setup();
    await vscode.commands.executeCommand("px.compatch.focus");
  }

  private async setup(sources?: CompatchSources): Promise<void> {
    if (this.busy) return;
    if (this.stateFile && !this.store.sessions.length) {
      try {
        this.store = readSessionStore(JSON.parse(await fs.readFile(this.stateFile, "utf8")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (this.session) await this.persist();
    const workflow = sources?.modRoot
      ? "Update a mod for a new game version"
      : sources?.sourceA && sources?.sourceB
        ? "Compare two sources into a separate result"
        : await vscode.window.showQuickPick(
            ["Update a mod for a new game version", "Compare two sources into a separate result"],
            { title: "Compatch workflow" }
          );
    if (!workflow) return;
    const update = workflow === "Update a mod for a new game version";
    const A =
      sources?.modRoot ??
      sources?.sourceA ??
      (await this.folder(update ? "Mod: the mod you want to update" : "First source", "mod"));
    if (!A) return;
    const B =
      sources?.newGame ??
      sources?.sourceB ??
      (await this.folder(
        update ? "New Game Version: updated game data" : "Second source",
        update ? "game" : "mod"
      ));
    if (!B) return;
    const baseChoice = update
      ? "Choose a base folder"
      : await vscode.window.showQuickPick(["Compare without a base", "Choose a base folder"], {
          title: "Compatch: optional common base",
          placeHolder: "For a game update, the base is the old game data folder.",
        });
    if (!baseChoice) return;
    const base =
      baseChoice === "Choose a base folder"
        ? (sources?.oldGame ??
          (await this.folder(
            "Old Game Version: the previous game version your mod was built against",
            "game"
          )))
        : null;
    if (base === undefined) return;
    const output = update
      ? A
      : await this.folder("Result: a separate mod folder (create it with New Mod first if needed)");
    if (!output) return;
    const session: Session = {
      version: 1,
      ...(update ? { mode: "game-update" as const } : {}),
      gameId: this.getCfg().gameId,
      localizationLanguage: this.getCfg().locLanguage,
      roots: { A, B, base },
      output,
      protectedRoots: this.getCfg().gamePath ? [this.getCfg().gamePath!] : [],
      reviews: {},
      results: {},
    };
    identifySession(session);
    const name = await vscode.window.showInputBox({
      title: "Name this comparison",
      value: session.name,
      prompt: "Each named session keeps its own review history.",
    });
    session.name = name?.trim() || session.name;
    session.id = createHash("sha256").update(`${session.id}:${Date.now()}`).digest("hex").slice(0, 24);
    await this.refresh(session);
    if (update) await this.recovery();
    await vscode.commands.executeCommand("px.compatch.focus");
  }

  private async refresh(candidate = this.session): Promise<void> {
    if (this.busy) return;
    if (!candidate) {
      await this.open();
      return;
    }
    if (candidate.gameId !== this.getCfg().gameId)
      throw new Error("The active game changed. Start a new comparison for this game.");
    this.busy = true;
    const revision = this.inputRevision;
    const sameSession = candidate === this.session;
    try {
      candidate.protectedRoots = this.getCfg().gamePath ? [this.getCfg().gamePath!] : [];
      await validateRoots(candidate);
      let lastReport = 0;
      const inventory = await vscode.window.withProgress(
        {
          location: { viewId: "px.compatch" },
          title: "Scanning compatch sources",
          cancellable: true,
        },
        (progress, token) =>
          scan(
            candidate,
            metaFor(candidate.gameId).compatch,
            (message) => {
              if (Date.now() - lastReport > 100) {
                progress.report({ message });
                lastReport = Date.now();
              }
            },
            () => token.isCancellationRequested
          )
      );
      this.inventory = inventory;
      candidate.tracked = [
        ...new Set([
          ...(candidate.tracked ?? []),
          ...[...inventory.entries.values()].filter(needsGameUpdate).map((entry) => entry.id),
        ]),
      ];
      applyRelocations(inventory, candidate);
      if (candidate !== this.session) {
        this.filter = candidate.navigation?.filter ?? "";
        this.stateFilter = candidate.navigation?.state ?? "all";
        this.lens = candidate.navigation?.lens ?? "file";
        this.pages = candidate.navigation?.pages ?? { event: 0, localization: 0, file: 0 };
        this.selected = candidate.navigation?.selected;
      }
      this.session = identifySession(candidate);
      if (candidate.validation) candidate.validation.stale = true;
      if (!sameSession || revision === this.inputRevision) this.dirtyInputs.clear();
      this.watchSources();
      await this.persist();
      this.log.clear();
      for (const [side, root] of Object.entries(candidate.roots))
        if (root) this.log.appendLine(`${side}: ${root}`);
      this.log.appendLine(`Result: ${candidate.output}`);
      if (metaFor(candidate.gameId).compatch)
        this.log.appendLine(
          `Localization: ${candidate.localizationLanguage}. Other named localization languages are excluded from this scan.`
        );
      this.log.appendLine(
        "Compares saved UTF-8 text. No load-order winner or gameplay compatibility is inferred. Missing content is not a deletion instruction."
      );
      for (const issue of inventory.issues) this.log.appendLine(issue);
      this.changed();
      this.updateComparisonStatus();
    } finally {
      this.busy = false;
    }
  }

  private async setFilter(): Promise<void> {
    const filter = await vscode.window.showInputBox({
      title: "Filter compatch entries",
      prompt: "Match an ID, key, path or status, such as different or sources changed. Empty shows all.",
      value: this.filter,
    });
    if (filter !== undefined) {
      this.filter = filter;
      this.pages = { event: 0, localization: 0, file: 0 };
      this.view.description = filter ? `Filter: ${filter}` : undefined;
      this.changed();
      await this.persist();
    }
  }

  private async chooseSite(entry: Entry, side: Side, sites = entry.sites[side]): Promise<Site | undefined> {
    if (sites.length <= 1) return sites[0];
    const pick = await vscode.window.showQuickPick(
      sites.map((site) => ({ label: site.path, description: `Line ${site.line}`, site })),
      {
        title: `${this.sideLabel(side)}: ${entry.name}`,
        placeHolder: "Multiple definitions found. Choose a source; no winner is assumed.",
      }
    );
    return pick?.site;
  }

  private hasDirtyDocument(entry: Entry): boolean {
    return entryInputs(entry).some(({ side, relative }) => {
      const root = this.session?.roots[side];
      return (
        root &&
        vscode.workspace.textDocuments.some(
          (doc) => doc.isDirty && doc.uri.toString() === vscode.Uri.file(path.join(root, relative)).toString()
        )
      );
    });
  }

  private invalidate(uri: vscode.Uri): void {
    if (!this.session || uri.scheme !== "file") return;
    for (const side of ["A", "B", "base"] as const) {
      const root = this.session.roots[side];
      if (!root) continue;
      const relative = path.relative(root, uri.fsPath).replaceAll(path.sep, "/");
      if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) continue;
      if (relative.split("/").some((part) => part.startsWith(".") && part !== ".metadata")) continue;
      this.inputRevision++;
      if (this.session.validation) this.session.validation.stale = true;
      if (isScannableFile(relative, this.session, metaFor(this.session.gameId).compatch))
        this.dirtyInputs.add(inputKey(side, relative));
      this.changed();
    }
  }

  private watchSources(): void {
    this.watchers.forEach((watcher) => watcher.dispose());
    this.watchers = [];
    for (const root of Object.values(this.session!.roots)) {
      if (!root) continue;
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, "**/*"));
      this.watchers.push(
        watcher,
        watcher.onDidChange((uri) => this.invalidate(uri)),
        watcher.onDidCreate((uri) => this.invalidate(uri)),
        watcher.onDidDelete((uri) => this.invalidate(uri))
      );
    }
  }

  private async freshEntry(entry: Entry, rejectChanged = false): Promise<Entry> {
    if (!this.session) throw new Error("Open a comparison first.");
    const previous = fingerprint(entry);
    const revision = this.inputRevision;
    const inputs = [
      ...entryInputs(entry),
      ...[...this.dirtyInputs].map((key) => {
        const [side, relative] = JSON.parse(key) as [Side, string];
        return { side, relative };
      }),
    ];
    const affected = await refreshFiles(
      this.inventory,
      this.session,
      metaFor(this.session.gameId).compatch,
      inputs
    );
    if (revision === this.inputRevision)
      for (const input of inputs) {
        const root = this.session.roots[input.side];
        if (
          !vscode.workspace.textDocuments.some(
            (doc) =>
              doc.isDirty &&
              root &&
              doc.uri.toString() === vscode.Uri.file(path.join(root, input.relative)).toString()
          )
        )
          this.dirtyInputs.delete(inputKey(input.side, input.relative));
      }
    const current = this.inventory.entries.get(entry.id) ?? entry;
    if (affected.size && this.session.validation) this.session.validation.stale = true;
    this.selected = current.id;
    this.changed();
    if (
      rejectChanged &&
      (revision !== this.inputRevision || affected.has(entry.id) || previous !== fingerprint(current))
    )
      throw new Error(
        "Source files changed. The row is refreshed. Inspect the new comparison before applying or recording a review."
      );
    return current;
  }

  private async refreshChanged(): Promise<void> {
    if (!this.session || this.busy) return;
    const revision = this.inputRevision;
    const inputs = [...this.dirtyInputs].map((key) => {
      const [side, relative] = JSON.parse(key) as [Side, string];
      return { side, relative };
    });
    await refreshFiles(this.inventory, this.session, metaFor(this.session.gameId).compatch, inputs);
    if (revision === this.inputRevision)
      for (const input of inputs) {
        const root = this.session.roots[input.side];
        if (
          !vscode.workspace.textDocuments.some(
            (doc) =>
              doc.isDirty &&
              root &&
              doc.uri.toString() === vscode.Uri.file(path.join(root, input.relative)).toString()
          )
        )
          this.dirtyInputs.delete(inputKey(input.side, input.relative));
      }
    this.changed();
    await this.persist();
  }

  private updateSummary(): void {
    if (!this.session) return;
    void vscode.commands.executeCommand("setContext", "px.compatchSession", true);
    void vscode.commands.executeCommand(
      "setContext",
      "px.compatchUpdate",
      this.session.mode === "game-update"
    );
    void vscode.commands.executeCommand(
      "setContext",
      "px.compatchCanValidate",
      this.session.mode === "game-update" && !!metaFor(this.session.gameId).tiger && !!this.getCfg().tigerPath
    );
    const entries = queueEntries(this.inventory, this.session).filter((entry) =>
      this.lens === "file" ? entry.kind === "file" : entry.kind !== "file"
    );
    const counts = { pending: 0, manual: 0, reviewed: 0, skipped: 0 };
    for (const entry of entries) counts[this.reviewState(entry)]++;
    this.view.title = this.session.name ?? "Compatch Review";
    this.view.description = `${this.lens === "file" ? "Files" : "Definitions"} · ${this.stateFilter}${this.filter ? ` · ${this.filter}` : ""}`;
    this.view.message = `${counts.pending} pending · ${counts.manual} need manual review · ${counts.reviewed} reviewed · ${counts.skipped} skipped. ${this.dirtyInputs.size ? `${this.dirtyInputs.size} changed inputs. Refresh Changed Sources. ` : ""}${this.inventory.issues.length} scan notes. ${metaFor(this.session.gameId).compatch ? `Files and definitions overlap. Localization: ${this.session.localizationLanguage}.` : "File comparison only."} ${this.session.validation ? `Validation${this.session.validation.stale ? " (outdated)" : ""}: ${this.session.validation.summary}` : "Target validation has not run."}`;
  }

  private async chooseQueue(): Promise<void> {
    const pick = await vscode.window.showQuickPick(
      [
        { label: "All", value: "all" },
        { label: "Pending", value: "pending" },
        { label: "Needs Manual Review", value: "manual" },
        { label: "Reviewed", value: "reviewed" },
        { label: "Skipped", value: "skipped" },
      ],
      { title: "Review queue" }
    );
    if (!pick) return;
    this.stateFilter = pick.value;
    this.pages = { event: 0, localization: 0, file: 0 };
    this.changed();
    await this.persist();
  }

  private reviewState(entry: Entry): ReturnType<typeof queueState> {
    const state = queueState(entry, this.session!);
    return state !== "manual" &&
      (this.hasDirtyDocument(entry) ||
        entryInputs(entry).some(({ side, relative }) => this.dirtyInputs.has(inputKey(side, relative))))
      ? "pending"
      : state;
  }

  private async chooseLens(): Promise<void> {
    if (this.session && !metaFor(this.session.gameId).compatch) {
      this.view.message = "This game profile supports file comparison only.";
      return;
    }
    const pick = await vscode.window.showQuickPick(["Files", "Definitions"], {
      title: "Review by file or definition",
      placeHolder: "Counts overlap. Reviewing a whole file also records its definitions.",
    });
    if (!pick) return;
    this.lens = pick === "Files" ? "file" : "definition";
    this.changed();
    await this.persist();
  }

  private async next(): Promise<void> {
    if (!this.session) return;
    const entries = queueEntries(this.inventory, this.session)
      .filter(
        (entry) =>
          (this.lens === "file" ? entry.kind === "file" : entry.kind !== "file") &&
          ["pending", "manual"].includes(this.reviewState(entry))
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!entries.length) {
      this.view.message =
        "No unreviewed entries in this lens. Check coverage and target validation before testing the mod in game.";
      return;
    }
    const entry = entries[(entries.findIndex((item) => item.id === this.selected) + 1) % entries.length];
    this.stateFilter = "all";
    this.filter = "";
    this.changed();
    this.pages[entry.kind] = Math.floor(
      this.entries(entry.kind).findIndex((item) => item.id === entry.id) / PAGE_SIZE
    );
    this.selected = entry.id;
    this.changes.fire();
    await this.view.reveal(this.rowFor(entry), { select: true, focus: true, expand: true });
    await this.openEntry(entry);
    await this.persist();
  }

  getParent(row: Row): Row | undefined {
    return "entry" in row ? this.groupRows[row.entry.kind] : undefined;
  }

  private rowFor(entry: Entry): { entry: Entry } {
    let row = this.entryRows.get(entry.id);
    if (!row) {
      row = { entry };
      this.entryRows.set(entry.id, row);
    } else row.entry = entry;
    return row;
  }

  private async openEntry(entry: Entry): Promise<void> {
    if (this.session?.mode === "game-update") await this.editMod(entry, "B");
    else await this.compare(entry, "A", "B");
  }

  private async review(row: Row | undefined, state: "reviewed" | "skipped"): Promise<void> {
    if (!row || !("entry" in row) || !this.session || this.busy) return;
    if (this.hasDirtyDocument(row.entry))
      throw new Error("Save your mod edits and source edits before recording a review.");
    const entry = await this.freshEntry(row.entry, true);
    recordReview(this.session, this.inventory, entry, state);
    await this.persist();
    this.changed();
  }

  private async reopen(row?: Row): Promise<void> {
    if (!row || !("entry" in row) || !this.session) return;
    delete this.session.reviews[row.entry.id];
    if (row.entry.kind === "file")
      for (const entry of this.inventory.entries.values())
        if (
          entry.kind !== "file" &&
          entry.sites.A.some((site) => row.entry.sites.A.some((file) => file.path === site.path))
        )
          delete this.session.reviews[entry.id];
    await this.persist();
    this.changed();
  }

  private async chooseSession(): Promise<void> {
    if (this.busy) return;
    if (this.session) await this.persist();
    else if (this.stateFile) {
      try {
        this.store = readSessionStore(JSON.parse(await fs.readFile(this.stateFile, "utf8")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const pick = await vscode.window.showQuickPick(
      this.store.sessions
        .filter((session) => session.gameId === this.getCfg().gameId)
        .sort((a, b) => (b.lastUsed ?? "").localeCompare(a.lastUsed ?? ""))
        .map((session) => ({
          label: session.name!,
          description: session.lastUsed,
          detail: `${session.mode === "game-update" ? "Mod / New Game Version" : "Sources"}: ${session.roots.A} / ${session.roots.B}; result: ${session.output}`,
          session,
        })),
      { title: "Resume a named comparison", matchOnDescription: true, matchOnDetail: true }
    );
    if (pick) await this.refresh(pick.session);
  }

  private async renameSession(): Promise<void> {
    if (!this.session) return;
    const name = await vscode.window.showInputBox({ title: "Rename comparison", value: this.session.name });
    if (!name?.trim()) return;
    this.session.name = name.trim();
    await this.persist();
    this.changed();
  }

  private async recovery(relativePaths?: string[]): Promise<boolean> {
    if (!this.session || this.session.mode !== "game-update") return true;
    const paths = relativePaths ?? [
      ...new Set(
        queueEntries(this.inventory, this.session).flatMap((entry) => entry.sites.A.map((site) => site.path))
      ),
    ];
    const result = await inspectRecovery(this.session.output, paths.slice(0, 100));
    if (paths.length > 100)
      this.log.appendLine(
        `Showing recovery details for the first 100 of ${paths.length} selected files. Each apply checks its exact destination.`
      );
    const lines = result.available
      ? [
          `Repository: ${result.repositoryPath}`,
          ...result.files.map(
            (file) =>
              `${file.relativePath}: ${file.baseline ? `baseline in ${file.baseline === "head" ? "HEAD" : "staged index"}` : "no recoverable baseline"}${file.dirty ? "; pre-existing changes" : ""}`
          ),
        ]
      : [result.reason];
    for (const line of lines) this.log.appendLine(line);
    const ready = result.available && result.files.every((file) => file.baseline !== null);
    if (!relativePaths || !ready) {
      const action = await vscode.window.showInformationMessage(
        `${ready ? "Git recovery baseline found." : "In-place updates need a saved Git baseline in HEAD or the index."} ${result.available && result.dirty ? "Pre-existing changes must be kept separate from this update." : ""} No files are staged or committed by Compatch.`,
        "Show recovery details",
        "Open Source Control",
        "Use separate result"
      );
      if (action === "Show recovery details") this.log.show(true);
      if (action === "Open Source Control") await vscode.commands.executeCommand("workbench.view.scm");
      if (action === "Use separate result")
        await this.setup({ sourceA: this.session.roots.A!, sourceB: this.session.roots.B! });
    }
    return ready;
  }

  private async coverage(): Promise<void> {
    if (!this.session) return;
    for (const side of ["A", "base", "B"] as const)
      if (this.session.roots[side])
        this.log.appendLine(
          `${this.sideLabel(side)}: ${this.inventory.files[side].size} UTF-8 text files; ${this.session.roots[side]}`
        );
    this.log.appendLine(
      metaFor(this.session.gameId).compatch
        ? `Semantic matching: event IDs and ${this.session.localizationLanguage} localization keys. Files and definitions overlap.`
        : "Coverage: file comparison only. No semantic definition matching for this game profile."
    );
    this.log.appendLine(
      `${this.inventory.issues.length} scan notes (skipped files or parse limitations). Other languages, binary files and files above 8 MiB are excluded. An empty update queue does not validate mod-only references. Reviewed is a human decision, separate from validator results and runtime testing.`
    );
    this.log.appendLine(
      `Target validation: ${this.session.validation ? `${this.session.validation.at}: ${this.session.validation.summary}${this.session.validation.stale ? " (outdated)" : ""}; ${this.session.validation.gamePath}` : "not run"}. Runtime checkpoint: ${this.session.runtimeTest ? `${this.session.runtimeTest.at}: ${this.session.runtimeTest.note}` : "not recorded"}.`
    );
    this.log.show(true);
  }

  private async validate(): Promise<void> {
    if (!this.session || this.session.mode !== "game-update") return;
    const session = this.session;
    await this.refreshChanged();
    const revision = this.inputRevision;
    const dirtyBefore = new Set(this.dirtyInputs);
    const result = await vscode.commands.executeCommand<import("./validation").CompatchValidationSummary>(
      "px.validateCompatchTarget",
      { gameId: session.gameId, modPath: session.output, gamePath: session.roots.B! }
    );
    if (!result) return;
    session.validation = {
      at: result.checkedAt,
      gamePath: result.gamePath,
      summary: `${result.errors} errors, ${result.warnings} warnings, ${result.other} other findings`,
      stale:
        this.session !== session ||
        this.inputRevision !== revision ||
        this.dirtyInputs.size > 0 ||
        dirtyBefore.size > 0,
    };
    await this.persist();
    this.changed();
  }

  private async runtimeTest(): Promise<void> {
    if (!this.session) return;
    const note = await vscode.window.showInputBox({
      title: "Record a runtime test",
      prompt:
        "Record the executable version, tested behavior and result. This does not change review or validation status.",
    });
    if (!note?.trim()) return;
    this.session.runtimeTest = { at: new Date().toISOString(), note: note.trim() };
    await this.persist();
  }

  private async relocate(entry: Entry): Promise<void> {
    if (!this.session || entry.kind !== "file") return;
    entry = await this.freshEntry(entry);
    const candidates = replacementCandidates(entry, this.inventory);
    const pick = await vscode.window.showQuickPick(
      [
        ...(this.session.relocations?.[entry.id]
          ? [
              {
                label: "Remove replacement link",
                description: "Compare the original paths again",
                relative: "__unlink__",
              },
            ]
          : []),
        ...candidates.map((candidate) => ({
          label: candidate.relative,
          description: `${candidate.shared.length} shared definition IDs`,
          detail: candidate.shared.slice(0, 12).join(", "),
          relative: candidate.relative,
        })),
        {
          label: "Browse all new-game text files",
          description: "Choose a replacement explicitly",
          relative: "",
        },
      ],
      {
        title: "Find possible replacement",
        placeHolder: "Shared IDs are evidence, not a match. No file is moved or deleted.",
        matchOnDescription: true,
        matchOnDetail: true,
      }
    );
    if (!pick) return;
    if (pick.relative === "__unlink__") {
      delete this.session.relocations?.[entry.id];
      const text = this.inventory.files.B.get(entry.name);
      entry.sites.B = text === undefined ? [] : [{ path: entry.name, line: 1, text }];
      delete this.session.reviews[entry.id];
      await this.persist();
      this.changed();
      return;
    }
    const relative =
      pick.relative ||
      (await vscode.window.showQuickPick([...this.inventory.files.B.keys()].sort(), {
        title: "Link new-game source",
        placeHolder: "Choose the exact replacement file",
      }));
    if (!relative) return;
    const text = this.inventory.files.B.get(relative)!;
    await vscode.commands.executeCommand(
      "vscode.diff",
      await this.snapshot(entry.sites.base[0]?.text ?? "", "Old Game Version", entry.name),
      await this.snapshot(text, "Possible replacement", relative),
      `Review relocation: ${entry.name} → ${relative}`,
      { preview: true }
    );
    const choice = await vscode.window.showInformationMessage(
      `Link ${entry.name} to ${relative} for this comparison? The mod stays at its original path. Check the new game's folder rules before creating any relocated output.`,
      "Link replacement"
    );
    if (choice !== "Link replacement") return;
    (this.session.relocations ??= {})[entry.id] = relative;
    delete this.session.reviews[entry.id];
    applyRelocations(this.inventory, this.session);
    await this.persist();
    this.changed();
  }

  private async compare(entry: Entry, left: Side, right: Side): Promise<void> {
    entry = await this.freshEntry(entry);
    const a = await this.chooseSite(entry, left);
    if (!a && entry.sites[left].length) return;
    const b = await this.chooseSite(entry, right);
    if (!b && entry.sites[right].length) return;
    const filename = a?.path ?? b?.path ?? "missing.txt";
    const leftUri = await this.snapshot(a?.text ?? "", this.sideLabel(left), filename);
    const rightUri = await this.snapshot(b?.text ?? "", this.sideLabel(right), b?.path ?? filename);
    await vscode.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      `${this.sideLabel(left)} ↔ ${this.sideLabel(right)} · ${entry.name}`,
      { preview: true }
    );
  }

  private async files(side: Side): Promise<void> {
    if (!this.session || this.busy) return;
    const items = [...this.inventory.files[side].keys()].sort().map((file) => ({ label: file, file }));
    const pick = await vscode.window.showQuickPick(items, {
      title: `${this.sideLabel(side)} files`,
      matchOnDescription: true,
      placeHolder: "Type a file name or relative path",
    });
    if (!pick) return;
    const uri =
      side === "A" && this.session.mode === "game-update"
        ? vscode.Uri.file(await resultPath(this.session, pick.file))
        : await this.snapshot(this.inventory.files[side].get(pick.file)!, this.sideLabel(side), pick.file);
    await vscode.window.showTextDocument(uri, { preview: true });
  }

  private async editMod(entry: Entry, side: Side): Promise<void> {
    if (!this.session || this.busy || this.session.mode !== "game-update") return;
    entry = await this.freshEntry(entry);
    const mod = await this.chooseSite(entry, "A");
    if (!mod) return;
    const source = await this.chooseSite(entry, side);
    if (!source && entry.sites[side].length) return;
    const target = vscode.Uri.file(await resultPath(this.session, mod.path));
    const modEvents = [...this.inventory.entries.values()].filter(
      (item) => item.kind === "event" && item.sites.A.some((site) => site.path === mod.path)
    );
    // A dedicated single-event override compares only that event, not every
    // unrelated vanilla event in its former file. The mod remains a real file.
    const text = source
      ? entry.kind === "event" && modEvents.length === 1
        ? source.text
        : this.inventory.files[side].get(source.path)!
      : "";
    const uri = await this.snapshot(text, this.sideLabel(side), source?.path ?? mod.path);
    await vscode.commands.executeCommand(
      "vscode.diff",
      uri,
      target,
      `${this.sideLabel(side)} ↔ Mod (editable) · ${path.basename(mod.path)}`,
      {
        preview: true,
        ...(entry.kind === "event" ? { selection: new vscode.Range(mod.line - 1, 0, mod.line - 1, 0) } : {}),
      }
    );
  }

  private async mergeMod(entry: Entry, apply: boolean): Promise<void> {
    if (!this.session || this.busy || this.session.mode !== "game-update") return;
    entry = await this.freshEntry(entry, true);
    if (!mergeEligible(entry))
      throw new Error(
        "Choose a file or event with exactly one Mod, Old Game Version and New Game Version. Missing or duplicate definitions need manual review."
      );
    const session = this.session;
    const target = vscode.Uri.file(await resultPath(session, entry.sites.A[0].path));
    const doc = await vscode.workspace.openTextDocument(target);
    const version = doc.version;
    const original = doc.getText();
    const disk = await fs.readFile(target.fsPath, "utf8");
    const inputs = entryInputs(entry)
      .filter((input) => input.side !== "A")
      .map(({ side, relative }) => ({
        file: path.join(session.roots[side]!, relative),
        text: this.inventory.files[side].get(relative)!,
      }));
    const merged =
      entry.kind === "event"
        ? await mergeEventUpdate(
            this.inventory.files.base.get(entry.sites.base[0].path)!,
            this.inventory.files.B.get(entry.sites.B[0].path)!,
            original,
            entry.name
          )
        : await mergeGameUpdate(entry.sites.base[0].text, entry.sites.B[0].text, original);
    if (doc.version !== version || doc.isClosed)
      throw new Error("The mod file changed during the merge. Try again with its current text.");
    if (!apply || merged.conflicts) {
      if (merged.conflicts) {
        session.manual = [...new Set([...(session.manual ?? []), entry.id])];
        await this.persist();
        this.changed();
      }
      if (!this.stateFile) throw new Error("Open a workspace folder to store an editable resolution.");
      const directory = path.join(path.dirname(this.stateFile), "compatch-resolutions", session.id!);
      await fs.mkdir(directory, { recursive: true });
      const result = vscode.Uri.file(
        path.join(
          directory,
          `${createHash("sha256").update(`${entry.id}:${Date.now()}`).digest("hex").slice(0, 16)}-${path.basename(target.fsPath)}`
        )
      );
      await fs.writeFile(result.fsPath, merged.text, { encoding: "utf8", flag: "wx" });
      this.resolutions.set(result.toString(), {
        sessionId: session.id!,
        entryId: entry.id,
        target,
        document: doc,
        version,
        original,
        disk,
        inputs,
        result,
        relocation: session.relocations?.[entry.id],
      });
      await vscode.commands.executeCommand(
        "vscode.diff",
        await this.snapshot(original, "Mod before resolution", entry.sites.A[0].path),
        result,
        `${merged.conflicts ? "Conflicts" : "Proposed update"}: editable result | ${entry.name}`,
        { preview: true }
      );
      this.view.message =
        "Edit the temporary result on the right. Use Next Conflict and Open Resolution Inputs, then Apply Resolved Result. Your mod is unchanged.";
      return;
    }
    if (!(await this.recovery([entry.sites.A[0].path]))) return;
    if (this.session !== session) return;
    await this.publishResolved(
      {
        sessionId: session.id!,
        entryId: entry.id,
        target,
        document: doc,
        version,
        original,
        disk,
        inputs,
        result: target,
        relocation: session.relocations?.[entry.id],
      },
      merged.text
    );
  }

  private activeResolution(): Resolution | undefined {
    const editor = vscode.window.activeTextEditor;
    const direct = editor && this.resolutions.get(editor.document.uri.toString());
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return (
      direct ??
      (input instanceof vscode.TabInputTextDiff ? this.resolutions.get(input.modified.toString()) : undefined)
    );
  }

  private async applyResolved(): Promise<void> {
    const resolution = this.activeResolution();
    if (!resolution) throw new Error("Open the editable compatch result you want to apply.");
    if (this.session?.id !== resolution.sessionId)
      throw new Error("Resume the comparison that created this result before applying it.");
    const document = await vscode.workspace.openTextDocument(resolution.result);
    const resultVersion = document.version;
    const proposed = document.getText();
    if (hasConflictMarkers(proposed))
      throw new Error("Resolve every conflict marker before applying this result.");
    if (!(await this.recovery([path.relative(this.session.output, resolution.target.fsPath)]))) return;
    await this.publishResolved(resolution, proposed, { document, version: resultVersion });
    this.resolutions.delete(resolution.result.toString());
    this.updateComparisonStatus();
  }

  private async publishResolved(
    resolution: Resolution,
    proposed: string,
    result?: { document: vscode.TextDocument; version: number }
  ): Promise<void> {
    const session = this.session;
    if (!session || session.id !== resolution.sessionId) throw new Error("The active comparison changed.");
    // Preview tabs can close the original mod document. Reopening is safe only
    // while its exact saved bytes and editor text still match the captured input.
    const doc = resolution.document.isClosed
      ? await vscode.workspace.openTextDocument(resolution.target)
      : resolution.document;
    const modVersion = doc.version;
    if (session.relocations?.[resolution.entryId] !== resolution.relocation)
      throw new Error("The replacement link changed. Create a new merge preview.");
    if (
      doc.isClosed ||
      (doc === resolution.document && doc.version !== resolution.version) ||
      doc.getText() !== resolution.original ||
      doc.isDirty
    )
      throw new Error("The mod has unsaved or changed edits. Save it and create a new merge preview.");
    if (hasConflictMarkers(proposed))
      throw new Error("Resolve every conflict marker before applying this result.");
    for (const input of [...resolution.inputs, { file: resolution.target.fsPath, text: resolution.disk }]) {
      if ((await fs.readFile(input.file, "utf8")) !== input.text)
        throw new Error("Source files changed after this result was prepared. Create a new merge preview.");
      const open = vscode.workspace.textDocuments.find(
        (item) => item.uri.toString() === vscode.Uri.file(input.file).toString()
      );
      if (open?.isDirty)
        throw new Error("An input has unsaved edits. Save it and create a new merge preview.");
    }
    await resultPath(session, path.relative(session.output, resolution.target.fsPath));
    let text = seedFile(
      path.relative(session.output, resolution.target.fsPath).replaceAll(path.sep, "/"),
      proposed,
      metaFor(session.gameId).compatch
    );
    if (/\.(txt|yml)$/i.test(resolution.target.fsPath)) {
      const encoding = doc.encoding ?? (resolution.disk.startsWith("\uFEFF") ? "utf8bom" : "utf8");
      if (encoding !== "utf8" && encoding !== "utf8bom")
        throw new Error("Save the mod file as UTF-8 before merging.");
      text = (encoding === "utf8bom" ? "" : "\uFEFF") + text.replace(/^\uFEFF/, "");
    }
    if (doc.isClosed || doc.version !== modVersion || doc.isDirty)
      throw new Error("The mod changed during the source check. Create a new merge preview.");
    if (result && (result.document.isClosed || result.document.version !== result.version))
      throw new Error(
        "The temporary result changed during the source check. Review its current text and apply again."
      );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      doc.uri,
      new vscode.Range(doc.positionAt(0), doc.positionAt(resolution.original.length)),
      text
    );
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error("The editor rejected the mod update.");
    if (!(await doc.save())) throw new Error("The mod update could not be saved.");
    const old = this.inventory.entries.get(resolution.entryId)!;
    const entry = await this.freshEntry(old);
    recordReview(session, this.inventory, entry, "reviewed");
    session.manual = session.manual?.filter((id) => id !== entry.id);
    await this.persist();
    this.changed();
  }

  private async nextConflict(direction = 1): Promise<void> {
    const resolution = this.activeResolution();
    if (!resolution) return;
    const editor = await vscode.window.showTextDocument(resolution.result, { preview: true });
    const text = editor.document.getText();
    const offsets = [...text.matchAll(/^<{7}(?:\s|$)/gm)].map((match) => match.index!);
    if (!offsets.length) {
      this.view.message = "No conflict start markers remain. Review the result, then Apply Resolved Result.";
      return;
    }
    const current = editor.document.offsetAt(editor.selection.active);
    const offset =
      direction > 0
        ? (offsets.find((value) => value > current) ?? offsets[0])
        : ([...offsets].reverse().find((value) => value < current) ?? offsets[offsets.length - 1]);
    const position = editor.document.positionAt(offset);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }

  private async resolutionInputs(): Promise<void> {
    const resolution = this.activeResolution();
    if (!resolution) return;
    const entry = this.inventory.entries.get(resolution.entryId);
    if (!entry) return;
    const pick = await vscode.window.showQuickPick(
      (["base", "A", "B"] as const).map((side) => ({ label: this.sideLabel(side), side })),
      { title: "Open resolution input" }
    );
    if (!pick) return;
    const relative = entry.sites[pick.side][0]?.path;
    const text =
      pick.side === "A"
        ? resolution.original
        : resolution.inputs.find(
            (input) => input.file === path.join(this.session!.roots[pick.side]!, relative!)
          )?.text;
    if (relative && text !== undefined)
      await vscode.window.showTextDocument(
        await this.snapshot(text, `${pick.label} (resolution input)`, relative),
        { preview: true }
      );
  }

  private async source(entry: Entry, side: Side): Promise<void> {
    entry = await this.freshEntry(entry);
    const site = await this.chooseSite(entry, side);
    if (!site) return;
    const text = this.inventory.files[side].get(site.path)!;
    const uri = await this.snapshot(text, `${this.sideLabel(side)} (full file)`, site.path);
    const editor = await vscode.window.showTextDocument(uri);
    const position = new vscode.Position(site.line - 1, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }

  private async linkResult(entry: Entry): Promise<void> {
    const session = this.session!;
    const picked = await vscode.window.showOpenDialog({
      title: "Choose the result file to edit",
      defaultUri: vscode.Uri.file(session.output),
      canSelectMany: false,
      canSelectFiles: true,
    });
    if (!picked?.[0]) return;
    if (picked[0].scheme !== "file") throw new Error("Choose a local result file.");
    const relative = path.relative(session.output, picked[0].fsPath);
    await resultPath(session, relative);
    session.results[entry.id] = relative;
    await this.persist();
    await this.editResult(entry);
  }

  private async editResult(entry: Entry, side?: Side): Promise<void> {
    const session = this.session!;
    const relative = session.results[entry.id];
    if (!relative) {
      await this.linkResult(entry);
      if (session.results[entry.id] && side) await this.editResult(entry, side);
      return;
    }
    const target = vscode.Uri.file(await resultPath(session, relative));
    if (!side) {
      await vscode.window.showTextDocument(target);
      return;
    }
    const site = await this.chooseSite(entry, side);
    if (!site) return;
    const source = await this.snapshot(site.text, side, site.path);
    await vscode.commands.executeCommand(
      "vscode.diff",
      source,
      target,
      `${entry.name}: ${side} → Result (editable)`
    );
  }

  private async createLocalization(entry: Entry, side: Side, apply = false): Promise<void> {
    if (apply && this.hasDirtyDocument(entry))
      throw new Error("Save the localization source edits before applying a key.");
    entry = await this.freshEntry(entry, true);
    if (Object.values(entry.sites).some((sites) => sites.length > 1))
      throw new Error(
        "This key has multiple definitions. Compare the sources manually before choosing its value."
      );
    const site = await this.chooseSite(entry, side);
    if (!site) return;
    const session = this.session!;
    const game = session.mode === "game-update" ? session.roots.B : this.getCfg().gamePath;
    const support = metaFor(session.gameId).compatch;
    if (!game || !support)
      throw new Error("Choose game data first so localization ownership can be checked.");
    const parsed = parseLoc(site.text);
    if (!parsed.language || parsed.entries.length !== 1 || parsed.errors.length)
      throw new Error("Select a valid localization entry.");
    const language = parsed.language;
    const selected = parsed.entries[0];
    const vanilla = await hasVanillaLoc(path.join(game, support.localization), language, selected.key);
    const definitions: Awaited<ReturnType<LocLookup>> = [];
    const walk = async (directory: string): Promise<void> => {
      for (const child of await fs
        .readdir(directory, { withFileTypes: true })
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        })) {
        const file = path.join(directory, child.name);
        if (child.isSymbolicLink()) throw new Error("Resolve localization links before applying a key.");
        if (child.isDirectory()) await walk(file);
        else if (child.isFile() && child.name.endsWith(`_l_${language}.yml`)) {
          const source = parseLoc(await fs.readFile(file, "utf8"));
          for (const value of source.entries.filter((item) => item.key === selected.key))
            definitions.push({ file, line: value.line, source: "mod", value: value.value });
        }
      }
    };
    await walk(path.join(session.output, support.localization));
    if (definitions.length > 1)
      throw new Error("The result has duplicate definitions for this key. Resolve them manually first.");
    if (
      !vanilla &&
      definitions.some((definition) =>
        path.relative(session.output, definition.file).split(path.sep).includes("replace")
      )
    )
      throw new Error(
        "This new mod key is in localization/replace. Move it to its ordinary mod localization file before applying an update."
      );
    if (!definitions.length && vanilla)
      definitions.push({ source: "vanilla", file: path.join(game, support.localization), line: 0 });
    const lookup: LocLookup = async () => definitions;
    const cfg = { ...this.getCfg(), modPath: session.output, locLanguage: language };
    const destination = await locTargetFile(cfg, lookup, selected.key);
    if (!destination) return;
    const relative = path.relative(session.output, destination);
    await resultPath(session, relative);
    const existing = await fs.readFile(destination, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return `\uFEFFl_${language}:\n`;
      throw error;
    });
    const targetParsed = parseLoc(existing);
    if (targetParsed.language !== language || targetParsed.errors.length)
      throw new Error("Repair the destination's localization header or parse errors before applying a key.");
    const current = targetParsed.entries.find((item) => item.key === selected.key);
    const proposed = current
      ? existing.slice(0, current.valueRange.start) + selected.value + existing.slice(current.valueRange.end)
      : `${existing.replace(/\s+$/, "")}\n ${selected.key}:0 "${selected.value}"\n`;
    const detail = `${selected.key} | ${language} to ${language} | ${vanilla ? "vanilla override" : "mod key"} | ${relative}`;
    if (!apply) {
      await vscode.commands.executeCommand(
        "vscode.diff",
        await this.snapshot(existing, "Current localization result", relative),
        await this.snapshot(proposed, "Proposed key update", relative),
        detail,
        { preview: true }
      );
      this.view.message = `${detail}. Use Apply This Key to write this value. Other keys stay unchanged.`;
      return;
    }
    if (
      vscode.workspace.textDocuments.some(
        (doc) => doc.uri.toString() === vscode.Uri.file(destination).toString() && doc.isDirty
      )
    )
      throw new Error("Save the localization result before applying a key. Unsaved values are unchanged.");
    if (session.mode === "game-update" && !(await this.recovery([relative]))) return;
    if (session !== this.session) return;
    await this.freshEntry(entry, true);
    const beforeWrite = await fs.readFile(destination, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return `\uFEFFl_${language}:\n`;
      throw error;
    });
    if (beforeWrite !== existing) throw new Error("The localization result changed. Preview the key again.");
    if (
      this.hasDirtyDocument(entry) ||
      vscode.workspace.textDocuments.some(
        (doc) => doc.uri.toString() === vscode.Uri.file(destination).toString() && doc.isDirty
      )
    )
      throw new Error("Save the localization source and result edits before applying a key.");
    await writeLocSmart(cfg, lookup, selected.key, selected.value);
    session.results[entry.id] = relative;
    if (session.mode === "game-update") {
      await refreshFiles(this.inventory, session, support, [{ side: "A", relative }]);
      const updated = this.inventory.entries.get(entry.id)!;
      recordReview(session, this.inventory, updated, "reviewed");
      if (session.validation) session.validation.stale = true;
    }
    await this.persist();
    this.changed();
    await vscode.window.showTextDocument(vscode.Uri.file(destination), { preview: true });
  }

  private async create(entry: Entry, side: Side): Promise<void> {
    entry = await this.freshEntry(entry, true);
    const site = await this.chooseSite(entry, side);
    if (!site) return;
    const session = this.session!;
    const sourceText = this.inventory.files[side].get(site.path)!;
    const text = seedFile(site.path, sourceText, metaFor(session.gameId).compatch);
    try {
      await createResult(session, site.path, text);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    session.results[entry.id] = site.path;
    await this.persist();
    await this.editResult(entry);
  }

  private async previous(entry: Entry, side: Side): Promise<void> {
    const saved = this.session!.reviews[entry.id];
    if (!saved) return;
    const old = await this.chooseSite(entry, side, saved.sites[side]);
    if (!old && saved.sites[side].length) return;
    const current = await this.chooseSite(entry, side);
    if (!current && entry.sites[side].length) return;
    const filename = current?.path ?? old?.path ?? "missing.txt";
    await vscode.commands.executeCommand(
      "vscode.diff",
      await this.snapshot(old?.text ?? "", `${side}-last-reviewed`, filename),
      await this.snapshot(current?.text ?? "", `${side}-current`, filename),
      `${entry.name}: last reviewed ${side} → current ${side}`
    );
  }

  private async actions(row?: Row): Promise<void> {
    if (!row || !("entry" in row) || !this.session || this.busy) return;
    const entry = row.entry;
    if (this.session.mode === "game-update") {
      const choices = [
        {
          label: "New Game Version ↔ Mod (editable)",
          description: "Edit your original mod on the right",
          run: () => this.editMod(entry, "B"),
        },
        {
          label: "Old Game Version ↔ New Game Version",
          description: "What changed in the game",
          run: () => this.compare(entry, "base", "B"),
        },
        {
          label: "Old Game Version ↔ Mod (editable)",
          description: "What your mod changed",
          run: () => this.editMod(entry, "base"),
        },
      ];
      if (mergeEligible(entry))
        choices.push(
          {
            label: "Preview three-way merge",
            description: "Keep mod edits and carry over game changes; writes nothing",
            run: () => this.mergeMod(entry, false),
          },
          {
            label: "Apply clean game changes",
            description: "Save to the original mod only if Git finds no conflicts",
            run: () => this.mergeMod(entry, true),
          }
        );
      if ((!entry.sites.B.length || this.session.relocations?.[entry.id]) && entry.kind === "file")
        choices.push({
          label: "Find possible replacement",
          description: "Link a new-game source explicitly; keeps original files",
          run: () => this.relocate(entry),
        });
      if (entry.kind === "localization" && entry.sites.B.length === 1)
        choices.push(
          {
            label: "Preview this key",
            description: "Review language, ownership and destination",
            run: () => this.createLocalization(entry, "B", false),
          },
          {
            label: "Apply this key",
            description: "Update only the chosen localization key",
            run: () => this.createLocalization(entry, "B", true),
          }
        );
      for (const side of ["base", "B"] as const)
        choices.push({
          label: `Open full ${this.sideLabel(side)} file`,
          description: "Inspect surrounding definitions and file-local helpers",
          run: () => this.source(entry, side),
        });
      for (const reviewState of ["reviewed", "skipped"] as const)
        choices.push({
          label: reviewState === "reviewed" ? "Mark reviewed" : "Skip for now",
          description: "Record the saved mod and game versions; reopen if they change",
          run: () => this.review({ entry }, reviewState),
        });
      choices.push({
        label: "Review mod changes in Source Control",
        description: "Inspect saved changes against your Git baseline",
        run: async () => {
          await vscode.commands.executeCommand("workbench.view.scm");
        },
      });
      if (this.session.reviews[entry.id])
        choices.push({
          label: "Reopen review",
          description: "Return this entry to the work list status",
          run: () => this.reopen({ entry }),
        });
      const pick = await vscode.window.showQuickPick(choices, {
        title: `${entry.name} · ${this.entryStatus(entry)}`,
        matchOnDescription: true,
      });
      if (pick) await pick.run();
      return;
    }
    const choices: { label: string; description?: string; run: () => Promise<unknown> }[] = [
      {
        label: `Compare ${this.sideLabel("A")} ↔ ${this.sideLabel("B")}`,
        description: "Read-only snapshots; an absent side is empty",
        run: () => this.compare(entry, "A", "B"),
      },
    ];
    for (const side of ["A", "B"] as const) {
      if (this.session.roots.base)
        choices.push({
          label: `Compare ${this.sideLabel("base")} ↔ ${this.sideLabel(side)}`,
          run: () => this.compare(entry, "base", side),
        });
      if (entry.sites[side].length) {
        choices.push({
          label: `Open full ${this.sideLabel(side)} file`,
          description: "Read-only source snapshot",
          run: () => this.source(entry, side),
        });
        choices.push({
          label: `Compare ${side} → result`,
          description: "Edit the result on the right",
          run: () => this.editResult(entry, side),
        });
        if (entry.kind !== "localization" && !entry.name.endsWith(".yml"))
          choices.push({
            label: `Create result from full ${this.sideLabel(side)} file`,
            description:
              "Keeps the source path and every definition; opens existing results without overwriting",
            run: () => this.create(entry, side),
          });
        if (entry.kind === "localization")
          choices.push({
            label: `Apply this key from ${this.sideLabel(side)}`,
            description: "Update only this key; preserve sibling values",
            run: () => this.createLocalization(entry, side, true),
          });
        if (entry.kind === "localization")
          choices.push({
            label: `Preview this key from ${this.sideLabel(side)}`,
            description: "Check source language, ownership and destination",
            run: () => this.createLocalization(entry, side, false),
          });
      }
    }
    choices.push({ label: "Choose existing result file", run: () => this.linkResult(entry) });
    if (this.session.results[entry.id])
      choices.push({
        label: "Open result",
        description: this.session.results[entry.id],
        run: () => this.editResult(entry),
      });
    for (const state of ["reviewed", "skipped"] as const)
      choices.push({
        label: state === "reviewed" ? "Mark reviewed" : "Skip for now",
        description: "Records source snapshots; does not certify game compatibility",
        run: () => this.review({ entry }, state),
      });
    if (this.session.reviews[entry.id]) {
      for (const side of ["A", "B", "base"] as const)
        if (this.session.roots[side])
          choices.push({
            label: `Compare last reviewed ${side} → current ${side}`,
            run: () => this.previous(entry, side),
          });
      choices.push({
        label: "Reopen review",
        run: () => this.reopen({ entry }),
      });
    }
    const pick = await vscode.window.showQuickPick(choices, {
      title: `${entry.name} · ${status(entry, this.session.reviews[entry.id])}`,
      matchOnDescription: true,
    });
    if (pick) await pick.run();
  }
}

export function registerCompatch(context: vscode.ExtensionContext, getCfg: () => PxConfig): void {
  new CompatchView(context, getCfg);
}
