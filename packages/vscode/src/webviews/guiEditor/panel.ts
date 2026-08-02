/**
 * The GUI editor's VS Code host (px.openGuiEditor).
 *
 * It implements messages.ts and does nothing the contract does not name: fetch
 * layout from the server, resolve textures to webview URLs, push the result
 * down. The document is the source of truth and stays the editor's — the host
 * re-requests layout on every change (debounced) and on save, so the canvas
 * follows typing, formatters and reverts alike.
 *
 * The webview loads dist/webview/guiEditor.js under the house nonce CSP: the
 * app is a real bundle, not a serialized function, because an editor does not
 * fit in a template literal.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { GuiLayoutResult } from "@px-lsp/protocol/protocol";
import { LAYOUT_DEBOUNCE_MS, type AppToHost, type HostToApp } from "./messages";
import { GuiTextureCache, type TextureRoots } from "./textureCache";

export type FetchLayout = (uri: vscode.Uri, text: string) => Promise<GuiLayoutResult>;

export class GuiEditorPanel {
  private static instance: GuiEditorPanel | undefined;
  private static readonly viewType = "px.guiEditor";

  private readonly panel: vscode.WebviewPanel;
  private readonly fetchLayout: FetchLayout;
  private readonly storageDir: string;
  private textures: GuiTextureCache;
  private disposables: vscode.Disposable[] = [];
  private sourceUri: vscode.Uri;
  private disposed = false;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  private constructor(
    context: vscode.ExtensionContext,
    fetchLayout: FetchLayout,
    source: vscode.TextDocument,
    roots: TextureRoots
  ) {
    this.fetchLayout = fetchLayout;
    this.sourceUri = source.uri;
    this.storageDir = context.globalStorageUri.fsPath;
    this.textures = new GuiTextureCache(this.storageDir, roots);
    fs.mkdirSync(this.textures.cacheDir, { recursive: true });

    this.panel = vscode.window.createWebviewPanel(
      GuiEditorPanel.viewType,
      "GUI Editor",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // Exactly two: the app bundle and the decoded textures.
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
          vscode.Uri.file(this.textures.cacheDir),
        ],
      }
    );
    this.panel.webview.html = buildHtml(
      this.panel.webview,
      vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "guiEditor.js"),
      loadGameFont(roots.gamePath)
    );

    this.panel.webview.onDidReceiveMessage(
      (message: AppToHost) => void this.onMessage(message),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    vscode.workspace.onDidChangeTextDocument(
      (ev) => {
        if (ev.document.uri.toString() !== this.sourceUri.toString()) return;
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => void this.load(ev.document), LAYOUT_DEBOUNCE_MS);
      },
      undefined,
      this.disposables
    );
    vscode.workspace.onDidSaveTextDocument(
      (doc) => {
        if (doc.uri.toString() === this.sourceUri.toString()) void this.load(doc);
      },
      undefined,
      this.disposables
    );
  }

  static show(
    context: vscode.ExtensionContext,
    fetchLayout: FetchLayout,
    source: vscode.TextDocument,
    roots: TextureRoots
  ): void {
    const existing = GuiEditorPanel.instance;
    if (existing) {
      // A .gui from another mod resolves its textures against THAT mod, so the
      // cache follows the document; and a debounce still pending for the old
      // one must not push its layout under the new title.
      if (existing.debounce) clearTimeout(existing.debounce);
      existing.debounce = undefined;
      existing.sourceUri = source.uri;
      existing.textures = new GuiTextureCache(existing.storageDir, roots);
      existing.panel.reveal(undefined, true);
      void existing.load(source);
      return;
    }
    GuiEditorPanel.instance = new GuiEditorPanel(context, fetchLayout, source, roots);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    GuiEditorPanel.instance = undefined;
    if (this.debounce) clearTimeout(this.debounce);
    for (const d of this.disposables.splice(0)) {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    }
    this.panel.dispose();
  }

  private async load(source: vscode.TextDocument): Promise<void> {
    const generation = ++this.generation;
    const file = source.uri.path.split("/").pop() ?? "gui";
    this.panel.title = `GUI Editor — ${file}`;
    this.post({ type: "loading", file });
    try {
      const result = await this.fetchLayout(source.uri, source.getText());
      if (this.disposed || generation !== this.generation) return;
      const textures: Record<string, string | null> = {};
      for (const texture of result.textures) {
        const png = this.textures.resolve(texture);
        textures[texture] = png ? this.panel.webview.asWebviewUri(vscode.Uri.file(png)).toString() : null;
      }
      if (this.disposed || generation !== this.generation) return;
      this.post({ type: "layout", file, result, textures });
    } catch (err) {
      if (this.disposed) return;
      this.post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  private post(message: HostToApp): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage(message);
  }

  private async onMessage(message: AppToHost): Promise<void> {
    switch (message.type) {
      case "ready":
      case "requestLayout": {
        const doc = await vscode.workspace.openTextDocument(this.sourceUri);
        await this.load(doc);
        return;
      }
    }
  }
}

/** The game's standard UI font, embedded so text metrics roughly match. */
function loadGameFont(gamePath: string | null): string | null {
  if (!gamePath) return null;
  try {
    const otf = path.join(gamePath, "fonts", "Gitan", "GitanLatin-Regular.otf");
    return `data:font/otf;base64,${fs.readFileSync(otf).toString("base64")}`;
  } catch {
    return null;
  }
}

function buildHtml(webview: vscode.Webview, script: vscode.Uri, fontDataUri: string | null): string {
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource}`,
    `font-src data:`,
    `style-src 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  const fontFace = fontDataUri
    ? `@font-face { font-family: "PxGuiGameFont"; src: url("${fontDataUri}") format("opentype"); }`
    : "";

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>GUI Editor</title>
<style>
  ${fontFace}
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
  }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 8px; flex: 0 0 auto; flex-wrap: wrap;
    padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  }
  button {
    padding: 3px 10px; border-radius: 2px; cursor: pointer;
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
    background: var(--vscode-button-secondaryBackground, transparent);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.4));
  }
  #toolbar label { display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }
  #zoomLabel { min-width: 46px; text-align: center; }
  .sep { width: 1px; align-self: stretch; background: var(--vscode-panel-border, rgba(128,128,128,0.35)); }
  #stage { flex: 1 1 auto; overflow: hidden; background: #101010; position: relative; }
  #canvas { display: block; }
  #status {
    flex: 0 0 auto; padding: 4px 8px; font-size: 0.9em;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    color: var(--vscode-descriptionForeground);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
</style>
</head>
<body data-font="${fontDataUri ? "game" : "fallback"}">
<div id="app">
  <div id="toolbar">
    <button id="zoomOut" title="Zoom out">-</button>
    <span id="zoomLabel">100%</span>
    <button id="zoomIn" title="Zoom in">+</button>
    <button id="zoomFit" title="Fit the 1920x1080 reference viewport">Fit</button>
    <span class="sep"></span>
    <label><input id="outlines" type="checkbox" /> Outlines</label>
    <button id="refresh">Refresh</button>
    <span id="meta" style="margin-left:auto;color:var(--vscode-descriptionForeground)"></span>
  </div>
  <div id="stage"><canvas id="canvas"></canvas></div>
  <div id="status">Loading…</div>
</div>
<script nonce="${nonce}" src="${webview.asWebviewUri(script).toString()}"></script>
</body>
</html>`;
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
