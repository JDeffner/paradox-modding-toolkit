/**
 * Where the family tree puts people: one row per generation, siblings together
 * and oldest first, a spouse beside their partner.
 */
import { describe, expect, it } from "vitest";
import { layoutTree, type LayoutCharacter } from "../src/webviews/dynastyTree/app/layout";

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
    .sort((a, b) => a.index - b.index)
    .map((n) => n.id);
}

describe("layoutTree", () => {
  it("puts a child one row under the lower of its parents", () => {
    const chars = [c("gran"), c("dad", { father: "gran" }), c("kid", { father: "dad" })];
    expect(rows(chars)).toEqual({ gran: 0, dad: 1, kid: 2 });
  });

  it("takes the lower parent, so a marriage across generations does not overlap", () => {
    const chars = [
      c("gran"),
      c("dad", { father: "gran" }),
      c("mum"),
      c("kid", { father: "dad", mother: "mum" }),
    ];
    expect(rows(chars).kid).toBe(2);
  });

  it("puts a married-in spouse on their partner's row, not the top one", () => {
    const chars = [
      c("gran"),
      c("dad", { father: "gran", spouses: ["wife"] }),
      c("wife", { external: true, spouses: ["dad"] }),
    ];
    expect(rows(chars)).toEqual({ gran: 0, dad: 1, wife: 1 });
  });

  it("orders siblings by birth, oldest first", () => {
    const chars = [
      c("dad"),
      c("young", { father: "dad", birth: "1050.1.1" }),
      c("old", { father: "dad", birth: "1040.1.1" }),
      c("middle", { father: "dad", birth: "1045.6.2" }),
    ];
    expect(order(chars, 1)).toEqual(["old", "middle", "young"]);
  });

  it("stands a spouse next to their partner, wherever they sorted alone", () => {
    const chars = [
      c("dad"),
      c("a", { father: "dad", birth: "1040.1.1", spouses: ["z"] }),
      c("b", { father: "dad", birth: "1045.1.1" }),
      c("z", { external: true, birth: "1041.1.1", spouses: ["a"] }),
    ];
    expect(order(chars, 1)).toEqual(["a", "z", "b"]);
  });

  it("draws one line per marriage and one per known parent", () => {
    const chars = [
      c("dad", { spouses: ["mum"] }),
      c("mum", { spouses: ["dad"] }),
      c("kid", { father: "dad", mother: "mum" }),
      c("orphan", { father: "not_here" }),
    ];
    const edges = layoutTree(chars).edges;
    expect(edges.filter((e) => e.kind === "spouse")).toHaveLength(1);
    expect(edges.filter((e) => e.kind === "parent").map((e) => `${e.from}>${e.to}`)).toEqual([
      "dad>kid",
      "mum>kid",
    ]);
  });

  it("survives a file that makes someone their own ancestor", () => {
    const chars = [c("a", { father: "b" }), c("b", { father: "a" })];
    expect(() => layoutTree(chars)).not.toThrow();
    expect(layoutTree(chars).nodes).toHaveLength(2);
  });
});
