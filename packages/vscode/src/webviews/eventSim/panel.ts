import * as vscode from "vscode";
import type { EventDetail } from "@px-lsp/protocol/protocol";
import { simulationSteps } from "./steps";

/** Messages the webview sends to the host. */
type InboundMessage =
  | { type: "open"; file: string; line?: number }
  | { type: "step"; id: string }
  | { type: "back" }
  | { type: "reload" };

/** Messages the host sends to the webview. */
type OutboundMessage =
  | { type: "sim"; id: string; detail: EventDetail | null; stack: string[] }
  | { type: "loading"; id: string }
  | { type: "error"; message: string };

/**
 * Singleton event-simulator webview: a static "what happens when this event
 * fires" walkthrough. It lays the event's blocks out in firing order (trigger,
 * immediate, each option, after) with the localized text resolved, and turns
 * every onward event/on_action reference into a step-into link with a
 * breadcrumb trail and a Back control. Nothing runs; nothing is guessed.
 */
export class EventSimPanel {
  private static instance: EventSimPanel | undefined;
  private static readonly viewType = "px.eventSim";

  private readonly panel: vscode.WebviewPanel;
  private readonly fetchDetail: (id: string) => Promise<EventDetail | null>;
  private disposables: vscode.Disposable[] = [];
  /** Events stepped through to get here, oldest first (the Studio's stack). */
  private stack: string[] = [];
  private current = "";
  private disposed = false;

  private constructor(fetchDetail: (id: string) => Promise<EventDetail | null>, id: string) {
    this.fetchDetail = fetchDetail;

    this.panel = vscode.window.createWebviewPanel(
      EventSimPanel.viewType,
      "Paradox Event Simulator",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
    );
    this.panel.webview.html = buildHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      (msg: InboundMessage) => void this.onMessage(msg),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    void this.load(id);
  }

  /** Create or reveal the singleton panel and simulate `id` from a fresh stack. */
  static show(fetchDetail: (id: string) => Promise<EventDetail | null>, id: string): void {
    const inst = EventSimPanel.instance;
    if (inst) {
      inst.panel.reveal(vscode.ViewColumn.Beside);
      inst.stack = [];
      void inst.load(id);
      return;
    }
    EventSimPanel.instance = new EventSimPanel(fetchDetail, id);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    EventSimPanel.instance = undefined;
    for (const d of this.disposables.splice(0)) {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    }
    this.panel.dispose();
  }

  private async load(id: string): Promise<void> {
    this.current = id;
    this.panel.title = `Simulate ${id}`;
    this.post({ type: "loading", id });
    try {
      const detail = await this.fetchDetail(id);
      if (this.disposed || this.current !== id) return;
      this.post({ type: "sim", id, detail, stack: this.stack });
    } catch (err) {
      if (this.disposed) return;
      this.post({ type: "error", message: err instanceof Error ? err.message : String(err) });
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
      case "step":
        this.stack = [...this.stack, this.current];
        await this.load(msg.id);
        break;
      case "back": {
        const prev = this.stack[this.stack.length - 1];
        if (prev === undefined) return;
        this.stack = this.stack.slice(0, -1);
        await this.load(prev);
        break;
      }
      case "reload":
        await this.load(this.current);
        break;
    }
  }

  private async openDocument(file: string, line?: number): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const position = new vscode.Position(Math.max(0, line ?? 0), 0);
      // Open in the text group so the simulator tab stays visible.
      const textGroup = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.scheme === "file"
      )?.viewColumn;
      await vscode.window.showTextDocument(doc, {
        viewColumn: textGroup ?? vscode.ViewColumn.One,
        preserveFocus: true,
        selection: new vscode.Range(position, position),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Paradox Event Simulator: cannot open ${file}: ${message}`);
    }
  }
}

function buildHtml(webview: vscode.Webview): string {
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
  ].join("; ");

  // The tested arrangement function is serialized here so the shipped webview
  // runs exactly the unit-tested code (see steps.ts header).
  const stepsSource = simulationSteps.toString();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Paradox Event Simulator</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
  }
  #app { display: flex; flex-direction: column; height: 100%; }
  #bar {
    display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
    padding: 6px 10px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  }
  #bar button {
    padding: 3px 10px; border: none; border-radius: 2px; cursor: pointer;
    color: var(--vscode-button-foreground); background: var(--vscode-button-background);
  }
  #bar button.secondary {
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
    background: var(--vscode-button-secondaryBackground, transparent);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.4));
  }
  #bar button[disabled] { opacity: 0.45; cursor: default; }
  #chain {
    flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--vscode-descriptionForeground);
  }
  #body { flex: 1 1 auto; overflow-y: auto; padding: 10px 14px 24px; }
  h1 { margin: 0 0 2px; font-size: 1.25em; word-break: break-all; }
  #subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
  .badges { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 4px 0 10px; }
  .badge {
    padding: 0 7px; border-radius: 8px; font-size: 0.85em;
    color: var(--vscode-badge-foreground, #fff); background: var(--vscode-badge-background, #4d4d4d);
  }
  .ilink { color: var(--vscode-textLink-foreground, #3794ff); cursor: pointer; text-decoration: none; }
  .ilink:hover { text-decoration: underline; }
  .step {
    margin: 10px 0; border-radius: 4px; overflow: hidden;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
  }
  .step > header {
    display: flex; align-items: baseline; gap: 8px; cursor: pointer;
    padding: 5px 9px;
    background: var(--vscode-editorWidget-background, rgba(128,128,128,0.12));
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
  }
  .step > header:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.2)); }
  .step > header .t { font-weight: 600; letter-spacing: 0.05em; }
  .step > header .s { color: var(--vscode-descriptionForeground); flex: 1 1 auto; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .step > header .at { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .step.trigger > header .t { color: var(--vscode-charts-yellow, #cca700); }
  .step.option > header .t { color: var(--vscode-charts-orange, #d18616); }
  .step.immediate > header .t, .step.after > header .t { color: var(--vscode-charts-blue, #3794ff); }
  .script { padding: 4px 0; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.95em; }
  .script .ln { padding: 0 9px; white-space: pre; cursor: pointer; }
  .script .ln:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.18)); }
  .note, .more { padding: 4px 9px; color: var(--vscode-descriptionForeground); }
  .leads {
    padding: 5px 9px; border-top: 1px dashed var(--vscode-panel-border, rgba(128,128,128,0.3));
  }
  .leads .lbl { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .target { margin: 2px 0; }
  .target .via { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-right: 5px; }
  .fires { margin-left: 18px; }
  .dim { color: var(--vscode-descriptionForeground); }
  #status { padding: 6px 14px; color: var(--vscode-descriptionForeground); }
  #status.error { color: var(--vscode-editorError-foreground, #f14c4c); }
</style>
</head>
<body>
<div id="app">
  <div id="bar">
    <button id="back" class="secondary" disabled>&lsaquo; Back</button>
    <button id="reload" class="secondary">Reload</button>
    <span id="chain"></span>
  </div>
  <div id="body"><div id="status">Loading…</div></div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

// === Shipped arrangement: exact source of the unit-tested simulationSteps ===
const simulationSteps = ${stepsSource};

const bodyEl = document.getElementById("body");
const chainEl = document.getElementById("chain");
const backEl = document.getElementById("back");

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function openLink(label, file, line, cls) {
  const a = el("a", cls || "ilink", label);
  a.addEventListener("click", function (ev) {
    ev.stopPropagation();
    vscode.postMessage({ type: "open", file: file, line: line || 0 });
  });
  return a;
}

function status(text, cls) {
  bodyEl.textContent = "";
  bodyEl.appendChild(el("div", cls ? "error" : "", text)).id = "status";
}

function renderTarget(container, target, indent) {
  const row = el("div", indent ? "target fires" : "target");
  row.appendChild(el("span", "via", target.via));
  if (target.kind === "event") {
    const link = el("a", "ilink", "▶ " + target.name);
    link.title = "Step into " + target.name + " (Ctrl/Cmd+click opens its source)";
    link.addEventListener("click", function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && target.file) {
        vscode.postMessage({ type: "open", file: target.file, line: target.defLine || 0 });
        return;
      }
      vscode.postMessage({ type: "step", id: target.name });
    });
    row.appendChild(link);
  } else if (target.kind === "on_action") {
    row.appendChild(target.file ? openLink(target.name, target.file, target.defLine) : el("span", "", target.name));
    // The server resolves on_actions exactly one level deep, so a chained one
    // is unresolved by design, not because its definition was unreadable.
    if (indent) {
      row.appendChild(el("span", "dim", "  (chained on_action, open it to see what it fires)"));
    } else if (target.fires === undefined) {
      row.appendChild(el("span", "dim", "  (on_action definition not readable, cannot resolve its events)"));
    } else if (target.fires.length === 0) {
      row.appendChild(el("span", "dim", "  (its definition names no events)"));
    }
  } else {
    row.appendChild(el("span", "", target.name));
    row.appendChild(el("span", "dim", "  (not indexed, nothing to step into)"));
  }
  container.appendChild(row);

  if (target.fires && target.fires.length > 0) {
    for (const fired of target.fires) renderTarget(container, fired, true);
    const hidden = (target.firesTotal || 0) - target.fires.length;
    if (hidden > 0) container.appendChild(el("div", "target fires dim", "… " + hidden + " more"));
  }
}

function renderStep(detail, step) {
  const card = el("div", "step " + step.kind);
  const head = el("header");
  head.appendChild(el("span", "t", step.title));
  head.appendChild(el("span", "s", step.subtitle));
  head.appendChild(el("span", "at", "line " + (step.line + 1)));
  head.title = "Open " + detail.file + " at line " + (step.line + 1);
  head.addEventListener("click", function () {
    vscode.postMessage({ type: "open", file: detail.file, line: step.line });
  });
  card.appendChild(head);

  if (step.note) card.appendChild(el("div", "note", step.note));
  if (step.lines.length > 0) {
    const script = el("div", "script");
    for (const line of step.lines) {
      const row = el("div", "ln", "  ".repeat(line.depth) + line.text);
      row.title = "Open line " + (line.line + 1);
      row.addEventListener("click", function () {
        vscode.postMessage({ type: "open", file: detail.file, line: line.line });
      });
      script.appendChild(row);
    }
    card.appendChild(script);
  }
  if (step.hidden > 0) card.appendChild(el("div", "more", "… " + step.hidden + " more lines (open the source to read them)"));

  if (step.targets.length > 0) {
    const leads = el("div", "leads");
    leads.appendChild(el("div", "lbl", "leads to"));
    for (const target of step.targets) renderTarget(leads, target, false);
    if (step.hiddenTargets > 0) leads.appendChild(el("div", "target dim", "… " + step.hiddenTargets + " more"));
    card.appendChild(leads);
  }
  return card;
}

function render(msg) {
  const detail = msg.detail;
  chainEl.textContent = msg.stack.concat([msg.id]).join("  ›  ");
  backEl.disabled = msg.stack.length === 0;
  backEl.textContent = msg.stack.length > 0 ? "‹ Back to " + msg.stack[msg.stack.length - 1] : "‹ Back";

  bodyEl.textContent = "";
  if (!detail) {
    bodyEl.appendChild(el("h1", "", msg.id));
    bodyEl.appendChild(el("div", "note",
      "No indexed event with this id, or its block could not be parsed. Nothing to walk through."));
    return;
  }

  bodyEl.appendChild(el("h1", "", detail.id));
  const titleText = detail.title && detail.title.text
    ? detail.title.text
    : detail.title && detail.title.dynamic
      ? "(dynamic title, resolved in game)"
      : detail.title && detail.title.key
        ? detail.title.key + " (no localization)"
        : "";
  if (titleText) bodyEl.appendChild(el("div", "", titleText)).id = "subtitle";
  const descText = detail.desc && detail.desc.text ? detail.desc.text : "";
  if (descText) bodyEl.appendChild(el("div", "note", descText));

  const badges = el("div", "badges");
  if (detail.type) badges.appendChild(el("span", "badge", detail.type));
  if (detail.theme) badges.appendChild(el("span", "badge", "theme: " + detail.theme));
  if (detail.hidden) badges.appendChild(el("span", "badge", "hidden"));
  badges.appendChild(openLink("Open source", detail.file, detail.line));
  bodyEl.appendChild(badges);

  const steps = simulationSteps(detail);
  for (const step of steps) bodyEl.appendChild(renderStep(detail, step));
}

backEl.addEventListener("click", function () { vscode.postMessage({ type: "back" }); });
document.getElementById("reload").addEventListener("click", function () {
  vscode.postMessage({ type: "reload" });
});

window.addEventListener("message", function (ev) {
  const msg = ev.data;
  if (!msg) return;
  if (msg.type === "loading") { status("Loading " + msg.id + "…"); return; }
  if (msg.type === "error") { status("Error: " + msg.message, true); return; }
  if (msg.type === "sim") {
    try {
      render(msg);
    } catch (e) {
      status("Render error: " + (e && e.message ? e.message : e), true);
    }
  }
});
</script>
</body>
</html>`;
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
