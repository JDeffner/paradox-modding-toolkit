import { describe, expect, it } from "vitest";
import { layoutGraph, type LayoutEdgeInput, type LayoutNodeInput } from "../src/webviews/eventGraph/layout";

const n = (...ids: string[]): LayoutNodeInput[] => ids.map((id) => ({ id }));
const e = (from: string, to: string): LayoutEdgeInput => ({ from, to });

function allFinite(pos: Map<string, { x: number; y: number }>): boolean {
  for (const p of pos.values()) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  }
  return true;
}

describe("layoutGraph", () => {
  it("layers a chain a->b->c with strictly increasing x", () => {
    const pos = layoutGraph(n("a", "b", "c"), [e("a", "b"), e("b", "c")], "a");
    const a = pos.get("a")!;
    const b = pos.get("b")!;
    const c = pos.get("c")!;
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
  });

  it("respects edge direction even without an explicit root", () => {
    const pos = layoutGraph(n("a", "b", "c"), [e("a", "b"), e("b", "c")]);
    expect(pos.get("a")!.x).toBeLessThan(pos.get("b")!.x);
    expect(pos.get("b")!.x).toBeLessThan(pos.get("c")!.x);
  });

  it("gives every disconnected node a position", () => {
    const pos = layoutGraph(n("a", "b", "island1", "island2"), [e("a", "b")]);
    expect(pos.size).toBe(4);
    expect(pos.has("island1")).toBe(true);
    expect(pos.has("island2")).toBe(true);
    expect(allFinite(pos)).toBe(true);
  });

  it("does not hang on cycles and stays finite", () => {
    const pos = layoutGraph(n("a", "b", "c"), [e("a", "b"), e("b", "c"), e("c", "a")], "a");
    expect(pos.size).toBe(3);
    expect(allFinite(pos)).toBe(true);
  });

  it("handles a self-loop without hanging", () => {
    const pos = layoutGraph(n("a", "b"), [e("a", "a"), e("a", "b")], "a");
    expect(pos.size).toBe(2);
    expect(pos.get("a")!.x).toBeLessThan(pos.get("b")!.x);
  });

  it("ignores edges to unknown nodes", () => {
    const pos = layoutGraph(n("a", "b"), [e("a", "ghost"), e("a", "b")]);
    expect(pos.size).toBe(2);
    expect(allFinite(pos)).toBe(true);
  });

  it("dedupes repeated node ids", () => {
    const pos = layoutGraph(n("a", "a", "b"), [e("a", "b")]);
    expect(pos.size).toBe(2);
  });

  it("produces all-finite positions on a diamond", () => {
    const pos = layoutGraph(n("a", "b", "c", "d"), [e("a", "b"), e("a", "c"), e("b", "d"), e("c", "d")], "a");
    expect(allFinite(pos)).toBe(true);
    expect(pos.get("a")!.x).toBeLessThan(pos.get("d")!.x);
  });

  it("is deterministic across two runs", () => {
    const nodes = n("root", "x", "y", "z", "w", "orphan");
    const edges = [e("root", "x"), e("root", "y"), e("x", "z"), e("y", "z"), e("z", "w")];
    const a = layoutGraph(nodes, edges, "root");
    const b = layoutGraph(nodes, edges, "root");
    expect(a.size).toBe(b.size);
    for (const [id, p] of a) {
      expect(b.get(id)).toEqual(p);
    }
  });

  it("handles an empty graph", () => {
    const pos = layoutGraph([], []);
    expect(pos.size).toBe(0);
  });
});
