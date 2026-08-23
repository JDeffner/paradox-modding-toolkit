/**
 * Pure, dependency-free layout for the event graph. Unit-tested here and
 * bundled into the webview app (app/) as a normal import.
 *
 * The question the view answers is "what does THIS event do", so the shape is a
 * map with the focused event in the middle, what fires it on the LEFT and what
 * it fires on the RIGHT, each further hop one ring further out. The two halves
 * are angular sectors, not a full circle: a handful of children reads as a fan
 * beside the root instead of a wheel around it, and nothing ever lands directly
 * above or below the card it belongs to.
 *
 * Every radius is derived from the cards that ring carries, never fixed: the
 * ring is exactly as wide as it has to be for 240 px cards to keep a 24 px gap,
 * so a 5-node chain does not sit in a corner and a 40-node namespace does not
 * collapse into a knot. Nodes no walk reached get a grid below the graph, which
 * says "not connected" better than another ring would.
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
export const NODE_W = 240;
export const NODE_H = 62;
/** Clear space demanded between two cards, on both axes. */
export const GAP = 24;
/** Centre-to-centre distance two cards need, per axis. */
const PITCH_X = NODE_W + GAP;
const PITCH_Y = NODE_H + GAP;
/**
 * Half the angle a side's fan opens to. A small side stays a narrow fan beside
 * the root; a crowded one opens up rather than pushing its ring out forever.
 */
const HALF_NARROW = (55 * Math.PI) / 180;
const HALF_WIDE = (75 * Math.PI) / 180;
const CROWDED = 8;
/** A card never sits over the root's own column: its side has to stay readable. */
const MIN_SIDE_X = NODE_W / 2 + GAP;
/** Overlap-removal sweeps. Enough to settle the ring boundaries; bounded so a
 *  400-node namespace stays inside the frame budget. */
const SETTLE_PASSES = 120;

const TAU = Math.PI * 2;

interface Placed {
  ring: number;
  /** 1 = fired by the root (right), -1 = fires the root (left), 2 = neither. */
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

  // Rings: downstream first (what the focus fires), then upstream. A node keeps
  // the FIRST ring that claimed it, so a chain that loops back does not drift
  // outward. `rings[r][side]` is what that ring carries on that side.
  const rings: Array<Map<number, string[]>> = [new Map([[0, [centre]]])];
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
    const bySide = new Map<number, string[]>();
    if (grown.length > 0) bySide.set(1, grown);
    if (back.length > 0) bySide.set(-1, back);
    rings[ring] = bySide;
    downstream = grown;
    upstream = back;
  }

  // Each side grows outward on its own: the right may need three wide rings
  // while the left needs one narrow one.
  const previousRadius = new Map<number, number>([
    [1, 0],
    [-1, 0],
  ]);
  for (let ring = 1; ring < rings.length; ring++) {
    for (const side of [1, -1]) {
      const members = rings[ring]?.get(side) ?? [];
      if (members.length === 0) continue;
      const centreAngle = side === 1 ? 0 : Math.PI;
      const half = members.length < CROWDED ? HALF_NARROW : HALF_WIDE;
      const floor = (previousRadius.get(side) ?? 0) + PITCH_X;
      const seeds = members.map((id) => seedAngle(id, placed, out, inc, centreAngle));
      const fan = sector(members, seeds, centreAngle, half, floor);
      previousRadius.set(side, fan.radius);
      for (let i = 0; i < members.length; i++) {
        const angle = fan.angles[i];
        placed.get(members[i])!.angle = angle;
        const x = Math.cos(angle) * fan.radius;
        pos.set(members[i], {
          x: side === 1 ? Math.max(x, MIN_SIDE_X) : Math.min(x, -MIN_SIDE_X),
          y: Math.sin(angle) * fan.radius,
        });
      }
    }
  }
  pos.set(centre, { x: 0, y: 0 });

  // Nodes no walk reached (a namespace view lists definitions nothing wires up
  // yet): a grid under everything else, so they read as "not connected".
  const loose = ids.filter((id) => !placed.has(id));

  relax([...placed.keys()], pos, placed, out, inc, centre);
  if (loose.length > 0) gridBelow(loose, pos);
  settle(ids, pos, centre);
  return pos;
}

/** Relaxation passes. Bounded: a 400-node namespace is ~160k pair tests per pass. */
const RELAX_PASSES = 160;
/** How far a card's rest distance to its neighbour grows per extra link it has. */
const HUB_STRETCH = 0.12;
/** Two cards closer than this, along the diagonal, push each other apart. */
const REPEL_RANGE = PITCH_X * 1.6;

/**
 * The organic pass. The fans give every card a side and a rough place; this
 * lets the graph find its own distances the way a force layout does, so a
 * busy hub spreads its neighbours out, a lone chain pulls tight, and a
 * column of twenty callers stops looking like a ruler. Three forces, all
 * deterministic: a spring along every edge (rest length grows with how many
 * links the two ends carry), a short-range repulsion between every pair, and
 * a weak pull toward the centre so nothing drifts off. Each card keeps its
 * SIDE: a caller never crosses to the fired side, which is what makes the
 * left-to-right reading survive the relaxation. The centre does not move.
 */
function relax(
  ids: string[],
  pos: Map<string, LayoutPos>,
  placed: Map<string, Placed>,
  out: Map<string, string[]>,
  inc: Map<string, string[]>,
  centre: string
): void {
  if (ids.length < 3) return;
  const degree = (id: string): number => (out.get(id)?.length ?? 0) + (inc.get(id)?.length ?? 0);
  const links: Array<[string, string, number]> = [];
  for (const id of ids) {
    for (const other of out.get(id) ?? []) {
      if (!pos.has(other) || !placed.has(other)) continue;
      const rest = PITCH_X * (1 + HUB_STRETCH * Math.min(10, Math.max(degree(id), degree(other)) - 1));
      links.push([id, other, rest]);
    }
  }
  const vel = new Map<string, { x: number; y: number }>();
  for (const id of ids) vel.set(id, { x: 0, y: 0 });
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    const heat = 1 - pass / RELAX_PASSES;
    const force = new Map<string, { x: number; y: number }>();
    for (const id of ids) force.set(id, { x: 0, y: 0 });
    // Springs.
    for (const [a, b, rest] of links) {
      const pa = pos.get(a)!;
      const pb = pos.get(b)!;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const k = ((d - rest) / d) * 0.08;
      force.get(a)!.x += dx * k;
      force.get(a)!.y += dy * k;
      force.get(b)!.x -= dx * k;
      force.get(b)!.y -= dy * k;
    }
    // Repulsion, in card units: the horizontal axis is squashed by the card's
    // aspect so a wide card pushes sideways as hard as a tall one would.
    const aspect = PITCH_X / PITCH_Y;
    for (let i = 0; i < ids.length; i++) {
      const pa = pos.get(ids[i])!;
      for (let j = i + 1; j < ids.length; j++) {
        const pb = pos.get(ids[j])!;
        const dx = (pb.x - pa.x) / aspect;
        const dy = pb.y - pa.y;
        const d2 = dx * dx + dy * dy;
        const range = REPEL_RANGE / aspect;
        if (d2 >= range * range) continue;
        const d = Math.max(8, Math.sqrt(d2));
        const push = ((range - d) / range) * 14;
        const ux = d2 === 0 ? (i < j ? 1 : -1) : dx / d;
        const uy = d2 === 0 ? 0 : dy / d;
        force.get(ids[i])!.x -= ux * push * aspect;
        force.get(ids[i])!.y -= uy * push;
        force.get(ids[j])!.x += ux * push * aspect;
        force.get(ids[j])!.y += uy * push;
      }
    }
    // Gravity, and the side each card keeps.
    for (const id of ids) {
      if (id === centre) continue;
      const p = pos.get(id)!;
      const f = force.get(id)!;
      f.x -= p.x * 0.004;
      f.y -= p.y * 0.004;
      const v = vel.get(id)!;
      v.x = (v.x + f.x) * 0.6;
      v.y = (v.y + f.y) * 0.6;
      p.x += v.x * heat;
      p.y += v.y * heat;
      // The side boundary is a wedge, not a wall: a card beside the root
      // stays clear of its column, a card far above or below it may drift
      // over the column, so a crowded side wraps around instead of stacking
      // into a ruler against the line.
      const side = placed.get(id)!.side;
      const slack = Math.min(MIN_SIDE_X - 8, Math.max(0, Math.abs(p.y) - PITCH_Y) * 0.7);
      if (side === 1 && p.x < MIN_SIDE_X - slack) p.x = MIN_SIDE_X - slack;
      if (side === -1 && p.x > -MIN_SIDE_X + slack) p.x = -MIN_SIDE_X + slack;
    }
  }
  pos.set(centre, { x: 0, y: 0 });
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

/**
 * Where a card WANTS to sit: the average direction of the neighbours one ring
 * in, which is what puts a child's own children next to that child. A card with
 * no inner neighbour aims at the middle of its fan.
 */
function seedAngle(
  id: string,
  placed: Map<string, Placed>,
  out: Map<string, string[]>,
  inc: Map<string, string[]>,
  fallback: number
): number {
  const ring = placed.get(id)!.ring;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const other of [...(out.get(id) ?? []), ...(inc.get(id) ?? [])]) {
    const near = placed.get(other);
    if (!near || near.ring !== ring - 1) continue;
    sumX += Math.cos(near.angle);
    sumY += Math.sin(near.angle);
    count++;
  }
  return count === 0 ? fallback : Math.atan2(sumY, sumX);
}

/**
 * One side's fan: how far out it has to be, and where each card goes on it.
 *
 * A card near the middle of the fan is separated from its neighbour mostly
 * vertically, so it only needs `PITCH_Y`; a card near the edge is separated
 * mostly horizontally and needs `PITCH_X`. `pitch` says which, so the radius is
 * the smallest one where every gap really fits, and the gaps are then handed
 * out in proportion to what each of them needs.
 */
function sector(
  members: string[],
  seeds: number[],
  centre: number,
  half: number,
  floor: number
): { radius: number; angles: number[] } {
  const n = members.length;
  const angles = new Array<number>(n).fill(centre);
  if (n === 1) return { radius: floor, angles };

  // Clustered order: cards whose parent points the same way end up neighbours.
  const order = members
    .map((id, i) => ({ i, id, seed: seeds[i] }))
    .sort((a, b) => nearness(a.seed, centre) - nearness(b.seed, centre) || (a.id < b.id ? -1 : 1));

  const even = order.map((_, i) => centre - half + (i * 2 * half) / (n - 1));
  const needs = [];
  for (let i = 0; i < n - 1; i++) needs.push(pitch((even[i] + even[i + 1]) / 2));
  const total = needs.reduce((a, b) => a + b, 0);
  const radius = Math.max(floor, total / (2 * half));

  // The block is at most as wide as the fan; centre whatever room is left over.
  const span = total / radius;
  let at = centre - span / 2;
  for (let i = 0; i < n; i++) {
    angles[order[i].i] = at;
    at += (needs[i] ?? 0) / radius;
  }
  return { radius, angles };
}

/** Signed distance from the fan's middle, so the sort walks the fan in order. */
function nearness(angle: number, centre: number): number {
  let d = (angle - centre) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * Arc length two cards need between them at this angle: moving along the ring
 * changes x by |sin| and y by |cos| per unit, and clearing either axis is
 * enough for the boxes not to touch.
 */
function pitch(angle: number): number {
  const s = Math.abs(Math.sin(angle));
  const c = Math.abs(Math.cos(angle));
  return Math.min(s < 1e-6 ? Infinity : PITCH_X / s, c < 1e-6 ? Infinity : PITCH_Y / c);
}

/** The unconnected nodes, in a roughly 16:9 grid under the rest of the graph. */
function gridBelow(loose: string[], pos: Map<string, LayoutPos>): void {
  let bottom = 0;
  let anything = false;
  pos.forEach((p) => {
    bottom = anything ? Math.max(bottom, p.y) : p.y;
    anything = true;
  });
  const columns = Math.max(1, Math.round(Math.sqrt((loose.length * PITCH_Y * 16) / (PITCH_X * 9))));
  const left = (-(Math.min(columns, loose.length) - 1) * PITCH_X) / 2;
  const top = bottom + PITCH_Y * 2;
  loose.forEach((id, i) => {
    pos.set(id, {
      x: left + (i % columns) * PITCH_X,
      y: top + Math.floor(i / columns) * PITCH_Y,
    });
  });
}

/**
 * Push overlapping cards apart along their shallower axis, a few fixed sweeps.
 * The centre never moves: it is the one position the reader is told to trust.
 */
function settle(ids: string[], pos: Map<string, LayoutPos>, centre: string): void {
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
        const overlapX = PITCH_X - Math.abs(dx);
        const overlapY = PITCH_Y - Math.abs(dy);
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
