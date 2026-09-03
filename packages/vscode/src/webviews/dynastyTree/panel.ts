/**
 * The Dynasty Tree panel's VS Code host (px.openDynastyTree).
 *
 * It does the three things the app cannot: ask the language server for the
 * dynasty model, turn a filled form into script and write it into the mod, and
 * open the file it wrote. Drawing, panning and every form lives in app/.
 *
 * Writing follows the Flag Builder's flow (webviews/flagBuilder/panel.ts): the
 * mod is the one from the configuration, the file is picked from the mod's own
 * folder or typed, a file name that also exists in the game's same folder is
 * refused (a same-named script file replaces the whole vanilla file), the BOM
 * is kept, and the whole change lands as ONE WorkspaceEdit so one save is one
 * undo step.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type {
  DynastyTreeParams,
  DynastyTreeResult,
  EventValueOptionsParams,
  EventValueOptionsResult,
} from "@px-lsp/protocol/protocol";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { upsertFlagInFile } from "@px-lsp/server/coa/coaParse";
import { characterBlock, dynastyBlock, houseBlock } from "./blocks";
import { dynastyTreeHtml } from "./html";
import type { AppToHost, HostToApp, ModTarget, OptionSets } from "./messages";
import { makeNonce } from "../nonce";
import { tabIcon } from "../tabIcons";
import { bundleUri, watchBundle, webviewSource } from "../devReload";

const BOM = "﻿";
/** Schema folders, one per kind this panel writes (games/ck3/schema.ts). */
const FOLDERS = {
  character: path.join("history", "characters"),
  dynasty: path.join("common", "dynasties"),
  house: path.join("common", "dynasty_houses"),
};
/**
 * The server re-indexes a written file through the client's watcher, which is
 * debounced. A panel has no readier signal, so the reload waits this long
 * before asking for the tree again; the Refresh control covers the rest.
 */
const REINDEX_GRACE_MS = 800;

export interface DynastyTreeActions {
  fetchTree(params: DynastyTreeParams): Promise<DynastyTreeResult>;
  fetchOptions(params: EventValueOptionsParams): Promise<EventValueOptionsResult | null>;
  /** writeLocSmart: the one entry point for a loc value (locCommands.ts). */
  writeLoc(key: string, value: string): Promise<string>;
}

export interface DynastyTreeOptions {
  meta: GameMeta;
  gamePath: string | null;
  /** Mods the panel may write into, `modPath` first (the default target). */
  mods: ModTarget[];
  /** Focus mod for the server request, or null for every workspace mod. */
  modRoot: string | null;
  /** File-name prefix the scaffold flow remembers, else the mod folder's name. */
  filePrefix: string;
  /** Set when the workspace is not ready to be written to (no mod, no game). */
  setupProblem?: string;
}

export class DynastyTreePanel {
  private static instance: DynastyTreePanel | undefined;
  private static readonly viewType = "px.dynastyTree";

  private readonly panel: vscode.WebviewPanel;
  private readonly actions: DynastyTreeActions;
  private options: DynastyTreeOptions;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;
  /** The mod chosen for this session once the workspace holds several. */
  private savePath: string | undefined;
  /** A deep-linked dynasty, replayed once the app has booted. */
  private pending: string | undefined;
  /** The dynasty currently drawn, so a save can reload the same tree. */
  private current: string | undefined;

  private constructor(
    context: vscode.ExtensionContext,
    actions: DynastyTreeActions,
    options: DynastyTreeOptions,
    dynasty?: string
  ) {
    this.actions = actions;
    this.options = options;
    this.pending = dynasty;
    this.savePath = options.mods[0]?.path;
    const source = webviewSource(context);
    this.panel = vscode.window.createWebviewPanel(
      DynastyTreePanel.viewType,
      "Dynasty Tree",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [source.root] }
    );
    this.panel.iconPath = tabIcon("dynasty-tree");
    const render = (): void => {
      const nonce = makeNonce();
      this.panel.webview.html = dynastyTreeHtml({
        scriptSrc: bundleUri(this.panel.webview, source, "dynastyTree"),
        nonce,
        csp: [
          `default-src 'none'`,
          `img-src ${this.panel.webview.cspSource} data:`,
          `style-src 'unsafe-inline'`,
          `script-src 'nonce-${nonce}'`,
        ].join("; "),
      });
    };
    render();
    // The rebooted app sends "ready" and gets the same answer it got the first
    // time, so a bundle reload does not lose the panel's state.
    this.disposables.push(watchBundle(source, "dynastyTree", render));
    this.panel.webview.onDidReceiveMessage(
      (msg: AppToHost) => void this.onMessage(msg),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  static show(
    context: vscode.ExtensionContext,
    actions: DynastyTreeActions,
    options: DynastyTreeOptions,
    dynasty?: string
  ): void {
    const existing = DynastyTreePanel.instance;
    if (existing) {
      existing.options = options;
      existing.panel.reveal(vscode.ViewColumn.Active);
      if (dynasty) void existing.loadTree(dynasty);
      return;
    }
    DynastyTreePanel.instance = new DynastyTreePanel(context, actions, options, dynasty);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    DynastyTreePanel.instance = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
    this.panel.dispose();
  }

  private post(msg: HostToApp): void {
    if (!this.disposed) void this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: AppToHost): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.post({
          type: "init",
          gameName: this.options.meta.name,
          mods: this.options.mods,
          setupProblem: this.options.setupProblem,
        });
        await this.loadList();
        if (this.pending) {
          const dynasty = this.pending;
          this.pending = undefined;
          await this.loadTree(dynasty);
        }
        return;
      case "list":
        await this.loadList();
        return;
      case "open":
        await this.loadTree(msg.dynasty);
        return;
      case "reveal":
        await this.openDocument(msg.file, msg.line);
        return;
      case "coa":
        await vscode.commands.executeCommand("px.openFlagBuilder", { name: msg.name });
        return;
      case "saveCharacter": {
        const block = characterBlock(msg.form, this.previousBlock(msg.file, msg.form.id));
        for (const note of block.notes) this.post({ type: "toast", message: note });
        await this.write(FOLDERS.character, "characters", msg.form.id, block.text, msg.file);
        return;
      }
      case "saveDynasty": {
        const written = await this.write(
          FOLDERS.dynasty,
          "dynasties",
          msg.form.id,
          dynastyBlock(msg.form),
          msg.file
        );
        if (written) await this.writeName(msg.form.nameKey, msg.name);
        if (written && msg.openTree) await this.loadTree(msg.form.id);
        return;
      }
      case "saveHouse": {
        const written = await this.write(
          FOLDERS.house,
          "dynasty_houses",
          msg.form.id,
          houseBlock(msg.form),
          msg.file
        );
        if (written) await this.writeName(msg.form.nameKey, msg.name);
        return;
      }
    }
  }

  // ---- server ---------------------------------------------------------------

  private async loadList(): Promise<void> {
    this.post({ type: "loading", what: "dynasties" });
    const started = Date.now();
    try {
      const result = await this.actions.fetchTree({ modRoot: this.options.modRoot });
      this.post({
        type: "list",
        supported: result.supported,
        dynasties: result.dynasties,
        nextDynastyId: result.nextDynastyId ?? "1",
        nextCharacterId: result.nextCharacterId ?? "1",
        ms: Date.now() - started,
      });
      if (!result.supported) return;
      await this.loadOptions([...result.dynasties.slice(0, 200)].find((d) => d.culture)?.culture);
    } catch (err) {
      this.post({ type: "error", message: message(err) });
    }
  }

  private async loadTree(dynasty: string): Promise<void> {
    this.post({ type: "loading", what: "the tree" });
    const started = Date.now();
    try {
      const result = await this.actions.fetchTree({ modRoot: this.options.modRoot, dynasty });
      if (!result.dynasty) {
        this.post({ type: "error", message: `No dynasty ${dynasty} in this workspace.` });
        return;
      }
      this.current = dynasty;
      this.post({
        type: "tree",
        tree: {
          dynasty: result.dynasty,
          houses: result.houses ?? [],
          characters: result.characters ?? [],
          nextCharacterId: result.nextCharacterId ?? "1",
        },
        ms: Date.now() - started,
      });
      const chars = result.characters ?? [];
      await this.loadOptions(
        result.dynasty.culture ?? chars.find((c) => c.culture)?.culture,
        chars.find((c) => c.religion)?.religion,
        chars.find((c) => c.traits.length > 0)?.traits[0]
      );
    } catch (err) {
      this.post({ type: "error", message: message(err) });
    }
  }

  /**
   * The picker value sets. `paradox/eventValueOptions` answers the set a VALUE
   * belongs to, so each field is seeded with a value the tree already carries;
   * a field with no seed keeps a plain text input rather than a wrong list.
   */
  private async loadOptions(culture?: string, religion?: string, trait?: string): Promise<void> {
    const sets: OptionSets = { culture: [], religion: [], trait: [] };
    const seeds: Array<[keyof OptionSets, string | undefined]> = [
      ["culture", culture],
      ["religion", religion],
      ["trait", trait],
    ];
    for (const [field, seed] of seeds) {
      if (!seed) continue;
      try {
        const result = await this.actions.fetchOptions({ value: seed, modRoot: this.options.modRoot });
        if (result) sets[field] = result.items;
      } catch {
        /* a field without options is a plain input, not an error */
      }
    }
    this.post({ type: "options", sets });
  }

  // ---- writing --------------------------------------------------------------

  /** The exact source of the block being edited, for a faithful round trip. */
  private previousBlock(file: string | undefined, name: string): string | undefined {
    if (!file) return undefined;
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return undefined;
    }
    // The block runs from its key to the matching close brace; the writer only
    // needs the text, and the tolerant parser inside blocks.ts does the rest.
    const start = new RegExp(`^${escapeRegExp(name)}[ \\t]*=[ \\t]*\\{`, "m").exec(text);
    if (!start) return undefined;
    let depth = 0;
    for (let i = start.index; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return text.slice(start.index, i + 1);
      }
    }
    return undefined;
  }

  private modPath(): string | undefined {
    if (this.savePath && this.options.mods.some((m) => m.path === this.savePath)) return this.savePath;
    return this.options.mods[0]?.path;
  }

  private async pickMod(): Promise<string | undefined> {
    const mods = this.options.mods;
    if (mods.length <= 1) return this.modPath();
    const picked = await vscode.window.showQuickPick(
      mods.map((m) => ({ label: m.label, description: m.path })),
      { placeHolder: "Which mod does this belong to?" }
    );
    if (!picked) return undefined;
    this.savePath = picked.description;
    return picked.description;
  }

  /**
   * Write one block into a `.txt` of the mod's `folder`. Returns true when
   * something was written.
   */
  private async write(
    folder: string,
    what: string,
    name: string,
    script: string,
    previousFile?: string
  ): Promise<boolean> {
    const modPath = await this.pickMod();
    if (!modPath) {
      this.post({
        type: "toast",
        message:
          "No mod folder found. Open your mod folder (the one with the mod's descriptor) as a workspace folder.",
        variant: "destructive",
      });
      return false;
    }
    const dir = path.join(modPath, this.options.meta.stageRoots?.[0] ?? "", folder);
    let abs: string | undefined;
    // A block that already lives in this mod is rewritten where it is.
    if (previousFile && isInside(modPath, previousFile)) abs = previousFile;
    if (!abs) {
      const file = await this.askFile(dir, folder, `${this.options.filePrefix}_${what}.txt`);
      if (!file) return false;
      abs = path.join(dir, file);
    }
    let text = "";
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      /* new file */
    }
    const existed = text !== "";
    const hadBom = text.startsWith(BOM);
    const body = upsertFlagInFile(hadBom ? text.slice(1) : text, name, script);
    const uri = vscode.Uri.file(abs);
    const edit = new vscode.WorkspaceEdit();
    if (!existed) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      // Script files the games read are UTF-8 WITH BOM; a new one gets one.
      edit.createFile(uri, { overwrite: false, ignoreIfExists: true });
      edit.insert(uri, new vscode.Position(0, 0), BOM + body);
    } else {
      const doc = await vscode.workspace.openTextDocument(uri);
      const whole = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
      edit.replace(uri, whole, (hadBom ? BOM : "") + body);
    }
    if (!(await vscode.workspace.applyEdit(edit))) {
      this.post({ type: "toast", message: `Could not write ${path.basename(abs)}.`, variant: "destructive" });
      return false;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    await doc.save();
    await this.openDocument(abs, 0);
    this.post({ type: "toast", message: `Saved ${name} to ${path.basename(abs)}.` });
    // The written file reaches the index through the client's watcher.
    setTimeout(() => {
      if (this.current) void this.loadTree(this.current);
      else void this.loadList();
    }, REINDEX_GRACE_MS);
    return true;
  }

  /**
   * An existing `.txt` of the folder, or a typed new one. A name the GAME also
   * uses in the same folder is refused: a same-named script file replaces the
   * whole vanilla file instead of adding to it.
   */
  private async askFile(dir: string, folder: string, suggestion: string): Promise<string | undefined> {
    let files: string[] = [];
    try {
      files = fs
        .readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith(".txt"))
        .sort();
    } catch {
      /* the folder does not exist yet */
    }
    const NEW = "$(new-file) New file…";
    const picked = await vscode.window.showQuickPick([...files.map((f) => ({ label: f })), { label: NEW }], {
      placeHolder: `Save into ${folder}/…`,
    });
    if (!picked) return undefined;
    if (picked.label !== NEW) return picked.label;
    const gameDir = this.options.gamePath ? path.join(this.options.gamePath, folder) : null;
    const typed = await vscode.window.showInputBox({
      prompt: `File name in ${folder}`,
      value: suggestion,
      validateInput: (v) => {
        const name = v.trim();
        if (!/^[\w.-]+\.txt$/.test(name)) return "A .txt file name without folders";
        if (gameDir && fs.existsSync(path.join(gameDir, name)))
          return `The game has a ${name} in this folder. A file of the same name replaces the whole vanilla file, so pick another name.`;
        return null;
      },
    });
    return typed?.trim() || undefined;
  }

  /** The display name of a dynasty or house: a loc key, written through writeLocSmart. */
  private async writeName(key: string, value: string): Promise<void> {
    if (!key || !value) return;
    try {
      const file = await this.actions.writeLoc(key, value);
      this.post({ type: "toast", message: `Wrote ${key} to ${path.basename(file)}.` });
    } catch (err) {
      this.post({
        type: "toast",
        message: `Could not write ${key}: ${message(err)}`,
        variant: "destructive",
      });
    }
  }

  private async openDocument(file: string, line: number): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const zero = Math.min(Math.max(0, line), Math.max(0, doc.lineCount - 1));
      const position = new vscode.Position(zero, 0);
      const textGroup = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.scheme === "file"
      )?.viewColumn;
      await vscode.window.showTextDocument(doc, {
        viewColumn: textGroup ?? vscode.ViewColumn.Beside,
        preserveFocus: true,
        selection: new vscode.Range(position, position),
      });
    } catch (err) {
      void vscode.window.showErrorMessage(`Dynasty Tree: cannot open ${file}: ${message(err)}`);
    }
  }
}

function isInside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
