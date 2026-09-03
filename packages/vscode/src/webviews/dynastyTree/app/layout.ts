/**
 * Where every card sits in the family tree. Pure: characters in, coordinates
 * and polylines out, no DOM and no messages, so the rules are tested directly
 * (test/dynastyLayout.test.ts).
 *
 * The unit of the drawing is the COUPLE, not the person, because that is how a
 * family tree reads: partners stand side by side, and their children hang under
 * the bar between them.
 *
 *  1. A generation is one row. A character with no parent in the tree is row 0;
 *     anyone else sits one row under the lower of their parents. A spouse
 *     married in from outside has no parents here, so they join their partner's
 *     row instead of piling up on row 0.
 *  2. A unit holds one person and everyone they are married to, side by side,
 *     so the person keeps ONE card and each marriage gets its own bar. A parent
 *     pair named on a child counts as a marriage even when no `add_spouse` says
 *     so; a child with one known parent gets a one-slot unit.
 *  3. Units form a tree (a unit hangs under the unit holding its parents) and
 *     are placed Reingold-Tilford style: post-order, a childless unit takes the
 *     next free x, a unit with children centres over their span, and each
 *     subtree slides right until it clears the previous subtree's contour by
 *     UNIT_GAP. Siblings are ordered by the marriage they came from, then by
 *     birth date, then by id.
 *  4. Every line is orthogonal: a marriage is a horizontal bar between the two
 *     cards; a child link drops from the bar's midpoint to the bus at the
 *     midline of the row gap, runs along it, then drops onto the child's top.
 */

export interface LayoutCharacter {
  id: string;
  father?: string;
  mother?: string;
  spouses: string[];
  /** `Y.M.D`; missing dates sort last, which is what an undated entry means. */
  birth?: string;
}

export interface LayoutNode {
  id: string;
  generation: number;
  /** Centre of the node's card. */
  x: number;
  y: number;
}

export type LayoutPoint = [number, number];

export interface LayoutEdge {
  kind: "spouse" | "parent";
  /** Corner points, in order; the renderer draws them and decides nothing. */
  points: LayoutPoint[];
  /** Every id the line touches, so hovering a card can light its own lines. */
  members: string[];
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

/** Card box and the space around it, in the layout's own units. */
export const NODE_W = 168;
export const NODE_H = 58;
/** Between two partner cards; the marriage bar spans it. */
export const MATE_GAP = 26;
/** Kept clear between two neighbouring subtrees. */
export const UNIT_GAP = 36;
/** Between one row of cards and the next; the sibling bus runs down its middle. */
export const ROW_GAP = 76;
export const ROW = NODE_H + ROW_GAP;

const LAST = Number.MAX_SAFE_INTEGER;

function birthOrder(birth: string | undefined): number {
  if (!birth) return LAST;
  const [y, m, d] = birth.split(".").map((p) => Number(p) || 0);
  return y * 10000 + m * 100 + d;
}

/** Generation per character: parents first, then spouses pulled to their partner. */
function generations(chars: LayoutCharacter[], byId: Map<string, LayoutCharacter>): Map<string, number> {
  const gen = new Map<string, number>();
  const visiting = new Set<string>();
  const of = (id: string): number => {
    const known = gen.get(id);
    if (known !== undefined) return known;
    const char = byId.get(id);
    // A cycle cannot happen in real history, but a mod file can write one and
    // the panel still has to draw something.
    if (!char || visiting.has(id)) return 0;
    visiting.add(id);
    let row = 0;
    for (const parent of [char.father, char.mother]) {
      if (parent && byId.has(parent)) row = Math.max(row, of(parent) + 1);
    }
    visiting.delete(id);
    gen.set(id, row);
    return row;
  };
  for (const char of chars) of(char.id);

  // A married-in spouse has no parents in this tree; put them beside their
  // partner instead of on the top row.
  for (const char of chars) {
    if (char.father && byId.has(char.father)) continue;
    if (char.mother && byId.has(char.mother)) continue;
    const partners = chars
      .filter((c) => c.spouses.includes(char.id))
      .concat(char.spouses.map((id) => byId.get(id)).filter((c): c is LayoutCharacter => c !== undefined));
    const rows = partners.filter((p) => p.id !== char.id).map((p) => gen.get(p.id) ?? 0);
    if (rows.length > 0) gen.set(char.id, Math.max(...rows));
  }
  return gen;
}

/** Who is married to whom: `add_spouse` both ways, plus every parent pair. */
function marriages(chars: LayoutCharacter[], byId: Map<string, LayoutCharacter>): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string | undefined, b: string | undefined): void => {
    if (!a || !b || a === b || !byId.has(a) || !byId.has(b)) return;
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      let set = adj.get(from);
      if (!set) {
        set = new Set();
        adj.set(from, set);
      }
      set.add(to);
    }
  };
  for (const char of chars) {
    for (const spouse of char.spouses) link(char.id, spouse);
    link(char.father, char.mother);
  }
  return adj;
}

interface Unit {
  /** The cards of this unit, left to right. */
  slots: string[];
  row: number;
  /** Marriages drawn inside this unit, left member first. */
  couples: Array<[string, string]>;
  /** The slot whose parents put this unit where it is. */
  anchor?: string;
  /** Leftmost parent slot in the unit above, so a remarriage keeps its children. */
  parentSlot: number;
  children: Unit[];
  x: number;
}

/**
 * One person and everyone they married, in one row block. The most-married
 * member keeps the middle and their spouses flank them, so a remarriage sits
 * beside the first marriage instead of starting a second card for the same
 * person.
 */
function arrange(hub: string, adj: Map<string, Set<string>>, rank: (id: string) => number): string[] {
  const sorted = (id: string): string[] =>
    [...(adj.get(id) ?? [])].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const slots = [hub];
  const done = new Set([hub]);
  const grow = (id: string, side: -1 | 1): void => {
    if (done.has(id)) return;
    done.add(id);
    if (side < 0) slots.unshift(id);
    else slots.push(id);
    for (const next of sorted(id)) grow(next, side);
  };
  // Earliest marriage to the right of the hub, the next one to its left, and so
  // on outwards: several spouses flank the shared card.
  sorted(hub).forEach((id, i) => grow(id, i % 2 === 0 ? 1 : -1));
  return slots;
}

function buildUnits(
  chars: LayoutCharacter[],
  byId: Map<string, LayoutCharacter>,
  gen: Map<string, number>,
  adj: Map<string, Set<string>>
): { units: Unit[]; unitOf: Map<string, Unit> } {
  const rank = (id: string): number => birthOrder(byId.get(id)?.birth);
  const ordered = [...chars].sort(
    (a, b) =>
      (gen.get(a.id) ?? 0) - (gen.get(b.id) ?? 0) ||
      birthOrder(a.birth) - birthOrder(b.birth) ||
      a.id.localeCompare(b.id)
  );
  const units: Unit[] = [];
  const unitOf = new Map<string, Unit>();
  for (const start of ordered) {
    if (unitOf.has(start.id)) continue;
    // The whole marriage component, so a chain of remarriages stays one block.
    const members = new Set([start.id]);
    const queue = [start.id];
    while (queue.length > 0) {
      for (const partner of adj.get(queue.shift()!) ?? []) {
        if (members.has(partner)) continue;
        members.add(partner);
        queue.push(partner);
      }
    }
    const hub = [...members].sort(
      (a, b) => (adj.get(b)?.size ?? 0) - (adj.get(a)?.size ?? 0) || rank(a) - rank(b) || a.localeCompare(b)
    )[0];
    const slots = arrange(hub, adj, rank);
    const couples: Array<[string, string]> = [];
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (adj.get(slots[i])?.has(slots[j])) couples.push([slots[i], slots[j]]);
      }
    }
    const unit: Unit = {
      slots,
      row: Math.max(...slots.map((id) => gen.get(id) ?? 0)),
      couples,
      parentSlot: 0,
      children: [],
      x: 0,
    };
    units.push(unit);
    for (const id of slots) unitOf.set(id, unit);
  }
  return { units, unitOf };
}

/** Hang every unit under the one holding its parents. */
function link(units: Unit[], byId: Map<string, LayoutCharacter>, unitOf: Map<string, Unit>): Unit[] {
  const roots: Unit[] = [];
  for (const unit of units) {
    let parent: Unit | undefined;
    for (const id of unit.slots) {
      const char = byId.get(id);
      for (const parentId of [char?.father, char?.mother]) {
        if (!parentId) continue;
        const above = unitOf.get(parentId);
        // Strictly higher only: a file that makes someone their own ancestor
        // cannot build a loop of units this way, so nothing recurses forever.
        if (!above || above === unit || above.row >= unit.row) continue;
        parent = above;
        unit.anchor = id;
        break;
      }
      if (parent) break;
    }
    if (parent) {
      const child = byId.get(unit.anchor!);
      // Which marriage of the unit above these children came from, so a second
      // family lands under its own bar instead of crossing the first one's.
      const slots = [child?.father, child?.mother]
        .map((id) => (id ? parent!.slots.indexOf(id) : -1))
        .filter((i) => i >= 0);
      unit.parentSlot = slots.length > 0 ? Math.min(...slots) : 0;
      parent.children.push(unit);
    } else roots.push(unit);
  }
  const order = (a: Unit, b: Unit): number => {
    const ca = byId.get(a.anchor ?? a.slots[0]);
    const cb = byId.get(b.anchor ?? b.slots[0]);
    return (
      a.parentSlot - b.parentSlot ||
      birthOrder(ca?.birth) - birthOrder(cb?.birth) ||
      (ca?.id ?? "").localeCompare(cb?.id ?? "")
    );
  };
  for (const unit of units) unit.children.sort(order);
  roots.sort((a, b) => a.row - b.row || order(a, b));
  return roots;
}

type Contour = Map<number, { left: number; right: number }>;

function halfWidth(unit: Unit): number {
  return (unit.slots.length * NODE_W + (unit.slots.length - 1) * MATE_GAP) / 2;
}

function merge(into: Contour, add: Contour): void {
  for (const [row, span] of add) {
    const known = into.get(row);
    if (!known) into.set(row, { ...span });
    else {
      known.left = Math.min(known.left, span.left);
      known.right = Math.max(known.right, span.right);
    }
  }
}

function slide(unit: Unit, dx: number): void {
  unit.x += dx;
  for (const child of unit.children) slide(child, dx);
}

/**
 * Pack `units` left to right, each one shifted until its left contour clears
 * the right contour of everything already placed. Returns the joint contour.
 */
function pack(units: Unit[], place: (unit: Unit) => Contour): Contour {
  const acc: Contour = new Map();
  for (const unit of units) {
    const own = place(unit);
    let shift = 0;
    for (const [row, span] of own) {
      const blocking = acc.get(row);
      if (blocking) shift = Math.max(shift, blocking.right + UNIT_GAP - span.left);
    }
    if (shift !== 0) {
      slide(unit, shift);
      for (const span of own.values()) {
        span.left += shift;
        span.right += shift;
      }
    }
    merge(acc, own);
  }
  return acc;
}

function place(unit: Unit): Contour {
  const contour =
    unit.children.length === 0
      ? new Map<number, { left: number; right: number }>()
      : pack(unit.children, place);
  unit.x =
    unit.children.length === 0 ? 0 : (unit.children[0].x + unit.children[unit.children.length - 1].x) / 2;
  merge(contour, new Map([[unit.row, { left: unit.x - halfWidth(unit), right: unit.x + halfWidth(unit) }]]));
  return contour;
}

/** Drop repeats so a straight drop is two points, not four. */
function trim(points: LayoutPoint[]): LayoutPoint[] {
  return points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
}

export function layoutTree(chars: LayoutCharacter[]): Layout {
  const byId = new Map(chars.map((c) => [c.id, c]));
  const gen = generations(chars, byId);
  const adj = marriages(chars, byId);
  const { units, unitOf } = buildUnits(chars, byId, gen, adj);
  const roots = link(units, byId, unitOf);
  pack(roots, place);

  const nodes: LayoutNode[] = [];
  for (const unit of units) {
    const left = unit.x - halfWidth(unit);
    unit.slots.forEach((id, i) => {
      nodes.push({
        id,
        generation: unit.row,
        x: left + NODE_W / 2 + i * (NODE_W + MATE_GAP),
        y: unit.row * ROW + NODE_H / 2,
      });
    });
  }
  if (nodes.length === 0) return { nodes, edges: [], width: 0, height: 0 };

  // Slide the whole drawing so the leftmost card edge sits on 0.
  const dx = NODE_W / 2 - Math.min(...nodes.map((n) => n.x));
  for (const node of nodes) node.x += dx;
  const at = new Map(nodes.map((n) => [n.id, n]));

  const edges: LayoutEdge[] = [];
  for (const unit of units) {
    for (const [a, b] of unit.couples) {
      const na = at.get(a);
      const nb = at.get(b);
      if (!na || !nb) continue;
      const [l, r] = na.x <= nb.x ? [na, nb] : [nb, na];
      edges.push({
        kind: "spouse",
        points: [
          [l.x + NODE_W / 2, l.y],
          [r.x - NODE_W / 2, r.y],
        ],
        members: [a, b],
      });
    }
  }
  for (const char of chars) {
    const child = at.get(char.id);
    if (!child) continue;
    const bus = child.y - NODE_H / 2 - ROW_GAP / 2;
    const father = char.father && byId.has(char.father) ? char.father : undefined;
    const mother = char.mother && byId.has(char.mother) ? char.mother : undefined;
    const pair =
      father && mother && unitOf.get(father) === unitOf.get(mother) ? ([father, mother] as const) : null;
    // A couple's children hang from the bar between the parents; a lone known
    // parent drops the line from their own card.
    const starts: Array<{ x: number; y: number; members: string[] }> = pair
      ? [
          {
            x: (at.get(pair[0])!.x + at.get(pair[1])!.x) / 2,
            y: at.get(pair[0])!.y,
            members: [pair[0], pair[1], char.id],
          },
        ]
      : [father, mother]
          .filter((id): id is string => id !== undefined)
          .map((id) => ({ x: at.get(id)!.x, y: at.get(id)!.y + NODE_H / 2, members: [id, char.id] }));
    for (const start of starts) {
      edges.push({
        kind: "parent",
        points: trim([
          [start.x, start.y],
          [start.x, bus],
          [child.x, bus],
          [child.x, child.y - NODE_H / 2],
        ]),
        members: start.members,
      });
    }
  }

  return {
    nodes,
    edges,
    width: Math.max(...nodes.map((n) => n.x)) + NODE_W / 2,
    height: Math.max(...nodes.map((n) => n.generation)) * ROW + NODE_H,
  };
}
