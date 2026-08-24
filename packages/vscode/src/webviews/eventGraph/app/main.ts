/**
 * The Event Graph app: wiring only. The canvas is view.ts, the right panel is
 * inspector.ts, the floating walkthrough is simWindow.ts, and the session
 * (focus, node positions, unsaved edits) is history.ts.
 *
 * The rule the whole page follows: nothing is written to disk until Save. Every
 * edit becomes a PendingEdit in the history, undo and redo move through them,
 * and the host only ever receives a `save` with the whole list.
 */
import type { EventGraph, EventGraphParams, EventVocabularyResult } from "@px-lsp/protocol/protocol";
import type { AppToHost, HostToApp, UiState } from "../messages";
import { GraphHistory, type GraphState } from "../history";
import { iconEl } from "../../shared/icons";
import { sidePanel } from "../../shared/sidePanel";
import { closePopover, isPopoverAnchor, popover, toast } from "../../shared/overlay";
import { helpDialog } from "../../shared/help";
import { button, dropdown, el, iconButton, input } from "./dom";
import { GraphView } from "./view";
import { Inspector } from "./inspector";
import { SimWindow } from "./simWindow";
import { describeEdit, editKind } from "./pendingView";

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
const changesEl = $<HTMLButtonElement>("changes");

let ui: UiState = {
  panelWidth: 340,
  panelCollapsed: false,
  railCollapsed: false,
  titleMode: "raw",
  banner: false,
};
let currentGraph: EventGraph | null = null;
let currentParams: EventGraphParams = {};
let vocab: EventVocabularyResult | null = null;
/** Re-select this card once the post-save graph arrives. */
let reselectAfterGraph: string | null = null;
/** The cluster filter the LAST render actually drew (null = the whole graph). */
let renderedCluster: string | null = null;
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
// A strip of icons has no width to choose, so the rail only ever opens and
// closes, and its handle rides on the canvas edge where it stays reachable.
const rail = sidePanel($("rail"), {
  min: 40,
  max: 40,
  width: 40,
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
  const btn = $("railToggle");
  btn.replaceChildren(iconEl(rail.collapsed ? "panelLeftOpen" : "panelLeftClose"));
  btn.dataset.tip = rail.collapsed ? "Show the tools" : "Hide the tools";
}
$("togglePanel").onclick = () => side.toggle();
$("railToggle").onclick = () => rail.toggle();

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
  onNeedBanner: (theme) => send({ type: "banner", theme }),
});

const inspector = new Inspector($("inspector"), {
  onOpen: (file, line) => send({ type: "open", file, line }),
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
  history.push(`focus ${id}`, { ...history.state, focus, cluster: undefined, positions: {} });
  afterHistoryChange();
  fetchGraph(focus);
}

/**
 * The node's CHAIN: everything that leads to `id` and everything it leads to,
 * following edge DIRECTION — not the whole connected component, which in a
 * wired-up mod is most of the graph. Client-side, so the Chain tool costs no
 * round trip and undo brings the full graph straight back.
 */
function clusterGraph(graph: EventGraph, id: string): EventGraph {
  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  const link = (map: Map<string, string[]>, a: string, b: string): void => {
    const list = map.get(a);
    if (list) list.push(b);
    else map.set(a, [b]);
  };
  for (const edge of graph.edges) {
    link(out, edge.from, edge.to);
    link(inc, edge.to, edge.from);
  }
  const keep = new Set<string>([id]);
  for (const links of [out, inc]) {
    const queue = [id];
    while (queue.length > 0) {
      for (const next of links.get(queue.pop()!) ?? []) {
        if (keep.has(next)) continue;
        keep.add(next);
        queue.push(next);
      }
    }
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  };
}

// ---------------------------------------------------------------------------
// New event
// ---------------------------------------------------------------------------

/** `my_ns.4`: the next free number under the namespace the view is looking at. */
function suggestEventId(): string {
  const ns =
    currentParams.namespace ??
    (selectedId ? selectedId.split(".")[0] : undefined) ??
    catalog.namespaces[0] ??
    "my_mod";
  let max = 0;
  for (const id of catalog.ids) {
    if (!id.startsWith(ns + ".")) continue;
    const n = Number(id.slice(ns.length + 1));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${ns}.${max + 1}`;
}

/**
 * The "New event" form: everything a working event needs, nothing else. It
 * becomes ONE pending edit (the scaffold block plus its localization keys),
 * so Save writes it and undo takes it back like any other change.
 */
function openNewEventForm(anchor: HTMLElement): void {
  if (isPopoverAnchor(anchor)) {
    closePopover();
    return;
  }
  const form = el("div", "newEventForm");
  const row = (label: string, tip: string, control: HTMLElement): void => {
    const r = el("div", "field");
    const k = el("span", "k", label);
    k.dataset.tip = tip;
    k.dataset.tipWrap = "";
    const v = el("div", "v");
    v.appendChild(control);
    r.append(k, v);
    form.appendChild(r);
  };
  form.appendChild(el("div", "sub", "New event"));
  form.appendChild(
    el(
      "div",
      "hint",
      "Saved as a scaffold you then fill in here or in the source. Nothing is written until you press Save."
    )
  );
  const idInput = input(suggestEventId(), "namespace.number", () => undefined);
  row("id", "The event's name in script: its namespace, a dot, and a free number", idInput);
  let type = "character_event";
  const types = vocab?.values["type"] ?? [];
  row(
    "type",
    "Who the event happens to and how it is shown. character_event is the everyday letter-style event",
    types.length > 0
      ? dropdown(
          type,
          "choose",
          types.map((t) => ({ value: t.value, label: t.value, description: t.doc, hint: t.hint })),
          "Pick the event's type",
          (v) => (type = v)
        )
      : input(type, "character_event", (v) => (type = v))
  );
  const titleInput = input("", "The window's heading", () => undefined);
  row("title", "What the player reads at the top of the event window", titleInput);
  const descInput = input("", "What is happening", () => undefined);
  row("desc", "The event's body text, under the illustration", descInput);
  let options = 1;
  row(
    "options",
    "How many choices the player gets. Each becomes an option block with its own text key",
    dropdown(
      "1",
      "1",
      ["0", "1", "2", "3"].map((n) => ({ value: n, label: n })),
      "Scaffolded option blocks",
      (v) => (options = Number(v))
    )
  );
  const create = button(
    "Create on Save",
    "plus",
    "Adds the event to your unsaved changes; Save writes the file and its localization",
    () => {
      const id = idInput.value.trim();
      if (!/^[A-Za-z0-9_]+\.[0-9]+$/.test(id)) {
        toast("An event id looks like namespace.123 (letters, digits and _ before the dot).", "destructive");
        return;
      }
      if (catalogIds.has(id)) {
        toast(`${id} already exists. Pick a free number.`, "destructive");
        return;
      }
      const ns = id.split(".")[0];
      // Append to the file the namespace already lives in, when it is the mod's.
      const home = currentGraph?.nodes.find(
        (n) => n.source === "mod" && n.file !== undefined && n.id.startsWith(ns + ".")
      );
      history.pushEdit(`create ${id}`, {
        kind: "createEvent",
        id,
        file: home?.file ?? null,
        type,
        title: titleInput.value.trim(),
        desc: descInput.value.trim(),
        options,
      });
      afterHistoryChange();
      closePopover();
      toast(`${id} is in your unsaved changes. Press Save to write it.`);
    },
    "default"
  );
  create.style.alignSelf = "flex-end";
  form.appendChild(create);
  popover(anchor, form);
}

// ---------------------------------------------------------------------------
// History, save
// ---------------------------------------------------------------------------

function afterHistoryChange(): void {
  const count = history.pendingCount;
  saveEl.disabled = count === 0;
  saveEl.dataset.tip =
    count === 0
      ? "No changes to save yet. Edits stay in this view until you save them"
      : `Write ${count} change${count === 1 ? "" : "s"} to your mod files`;
  changesEl.disabled = count === 0;
  changesEl.querySelector(".count")!.textContent = String(count);
  changesEl.dataset.tip =
    count === 0
      ? "No changes yet. Edits stay in this view until you save them"
      : `List the ${count} unsaved change${count === 1 ? "" : "s"}, newest last`;
  if (count === 0 && isPopoverAnchor(changesEl)) closePopover();
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
  if (!sameFocus(state.focus, currentParams)) {
    fetchGraph(state.focus);
    return;
  }
  // Same focus but a different cluster: redraw from the graph we already hold.
  if ((state.cluster ?? null) !== renderedCluster && currentGraph) {
    renderGraph(currentGraph, currentParams);
  }
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

/** Walk undo back until edit `index` and everything after it is gone. */
function undoTo(index: number): void {
  let state: GraphState | null = null;
  while (history.pendingCount > index && history.canUndo) state = history.undo();
  if (state) applyState(state);
}

/**
 * Every edit waiting for Save, oldest first. It is the answer to "what did I
 * change?", which a count on a button cannot give, and each row offers the way
 * back to before it.
 */
changesEl.onclick = () => {
  if (isPopoverAnchor(changesEl)) {
    closePopover();
    return;
  }
  const list = el("div", "px-list");
  list.id = "changeList";
  history.pending.forEach((edit, index) => {
    const row = el("div", "px-item");
    const what = describeEdit(edit);
    row.title = what;
    row.append(
      el("span", "px-item-kind", editKind(edit)),
      el("span", "who", edit.id),
      el("span", "what", what),
      iconButton(
        "undo",
        index === history.pendingCount - 1
          ? "Undo this change"
          : `Undo this change and the ${history.pendingCount - 1 - index} after it`,
        () => {
          closePopover();
          undoTo(index);
        },
        "icon-xs"
      )
    );
    list.appendChild(row);
  });
  popover(changesEl, list);
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
  } else if (ev.key === "s") {
    $("toolSimulate").click();
  } else if (ev.key === "c") {
    $("toolCenter").click();
  } else if (ev.key === "a") {
    $("toolAll").click();
  } else if (ev.key === "o") {
    $("toolSource").click();
  } else if (ev.key === "n") {
    ev.preventDefault();
    openNewEventForm($("newEvent"));
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
  updateRailTools();
}

$("refresh").onclick = () => fetchGraph(currentParams);
$("newEvent").onclick = () => openNewEventForm($("newEvent"));
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

// The three tools that act on a card stay clickable-looking but inert without
// one: `disabled` would take their tooltip away, which is where the page now
// says a card is needed.
$("toolSimulate").onclick = () => {
  if (selectedId) sim.open(selectedId);
};
$("toolCenter").onclick = () => {
  if (!selectedId || !currentGraph) return;
  const id = selectedId;
  // A view-only step: the graph we hold is filtered down to the selection's
  // chain. Undo restores the full view; nothing is fetched.
  history.push(`chain of ${id}`, { ...history.state, cluster: id, positions: {} });
  afterHistoryChange();
  renderGraph(currentGraph, currentParams);
  selectNode(id);
};
$("toolAll").onclick = () => {
  queryEl.value = "";
  hideSuggest();
  const focus: EventGraphParams = { maxNodes: 5000 };
  history.push("show all nodes", { ...history.state, focus, cluster: undefined, positions: {} });
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

/** The caption a card carries: its localized title, or its id. */
function labelFor(id: string): string {
  const node = currentGraph?.nodes.find((n) => n.id === id);
  return ui.titleMode === "loc" && node?.title ? node.title : id;
}

/** Simulate, Center and Source act on a selection; the rail's edge says which. */
function updateRailTools(): void {
  const has = selectedId !== null;
  for (const id of ["toolSimulate", "toolCenter", "toolSource"]) {
    $(id).setAttribute("aria-disabled", String(!has));
  }
  $("actingOn").textContent = has ? `Acting on: ${labelFor(selectedId!)}` : "";
}

$("helpBtn").onclick = () =>
  helpDialog({
    title: "Event Graph",
    intro:
      "Every event, on_action and decision of your mod as cards, laid out so that LEFT TO RIGHT IS TIME: a card fires the cards in the columns to its right. Use it to follow an event chain, spot dead ends, and edit an event without leaving the picture.",
    sections: [
      {
        title: "Reading the sequence",
        items: [
          {
            lead: "Columns are steps:",
            text: "what starts a chain (usually an on_action) sits leftmost, and every arrow goes one or more columns to the right. A dashed arrow curving back LEFT closes a loop: the chain returns to an earlier event.",
          },
          {
            lead: "A card's rows",
            text: "are its own sequence, top to bottom: immediate runs when the event appears, the numbered rows are the player's options, after runs once any option was picked. Each row's dot is where its arrows leave; a row with no arrow ends the chain.",
          },
          {
            lead: "The chip on an arrow",
            text: "is its WHEN: “30d” fires 30 days later, “7–14d” somewhere in that window, “2mo” in months, “1y” in years. A dashed “w 100” chip is a random pool's raw weight, not a delay.",
          },
          {
            lead: "Arrows labeled “via”",
            text: "go through a scripted effect: the event does not name the target itself, the effect it calls does. What happens inside the effect (including any delay) is not shown.",
          },
        ],
      },
      {
        title: "Reading a card",
        items: [
          {
            lead: "The header:",
            text: "the name (or localized title), then the kind and how many options it has, then what its trigger asks for and how often other content fires it.",
          },
          {
            lead: "The colored bar",
            text: "on the left is the kind: blue events, purple on_actions, green decisions, orange everything else. The chips at the bottom left dim a kind in the whole graph.",
          },
          {
            lead: "The border",
            text: "says where it comes from: solid is your mod, dashed is vanilla, dotted is a parent mod. Only your mod's events grow rows; vanilla cards stay compact.",
          },
          {
            lead: "With a card selected,",
            text: "its whole chain lights up — everything leading to it in orange, everything it leads to in blue, however many hops away — and the rest dims. The Chain tool (C) hides the rest entirely.",
          },
        ],
      },
      {
        title: "Moving around",
        items: [
          {
            lead: "Pan and zoom:",
            text: "drag the canvas, scroll to zoom, and the buttons at the bottom left zoom and fit.",
          },
          {
            lead: "Search:",
            text: "the box at the top left takes an event id (namespace.123), an on_action or decision name, or a whole namespace; suggestions appear as you type, and typing also outlines every matching card.",
          },
          {
            lead: "Move a card",
            text: "by dragging it; it stays where you put it and the rest of the map makes room. Undo puts it back.",
          },
        ],
      },
      {
        title: "The tools on the left",
        intro: "The first, second and last need a card selected.",
        items: [
          {
            lead: "Simulate",
            text: "walks through the selected event block by block, in the order the game runs them, in a floating window you can step deeper from.",
          },
          {
            lead: "Chain",
            text: "keeps only what leads to the selected card and what it leads to, following the arrows' direction, and hides the rest. Undo brings the whole graph back.",
          },
          { lead: "All nodes", text: "loads everything the mod has, connected or not." },
          {
            lead: "Source",
            text: "opens the selected card's file beside the graph. Double-clicking a card and the small button on its corner do the same; right-click re-centres the graph on it instead.",
          },
        ],
      },
      {
        title: "Editing and saving",
        intro: "Nothing touches your files until you press Save; until then every edit lives in this view.",
        items: [
          {
            lead: "Click a card",
            text: "to open it in the inspector: its fields with dropdowns listing the game's own values, its title and description text, its options, and every scope, effect and value it references.",
          },
          {
            lead: "New event (N)",
            text: "scaffolds a whole event: id, type, title, description and its option blocks, localization keys included. It lands in your unsaved changes; Save writes the file (creating it for a fresh namespace).",
          },
          {
            lead: "Add things",
            text: "with the “Add field”, “Add effect”, “Add trigger” and “Add option” rows; each list comes from your game files, with the engine's own one-line documentation. Picking trigger_event offers your mod's own event ids.",
          },
          {
            lead: "<SV>",
            text: "marks a script value: a number computed by script, defined under common/script_values.",
          },
          {
            lead: "Changed rows say “unsaved”.",
            text: "The Changes button lists every pending edit, and each row's undo takes you back to before it. Save writes them all to your mod files, in a safe order.",
          },
        ],
      },
      {
        title: "Display options",
        items: [
          { lead: "Raw / Loc", text: "captions every card with its id or its localized title." },
          {
            lead: "The image button",
            text: "draws each event's real background behind its card (its override_background, or its theme's). A background that cannot be resolved gets a hatched placeholder instead of a wrong picture.",
          },
        ],
      },
      {
        title: "Keyboard",
        shortcuts: [
          { keys: ["+", "−"], does: "Zoom in and out" },
          { keys: ["0"], does: "Fit the whole graph (F does the same)" },
          { keys: ["/"], does: "Focus the search box" },
          { keys: ["Esc"], does: "Close the simulation, else clear the selection" },
          { keys: ["Ctrl", "Z"], does: "Undo (edits, moves, focus changes alike)" },
          { keys: ["Ctrl", "Shift", "Z"], does: "Redo" },
          { keys: ["Ctrl", "S"], does: "Save the pending edits to your files" },
        ],
      },
    ],
  });

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
  history.push("change focus", { ...history.state, focus, cluster: undefined, positions: {} });
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
  history.push(`focus ${entry.text}`, { ...history.state, focus, cluster: undefined, positions: {} });
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

function updateInfo(graph: EventGraph, params: EventGraphParams, cluster: string | null): void {
  const lines = [`${graph.nodes.length} nodes · ${graph.edges.length} edges`];
  if (graph.truncated) lines.push("Truncated: this view hides part of the graph.");
  if (cluster)
    lines.push(`Chain of ${cluster}: what leads to it and what it leads to. Undo brings the rest back.`);
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
      vocab = msg.vocabulary;
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
      // The files changed under the graph and the inspector: refetch so a
      // created event gets its card, and put the selection back afterwards.
      reselectAfterGraph = selectedId;
      fetchGraph(currentParams);
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
        inspector.setCatalog(catalog.ids);
      }
      if (currentParams.root) queryEl.value = currentParams.root;
      else if (currentParams.namespace) queryEl.value = currentParams.namespace;
      // The focus the host loaded is the focus the history should hold. A
      // cluster from another focus would filter the wrong graph: drop it.
      if (!sameFocus(history.state.focus, currentParams)) history.state.cluster = undefined;
      history.state.focus = currentParams;
      try {
        renderGraph(msg.graph, currentParams);
        if (reselectAfterGraph && msg.graph.nodes.some((n) => n.id === reselectAfterGraph)) {
          selectNode(reselectAfterGraph);
        }
        reselectAfterGraph = null;
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

  // The Cluster tool's filter: applied at render time so the full graph stays
  // in `currentGraph` and undoing the cluster is a redraw, not a fetch.
  const cluster = history.state.cluster ?? null;
  const clustered = cluster !== null && (graph.nodes ?? []).some((n) => n.id === cluster);
  const shown = clustered ? clusterGraph(graph, cluster) : graph;
  renderedCluster = clustered ? cluster : null;

  if ((shown.nodes ?? []).length === 0) {
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
    updateInfo(shown, params, renderedCluster);
    return;
  }
  emptyEl.classList.remove("show");
  view.render(shown, clustered ? { ...params, root: cluster } : params, {
    positions: history.state.positions,
    titleMode: ui.titleMode,
    banner: ui.banner,
  });
  // The focus itself is already in the query box; this line only flags a view
  // that hides something (truncation, cluster). A cluster cut from a truncated
  // graph says both: its component may be missing members the server never sent.
  setFocusLine(
    clustered
      ? `Chain: ${shown.nodes.length} cards${graph.truncated ? " · truncated view" : ""}`
      : graph.truncated
        ? "Truncated view"
        : "",
    graph.truncated ? "warn" : ""
  );
  updateInfo(shown, params, renderedCluster);
}

updatePanelToggle();
updateRailToggle();
updateRailTools();
inspector.showPlaceholder();
afterHistoryChange();
setFocusLine("Loading…", "");
