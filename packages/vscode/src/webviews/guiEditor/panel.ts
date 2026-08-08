/**
 * The GUI editor's VS Code host (px.openGuiEditor).
 *
 * It implements messages.ts and does nothing the contract does not name: fetch
 * layout and widget info from the server, resolve textures to webview URLs,
 * push results down, reveal a line in the text editor, and turn an edit gesture
 * into a `WorkspaceEdit`. The document is the source of truth and stays the
 * editor's: the host re-requests layout on every change (debounced) and on
 * save, so the canvas follows typing, formatters, undo and reverts alike.
 *
 * The write path is deliberately thin: the SERVER decides what a gesture means
 * (`paradox/guiSourceEdit` returns edits or a refusal), the host only applies
 * the offsets it is handed. One gesture is one op is one `WorkspaceEdit`, which
 * is what makes VS Code's own undo the editor's undo.
 *
 * The webview loads dist/webview/guiEditor.js under the house nonce CSP: the
 * app is a real bundle, not a serialized function, because an editor does not
 * fit in a template literal.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type {
  GuiLayoutResult,
  GuiSourceEditResult,
  GuiSourceOp,
  GuiWidgetInfo,
} from "@px-lsp/protocol/protocol";
import { LAYOUT_DEBOUNCE_MS, type AppToHost, type HostToApp } from "./messages";
import { guiEditorHtml } from "./html";
import { GuiTextureCache, type TextureRoots } from "./textureCache";

export type FetchLayout = (uri: vscode.Uri, text: string) => Promise<GuiLayoutResult>;
export type FetchWidgetInfo = (uri: vscode.Uri, text: string, line: number) => Promise<GuiWidgetInfo | null>;
export type FetchSourceEdit = (
  uri: vscode.Uri,
  text: string,
  op: GuiSourceOp
) => Promise<GuiSourceEditResult | null>;

export class GuiEditorPanel {
  private static instance: GuiEditorPanel | undefined;
  private static readonly viewType = "px.guiEditor";

  private readonly panel: vscode.WebviewPanel;
  private readonly fetchLayout: FetchLayout;
  private readonly fetchWidgetInfo: FetchWidgetInfo;
  private readonly fetchSourceEdit: FetchSourceEdit;
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
    fetchSourceEdit: FetchSourceEdit,
    source: vscode.TextDocument,
    roots: TextureRoots
  ) {
    this.fetchLayout = fetchLayout;
    this.fetchWidgetInfo = fetchWidgetInfo;
    this.fetchSourceEdit = fetchSourceEdit;
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
    fetchSourceEdit: FetchSourceEdit,
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
    GuiEditorPanel.instance = new GuiEditorPanel(
      context,
      fetchLayout,
      fetchWidgetInfo,
      fetchSourceEdit,
      source,
      roots
    );
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

  /**
   * One op against the document's current text. The server decides everything:
   * which bytes change, whether the gesture is refused and with what words. The
   * version is captured with the text the offsets were computed from, so a
   * stale batch can be recognised instead of applied.
   */
  private async sourceEdit(
    op: GuiSourceOp
  ): Promise<{ doc: vscode.TextDocument; version: number; result: GuiSourceEditResult }> {
    const doc = await vscode.workspace.openTextDocument(this.sourceUri);
    const version = doc.version;
    try {
      const result = await this.fetchSourceEdit(doc.uri, doc.getText(), op);
      return { doc, version, result: result ?? { refused: "the server had no answer for that edit." } };
    } catch (err) {
      return {
        doc,
        version,
        result: { refused: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  /**
   * The server's offsets applied as ONE `WorkspaceEdit`: one undo step for one
   * gesture, in the document's own history, which is why this editor has no
   * undo stack of its own. Returns the reason it did not happen, or undefined.
   */
  private async applyEdits(
    doc: vscode.TextDocument,
    version: number,
    edits: readonly { start: number; end: number; newText: string }[]
  ): Promise<string | undefined> {
    if (doc.version !== version) {
      return "the document changed while that edit was being computed, so its offsets no longer point where they did.";
    }
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of edits) {
      const range = new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end));
      workspaceEdit.replace(doc.uri, range, edit.newText);
    }
    return (await vscode.workspace.applyEdit(workspaceEdit))
      ? undefined
      : "the editor did not apply that edit.";
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
      case "checkEdit":
      case "checkReorder": {
        // A gesture-start check. Whatever the server returns, the edits are
        // thrown away: the point of asking early is that the answer arrives
        // before anything moves, and a check that wrote would be a bug the
        // user could only discover through undo.
        const { result } = await this.sourceEdit(opOf(message));
        this.post({ type: "editVerdict", id: message.id, refused: result.refused, warning: result.warning });
        return;
      }
      case "applyEdit":
      case "reorder": {
        const attempt = await this.sourceEdit(opOf(message));
        const { refused, warning, edits } = attempt.result;
        if (refused || !edits || edits.length === 0) {
          // No edits and no refusal is the writer saying the bytes it would
          // write are already there. Nothing happened, so the app hears it as
          // a refusal rather than waiting for a layout that will not come.
          this.post({
            type: "editVerdict",
            id: message.id,
            refused: refused ?? "that edit changes nothing: the file already says exactly that.",
            warning,
          });
          return;
        }
        const failure = await this.applyEdits(attempt.doc, attempt.version, edits);
        this.post({
          type: "editVerdict",
          id: message.id,
          refused: failure,
          warning: failure ? undefined : warning,
        });
        if (!failure) {
          // Our own single write, not a burst of typing: the debounce exists to
          // coalesce keystrokes and there is nothing here to coalesce. Skipping
          // it is what keeps a released drag from hanging on its preview.
          if (this.debounce) clearTimeout(this.debounce);
          this.debounce = undefined;
          await this.load(await vscode.workspace.openTextDocument(this.sourceUri));
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

/**
 * The op one edit message means. A check and its commit send the SAME op: the
 * only difference is what the host does with the answer, which is why the two
 * are separate message kinds rather than one with a flag.
 */
function opOf(
  message: Extract<AppToHost, { type: "checkEdit" | "applyEdit" | "checkReorder" | "reorder" }>
): GuiSourceOp {
  return message.type === "checkEdit" || message.type === "applyEdit"
    ? {
        kind: "setProperties",
        line: message.line,
        properties: message.properties.map((p) => ({ key: p.key, value: p.value })),
      }
    : { kind: "reorder", line: message.line, from: message.from, to: message.to };
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
