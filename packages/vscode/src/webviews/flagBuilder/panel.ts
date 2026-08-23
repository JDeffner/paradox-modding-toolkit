/**
 * The Flag Builder's VS Code host (px.openFlagBuilder).
 *
 * It does what the app cannot: read the game and mod folders into a
 * FlagDatabase, decode textures to PNG (through the GUI editor's bounded
 * cache, which now reads .tga too) and hand them over as webview URLs, put
 * script on the clipboard, write a flag into the mod's coat_of_arms folder,
 * and save an exported PNG. Rendering and editing live in app/.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { parseCoaFile, upsertFlagInFile } from "@px-lsp/server/coa/coaParse";
import { GuiTextureCache } from "../guiEditor/textureCache";
import { buildFlagDatabase, locateTexture, type FlagRoot } from "./database";
import { flagBuilderHtml } from "./html";
import { THUMB_DIM, type AppToHost, type HostToApp, type TextureKind, type UiState } from "./messages";

const BOM = "﻿";
const UI_KEY = "px.flagBuilder.ui";

export interface FlagBuilderOptions {
  meta: GameMeta;
  /** Game first, then mods in load order. */
  roots: FlagRoot[];
  /** Mods the flag can be saved into (the workspace's own), first = default. */
  mods: { label: string; path: string }[];
  gameMissing: boolean;
}

export class FlagBuilderPanel {
  private static instance: FlagBuilderPanel | undefined;
  private static readonly viewType = "px.flagBuilder";

  private readonly panel: vscode.WebviewPanel;
  private readonly textures: GuiTextureCache;
  private readonly state: vscode.Memento;
  private options: FlagBuilderOptions;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;

  private constructor(context: vscode.ExtensionContext, options: FlagBuilderOptions) {
    this.options = options;
    this.state = context.workspaceState;
    this.textures = new GuiTextureCache(context.globalStorageUri.fsPath, { gamePath: null, modPath: null });
    fs.mkdirSync(this.textures.cacheDir, { recursive: true });

    this.panel = vscode.window.createWebviewPanel(
      FlagBuilderPanel.viewType,
      "Flag Builder",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
          vscode.Uri.file(this.textures.cacheDir),
        ],
      }
    );
    this.panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, "media", "gui-editor-light.svg"),
      dark: vscode.Uri.joinPath(context.extensionUri, "media", "gui-editor-dark.svg"),
    };
    const nonce = makeNonce();
    this.panel.webview.html = flagBuilderHtml({
      scriptSrc: this.panel.webview
        .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "flagBuilder.js"))
        .toString(),
      nonce,
      csp: [
        `default-src 'none'`,
        `img-src ${this.panel.webview.cspSource} data:`,
        `style-src 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`,
      ].join("; "),
    });
    this.panel.webview.onDidReceiveMessage(
      (message: AppToHost) => void this.onMessage(message),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  static show(context: vscode.ExtensionContext, options: FlagBuilderOptions): void {
    const existing = FlagBuilderPanel.instance;
    if (existing) {
      existing.options = options;
      existing.panel.reveal();
      existing.postInit();
      return;
    }
    FlagBuilderPanel.instance = new FlagBuilderPanel(context, options);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    FlagBuilderPanel.instance = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
    this.panel.dispose();
  }

  private post(message: HostToApp): void {
    if (!this.disposed) void this.panel.webview.postMessage(message);
  }

  private postInit(): void {
    const { meta, roots, gameMissing, mods } = this.options;
    const db = buildFlagDatabase(meta.name, roots, meta.stageRoots, gameMissing);
    this.post({ type: "init", db, mods, ui: this.state.get<UiState>(UI_KEY) });
  }

  private async onMessage(message: AppToHost): Promise<void> {
    switch (message.type) {
      case "ready":
        this.postInit();
        return;
      case "textures": {
        const urls: Record<string, string | null> = {};
        for (const key of message.keys) {
          const slash = key.indexOf("/");
          const kind = key.slice(0, slash) as TextureKind;
          const abs = locateTexture(
            this.options.roots,
            this.options.meta.stageRoots,
            kind,
            key.slice(slash + 1)
          );
          const png = abs ? this.textures.resolveFile(abs, message.thumbs ? THUMB_DIM : 0) : null;
          urls[key] = png ? this.panel.webview.asWebviewUri(vscode.Uri.file(png)).toString() : null;
        }
        this.post({ type: "textures", urls, thumbs: message.thumbs });
        return;
      }
      case "uiState":
        await this.state.update(UI_KEY, message.state);
        return;
      case "copy":
        await vscode.env.clipboard.writeText(message.text);
        this.post({ type: "toast", message: "Script copied to the clipboard." });
        return;
      case "save":
        await this.save(message.name, message.script, message.modPath);
        return;
      case "readClipboard":
        this.post({ type: "clipboard", text: await vscode.env.clipboard.readText() });
        return;
      case "paste": {
        const text = await vscode.env.clipboard.readText();
        const flags = text.trim() ? parseCoaFile(text) : [];
        if (!flags.length) {
          this.post({
            type: "toast",
            message: "The clipboard holds no flag definition (NAME = { pattern = … }).",
          });
          return;
        }
        this.post({ type: "pasted", flag: flags[0] });
        return;
      }
      case "exportPng":
        await this.exportPng(message.name, message.dataUrl);
        return;
    }
  }

  /**
   * Write the flag into a coa file of the mod: an existing file of the folder
   * (replacing the flag of that name if present) or a new one. The file keeps
   * its BOM; a new one gets one, like every script file the games read.
   */
  private async save(name: string, script: string, modPath: string): Promise<void> {
    const { meta } = this.options;
    // The app only offers paths the host listed, but the message is still text from a webview.
    if (!this.options.mods.some((m) => m.path === modPath)) return;
    const dir = path.join(modPath, meta.stageRoots?.[0] ?? "", "common", "coat_of_arms", "coat_of_arms");
    let files: string[] = [];
    try {
      files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".txt"))
        .sort();
    } catch {
      /* folder does not exist yet */
    }
    const NEW = "$(new-file) New file…";
    const pick = await vscode.window.showQuickPick([...files, NEW], {
      placeHolder: `Save ${name} into ${path.relative(modPath, dir)}/…`,
    });
    if (!pick) return;
    let file = pick;
    if (pick === NEW) {
      const typed = await vscode.window.showInputBox({
        prompt: "File name",
        value: `${name.toLowerCase()}_coa.txt`,
        validateInput: (v) => (/^[\w.-]+\.txt$/.test(v) ? null : "A .txt file name without folders"),
      });
      if (!typed) return;
      file = typed;
    }
    const abs = path.join(dir, file);
    let text = "";
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      /* new file */
    }
    const hadBom = text.startsWith(BOM);
    const body = upsertFlagInFile(hadBom ? text.slice(1) : text, name, script);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(abs, BOM + body, "utf8");
    const doc = await vscode.workspace.openTextDocument(abs);
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    this.post({ type: "toast", message: `Saved ${name} to ${file}.` });
  }

  private async exportPng(name: string, dataUrl: string): Promise<void> {
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(this.options.mods[0]?.path ?? "", `${name || "flag"}.png`)),
      filters: { PNG: ["png"] },
    });
    if (!target) return;
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    await vscode.workspace.fs.writeFile(target, Buffer.from(base64, "base64"));
    this.post({ type: "toast", message: `Exported ${path.basename(target.fsPath)}.` });
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
