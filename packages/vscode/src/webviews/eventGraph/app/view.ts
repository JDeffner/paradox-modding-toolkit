/**
 * The graph canvas: SVG drawing, pan, zoom, node dragging, focus highlighting
 * and SVG export. It owns no session state — positions and selection come in
 * from main.ts, and every gesture is reported back so the history can record
 * it.
 */
import type { EventGraph, EventGraphNode, EventGraphParams } from "@px-lsp/protocol/protocol";
import { NODE_H, NODE_W, radialLayout, type LayoutPos } from "../layout";

const SVG_NS = "http://www.w3.org/2000/svg";
/**
 * Edge labels render permanently only in sparse graphs; above this count they
 * appear on demand, for the selected node's own edges (label overlap is the
 * classic dense-graph failure).
 */
const LABELS_ALWAYS_MAX = 25;
/** Pointer travel that turns a press into a drag rather than a click. */
const DRAG_SLOP = 4;

type Kind = "event" | "on_action" | "decision" | "other";

export interface ViewCallbacks {
  onSelect(id: string | null): void;
  onOpen(file: string, line?: number): void;
  onRefocus(id: string): void;
  /** A node was dragged to a new place in graph coordinates. */
  onMove(id: string, x: number, y: number): void;
  onZoom(percent: number): void;
  /** A theme whose illustration has not been asked for yet. */
  onNeedBanner(theme: string): void;
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
  label: SVGTextElement | null;
  labelsAlways: boolean;
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

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly cb: ViewCallbacks
  ) {
    this.installGestures();
  }

  get zoomPercent(): number {
    return Math.round(this.view.scale * 100);
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

    const laid = radialLayout(nodes, edges, this.rootId ?? undefined);
    // A dragged node keeps where the user put it; everything else follows the
    // layout, so a re-layout never silently undoes a drag.
    this.positions = new Map(laid);
    for (const [id, at] of Object.entries(this.options.positions)) {
      if (this.positions.has(id)) this.positions.set(id, { x: at.x, y: at.y });
    }

    this.svg.appendChild(this.defs());
    const g = svgEl("g");
    this.rootGroup = g;
    this.svg.appendChild(g);

    const edgeLayer = svgEl("g");
    g.appendChild(edgeLayer);
    const labelsAlways = edges.length <= LABELS_ALWAYS_MAX;
    for (const edge of edges) {
      const from = this.positions.get(edge.from);
      const to = this.positions.get(edge.to);
      if (!from || !to) continue;
      const item = this.drawEdge(edgeLayer, edge.from, edge.to, edge.label, edge.via, from, to, labelsAlways);
      this.edgeItems.push(item);
    }

    for (const node of nodes) {
      const at = this.positions.get(node.id);
      if (at) g.appendChild(this.drawNode(node, at));
    }

    this.applyFocus();
    if (refit) this.fit();
    this.applyTransform();
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
    clip.appendChild(svgEl("rect", { width: String(NODE_W), height: String(NODE_H), rx: "5", ry: "5" }));
    defs.appendChild(clip);
    return defs;
  }

  private drawEdge(
    layer: SVGGElement,
    from: string,
    to: string,
    label: string | undefined,
    via: string,
    a: LayoutPos,
    b: LayoutPos,
    labelsAlways: boolean
  ): EdgeItem {
    // Meet the cards at their borders rather than their centres, so the
    // arrowhead lands on the edge of the box it points at.
    const start = borderPoint(a, b);
    const end = borderPoint(b, a);
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    const d = `M ${start.x} ${start.y} Q ${mx} ${my} ${end.x} ${end.y}`;
    const path = svgEl("path", {
      class: "edge-path",
      d,
      "stroke-width": "1.3",
      "marker-end": "url(#arrow)",
    });
    const title = svgEl("title");
    title.textContent = `${from} → ${to}  (${label || via || ""})`;
    path.appendChild(title);
    layer.appendChild(path);

    let text: SVGTextElement | null = null;
    if (label) {
      text = svgEl("text", {
        class: "edge-label" + (labelsAlways ? "" : " hidden"),
        x: String(mx),
        y: String(my - 4),
        "text-anchor": "middle",
      });
      text.textContent = label;
      layer.appendChild(text);
    }
    return { from, to, path, label: text, labelsAlways };
  }

  private drawNode(node: EventGraphNode, at: LayoutPos): SVGGElement {
    const isRoot = this.rootId !== null && node.id === this.rootId;
    const group = svgEl("g", {
      class: "node" + (isRoot ? " root" : ""),
      transform: `translate(${at.x - NODE_W / 2},${at.y - NODE_H / 2})`,
    });
    group.dataset.id = node.id;
    group.dataset.kind = kindKey(node.kind);

    const rect = svgEl("rect", {
      class: "node-rect",
      width: String(NODE_W),
      height: String(NODE_H),
      rx: "5",
      ry: "5",
      "stroke-dasharray": sourceDash(node.source),
    });
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

    if (this.options.banner) this.drawBanner(group, node);

    group.appendChild(
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

    const primary = this.options.titleMode === "loc" && node.title ? node.title : node.id;
    const secondary = this.options.titleMode === "loc" && node.title ? node.id : node.title;
    const label = svgEl("text", {
      class: "node-label",
      x: "13",
      y: String(secondary ? NODE_H / 2 - 3 : NODE_H / 2 + 4),
    });
    label.textContent = clip(primary, 21);
    group.appendChild(label);
    if (secondary) {
      const sub = svgEl("text", { class: "node-label node-sub", x: "13", y: String(NODE_H / 2 + 12) });
      sub.textContent = clip(secondary, 27);
      group.appendChild(sub);
    }

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
   * The theme's illustration behind the card, or a hatched box that says the
   * picture could not be resolved. A missing texture is never silently left
   * blank: a blank card would read as "this theme has no art".
   */
  private drawBanner(group: SVGGElement, node: EventGraphNode): void {
    const theme = node.theme;
    if (!theme) return;
    if (!this.banners.has(theme)) {
      if (!this.askedBanners.has(theme)) {
        this.askedBanners.add(theme);
        this.cb.onNeedBanner(theme);
      }
      return;
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
   * Focus and context: the selection's 1-hop neighborhood stays lit, the rest
   * dims (never hides, so the mental map survives), and its in and out edges
   * differ in color. The kind filter dims through the same path.
   */
  private applyFocus(): void {
    const id = this.selectedId;
    const neighbors = new Set<string>();
    if (id !== null) {
      neighbors.add(id);
      for (const e of this.edgeItems) {
        if (e.from === id) neighbors.add(e.to);
        if (e.to === id) neighbors.add(e.from);
      }
    }
    this.nodeGroups.forEach((group, nid) => {
      group.classList.toggle("selected", id !== null && nid === id);
      group.classList.toggle(
        "dim",
        (id !== null && !neighbors.has(nid)) || this.hiddenKinds.has(group.dataset.kind ?? "")
      );
    });
    for (const e of this.edgeItems) {
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

  // --- view transform -------------------------------------------------------

  private applyTransform(): void {
    if (!this.rootGroup) return;
    this.rootGroup.setAttribute(
      "transform",
      `translate(${this.view.x},${this.view.y}) scale(${this.view.scale})`
    );
    this.cb.onZoom(this.zoomPercent);
  }

  zoomBy(factor: number): void {
    const rect = this.svg.getBoundingClientRect();
    this.zoomAt(rect.width / 2, rect.height / 2, factor);
  }

  private zoomAt(cx: number, cy: number, factor: number): void {
    const next = Math.min(4, Math.max(0.1, this.view.scale * factor));
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
    this.positions.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
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
    this.view.scale = Math.min(1.2, Math.max(0.15, Math.min(vw / w, vh / h)));
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
  } | null = null;

  private beginNodeDrag(ev: PointerEvent, node: EventGraphNode): void {
    if (ev.button !== 0) return;
    const at = this.positions.get(node.id);
    if (!at) return;
    ev.stopPropagation();
    this.nodeDrag = {
      id: node.id,
      node,
      pointerId: ev.pointerId,
      from: { x: ev.clientX, y: ev.clientY },
      origin: { x: at.x, y: at.y },
      moved: false,
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
        this.nodeGroups
          .get(drag.id)
          ?.setAttribute("transform", `translate(${at.x - NODE_W / 2},${at.y - NODE_H / 2})`);
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
    // Bake the computed colors in: the exported file has no stylesheet, and the
    // live one paints through CSS variables.
    const live = this.svg.querySelectorAll<SVGElement>("rect, path, text");
    const copies = clone.querySelectorAll<SVGElement>("rect, path, text");
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

/** Where the line from `a` to `b` leaves a's card. */
function borderPoint(a: LayoutPos, b: LayoutPos): LayoutPos {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return { x: a.x, y: a.y };
  const halfW = NODE_W / 2 + 2;
  const halfH = NODE_H / 2 + 2;
  const scale = Math.min(
    dx === 0 ? Infinity : halfW / Math.abs(dx),
    dy === 0 ? Infinity : halfH / Math.abs(dy)
  );
  return { x: a.x + dx * scale, y: a.y + dy * scale };
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
