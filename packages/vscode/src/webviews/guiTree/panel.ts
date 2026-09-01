import * as vscode from "vscode";
import type { GuiTree } from "@px-lsp/protocol/protocol";
import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";
import { makeNonce } from "../nonce";
import { tipScript } from "../shared/tips";
import { tabIcon } from "../tabIcons";

/** Messages the webview sends to the host. */
type InboundMessage = { type: "open"; line: number; focus?: boolean } | { type: "refresh" };

/** Messages the host sends to the webview. */
type OutboundMessage =
  | { type: "tree"; tree: GuiTree; file: string }
  | { type: "error"; message: string }
  | { type: "loading" }
  | { type: "toggleParents" };

/**
 * Singleton GUI widget-tree webview: the .gui file's widget hierarchy as a
 * collapsible tree — type badges, names, template uses — with click-to-jump,
 * filtering, and auto-refresh on save.
 */
export class GuiTreePanel {
  private static instance: GuiTreePanel | undefined;
  private static readonly viewType = "px.guiTree";

  private readonly panel: vscode.WebviewPanel;
  private readonly fetchTree: (uri: vscode.Uri, text: string) => Promise<GuiTree>;
  private disposables: vscode.Disposable[] = [];
  private sourceUri: vscode.Uri;
  private disposed = false;
  /** Transient whole-line highlight marking the clicked widget in the source. */
  private readonly lineHighlight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
    overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.rangeHighlightForeground"),
    overviewRulerLane: vscode.OverviewRulerLane.Full,
  });
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    fetchTree: (uri: vscode.Uri, text: string) => Promise<GuiTree>,
    source: vscode.TextDocument
  ) {
    this.fetchTree = fetchTree;
    this.sourceUri = source.uri;

    this.panel = vscode.window.createWebviewPanel(
      GuiTreePanel.viewType,
      "GUI Tree",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
    );
    this.panel.iconPath = tabIcon("gui-tree");
    this.panel.webview.html = buildHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      (msg: InboundMessage) => void this.onMessage(msg),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    // Rebuild on save of the source file.
    vscode.workspace.onDidSaveTextDocument(
      (doc) => {
        if (doc.uri.toString() === this.sourceUri.toString()) void this.load(doc);
      },
      undefined,
      this.disposables
    );

    void this.load(source);
  }

  /** Create or reveal the singleton panel and load the tree for `source`. */
  static show(
    fetchTree: (uri: vscode.Uri, text: string) => Promise<GuiTree>,
    source: vscode.TextDocument
  ): void {
    if (GuiTreePanel.instance) {
      const inst = GuiTreePanel.instance;
      inst.sourceUri = source.uri;
      inst.panel.reveal(undefined, true);
      void inst.load(source);
      return;
    }
    GuiTreePanel.instance = new GuiTreePanel(fetchTree, source);
  }

  /** `px.guiTreeToggleParents`: flip the ancestors toggle in the live panel. */
  static toggleParents(): void {
    GuiTreePanel.instance?.post({ type: "toggleParents" });
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    GuiTreePanel.instance = undefined;
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.lineHighlight.dispose();
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
    this.post({ type: "loading" });
    this.panel.title = `GUI Tree - ${source.uri.path.split("/").pop() ?? "gui"}`;
    try {
      const tree = await this.fetchTree(source.uri, source.getText());
      if (this.disposed) return;
      this.post({ type: "tree", tree, file: source.uri.fsPath });
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
    if (msg.type === "open") {
      try {
        const doc = await vscode.workspace.openTextDocument(this.sourceUri);
        const line = Math.min(Math.max(0, msg.line), doc.lineCount - 1);
        const position = new vscode.Position(line, 0);
        // Single click previews (focus stays in the tree, so hotkeys keep
        // working); double click hands focus to the editor.
        const editor = await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: msg.focus !== true,
          selection: new vscode.Range(position, position),
        });
        // Flash the widget's line so the eye lands on it even in a busy file;
        // the decoration fades instead of lingering as a stale marker.
        editor.setDecorations(this.lineHighlight, [doc.lineAt(line).range]);
        if (this.highlightTimer) clearTimeout(this.highlightTimer);
        this.highlightTimer = setTimeout(() => {
          if (!this.disposed) editor.setDecorations(this.lineHighlight, []);
        }, 1400);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Paradox GUI Tree: cannot open source: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return;
    }
    if (msg.type === "refresh") {
      try {
        const doc = await vscode.workspace.openTextDocument(this.sourceUri);
        await this.load(doc);
      } catch (err) {
        this.post({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
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
  ].join("; ");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>GUI Tree</title>
<style>
${uiCss}
  body { overflow: hidden; }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #toolbar .px-input-group { flex: 1 1 auto; min-width: 80px; }
  #toolbar .px-separator { height: 20px; align-self: center; }
  #tree { flex: 1 1 auto; overflow: auto; padding: 4px; }
  #status {
    flex: 0 0 auto; padding: 4px 10px; font-size: var(--px-text-xs); color: var(--px-muted-fg);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  ul.branch { list-style: none; margin: 0; padding-left: 16px; }
  #tree > ul.branch { padding-left: 0; }
  .row { padding-left: 4px; white-space: nowrap; }
  .twist { display: flex; flex: 0 0 auto; width: 16px; height: 16px; border-radius: var(--px-radius-sm); color: var(--px-muted-fg); }
  .twist[data-leaf] { visibility: hidden; }
  .twist > .caret { transition: transform var(--px-ease); }
  .row[data-open] > .twist > .caret { transform: rotate(90deg); }
  .px-badge[data-kind="decl"] { font-family: var(--px-font-mono); }
  .wname { font-weight: 600; }
  .meta { color: var(--px-muted-fg); font-size: var(--px-text-sm); }
  .hidden { display: none; }
  /* Filtering without parents flattens the indentation of the matches. */
  #tree.noparents ul.branch { padding-left: 0; }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <div class="px-input-group">${icon("search")}<input id="filter" class="px-input" data-size="sm" placeholder="Filter by type or name (/)" spellcheck="false" /></div>
    <button id="ancestors" class="px-toggle" data-size="sm" aria-pressed="true" data-tip="Hide ancestors" data-tip-wrap>${icon("listFilter")}</button>
    <div class="px-separator" data-orientation="vertical"></div>
    <button id="expand" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Expand all">${icon("chevronsUpDown")}</button>
    <button id="collapse" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Collapse all">${icon("chevronsDownUp")}</button>
    <button id="refresh" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="Rebuild the tree from the file" data-tip-side="left">${icon("rotate")}</button>
  </div>
  <div id="tree"></div>
  <div id="status">Loading…</div>
</div>
${tipScript(nonce)}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const ICON_CARET = ${JSON.stringify(icon("chevronRight", "px-icon caret"))};
const treeEl = document.getElementById("tree");
const statusEl = document.getElementById("status");
const filterEl = document.getElementById("filter");
const ancestorsBtn = document.getElementById("ancestors");

// One button, two contexts: while filtering it flattens matches (hideAncestors,
// the #1 behavior, on by default); in the idle tree it focuses on the selected
// node's subtree. The focus ROOT is pinned separately from the selection, so
// clicking around INSIDE the focused subtree navigates without re-narrowing
// the view; press h on a deeper node to re-focus there, Esc to zoom back out.
let hideAncestors = true;
let focusLine = null;
let selectedLine = null;

function rowFor(line) {
  return line === null ? null : treeEl.querySelector('.row[data-line="' + line + '"]');
}
function selectedRow() {
  return rowFor(selectedLine);
}

function updateSelection() {
  treeEl.querySelectorAll('.row[aria-selected="true"]').forEach((r) => r.removeAttribute("aria-selected"));
  const row = selectedRow();
  if (row) row.setAttribute("aria-selected", "true");
  else selectedLine = null;
}

function setOpen(ul, open) {
  ul.classList.toggle("hidden", !open);
  ul.parentElement.firstElementChild.toggleAttribute("data-open", open);
}

function renderNode(node) {
  const li = document.createElement("li");
  const row = document.createElement("div");
  row.className = "px-item row";
  row.dataset.line = String(node.line);
  row.dataset.text = (node.key + " " + (node.name || "") + " " + (node.base || "")).toLowerCase();
  if (node.children.length > 0) row.setAttribute("data-open", "");

  const twist = document.createElement("span");
  twist.className = "twist";
  twist.innerHTML = ICON_CARET;
  if (node.children.length === 0) twist.setAttribute("data-leaf", "");
  row.appendChild(twist);

  const badge = document.createElement("span");
  badge.className = "px-badge";
  badge.dataset.variant = node.kind === "widget" ? "secondary" : "outline";
  badge.dataset.kind = node.kind;
  badge.textContent = node.key + (node.base ? " : " + node.base : "");
  row.appendChild(badge);

  if (node.name) {
    const name = document.createElement("span");
    name.className = "wname";
    name.textContent = node.name;
    row.appendChild(name);
  }
  const metaBits = [];
  if (node.using && node.using.length) metaBits.push("using " + node.using.join(", "));
  if (node.children.length > 0) metaBits.push(node.children.length + " children");
  if (metaBits.length) {
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = metaBits.join(" · ");
    row.appendChild(meta);
  }

  row.addEventListener("click", (ev) => {
    ev.stopPropagation();
    selectedLine = node.line;
    updateSelection();
    // Safe inside a focused subtree: visibility keys off the pinned focusLine,
    // not the selection, so this only refreshes the toolbar state.
    applyFilter();
    vscode.postMessage({ type: "open", line: node.line });
  });
  row.addEventListener("dblclick", (ev) => {
    ev.stopPropagation();
    vscode.postMessage({ type: "open", line: node.line, focus: true });
  });

  li.appendChild(row);
  if (node.children.length > 0) {
    const ul = document.createElement("ul");
    ul.className = "branch";
    for (const child of node.children) ul.appendChild(renderNode(child));
    li.appendChild(ul);
    twist.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setOpen(ul, ul.classList.contains("hidden"));
    });
  }
  return li;
}

function render(tree, file) {
  treeEl.textContent = "";
  if (!tree.nodes.length) {
    statusEl.textContent = "No widgets found in " + file;
    return;
  }
  const ul = document.createElement("ul");
  ul.className = "branch";
  for (const node of tree.nodes) ul.appendChild(renderNode(node));
  treeEl.appendChild(ul);
  statusEl.textContent = tree.count + " widgets · " + file;
}

function applyFilter() {
  const q = filterEl.value.trim().toLowerCase();
  const rows = treeEl.querySelectorAll(".row");
  const focusRoot = rowFor(focusLine);
  if (focusRoot === null) focusLine = null;
  ancestorsBtn.disabled = !q && !selectedRow() && !focusRoot;
  const active = q ? hideAncestors : !!focusRoot;
  ancestorsBtn.setAttribute("aria-pressed", String(active));
  ancestorsBtn.dataset.tip = q
    ? "Show only the filter matches, without their ancestor rows (h)"
    : focusRoot
      ? "Focused on this subtree. Click around inside it freely; h on a node re-focuses there, Esc zooms back out."
      : selectedRow()
        ? "Show only the selected node's subtree (h); clicks inside keep the focus"
        : "Type a filter or select a node first (h)";
  treeEl.classList.toggle("noparents", !!q && hideAncestors);
  if (!q) {
    rows.forEach((r) => { r.classList.remove("hidden"); r.parentElement.classList.remove("hidden"); });
    if (focusRoot) {
      // Focus mode: the pinned subtree only; the selection may move within it.
      rows.forEach((r) => r.classList.add("hidden"));
      focusRoot.parentElement.querySelectorAll(".row").forEach((r) => r.classList.remove("hidden"));
      focusRoot.classList.remove("hidden");
    }
    return;
  }
  if (!hideAncestors) {
    // Matches in their place, ancestors kept for context.
    rows.forEach((r) => { r.classList.remove("hidden"); r.parentElement.classList.add("hidden"); });
    rows.forEach((r) => {
      if (r.dataset.text.indexOf(q) >= 0) {
        let el = r.parentElement;
        while (el && el !== treeEl) {
          if (el.tagName === "LI") el.classList.remove("hidden");
          if (el.tagName === "UL") el.classList.remove("hidden");
          el = el.parentElement;
        }
      }
    });
    return;
  }
  // Default: matches only, no parent rows (#1). Non-matching rows hide
  // individually while their subtree containers stay open, so matched
  // descendants render as a flat result list.
  rows.forEach((r) => {
    r.parentElement.classList.remove("hidden");
    r.classList.toggle("hidden", r.dataset.text.indexOf(q) < 0);
  });
  treeEl.querySelectorAll("ul.branch").forEach((ul) => ul.classList.remove("hidden"));
}

function toggleAncestors() {
  if (filterEl.value.trim() !== "") {
    hideAncestors = !hideAncestors;
  } else if (selectedLine !== null && selectedLine !== focusLine) {
    // Focus (or re-focus deeper) on the selected node's subtree.
    focusLine = selectedLine;
  } else if (focusLine !== null) {
    focusLine = null;
  } else {
    return;
  }
  applyFilter();
}

// Middle-mouse drag scrolls the tree, which is what panning means here: the
// same gesture as the event graph and the designer canvas. preventDefault on
// the press and the auxclick suppresses the browser's own autoscroll.
// Pointer capture rather than window listeners: a release OUTSIDE the webview
// never delivers a window mouseup, which left the grabbing cursor stuck.
let panFrom = null;
treeEl.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 1) return;
  ev.preventDefault();
  panFrom = { x: ev.clientX, y: ev.clientY, left: treeEl.scrollLeft, top: treeEl.scrollTop };
  treeEl.setPointerCapture(ev.pointerId);
  treeEl.style.cursor = "grabbing";
});
treeEl.addEventListener("pointermove", (ev) => {
  if (!panFrom) return;
  treeEl.scrollLeft = panFrom.left - (ev.clientX - panFrom.x);
  treeEl.scrollTop = panFrom.top - (ev.clientY - panFrom.y);
});
const endPan = (ev) => {
  if (!panFrom) return;
  panFrom = null;
  treeEl.style.cursor = "";
  if (treeEl.hasPointerCapture(ev.pointerId)) treeEl.releasePointerCapture(ev.pointerId);
};
treeEl.addEventListener("pointerup", endPan);
treeEl.addEventListener("pointercancel", endPan);
treeEl.addEventListener("auxclick", (ev) => {
  if (ev.button === 1) ev.preventDefault();
});

filterEl.addEventListener("input", applyFilter);
ancestorsBtn.addEventListener("click", toggleAncestors);
window.addEventListener("keydown", (ev) => {
  if (ev.target === filterEl) {
    if (ev.key === "Escape") { filterEl.value = ""; applyFilter(); filterEl.blur(); }
    return;
  }
  if (ev.key === "h" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    ev.preventDefault();
    toggleAncestors();
  } else if (ev.key === "/") {
    ev.preventDefault();
    filterEl.focus();
  } else if (ev.key === "Escape") {
    // First Esc zooms back out of the focused subtree, second clears selection.
    if (focusLine !== null) focusLine = null;
    else selectedLine = null;
    updateSelection();
    applyFilter();
  }
});
document.getElementById("expand").addEventListener("click", () => {
  treeEl.querySelectorAll("#tree > ul.branch ul.branch").forEach((ul) => setOpen(ul, true));
});
document.getElementById("collapse").addEventListener("click", () => {
  treeEl.querySelectorAll("#tree > ul.branch ul.branch").forEach((ul) => setOpen(ul, false));
});
document.getElementById("refresh").addEventListener("click", () => vscode.postMessage({ type: "refresh" }));

window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg) return;
  if (msg.type === "loading") statusEl.textContent = "Loading…";
  else if (msg.type === "error") statusEl.textContent = "Error: " + msg.message;
  else if (msg.type === "tree") { render(msg.tree, msg.file); updateSelection(); applyFilter(); }
  else if (msg.type === "toggleParents") toggleAncestors();
});
</script>
</body>
</html>`;
}
