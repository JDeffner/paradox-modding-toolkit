/**
 * The event graph's force simulation: what makes the map settle into a shape
 * and react to a change the way a reader expects a graph to.
 *
 * Modelled on the d3-force loop everybody knows from Obsidian's graph view: a
 * temperature (`alpha`) that decays toward zero, and per tick a spring along
 * every edge, a repulsion between every pair of cards, a pull toward the
 * middle, a pull toward the card's own cluster (its namespace), and a nudge
 * that keeps what fires the focus on its left and what it fires on its right.
 * When the temperature is out the simulation STOPS: nothing moves while
 * nothing changes, and a change (a new graph, a refocus, a dragged card)
 * only re-heats it, so surviving cards glide from where they were.
 *
 * Deterministic: no Math.random, seeds come from a phyllotaxis spiral in a
 * fixed order, and two runs of the same inputs land on the same pixels. Pure:
 * no DOM, so `settle()` runs the whole thing headless in a test.
 */

export interface SimNodeInput {
  id: string;
  /** Cards of one cluster (a namespace) gather; absent = the id's own prefix. */
  cluster?: string;
}
export interface SimEdgeInput {
  from: string;
  to: string;
}
export interface SimPos {
  x: number;
  y: number;
}

export interface SimNode extends SimPos {
  id: string;
  vx: number;
  vy: number;
  /** Pinned: the root, and a card the user put somewhere. */
  fixed: boolean;
  cluster: string;
  /** 1 = downstream of the root (right), -1 = upstream (left), 0 = neither. */
  side: number;
  degree: number;
}

/** The card the renderer draws; the collision force keeps these boxes apart. */
export const NODE_W = 260;
export const NODE_H = 70;
/** Clear space demanded between two cards, on both axes. */
export const GAP = 24;
const PITCH_X = NODE_W + GAP;
const PITCH_Y = NODE_H + GAP;

/** Temperature: starts at 1, runs down to ALPHA_MIN and stops. ~200 ticks, 3 s at 60 fps. */
const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 200);
const VELOCITY_DECAY = 0.55;
/** Repulsion strength (d3 manyBody units, inverse-square over distance). */
const CHARGE = 3000;
/** Beyond this, cards no longer repel each other: keeps a 400-node mod bounded. */
const CHARGE_RANGE = PITCH_X * 3;
/** Edge rest length, and how much a busy hub stretches its own edges. */
const LINK_LENGTH = PITCH_X * 1.05;
const HUB_STRETCH = 0.1;
/** Cluster homes sit on a ring of this radius per cluster (scaled by their count). */
const CLUSTER_RING = PITCH_X * 1.4;
/** A card beside the root never sits over the root's own column. */
const MIN_SIDE_X = NODE_W / 2 + GAP;

export class ForceSim {
  readonly nodes: SimNode[] = [];
  private byId = new Map<string, SimNode>();
  private links: Array<{ a: SimNode; b: SimNode; rest: number; strength: number }> = [];
  private clusters = new Map<string, { home: SimPos; members: SimNode[] }>();
  private root: string | null = null;
  alpha = 0;

  constructor(nodes: readonly SimNodeInput[], edges: readonly SimEdgeInput[], root?: string) {
    this.update(nodes, edges, root);
  }

  get running(): boolean {
    return this.alpha >= ALPHA_MIN;
  }

  node(id: string): SimNode | undefined {
    return this.byId.get(id);
  }

  positions(): Map<string, SimPos> {
    const out = new Map<string, SimPos>();
    for (const n of this.nodes) out.set(n.id, { x: n.x, y: n.y });
    return out;
  }

  /** Warm the simulation back up; a drag uses a little, a new graph all of it. */
  reheat(alpha = 1): void {
    this.alpha = Math.max(this.alpha, alpha);
  }

  /** Pin a card where the user put it (and keep it there until released). */
  pin(id: string, x: number, y: number): void {
    const n = this.byId.get(id);
    if (!n) return;
    n.x = x;
    n.y = y;
    n.vx = 0;
    n.vy = 0;
    n.fixed = true;
  }

  unpin(id: string): void {
    const n = this.byId.get(id);
    if (n && n.id !== this.root) n.fixed = false;
  }

  /**
   * A new graph (or a new focus): cards that survive keep their place and
   * glide, new cards start beside a neighbour they are wired to, or on their
   * cluster's spiral. Pins survive too, the root's moving to the new root.
   */
  update(nodes: readonly SimNodeInput[], edges: readonly SimEdgeInput[], root?: string): void {
    const previous = this.byId;
    const known = new Set<string>();
    const keep: SimNode[] = [];
    const fresh: SimNodeInput[] = [];
    for (const input of nodes) {
      if (known.has(input.id)) continue;
      known.add(input.id);
      const old = previous.get(input.id);
      if (old) {
        old.cluster = input.cluster ?? clusterOf(input.id);
        keep.push(old);
      } else fresh.push(input);
    }
    this.nodes.length = 0;
    this.byId = new Map();
    for (const n of keep) {
      if (n.id === this.root) n.fixed = false;
      this.nodes.push(n);
      this.byId.set(n.id, n);
    }
    // Adjacency, for sides, degrees and where a new card is born.
    const out = new Map<string, string[]>();
    const inc = new Map<string, string[]>();
    for (const id of known) {
      out.set(id, []);
      inc.set(id, []);
    }
    for (const e of edges) {
      if (e.from === e.to || !known.has(e.from) || !known.has(e.to)) continue;
      out.get(e.from)!.push(e.to);
      inc.get(e.to)!.push(e.from);
    }
    // The focus is the centre; without one the busiest card is (ties by id),
    // so a namespace view still has a middle instead of a drifting cloud.
    this.root = root && known.has(root) ? root : busiest(known, out, inc);
    const side = this.sides(known, out, inc);

    // Cluster homes: every namespace gets a spot on a ring, sorted by name so
    // the same mod always lands the same way. A root's own cluster sits in the
    // middle, since the root does.
    // A cluster of one (an on_action, a lone decision) has no home: it goes
    // where its edges take it instead of being pulled onto the ring.
    const counts = new Map<string, number>();
    for (const id of known) {
      const name = this.clusterName(id, nodes);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const names = [...counts.keys()].filter((name) => counts.get(name)! > 1).sort();
    const rootCluster = this.root ? this.clusterName(this.root, nodes) : null;
    const ring = names.filter((n) => n !== rootCluster);
    const radius = ring.length <= 1 ? 0 : CLUSTER_RING * Math.sqrt(ring.length);
    this.clusters = new Map();
    ring.forEach((name, i) => {
      const angle = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
      this.clusters.set(name, {
        home: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius },
        members: [],
      });
    });
    if (rootCluster && names.includes(rootCluster))
      this.clusters.set(rootCluster, { home: { x: 0, y: 0 }, members: [] });

    // New cards: next to a placed neighbour when they have one, else on their
    // cluster's spiral, in input order.
    const spiralIndex = new Map<string, number>();
    /** How many new cards were born beside each placed card: they fan out, not pile up. */
    const born = new Map<string, number>();
    for (const input of fresh) {
      const id = input.id;
      const cluster = input.cluster ?? clusterOf(id);
      const neighbours = [...(out.get(id) ?? []), ...(inc.get(id) ?? [])]
        .map((n) => this.byId.get(n))
        .filter((n): n is SimNode => n !== undefined);
      let x: number;
      let y: number;
      const home = this.clusters.get(cluster)?.home ?? { x: 0, y: 0 };
      if (neighbours.length > 0 && id !== this.root) {
        const n = neighbours[0];
        const s = side.get(id) ?? 0;
        const k = born.get(n.id) ?? 0;
        born.set(n.id, k + 1);
        // 0, -1, +1, -2, +2 ... rows beside the neighbour, a column out from it.
        const row = k === 0 ? 0 : (k % 2 === 1 ? -1 : 1) * Math.ceil(k / 2);
        x = n.x + (s === 0 ? PITCH_X : s * PITCH_X) + (k % 3) * 30;
        y = n.y + row * PITCH_Y * 0.9;
      } else {
        const k = spiralIndex.get(cluster) ?? 0;
        spiralIndex.set(cluster, k + 1);
        // Phyllotaxis: r grows with sqrt(k), the golden angle spreads them.
        const r = PITCH_Y * Math.sqrt(k);
        const a = k * 2.399963;
        x = home.x + Math.cos(a) * r * (PITCH_X / PITCH_Y);
        y = home.y + Math.sin(a) * r;
      }
      const node: SimNode = { id, x, y, vx: 0, vy: 0, fixed: false, cluster, side: 0, degree: 0 };
      this.nodes.push(node);
      this.byId.set(id, node);
    }
    for (const n of this.nodes) {
      n.side = side.get(n.id) ?? 0;
      n.degree = (out.get(n.id)?.length ?? 0) + (inc.get(n.id)?.length ?? 0);
      this.clusters.get(n.cluster)?.members.push(n);
    }
    if (this.root) {
      const r = this.byId.get(this.root)!;
      r.x = 0;
      r.y = 0;
      r.vx = 0;
      r.vy = 0;
      r.fixed = true;
    }

    this.links = [];
    const seen = new Set<string>();
    for (const e of edges) {
      const a = this.byId.get(e.from);
      const b = this.byId.get(e.to);
      if (!a || !b || a === b) continue;
      const key = `${a.id} ${b.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hub = Math.min(10, Math.max(a.degree, b.degree) - 1);
      this.links.push({
        a,
        b,
        rest: LINK_LENGTH * (1 + HUB_STRETCH * hub),
        strength: 1 / Math.max(1, Math.min(a.degree, b.degree)),
      });
    }
    this.reheat(1);
  }

  /** One step. Returns true while the simulation is still warm. */
  tick(): boolean {
    if (this.alpha < ALPHA_MIN) return false;
    const alpha = this.alpha;
    this.alpha -= this.alpha * ALPHA_DECAY;
    if (this.alpha < ALPHA_MIN) {
      // The last step: whatever the forces left inside the gap is parted
      // now, so a cooled map keeps the hard guarantee a settled one has.
      separate(this.nodes);
      return false;
    }
    const nodes = this.nodes;

    // Springs.
    for (const l of this.links) {
      let dx = l.b.x - l.a.x;
      let dy = l.b.y - l.a.y;
      let d = Math.hypot(dx, dy);
      if (d === 0) {
        dx = 1;
        dy = 0;
        d = 1;
      }
      const f = ((d - l.rest) / d) * alpha * l.strength;
      const share = l.a.degree / (l.a.degree + l.b.degree || 1);
      l.b.vx -= dx * f * share;
      l.b.vy -= dy * f * share;
      l.a.vx += dx * f * (1 - share);
      l.a.vy += dy * f * (1 - share);
      // Reading direction: what a card fires sits to its right, what fires it
      // to its left, the same way the root's two sides are laid out. Only the
      // card further from the root is nudged, so a chain unrolls outward.
      if (l.b.side !== 0 && l.b.side === l.a.side) {
        const want = l.a.x + l.b.side * LINK_LENGTH * 0.7;
        if ((l.b.x - want) * l.b.side < 0) l.b.vx += (want - l.b.x) * 0.1 * alpha;
        l.b.vy += (l.a.y - l.b.y) * 0.03 * alpha;
      }
    }
    // Repulsion, in card units so a wide card pushes sideways as a tall one
    // pushes up: the x axis is squashed by the card's aspect.
    const aspect = PITCH_X / PITCH_Y;
    const range2 = (CHARGE_RANGE / aspect) * (CHARGE_RANGE / aspect);
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = (b.x - a.x) / aspect;
        const dy = b.y - a.y;
        let l2 = dx * dx + dy * dy;
        if (l2 >= range2) continue;
        // Coincident or nearly so: the kick is capped at a card's height, and
        // two cards on one spot part along x (the collision pass does the rest).
        const near = l2 < PITCH_Y * PITCH_Y;
        if (near) l2 = PITCH_Y * PITCH_Y;
        const w = (CHARGE * alpha) / l2;
        const px = (near && dx === 0 && dy === 0 ? PITCH_Y : dx) * w * aspect;
        const py = dy * w;
        a.vx -= px;
        a.vy -= py;
        b.vx += px;
        b.vy += py;
      }
    }
    // Gravity toward the middle, the cluster's home, and the card's side.
    for (const n of nodes) {
      n.vx -= n.x * 0.0015 * alpha;
      n.vy -= n.y * 0.0015 * alpha;
      const home = this.clusters.get(n.cluster)?.home;
      if (home && this.clusters.size > 1) {
        n.vx += (home.x - n.x) * 0.04 * alpha;
        n.vy += (home.y - n.y) * 0.04 * alpha;
      }
      if (n.side !== 0) {
        const want = n.side * PITCH_X;
        if (Math.sign(n.x) !== n.side || Math.abs(n.x) < PITCH_X * 0.6) n.vx += (want - n.x) * 0.12 * alpha;
      }
    }
    // Integrate. A card keeps its side of the root: the boundary is a wedge,
    // so a card beside the root stays off its column while one far above or
    // below may drift over it, and a crowded side wraps instead of stacking.
    for (const n of nodes) {
      if (n.fixed) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx *= VELOCITY_DECAY;
      n.vy *= VELOCITY_DECAY;
      n.x += n.vx;
      n.y += n.vy;
      if (n.side !== 0) {
        const slack = Math.min(MIN_SIDE_X - 8, Math.max(0, Math.abs(n.y) - PITCH_Y) * 0.7);
        const limit = MIN_SIDE_X - slack;
        if (n.side === 1 && n.x < limit) n.x = limit;
        if (n.side === -1 && n.x > -limit) n.x = -limit;
      }
    }
    // Collision, on the positions themselves: cards are boxes, and a box that
    // overlaps another is moved apart along the shallower axis, most of the
    // way while the graph is hot and all the way as it cools.
    separate(nodes, 1, 0.6 + 0.4 * (1 - alpha));
    return this.alpha >= ALPHA_MIN;
  }

  /** Run to rest, then part any two cards still closer than the gap. */
  settle(): Map<string, SimPos> {
    while (this.tick()) {
      /* run down */
    }
    return this.positions();
  }

  private clusterName(id: string, nodes: readonly SimNodeInput[]): string {
    return nodes.find((n) => n.id === id)?.cluster ?? clusterOf(id);
  }

  /** BFS from the root: downstream cards are side 1, upstream side -1. */
  private sides(
    known: Set<string>,
    out: Map<string, string[]>,
    inc: Map<string, string[]>
  ): Map<string, number> {
    const side = new Map<string, number>();
    if (!this.root) return side;
    side.set(this.root, 0);
    for (const [links, s] of [
      [out, 1],
      [inc, -1],
    ] as const) {
      const queue = [this.root];
      while (queue.length > 0) {
        const id = queue.shift()!;
        for (const next of links.get(id) ?? []) {
          if (side.has(next)) continue;
          side.set(next, s);
          queue.push(next);
        }
      }
    }
    return side;
  }
}

/** The most connected card, ties broken by id; null for an empty graph. */
function busiest(known: Set<string>, out: Map<string, string[]>, inc: Map<string, string[]>): string | null {
  let best: string | null = null;
  let bestDegree = -1;
  for (const id of [...known].sort()) {
    const degree = (out.get(id)?.length ?? 0) + (inc.get(id)?.length ?? 0);
    if (degree > bestDegree) {
      best = id;
      bestDegree = degree;
    }
  }
  return best;
}

/** `namespace.12` -> `namespace`; an on_action or decision is its own cluster of one name. */
export function clusterOf(id: string): string {
  const dot = id.indexOf(".");
  return dot > 0 ? id.slice(0, dot) : id;
}

/**
 * The hard guarantee after the forces are spent: no two cards inside each
 * other's gap. A few bounded sweeps along the shallower axis; pinned cards do
 * not move.
 */
function separate(nodes: SimNode[], passes = 400, strength = 1): void {
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = PITCH_X - Math.abs(dx);
        const oy = PITCH_Y - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        if (a.fixed && b.fixed) continue;
        moved = true;
        const share = (a.fixed || b.fixed ? 1 : 0.5) * strength;
        // A hair past the gap, or two cards creep toward it forever.
        if (ox <= oy) {
          const push = (dx === 0 ? ox + 1 : Math.sign(dx) * (ox + 1)) * share;
          if (!a.fixed) a.x -= push;
          if (!b.fixed) b.x += push;
        } else {
          const push = (dy === 0 ? oy + 1 : Math.sign(dy) * (oy + 1)) * share;
          if (!a.fixed) a.y -= push;
          if (!b.fixed) b.y += push;
        }
      }
    }
    if (!moved) return;
  }
}

/** The headless layout: the same simulation run to rest in one call. */
export function forceLayout(
  nodes: readonly SimNodeInput[],
  edges: readonly SimEdgeInput[],
  root?: string
): Map<string, SimPos> {
  return new ForceSim(nodes, edges, root).settle();
}
