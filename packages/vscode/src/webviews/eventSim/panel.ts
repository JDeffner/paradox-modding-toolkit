import * as vscode from "vscode";
import type { EventDetail } from "@px-lsp/protocol/protocol";
import { simulationSteps } from "./steps";
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";
import { makeNonce } from "../nonce";
import { tabIcon } from "../tabIcons";

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
    this.panel.iconPath = tabIcon("event-sim");
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
${uiCss}
  body { overflow: hidden; }
  #app { display: flex; flex-direction: column; height: 100%; }
  #bar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #bar .px-separator { height: 20px; align-self: center; }
  #chain { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 4px; overflow: hidden; }
  #chain > span { white-space: nowrap; }
  #chain > .crumb { color: var(--px-muted-fg); }
  #chain > .here { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
  #chain > svg.px-icon { width: 12px; height: 12px; color: var(--px-muted-fg); }
  #body { flex: 1 1 auto; overflow-y: auto; padding: 10px 12px 24px; }
  h1 { margin: 0 0 2px; font-size: 15px; font-weight: 600; word-break: break-all; }
  #subtitle { color: var(--px-muted-fg); margin-bottom: 6px; }
  .badges { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 6px 0 12px; }
  .step { margin: 4px 0; }
  .step > .px-panel-title { padding-left: 4px; cursor: pointer; border-radius: var(--px-radius-md); transition: background-color var(--px-ease); }
  .step > .px-panel-title:hover { background: var(--px-muted); }
  .step > .px-panel-title .caret { transition: transform var(--px-ease); color: var(--px-muted-fg); }
  .step[data-collapsed] > .px-panel-title .caret { transform: rotate(-90deg); }
  .step[data-collapsed] > .step-body { display: none; }
  .step > .px-panel-title .t { color: var(--px-fg); }
  .step > .px-panel-title .s { flex: 1 1 auto; min-width: 0; font-weight: 400; text-transform: none; letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .step > .px-panel-title .at { font-weight: 400; text-transform: none; letter-spacing: 0; }
  .step-body { padding: 0 0 4px 10px; }
  .script { padding: 2px 0; font-family: var(--px-font-mono); font-size: var(--px-text-sm); }
  .script .ln {
    padding: 1px 8px; white-space: pre; cursor: pointer; border-radius: var(--px-radius-sm);
    transition: background-color var(--px-ease);
  }
  .script .ln:hover { background: var(--px-muted); }
  .note, .more { padding: 4px 8px; color: var(--px-muted-fg); }
  .leads { padding: 4px 0 2px; }
  .target { display: flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 8px; }
  .target .via { color: var(--px-muted-fg); font-size: var(--px-text-xs); flex: 0 0 auto; }
  .fires { margin-left: 18px; }
  .dim { color: var(--px-muted-fg); }
  .target .px-btn[data-variant="link"] { font-weight: 500; }
  .target .px-btn[data-variant="link"] svg.px-icon { width: 12px; height: 12px; color: var(--px-muted-fg); }
  #status { padding: 6px 4px; color: var(--px-muted-fg); }
  #status.error { color: var(--px-destructive); }
</style>
</head>
<body>
<div id="app">
  <div id="bar">
    <button id="back" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Back" disabled>${icon("chevronLeft")}</button>
    <button id="reload" class="px-btn" data-variant="ghost" data-size="icon" data-tip="Reload this event from the index">${icon("rotate")}</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <div id="chain"></div>
  </div>
  <div id="body"><div id="status">Loading…</div></div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

// === Shipped arrangement: exact source of the unit-tested simulationSteps ===
const simulationSteps = ${stepsSource};

const ICON_CARET = ${JSON.stringify(icon("chevronDown", "px-icon caret"))};
const ICON_STEP = ${JSON.stringify(icon("cornerDownRight"))};
const ICON_CRUMB = ${JSON.stringify(icon("chevronRight"))};

const bodyEl = document.getElementById("body");
const chainEl = document.getElementById("chain");
const backEl = document.getElementById("back");

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function linkButton(label, iconSvg) {
  const b = el("button", "px-btn");
  b.dataset.variant = "link";
  if (iconSvg) b.innerHTML = iconSvg;
  b.appendChild(el("span", "", label));
  return b;
}

function openLink(label, file, line) {
  const b = linkButton(label);
  b.addEventListener("click", function (ev) {
    ev.stopPropagation();
    vscode.postMessage({ type: "open", file: file, line: line || 0 });
  });
  return b;
}

function status(text, cls) {
  bodyEl.textContent = "";
  bodyEl.appendChild(el("div", cls ? "error" : "", text)).id = "status";
}

function renderTarget(container, target, indent) {
  const row = el("div", indent ? "target fires" : "target");
  row.appendChild(el("span", "via", target.via));
  if (target.kind === "event") {
    const link = linkButton(target.name, ICON_STEP);
    link.dataset.tip = "Step into " + target.name + " (Ctrl/Cmd+click opens its source)";
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
    // Merged on_action (mod extending vanilla): fires reads one site only.
    if ((target.defCount || 1) > 1) {
      row.appendChild(el("span", "dim", "(1 of " + target.defCount + " definition sites)"));
    }
    // The server resolves on_actions exactly one level deep, so a chained one
    // is unresolved by design, not because its definition was unreadable.
    if (indent) {
      row.appendChild(el("span", "dim", "(chained on_action, open it to see what it fires)"));
    } else if (target.fires === undefined) {
      row.appendChild(el("span", "dim", "(on_action definition not readable, cannot resolve its events)"));
    } else if (target.fires.length === 0) {
      row.appendChild(el("span", "dim", "(its definition names no events)"));
    }
  } else {
    row.appendChild(el("span", "", target.name));
    row.appendChild(el("span", "dim", "(not indexed, nothing to step into)"));
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
  const head = el("div", "px-panel-title");
  head.innerHTML = ICON_CARET;
  head.appendChild(el("span", "t", step.title));
  head.appendChild(el("span", "s", step.subtitle));
  head.appendChild(el("span", "at", "line " + (step.line + 1)));
  head.dataset.tip = "Open " + detail.file + " at line " + (step.line + 1);
  head.dataset.tipWrap = "";
  // The caret folds the section; the rest of the header opens the source.
  head.addEventListener("click", function (ev) {
    if (ev.target.closest(".caret")) {
      card.toggleAttribute("data-collapsed");
      return;
    }
    vscode.postMessage({ type: "open", file: detail.file, line: step.line });
  });
  card.appendChild(head);
  const body = el("div", "step-body");
  card.appendChild(body);

  if (step.note) body.appendChild(el("div", "note", step.note));
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
    body.appendChild(script);
  }
  if (step.hidden > 0) body.appendChild(el("div", "more", "… " + step.hidden + " more lines (open the source to read them)"));

  if (step.targets.length > 0) {
    const leads = el("div", "leads");
    leads.appendChild(el("div", "px-label", "Leads to")).style.padding = "0 8px";
    for (const target of step.targets) renderTarget(leads, target, false);
    if (step.hiddenTargets > 0) leads.appendChild(el("div", "target dim", "… " + step.hiddenTargets + " more"));
    body.appendChild(leads);
  }
  return card;
}

function badge(text) {
  const b = el("span", "px-badge", text);
  b.dataset.variant = "secondary";
  return b;
}

function render(msg) {
  const detail = msg.detail;
  chainEl.textContent = "";
  msg.stack.forEach(function (id) {
    chainEl.appendChild(el("span", "crumb", id));
    chainEl.insertAdjacentHTML("beforeend", ICON_CRUMB);
  });
  chainEl.appendChild(el("span", "here", msg.id));
  backEl.disabled = msg.stack.length === 0;
  backEl.dataset.tip = msg.stack.length > 0 ? "Back to " + msg.stack[msg.stack.length - 1] : "Back";

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
  const flavorText = detail.flavor && detail.flavor.text ? detail.flavor.text : "";
  if (flavorText) bodyEl.appendChild(el("div", "note", flavorText));

  const badges = el("div", "badges");
  if (detail.type) badges.appendChild(badge(detail.type));
  if (detail.theme) badges.appendChild(badge("theme: " + detail.theme));
  if (detail.hidden) badges.appendChild(badge("hidden"));
  badges.appendChild(openLink("Open source", detail.file, detail.line));
  bodyEl.appendChild(badges);

  const steps = simulationSteps(detail);
  for (const step of steps) bodyEl.appendChild(renderStep(detail, step));
}

// Middle-mouse drag scrolls the walkthrough: the same gesture that pans the
// event graph and the designer canvas, applied to the surface this view pans.
// Pointer capture rather than window listeners: a release OUTSIDE the webview
// never delivers a window mouseup, which left the grabbing cursor stuck.
// preventDefault on the press and the auxclick suppresses the browser's own
// autoscroll, which would fight the drag.
let panFrom = null;
bodyEl.addEventListener("pointerdown", function (ev) {
  if (ev.button !== 1) return;
  ev.preventDefault();
  panFrom = { x: ev.clientX, y: ev.clientY, left: bodyEl.scrollLeft, top: bodyEl.scrollTop };
  bodyEl.setPointerCapture(ev.pointerId);
  bodyEl.style.cursor = "grabbing";
});
bodyEl.addEventListener("pointermove", function (ev) {
  if (!panFrom) return;
  bodyEl.scrollLeft = panFrom.left - (ev.clientX - panFrom.x);
  bodyEl.scrollTop = panFrom.top - (ev.clientY - panFrom.y);
});
function endPan(ev) {
  if (!panFrom) return;
  panFrom = null;
  bodyEl.style.cursor = "";
  if (bodyEl.hasPointerCapture(ev.pointerId)) bodyEl.releasePointerCapture(ev.pointerId);
}
bodyEl.addEventListener("pointerup", endPan);
bodyEl.addEventListener("pointercancel", endPan);
bodyEl.addEventListener("auxclick", function (ev) {
  if (ev.button === 1) ev.preventDefault();
});

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
