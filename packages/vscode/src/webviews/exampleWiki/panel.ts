/**
 * The Examples Wiki panel's VS Code host (px.showExamplesWiki).
 *
 * A reading surface for everything the toolkit knows: the search catalog and
 * one entry's detail come from the language server, and the host does the two
 * things the app cannot - fetch over the wire, and open a game file at the
 * line an example sits on.
 */
import * as vscode from "vscode";
import type {
  ExampleWikiDetail,
  ExampleWikiEntryParams,
  ExampleWikiIndex,
  ExampleWikiKind,
} from "@px-lsp/protocol/protocol";
import { exampleWikiHtml } from "./html";
import type { AppToHost, HostToApp } from "./messages";
import { makeNonce } from "../nonce";
import { tabIcon } from "../tabIcons";
import { bundleUri, watchBundle, webviewSource } from "../devReload";

/** One article, as a deep link names it. */
export interface ExampleWikiTarget {
  name: string;
  kind: ExampleWikiKind;
}

export interface ExampleWikiActions {
  fetchIndex(): Promise<ExampleWikiIndex>;
  fetchEntry(params: ExampleWikiEntryParams): Promise<ExampleWikiDetail | null>;
}

export class ExampleWikiPanel {
  private static instance: ExampleWikiPanel | undefined;
  private static readonly viewType = "px.exampleWiki";

  private readonly panel: vscode.WebviewPanel;
  private readonly actions: ExampleWikiActions;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;

  /** A deep link that arrived before the app could receive it; posted once the
   *  catalog is on its way, since a webview drops what it is sent too early. */
  private pending: ExampleWikiTarget | undefined;

  private constructor(
    context: vscode.ExtensionContext,
    actions: ExampleWikiActions,
    target?: ExampleWikiTarget
  ) {
    this.actions = actions;
    this.pending = target;
    const source = webviewSource(context);
    this.panel = vscode.window.createWebviewPanel(
      ExampleWikiPanel.viewType,
      "Examples Wiki",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [source.root],
      }
    );
    this.panel.iconPath = tabIcon("examples-wiki");
    const render = (): void => {
      const nonce = makeNonce();
      this.panel.webview.html = exampleWikiHtml({
        scriptSrc: bundleUri(this.panel.webview, source, "exampleWiki"),
        nonce,
        csp: [
          `default-src 'none'`,
          `img-src ${this.panel.webview.cspSource} data:`,
          `style-src 'unsafe-inline'`,
          `script-src 'nonce-${nonce}'`,
          `font-src ${this.panel.webview.cspSource}`,
        ].join("; "),
      });
    };
    render();
    this.disposables.push(
      watchBundle(source, "exampleWiki", () => {
        render();
        void this.loadIndex();
      })
    );
    this.panel.webview.onDidReceiveMessage(
      (msg: AppToHost) => void this.onMessage(msg),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    void this.loadIndex();
  }

  /** Open the wiki, on `target`'s article when a caller named one. */
  static show(
    context: vscode.ExtensionContext,
    actions: ExampleWikiActions,
    target?: ExampleWikiTarget
  ): void {
    const existing = ExampleWikiPanel.instance;
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      if (target) existing.post({ type: "reveal", ...target });
      return;
    }
    ExampleWikiPanel.instance = new ExampleWikiPanel(context, actions, target);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ExampleWikiPanel.instance = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
    this.panel.dispose();
  }

  private post(msg: HostToApp): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage(msg);
  }

  private async loadIndex(): Promise<void> {
    this.post({ type: "loading" });
    try {
      const index = await this.actions.fetchIndex();
      this.post({ type: "index", index });
      const target = this.pending;
      this.pending = undefined;
      if (target) this.post({ type: "reveal", ...target });
    } catch (err) {
      this.post({ type: "error", message: message(err) });
    }
  }

  private async onMessage(msg: AppToHost): Promise<void> {
    switch (msg.type) {
      case "refresh":
        await this.loadIndex();
        break;
      case "select": {
        let detail: ExampleWikiDetail | null = null;
        try {
          detail = await this.actions.fetchEntry({ name: msg.name, kind: msg.kind });
        } catch (err) {
          this.post({ type: "error", message: message(err) });
          return;
        }
        this.post({ type: "entry", name: msg.name, kind: msg.kind, detail });
        break;
      }
      case "open":
        await this.openDocument(msg.file, msg.line);
        break;
    }
  }

  /** Open an example site beside the wiki, so the reading pane stays visible. */
  private async openDocument(file: string, line: number): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const zero = Math.min(Math.max(0, line - 1), Math.max(0, doc.lineCount - 1));
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
      void vscode.window.showErrorMessage(`Examples Wiki: cannot open ${file}: ${message(err)}`);
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
