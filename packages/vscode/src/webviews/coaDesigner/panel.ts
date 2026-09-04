/**
 * The Coat of Arms Designer's VS Code host (px.openCoaDesigner).
 *
 * Same job as the Flag Builder's host, plus the designer catalog: it reads the
 * game and mod folders into a FlagDatabase WITH the `designer` section (the
 * files that drive the game's own designer), decodes textures through the GUI
 * editor's bounded cache, and resolves the preview frames, which live outside
 * `gfx/coat_of_arms` and so get their own key prefixes. The definition it
 * writes is a plain coat of arms: a frame is preview decoration, never script.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { tabIcon } from "../tabIcons";
import { bundleUri, watchBundle, webviewSource } from "../devReload";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { parseCoaFile } from "@px-lsp/server/coa/coaParse";
import { GuiTextureCache } from "../guiEditor/textureCache";
import {
  buildFlagDatabase,
  locateDesignerFrame,
  locateTexture,
  type FlagRoot,
} from "../flagBuilder/database";
import { writeFlagFile } from "../flagBuilder/save";
import type { FlagDatabase, FlagTarget, TextureKind } from "../flagBuilder/messages";
import { coaLibraryDir, type PxConfig } from "../../config";
import { scaffoldPrefix } from "../../scaffold/command";
import { defaultTargetFileName, isPlainScriptFileName, vanillaNameClash } from "../../creators/saveTargets";
import { libraryFileName, libraryHas, readLibrary, writeLibraryFile } from "./library";
import { coaDesignerHtml } from "./html";
import { THUMB_DIM, type AppToHost, type DesignerUiState, type HostToApp } from "./messages";

const UI_KEY = "px.coaDesigner.ui";

/**
 * Textures answered per message. The host no longer decodes them itself
 * (GuiTextureCache.resolveFileAsync runs a worker), so the only reason to
 * chunk is that the first tiles must appear while the rest are still being
 * read: small enough to show up fast, big enough that a full emblem category
 * is not 300 postMessages.
 */
const TEXTURE_CHUNK = 8;

/** Where a coat of arms lives, relative to a mod root (stage folder aside). */
const COA_FOLDER = "common/coat_of_arms/coat_of_arms";

export interface CoaDesignerOptions {
  meta: GameMeta;
  /** Paths and prefixes the save target is resolved from; no setting of our own. */
  cfg: PxConfig;
  /** Game first, then mods in load order. */
  roots: FlagRoot[];
  /** Mods the arms can be saved into (the workspace's own), first = default. */
  mods: { label: string; path: string }[];
  gameMissing: boolean;
  /** What the arms are for. Absent = the panel opens on the blank template. */
  target?: FlagTarget;
}

export class CoaDesignerPanel {
  private static instance: CoaDesignerPanel | undefined;
  private static readonly viewType = "px.coaDesigner";

  private readonly panel: vscode.WebviewPanel;
  private readonly textures: GuiTextureCache;
  private readonly state: vscode.Memento;
  private options: CoaDesignerOptions;
  /** The last database posted down, so a host-side picker can read it back. */
  private db: FlagDatabase | undefined;
  /** The file the modder picked for the next save; null = the default rule. */
  private chosenFile: string | null = null;
  /** The coa file the open design came from, offered as the default target. */
  private openedFile: string | undefined;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;

  private constructor(context: vscode.ExtensionContext, options: CoaDesignerOptions) {
    this.options = options;
    this.state = context.workspaceState;
    this.textures = new GuiTextureCache(context.globalStorageUri.fsPath, { gamePath: null, modPath: null });
    fs.mkdirSync(this.textures.cacheDir, { recursive: true });

    const source = webviewSource(context);
    this.panel = vscode.window.createWebviewPanel(
      CoaDesignerPanel.viewType,
      "Coat of Arms",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [source.root, vscode.Uri.file(this.textures.cacheDir)],
      }
    );
    this.panel.iconPath = tabIcon("coa-designer");
    const render = (): void => {
      const nonce = makeNonce();
      this.panel.webview.html = coaDesignerHtml({
        scriptSrc: bundleUri(this.panel.webview, source, "coaDesigner"),
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
    this.disposables.push(watchBundle(source, "coaDesigner", render));
    this.panel.webview.onDidReceiveMessage(
      (message: AppToHost) => void this.onMessage(message),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  static show(context: vscode.ExtensionContext, options: CoaDesignerOptions): void {
    const existing = CoaDesignerPanel.instance;
    if (existing) {
      existing.options = options;
      existing.panel.reveal();
      existing.postInit();
      return;
    }
    CoaDesignerPanel.instance = new CoaDesignerPanel(context, options);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    CoaDesignerPanel.instance = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
    this.panel.dispose();
  }

  private post(message: HostToApp): void {
    if (!this.disposed) void this.panel.webview.postMessage(message);
  }

  private postInit(): void {
    const { meta, roots, gameMissing, mods, target } = this.options;
    this.db = buildFlagDatabase(meta.name, roots, meta.stageRoots, gameMissing, true);
    this.post({ type: "init", db: this.db, mods, ui: this.state.get<DesignerUiState>(UI_KEY), target });
    this.postTarget();
  }

  // -- where it saves ------------------------------------------------------

  /** The kind's folder, carrying a game's load-stage prefix where it has one. */
  private folder(): string {
    const stage = this.options.meta.stageRoots?.[0];
    return stage ? `${stage}/${COA_FOLDER}` : COA_FOLDER;
  }

  /** The mod the app's own picker is on, else the first one offered. */
  private saveMod(): { label: string; path: string } | undefined {
    const savePath = this.state.get<DesignerUiState>(UI_KEY)?.savePath;
    return this.options.mods.find((m) => m.path === savePath) ?? this.options.mods[0];
  }

  /**
   * Where the next save goes: what the modder picked, else the file an opened
   * design came from, else the mod of record's `<prefix>_coat_of_arms.txt`.
   */
  private targetChoice(): { modPath: string; modLabel: string; file: string } | null {
    const mod = this.saveMod();
    if (!mod) return null;
    const file =
      this.chosenFile ??
      defaultTargetFileName({
        ...(this.openedFile ? { sourceFile: this.openedFile } : {}),
        prefix: scaffoldPrefix(this.options.cfg),
        kind: "coat_of_arms",
      });
    return { modPath: mod.path, modLabel: mod.label, file };
  }

  /** Tell the app where it saves, so its top bar can say so. */
  private postTarget(): void {
    const choice = this.targetChoice();
    this.post({
      type: "target",
      target: choice ? { modLabel: choice.modLabel, path: `${this.folder()}/${choice.file}` } : null,
    });
  }

  /**
   * The target line was clicked: which file of the chosen mod's coa folder.
   * The mod itself stays the toolbar picker's answer, so the two controls
   * cannot disagree.
   */
  private async changeTarget(): Promise<void> {
    const mod = this.saveMod();
    if (!mod) return;
    const { cfg } = this.options;
    const dir = path.join(mod.path, ...this.folder().split("/"));
    const gameFiles = cfg.gamePath ? listTxt(path.join(cfg.gamePath, ...this.folder().split("/"))) : [];
    const existing = listTxt(dir);
    const NEW = "$(new-file) New file…";
    const picked = await vscode.window.showQuickPick(
      [
        ...existing.map((f) => ({
          label: f,
          description: f === this.openedFile ? "the file this design came from" : "",
        })),
        { label: NEW, description: "" },
      ],
      { placeHolder: `Save into ${this.folder()}/…` }
    );
    if (!picked) return;
    let file = picked.label;
    if (file === NEW) {
      const typed = await vscode.window.showInputBox({
        prompt: `File name in ${this.folder()}`,
        value: this.targetChoice()?.file,
        validateInput: (v) => {
          const name = v.trim();
          if (!isPlainScriptFileName(name)) return "A .txt file name without folders";
          return vanillaNameClash(name, gameFiles, this.folder());
        },
      });
      if (!typed) return;
      file = typed.trim();
    }
    this.chosenFile = file;
    this.postTarget();
  }

  /** "Adjust Existing Design": every definition the game and the mods ship. */
  private async openExisting(): Promise<void> {
    const db = this.db;
    if (!db) return;
    const picked = await vscode.window.showQuickPick(
      db.flags.map((entry) => ({
        label: entry.name,
        description: entry.source,
        detail: entry.file,
        entry,
      })),
      { placeHolder: "Adjust an existing coat of arms", matchOnDescription: true }
    );
    const definition = picked && db.definitions[picked.entry.name];
    if (!picked || !definition) return;
    // The design that was opened decides where a save goes, so a target the
    // modder picked for the previous one does not carry over.
    this.openedFile = picked.entry.file;
    this.chosenFile = null;
    this.post({ type: "opened", entry: picked.entry, flag: definition });
    this.postTarget();
  }

  /** `frames/<id>` and `masks/<id>` come from the frames folder, everything else from gfx/coat_of_arms. */
  private resolveKey(key: string): string | null {
    const slash = key.indexOf("/");
    if (slash < 0) return null;
    const kind = key.slice(0, slash);
    const rest = key.slice(slash + 1);
    const { roots, meta } = this.options;
    if (kind === "frames" || kind === "masks")
      return locateDesignerFrame(roots, meta.stageRoots, rest, kind === "masks");
    return locateTexture(roots, meta.stageRoots, kind as TextureKind, rest);
  }

  /**
   * Answer a batch of texture requests WITHOUT blocking the extension host:
   * every decode runs on a worker (textureCache.resolveFileAsync) and the URLs
   * come back a chunk at a time, so the first thumbnails are on screen while
   * the rest of the batch is still being read. A whole emblem category is 283
   * textures on a stock 1.19 install, which the old synchronous loop spent
   * entirely inside the host.
   */
  private async sendTextures(keys: string[], thumbs: boolean): Promise<void> {
    const maxDim = thumbs ? THUMB_DIM : 0;
    for (let at = 0; at < keys.length; at += TEXTURE_CHUNK) {
      const chunk = keys.slice(at, at + TEXTURE_CHUNK);
      const files = await Promise.all(
        chunk.map(async (key) => {
          const abs = this.resolveKey(key);
          return abs ? this.textures.resolveFileAsync(abs, maxDim) : null;
        })
      );
      if (this.disposed) return;
      const urls: Record<string, string | null> = {};
      chunk.forEach((key, i) => {
        const png = files[i];
        urls[key] = png ? this.panel.webview.asWebviewUri(vscode.Uri.file(png)).toString() : null;
      });
      this.post({ type: "textures", urls, thumbs });
    }
  }

  private async onMessage(message: AppToHost): Promise<void> {
    switch (message.type) {
      case "ready":
        this.postInit();
        return;
      case "textures":
        await this.sendTextures(message.keys, message.thumbs);
        return;
      case "uiState":
        await this.state.update(UI_KEY, message.state);
        // The mod picker is part of where a save goes, so the line follows it.
        this.postTarget();
        return;
      case "changeTarget":
        await this.changeTarget();
        return;
      case "copy":
        await vscode.env.clipboard.writeText(message.text);
        this.post({ type: "toast", message: "Script copied to the clipboard." });
        return;
      case "save": {
        // The app only offers paths the host listed, but the message is still text from a webview.
        if (!this.options.mods.some((m) => m.path === message.modPath)) return;
        // No question here: the target has been in the top bar since the panel opened.
        const choice = this.targetChoice();
        if (!choice) {
          this.post({ type: "toast", message: "No mod folder to save into." });
          return;
        }
        const file = await writeFlagFile({
          name: message.name,
          script: message.script,
          modPath: choice.modPath,
          stageRoot: this.options.meta.stageRoots?.[0],
          file: choice.file,
        });
        this.post(
          file
            ? { type: "toast", message: `Saved ${message.name} to ${file}.` }
            : { type: "toast", message: `Could not write ${choice.file}. Pick another file.` }
        );
        return;
      }
      case "paste": {
        const text = await vscode.env.clipboard.readText();
        const flags = text.trim() ? parseCoaFile(text) : [];
        if (!flags.length) {
          this.post({
            type: "toast",
            message: "The clipboard holds no coat of arms (NAME = { pattern = … }).",
          });
          return;
        }
        this.openedFile = undefined;
        this.chosenFile = null;
        this.post({ type: "pasted", flag: flags[0] });
        this.postTarget();
        return;
      }
      case "open":
        await this.openExisting();
        return;
      case "libraryList": {
        const dir = coaLibraryDir(this.options.meta);
        this.post({ type: "library", dir: dir ?? "", items: dir ? readLibrary(dir) : [] });
        return;
      }
      case "libraryExport":
        await this.exportToLibrary(message.name, message.script);
        return;
      case "libraryDir": {
        const current = coaLibraryDir(this.options.meta);
        const picked = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          ...(current && fs.existsSync(current) ? { defaultUri: vscode.Uri.file(current) } : {}),
          title: "Coat of arms library folder",
          openLabel: "Use this folder",
        });
        const dir = picked?.[0]?.fsPath;
        if (!dir) return;
        // Machine scoped, like the setting itself: the library is a folder on
        // this computer, not a fact about the workspace.
        await vscode.workspace
          .getConfiguration("px")
          .update("coaLibraryDir", dir, vscode.ConfigurationTarget.Global);
        this.post({ type: "toast", message: `Library folder: ${dir}` });
        return;
      }
      case "exportPng":
        await this.exportPng(message.name, message.dataUrl);
        return;
    }
  }

  /**
   * Store the design in the library folder, creating it on the way. Replacing
   * a file that is already there is asked with a notification and a button
   * rather than a modal: the panel stays usable while the question stands.
   */
  private async exportToLibrary(name: string, script: string): Promise<void> {
    const dir = coaLibraryDir(this.options.meta);
    if (!dir) {
      this.post({ type: "toast", message: "No library folder. Set px.coaLibraryDir." });
      return;
    }
    const file = libraryFileName(name);
    if (libraryHas(dir, name)) {
      const OVERWRITE = "Overwrite";
      const answer = await vscode.window.showWarningMessage(`${file} is already in ${dir}.`, OVERWRITE);
      if (answer !== OVERWRITE) return;
    }
    try {
      writeLibraryFile(dir, name, script);
    } catch (e) {
      this.post({ type: "toast", message: `Could not write ${file}: ${(e as Error).message}` });
      return;
    }
    this.post({ type: "toast", message: `Exported ${file} to the library.` });
  }

  private async exportPng(name: string, dataUrl: string): Promise<void> {
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(this.options.mods[0]?.path ?? "", `${name || "coa"}.png`)),
      filters: { PNG: ["png"] },
    });
    if (!target) return;
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    await vscode.workspace.fs.writeFile(target, Buffer.from(base64, "base64"));
    this.post({ type: "toast", message: `Exported ${path.basename(target.fsPath)}.` });
  }
}

/**
 * The .txt files of a folder, sorted; an unreadable folder lists nothing.
 * Only names a save could actually write, so the list and the writer's rule
 * (isPlainScriptFileName) cannot disagree.
 */
function listTxt(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter(isPlainScriptFileName).sort();
  } catch {
    return [];
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
