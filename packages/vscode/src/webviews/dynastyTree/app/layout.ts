/**
 * Where every character sits in the family tree. Pure: characters in,
 * coordinates and edges out, no DOM and no messages, so the rules are tested
 * directly (test/dynastyLayout.test.ts).
 *
 * Three rules, in this order:
 *  1. A generation is one row. A character with no parent in the tree is row 0;
 *     anyone else sits one row under the lower of their parents. A spouse
 *     married in from outside has no parents here, so they join their partner's
 *     row instead of piling up on row 0.
 *  2. Siblings stand together, oldest first: the row is ordered by the parent
 *     pair, and inside a pair by birth date.
 *  3. A spouse stands next to their partner, taken out of their own place in
 *     the row order.
 */

export interface LayoutCharacter {
  id: string;
  father?: string;
  mother?: string;
  spouses: string[];
  /** `Y.M.D`; missing dates sort last, which is what an undated entry means. */
  birth?: string;
  external?: boolean;
}

export interface LayoutNode {
  id: string;
  generation: number;
  /** Position in its own row, left to right. */
  index: number;
  /** Centre of the node's card. */
  x: number;
  y: number;
}

export interface LayoutEdge {
  kind: "parent" | "spouse";
  from: string;
  to: string;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

/** Card box and the space around it, in the layout's own units. */
export const NODE_W = 150;
export const NODE_H = 54;
export const COL = NODE_W + 26;
export const ROW = NODE_H + 62;

function birthOrder(birth: string | undefined): number {
  if (!birth) return Number.MAX_SAFE_INTEGER;
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

export function layoutTree(chars: LayoutCharacter[]): Layout {
  const byId = new Map(chars.map((c) => [c.id, c]));
  const gen = generations(chars, byId);

  const rows = new Map<number, LayoutCharacter[]>();
  for (const char of chars) {
    const row = gen.get(char.id) ?? 0;
    const list = rows.get(row);
    if (list) list.push(char);
    else rows.set(row, [char]);
  }

  const nodes: LayoutNode[] = [];
  let widest = 0;
  const placedAt = new Map<string, number>();
  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    const list = rows.get(row)!;
    // Siblings together (the parent pair is the group), oldest first inside a
    // group, and groups ordered by where their parents stand one row up.
    const groupKey = (c: LayoutCharacter): string => `${c.father ?? ""}+${c.mother ?? ""}`;
    const groupRank = (c: LayoutCharacter): number => {
      const parent = c.father ?? c.mother;
      return parent !== undefined ? (placedAt.get(parent) ?? Number.MAX_SAFE_INTEGER) : -1;
    };
    const sorted = [...list].sort(
      (a, b) =>
        groupRank(a) - groupRank(b) ||
        groupKey(a).localeCompare(groupKey(b)) ||
        birthOrder(a.birth) - birthOrder(b.birth) ||
        a.id.localeCompare(b.id)
    );
    // A spouse follows their partner, wherever they sorted on their own. Someone
    // married in has no parents here, so they have no place of their own: they
    // are held back and appended next to the partner who does.
    const hasParent = (c: LayoutCharacter): boolean =>
      (c.father !== undefined && byId.has(c.father)) || (c.mother !== undefined && byId.has(c.mother));
    const attached = new Set<string>();
    for (const char of sorted) {
      if (!hasParent(char)) continue;
      for (const spouseId of char.spouses) {
        const spouse = byId.get(spouseId);
        if (spouse && !hasParent(spouse) && (gen.get(spouseId) ?? 0) === row) attached.add(spouseId);
      }
    }
    const order: LayoutCharacter[] = [];
    const done = new Set<string>();
    const place = (char: LayoutCharacter): void => {
      if (done.has(char.id)) return;
      done.add(char.id);
      order.push(char);
      for (const spouseId of char.spouses) {
        const spouse = byId.get(spouseId);
        if (!spouse || done.has(spouseId) || (gen.get(spouseId) ?? 0) !== row) continue;
        done.add(spouseId);
        order.push(spouse);
      }
    };
    for (const char of sorted) {
      if (attached.has(char.id)) continue;
      place(char);
    }
    // A held-back spouse whose partner sits on another row still needs a place.
    for (const char of sorted) place(char);
    order.forEach((char, index) => {
      placedAt.set(char.id, index);
      nodes.push({
        id: char.id,
        generation: row,
        index,
        x: index * COL + NODE_W / 2,
        y: row * ROW + NODE_H / 2,
      });
    });
    widest = Math.max(widest, order.length);
  }

  const edges: LayoutEdge[] = [];
  const seenMarriage = new Set<string>();
  for (const char of chars) {
    for (const parent of [char.father, char.mother]) {
      if (parent && byId.has(parent)) edges.push({ kind: "parent", from: parent, to: char.id });
    }
    for (const spouse of char.spouses) {
      if (!byId.has(spouse)) continue;
      const key = [char.id, spouse].sort().join("+");
      if (seenMarriage.has(key)) continue;
      seenMarriage.add(key);
      edges.push({ kind: "spouse", from: char.id, to: spouse });
    }
  }

  return {
    nodes,
    edges,
    width: Math.max(0, widest * COL),
    height: Math.max(0, rows.size * ROW),
  };
}
