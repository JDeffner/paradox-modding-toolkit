import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { parseLoc } from "@px-lsp/server/parser";
import type { PxConfig } from "../config";
import { gameDataDir } from "../config";
import { metaFor } from "../meta";
import { locTargetFile } from "../locCommands";
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
  localizationSeed,
} from "./core";
import { gameUpdateStatus, mergeGameUpdate, needsGameUpdate } from "./gameUpdate";

type Row = { root: Side } | { group: Kind } | { entry: Entry } | { page: Kind; direction: number };
const PAGE_SIZE = 200;
const labels: Record<Kind, string> = {
  event: "Events by ID",
  localization: "Localization by language and key",
  file: "Files by path",
};

class CompatchView implements vscode.TreeDataProvider<Row>, vscode.TextDocumentContentProvider {
  private readonly changes = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changes.event;
  private readonly snapshots = new Map<string, string>();
  private inventory: Inventory = emptyInventory();
  private session: Session | undefined;
  private busy = false;
  private saveQueue: Promise<void> = Promise.resolve();
  private filter = "";
  private pages: Record<Kind, number> = { event: 0, localization: 0, file: 0 };
  private rows: Partial<Record<Kind, Entry[]>> = {};
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
    this.view.message =
      "Update your mod: choose Mod, Vanilla and New Game Version. Changes are made in your mod and can be reviewed in Git.";
    context.subscriptions.push(
      this.view,
      this.changes,
      this.log,
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
    const commands: Record<string, (row?: Row) => Promise<unknown>> = {
      "px.openCompatch": () => this.open(),
      "px.newCompatch": () => this.setup(),
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
      "px.compatchScanNotes": async () => {
        this.log.show(true);
      },
    };
    for (const [id, action] of Object.entries(commands)) {
      context.subscriptions.push(
        vscode.commands.registerCommand(id, async (row?: Row) => {
          try {
            if (this.session && id !== "px.newCompatch" && this.session.gameId !== this.getCfg().gameId)
              throw new Error("The active game changed. Use New Compatch Workspace.");
            if (this.session && this.getCfg().gamePath)
              this.session.protectedRoots = [this.getCfg().gamePath!];
            await action(row);
          } catch (error) {
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
      this.snapshots.get(uri.toString()) ?? "Snapshot closed. Reopen the comparison from the Compatch view."
    );
  }

  private async snapshot(text: string, label: string, filename: string): Promise<vscode.Uri> {
    const uri = vscode.Uri.from({
      scheme: "px-compatch",
      path: `/${label}/${randomUUID()}/${path.basename(filename)}`,
    });
    this.snapshots.set(uri.toString(), text);
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

  getTreeItem(row: Row): vscode.TreeItem {
    if ("root" in row) {
      const item = new vscode.TreeItem(this.sideLabel(row.root));
      item.description = this.session!.roots[row.root] ?? "Not selected";
      item.tooltip = "Browse files in this folder";
      item.iconPath = new vscode.ThemeIcon("folder-opened");
      item.command = { command: "px.compatchFiles", title: "Browse files", arguments: [row] };
      return item;
    }
    if ("group" in row) {
      const item = new vscode.TreeItem(labels[row.group], vscode.TreeItemCollapsibleState.Collapsed);
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
    item.contextValue =
      this.session?.mode === "game-update"
        ? entry.kind === "file"
          ? "px.compatchUpdateFile"
          : "px.compatchUpdate"
        : "px.compatchEntry";
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
      ...(["A", "B", "base"] as const).flatMap((side) =>
        entry.sites[side].map((site) => `${this.sideLabel(side)}: ${site.path}:${site.line}`)
      ),
      this.session?.mode === "game-update"
        ? "Select to compare New Game Version with your editable Mod. Row actions show Vanilla changes and a merge preview."
        : "Select to compare. Use the row actions to edit a result or record your review.",
    ].join("\n");
    item.command = { command: "px.compareCompatch", title: "Compare changes", arguments: [row] };
    return item;
  }

  private entries(kind: Kind): Entry[] {
    return (this.rows[kind] ??= [...this.inventory.entries.values()]
      .filter(
        (entry) =>
          entry.kind === kind &&
          (this.session?.mode !== "game-update" || needsGameUpdate(entry)) &&
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
      const roots: Row[] =
        this.session.mode === "game-update" ? [{ root: "A" }, { root: "base" }, { root: "B" }] : [];
      return [
        ...roots,
        ...(["file", "event", "localization"] as const)
          .filter((kind) => this.entries(kind).length)
          .map((group) => ({ group })),
      ];
    }
    if (!("group" in row)) return [];
    const entries = this.entries(row.group);
    const page = Math.min(this.pages[row.group], Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1));
    this.pages[row.group] = page;
    const result: Row[] = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((entry) => ({ entry }));
    if (page > 0) result.unshift({ page: row.group, direction: -1 });
    if ((page + 1) * PAGE_SIZE < entries.length) result.push({ page: row.group, direction: 1 });
    return result;
  }

  private changed(): void {
    this.rows = {};
    this.changes.fire();
  }

  private sideLabel(side: Side): string {
    return this.session?.mode === "game-update"
      ? { A: "Mod", B: "New Game Version", base: "Vanilla" }[side]
      : side;
  }

  private entryStatus(entry: Entry): string {
    const review = this.session?.reviews[entry.id];
    return this.session?.mode === "game-update" && !review ? gameUpdateStatus(entry) : status(entry, review);
  }

  private async persist(): Promise<void> {
    if (!this.stateFile || !this.session) return;
    const filename = this.stateFile;
    const text = JSON.stringify(this.session);
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
        const saved = JSON.parse(await fs.readFile(this.stateFile, "utf8")) as Session;
        if (saved.version !== 1 || saved.gameId !== this.getCfg().gameId)
          throw new Error("Saved comparison belongs to another game. Use New Compatch Workspace.");
        await this.refresh(saved);
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

  private async setup(): Promise<void> {
    if (this.busy) return;
    if (this.session && Object.keys(this.session.reviews).length) {
      const choice = await vscode.window.showWarningMessage(
        "A new comparison replaces this workspace's saved review session. Result files stay on disk.",
        "Start new comparison"
      );
      if (!choice) return;
    }
    const workflow = await vscode.window.showQuickPick(
      ["Update a mod for a new game version", "Compare two sources into a separate result"],
      { title: "Compatch workflow" }
    );
    if (!workflow) return;
    const update = workflow === "Update a mod for a new game version";
    const A = await this.folder(update ? "Mod: the Git-tracked mod you want to update" : "Source A", "mod");
    if (!A) return;
    const B = await this.folder(update ? "New Game Version: updated game data" : "Source B", "game");
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
        ? await this.folder("Vanilla: the previous game version your mod was built against", "game")
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
    await this.refresh(session);
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
    try {
      candidate.protectedRoots = this.getCfg().gamePath ? [this.getCfg().gamePath!] : [];
      await validateRoots(candidate);
      let lastReport = 0;
      const inventory = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
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
      this.pages = { event: 0, localization: 0, file: 0 };
      this.session = candidate;
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
      this.view.message =
        candidate.mode === "game-update"
          ? "Select a changed file: New Game Version on the left, your editable Mod on the right. Use row actions for Vanilla changes or a merge preview. Folder rows browse all scanned files."
          : `A: ${path.basename(candidate.roots.A!)} | B: ${path.basename(candidate.roots.B!)} | Result: ${path.basename(candidate.output)}. Saved files; Refresh after source edits.`;
      this.changed();
      if (inventory.issues.length) {
        const choice = await vscode.window.showWarningMessage(
          `Compatch scan has ${inventory.issues.length} notes. Some files may be incomplete or skipped.`,
          "Show scan notes"
        );
        if (choice) this.log.show(true);
      }
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

  private async compare(entry: Entry, left: Side, right: Side): Promise<void> {
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
      `${entry.name}: ${this.sideLabel(left)} ↔ ${this.sideLabel(right)}`,
      { preview: false }
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
    await vscode.window.showTextDocument(uri, { preview: false });
  }

  private async editMod(entry: Entry, side: Side): Promise<void> {
    if (!this.session || this.busy || this.session.mode !== "game-update") return;
    const mod = await this.chooseSite(entry, "A");
    if (!mod) return;
    const source = await this.chooseSite(entry, side);
    if (!source && entry.sites[side].length) return;
    const target = vscode.Uri.file(await resultPath(this.session, mod.path));
    // Both panes show complete files. Comparing a single event fragment against
    // an entire editable mod file made unrelated events look like differences.
    const text = source ? this.inventory.files[side].get(source.path)! : "";
    const uri = await this.snapshot(text, this.sideLabel(side), source?.path ?? mod.path);
    await vscode.commands.executeCommand(
      "vscode.diff",
      uri,
      target,
      `${mod.path}: ${this.sideLabel(side)} ↔ Mod (editable)`,
      { preview: false }
    );
  }

  private async mergeMod(entry: Entry, apply: boolean): Promise<void> {
    if (!this.session || this.busy || this.session.mode !== "game-update") return;
    if (entry.kind !== "file" || Object.values(entry.sites).some((sites) => sites.length !== 1))
      throw new Error(
        "Choose a file with one version in Mod, Vanilla and New Game Version. Removed or moved definitions need manual review."
      );
    const session = this.session;
    const target = vscode.Uri.file(await resultPath(session, entry.sites.A[0].path));
    for (const side of ["base", "B"] as const) {
      const site = entry.sites[side][0];
      if ((await fs.readFile(path.join(session.roots[side]!, site.path), "utf8")) !== site.text)
        throw new Error("Source files changed. Refresh Compatch Sources before merging.");
    }
    const doc = await vscode.workspace.openTextDocument(target);
    const version = doc.version;
    const original = doc.getText();
    const merged = await mergeGameUpdate(entry.sites.base[0].text, entry.sites.B[0].text, original);
    if (doc.version !== version || doc.isClosed)
      throw new Error("The mod file changed during the merge. Try again with its current text.");
    if (!apply || merged.conflicts) {
      const uri = await this.snapshot(
        merged.text,
        merged.conflicts ? "Merge conflicts" : "Proposed update",
        entry.name
      );
      await vscode.commands.executeCommand(
        "vscode.diff",
        uri,
        target,
        `${entry.name}: ${merged.conflicts ? "Conflicts to resolve" : "Proposed update"} ↔ Mod (editable)`,
        { preview: false }
      );
      if (apply && merged.conflicts)
        void vscode.window.showInformationMessage(
          "This file has overlapping changes. Resolve them in your Mod on the right. No changes were applied."
        );
      return;
    }
    let text = merged.text;
    if (/\.(txt|yml)$/i.test(entry.name)) {
      const encoding =
        doc.encoding ??
        (original.startsWith("\uFEFF")
          ? "utf8"
          : (await fs.readFile(target.fsPath, "utf8")).startsWith("\uFEFF")
            ? "utf8bom"
            : "utf8");
      if (encoding !== "utf8" && encoding !== "utf8bom")
        throw new Error("Save the mod file as UTF-8 before merging.");
      text = (encoding === "utf8bom" ? "" : "\uFEFF") + text.replace(/^\uFEFF/, "");
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(original.length)), text);
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error("The editor rejected the mod update.");
    if (!(await doc.save())) throw new Error("The mod update could not be saved.");
    await this.refresh();
    void vscode.window.showInformationMessage(`Updated ${entry.name}. Review the changes in Source Control.`);
  }

  private async source(entry: Entry, side: Side): Promise<void> {
    const site = await this.chooseSite(entry, side);
    if (!site) return;
    const text = this.inventory.files[side].get(site.path)!;
    const uri = await this.snapshot(text, `${side}-full-file`, site.path);
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

  private async createLocalization(entry: Entry, side: Side): Promise<void> {
    const site = await this.chooseSite(entry, side);
    if (!site) return;
    const session = this.session!;
    const game = this.getCfg().gamePath;
    const support = metaFor(session.gameId).compatch;
    if (!game || !support)
      throw new Error("Set the game data path first so vanilla localization ownership can be checked.");
    const parsed = parseLoc(site.text);
    if (!parsed.language || parsed.entries.length !== 1 || parsed.errors.length)
      throw new Error("Select a valid localization entry.");
    const vanilla = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Checking vanilla localization" },
      () => hasVanillaLoc(path.join(game, support.localization), parsed.language!, parsed.entries[0].key)
    );
    const seed = localizationSeed(site.text, support.localization, vanilla);
    if (!vanilla) {
      const target = await locTargetFile(
        { ...this.getCfg(), modPath: session.output, locLanguage: parsed.language },
        async () => [],
        parsed.entries[0].key
      );
      seed.relative = path.relative(session.output, target!);
    }
    try {
      await createResult(session, seed.relative, seed.text);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    session.results[entry.id] = seed.relative;
    await this.persist();
    await this.editResult(entry, side);
  }

  private async create(entry: Entry, side: Side): Promise<void> {
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
          label: "Vanilla ↔ New Game Version",
          description: "What changed in the game",
          run: () => this.compare(entry, "base", "B"),
        },
        {
          label: "Vanilla ↔ Mod (editable)",
          description: "What your mod changed",
          run: () => this.editMod(entry, "base"),
        },
      ];
      if (entry.kind === "file")
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
      choices.push({
        label: "Mark reviewed",
        description: "Record the saved mod and game versions after your manual edits",
        run: async () => {
          await this.refresh();
          const current = this.inventory.entries.get(entry.id);
          if (!current) return;
          this.session!.reviews[entry.id] = {
            status: "reviewed",
            fingerprint: fingerprint(current),
            sites: structuredClone(current.sites),
          };
          await this.persist();
          this.changed();
        },
      });
      if (this.session.reviews[entry.id])
        choices.push({
          label: "Reopen review",
          description: "Return this entry to the work list status",
          run: async () => {
            delete this.session!.reviews[entry.id];
            await this.persist();
            this.changed();
          },
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
        label: "Compare A ↔ B",
        description: "Read-only snapshots; an absent side is empty",
        run: () => this.compare(entry, "A", "B"),
      },
    ];
    for (const side of ["A", "B"] as const) {
      if (this.session.roots.base)
        choices.push({ label: `Compare base ↔ ${side}`, run: () => this.compare(entry, "base", side) });
      if (entry.sites[side].length) {
        choices.push({
          label: `Open full ${side} file`,
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
            label: `Create result from full ${side} file`,
            description:
              "Keeps the source path and every definition; opens existing results without overwriting",
            run: () => this.create(entry, side),
          });
        if (entry.kind === "localization")
          choices.push({
            label: `Create localization result from ${side}`,
            description: "Checks vanilla ownership; opens existing result files without overwriting",
            run: () => this.createLocalization(entry, side),
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
        run: async () => {
          this.session!.reviews[entry.id] = {
            status: state,
            fingerprint: fingerprint(entry),
            sites: structuredClone(entry.sites),
          };
          await this.persist();
          this.changed();
        },
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
        run: async () => {
          delete this.session!.reviews[entry.id];
          await this.persist();
          this.changed();
        },
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
