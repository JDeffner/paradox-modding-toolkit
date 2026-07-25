import * as vscode from "vscode";
import type { EventDetail, EventGraph, EventGraphParams } from "@px-lsp/protocol/protocol";
import { layoutGraph } from "./layout";

/** Messages the webview sends to the host. */
type InboundMessage =
  | { type: "open"; file: string; line?: number }
  | { type: "refocus"; id: string }
  | { type: "fetch"; params: EventGraphParams }
  | { type: "export"; svg: string }
  | { type: "select"; id: string }
  | { type: "editLoc"; id: string; key: string; value: string; file?: string; line?: number }
  | { type: "addOption"; id: string; file: string; endLine: number; count: number };

/** Messages the host sends to the webview. */
type OutboundMessage =
  | { type: "graph"; graph: EventGraph; params: EventGraphParams }
  | { type: "error"; message: string }
  | { type: "loading" }
  | { type: "detail"; detail: EventDetail | null; id: string };

/** Host-side actions the inspector needs (loc writes, option scaffolding). */
export interface EventGraphActions {
  fetchDetail(id: string): Promise<EventDetail | null>;
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

    this.panel = vscode.window.createWebviewPanel(
      EventGraphPanel.viewType,
      "CK3 Event Graph",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      }
    );

    this.panel.webview.html = this.buildHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      (msg: InboundMessage) => void this.onMessage(msg),
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

  private post(msg: OutboundMessage): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: InboundMessage): Promise<void> {
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
      case "editLoc":
        if (this.actions) {
          try {
            await this.actions.editLoc(msg.key, msg.value, msg.file, msg.line);
          } catch (err) {
            void vscode.window.showErrorMessage(
              `Paradox Toolkit: localization write failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
          await this.sendDetail(msg.id);
        }
        break;
      case "addOption":
        if (this.actions) {
          try {
            await this.actions.addOption(msg.id, msg.file, msg.endLine, msg.count);
          } catch (err) {
            void vscode.window.showErrorMessage(
              `Paradox Toolkit: add option failed: ${err instanceof Error ? err.message : String(err)}`
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
      void vscode.window.showErrorMessage(`CK3 Event Graph: cannot open ${file}: ${message}`);
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
      void vscode.window.showErrorMessage(`CK3 Event Graph: export failed: ${message}`);
    }
  }

  // --- HTML -----------------------------------------------------------------

  private buildHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const cspSource = webview.cspSource;
    const csp = [
      `default-src 'none'`,
      `img-src ${cspSource} data:`,
      `style-src 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${cspSource}`,
    ].join("; ");

    // The tested layout function is serialized here so the shipped webview runs
    // exactly the unit-tested algorithm (see layout.ts header).
    const layoutSource = layoutGraph.toString();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>CK3 Event Graph</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%; width: 100%;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    overflow: hidden;
  }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 8px; flex: 0 0 auto;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  }
  #toolbar input[type="text"] {
    flex: 1 1 auto; min-width: 80px;
    padding: 3px 6px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.4));
    border-radius: 2px;
  }
  #toolbar button {
    padding: 3px 10px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: none; border-radius: 2px; cursor: pointer;
  }
  #toolbar button:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
  #toolbar button.secondary {
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
    background: var(--vscode-button-secondaryBackground, transparent);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.4));
  }
  #main { display: flex; flex: 1 1 auto; min-height: 0; }
  #graphWrap { position: relative; flex: 1 1 auto; overflow: hidden; }
  #graph { width: 100%; height: 100%; display: block; cursor: grab; }
  #graph.dragging { cursor: grabbing; }
  #inspector {
    flex: 0 0 340px; max-width: 45%; overflow-y: auto; display: none;
    border-left: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    padding: 10px 12px; font-size: 0.95em;
  }
  #inspector.show { display: block; }
  #inspector h2 { margin: 0 0 2px; font-size: 1.1em; word-break: break-all; }
  #inspector h3 {
    margin: 14px 0 4px; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--vscode-descriptionForeground);
  }
  .badges { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 8px; }
  .badge {
    padding: 0 7px; border-radius: 8px; font-size: 0.85em;
    color: var(--vscode-badge-foreground, #fff);
    background: var(--vscode-badge-background, #4d4d4d);
  }
  .ilink { color: var(--vscode-textLink-foreground, #3794ff); cursor: pointer; text-decoration: none; }
  .ilink:hover { text-decoration: underline; }
  .locrow { margin: 6px 0; }
  .locrow .k { font-size: 0.85em; color: var(--vscode-descriptionForeground); word-break: break-all; }
  .locrow .edit { display: flex; gap: 4px; margin-top: 2px; }
  .locrow input {
    flex: 1 1 auto; min-width: 40px; padding: 2px 6px;
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.4)); border-radius: 2px;
  }
  .locrow button, #inspector .act {
    padding: 2px 8px; cursor: pointer; border-radius: 2px; border: none;
    color: var(--vscode-button-foreground); background: var(--vscode-button-background);
  }
  .chips { display: flex; gap: 4px; flex-wrap: wrap; margin: 2px 0; }
  .chip {
    padding: 0 6px; border-radius: 3px; font-size: 0.85em; cursor: default;
    background: var(--vscode-editorWidget-background, rgba(128,128,128,0.15));
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
  }
  .optcard {
    margin: 6px 0; padding: 6px 8px; border-radius: 4px;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
  }
  .refrow { display: flex; gap: 6px; align-items: baseline; margin: 2px 0; }
  .refrow .kind { font-size: 0.8em; color: var(--vscode-descriptionForeground); min-width: 88px; }
  .node-rect.selected-node { filter: brightness(1.25); }
  #status {
    flex: 0 0 auto; padding: 4px 8px;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    color: var(--vscode-descriptionForeground, var(--vscode-editor-foreground));
    font-size: 0.9em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #status.warn { color: var(--vscode-editorWarning-foreground, #cca700); }
  #status.error { color: var(--vscode-editorError-foreground, #f14c4c); }
  #empty {
    position: absolute; inset: 0;
    display: none; align-items: center; justify-content: center;
    text-align: center; padding: 24px;
    color: var(--vscode-descriptionForeground, var(--vscode-editor-foreground));
  }
  #empty.show { display: flex; }
  .node-rect { cursor: pointer; }
  .node-label {
    pointer-events: none;
    fill: var(--vscode-editor-foreground);
    font-size: 12px;
  }
  .node-sub { font-size: 9px; opacity: 0.75; }
  .node-rect.search-hit { stroke: var(--vscode-charts-yellow, #cca700) !important; stroke-width: 3 !important; }
  .edge-path { fill: none; }
  .edge-label {
    pointer-events: none;
    fill: var(--vscode-descriptionForeground, var(--vscode-editor-foreground));
    font-size: 9px; opacity: 0.85;
  }
  #help {
    position: absolute; top: 8px; right: 8px; z-index: 5; max-width: 380px;
    padding: 12px 14px; border-radius: 6px; display: none; font-size: 0.92em;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.4));
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }
  #help.show { display: block; }
  #help h4 { margin: 0 0 6px; }
  #help li { margin: 3px 0; }
  .legend { display: flex; gap: 10px; align-items: center; font-size: 0.85em; flex-wrap: wrap; }
  .legend span { display: inline-flex; align-items: center; gap: 4px; }
  .swatch { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <input id="query" type="text" placeholder="root id or namespace (e.g. my_event.001 or my_namespace)" />
    <button id="go">Go</button>
    <button id="showAll" class="secondary" title="Show every event/on_action/decision node of the mod">All nodes</button>
    <button id="refresh" class="secondary">Refresh</button>
    <button id="export" class="secondary">Export SVG</button>
    <button id="helpBtn" class="secondary" title="How this view works">?</button>
    <div class="legend">
      <span><i class="swatch" style="background:var(--vscode-charts-blue,#3794ff)"></i>event</span>
      <span><i class="swatch" style="background:var(--vscode-charts-purple,#b180d7)"></i>on_action</span>
      <span><i class="swatch" style="background:var(--vscode-charts-green,#89d185)"></i>decision</span>
      <span><i class="swatch" style="background:var(--vscode-charts-orange,#d18616)"></i>other</span>
    </div>
  </div>
  <div id="main">
    <div id="graphWrap">
      <svg id="graph" xmlns="http://www.w3.org/2000/svg"></svg>
      <div id="empty"></div>
      <div id="help">
        <h4>Event graph — how to read it</h4>
        <ul>
          <li><b>Boxes</b> are events / on_actions / decisions (see the color legend). The small line under the id is the event's localized title.</li>
          <li><b>Arrows</b> mean "fires / references": the label on an arrow tells you WHERE in the source event the call sits (an option's text, immediate, on_actions…).</li>
          <li><b>Dashed borders</b> = vanilla content, solid = your mod, dotted = a parent mod.</li>
          <li><b>Click</b> a box to open the inspector: read and EDIT its localization, jump to any referenced variable/scope/effect, scaffold a new option.</li>
          <li><b>Double-click</b> (or Ctrl+click) opens the source file beside the graph. <b>Right-click</b> re-centers the graph on that event.</li>
          <li><b>Search box</b>: type an event id (namespace.123) or a namespace and hit Go. <b>All nodes</b> shows the whole mod at once. Typing also highlights matching boxes by id or title text.</li>
          <li>Drag to pan, scroll to zoom, Export saves the picture as SVG.</li>
        </ul>
      </div>
    </div>
    <aside id="inspector"></aside>
  </div>
  <div id="status">Loading…</div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

// === Shipped layout: exact source of the unit-tested layoutGraph ===
const layoutGraph = ${layoutSource};

const SVG_NS = "http://www.w3.org/2000/svg";
const svg = document.getElementById("graph");
const emptyEl = document.getElementById("empty");
const statusEl = document.getElementById("status");
const queryEl = document.getElementById("query");

const NODE_W = 150, NODE_H = 40;
let view = { x: 0, y: 0, scale: 1 };
let currentGraph = null;

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function kindFill(kind) {
  if (kind === "event") return "var(--vscode-charts-blue, #3794ff)";
  if (kind === "on_action") return "var(--vscode-charts-purple, #b180d7)";
  if (kind === "decision") return "var(--vscode-charts-green, #89d185)";
  return "var(--vscode-charts-orange, #d18616)";
}
function sourceDash(source) {
  if (source === "vanilla") return "5,4";   // dashed
  if (source === "parent") return "2,4";    // dotted
  return "0";                                // mod: solid
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || "";
}

function applyTransform(g) {
  g.setAttribute("transform",
    "translate(" + view.x + "," + view.y + ") scale(" + view.scale + ")");
}

let rootGroup = null;

function render(graph, params) {
  currentGraph = graph;
  nodeRects.clear();
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const nodes = graph.nodes || [];
  const edges = graph.edges || [];

  if (nodes.length === 0) {
    emptyEl.classList.add("show");
    emptyEl.textContent = "No events found — open a mod with events/ or pass a namespace.";
    setStatus("0 nodes · 0 edges", "");
    return;
  }
  emptyEl.classList.remove("show");

  const rootId = (params && params.root) || null;
  const pos = layoutGraph(nodes, edges, rootId);
  const byId = {};
  for (let i = 0; i < nodes.length; i++) byId[nodes[i].id] = nodes[i];

  // defs: arrowhead marker
  const defs = document.createElementNS(SVG_NS, "defs");
  const marker = document.createElementNS(SVG_NS, "marker");
  marker.setAttribute("id", "arrow");
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "9");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "7");
  marker.setAttribute("markerHeight", "7");
  marker.setAttribute("orient", "auto-start-reverse");
  const arrowPath = document.createElementNS(SVG_NS, "path");
  arrowPath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  arrowPath.setAttribute("fill", "var(--vscode-editor-foreground)");
  arrowPath.setAttribute("opacity", "0.55");
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const g = document.createElementNS(SVG_NS, "g");
  rootGroup = g;
  svg.appendChild(g);

  // edges first (under nodes)
  const edgeLayer = document.createElementNS(SVG_NS, "g");
  g.appendChild(edgeLayer);
  for (let e = 0; e < edges.length; e++) {
    const from = pos.get(edges[e].from);
    const to = pos.get(edges[e].to);
    if (!from || !to) continue;
    const x1 = from.x + NODE_W / 2, y1 = from.y;
    const x2 = to.x - NODE_W / 2, y2 = to.y;
    const mx = (x1 + x2) / 2;
    const d = "M " + x1 + " " + y1 +
      " C " + mx + " " + y1 + " " + mx + " " + y2 + " " + x2 + " " + y2;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "edge-path");
    path.setAttribute("d", d);
    path.setAttribute("stroke", "var(--vscode-editor-foreground)");
    path.setAttribute("stroke-opacity", "0.45");
    path.setAttribute("stroke-width", "1.4");
    path.setAttribute("marker-end", "url(#arrow)");
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = edges[e].from + " → " + edges[e].to +
      "  (" + (edges[e].label || edges[e].via || "") + ")";
    path.appendChild(title);
    edgeLayer.appendChild(path);

    // Edge origin label (option text / immediate / on_actions …) at the midpoint.
    if (edges[e].label) {
      const elabel = document.createElementNS(SVG_NS, "text");
      elabel.setAttribute("class", "edge-label");
      elabel.setAttribute("x", String(mx));
      elabel.setAttribute("y", String((y1 + y2) / 2 - 4));
      elabel.setAttribute("text-anchor", "middle");
      elabel.textContent = edges[e].label;
      edgeLayer.appendChild(elabel);
    }
  }

  // nodes
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const p = pos.get(node.id);
    if (!p) continue;
    const isRoot = rootId != null && node.id === rootId;

    const ng = document.createElementNS(SVG_NS, "g");
    ng.setAttribute("transform", "translate(" + (p.x - NODE_W / 2) + "," + (p.y - NODE_H / 2) + ")");

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("class", "node-rect");
    rect.setAttribute("width", String(NODE_W));
    rect.setAttribute("height", String(NODE_H));
    rect.setAttribute("rx", "8");
    rect.setAttribute("ry", "8");
    rect.setAttribute("fill", kindFill(node.kind));
    rect.setAttribute("fill-opacity", isRoot ? "0.95" : "0.75");
    rect.setAttribute("stroke", isRoot
      ? "var(--vscode-focusBorder, #007fd4)"
      : "var(--vscode-editor-foreground)");
    rect.setAttribute("stroke-width", isRoot ? "3" : "1.5");
    rect.setAttribute("stroke-dasharray", sourceDash(node.source));

    const rtitle = document.createElementNS(SVG_NS, "title");
    rtitle.textContent = node.id + (node.title ? " — " + node.title : "") +
      "  [" + node.kind + " · " + node.source + "]" +
      (node.file ? "\\n" + node.file + (node.line ? ":" + node.line : "") : "") +
      "\\nclick: inspect · double-click: open source · right-click: refocus";
    rect.appendChild(rtitle);
    ng.appendChild(rect);
    nodeRects.set(node.id, { rect: rect, node: node });

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("class", "node-label");
    label.setAttribute("x", String(NODE_W / 2));
    label.setAttribute("y", String(node.title ? NODE_H / 2 - 2 : NODE_H / 2 + 4));
    label.setAttribute("text-anchor", "middle");
    let text = node.id;
    if (text.length > 20) text = text.slice(0, 19) + "…";
    label.textContent = text;
    ng.appendChild(label);

    // Second line: the event's localized title, dimmed.
    if (node.title) {
      const sub = document.createElementNS(SVG_NS, "text");
      sub.setAttribute("class", "node-label node-sub");
      sub.setAttribute("x", String(NODE_W / 2));
      sub.setAttribute("y", String(NODE_H / 2 + 12));
      sub.setAttribute("text-anchor", "middle");
      let t = node.title;
      if (t.length > 24) t = t.slice(0, 23) + "…";
      sub.textContent = t;
      ng.appendChild(sub);
    }

    ng.addEventListener("click", function (ev) {
      ev.stopPropagation();
      // Ctrl/Cmd+click opens the source directly; plain click inspects.
      if ((ev.ctrlKey || ev.metaKey) && node.file) {
        vscode.postMessage({ type: "open", file: node.file, line: node.line });
        return;
      }
      selectNode(node.id, rect);
    });
    ng.addEventListener("dblclick", function (ev) {
      ev.stopPropagation();
      if (node.file) vscode.postMessage({ type: "open", file: node.file, line: node.line });
    });
    ng.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      vscode.postMessage({ type: "refocus", id: node.id });
    });

    g.appendChild(ng);
  }

  fitToView(pos);
  applyTransform(g);

  let status = nodes.length + " nodes · " + edges.length + " edges";
  if (params && params.namespace) status += " · namespace " + params.namespace;
  if (params && params.root) status += " · root " + params.root;
  if (graph.truncated) {
    setStatus(status + " · ⚠ truncated (increase maxNodes to see more)", "warn");
  } else {
    setStatus(status, "");
  }
}

function fitToView(pos) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pos.forEach(function (p) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });
  if (!isFinite(minX)) { view = { x: 40, y: 40, scale: 1 }; return; }
  const graphW = (maxX - minX) + NODE_W + 80;
  const graphH = (maxY - minY) + NODE_H + 80;
  const rect = svg.getBoundingClientRect();
  const vw = rect.width || 800, vh = rect.height || 600;
  const scale = Math.min(1.2, Math.max(0.2, Math.min(vw / graphW, vh / graphH)));
  view.scale = scale;
  view.x = vw / 2 - ((minX + maxX) / 2) * scale;
  view.y = vh / 2 - ((minY + maxY) / 2) * scale;
}

// --- pan + zoom ---
let dragging = false, dragStart = null;
svg.addEventListener("mousedown", function (ev) {
  if (ev.button !== 0) return;
  dragging = true;
  dragStart = { x: ev.clientX - view.x, y: ev.clientY - view.y };
  svg.classList.add("dragging");
});
window.addEventListener("mousemove", function (ev) {
  if (!dragging || !rootGroup) return;
  view.x = ev.clientX - dragStart.x;
  view.y = ev.clientY - dragStart.y;
  applyTransform(rootGroup);
});
window.addEventListener("mouseup", function () {
  dragging = false;
  svg.classList.remove("dragging");
});
svg.addEventListener("wheel", function (ev) {
  ev.preventDefault();
  if (!rootGroup) return;
  const rect = svg.getBoundingClientRect();
  const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
  const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
  const newScale = Math.min(4, Math.max(0.1, view.scale * factor));
  // zoom about cursor
  view.x = mx - (mx - view.x) * (newScale / view.scale);
  view.y = my - (my - view.y) * (newScale / view.scale);
  view.scale = newScale;
  applyTransform(rootGroup);
}, { passive: false });

// --- toolbar ---
function parseQuery() {
  const raw = queryEl.value.trim();
  const base = { maxNodes: currentParams && currentParams.maxNodes };
  if (raw === "") return base;
  // A '.' in CK3 event ids marks a namespaced id (namespace.number) -> root.
  if (raw.indexOf(".") >= 0) return Object.assign(base, { root: raw });
  return Object.assign(base, { namespace: raw });
}
let currentParams = {};
document.getElementById("go").addEventListener("click", function () {
  vscode.postMessage({ type: "fetch", params: parseQuery() });
});
queryEl.addEventListener("keydown", function (ev) {
  if (ev.key === "Enter") vscode.postMessage({ type: "fetch", params: parseQuery() });
});

// Live highlight: typing matches loaded nodes by id OR localized title.
const nodeRects = new Map(); // id -> { rect, node }
queryEl.addEventListener("input", function () {
  const q = queryEl.value.trim().toLowerCase();
  nodeRects.forEach(function (entry) {
    const hit =
      q.length > 1 &&
      (entry.node.id.toLowerCase().indexOf(q) >= 0 ||
        (entry.node.title || "").toLowerCase().indexOf(q) >= 0);
    entry.rect.classList.toggle("search-hit", hit);
  });
});

document.getElementById("helpBtn").addEventListener("click", function () {
  document.getElementById("help").classList.toggle("show");
});
document.getElementById("showAll").addEventListener("click", function () {
  queryEl.value = "";
  vscode.postMessage({ type: "fetch", params: { maxNodes: 5000 } });
});
document.getElementById("refresh").addEventListener("click", function () {
  vscode.postMessage({ type: "fetch", params: currentParams || {} });
});
document.getElementById("export").addEventListener("click", function () {
  vscode.postMessage({ type: "export", svg: serializeSvg() });
});

function serializeSvg() {
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", SVG_NS);
  // bake a background rect so the exported file is readable standalone
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", "-100000"); bg.setAttribute("y", "-100000");
  bg.setAttribute("width", "200000"); bg.setAttribute("height", "200000");
  bg.setAttribute("fill", getComputedStyle(document.body).backgroundColor || "#1e1e1e");
  clone.insertBefore(bg, clone.firstChild);
  return '<?xml version="1.0" encoding="UTF-8"?>\\n' + new XMLSerializer().serializeToString(clone);
}

// --- inspector -------------------------------------------------------------
const inspectorEl = document.getElementById("inspector");
let selectedId = null;
let selectedRect = null;

function selectNode(id, rect) {
  if (selectedRect) selectedRect.classList.remove("selected-node");
  selectedId = id;
  selectedRect = rect || null;
  if (selectedRect) selectedRect.classList.add("selected-node");
  inspectorEl.classList.add("show");
  inspectorEl.textContent = "Loading " + id + "…";
  vscode.postMessage({ type: "select", id: id });
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function openLink(label, file, line) {
  const a = el("a", "ilink", label);
  a.addEventListener("click", function () {
    vscode.postMessage({ type: "open", file: file, line: (line || 0) + 1 });
  });
  return a;
}

function locRow(container, label, loc, eventId) {
  const row = el("div", "locrow");
  const head = el("div", "k");
  head.textContent = label + (loc && loc.key ? " · " + loc.key : "");
  row.appendChild(head);
  if (!loc) {
    row.appendChild(el("div", "", "—"));
  } else if (loc.dynamic) {
    row.appendChild(el("div", "", "(dynamic — first_valid/triggered_desc; edit in source)"));
  } else {
    const edit = el("div", "edit");
    const input = document.createElement("input");
    input.type = "text";
    input.value = loc.text || "";
    input.placeholder = loc.text === undefined ? "(no localization yet — type and save)" : "";
    const save = el("button", "", "Save");
    save.addEventListener("click", function () {
      vscode.postMessage({ type: "editLoc", id: eventId, key: loc.key, value: input.value, file: loc.file, line: loc.line });
      save.textContent = "…";
    });
    input.addEventListener("keydown", function (ev) { if (ev.key === "Enter") save.click(); });
    edit.appendChild(input);
    edit.appendChild(save);
    row.appendChild(edit);
  }
  container.appendChild(row);
}

const REF_KIND_LABEL = {
  saved_scope: "scope",
  variable: "variable",
  scripted_effect: "effect",
  scripted_trigger: "trigger",
  script_value: "value",
  event: "event",
};

function renderDetail(detail) {
  inspectorEl.textContent = "";
  if (!detail) {
    inspectorEl.appendChild(el("div", "", "No details for " + (selectedId || "?") + " (vanilla-only or not an event)."));
    return;
  }
  inspectorEl.appendChild(el("h2", "", detail.id));

  const badges = el("div", "badges");
  if (detail.type) badges.appendChild(el("span", "badge", detail.type));
  if (detail.theme) badges.appendChild(el("span", "badge", "theme: " + detail.theme));
  if (detail.hidden) badges.appendChild(el("span", "badge", "hidden"));
  inspectorEl.appendChild(badges);

  const actions = el("div", "badges");
  actions.appendChild(openLink("Open source (" + ((detail.line || 0) + 1) + ")", detail.file, detail.line));
  inspectorEl.appendChild(actions);

  inspectorEl.appendChild(el("h3", "", "Text"));
  locRow(inspectorEl, "Title", detail.title, detail.id);
  locRow(inspectorEl, "Description", detail.desc, detail.id);

  if (detail.sections.length > 0) {
    inspectorEl.appendChild(el("h3", "", "Logic"));
    for (const s of detail.sections) {
      const row = el("div", "locrow");
      row.appendChild(openLink(s.name, detail.file, s.line));
      const chips = el("div", "chips");
      for (const k of s.keys) chips.appendChild(el("span", "chip", k));
      row.appendChild(chips);
      inspectorEl.appendChild(row);
    }
  }

  inspectorEl.appendChild(el("h3", "", "Options (" + detail.options.length + ")"));
  detail.options.forEach(function (opt, i) {
    const card = el("div", "optcard");
    const head = el("div", "");
    head.appendChild(openLink("option " + (i + 1), detail.file, opt.line));
    if (opt.hasTrigger) head.appendChild(el("span", "chip", " trigger"));
    if (opt.hasAiChance) head.appendChild(el("span", "chip", " ai_chance"));
    card.appendChild(head);
    locRow(card, "Text", opt.name, detail.id);
    if (opt.effectKeys.length > 0) {
      const chips = el("div", "chips");
      for (const k of opt.effectKeys) chips.appendChild(el("span", "chip", k));
      card.appendChild(chips);
    }
    inspectorEl.appendChild(card);
  });
  const addBtn = el("button", "act", "+ Add option");
  addBtn.addEventListener("click", function () {
    vscode.postMessage({
      type: "addOption",
      id: detail.id,
      file: detail.file,
      endLine: detail.endLine,
      count: detail.options.length,
    });
  });
  inspectorEl.appendChild(addBtn);

  if (detail.refs.length > 0) {
    inspectorEl.appendChild(el("h3", "", "References (" + detail.refs.length + ")"));
    const order = ["saved_scope", "variable", "scripted_effect", "scripted_trigger", "script_value", "event"];
    order.forEach(function (kind) {
      detail.refs.filter(function (r) { return r.kind === kind; }).forEach(function (r) {
        const row = el("div", "refrow");
        row.appendChild(el("span", "kind", REF_KIND_LABEL[kind] || kind));
        if (r.defFile) {
          row.appendChild(openLink(r.name, r.defFile, r.defLine));
          if (r.defCount && r.defCount > 1) row.appendChild(el("span", "kind", r.defCount + " sites"));
        } else {
          row.appendChild(openLink(r.name, detail.file, r.line));
        }
        row.appendChild(el("span", "kind", "used @" + (r.line + 1)));
        inspectorEl.appendChild(row);
      });
    });
  }
}

// --- host messages ---
window.addEventListener("message", function (ev) {
  const msg = ev.data;
  if (!msg) return;
  if (msg.type === "loading") {
    setStatus("Loading…", "");
    return;
  }
  if (msg.type === "error") {
    emptyEl.classList.remove("show");
    setStatus("Error: " + msg.message, "error");
    return;
  }
  if (msg.type === "detail") {
    if (msg.id !== selectedId) return; // stale
    try {
      renderDetail(msg.detail);
    } catch (e) {
      inspectorEl.textContent = "Inspector error: " + (e && e.message ? e.message : e);
    }
    return;
  }
  if (msg.type === "graph") {
    currentParams = msg.params || {};
    if (currentParams.root) queryEl.value = currentParams.root;
    else if (currentParams.namespace) queryEl.value = currentParams.namespace;
    try {
      render(msg.graph, msg.params);
    } catch (e) {
      setStatus("Render error: " + (e && e.message ? e.message : e), "error");
    }
  }
});
</script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
