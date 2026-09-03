import * as fs from "fs";
import * as vscode from "vscode";
import type {
  EventBannerResult,
  EventDetail,
  EventGraph,
  EventGraphParams,
  EventValueOptionsResult,
  EventVocabularyResult,
} from "@px-lsp/protocol/protocol";
import { GuiTextureCache, THUMBNAIL_MAX_DIM, type TextureRoots } from "../guiEditor/textureCache";
import { eventGraphHtml } from "./html";
import type { GraphState, PendingEdit } from "./history";
import type { AppToHost, HostToApp, UiState } from "./messages";
import { makeNonce } from "../nonce";
import { tabIcon } from "../tabIcons";
import { bundleUri, watchBundle, webviewSource, type WebviewSource } from "../devReload";
import { isUnder } from "../../config";

const UI_KEY = "px.eventGraph.ui";

/** Host-side actions the graph needs. Everything that touches disk is here. */
export interface EventGraphActions {
  fetchDetail(id: string): Promise<EventDetail | null>;
  fetchVocabulary(): Promise<EventVocabularyResult>;
  /** The value set `value` belongs to (all secrets, all traits…), or null. */
  fetchValueOptions(value: string): Promise<EventValueOptionsResult | null>;
  /** Resolve one event theme to the texture behind its window. */
  fetchBanner(theme: string): Promise<EventBannerResult>;
  /** Write a loc value: in place when file/line given, else via the replace file. */
  editLoc(key: string, value: string, file?: string, line?: number): Promise<void>;
  /** Insert a scaffolded option before `endLine` and create its loc key. */
  addOption(id: string, file: string, endLine: number, count: number): Promise<void>;
  /** Append a scaffolded event (file created if null) and its loc keys. */
  createEvent(
    id: string,
    file: string | null,
    type: string,
    title: string,
    desc: string,
    options: number
  ): Promise<void>;
  /** Mod root and game root, for resolving a texture path. */
  textureRoots(): TextureRoots;
  /** A mod file changed on disk (re-index). */
  notifyChanged(file: string): void;
}

/**
 * Singleton interactive event-graph webview.
 *
 * The panel writes nothing on its own: the app holds the whole editing session
 * and sends `save` when the user asks for it. The host mirrors that session
 * (`state`) for one reason only - a webview panel cannot cancel its own close,
 * so the unsaved work has to be here already when the tab goes away.
 */
export class EventGraphPanel {
  private static instance: EventGraphPanel | undefined;
  private static readonly viewType = "px.eventGraph";

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private readonly fetchGraph: (params: EventGraphParams) => Promise<EventGraph>;
  private readonly actions: EventGraphActions | null;
  private readonly state: vscode.Memento;
  private textures: GuiTextureCache;
  private disposables: vscode.Disposable[] = [];
  private lastParams: EventGraphParams;
  /** The app's session as of its last message; empty until it sends one. */
  private session: GraphState = { focus: {}, positions: {}, pending: [] };
  private disposed = false;
  private readonly source: WebviewSource;

  private constructor(
    context: vscode.ExtensionContext,
    fetchGraph: (params: EventGraphParams) => Promise<EventGraph>,
    params: EventGraphParams,
    actions: EventGraphActions | null
  ) {
    this.context = context;
    this.fetchGraph = fetchGraph;
    this.actions = actions;
    this.lastParams = params;
    this.state = context.workspaceState;
    this.textures = new GuiTextureCache(
      context.globalStorageUri.fsPath,
      actions?.textureRoots() ?? { gamePath: null, modPath: null }
    );
    fs.mkdirSync(this.textures.cacheDir, { recursive: true });
    this.source = webviewSource(context);

    this.panel = vscode.window.createWebviewPanel(
      EventGraphPanel.viewType,
      "Event Graph",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.source.root, vscode.Uri.file(this.textures.cacheDir)],
      }
    );

    this.panel.iconPath = tabIcon("event-graph");
    this.panel.webview.html = this.buildHtml(this.panel.webview);
    this.post({ type: "init", ui: this.state.get<UiState>(UI_KEY) });
    // The app receives its graph by push, not request, so a dev reload
    // replays the constructor's boot sequence.
    this.disposables.push(
      watchBundle(this.source, "eventGraph", () => {
        this.panel.webview.html = this.buildHtml(this.panel.webview);
        this.post({ type: "init", ui: this.state.get<UiState>(UI_KEY) });
        void this.load(this.lastParams);
        void this.sendVocabulary();
      })
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: AppToHost) => void this.onMessage(msg),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => void this.onDispose(), undefined, this.disposables);

    void this.load(params);
    void this.sendVocabulary();
  }

  /** Create or reveal the singleton panel and load the graph for `params`. */
  static show(
    context: vscode.ExtensionContext,
    fetchGraph: (params: EventGraphParams) => Promise<EventGraph>,
    params: EventGraphParams,
    actions: EventGraphActions | null = null
  ): EventGraphPanel {
    const existing = EventGraphPanel.instance;
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      void existing.load(params);
      return existing;
    }
    const created = new EventGraphPanel(context, fetchGraph, params, actions);
    EventGraphPanel.instance = created;
    return created;
  }

  /**
   * The tab closed. A webview cannot veto that, so unsaved work is offered here
   * instead: write it, drop it, or reopen the graph with the session intact.
   */
  private async onDispose(): Promise<void> {
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
    const pending = this.session.pending;
    if (pending.length === 0) return;
    const answer = await vscode.window.showWarningMessage(
      `The event graph has ${pending.length} unsaved change${pending.length === 1 ? "" : "s"}. ` +
        "Dismiss this to reopen the graph with your changes still in it.",
      "Save",
      "Discard"
    );
    if (answer === "Save") {
      const result = await this.applyEdits(pending);
      if (result.error) void vscode.window.showErrorMessage(`Event Graph: ${result.error}`);
      return;
    }
    if (answer === "Discard") return;
    // Cancel (or dismissed): put the graph back exactly as it was.
    const session = this.session;
    const reopened = EventGraphPanel.show(this.context, this.fetchGraph, this.lastParams, this.actions);
    reopened.session = session;
    reopened.post({ type: "restore", state: session });
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
      this.post({ type: "error", message: message(err) });
    }
  }

  private async sendVocabulary(): Promise<void> {
    if (!this.actions) return;
    try {
      const vocabulary = await this.actions.fetchVocabulary();
      this.post({ type: "vocabulary", vocabulary });
    } catch {
      /* the inspector falls back to plain inputs */
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
      case "fetch":
        await this.load(msg.params);
        break;
      case "export":
        await this.exportSvg(msg.svg);
        break;
      case "select":
        await this.sendDetail(msg.id, "detail");
        break;
      case "simulate":
        await this.sendDetail(msg.id, "sim");
        break;
      case "state":
        this.session = msg.state;
        break;
      case "banner":
        await this.sendBanner(msg.theme);
        break;
      case "valueOptions": {
        let result: EventValueOptionsResult | null = null;
        try {
          result = (await this.actions?.fetchValueOptions(msg.value)) ?? null;
        } catch {
          /* null = no menu; the inspector falls back to a plain input */
        }
        this.post({ type: "valueOptions", value: msg.value, result });
        break;
      }
      case "save": {
        const result = await this.applyEdits(msg.edits);
        this.post({ type: "saved", applied: result.applied, error: result.error });
        break;
      }
      case "uiState":
        await this.state.update(UI_KEY, msg.state);
        break;
    }
  }

  /**
   * Apply the pending edits. Stops at the first failure and reports it, with
   * the batch indices of the edits that DID land: a half-applied batch the
   * user knows about beats a silent one, and the app drops exactly the
   * applied edits so a retry never writes one twice.
   */
  private async applyEdits(edits: PendingEdit[]): Promise<{ applied: number[]; error?: string }> {
    if (!this.actions) return { applied: [], error: "this graph is read-only" };
    const applied: number[] = [];
    for (const { edit, index } of writeOrder(edits)) {
      // The batch is text from a webview: an edit may only touch a file of the
      // mod (or another workspace folder), wherever its path points.
      const target = edit.file ?? null;
      if (target !== null && !this.editableFile(target)) {
        return { applied, error: `${describe(edit)} refused: ${target} is not a file of this mod` };
      }
      try {
        if (edit.kind === "editLoc") {
          await this.actions.editLoc(edit.key, edit.value, edit.file, edit.line);
        } else if (edit.kind === "addOption") {
          await this.actions.addOption(edit.id, edit.file, edit.endLine, edit.count);
        } else if (edit.kind === "createEvent") {
          await this.actions.createEvent(edit.id, edit.file, edit.type, edit.title, edit.desc, edit.options);
        } else {
          await this.setField(edit);
        }
        applied.push(index);
      } catch (err) {
        return { applied, error: `${describe(edit)} failed: ${message(err)}` };
      }
    }
    this.session = { ...this.session, pending: [] };
    return { applied };
  }

  /** True when `file` sits under the mod root or a workspace folder — the only
   * places a graph edit may write. */
  private editableFile(file: string): boolean {
    if (isUnder(this.actions?.textureRoots().modPath ?? null, file)) return true;
    return (vscode.workspace.workspaceFolders ?? []).some((f) => isUnder(f.uri.fsPath, file));
  }

  /**
   * Rewrite one `key = value` statement, or insert it. A rewrite keeps the
   * line's own indentation: the file's style is the author's, not ours.
   */
  private async setField(edit: Extract<PendingEdit, { kind: "setField" }>): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(edit.file));
    const workspaceEdit = new vscode.WorkspaceEdit();
    if (edit.line === null) {
      const at = Math.min(Math.max(0, edit.insertLine), doc.lineCount);
      workspaceEdit.insert(
        doc.uri,
        new vscode.Position(at, 0),
        `${"\t".repeat(edit.indent)}${edit.key} = ${edit.value}\n`
      );
    } else {
      if (edit.line >= doc.lineCount) throw new Error(`line ${edit.line + 1} is past the end of the file`);
      const line = doc.lineAt(edit.line);
      const indent = /^[\t ]*/.exec(line.text)?.[0] ?? "";
      workspaceEdit.replace(doc.uri, line.range, `${indent}${edit.key} = ${edit.value}`);
    }
    if (!(await vscode.workspace.applyEdit(workspaceEdit))) throw new Error("edit rejected");
    await doc.save();
    this.actions?.notifyChanged(edit.file);
  }

  private async sendDetail(id: string, as: "detail" | "sim"): Promise<void> {
    if (!this.actions) return;
    try {
      const detail = await this.actions.fetchDetail(id);
      this.post(as === "detail" ? { type: "detail", detail, id } : { type: "sim", detail, id });
    } catch {
      this.post(as === "detail" ? { type: "detail", detail: null, id } : { type: "sim", detail: null, id });
    }
  }

  /**
   * A theme's illustration as a webview url. `null` is a real answer: the app
   * draws a labeled placeholder rather than an empty card, which would read as
   * "this theme has no art".
   */
  private async sendBanner(theme: string): Promise<void> {
    if (!this.actions) return;
    let result: EventBannerResult = { theme, reason: "not resolved" };
    try {
      result = await this.actions.fetchBanner(theme);
    } catch (err) {
      result = { theme, reason: message(err) };
    }
    let url: string | null = null;
    if (result.texture) {
      const png = this.textures.resolve(result.texture, THUMBNAIL_MAX_DIM);
      if (png) url = this.panel.webview.asWebviewUri(vscode.Uri.file(png)).toString();
    }
    this.post({ type: "banner", result, url });
  }

  private async openDocument(file: string, line?: number): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const zero = Math.max(0, (line ?? 1) - 1);
      const position = new vscode.Position(Math.min(zero, Math.max(0, doc.lineCount - 1)), 0);
      // Open in the OTHER editor group so the graph tab stays visible; reuse an
      // existing text group when there is one.
      const textGroup = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.scheme === "file"
      )?.viewColumn;
      await vscode.window.showTextDocument(doc, {
        viewColumn: textGroup ?? vscode.ViewColumn.Beside,
        preserveFocus: true,
        selection: new vscode.Range(position, position),
      });
    } catch (err) {
      void vscode.window.showErrorMessage(`Event Graph: cannot open ${file}: ${message(err)}`);
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
      void vscode.window.showErrorMessage(`Event Graph: export failed: ${message(err)}`);
    }
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    return eventGraphHtml({
      scriptSrc: bundleUri(webview, this.source, "eventGraph"),
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

/**
 * The order the edits have to be WRITTEN in, which is not the order they were
 * made in. Every edit carries the line numbers of the file as it was when the
 * user made it, and an insertion moves every line under it. So: replacements
 * first (they move nothing), then insertions from the bottom of each file
 * upwards, so an earlier insertion cannot invalidate a later one's line. Two
 * insertions at the same point are written back to front, which leaves them in
 * the file in the order they were added.
 */
function writeOrder(edits: PendingEdit[]): Array<{ edit: PendingEdit; index: number }> {
  const at = (edit: PendingEdit): number | null => {
    if (edit.kind === "addOption") return edit.endLine;
    if (edit.kind === "setField" && edit.line === null) return edit.insertLine;
    return null;
  };
  const keep: Array<{ edit: PendingEdit; index: number }> = [];
  const inserts: Array<{ edit: PendingEdit; line: number; index: number }> = [];
  edits.forEach((edit, index) => {
    const line = at(edit);
    if (line === null) keep.push({ edit, index });
    else inserts.push({ edit, line, index });
  });
  inserts.sort((a, b) => b.line - a.line || b.index - a.index);
  return [...keep, ...inserts.map(({ edit, index }) => ({ edit, index }))];
}

function describe(edit: PendingEdit): string {
  if (edit.kind === "editLoc") return `localization ${edit.key}`;
  if (edit.kind === "addOption") return `new option on ${edit.id}`;
  if (edit.kind === "createEvent") return `new event ${edit.id}`;
  return `${edit.key} on ${edit.id}`;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
