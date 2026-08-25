/**
 * The event graph's layout: a force simulation whose X AXIS IS TIME. Every
 * card gets a rank (longest path from the chains' entry points, cycles broken
 * into marked back edges), ranks become columns, and a strong pull keeps each
 * card on its column while the usual forces (edge springs, repulsion,
 * collision) sort the vertical order out. Left to right therefore reads
 * "happens after", which is the one thing an event graph is for.
 *
 * The loop itself is the d3-force shape everybody knows from Obsidian's graph
 * view: a temperature (`alpha`) that decays toward zero, and when it is out
 * the simulation STOPS: nothing moves while nothing changes, and a change (a
 * new graph, a refocus, a dragged card) only re-heats it, so surviving cards
 * glide from where they were.
 *
 * Cards are boxes of one width but VARIABLE height (an event card grows a row
 * per option); repulsion and collision keep the boxes apart, not just points.
 *
 * Deterministic: no Math.random, seeds follow the input order, and two runs of
 * the same inputs land on the same pixels. Pure: no DOM, so `settle()` runs
 * the whole thing headless in a test.
 */

export interface SimNodeInput {
  id: string;
  /** Cards of one cluster (a namespace) gather; absent = the id's own prefix. */
  cluster?: string;
  /** Card height in px; the compact card's when absent. */
  height?: number;
  /** Card width in px (a hub scales up); the standard card's when absent. */
  width?: number;
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
  /** Sequence column: 0 = an entry nothing in the graph fires. */
  rank: number;
  /** Card box; collision keeps (a.h + b.h) / 2 + GAP clear, same for widths. */
  h: number;
  w: number;
  degree: number;
  /** No edges at all: laid out once in a static grid, never simulated. */
  parked: boolean;
}

/** The card the renderer draws; the collision force keeps these boxes apart. */
export const NODE_W = 260;
export const NODE_H = 70;
/** Clear space demanded between two cards, on both axes. */
export const GAP = 24;
/** Column pitch: a card plus room for edge curves and their delay chips. */
export const COL_W = NODE_W + 150;
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
/** Edge rest length; springs mostly order the columns' vertical neighborhoods. */
const LINK_LENGTH = PITCH_X * 1.05;
const HUB_STRETCH = 0.1;
/** Namespaces stack as horizontal bands this far apart (multi-cluster views). */
const CLUSTER_BAND = PITCH_Y * 3;

/**
 * Sequence ranks: longest path from the entry points, over the graph with its
 * cycles broken. A DFS in input order marks the edges that close a cycle
 * ("back" edges, drawn as return arcs); the remaining DAG is ranked so that
 * every forward edge goes strictly left to right. Deterministic in input order.
 */
export function rankNodes(
  nodes: readonly { id: string }[],
  edges: readonly SimEdgeInput[]
): { ranks: Map<string, number>; back: Set<string> } {
  const ids: string[] = [];
  const known = new Set<string>();
  for (const n of nodes) {
    if (known.has(n.id)) continue;
    known.add(n.id);
    ids.push(n.id);
  }
  const out = new Map<string, string[]>();
  for (const id of ids) out.set(id, []);
  const pairSeen = new Set<string>();
  for (const e of edges) {
    if (e.from === e.to || !known.has(e.from) || !known.has(e.to)) continue;
    const key = `${e.from}→${e.to}`;
    if (pairSeen.has(key)) continue;
    pairSeen.add(key);
    out.get(e.from)!.push(e.to);
  }

  // Iterative DFS, colors: 0 unseen, 1 on the stack, 2 done.
  const color = new Map<string, number>();
  const back = new Set<string>();
  for (const start of ids) {
    if (color.get(start)) continue;
    const stack: Array<{ id: string; next: number }> = [{ id: start, next: 0 }];
    color.set(start, 1);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const targets = out.get(top.id)!;
      if (top.next >= targets.length) {
        color.set(top.id, 2);
        stack.pop();
        continue;
      }
      const to = targets[top.next++];
      const c = color.get(to) ?? 0;
      if (c === 1) back.add(`${top.id}→${to}`);
      else if (c === 0) {
        color.set(to, 1);
        stack.push({ id: to, next: 0 });
      }
    }
  }

  // Longest path over the remaining DAG (Kahn), entries at rank 0.
  const ranks = new Map<string, number>();
  const indeg = new Map<string, number>();
  for (const id of ids) indeg.set(id, 0);
  for (const from of ids) {
    for (const to of out.get(from)!) {
      if (back.has(`${from}→${to}`)) continue;
      indeg.set(to, indeg.get(to)! + 1);
    }
  }
  const queue: string[] = ids.filter((id) => indeg.get(id) === 0);
  for (const id of queue) ranks.set(id, 0);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const rank = ranks.get(id)!;
    for (const to of out.get(id)!) {
      if (back.has(`${id}→${to}`)) continue;
      ranks.set(to, Math.max(ranks.get(to) ?? 0, rank + 1));
      const left = indeg.get(to)! - 1;
      indeg.set(to, left);
      if (left === 0) queue.push(to);
    }
  }
  for (const id of ids) if (!ranks.has(id)) ranks.set(id, 0);
  return { ranks, back };
}

export class ForceSim {
  readonly nodes: SimNode[] = [];
  private byId = new Map<string, SimNode>();
  private links: Array<{ a: SimNode; b: SimNode; rest: number; strength: number }> = [];
  private clusters = new Map<string, { homeY: number; members: SimNode[] }>();
  /**
   * The simulated (non-parked) nodes, grouped by rank. With x locked to the
   * columns, only SAME-COLUMN cards can ever collide, so every O(n²) pass
   * (repulsion, collision) runs per column instead of over all pairs — the
   * difference between a freeze and a blink on a 1000-card mod.
   */
  private columns: SimNode[][] = [];
  private live: SimNode[] = [];
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
   * glide, new cards are born on their column, laddering out from its middle.
   * Pins survive too, the root's moving to the new root.
   */
  update(nodes: readonly SimNodeInput[], edges: readonly SimEdgeInput[], root?: string): void {
    const previous = this.byId;
    const known = new Set<string>();
    const inputs: SimNodeInput[] = [];
    for (const input of nodes) {
      if (known.has(input.id)) continue;
      known.add(input.id);
      inputs.push(input);
    }
    const { ranks } = rankNodes(inputs, edges);

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
    const oldRoot = this.root;
    this.root = root && known.has(root) ? root : busiest(known, out, inc);

    // Namespace bands, sorted by name so the same mod always lands the same
    // way. A cluster of one (an on_action, a lone decision) has no band.
    const counts = new Map<string, number>();
    for (const input of inputs) {
      const name = input.cluster ?? clusterOf(input.id);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const bands = [...counts.keys()].filter((name) => counts.get(name)! > 1).sort();
    this.clusters = new Map();
    bands.forEach((name, i) => {
      this.clusters.set(name, { homeY: (i - (bands.length - 1) / 2) * CLUSTER_BAND, members: [] });
    });

    this.nodes.length = 0;
    this.byId = new Map();
    /** New cards stack out from their column's middle, below then above,
     *  by their own heights, so even the very first paint has no pile. */
    const ladder = new Map<number, { down: number; up: number; k: number }>();
    /** Parked (edge-less) cards: a static grid LEFT of the flow, stacked by
     *  their own heights — they carry no sequence, so they get no columns
     *  and no simulation. */
    const parkedCount = inputs.filter(
      (i) => i.id !== this.root && (out.get(i.id)?.length ?? 0) === 0 && (inc.get(i.id)?.length ?? 0) === 0
    ).length;
    const gridCols = Math.max(1, Math.ceil(Math.sqrt(parkedCount) / 1.4));
    const gridNextY: number[] = new Array<number>(gridCols).fill(0);
    let gridAt = 0;
    for (const input of inputs) {
      const id = input.id;
      const cluster = input.cluster ?? clusterOf(id);
      const rank = ranks.get(id) ?? 0;
      const h = input.height ?? NODE_H;
      const w = input.width ?? NODE_W;
      const parked = id !== this.root && (out.get(id)?.length ?? 0) === 0 && (inc.get(id)?.length ?? 0) === 0;
      const old = previous.get(id);
      let node: SimNode;
      if (old) {
        node = old;
        node.cluster = cluster;
        node.rank = rank;
        node.h = h;
        node.w = w;
        node.parked = parked;
        if (node.id === oldRoot) node.fixed = false;
      } else if (parked) {
        const col = gridAt % gridCols;
        gridAt++;
        const y = gridNextY[col] + h / 2;
        gridNextY[col] = y + h / 2 + GAP;
        node = {
          id,
          x: -((col + 1) * PITCH_X) - 40,
          y,
          vx: 0,
          vy: 0,
          fixed: false,
          cluster,
          rank,
          h,
          w,
          degree: 0,
          parked,
        };
      } else {
        const homeY = this.clusters.get(cluster)?.homeY ?? 0;
        let col = ladder.get(rank);
        if (!col) ladder.set(rank, (col = { down: homeY, up: homeY, k: 0 }));
        let y: number;
        if (col.k === 0) {
          y = homeY;
          col.down = y + h / 2;
          col.up = y - h / 2;
        } else if (col.k % 2 === 1) {
          y = col.down + GAP + h / 2;
          col.down = y + h / 2;
        } else {
          y = col.up - GAP - h / 2;
          col.up = y - h / 2;
        }
        col.k++;
        node = {
          id,
          x: rank * COL_W,
          y,
          vx: 0,
          vy: 0,
          fixed: false,
          cluster,
          rank,
          h,
          w,
          degree: 0,
          parked,
        };
      }
      this.nodes.push(node);
      this.byId.set(id, node);
    }
    const byRank = new Map<number, SimNode[]>();
    this.live = [];
    for (const n of this.nodes) {
      n.degree = (out.get(n.id)?.length ?? 0) + (inc.get(n.id)?.length ?? 0);
      this.clusters.get(n.cluster)?.members.push(n);
      if (n.parked) continue;
      this.live.push(n);
      const col = byRank.get(n.rank);
      if (col) col.push(n);
      else byRank.set(n.rank, [n]);
    }
    this.columns = [...byRank.values()];
    if (this.root) {
      const r = this.byId.get(this.root)!;
      r.x = r.rank * COL_W;
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
      for (const column of this.columns) separate(column);
      return false;
    }

    // Springs: with x owned by the columns, these order each column's
    // vertical neighborhood so wired cards sit level with each other.
    for (const l of this.links) {
      const dx = l.b.x - l.a.x;
      const dy = l.b.y - l.a.y;
      const d = Math.hypot(dx, dy) || 1;
      // Only y: x belongs to the columns, and a spring that pulled on x would
      // drag a whole chain off its ranks.
      const f = ((d - l.rest) / d) * alpha * l.strength;
      const share = l.a.degree / (l.a.degree + l.b.degree || 1);
      l.b.vy -= dy * f * share;
      l.a.vy += dy * f * (1 - share);
    }
    // Repulsion, along y and per COLUMN: cards on different columns cannot
    // overlap (x is locked and the pitch exceeds the widest card), so pairs
    // across columns would only burn time.
    for (const column of this.columns) {
      for (let i = 0; i < column.length; i++) {
        const a = column[i];
        for (let j = i + 1; j < column.length; j++) {
          const b = column[j];
          const dy = b.y - a.y;
          let l2 = dy * dy;
          if (l2 >= CHARGE_RANGE * CHARGE_RANGE) continue;
          // Coincident or nearly so: the kick is capped at a card's height.
          const near = l2 < PITCH_Y * PITCH_Y;
          if (near) l2 = PITCH_Y * PITCH_Y;
          const w = (CHARGE * alpha) / l2;
          const py = (near && dy === 0 ? PITCH_Y : dy) * w;
          a.vy -= py;
          b.vy += py;
        }
      }
    }
    // y-gravity toward the middle and the cluster's band; integrate. x is not
    // a force at all: a free card rides onto its rank's column and stays
    // there, so the sequence axis is exact, not approximate. Parked cards
    // never move: they have nothing to react to.
    for (const n of this.live) {
      if (n.fixed) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vy -= n.y * 0.0015 * alpha;
      const cluster = this.clusters.get(n.cluster);
      if (cluster && this.clusters.size > 1) n.vy += (cluster.homeY - n.y) * 0.04 * alpha;
      n.vy *= VELOCITY_DECAY;
      n.y += n.vy;
      n.x += (n.rank * COL_W - n.x) * 0.3;
    }
    // Collision, on the positions themselves, per column again.
    const strength = 0.6 + 0.4 * (1 - alpha);
    for (const column of this.columns) separate(column, 1, strength);
    return this.alpha >= ALPHA_MIN;
  }

  /** Run to rest, then part any two cards still closer than the gap. */
  settle(): Map<string, SimPos> {
    while (this.tick()) {
      /* run down */
    }
    return this.positions();
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
 * other's gap (per-pair, since heights vary). A few bounded sweeps along the
 * shallower axis; pinned cards do not move.
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
        const pitchY = (a.h + b.h) / 2 + GAP;
        const pitchX = (a.w + b.w) / 2 + GAP;
        const ox = pitchX - Math.abs(dx);
        const oy = pitchY - Math.abs(dy);
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
