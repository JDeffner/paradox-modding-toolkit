import * as vscode from "vscode";
import type { EventDetail, EventGraph, EventGraphParams } from "@px-lsp/protocol/protocol";
import { eventGraphHtml } from "./html";
import type { AppToHost, HostToApp, UiState } from "./messages";

const UI_KEY = "px.eventGraph.ui";

/** Host-side actions the inspector needs (loc writes, option scaffolding). */
export interface EventGraphActions {
  fetchDetail(id: string): Promise<EventDetail | null>;
  /** Open the event simulator on this event. */
  simulate(id: string): void;
  /** Write a loc value: in place when file/line given, else via the replace file. */
  editLoc(key: string, value: string, file?: string, line?: number): Promise<void>;
  /** Insert a scaffolded option before `endLine` and create its loc key. */
  addOption(id: string, file: string, endLine: number, count: number): Promise<void>;
}

/**
 * Singleton interactive event-graph webview. Renders the CWTools-style event /
 * on_action / decision reference graph with a hand-rolled layered layout, pan +
 * zoom, click-to-open, double-click-to-refocus, and SVG export.
 */
export class EventGraphPanel {
  private static instance: EventGraphPanel | undefined;
  private static readonly viewType = "px.eventGraph";

  private readonly panel: vscode.WebviewPanel;
  private readonly fetchGraph: (params: EventGraphParams) => Promise<EventGraph>;
  private readonly actions: EventGraphActions | null;
  private readonly state: vscode.Memento;
  private disposables: vscode.Disposable[] = [];
  private lastParams: EventGraphParams;
  private disposed = false;

  private constructor(
    context: vscode.ExtensionContext,
    fetchGraph: (params: EventGraphParams) => Promise<EventGraph>,
    params: EventGraphParams,
    actions: EventGraphActions | null
  ) {
    this.fetchGraph = fetchGraph;
    this.actions = actions;
    this.lastParams = params;
    this.state = context.workspaceState;

    this.panel = vscode.window.createWebviewPanel(
      EventGraphPanel.viewType,
      "Paradox Event Graph",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "webview")],
      }
    );

    this.panel.webview.html = this.buildHtml(context, this.panel.webview);
    this.post({ type: "init", ui: this.state.get<UiState>(UI_KEY) });

    this.panel.webview.onDidReceiveMessage(
      (msg: AppToHost) => void this.onMessage(msg),
      undefined,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    void this.load(params);
  }

  /** Create or reveal the singleton panel and load the graph for `params`. */
  static show(
    context: vscode.ExtensionContext,
    fetchGraph: (params: EventGraphParams) => Promise<EventGraph>,
    params: EventGraphParams,
    actions: EventGraphActions | null = null
  ): void {
    if (EventGraphPanel.instance) {
      const inst = EventGraphPanel.instance;
      inst.panel.reveal(vscode.ViewColumn.Active);
      void inst.load(params);
      return;
    }
    EventGraphPanel.instance = new EventGraphPanel(context, fetchGraph, params, actions);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    EventGraphPanel.instance = undefined;
    for (const d of this.disposables.splice(0)) {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    }
    this.panel.dispose();
  }

  /** Fetch a graph and push it (or an error) to the webview. */
  private async load(params: EventGraphParams): Promise<void> {
    this.lastParams = params;
    this.post({ type: "loading" });
    try {
      const graph = await this.fetchGraph(params);
      if (this.disposed) return;
      this.post({ type: "graph", graph, params });
    } catch (err) {
      if (this.disposed) return;
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", message });
    }
  }

  private post(msg: HostToApp): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: AppToHost): Promise<void> {
    switch (msg.type) {
      case "open":
        await this.openDocument(msg.file, msg.line);
        break;
      case "refocus":
        await this.load({ root: msg.id, maxNodes: this.lastParams.maxNodes });
        break;
      case "fetch":
        await this.load(msg.params);
        break;
      case "export":
        await this.exportSvg(msg.svg);
        break;
      case "select":
        await this.sendDetail(msg.id);
        break;
      case "simulate":
        this.actions?.simulate(msg.id);
        break;
      case "editLoc":
        if (this.actions) {
          try {
            await this.actions.editLoc(msg.key, msg.value, msg.file, msg.line);
          } catch (err) {
            void vscode.window.showErrorMessage(
              `Paradox Modding Toolkit: localization write failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
          await this.sendDetail(msg.id);
        }
        break;
      case "uiState":
        await this.state.update(UI_KEY, msg.state);
        break;
      case "addOption":
        if (this.actions) {
          try {
            await this.actions.addOption(msg.id, msg.file, msg.endLine, msg.count);
          } catch (err) {
            void vscode.window.showErrorMessage(
              `Paradox Modding Toolkit: add option failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
          await this.sendDetail(msg.id);
        }
        break;
    }
  }

  private async sendDetail(id: string): Promise<void> {
    if (!this.actions) return;
    try {
      const detail = await this.actions.fetchDetail(id);
      this.post({ type: "detail", detail, id });
    } catch {
      this.post({ type: "detail", detail: null, id });
    }
  }

  private async openDocument(file: string, line?: number): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const zero = Math.max(0, (line ?? 1) - 1);
      const position = new vscode.Position(zero, 0);
      // Open in the OTHER editor group so the graph tab stays visible; reuse
      // an existing text group when there is one.
      const textGroup = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.scheme === "file"
      )?.viewColumn;
      await vscode.window.showTextDocument(doc, {
        viewColumn: textGroup ?? vscode.ViewColumn.Beside,
        preserveFocus: true,
        selection: new vscode.Range(position, position),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Paradox Event Graph: cannot open ${file}: ${message}`);
    }
  }

  private async exportSvg(svg: string): Promise<void> {
    try {
      const target = await vscode.window.showSaveDialog({
        title: "Export Event Graph as SVG",
        filters: { "SVG image": ["svg"] },
        saveLabel: "Export",
      });
      if (!target) return;
      await vscode.workspace.fs.writeFile(target, Buffer.from(svg, "utf8"));
      void vscode.window.showInformationMessage(`Event graph exported to ${target.fsPath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Paradox Event Graph: export failed: ${message}`);
    }
  }

  // --- HTML -----------------------------------------------------------------

  private buildHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const nonce = makeNonce();
    return eventGraphHtml({
      scriptSrc: webview
        .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "eventGraph.js"))
        .toString(),
      nonce,
      csp: [
        `default-src 'none'`,
        `img-src ${webview.cspSource} data:`,
        `style-src 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`,
        `font-src ${webview.cspSource}`,
      ].join("; "),
    });
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
