/**
 * The GUI editor's VS Code host (px.openGuiEditor).
 *
 * It implements messages.ts and does nothing the contract does not name: fetch
 * layout and widget info from the server, resolve textures to webview URLs,
 * push results down, reveal a line in the text editor. The document is the
 * source of truth and stays the editor's — the host re-requests layout on every
 * change (debounced) and on save, so the canvas follows typing, formatters and
 * reverts alike.
 *
 * The webview loads dist/webview/guiEditor.js under the house nonce CSP: the
 * app is a real bundle, not a serialized function, because an editor does not
 * fit in a template literal.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { GuiLayoutResult, GuiWidgetInfo } from "@px-lsp/protocol/protocol";
import { LAYOUT_DEBOUNCE_MS, type AppToHost, type HostToApp } from "./messages";
import { guiEditorHtml } from "./html";
import { GuiTextureCache, type TextureRoots } from "./textureCache";

export type FetchLayout = (uri: vscode.Uri, text: string) => Promise<GuiLayoutResult>;
export type FetchWidgetInfo = (uri: vscode.Uri, text: string, line: number) => Promise<GuiWidgetInfo | null>;

export class GuiEditorPanel {
  private static instance: GuiEditorPanel | undefined;
  private static readonly viewType = "px.guiEditor";

  private readonly panel: vscode.WebviewPanel;
  private readonly fetchLayout: FetchLayout;
  private readonly fetchWidgetInfo: FetchWidgetInfo;
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
    fetchWidgetInfo: FetchWidgetInfo,
    source: vscode.TextDocument,
    roots: TextureRoots
  ) {
    this.fetchLayout = fetchLayout;
    this.fetchWidgetInfo = fetchWidgetInfo;
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
    fetchWidgetInfo: FetchWidgetInfo,
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
    GuiEditorPanel.instance = new GuiEditorPanel(context, fetchLayout, fetchWidgetInfo, source, roots);
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
      case "requestWidgetInfo": {
        const line = message.line;
        const doc = await vscode.workspace.openTextDocument(this.sourceUri);
        try {
          const info = await this.fetchWidgetInfo(doc.uri, doc.getText(), line);
          this.post({ type: "widgetInfo", line, info });
        } catch {
          // A failed inspector read is not worth an error banner over the
          // canvas: the app shows the selection with no rows.
          this.post({ type: "widgetInfo", line, info: null });
        }
        return;
      }
      case "reveal": {
        const doc = await vscode.workspace.openTextDocument(this.sourceUri);
        const line = Math.max(0, Math.min(message.line, doc.lineCount - 1));
        const range = doc.lineAt(line).range;
        // The document's own column, never the ACTIVE one: the active column is
        // the panel's while the canvas has focus, and opening the text there
        // would shove the editor the reveal was meant to point at. Focus stays
        // on the canvas, so the gesture is not interrupted either.
        const visible = vscode.window.visibleTextEditors.find(
          (e) => e.document.uri.toString() === this.sourceUri.toString()
        );
        const editor = await vscode.window.showTextDocument(doc, {
          viewColumn: visible?.viewColumn ?? vscode.ViewColumn.One,
          preserveFocus: true,
          preview: false,
        });
        editor.selection = new vscode.Selection(range.start, range.start);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
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
  return guiEditorHtml({
    scriptSrc: webview.asWebviewUri(script).toString(),
    nonce,
    csp: [
      `default-src 'none'`,
      `img-src ${webview.cspSource}`,
      `font-src data:`,
      `style-src 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join("; "),
    fontDataUri,
  });
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
