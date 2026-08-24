/**
 * The graph canvas: SVG drawing, pan, zoom, node dragging, focus highlighting
 * and SVG export. It owns no session state — positions and selection come in
 * from main.ts, and every gesture is reported back so the history can record
 * it.
 */
import type { EventGraph, EventGraphEdge, EventGraphNode, EventGraphParams } from "@px-lsp/protocol/protocol";
import { NODE_H, NODE_W, rankNodes, type LayoutPos } from "../layout";
import { ForceSim } from "../force";
import { iconEl } from "../../shared/icons";

const SVG_NS = "http://www.w3.org/2000/svg";
/**
 * Edge labels render permanently only in sparse graphs; above this count they
 * appear on demand, for the selected node's own edges (label overlap is the
 * classic dense-graph failure). Delay/weight chips are exempt: they are the
 * WHEN of an edge, short, and few.
 */
const LABELS_ALWAYS_MAX = 25;
/** Cards grow step rows only while the graph is small enough to afford them. */
const STEPS_MAX_NODES = 150;
/** The compact card is the header; rows stack under it. */
const HEADER_H = NODE_H;
const ROW_H = 20;
const CARD_PAD_BOTTOM = 6;
/** Pointer travel that turns a press into a drag rather than a click. */
const DRAG_SLOP = 4;
/**
 * How far out and in the canvas goes: out far enough for a whole namespace of
 * 260 px cards, in far enough to read a card's third line unaided.
 */
const ZOOM_MIN = 0.08;
const ZOOM_MAX = 5;

type Kind = "event" | "on_action" | "decision" | "other";

export interface ViewCallbacks {
  onSelect(id: string | null): void;
  onOpen(file: string, line?: number): void;
  onRefocus(id: string): void;
  /** A node was dragged to a new place in graph coordinates. */
  onMove(id: string, x: number, y: number): void;
  /** A theme whose illustration has not been asked for yet. */
  onNeedBanner(theme: string): void;
  /** A card's step row was clicked: the inspector should land on it. */
  onOpenStep(id: string, line: number): void;
}

export interface RenderOptions {
  positions: Record<string, { x: number; y: number }>;
  titleMode: "raw" | "loc";
  banner: boolean;
}

interface EdgeItem {
  from: string;
  to: string;
  path: SVGPathElement;
  /** The invisible wide twin that makes the thin line hoverable. */
  hit: SVGPathElement;
  label: SVGTextElement | null;
  labelsAlways: boolean;
  /** Row index the edge leaves from on the source card, or null = the border. */
  fromRow: number | null;
  /** Closes a cycle: drawn as a return arc, not a forward step. */
  back: boolean;
  /** The always-on "when" chip (delay or weight), positioned with the path. */
  chip: SVGGElement | null;
}

/** How many rows a card gets; the true option count backs the "+N more" row. */
function stepRows(node: EventGraphNode): number {
  const steps = node.steps ?? [];
  if (steps.length === 0) return 0;
  const shownOptions = steps.filter((s) => s.phase === "option").length;
  const more = (node.options ?? 0) > shownOptions ? 1 : 0;
  return steps.length + more;
}

function nodeHeight(node: EventGraphNode, stepsOn: boolean): number {
  const rows = stepsOn ? stepRows(node) : 0;
  return rows === 0 ? NODE_H : HEADER_H + rows * ROW_H + CARD_PAD_BOTTOM;
}

/** ① ② …: an option row's number, compact enough for a card. */
function circled(index: number): string {
  return index < 20 ? String.fromCharCode(0x2460 + index) : String(index + 1);
}

/** A hub grows with its wiring: up to +35% for a card ten edges touch. */
function hubScale(degree: number): number {
  return Math.min(1.35, 1 + Math.max(0, degree - 2) * 0.045);
}

/** "30d" / "7–14d" / "2mo" back into a sentence for the chip's hover. */
function delayTitle(delay: string): string {
  const m = /^(.+?)(d|mo|y)$/.exec(delay);
  if (!m) return `Fires ${delay} after this step`;
  const unit = m[2] === "d" ? "day" : m[2] === "mo" ? "month" : "year";
  const plural = m[1] === "1" ? unit : `${unit}s`;
  return `Fires ${m[1]} ${plural} after this step runs (trigger_event delay)`;
}

/** What an edge label's shorthand means, spelled out for its hover. */
function labelTitle(label: string): string {
  if (label.startsWith("via "))
    return `Fired through scripted effects: the source calls ${label.slice(4)}, and the last one names the target. Any delay lives inside those effects and is not shown here.`;
  if (label.startsWith("option"))
    return `Fired when the player picks this option${label.startsWith("option: ") ? `: “${label.slice(8)}”` : ""}.`;
  const sections: Record<string, string> = {
    immediate: "Runs the moment the event appears, before the player chooses (immediate block).",
    after: "Runs once the player has picked any option (after block).",
    random_events: "Picked at random from this on_action's pool.",
    events: "Fired by this on_action, all entries together.",
    first_valid: "The first entry whose trigger holds fires; the rest are skipped.",
    on_actions: "Chains into another on_action.",
    trigger: "Referenced inside a trigger block: a condition mentions it, it is not necessarily fired.",
    effect: "Fired from the effect block.",
  };
  return sections[label] ?? `Fired from the ${label} block.`;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {}
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function kindKey(kind: string): Kind {
  return kind === "event" || kind === "on_action" || kind === "decision" ? kind : "other";
}

/** vanilla = dashed, parent mod = dotted, this mod = solid. */
function sourceDash(source: EventGraphNode["source"]): string {
  if (source === "vanilla") return "5,4";
  if (source === "parent") return "2,4";
  return "0";
}

export class GraphView {
  private view = { x: 0, y: 0, scale: 1 };
  private rootGroup: SVGGElement | null = null;
  private positions = new Map<string, LayoutPos>();
  private nodeGroups = new Map<string, SVGGElement>();
  private nodeRects = new Map<string, { rect: SVGRectElement; node: EventGraphNode }>();
  private edgeItems: EdgeItem[] = [];
  private hiddenKinds = new Set<string>();
  private selectedId: string | null = null;
  private rootId: string | null = null;
  private options: RenderOptions = { positions: {}, titleMode: "raw", banner: false };
  /** theme -> webview url, or null when the theme resolves to no picture. */
  private banners = new Map<string, string | null>();
  private askedBanners = new Set<string>();
  private lastGraph: EventGraph | null = null;
  /** Per-node card box, already hub-scaled; the layout keeps the boxes apart. */
  private heights = new Map<string, number>();
  private widths = new Map<string, number>();
  private scales = new Map<string, number>();
  private stepsOn = true;
  /** `from→to` pairs that close a cycle: drawn as return arcs. */
  private backSet = new Set<string>();
  /**
   * The live simulation. It outlives a redraw: a title-mode switch or a banner
   * arriving rebuilds the DOM over the SAME positions, and only a different
   * graph (or focus) warms it up again, so the map never twitches for nothing.
   */
  private sim: ForceSim | null = null;
  private simKey = "";
  private frame: number | null = null;

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly cb: ViewCallbacks
  ) {
    this.installGestures();
  }

  /** A theme's illustration arrived (or is known to be missing): redraw. */
  setBannerUrl(theme: string, url: string | null): void {
    this.banners.set(theme, url);
    if (this.options.banner && this.lastGraph) this.redraw();
  }

  setOptions(next: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...next };
    if (this.lastGraph) this.redraw();
  }

  render(graph: EventGraph, params: EventGraphParams, options: RenderOptions): void {
    this.lastGraph = graph;
    this.options = options;
    this.rootId = params.root ?? null;
    this.selectedId = null;
    this.draw(true);
  }

  private redraw(): void {
    this.draw(false);
  }

  private draw(refit: boolean): void {
    const graph = this.lastGraph;
    if (!graph) return;
    this.nodeRects.clear();
    this.nodeGroups.clear();
    this.edgeItems = [];
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    const nodes = graph.nodes ?? [];
    const edges = graph.edges ?? [];
    if (nodes.length === 0) return;

    this.stepsOn = nodes.length <= STEPS_MAX_NODES;
    // A hub's card grows with its degree, so the busy nodes read as the busy ones.
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    this.scales = new Map(nodes.map((n) => [n.id, hubScale(degree.get(n.id) ?? 0)]));
    this.heights = new Map(nodes.map((n) => [n.id, nodeHeight(n, this.stepsOn) * this.scales.get(n.id)!]));
    this.widths = new Map(nodes.map((n) => [n.id, NODE_W * this.scales.get(n.id)!]));
    this.backSet = rankNodes(nodes, edges).back;

    // The simulation is fed only when the graph itself changed; cards that
    // survive a refocus keep their place.
    const key = `${this.rootId ?? ""}|${nodes.map((n) => n.id).join(",")}|${edges.map((e) => `${e.from}>${e.to}`).join(",")}`;
    const simNodes = nodes.map((n) => ({
      id: n.id,
      height: this.heights.get(n.id),
      width: this.widths.get(n.id),
    }));
    if (!this.sim) this.sim = new ForceSim(simNodes, edges, this.rootId ?? undefined);
    else if (key !== this.simKey) this.sim.update(simNodes, edges, this.rootId ?? undefined);
    this.simKey = key;
    // A dragged card stays where the user put it; everything else is the
    // simulation's, so a re-layout never silently undoes a drag.
    for (const n of this.sim.nodes) {
      const at = this.options.positions[n.id];
      if (at) this.sim.pin(n.id, at.x, at.y);
      else this.sim.unpin(n.id);
    }
    // Settle BEFORE the first paint: the reader never sees cards shuffling
    // into place (or briefly overlapping) on a transition. Only a drag
    // animates, because there a moving picture is the point.
    if (this.sim.running) this.sim.settle();
    this.positions = this.sim.positions();

    this.svg.appendChild(this.defs());
    const g = svgEl("g");
    this.rootGroup = g;
    this.svg.appendChild(g);

    const edgeLayer = svgEl("g");
    g.appendChild(edgeLayer);
    const labelsAlways = edges.length <= LABELS_ALWAYS_MAX;
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    for (const edge of edges) {
      if (!this.positions.has(edge.from) || !this.positions.has(edge.to)) continue;
      // The row the edge leaves from, by SOURCE LINE: a capped row list can
      // never mis-anchor an edge, it just falls back to the card's border.
      let fromRow: number | null = null;
      const steps = this.stepsOn ? nodeById.get(edge.from)?.steps : undefined;
      if (steps && edge.fromLine !== undefined) {
        const i = steps.findIndex((s) => s.line === edge.fromLine);
        if (i >= 0) fromRow = i;
      }
      const item = this.drawEdge(edgeLayer, edge, labelsAlways, fromRow);
      this.edgeItems.push(item);
      this.placeEdge(item);
    }

    for (const node of nodes) {
      const at = this.positions.get(node.id);
      if (at) g.appendChild(this.drawNode(node, at));
    }

    this.applyFocus();
    if (refit) this.fit();
    this.applyTransform();
  }

  /**
   * Run the simulation at the frame rate until it cools, moving the cards and
   * their edges each frame — the DRAG path only: a new graph settles before
   * its first paint instead. Idle is silent: no frame is scheduled while the
   * temperature is out.
   */
  private animate(): void {
    if (this.frame !== null || !this.sim) return;
    const step = (): void => {
      this.frame = null;
      const sim = this.sim;
      if (!sim) return;
      const warm = sim.tick();
      this.positions = sim.positions();
      this.placeAll();
      if (warm) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  /** Put every card and edge where the positions say, without rebuilding the DOM. */
  private placeAll(): void {
    for (const [id, group] of this.nodeGroups) {
      const at = this.positions.get(id);
      if (at) {
        const h = this.heights.get(id) ?? NODE_H;
        const w = this.widths.get(id) ?? NODE_W;
        const s = this.scales.get(id) ?? 1;
        group.setAttribute("transform", `translate(${at.x - w / 2},${at.y - h / 2}) scale(${s})`);
      }
    }
    for (const item of this.edgeItems) this.placeEdge(item);
  }

  /**
   * Route one edge: out of the RIGHT SIDE of the source (its own row's port
   * when it has one, the card's center-right otherwise) into the CENTER OF
   * THE TARGET'S LEFT SIDE — one exit side, one entry point, so the flow
   * always reads left-to-right — as an S-bend with horizontal tangents. A
   * back edge takes the same geometry with its own style: it loops
   * right-to-left, which is what "loops back" should look like.
   */
  private placeEdge(item: EdgeItem): void {
    const a = this.positions.get(item.from);
    const b = this.positions.get(item.to);
    if (!a || !b) return;
    const ha = this.heights.get(item.from) ?? NODE_H;
    const wa = this.widths.get(item.from) ?? NODE_W;
    const wb = this.widths.get(item.to) ?? NODE_W;
    const sa = this.scales.get(item.from) ?? 1;
    const sx = a.x + wa / 2 + 2;
    const sy =
      item.fromRow !== null ? a.y - ha / 2 + (HEADER_H + item.fromRow * ROW_H + ROW_H / 2) * sa : a.y;
    const end = { x: b.x - wb / 2 - 2, y: b.y };
    const k = Math.max(50, Math.abs(end.x - sx) * 0.35);
    const d = `M ${sx} ${sy} C ${sx + k} ${sy}, ${end.x - k} ${end.y}, ${end.x} ${end.y}`;
    item.path.setAttribute("d", d);
    item.hit.setAttribute("d", d);
    // Horizontal tangents make the cubic's midpoint the plain average.
    const mx = (sx + end.x) / 2;
    const my = (sy + end.y) / 2;
    if (item.chip) item.chip.setAttribute("transform", `translate(${mx},${my})`);
    if (item.label) {
      item.label.setAttribute("x", String(mx));
      item.label.setAttribute("y", String(my - (item.chip ? 14 : 4)));
    }
  }

  private defs(): SVGDefsElement {
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
    // The hatch a card wears when its theme has no picture we could resolve.
    const hatch = svgEl("pattern", {
      id: "hatch",
      width: "6",
      height: "6",
      patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)",
    });
    hatch.appendChild(
      svgEl("line", {
        x1: "0",
        y1: "0",
        x2: "0",
        y2: "6",
        stroke: "currentColor",
        "stroke-width": "1.5",
        opacity: "0.28",
      })
    );
    defs.appendChild(hatch);
    // Clip so an illustration stays inside its card's rounded corners.
    const clip = svgEl("clipPath", { id: "cardClip" });
    clip.appendChild(svgEl("rect", { width: String(NODE_W), height: String(NODE_H), rx: "6", ry: "6" }));
    defs.appendChild(clip);
    // The scrim over an illustration. Text never sits on the picture itself:
    // the side the words start on is the dark end, and it lightens away.
    const scrim = svgEl("linearGradient", { id: "scrim", x1: "0", y1: "0", x2: "1", y2: "0" });
    for (const [offset, opacity] of [
      ["0", "0.85"],
      ["1", "0.55"],
    ]) {
      scrim.appendChild(svgEl("stop", { offset, "stop-color": "rgb(16,16,16)", "stop-opacity": opacity }));
    }
    defs.appendChild(scrim);
    return defs;
  }

  private drawEdge(
    layer: SVGGElement,
    edge: EventGraphEdge,
    labelsAlways: boolean,
    fromRow: number | null
  ): EdgeItem {
    const back = this.backSet.has(`${edge.from}→${edge.to}`);
    const path = svgEl("path", {
      class: "edge-path" + (back ? " edge-back" : ""),
      "stroke-width": "1.3",
      "marker-end": "url(#arrow)",
    });
    layer.appendChild(path);
    // A 1.3px stroke is no hover target: an invisible wide twin under the
    // pointer carries the connector's story.
    const hit = svgEl("path", { class: "edge-hit" });
    const title = svgEl("title");
    title.textContent =
      `${edge.from} → ${edge.to}` +
      (edge.label || edge.phase ? `\nfrom: ${edge.label ?? edge.phase}` : "") +
      (edge.delay ? `\nwhen: ${delayTitle(edge.delay)}` : "") +
      (edge.weight !== undefined ? `\nwhen: picked at random from this pool, weight ${edge.weight}` : "") +
      (back ? "\nloops back to an earlier step in the sequence" : "");
    hit.appendChild(title);
    layer.appendChild(hit);

    // The WHEN chip: a delay ("30d") or a random weight ("w 100"), always on,
    // and it explains itself on hover.
    const chipText = edge.delay ?? (edge.weight !== undefined ? `w ${edge.weight}` : null);
    let chip: SVGGElement | null = null;
    if (chipText) {
      chip = svgEl("g", { class: "edge-chip" + (edge.delay ? "" : " edge-chip-random") });
      const w = chipText.length * 6.5 + 10;
      chip.appendChild(
        svgEl("rect", { x: String(-w / 2), y: "-8", width: String(w), height: "16", rx: "8" })
      );
      const t = svgEl("text", { x: "0", y: "4", "text-anchor": "middle" });
      t.textContent = chipText;
      chip.appendChild(t);
      const chipTip = svgEl("title");
      chipTip.textContent = edge.delay
        ? delayTitle(edge.delay)
        : `Picked at random from this pool: weight ${edge.weight} (relative chance against the pool's other entries)`;
      chip.appendChild(chipTip);
      layer.appendChild(chip);
    }

    // A row-anchored edge already SHOWS its origin (the port it leaves from);
    // a text label would say the same thing twice.
    let text: SVGTextElement | null = null;
    if (edge.label && fromRow === null) {
      text = svgEl("text", {
        class: "edge-label" + (labelsAlways ? "" : " hidden"),
        "text-anchor": "middle",
      });
      text.textContent = edge.label;
      const labelTip = svgEl("title");
      labelTip.textContent = labelTitle(edge.label);
      text.appendChild(labelTip);
      layer.appendChild(text);
    }
    return { from: edge.from, to: edge.to, path, hit, label: text, labelsAlways, fromRow, back, chip };
  }

  /**
   * One card: the name in a size you can read across the canvas, then what kind
   * of thing it is, then what it asks for and what it leads to — and, for a
   * mod event, its STEP ROWS in execution order (immediate, the options, after),
   * each with the port its edges leave from. The kind is said twice, as a bar
   * and as the border's hue, so it survives an illustration behind the card.
   */
  private drawNode(node: EventGraphNode, at: LayoutPos): SVGGElement {
    const isRoot = this.rootId !== null && node.id === this.rootId;
    const kind = kindKey(node.kind);
    // Content draws at base size; the hub scale lives in the transform.
    const h = nodeHeight(node, this.stepsOn);
    const s = this.scales.get(node.id) ?? 1;
    const group = svgEl("g", {
      class: "node" + (isRoot ? " root" : ""),
      transform: `translate(${at.x - (NODE_W * s) / 2},${at.y - (h * s) / 2}) scale(${s})`,
    });
    group.dataset.id = node.id;
    group.dataset.kind = kind;

    const rect = svgEl("rect", {
      class: "node-rect",
      width: String(NODE_W),
      height: String(h),
      rx: "6",
      ry: "6",
      "stroke-dasharray": sourceDash(node.source),
    });
    rect.style.stroke = `color-mix(in oklch, var(--eg-${kind}) 35%, transparent)`;
    const tip = svgEl("title");
    tip.textContent =
      node.id +
      (node.title ? ": " + node.title : "") +
      `  [${node.kind} · ${node.source}]` +
      (node.file ? `\n${node.file}${node.line ? ":" + node.line : ""}` : "") +
      "\nclick: focus and inspect · drag: move · double-click: open source · right-click: re-centre";
    rect.appendChild(tip);
    group.appendChild(rect);
    this.nodeRects.set(node.id, { rect, node });
    this.nodeGroups.set(node.id, group);

    if (this.options.banner && this.drawBanner(group, node)) group.classList.add("on-banner");

    group.appendChild(
      svgEl("rect", {
        x: "6",
        y: "8",
        width: "3",
        height: String(h - 16),
        rx: "1.5",
        fill: `var(--eg-${kind})`,
        "pointer-events": "none",
      })
    );
    if (isRoot) {
      group.appendChild(
        svgEl("rect", {
          class: "node-outline",
          x: "-3",
          y: "-3",
          width: String(NODE_W + 6),
          height: String(h + 6),
          rx: "8",
          ry: "8",
        })
      );
    }

    const primary = this.options.titleMode === "loc" && node.title ? node.title : node.id;
    const title = svgEl("text", { class: "node-title", x: "16", y: "24" });
    // The title stops short of the corner the hover button sits in.
    title.textContent = clip(primary, 25);
    const meta = svgEl("text", { class: "node-sub", x: "16", y: "44" });
    meta.textContent = clip(metaLine(node), 35);
    const sub = svgEl("text", { class: "node-sub", x: "16", y: "61" });
    sub.textContent = clip(subLine(node), 35);
    group.append(title, meta, sub);

    // The step rows: what happens, in the order it happens, each with the
    // port its edges leave from. A port with nothing wired to it is honest
    // too: that choice ends the chain.
    const steps = this.stepsOn ? (node.steps ?? []) : [];
    if (steps.length > 0) {
      group.appendChild(
        svgEl("line", {
          class: "step-sep",
          x1: "8",
          y1: String(HEADER_H - 4),
          x2: String(NODE_W - 8),
          y2: String(HEADER_H - 4),
        })
      );
      steps.forEach((step, i) => {
        const y = HEADER_H + i * ROW_H;
        const row = svgEl("text", {
          class: "node-step" + (step.phase === "option" ? "" : " node-step-auto"),
          x: "16",
          y: String(y + 14),
          "data-step-line": String(step.line),
        });
        row.textContent =
          step.phase === "option"
            ? `${circled(step.index ?? i)} ${clip(step.text ?? "option", 30)}`
            : step.phase;
        const rowTip = svgEl("title");
        rowTip.textContent = "Click: open this step in the inspector";
        row.appendChild(rowTip);
        group.appendChild(row);
        group.appendChild(
          svgEl("circle", {
            class: "step-port" + (step.phase === "option" ? "" : " step-port-auto"),
            cx: String(NODE_W - 10),
            cy: String(y + ROW_H / 2),
            r: "3",
            "data-step-line": String(step.line),
          })
        );
      });
      const hidden = (node.options ?? 0) - steps.filter((s) => s.phase === "option").length;
      if (hidden > 0) {
        const more = svgEl("text", {
          class: "node-step node-step-auto",
          x: "16",
          y: String(HEADER_H + steps.length * ROW_H + 14),
        });
        more.textContent = `+${hidden} more option${hidden === 1 ? "" : "s"}`;
        group.appendChild(more);
      }
    }
    if (node.file) group.appendChild(this.drawOpenButton(node));

    group.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      if (node.file) this.cb.onOpen(node.file, node.line);
    });
    group.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.cb.onRefocus(node.id);
    });
    group.addEventListener("pointerdown", (ev) => this.beginNodeDrag(ev, node));
    return group;
  }

  /**
   * The card's own "open the source" button, in its top right corner and only
   * while the pointer is on the card. It is drawn in SVG rather than as an
   * HTML button in a foreignObject: a foreignObject clips its content, which
   * would cut the tooltip off, and the card already tells the rest of its
   * story through SVG <title>. Pressing it neither selects nor drags the card.
   */
  private drawOpenButton(node: EventGraphNode): SVGGElement {
    const button = svgEl("g", { class: "card-open", transform: `translate(${NODE_W - 26},6)` });
    button.appendChild(svgEl("rect", { class: "card-open-bg", width: "20", height: "20", rx: "6", ry: "6" }));
    const glyph = iconEl("fileText", "card-open-icon");
    for (const [k, v] of [
      ["x", "4"],
      ["y", "4"],
      ["width", "12"],
      ["height", "12"],
    ]) {
      glyph.setAttribute(k, v);
    }
    button.appendChild(glyph);
    const tip = svgEl("title");
    tip.textContent = "Open the event's source";
    button.appendChild(tip);
    button.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    button.addEventListener("dblclick", (ev) => ev.stopPropagation());
    button.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (node.file) this.cb.onOpen(node.file, node.line);
    });
    return button;
  }

  /**
   * The theme's illustration behind the card, under a scrim dark enough that
   * the text never sits on the picture itself. A missing texture is never
   * silently left blank: a blank card would read as "this theme has no art", so
   * it gets a hatched box that says otherwise. Answers whether a real picture
   * went down, which is what decides the text color.
   */
  private drawBanner(group: SVGGElement, node: EventGraphNode): boolean {
    const theme = node.theme;
    if (!theme) return false;
    if (!this.banners.has(theme)) {
      if (!this.askedBanners.has(theme)) {
        this.askedBanners.add(theme);
        this.cb.onNeedBanner(theme);
      }
      return false;
    }
    const url = this.banners.get(theme) ?? null;
    const holder = svgEl("g", { "clip-path": "url(#cardClip)", "pointer-events": "none" });
    if (url) {
      holder.appendChild(
        svgEl("image", {
          class: "node-banner",
          href: url,
          x: "0",
          y: "0",
          width: String(NODE_W),
          height: String(NODE_H),
          preserveAspectRatio: "xMidYMid slice",
        })
      );
      holder.appendChild(
        svgEl("rect", { width: String(NODE_W), height: String(NODE_H), fill: "url(#scrim)" })
      );
    } else {
      holder.appendChild(
        svgEl("rect", {
          class: "banner-missing",
          width: String(NODE_W),
          height: String(NODE_H),
        })
      );
      const note = svgEl("text", {
        class: "banner-missing-label",
        x: String(NODE_W - 5),
        y: String(NODE_H - 4),
        "text-anchor": "end",
      });
      note.textContent = "no banner texture";
      holder.appendChild(note);
    }
    group.appendChild(holder);
    return url !== null;
  }

  // --- selection and filtering ---------------------------------------------

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.applyFocus();
  }

  setHiddenKinds(kinds: Set<string>): void {
    this.hiddenKinds = kinds;
    this.applyFocus();
  }

  /** Typing in the query box outlines the cards it matches, by id or title. */
  highlight(query: string): void {
    const q = query.trim().toLowerCase();
    this.nodeRects.forEach((entry) => {
      const hit =
        q.length > 1 &&
        (entry.node.id.toLowerCase().includes(q) || (entry.node.title ?? "").toLowerCase().includes(q));
      entry.rect.classList.toggle("search-hit", hit);
    });
  }

  /**
   * Focus and context: the selection's WHOLE CHAIN stays lit — everything
   * that leads to it (orange) and everything it leads to (blue), however
   * many hops away — and the rest dims (never hides, so the mental map
   * survives). The kind filter dims through the same path.
   */
  private applyFocus(): void {
    const id = this.selectedId;
    const anc = new Set<string>();
    const desc = new Set<string>();
    if (id !== null) {
      const out = new Map<string, string[]>();
      const inc = new Map<string, string[]>();
      const link = (map: Map<string, string[]>, a: string, b: string): void => {
        const list = map.get(a);
        if (list) list.push(b);
        else map.set(a, [b]);
      };
      for (const e of this.edgeItems) {
        link(out, e.from, e.to);
        link(inc, e.to, e.from);
      }
      for (const [links, set] of [
        [out, desc],
        [inc, anc],
      ] as const) {
        const queue: string[] = [id];
        while (queue.length > 0) {
          for (const next of links.get(queue.pop()!) ?? []) {
            if (next === id || set.has(next)) continue;
            set.add(next);
            queue.push(next);
          }
        }
      }
    }
    const lit = (nid: string): boolean => nid === id || anc.has(nid) || desc.has(nid);
    this.nodeGroups.forEach((group, nid) => {
      group.classList.toggle("selected", id !== null && nid === id);
      group.classList.toggle(
        "dim",
        (id !== null && !lit(nid)) || this.hiddenKinds.has(group.dataset.kind ?? "")
      );
    });
    for (const e of this.edgeItems) {
      // An edge is on the chain when it lies on a directed path INTO the
      // selection (upstream) or OUT of it (downstream) — not merely when both
      // ends happen to be lit.
      const down = id !== null && (e.from === id || desc.has(e.from)) && desc.has(e.to);
      const up = id !== null && anc.has(e.from) && (e.to === id || anc.has(e.to));
      const touches = down || up;
      e.path.classList.toggle("dim", id !== null && !touches);
      e.path.classList.toggle("out-of-sel", down);
      e.path.classList.toggle("into-sel", up && !down);
      e.path.setAttribute(
        "marker-end",
        touches ? (down ? "url(#arrowOut)" : "url(#arrowIn)") : "url(#arrow)"
      );
      if (e.label) {
        e.label.classList.toggle("hidden", !e.labelsAlways && !touches);
        e.label.classList.toggle("dim", id !== null && !touches);
      }
      if (e.chip) e.chip.classList.toggle("dim", id !== null && !touches);
    }
  }

  // --- view transform -------------------------------------------------------

  private applyTransform(): void {
    if (!this.rootGroup) return;
    this.rootGroup.setAttribute(
      "transform",
      `translate(${this.view.x},${this.view.y}) scale(${this.view.scale})`
    );
  }

  zoomBy(factor: number): void {
    const rect = this.svg.getBoundingClientRect();
    this.zoomAt(rect.width / 2, rect.height / 2, factor);
  }

  private zoomAt(cx: number, cy: number, factor: number): void {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.view.scale * factor));
    this.view.x = cx - (cx - this.view.x) * (next / this.view.scale);
    this.view.y = cy - (cy - this.view.y) * (next / this.view.scale);
    this.view.scale = next;
    this.applyTransform();
  }

  fit(): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    this.positions.forEach((p, id) => {
      const half = (this.heights.get(id) ?? NODE_H) / 2;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y - half + NODE_H / 2);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y + half - NODE_H / 2);
    });
    const rect = this.svg.getBoundingClientRect();
    const vw = rect.width || 800;
    const vh = rect.height || 600;
    if (!Number.isFinite(minX)) {
      this.view = { x: vw / 2, y: vh / 2, scale: 1 };
      this.applyTransform();
      return;
    }
    const w = maxX - minX + NODE_W + 80;
    const h = maxY - minY + NODE_H + 80;
    this.view.scale = Math.min(1.2, Math.max(ZOOM_MIN, Math.min(vw / w, vh / h)));
    this.view.x = vw / 2 - ((minX + maxX) / 2) * this.view.scale;
    this.view.y = vh / 2 - ((minY + maxY) / 2) * this.view.scale;
    this.applyTransform();
  }

  // --- gestures -------------------------------------------------------------

  private dragging = false;
  private panFrom = { x: 0, y: 0 };
  private pressAt: { x: number; y: number } | null = null;
  private nodeDrag: {
    id: string;
    node: EventGraphNode;
    pointerId: number;
    from: { x: number; y: number };
    origin: LayoutPos;
    moved: boolean;
    /** The step row the press landed on, so a plain click can open it. */
    stepLine: number | null;
  } | null = null;

  private beginNodeDrag(ev: PointerEvent, node: EventGraphNode): void {
    if (ev.button !== 0) return;
    const at = this.positions.get(node.id);
    if (!at) return;
    ev.stopPropagation();
    const stepEl = (ev.target as Element | null)?.closest?.("[data-step-line]");
    this.nodeDrag = {
      id: node.id,
      node,
      pointerId: ev.pointerId,
      from: { x: ev.clientX, y: ev.clientY },
      origin: { x: at.x, y: at.y },
      moved: false,
      stepLine: stepEl ? Number(stepEl.getAttribute("data-step-line")) : null,
    };
  }

  /**
   * Left or middle drag pans, the same gesture the designer canvas uses. Middle
   * needs preventDefault on the press and the auxclick or the browser starts its
   * own autoscroll on top of the pan, and it captures the pointer because a
   * release outside the webview never delivers a window mouseup.
   */
  private installGestures(): void {
    const svg = this.svg;
    svg.addEventListener("pointerdown", (ev) => {
      if (this.nodeDrag) return;
      if (ev.button === 0) this.pressAt = { x: ev.clientX, y: ev.clientY };
      if (ev.button !== 0 && ev.button !== 1) return;
      if (ev.button === 1) {
        ev.preventDefault();
        svg.setPointerCapture(ev.pointerId);
      }
      this.dragging = true;
      this.panFrom = { x: ev.clientX - this.view.x, y: ev.clientY - this.view.y };
      svg.classList.add("dragging");
    });
    window.addEventListener("pointermove", (ev) => {
      const drag = this.nodeDrag;
      if (drag) {
        const dx = ev.clientX - drag.from.x;
        const dy = ev.clientY - drag.from.y;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_SLOP) return;
        drag.moved = true;
        const at = {
          x: drag.origin.x + dx / this.view.scale,
          y: drag.origin.y + dy / this.view.scale,
        };
        this.positions.set(drag.id, at);
        // The card follows the hand and the rest of the map makes room for
        // it: the simulation is pinned there and warmed a little.
        if (this.sim) {
          this.sim.pin(drag.id, at.x, at.y);
          this.sim.reheat(0.25);
          this.animate();
        } else {
          this.placeAll();
        }
        return;
      }
      if (!this.dragging) return;
      this.view.x = ev.clientX - this.panFrom.x;
      this.view.y = ev.clientY - this.panFrom.y;
      this.applyTransform();
    });
    const endDrag = (ev: PointerEvent): void => {
      const drag = this.nodeDrag;
      if (drag) {
        this.nodeDrag = null;
        if (drag.moved) {
          const at = this.positions.get(drag.id)!;
          // Redrawing the edges is the cheapest correct answer; a graph small
          // enough to hand-arrange is small enough to redraw.
          this.cb.onMove(drag.id, at.x, at.y);
        } else if (drag.stepLine !== null) {
          // One path, not select-then-open: a second select would re-render
          // the inspector and wipe the reveal the first one just did.
          this.cb.onOpenStep(drag.id, drag.stepLine);
        } else {
          this.cb.onSelect(drag.id);
        }
        return;
      }
      if (!this.dragging) return;
      this.dragging = false;
      svg.classList.remove("dragging");
      if (svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    svg.addEventListener("auxclick", (ev) => {
      if (ev.button === 1) ev.preventDefault();
    });
    svg.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const rect = svg.getBoundingClientRect();
        this.zoomAt(ev.clientX - rect.left, ev.clientY - rect.top, ev.deltaY < 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false }
    );
    // Clicking empty canvas deselects, unless the click ended a pan.
    svg.addEventListener("click", (ev) => {
      if (ev.target !== svg) return;
      const at = this.pressAt;
      if (at && Math.abs(ev.clientX - at.x) + Math.abs(ev.clientY - at.y) > DRAG_SLOP) return;
      this.cb.onSelect(null);
    });
  }

  // --- export ---------------------------------------------------------------

  serializeSvg(): string {
    const clone = this.svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", SVG_NS);
    // The hover button and the hover-only hit paths belong to the canvas,
    // not to a file: a picture cannot open anything or show a tooltip.
    for (const node of Array.from(clone.querySelectorAll(".card-open, .edge-hit"))) node.remove();
    // Bake the computed colors in: the exported file has no stylesheet, and the
    // live one paints through CSS variables. Circles are the step ports.
    const live = Array.from(this.svg.querySelectorAll<SVGElement>("rect, path, text, circle, line")).filter(
      (node) => node.closest(".card-open") === null && !node.classList.contains("edge-hit")
    );
    const copies = clone.querySelectorAll<SVGElement>("rect, path, text, circle, line");
    live.forEach((node, i) => {
      const cs = getComputedStyle(node);
      const copy = copies[i];
      if (!copy) return;
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
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/** The card's second line: what kind of thing it is, and how much of it. */
function metaLine(node: EventGraphNode): string {
  const kind = node.kind === "unknown" ? "not indexed" : node.kind;
  if (node.options === undefined) return kind;
  return `${kind} · ${node.options} option${node.options === 1 ? "" : "s"}`;
}

/**
 * The card's third line: what it asks for before it runs, and what it leads to.
 * "no trigger" is only claimed for a definition the server actually read; for
 * anything else silence is the honest answer.
 */
function subLine(node: EventGraphNode): string {
  const parts: string[] = [];
  if (node.triggerSummary) parts.push(`trigger: ${node.triggerSummary}`);
  else if (node.options !== undefined) parts.push("no trigger");
  if (node.fires) parts.push(`fires ${node.fires}`);
  return parts.join(" · ");
}
