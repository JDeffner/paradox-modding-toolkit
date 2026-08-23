/**
 * Pure, dependency-free radial layout for the event graph. Unit-tested here and
 * bundled into the webview app (app/) as a normal import.
 *
 * The question the view answers is "what does THIS event do", so the shape is a
 * map with the focused event at the middle: what it fires spreads to one side,
 * what fires it to the other, each further hop one ring further out. Rings are
 * sized by how many nodes they carry rather than by a fixed radius, which is
 * what keeps a 5-node chain from sitting in a corner and a 200-node namespace
 * from collapsing into a knot.
 *
 * Fully deterministic: no Math.random, no time, no iteration over a Map whose
 * insertion order depends on anything but the caller's arrays.
 */

export interface LayoutNodeInput {
  id: string;
}
export interface LayoutEdgeInput {
  from: string;
  to: string;
}
export interface LayoutPos {
  x: number;
  y: number;
}

/** The card the renderer draws; the layout keeps these boxes apart. */
export const NODE_W = 156;
export const NODE_H = 44;
/** Clear space demanded between two cards. */
const GAP_X = 30;
const GAP_Y = 18;
/** Arc length one card claims on its ring. */
const ARC = NODE_W + GAP_X;
/** First ring, and how much further out each next ring starts. */
const RING_0 = 210;
const RING_GAP = 175;
/** Overlap-removal sweeps. Enough to settle the ring boundaries; bounded so a
 *  400-node namespace stays inside the frame budget. */
const SETTLE_PASSES = 24;

const TAU = Math.PI * 2;

interface Placed {
  ring: number;
  /** 1 = fired by the root, -1 = fires the root, 2 = neither. */
  side: number;
  angle: number;
}

/**
 * Position every node. `rootId` is pinned at the origin; without one the most
 * connected node takes the middle (ties by id), so a namespace view still has
 * a centre instead of a random starting point.
 */
export function radialLayout(
  nodes: LayoutNodeInput[],
  edges: LayoutEdgeInput[],
  rootId?: string
): Map<string, LayoutPos> {
  const pos = new Map<string, LayoutPos>();
  const ids: string[] = [];
  const known = new Set<string>();
  for (const node of nodes) {
    if (known.has(node.id)) continue;
    known.add(node.id);
    ids.push(node.id);
  }
  if (ids.length === 0) return pos;

  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  for (const id of ids) {
    out.set(id, []);
    inc.set(id, []);
  }
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    out.get(edge.from)!.push(edge.to);
    inc.get(edge.to)!.push(edge.from);
  }

  const centre = pickCentre(ids, out, inc, rootId);
  const placed = new Map<string, Placed>();
  placed.set(centre, { ring: 0, side: 0, angle: 0 });

  // Rings: downstream first (what the focus fires), then upstream, then
  // whatever neither walk reached. A node keeps the FIRST ring that claimed it,
  // so a chain that loops back does not drift outward.
  const rings: string[][] = [[centre]];
  const spread = (from: string[], links: Map<string, string[]>, side: number, ring: number): string[] => {
    const next: string[] = [];
    for (const id of from) {
      for (const other of links.get(id) ?? []) {
        if (placed.has(other)) continue;
        placed.set(other, { ring, side, angle: 0 });
        next.push(other);
      }
    }
    return next;
  };
  let downstream = [centre];
  let upstream = [centre];
  for (let ring = 1; downstream.length > 0 || upstream.length > 0; ring++) {
    const grown = spread(downstream, out, 1, ring);
    const back = spread(upstream, inc, -1, ring);
    if (grown.length + back.length === 0) break;
    rings[ring] = [...grown, ...back];
    downstream = grown;
    upstream = back;
  }
  // Nodes no walk reached (a namespace view lists definitions nothing wires up
  // yet): their own ring past the last one, so they read as "not connected".
  const loose = ids.filter((id) => !placed.has(id));
  if (loose.length > 0) {
    const ring = rings.length;
    for (const id of loose) placed.set(id, { ring, side: 2, angle: 0 });
    rings[ring] = loose;
  }

  // Ring 1 divides the circle: the fired-by side around angle 0, the fires-me
  // side around PI, in proportion to how many nodes each has, so both use the
  // room they need and neither is squeezed into a sliver.
  for (let ring = 1; ring < rings.length; ring++) {
    const members = rings[ring] ?? [];
    if (members.length === 0) continue;
    const radius = Math.max(RING_0 + (ring - 1) * RING_GAP, (members.length * ARC) / TAU);
    const angles =
      ring === 1
        ? evenAngles(members, placed)
        : clusteredAngles(members, placed, out, inc, ARC / radius);
    for (let i = 0; i < members.length; i++) {
      const id = members[i];
      placed.get(id)!.angle = angles[i];
      pos.set(id, { x: Math.cos(angles[i]) * radius, y: Math.sin(angles[i]) * radius });
    }
  }
  pos.set(centre, { x: 0, y: 0 });

  settle(ids, pos, centre);
  return pos;
}

/** The focus, or the busiest node when the view has no focus. */
function pickCentre(
  ids: string[],
  out: Map<string, string[]>,
  inc: Map<string, string[]>,
  rootId: string | undefined
): string {
  if (rootId !== undefined && out.has(rootId)) return rootId;
  let best = ids[0];
  let bestDegree = -1;
  for (const id of ids) {
    const degree = (out.get(id)?.length ?? 0) + (inc.get(id)?.length ?? 0);
    if (degree > bestDegree) {
      best = id;
      bestDegree = degree;
    }
  }
  return best;
}

/** Equal slices of the full circle, with the downstream block centred on 0. */
function evenAngles(members: string[], placed: Map<string, Placed>): number[] {
  const slice = TAU / members.length;
  let downstream = 0;
  for (const id of members) if (placed.get(id)!.side === 1) downstream++;
  const offset = -((downstream - 1) / 2) * slice;
  return members.map((_, i) => offset + i * slice);
}

/**
 * Outer rings sit under the neighbour that leads to them (their barycentre), so
 * a branch stays one visible cluster, then get pushed apart until no two are
 * closer than one card's arc. A ring that cannot fit that way falls back to
 * even slices, which always fits.
 */
function clusteredAngles(
  members: string[],
  placed: Map<string, Placed>,
  out: Map<string, string[]>,
  inc: Map<string, string[]>,
  minGap: number
): number[] {
  const seed = members.map((id) => {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const other of [...(out.get(id) ?? []), ...(inc.get(id) ?? [])]) {
      const near = placed.get(other);
      if (!near || near.ring !== placed.get(id)!.ring - 1) continue;
      sumX += Math.cos(near.angle);
      sumY += Math.sin(near.angle);
      count++;
    }
    return count === 0 ? null : Math.atan2(sumY, sumX);
  });
  // A node with no inner neighbour has no cluster to join: even slices for the
  // whole ring is the honest answer rather than a made-up direction.
  if (seed.some((a) => a === null)) return evenAngles(members, placed);

  const order = members
    .map((id, i) => ({ i, angle: norm(seed[i]!), id }))
    .sort((a, b) => a.angle - b.angle || (a.id < b.id ? -1 : 1));
  for (let i = 1; i < order.length; i++) {
    const gap = order[i].angle - order[i - 1].angle;
    if (gap < minGap) order[i].angle = order[i - 1].angle + minGap;
  }
  const span = order.length > 1 ? order[order.length - 1].angle - order[0].angle : 0;
  if (span > TAU - minGap) return evenAngles(members, placed);

  const angles = new Array<number>(members.length).fill(0);
  for (const entry of order) angles[entry.i] = entry.angle;
  return angles;
}

function norm(angle: number): number {
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/**
 * Push overlapping cards apart along their shallower axis, a few fixed sweeps.
 * The centre never moves: it is the one position the reader is told to trust.
 */
function settle(ids: string[], pos: Map<string, LayoutPos>, centre: string): void {
  const minX = NODE_W + GAP_X;
  const minY = NODE_H + GAP_Y;
  for (let pass = 0; pass < SETTLE_PASSES; pass++) {
    let moved = false;
    for (let a = 0; a < ids.length; a++) {
      const pa = pos.get(ids[a]);
      if (!pa) continue;
      for (let b = a + 1; b < ids.length; b++) {
        const pb = pos.get(ids[b]);
        if (!pb) continue;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const overlapX = minX - Math.abs(dx);
        const overlapY = minY - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        // Two cards exactly on top of each other have no direction to part
        // along; the deterministic tiebreak is "the later one goes right".
        const aFixed = ids[a] === centre;
        const bFixed = ids[b] === centre;
        if (aFixed && bFixed) continue;
        const share = aFixed || bFixed ? 1 : 0.5;
        if (overlapX <= overlapY) {
          const push = (dx === 0 ? overlapX : Math.sign(dx) * overlapX) * share;
          if (!aFixed) pa.x -= push;
          if (!bFixed) pb.x += push;
        } else {
          const push = (dy === 0 ? overlapY : Math.sign(dy) * overlapY) * share;
          if (!aFixed) pa.y -= push;
          if (!bFixed) pb.y += push;
        }
      }
    }
    if (!moved) break;
  }
}
