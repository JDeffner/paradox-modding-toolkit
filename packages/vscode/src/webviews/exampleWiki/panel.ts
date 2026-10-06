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
  gameId: string;
  gameName: string;
  shortName: string;
  contextKey: string;
  fetchIndex(refresh?: boolean): Promise<ExampleWikiIndex>;
  fetchEntry(params: ExampleWikiEntryParams): Promise<ExampleWikiDetail | null>;
}

export class ExampleWikiPanel {
  private static instance: ExampleWikiPanel | undefined;
  private static readonly viewType = "px.exampleWiki";

  private readonly panel: vscode.WebviewPanel;
  private actions: ExampleWikiActions;
  private generation = 0;
  private ready = false;
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
      `${actions.shortName} Examples Wiki`,
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
    this.disposables.push(watchBundle(source, "exampleWiki", this.panel, render));
    this.panel.webview.onDidReceiveMessage(
      (msg: AppToHost) => void this.onMessage(msg),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  /** Open the wiki, on `target`'s article when a caller named one. */
  static show(
    context: vscode.ExtensionContext,
    actions: ExampleWikiActions,
    target?: ExampleWikiTarget
  ): void {
    const existing = ExampleWikiPanel.instance;
    if (existing) {
      const changed = existing.actions.contextKey !== actions.contextKey;
      existing.actions = actions;
      existing.panel.title = `${actions.shortName} Examples Wiki`;
      if (changed) {
        existing.generation++;
        existing.pending = target;
        if (existing.ready) void existing.loadIndex(true);
      }
      existing.panel.reveal(vscode.ViewColumn.Active);
      if (target && !changed) {
        if (existing.ready) {
          existing.pending = undefined;
          existing.post({ type: "reveal", ...target });
        } else existing.pending = target;
      }
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

  private async loadIndex(reset = false, refresh = false): Promise<void> {
    const generation = ++this.generation;
    const actions = this.actions;
    this.post({ type: "loading", ...(reset ? { reset: true } : {}), gameName: actions.gameName });
    try {
      const index = await actions.fetchIndex(refresh);
      if (generation !== this.generation || this.disposed) return;
      this.post({ type: "index", index });
      const target = this.pending;
      this.pending = undefined;
      if (target) this.post({ type: "reveal", ...target });
    } catch (err) {
      if (generation !== this.generation || this.disposed) return;
      this.post({ type: "error", message: message(err) });
    }
  }

  private async onMessage(msg: AppToHost): Promise<void> {
    switch (msg.type) {
      case "refresh": {
        const refresh = this.ready;
        this.ready = true;
        await this.loadIndex(false, refresh);
        break;
      }
      case "select": {
        const generation = this.generation;
        const actions = this.actions;
        let detail: ExampleWikiDetail | null = null;
        try {
          detail = await actions.fetchEntry({ name: msg.name, kind: msg.kind });
        } catch (err) {
          if (generation !== this.generation || this.disposed) return;
          this.post({ type: "error", message: message(err) });
          return;
        }
        if (generation === this.generation && !this.disposed)
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
