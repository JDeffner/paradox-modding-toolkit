/**
 * The Event Graph app: the CWTools-style event / on_action / decision
 * reference graph with a layered layout (layout.ts), pan + zoom,
 * click-to-focus, double-click-to-open, right-click-to-refocus, SVG export,
 * and an inspector in a resizable side panel. Built from the shared px-ui
 * classes; talks to the host only through messages.ts.
 */
import type {
  EventDetail,
  EventGraph,
  EventGraphNode,
  EventGraphParams,
  EventLocField,
} from "@px-lsp/protocol/protocol";
import type { AppToHost, HostToApp, UiState } from "../messages";
import { layoutGraph, type LayoutPos } from "../layout";
import { iconEl, type IconName } from "../../shared/icons";
import { sidePanel } from "../../shared/sidePanel";
import { closePopover, isPopoverAnchor, popover } from "../../shared/overlay";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const SVG_NS = "http://www.w3.org/2000/svg";
const svg = $<HTMLElement>("graph") as unknown as SVGSVGElement;
const emptyEl = $("empty");
const statusEl = $("status");
const infoEl = $("info");
const queryEl = $<HTMLInputElement>("query");
const inspectorEl = $("inspector");

const NODE_W = 150;
const NODE_H = 40;
// Edge labels render permanently only in sparse graphs; above this count they
// appear on demand, for the selected node's own edges (label overlap is the
// classic dense-graph failure).
const LABELS_ALWAYS_MAX = 25;

type Kind = "event" | "on_action" | "decision" | "other";
interface EdgeItem {
  from: string;
  to: string;
  path: SVGPathElement;
  label: SVGTextElement | null;
  labelsAlways: boolean;
}

let view = { x: 0, y: 0, scale: 1 };
let lastPos: Map<string, LayoutPos> | null = null;
let rootGroup: SVGGElement | null = null;
// id -> <g class="node">, and per-edge bookkeeping for the focus highlight.
const nodeGroups = new Map<string, SVGGElement>();
const nodeRects = new Map<string, { rect: SVGRectElement; node: EventGraphNode }>();
let edgeItems: EdgeItem[] = [];
const hiddenKinds = new Set<string>();
let selectedId: string | null = null;
let currentParams: EventGraphParams = {};

// ---------------------------------------------------------------------------
// Side panel (width and collapsed state live in the host's workspaceState)
// ---------------------------------------------------------------------------

const side = sidePanel($("side"), {
  onChange: (s) => {
    send({ type: "uiState", state: { panelWidth: s.width, panelCollapsed: s.collapsed } });
    updatePanelToggle();
  },
});
function updatePanelToggle(): void {
  const btn = $("togglePanel");
  btn.replaceChildren(iconEl(side.collapsed ? "panelRightOpen" : "panelRightClose"));
  btn.dataset.tip = side.collapsed ? "Show inspector" : "Hide inspector";
}
$("togglePanel").onclick = () => side.toggle();
function applyUi(ui: UiState | undefined): void {
  if (!ui) return;
  side.setWidth(ui.panelWidth);
  if (ui.panelCollapsed !== side.collapsed) side.toggle(ui.panelCollapsed);
  updatePanelToggle();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function kindKey(kind: string): Kind {
  return kind === "event" || kind === "on_action" || kind === "decision" ? kind : "other";
}
function sourceDash(source: EventGraphNode["source"]): string {
  if (source === "vanilla") return "5,4"; // dashed
  if (source === "parent") return "2,4"; // dotted
  return "0"; // mod: solid
}

function setStatus(text: string, state: "" | "warn" | "error"): void {
  statusEl.textContent = text;
  if (state) statusEl.dataset.state = state;
  else delete statusEl.dataset.state;
  infoEl.dataset.tip = text;
}

function applyTransform(g: SVGGElement): void {
  g.setAttribute("transform", "translate(" + view.x + "," + view.y + ") scale(" + view.scale + ")");
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {}
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function render(graph: EventGraph, params: EventGraphParams): void {
  nodeRects.clear();
  nodeGroups.clear();
  edgeItems = [];
  selectedId = null;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const nodes = graph.nodes || [];
  const edges = graph.edges || [];

  if (nodes.length === 0) {
    emptyEl.classList.add("show");
    emptyEl.textContent =
      "No events found here yet. Open an event file and press Ctrl+Alt+G, type a namespace above, or show all nodes for the whole mod.";
    setStatus("0 nodes · 0 edges", "");
    return;
  }
  emptyEl.classList.remove("show");

  const rootId = params.root || null;
  const pos = layoutGraph(nodes, edges, rootId ?? undefined);
  lastPos = pos;

  // defs: arrowhead markers, one per edge state so the head matches its line.
  const defs = svgEl("defs");
  for (const [id, cls] of [
    ["arrow", "arrow-plain"],
    ["arrowOut", "arrow-out"],
    ["arrowIn", "arrow-in"],
  ]) {
    const marker = svgEl("marker", {
      id,
      viewBox: "0 0 10 10",
      refX: "9",
      refY: "5",
      markerWidth: "7",
      markerHeight: "7",
      orient: "auto-start-reverse",
    });
    marker.appendChild(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", class: cls }));
    defs.appendChild(marker);
  }
  svg.appendChild(defs);

  const g = svgEl("g");
  rootGroup = g;
  svg.appendChild(g);

  // edges first (under nodes)
  const edgeLayer = svgEl("g");
  g.appendChild(edgeLayer);
  const labelsAlways = edges.length <= LABELS_ALWAYS_MAX;
  for (const edge of edges) {
    const from = pos.get(edge.from);
    const to = pos.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.x + NODE_W / 2;
    const y1 = from.y;
    const x2 = to.x - NODE_W / 2;
    const y2 = to.y;
    const mx = (x1 + x2) / 2;
    const d = "M " + x1 + " " + y1 + " C " + mx + " " + y1 + " " + mx + " " + y2 + " " + x2 + " " + y2;
    const path = svgEl("path", { class: "edge-path", d, "stroke-width": "1.4", "marker-end": "url(#arrow)" });
    const title = svgEl("title");
    title.textContent = edge.from + " → " + edge.to + "  (" + (edge.label || edge.via || "") + ")";
    path.appendChild(title);
    edgeLayer.appendChild(path);

    // Edge origin label (option text / immediate / on_actions …): permanent in
    // sparse graphs, on demand (selection) in dense ones.
    let elabel: SVGTextElement | null = null;
    if (edge.label) {
      elabel = svgEl("text", {
        class: "edge-label" + (labelsAlways ? "" : " hidden"),
        x: String(mx),
        y: String((y1 + y2) / 2 - 4),
        "text-anchor": "middle",
      });
      elabel.textContent = edge.label;
      edgeLayer.appendChild(elabel);
    }
    edgeItems.push({ from: edge.from, to: edge.to, path, label: elabel, labelsAlways });
  }

  // nodes: cards with a kind accent bar on the left.
  for (const node of nodes) {
    const p = pos.get(node.id);
    if (!p) continue;
    const isRoot = rootId != null && node.id === rootId;

    const ng = svgEl("g", {
      class: "node" + (isRoot ? " root" : ""),
      transform: "translate(" + (p.x - NODE_W / 2) + "," + (p.y - NODE_H / 2) + ")",
    });
    ng.dataset.id = node.id;
    ng.dataset.kind = kindKey(node.kind);

    const rect = svgEl("rect", {
      class: "node-rect",
      width: String(NODE_W),
      height: String(NODE_H),
      rx: "5",
      ry: "5",
      "stroke-dasharray": sourceDash(node.source),
    });
    const rtitle = svgEl("title");
    rtitle.textContent =
      node.id +
      (node.title ? " — " + node.title : "") +
      "  [" +
      node.kind +
      " · " +
      node.source +
      "]" +
      (node.file ? "\n" + node.file + (node.line ? ":" + node.line : "") : "") +
      "\nclick: focus + inspect · double-click: open source · right-click: refocus";
    rect.appendChild(rtitle);
    ng.appendChild(rect);
    nodeRects.set(node.id, { rect, node });
    nodeGroups.set(node.id, ng);

    ng.appendChild(
      svgEl("rect", {
        x: "4",
        y: "5",
        width: "3.5",
        height: String(NODE_H - 10),
        rx: "1.75",
        fill: `var(--eg-${kindKey(node.kind)})`,
        "pointer-events": "none",
      })
    );

    const label = svgEl("text", {
      class: "node-label",
      x: "13",
      y: String(node.title ? NODE_H / 2 - 3 : NODE_H / 2 + 4),
    });
    label.textContent = node.id.length > 21 ? node.id.slice(0, 20) + "…" : node.id;
    ng.appendChild(label);

    // Second line: the event's localized title, dimmed.
    if (node.title) {
      const sub = svgEl("text", { class: "node-label node-sub", x: "13", y: String(NODE_H / 2 + 12) });
      sub.textContent = node.title.length > 27 ? node.title.slice(0, 26) + "…" : node.title;
      ng.appendChild(sub);
    }

    ng.addEventListener("click", (ev) => {
      ev.stopPropagation();
      // Ctrl/Cmd+click opens the source directly; plain click inspects.
      if ((ev.ctrlKey || ev.metaKey) && node.file) {
        send({ type: "open", file: node.file, line: node.line });
        return;
      }
      selectNode(node.id);
    });
    ng.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      if (node.file) send({ type: "open", file: node.file, line: node.line });
    });
    ng.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      send({ type: "refocus", id: node.id });
    });

    g.appendChild(ng);
  }

  applyFocus();
  fitToView(pos);
  applyTransform(g);

  let status = nodes.length + " nodes · " + edges.length + " edges";
  if (params.namespace) status += " · namespace " + params.namespace;
  if (params.root) status += " · root " + params.root;
  if (graph.truncated) setStatus(status + " · truncated (increase maxNodes to see more)", "warn");
  else setStatus(status, "");
}

/** Focus + context: dim everything outside the selection's 1-hop neighborhood
 * and color its in/out edges; labels of its edges show even in dense graphs.
 * The kind filter dims (never hides) too, so this serves both states. */
function applyFocus(): void {
  const id = selectedId;
  const neighbors = new Set<string>();
  if (id !== null) {
    neighbors.add(id);
    for (const e of edgeItems) {
      if (e.from === id) neighbors.add(e.to);
      if (e.to === id) neighbors.add(e.from);
    }
  }
  nodeGroups.forEach((gEl, nid) => {
    gEl.classList.toggle("selected", id !== null && nid === id);
    gEl.classList.toggle(
      "dim",
      (id !== null && !neighbors.has(nid)) || hiddenKinds.has(gEl.dataset.kind ?? "")
    );
  });
  for (const e of edgeItems) {
    const touches = id !== null && (e.from === id || e.to === id);
    e.path.classList.toggle("dim", id !== null && !touches);
    e.path.classList.toggle("out-of-sel", touches && e.from === id);
    e.path.classList.toggle("into-sel", touches && e.to === id && e.from !== id);
    e.path.setAttribute(
      "marker-end",
      touches ? (e.from === id ? "url(#arrowOut)" : "url(#arrowIn)") : "url(#arrow)"
    );
    if (e.label) {
      e.label.classList.toggle("hidden", !e.labelsAlways && !touches);
      e.label.classList.toggle("dim", id !== null && !touches);
    }
  }
}

function fitToView(pos: Map<string, LayoutPos>): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  pos.forEach((p) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });
  if (!isFinite(minX)) {
    view = { x: 40, y: 40, scale: 1 };
    return;
  }
  const graphW = maxX - minX + NODE_W + 80;
  const graphH = maxY - minY + NODE_H + 80;
  const rect = svg.getBoundingClientRect();
  const vw = rect.width || 800;
  const vh = rect.height || 600;
  const scale = Math.min(1.2, Math.max(0.2, Math.min(vw / graphW, vh / graphH)));
  view.scale = scale;
  view.x = vw / 2 - ((minX + maxX) / 2) * scale;
  view.y = vh / 2 - ((minY + maxY) / 2) * scale;
}

// ---------------------------------------------------------------------------
// Pan + zoom
// ---------------------------------------------------------------------------
// Left OR middle drag pans, the same gesture the designer canvas and the GUI
// preview use. Middle needs preventDefault on both the press and the auxclick
// or the browser starts its own autoscroll on top of the pan.
// A MIDDLE drag captures the pointer: a release outside the webview never
// delivers a window mouseup, which left the pan armed and the cursor stuck.
// The left button stays uncaptured on purpose: capture retargets the derived
// click to the svg, which would break clicking a node to open it. Captured
// events still bubble, so the window-level listeners serve both paths.
let dragging = false;
let dragStart = { x: 0, y: 0 };
let downAt: { x: number; y: number } | null = null;
svg.addEventListener("pointerdown", (ev) => {
  if (ev.button === 0) downAt = { x: ev.clientX, y: ev.clientY };
  if (ev.button !== 0 && ev.button !== 1) return;
  if (ev.button === 1) {
    ev.preventDefault();
    svg.setPointerCapture(ev.pointerId);
  }
  dragging = true;
  dragStart = { x: ev.clientX - view.x, y: ev.clientY - view.y };
  svg.classList.add("dragging");
});
window.addEventListener("pointermove", (ev) => {
  if (!dragging || !rootGroup) return;
  view.x = ev.clientX - dragStart.x;
  view.y = ev.clientY - dragStart.y;
  applyTransform(rootGroup);
});
function endGraphPan(ev: PointerEvent): void {
  if (!dragging) return;
  dragging = false;
  svg.classList.remove("dragging");
  if (svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
}
window.addEventListener("pointerup", endGraphPan);
window.addEventListener("pointercancel", endGraphPan);
svg.addEventListener("auxclick", (ev) => {
  if (ev.button === 1) ev.preventDefault();
});
svg.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    if (!rootGroup) return;
    const rect = svg.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.min(4, Math.max(0.1, view.scale * factor));
    // zoom about the cursor
    view.x = mx - (mx - view.x) * (newScale / view.scale);
    view.y = my - (my - view.y) * (newScale / view.scale);
    view.scale = newScale;
    applyTransform(rootGroup);
  },
  { passive: false }
);
// Clicking empty canvas deselects (drag guard: only a stationary click).
svg.addEventListener("click", (ev) => {
  if (ev.target !== svg) return;
  if (downAt && Math.abs(ev.clientX - downAt.x) + Math.abs(ev.clientY - downAt.y) > 4) return;
  if (selectedId !== null) clearSelection();
});

function zoomBy(factor: number): void {
  if (!rootGroup) return;
  const rect = svg.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const newScale = Math.min(4, Math.max(0.1, view.scale * factor));
  view.x = cx - (cx - view.x) * (newScale / view.scale);
  view.y = cy - (cy - view.y) * (newScale / view.scale);
  view.scale = newScale;
  applyTransform(rootGroup);
}
function fitAll(): void {
  if (!rootGroup || !lastPos) return;
  fitToView(lastPos);
  applyTransform(rootGroup);
}
$("zoomIn").onclick = () => zoomBy(1.25);
$("zoomOut").onclick = () => zoomBy(1 / 1.25);
$("zoomFit").onclick = fitAll;
window.addEventListener("keydown", (ev) => {
  const target = ev.target as HTMLElement;
  if (target === queryEl || target.tagName === "INPUT") return;
  if (ev.key === "+" || ev.key === "=") {
    ev.preventDefault();
    zoomBy(1.25);
  } else if (ev.key === "-") {
    ev.preventDefault();
    zoomBy(1 / 1.25);
  } else if (ev.key === "0" || ev.key === "f") {
    ev.preventDefault();
    fitAll();
  } else if (ev.key === "Escape") {
    // The help popover takes Escape itself while open.
    if (selectedId !== null) clearSelection();
  } else if (ev.key === "/") {
    ev.preventDefault();
    queryEl.focus();
  }
});

// ---------------------------------------------------------------------------
// Toolbar: query, completion, kind filter, help
// ---------------------------------------------------------------------------

// The mod's own graph vocabulary, as the server sends it with every answer.
let catalog = { ids: [] as string[], namespaces: [] as string[] };
let catalogIds = new Set<string>();

function baseParams(): EventGraphParams {
  return { maxNodes: currentParams.maxNodes };
}
function paramsFor(text: string, kind: "namespace" | "id"): EventGraphParams {
  return Object.assign(baseParams(), kind === "namespace" ? { namespace: text } : { root: text });
}
function parseQuery(): EventGraphParams {
  const raw = queryEl.value.trim();
  if (raw === "") return baseParams();
  // A known id wins over the dot heuristic: on_action and decision ids carry
  // no dot, and asking for one as a namespace finds nothing.
  if (catalogIds.has(raw)) return paramsFor(raw, "id");
  // A '.' in CK3 event ids marks a namespaced id (namespace.number) -> root.
  return paramsFor(raw, raw.indexOf(".") >= 0 ? "id" : "namespace");
}
function submitQuery(): void {
  hideSuggest();
  send({ type: "fetch", params: parseQuery() });
}
$("go").onclick = submitQuery;

// A plain dropdown over the catalog: no fetching per keystroke, and picking an
// entry queries it AS WHAT IT IS, so an on_action name is never mistaken for a
// namespace.
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
  // Emptied, not just hidden: a stale list behind a closed panel is one
  // re-show away from offering entries the box no longer matches.
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
  highlightMatches();
  send({ type: "fetch", params: paramsFor(entry.text, entry.kind) });
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

// Live highlight: typing matches loaded nodes by id OR localized title.
function highlightMatches(): void {
  const q = queryEl.value.trim().toLowerCase();
  nodeRects.forEach((entry) => {
    const hit =
      q.length > 1 &&
      (entry.node.id.toLowerCase().indexOf(q) >= 0 || (entry.node.title || "").toLowerCase().indexOf(q) >= 0);
    entry.rect.classList.toggle("search-hit", hit);
  });
}
queryEl.addEventListener("input", () => {
  highlightMatches();
  showSuggest();
});

// Kind toggles double as a per-kind filter (dims, never hides).
$("kinds").addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLElement>("button[data-kind]");
  if (!btn) return;
  const kind = btn.dataset.kind ?? "";
  if (hiddenKinds.has(kind)) hiddenKinds.delete(kind);
  else hiddenKinds.add(kind);
  btn.setAttribute("aria-pressed", hiddenKinds.has(kind) ? "false" : "true");
  applyFocus();
});

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
    "Cards are events, on_actions and decisions. The colored bar is the kind (the toolbar toggles dim a kind). The small line is the localized title.",
    "Arrows mean fires or references. Click a card to focus it: the rest dims, blue arrows are what it fires, orange arrows are what fires it, and the labels say where the call sits (an option, immediate, on_actions). Esc zooms back out.",
    "Dashed borders are vanilla content, solid is your mod, dotted is a parent mod.",
    "The click also opens the inspector: read and edit its localization, jump to any referenced variable, scope or effect, scaffold a new option, or simulate the event.",
    "Double-click (or Ctrl+click) opens the source file beside the graph. Right-click re-centers the graph on that card.",
    "The search box completes against your mod's ids and namespaces; Enter loads. Typing highlights matching cards. All nodes shows the whole mod.",
    "Drag to pan, scroll to zoom. + / − / 0 keys or the corner buttons zoom and fit. Export saves the picture as SVG.",
  ]) {
    list.appendChild(el("li", "", text));
  }
  help.appendChild(list);
  popover(anchor, help);
};

$("showAll").onclick = () => {
  queryEl.value = "";
  hideSuggest();
  send({ type: "fetch", params: { maxNodes: 5000 } });
};
$("refresh").onclick = () => send({ type: "fetch", params: currentParams });
$("export").onclick = () => send({ type: "export", svg: serializeSvg() });

function serializeSvg(): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", SVG_NS);
  // Bake the computed colors in: the exported file has no stylesheet, and
  // the live one paints through CSS variables.
  const live = svg.querySelectorAll<SVGElement>("rect, path, text");
  const copies = clone.querySelectorAll<SVGElement>("rect, path, text");
  live.forEach((node, i) => {
    const cs = getComputedStyle(node);
    const copy = copies[i];
    copy.setAttribute("fill", cs.fill);
    copy.setAttribute("stroke", cs.stroke);
    copy.setAttribute("stroke-opacity", cs.strokeOpacity);
    copy.setAttribute("stroke-width", cs.strokeWidth);
    copy.setAttribute("opacity", cs.opacity);
    if (node.tagName === "text") {
      copy.setAttribute("font-family", cs.fontFamily);
      copy.setAttribute("font-size", cs.fontSize);
    }
  });
  // A background rect so the file is readable standalone.
  const bg = svgEl("rect", {
    x: "-100000",
    y: "-100000",
    width: "200000",
    height: "200000",
    fill: getComputedStyle(document.body).backgroundColor || "#1e1e1e",
  });
  clone.insertBefore(bg, clone.firstChild);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function selectNode(id: string): void {
  selectedId = id;
  applyFocus();
  if (side.collapsed) side.toggle(false);
  inspectorEl.replaceChildren(el("div", "px-muted", "Loading " + id + "…"));
  send({ type: "select", id });
}

function clearSelection(): void {
  selectedId = null;
  applyFocus();
  showPlaceholder();
}

function showPlaceholder(): void {
  inspectorEl.replaceChildren(el("div", "px-muted", "Click a card to inspect it."));
}

function el(tag: string, cls = "", text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, icon: IconName | null, tip: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "px-btn";
  b.dataset.variant = "ghost";
  b.dataset.size = "sm";
  b.dataset.tip = tip;
  if (icon) b.appendChild(iconEl(icon));
  b.append(label);
  b.onclick = onClick;
  return b;
}

function openLink(label: string, file: string, line: number | undefined): HTMLElement {
  const a = el("button", "px-btn", label);
  a.dataset.variant = "link";
  a.addEventListener("click", () => send({ type: "open", file, line: (line || 0) + 1 }));
  return a;
}

function locRow(
  container: HTMLElement,
  label: string,
  loc: EventLocField | undefined,
  eventId: string
): void {
  const row = el("div", "locrow");
  row.appendChild(el("div", "k px-muted px-xs", label + (loc && loc.key ? " · " + loc.key : "")));
  if (!loc) {
    row.appendChild(el("div", "px-muted", "none"));
  } else if (loc.dynamic) {
    row.appendChild(el("div", "px-muted", "Dynamic (first_valid / triggered_desc): edit in source"));
  } else {
    const edit = el("div", "edit");
    const input = document.createElement("input");
    input.className = "px-input";
    input.dataset.size = "sm";
    input.type = "text";
    input.spellcheck = false;
    input.value = loc.text || "";
    input.placeholder = loc.text === undefined ? "No localization yet. Type and save" : "";
    const save = document.createElement("button");
    save.className = "px-btn";
    save.dataset.variant = "ghost";
    save.dataset.size = "icon-sm";
    save.dataset.tip = "Write this text into the localization file";
    save.dataset.tipSide = "left";
    save.appendChild(iconEl("save"));
    save.addEventListener("click", () => {
      send({
        type: "editLoc",
        id: eventId,
        key: loc.key,
        value: input.value,
        file: loc.file,
        line: loc.line,
      });
      save.disabled = true;
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") save.click();
    });
    edit.append(input, save);
    row.appendChild(edit);
  }
  container.appendChild(row);
}

function badge(text: string, variant: "secondary" | "outline" = "secondary"): HTMLElement {
  const b = el("span", "px-badge", text);
  b.dataset.variant = variant;
  return b;
}

const REF_KIND_LABEL: Record<string, string> = {
  saved_scope: "scope",
  variable: "variable",
  scripted_effect: "effect",
  scripted_trigger: "trigger",
  script_value: "value",
  event: "event",
};

function renderDetail(detail: EventDetail | null): void {
  inspectorEl.replaceChildren();
  if (!detail) {
    inspectorEl.appendChild(
      el("div", "px-muted", "No details for " + (selectedId || "?") + " (vanilla-only or not an event).")
    );
    return;
  }
  inspectorEl.appendChild(el("h2", "", detail.id));

  const badges = el("div", "badges");
  if (detail.type) badges.appendChild(badge(detail.type));
  if (detail.theme) badges.appendChild(badge("theme: " + detail.theme));
  if (detail.hidden) badges.appendChild(badge("hidden"));
  if (badges.childElementCount) inspectorEl.appendChild(badges);

  const actions = el("div", "actions");
  actions.appendChild(
    button("Source", "fileText", "Open the source at line " + ((detail.line || 0) + 1), () =>
      send({ type: "open", file: detail.file, line: (detail.line || 0) + 1 })
    )
  );
  actions.appendChild(
    button("Simulate", "play", "Walk through " + detail.id + " in the event simulator", () =>
      send({ type: "simulate", id: detail.id })
    )
  );
  actions.appendChild(
    button("Center", "locate", "Rebuild the graph around " + detail.id, () =>
      send({ type: "refocus", id: detail.id })
    )
  );
  inspectorEl.appendChild(actions);

  inspectorEl.appendChild(el("div", "sub", "Text"));
  locRow(inspectorEl, "Title", detail.title, detail.id);
  locRow(inspectorEl, "Description", detail.desc, detail.id);

  if (detail.sections.length > 0) {
    inspectorEl.appendChild(el("div", "sub", "Logic"));
    for (const s of detail.sections) {
      const row = el("div", "locrow");
      row.appendChild(openLink(s.name, detail.file, s.line));
      const chips = el("div", "badges");
      for (const k of s.keys) chips.appendChild(badge(k, "outline"));
      row.appendChild(chips);
      inspectorEl.appendChild(row);
    }
  }

  inspectorEl.appendChild(el("div", "sub", "Options (" + detail.options.length + ")"));
  detail.options.forEach((opt, i) => {
    const block = el("div", "block");
    const head = el("div", "head");
    const caret = iconEl("chevronDown", "px-icon caret");
    caret.addEventListener("click", () => block.toggleAttribute("data-collapsed"));
    head.appendChild(caret);
    head.appendChild(openLink("option " + (i + 1), detail.file, opt.line));
    if (opt.hasTrigger) head.appendChild(badge("trigger", "outline"));
    if (opt.hasAiChance) head.appendChild(badge("ai_chance", "outline"));
    block.appendChild(head);
    locRow(block, "Text", opt.name, detail.id);
    if (opt.effectKeys.length > 0) {
      const chips = el("div", "badges");
      for (const k of opt.effectKeys) chips.appendChild(badge(k, "outline"));
      block.appendChild(chips);
    }
    inspectorEl.appendChild(block);
  });
  const addBtn = button("Add option", "plus", "Insert a scaffolded option and create its loc key", () =>
    send({
      type: "addOption",
      id: detail.id,
      file: detail.file,
      endLine: detail.endLine,
      count: detail.options.length,
    })
  );
  addBtn.dataset.variant = "outline";
  addBtn.style.alignSelf = "flex-start";
  inspectorEl.appendChild(addBtn);

  if (detail.refs.length > 0) {
    inspectorEl.appendChild(el("div", "sub", "References (" + detail.refs.length + ")"));
    const list = el("div", "px-list");
    const order = ["saved_scope", "variable", "scripted_effect", "scripted_trigger", "script_value", "event"];
    for (const kind of order) {
      for (const r of detail.refs.filter((x) => x.kind === kind)) {
        const row = el("div", "px-item");
        row.title = r.name;
        row.appendChild(el("span", "px-item-kind", REF_KIND_LABEL[kind] || kind));
        row.appendChild(el("span", "px-item-label", r.name));
        if (r.defFile && r.defCount && r.defCount > 1) {
          row.appendChild(el("span", "px-item-label px-xs", r.defCount + " sites"));
        }
        row.appendChild(el("span", "px-item-label px-xs", "used @" + (r.line + 1)));
        const file = r.defFile ?? detail.file;
        const line = r.defFile ? r.defLine : r.line;
        row.addEventListener("click", () => send({ type: "open", file, line: (line || 0) + 1 }));
        list.appendChild(row);
      }
    }
    inspectorEl.appendChild(list);
  }
}

// ---------------------------------------------------------------------------
// Host messages
// ---------------------------------------------------------------------------

window.addEventListener("message", (ev: MessageEvent<HostToApp>) => {
  const msg = ev.data;
  if (!msg) return;
  switch (msg.type) {
    case "init":
      applyUi(msg.ui);
      return;
    case "loading":
      setStatus("Loading…", "");
      return;
    case "error":
      emptyEl.classList.remove("show");
      setStatus("Error: " + msg.message, "error");
      return;
    case "detail":
      if (msg.id !== selectedId) return; // stale
      try {
        renderDetail(msg.detail);
      } catch (e) {
        inspectorEl.textContent = "Inspector error: " + (e instanceof Error ? e.message : String(e));
      }
      return;
    case "graph":
      currentParams = msg.params || {};
      if (msg.graph && msg.graph.suggestions) {
        catalog = msg.graph.suggestions;
        catalogIds = new Set(catalog.ids);
      }
      if (currentParams.root) queryEl.value = currentParams.root;
      else if (currentParams.namespace) queryEl.value = currentParams.namespace;
      try {
        render(msg.graph, msg.params);
        showPlaceholder();
      } catch (e) {
        setStatus("Render error: " + (e instanceof Error ? e.message : String(e)), "error");
      }
      return;
  }
});

updatePanelToggle();
showPlaceholder();
setStatus("Loading…", "");
