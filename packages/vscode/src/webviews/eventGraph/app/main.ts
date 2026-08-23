/**
 * The Event Graph app: wiring only. The canvas is view.ts, the right panel is
 * inspector.ts, the floating walkthrough is simWindow.ts, and the session
 * (focus, node positions, unsaved edits) is history.ts.
 *
 * The rule the whole page follows: nothing is written to disk until Save. Every
 * edit becomes a PendingEdit in the history, undo and redo move through them,
 * and the host only ever receives a `save` with the whole list.
 */
import type { EventGraph, EventGraphParams } from "@px-lsp/protocol/protocol";
import type { AppToHost, HostToApp, UiState } from "../messages";
import { GraphHistory, type GraphState } from "../history";
import { iconEl } from "../../shared/icons";
import { sidePanel } from "../../shared/sidePanel";
import { closePopover, isPopoverAnchor, popover, toast } from "../../shared/overlay";
import { el } from "./dom";
import { GraphView } from "./view";
import { Inspector } from "./inspector";
import { SimWindow } from "./simWindow";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const svg = $<HTMLElement>("graph") as unknown as SVGSVGElement;
const emptyEl = $("empty");
const focusLineEl = $("focusLine");
const infoEl = $("info");
const queryEl = $<HTMLInputElement>("query");
const saveEl = $<HTMLButtonElement>("save");
const undoEl = $<HTMLButtonElement>("undo");
const redoEl = $<HTMLButtonElement>("redo");
const zoomLabelEl = $("zoomLabel");

let ui: UiState = {
  panelWidth: 340,
  panelCollapsed: false,
  railCollapsed: false,
  titleMode: "raw",
  banner: false,
};
let currentGraph: EventGraph | null = null;
let currentParams: EventGraphParams = {};
const hiddenKinds = new Set<string>();

const history = new GraphHistory({ focus: {}, positions: {}, pending: [] });

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const side = sidePanel($("side"), {
  onChange: (s) => {
    ui = { ...ui, panelWidth: s.width, panelCollapsed: s.collapsed };
    saveUi();
    updatePanelToggle();
  },
});
const rail = sidePanel($("rail"), {
  min: 150,
  max: 260,
  width: 172,
  onChange: (s) => {
    ui = { ...ui, railCollapsed: s.collapsed };
    saveUi();
    updateRailToggle();
  },
});

function updatePanelToggle(): void {
  const btn = $("togglePanel");
  btn.replaceChildren(iconEl(side.collapsed ? "panelRightOpen" : "panelRightClose"));
  btn.dataset.tip = side.collapsed ? "Show inspector" : "Hide inspector";
}
function updateRailToggle(): void {
  $("railShow").hidden = !rail.collapsed;
}
$("togglePanel").onclick = () => side.toggle();
$("railHide").onclick = () => rail.toggle(true);
$("railShow").onclick = () => rail.toggle(false);

function saveUi(): void {
  send({ type: "uiState", state: ui });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const view = new GraphView(svg, {
  onSelect: (id) => selectNode(id),
  onOpen: (file, line) => send({ type: "open", file, line }),
  onRefocus: (id) => refocus(id),
  onMove: (id, x, y) => {
    const positions = { ...history.state.positions, [id]: { x, y } };
    history.push(`move ${id}`, { ...history.state, positions });
    afterHistoryChange();
    view.setOptions({ positions });
  },
  onZoom: (percent) => {
    zoomLabelEl.textContent = `${percent}%`;
  },
  onNeedBanner: (theme) => send({ type: "banner", theme }),
});

const inspector = new Inspector($("inspector"), {
  onOpen: (file, line) => send({ type: "open", file, line }),
  onRefocus: (id) => refocus(id),
  onSimulate: (id) => sim.open(id),
  onEdit: (label, edit) => {
    history.pushEdit(label, edit);
    afterHistoryChange();
    // The inspector redraws so the row shows the unsaved value it now holds.
    if (lastDetail && lastDetail.id === selectedId) inspector.render(lastDetail, selectedId, history.pending);
  },
});

const sim = new SimWindow($("sim"), {
  onOpen: (file, line) => send({ type: "open", file, line }),
  onNeedDetail: (id) => send({ type: "simulate", id }),
  onMoved: (x, y) => {
    ui = { ...ui, simX: x, simY: y };
    saveUi();
  },
  onClosed: () => undefined,
});

let selectedId: string | null = null;
let lastDetail: import("@px-lsp/protocol/protocol").EventDetail | null = null;

function selectNode(id: string | null): void {
  selectedId = id;
  lastDetail = null;
  view.setSelected(id);
  updateRailTools();
  if (id === null) {
    inspector.showPlaceholder();
    return;
  }
  if (side.collapsed) side.toggle(false);
  inspector.showLoading(id);
  send({ type: "select", id });
}

function refocus(id: string): void {
  const focus: EventGraphParams = { ...baseParams(), root: id };
  // A refocus is a history step: undo takes the reader back where they were.
  history.push(`focus ${id}`, { ...history.state, focus, positions: {} });
  afterHistoryChange();
  fetchGraph(focus);
}

// ---------------------------------------------------------------------------
// History, save
// ---------------------------------------------------------------------------

function afterHistoryChange(): void {
  const count = history.pendingCount;
  saveEl.disabled = count === 0;
  saveEl.querySelector(".count")!.textContent = String(count);
  saveEl.dataset.tip =
    count === 0
      ? "No changes to save yet. Edits stay in this view until you save them"
      : `Write ${count} change${count === 1 ? "" : "s"} to your mod files`;
  undoEl.disabled = !history.canUndo;
  redoEl.disabled = !history.canRedo;
  undoEl.dataset.tip = history.canUndo ? `Undo ${history.undoLabel}` : "Nothing to undo";
  redoEl.dataset.tip = history.canRedo ? `Redo ${history.redoLabel}` : "Nothing to redo";
  send({ type: "state", state: history.state, dirty: count });
}

/** Put the view back on a state undo, redo or a cancelled close produced. */
function applyState(state: GraphState): void {
  view.setOptions({ positions: state.positions });
  if (lastDetail && selectedId) inspector.render(lastDetail, selectedId, state.pending);
  afterHistoryChange();
  if (!sameFocus(state.focus, currentParams)) fetchGraph(state.focus);
}

function sameFocus(a: EventGraphParams, b: EventGraphParams): boolean {
  return (a.root ?? "") === (b.root ?? "") && (a.namespace ?? "") === (b.namespace ?? "");
}

undoEl.onclick = () => {
  const state = history.undo();
  if (state) applyState(state);
};
redoEl.onclick = () => {
  const state = history.redo();
  if (state) applyState(state);
};
saveEl.onclick = () => {
  if (history.pendingCount === 0) return;
  saveEl.disabled = true;
  send({ type: "save", edits: history.pending });
};

window.addEventListener("keydown", (ev) => {
  const target = ev.target as HTMLElement;
  const typing = target === queryEl || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
    ev.preventDefault();
    saveEl.click();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
    ev.preventDefault();
    if (ev.shiftKey) redoEl.click();
    else undoEl.click();
    return;
  }
  if (typing) return;
  if (ev.key === "+" || ev.key === "=") {
    ev.preventDefault();
    view.zoomBy(1.25);
  } else if (ev.key === "-") {
    ev.preventDefault();
    view.zoomBy(1 / 1.25);
  } else if (ev.key === "0" || ev.key === "f") {
    ev.preventDefault();
    view.fit();
  } else if (ev.key === "Escape") {
    if (sim.isOpen) sim.close();
    else if (selectedId !== null) selectNode(null);
  } else if (ev.key === "/") {
    ev.preventDefault();
    queryEl.focus();
  }
});

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function baseParams(): EventGraphParams {
  return { maxNodes: currentParams.maxNodes, themes: ui.banner };
}
function fetchGraph(params: EventGraphParams): void {
  send({ type: "fetch", params: { ...params, themes: ui.banner } });
}

$("titleRaw").onclick = () => setTitleMode("raw");
$("titleLoc").onclick = () => setTitleMode("loc");
function setTitleMode(mode: "raw" | "loc"): void {
  ui = { ...ui, titleMode: mode };
  saveUi();
  $("titleRaw").setAttribute("aria-pressed", String(mode === "raw"));
  $("titleLoc").setAttribute("aria-pressed", String(mode === "loc"));
  view.setOptions({ titleMode: mode });
}

$("refresh").onclick = () => fetchGraph(currentParams);
$("export").onclick = () => send({ type: "export", svg: view.serializeSvg() });
$("zoomIn").onclick = () => view.zoomBy(1.25);
$("zoomOut").onclick = () => view.zoomBy(1 / 1.25);
$("zoomFit").onclick = () => view.fit();

$("kinds").addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLElement>("button[data-kind]");
  if (!btn) return;
  const kind = btn.dataset.kind ?? "";
  if (hiddenKinds.has(kind)) hiddenKinds.delete(kind);
  else hiddenKinds.add(kind);
  btn.setAttribute("aria-pressed", String(!hiddenKinds.has(kind)));
  view.setHiddenKinds(hiddenKinds);
});

// --- rail tools ---

$("toolSimulate").onclick = () => {
  if (selectedId) sim.open(selectedId);
};
$("toolCenter").onclick = () => {
  if (selectedId) refocus(selectedId);
};
$("toolAll").onclick = () => {
  queryEl.value = "";
  hideSuggest();
  const focus: EventGraphParams = { maxNodes: 5000 };
  history.push("show all nodes", { ...history.state, focus, positions: {} });
  afterHistoryChange();
  fetchGraph(focus);
};
$("toolSource").onclick = () => {
  const node = currentGraph?.nodes.find((n) => n.id === selectedId);
  if (node?.file) send({ type: "open", file: node.file, line: node.line });
};
$("toolBanner").onclick = () => {
  ui = { ...ui, banner: !ui.banner };
  saveUi();
  $("toolBanner").setAttribute("aria-pressed", String(ui.banner));
  view.setOptions({ banner: ui.banner });
  // The themes ride on the graph answer, so turning the layer on needs one
  // more round trip; turning it off does not.
  if (ui.banner) fetchGraph(currentParams);
};

/** Simulate, Center and Source act on a selection; say so instead of failing. */
function updateRailTools(): void {
  const has = selectedId !== null;
  for (const id of ["toolSimulate", "toolCenter", "toolSource"]) {
    $<HTMLButtonElement>(id).disabled = !has;
  }
  $("railHint").textContent = has
    ? `Acting on ${selectedId}.`
    : "Select a card first: Simulate, Center and Source act on it.";
}

$("helpBtn").onclick = () => {
  const anchor = $("helpBtn");
  if (isPopoverAnchor(anchor)) {
    closePopover();
    return;
  }
  const help = el("div", "help");
  help.appendChild(el("div", "px-popover-title", "How to read the graph"));
  const list = el("ul");
  for (const text of [
    "The card in the middle is what you are looking at. What it fires spreads to one side, what fires it to the other, further hops one ring further out.",
    "The colored bar is the kind. Dashed borders are vanilla content, solid is your mod, dotted is a parent mod.",
    "Click a card to focus and inspect it, drag it to move it, double-click to open its source, right-click to re-centre the graph on it.",
    'An arrow labeled "via" goes through a scripted effect: the event does not name the target itself, the effect it calls does.',
    "Edits in the inspector are held here until you press Save changes. Undo and redo cover edits, moves and refocusing alike.",
    "Drag the canvas to pan, scroll to zoom. + / − / 0 or the buttons at the bottom left do the same.",
  ]) {
    list.appendChild(el("li", "", text));
  }
  help.appendChild(list);
  popover(anchor, help);
};

// ---------------------------------------------------------------------------
// Query box
// ---------------------------------------------------------------------------

let catalog = { ids: [] as string[], namespaces: [] as string[] };
let catalogIds = new Set<string>();

function paramsFor(text: string, kind: "namespace" | "id"): EventGraphParams {
  return Object.assign(baseParams(), kind === "namespace" ? { namespace: text } : { root: text });
}
function parseQuery(): EventGraphParams {
  const raw = queryEl.value.trim();
  if (raw === "") return baseParams();
  // A known id wins over the dot heuristic: on_action and decision ids carry no
  // dot, and asking for one as a namespace finds nothing.
  if (catalogIds.has(raw)) return paramsFor(raw, "id");
  return paramsFor(raw, raw.includes(".") ? "id" : "namespace");
}
function submitQuery(): void {
  hideSuggest();
  const focus = parseQuery();
  history.push("change focus", { ...history.state, focus, positions: {} });
  afterHistoryChange();
  fetchGraph(focus);
}
$("go").onclick = submitQuery;

const suggestEl = $("suggest");
const suggestList = suggestEl.firstElementChild as HTMLElement;
const MAX_SHOWN = 12;
interface Match {
  text: string;
  kind: "namespace" | "id";
}
let matches: Match[] = [];
let activeIndex = -1;

function matchesFor(raw: string): Match[] {
  const q = raw.trim().toLowerCase();
  const pool: Match[] = catalog.namespaces
    .map((n): Match => ({ text: n, kind: "namespace" }))
    .concat(catalog.ids.map((i): Match => ({ text: i, kind: "id" })));
  if (q === "") return pool.slice(0, MAX_SHOWN);
  const starts: Match[] = [];
  const contains: Match[] = [];
  for (const entry of pool) {
    const at = entry.text.toLowerCase().indexOf(q);
    if (at === 0) starts.push(entry);
    else if (at > 0) contains.push(entry);
    if (starts.length >= MAX_SHOWN) break;
  }
  return starts.concat(contains).slice(0, MAX_SHOWN);
}

function renderSuggest(): void {
  suggestList.replaceChildren();
  matches.forEach((entry, i) => {
    const row = el("div", "px-menu-item");
    row.setAttribute("role", "option");
    if (i === activeIndex) row.setAttribute("data-active", "");
    row.appendChild(el("span", "px-grow px-truncate", entry.text));
    if (entry.kind === "namespace") row.appendChild(el("span", "px-menu-hint", "namespace"));
    // mousedown, not click: the input must not blur before the pick lands.
    row.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      pick(i);
    });
    suggestList.appendChild(row);
  });
  suggestEl.classList.toggle("show", matches.length > 0);
}
function showSuggest(): void {
  matches = matchesFor(queryEl.value);
  activeIndex = -1;
  renderSuggest();
}
function hideSuggest(): void {
  matches = [];
  activeIndex = -1;
  // Emptied, not just hidden: a stale list behind a closed panel is one re-show
  // away from offering entries the box no longer matches.
  suggestList.replaceChildren();
  suggestEl.classList.remove("show");
}
function moveActive(delta: number): void {
  if (!suggestEl.classList.contains("show")) showSuggest();
  if (matches.length === 0) return;
  activeIndex =
    activeIndex < 0
      ? delta > 0
        ? 0
        : matches.length - 1
      : (activeIndex + delta + matches.length) % matches.length;
  renderSuggest();
  suggestList.children[activeIndex]?.scrollIntoView({ block: "nearest" });
}
function pick(index: number): void {
  const entry = matches[index];
  if (!entry) return;
  queryEl.value = entry.text;
  hideSuggest();
  view.highlight(entry.text);
  const focus = paramsFor(entry.text, entry.kind);
  history.push(`focus ${entry.text}`, { ...history.state, focus, positions: {} });
  afterHistoryChange();
  fetchGraph(focus);
}

queryEl.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    moveActive(1);
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    moveActive(-1);
  } else if (ev.key === "Escape") {
    if (suggestEl.classList.contains("show")) {
      ev.preventDefault();
      hideSuggest();
    }
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    if (activeIndex >= 0) pick(activeIndex);
    else submitQuery();
  }
});
queryEl.addEventListener("focus", showSuggest);
queryEl.addEventListener("blur", hideSuggest);
queryEl.addEventListener("input", () => {
  view.highlight(queryEl.value);
  showSuggest();
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function setFocusLine(text: string, state: "" | "warn" | "error"): void {
  focusLineEl.textContent = text;
  if (state) focusLineEl.dataset.state = state;
  else delete focusLineEl.dataset.state;
}

function updateInfo(graph: EventGraph, params: EventGraphParams): void {
  const lines = [`${graph.nodes.length} nodes · ${graph.edges.length} edges`];
  if (graph.truncated) lines.push("Truncated: this view hides part of the graph.");
  lines.push(
    params.root
      ? `Focused on ${params.root}: what it fires, what fires it, and one hop further.`
      : params.namespace
        ? `Every event of namespace ${params.namespace}, connected or not.`
        : "Every event, on_action and decision of this mod."
  );
  infoEl.dataset.tip = lines.join("\n");
}

// ---------------------------------------------------------------------------
// Host messages
// ---------------------------------------------------------------------------

function applyUi(next: UiState | undefined): void {
  if (!next) return;
  ui = { ...ui, ...next };
  side.setWidth(ui.panelWidth);
  if (ui.panelCollapsed !== side.collapsed) side.toggle(ui.panelCollapsed);
  if (ui.railCollapsed !== rail.collapsed) rail.toggle(ui.railCollapsed);
  setTitleMode(ui.titleMode);
  $("toolBanner").setAttribute("aria-pressed", String(ui.banner));
  view.setOptions({ banner: ui.banner });
  if (ui.simX !== undefined && ui.simY !== undefined) sim.setPosition(ui.simX, ui.simY);
  updatePanelToggle();
  updateRailToggle();
}

window.addEventListener("message", (ev: MessageEvent<HostToApp>) => {
  const msg = ev.data;
  if (!msg) return;
  switch (msg.type) {
    case "init":
      applyUi(msg.ui);
      return;
    case "loading":
      setFocusLine("Loading…", "");
      return;
    case "error":
      emptyEl.classList.remove("show");
      setFocusLine(`Error: ${msg.message}`, "error");
      return;
    case "vocabulary":
      inspector.setVocabulary(msg.vocabulary);
      return;
    case "detail":
      if (msg.id !== selectedId) return; // stale
      lastDetail = msg.detail;
      try {
        inspector.render(msg.detail, msg.id, history.pending);
      } catch (e) {
        $("inspector").textContent = `Inspector error: ${e instanceof Error ? e.message : String(e)}`;
      }
      return;
    case "sim":
      sim.show(msg.detail, msg.id);
      return;
    case "banner":
      view.setBannerUrl(msg.result.theme, msg.url);
      return;
    case "saved":
      if (msg.error) {
        toast(msg.error, "destructive", 5200);
        afterHistoryChange();
        return;
      }
      history.markSaved();
      afterHistoryChange();
      toast(`Saved ${msg.applied} change${msg.applied === 1 ? "" : "s"}`);
      // The files changed under the inspector; re-read the selected event.
      if (selectedId) send({ type: "select", id: selectedId });
      return;
    case "restore":
      history.push("keep unsaved changes", msg.state);
      applyState(msg.state);
      return;
    case "graph":
      currentParams = msg.params ?? {};
      currentGraph = msg.graph;
      if (msg.graph?.suggestions) {
        catalog = msg.graph.suggestions;
        catalogIds = new Set(catalog.ids);
      }
      if (currentParams.root) queryEl.value = currentParams.root;
      else if (currentParams.namespace) queryEl.value = currentParams.namespace;
      // The focus the host loaded is the focus the history should hold.
      history.state.focus = currentParams;
      try {
        renderGraph(msg.graph, currentParams);
      } catch (e) {
        setFocusLine(`Render error: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
      return;
  }
});

function renderGraph(graph: EventGraph, params: EventGraphParams): void {
  selectedId = null;
  lastDetail = null;
  updateRailTools();
  inspector.showPlaceholder();

  if ((graph.nodes ?? []).length === 0) {
    emptyEl.classList.add("show");
    emptyEl.replaceChildren(
      el(
        "div",
        "help",
        params.namespace
          ? `Nothing indexed under namespace ${params.namespace}. Check the spelling, or use All nodes to see what this mod has.`
          : "No events here yet. Put the cursor in an event and press Ctrl+Alt+G, type a namespace above, or use All nodes."
      )
    );
    setFocusLine("Nothing to show", "warn");
    updateInfo(graph, params);
    return;
  }
  emptyEl.classList.remove("show");
  view.render(graph, params, {
    positions: history.state.positions,
    titleMode: ui.titleMode,
    banner: ui.banner,
  });
  setFocusLine(
    params.root ? `Around ${params.root}` : params.namespace ? `Namespace ${params.namespace}` : "All nodes",
    graph.truncated ? "warn" : ""
  );
  updateInfo(graph, params);
}

updatePanelToggle();
updateRailToggle();
updateRailTools();
inspector.showPlaceholder();
afterHistoryChange();
setFocusLine("Loading…", "");
