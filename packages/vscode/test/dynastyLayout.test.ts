/**
 * Where the family tree puts people: one row per generation, a couple side by
 * side over the children it had, subtrees that do not collide, and orthogonal
 * lines.
 */
import { describe, expect, it } from "vitest";
import {
  layoutTree,
  NODE_W,
  type LayoutCharacter,
  type LayoutNode,
} from "../src/webviews/dynastyTree/app/layout";

const c = (id: string, extra: Partial<LayoutCharacter> = {}): LayoutCharacter => ({
  id,
  spouses: [],
  ...extra,
});

/** id -> its row. */
function rows(chars: LayoutCharacter[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const node of layoutTree(chars).nodes) out[node.id] = node.generation;
  return out;
}

/** The ids of one row, left to right. */
function order(chars: LayoutCharacter[], generation: number): string[] {
  return layoutTree(chars)
    .nodes.filter((n) => n.generation === generation)
    .sort((a, b) => a.x - b.x)
    .map((n) => n.id);
}

function at(nodes: LayoutNode[], id: string): LayoutNode {
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new Error(`no node for ${id}`);
  return node;
}

describe("layoutTree", () => {
  it("puts a child one row under the lower of its parents, and a married-in spouse on their partner's", () => {
    expect(rows([c("gran"), c("dad", { father: "gran" }), c("kid", { father: "dad" })])).toEqual({
      gran: 0,
      dad: 1,
      kid: 2,
    });
    // The wife has no parent here, so nothing but the marriage says which row
    // she belongs on: it must not be the top one.
    const married = [
      c("gran"),
      c("dad", { father: "gran", spouses: ["wife"] }),
      c("wife", { spouses: ["dad"] }),
    ];
    expect(rows(married)).toEqual({ gran: 0, dad: 1, wife: 1 });
  });

  it("stands a couple over its children, oldest child first", () => {
    const chars = [
      c("dad", { birth: "1000.1.1", spouses: ["mum"] }),
      c("mum", { birth: "1002.1.1", spouses: ["dad"] }),
      c("young", { father: "dad", mother: "mum", birth: "1050.1.1" }),
      c("old", { father: "dad", mother: "mum", birth: "1040.1.1" }),
      c("middle", { father: "dad", mother: "mum", birth: "1045.6.2" }),
    ];
    expect(order(chars, 1)).toEqual(["old", "middle", "young"]);
    const { nodes } = layoutTree(chars);
    // The marriage bar's midpoint is the middle of the children's span.
    const bar = (at(nodes, "dad").x + at(nodes, "mum").x) / 2;
    expect(bar).toBeCloseTo((at(nodes, "old").x + at(nodes, "young").x) / 2, 5);
  });

  it("keeps two subtrees apart instead of stacking them on one another", () => {
    const chars = [
      c("a", { birth: "1000.1.1" }),
      c("b", { birth: "1001.1.1" }),
      ...["a1", "a2", "a3"].map((id) => c(id, { father: "a", birth: "1030.1.1" })),
      ...["b1", "b2", "b3"].map((id) => c(id, { father: "b", birth: "1031.1.1" })),
    ];
    const { nodes } = layoutTree(chars);
    for (const one of nodes) {
      for (const other of nodes) {
        if (one === other || one.generation !== other.generation) continue;
        expect(Math.abs(one.x - other.x)).toBeGreaterThanOrEqual(NODE_W);
      }
    }
  });

  it("flanks a twice-married character with both spouses on one row", () => {
    const chars = [
      c("hub", { birth: "1000.1.1", spouses: ["first", "second"] }),
      c("first", { birth: "1001.1.1", spouses: ["hub"] }),
      c("second", { birth: "1010.1.1", spouses: ["hub"] }),
    ];
    const line = order(chars, 0);
    expect(line).toHaveLength(3);
    expect(line[1]).toBe("hub");
    const { edges } = layoutTree(chars);
    expect(edges.filter((e) => e.kind === "spouse")).toHaveLength(2);
  });

  it("counts a parent pair as a marriage even when no add_spouse says so", () => {
    const chars = [c("dad"), c("mum"), c("kid", { father: "dad", mother: "mum" })];
    const { edges } = layoutTree(chars);
    expect(edges.filter((e) => e.kind === "spouse")).toHaveLength(1);
    // One line for the pair, not one per parent, and every corner is square.
    const child = edges.filter((e) => e.kind === "parent");
    expect(child).toHaveLength(1);
    expect(child[0].members).toEqual(["dad", "mum", "kid"]);
    for (const [i, point] of child[0].points.entries()) {
      if (i === 0) continue;
      const before = child[0].points[i - 1];
      expect(point[0] === before[0] || point[1] === before[1]).toBe(true);
    }

    // With one parent known there is no bar to hang the line on, so it comes
    // off the card itself.
    const alone = layoutTree([c("mum"), c("kid", { mother: "mum" })]).edges.filter(
      (e) => e.kind === "parent"
    );
    expect(alone).toHaveLength(1);
    expect(alone[0].members).toEqual(["mum", "kid"]);
  });

  it("survives a file that makes someone their own ancestor", () => {
    const chars = [c("a", { father: "b" }), c("b", { father: "a" })];
    expect(() => layoutTree(chars)).not.toThrow();
    expect(layoutTree(chars).nodes).toHaveLength(2);
  });
});
