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
import { saveFlagToMod } from "../flagBuilder/save";
import type { FlagDatabase, FlagTarget, TextureKind } from "../flagBuilder/messages";
import { coaDesignerHtml } from "./html";
import { THUMB_DIM, type AppToHost, type DesignerUiState, type HostToApp } from "./messages";

const UI_KEY = "px.coaDesigner.ui";

export interface CoaDesignerOptions {
  meta: GameMeta;
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
    this.post({ type: "opened", entry: picked.entry, flag: definition });
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

  private async onMessage(message: AppToHost): Promise<void> {
    switch (message.type) {
      case "ready":
        this.postInit();
        return;
      case "textures": {
        const urls: Record<string, string | null> = {};
        for (const key of message.keys) {
          const abs = this.resolveKey(key);
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
      case "save": {
        // The app only offers paths the host listed, but the message is still text from a webview.
        if (!this.options.mods.some((m) => m.path === message.modPath)) return;
        const file = await saveFlagToMod({
          name: message.name,
          script: message.script,
          modPath: message.modPath,
          stageRoot: this.options.meta.stageRoots?.[0],
          sourceFile: message.sourceFile,
        });
        if (file) this.post({ type: "toast", message: `Saved ${message.name} to ${file}.` });
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
        this.post({ type: "pasted", flag: flags[0] });
        return;
      }
      case "open":
        await this.openExisting();
        return;
      case "exportPng":
        await this.exportPng(message.name, message.dataUrl);
        return;
    }
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

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
