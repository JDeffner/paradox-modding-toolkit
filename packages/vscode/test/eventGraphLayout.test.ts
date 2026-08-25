/**
 * The event graph's layout. What matters to a reader is checked here, because
 * it is what a screenshot cannot prove: the x axis really is the sequence
 * (every forward edge goes left to right, ranks are longest-path), cycles are
 * broken into marked back edges instead of hanging the ranking, no two cards
 * come within the gap of each other even with mixed heights, and two runs of
 * the same graph agree.
 */
import { describe, expect, it } from "vitest";
import {
  COL_W,
  GAP,
  NODE_H,
  NODE_W,
  flowLayout,
  rankNodes,
  type LayoutEdgeInput,
  type LayoutNodeInput,
  type LayoutPos,
} from "../src/webviews/eventGraph/layout";
import { ForceSim } from "../src/webviews/eventGraph/force";

const n = (...ids: string[]): LayoutNodeInput[] => ids.map((id) => ({ id }));
const e = (from: string, to: string): LayoutEdgeInput => ({ from, to });

/** The first pair closer than a card plus the demanded gap, or null. */
function tooClose(
  pos: Map<string, LayoutPos>,
  heights: Map<string, number> = new Map()
): [string, string] | null {
  const entries = [...pos.entries()];
  for (let a = 0; a < entries.length; a++) {
    for (let b = a + 1; b < entries.length; b++) {
      const [idA, pa] = entries[a];
      const [idB, pb] = entries[b];
      const pitchY = ((heights.get(idA) ?? NODE_H) + (heights.get(idB) ?? NODE_H)) / 2 + GAP;
      const clearX = Math.abs(pa.x - pb.x) >= NODE_W + GAP - 0.5;
      const clearY = Math.abs(pa.y - pb.y) >= pitchY - 0.5;
      if (!clearX && !clearY) return [idA, idB];
    }
  }
  return null;
}

function allFinite(pos: Map<string, LayoutPos>): boolean {
  for (const p of pos.values()) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  return true;
}

describe("rankNodes: the sequence axis", () => {
  it("ranks a chain by longest path, entries at zero", () => {
    const { ranks } = rankNodes(n("a", "b", "c", "d"), [e("a", "b"), e("b", "c"), e("a", "d"), e("d", "c")]);
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("d")).toBe(1);
    // c is reachable in one hop and in two: the LONGEST path decides.
    expect(ranks.get("c")).toBe(2);
  });

  it("breaks a cycle into a marked back edge and still terminates", () => {
    const { ranks, back } = rankNodes(n("a", "b", "c"), [e("a", "b"), e("b", "c"), e("c", "a")]);
    expect(back.has("c→a")).toBe(true);
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("c")).toBe(2);
  });

  it("survives self-loops, unknown edge ends and duplicate ids", () => {
    const { ranks } = rankNodes(
      [...n("a", "b"), { id: "a" }],
      [e("a", "a"), e("a", "b"), e("a", "ghost"), e("ghost", "b")]
    );
    expect(ranks.size).toBe(2);
    expect(ranks.get("b")).toBe(1);
  });

  it("ranks disconnected components independently at zero", () => {
    const { ranks } = rankNodes(n("a", "b", "x", "lonely"), [e("a", "b")]);
    expect(ranks.get("x")).toBe(0);
    expect(ranks.get("lonely")).toBe(0);
  });
});

describe("flowLayout: left to right is happens-after", () => {
  it("puts every forward edge's target right of its source", () => {
    const edges = [e("root", "x"), e("root", "y"), e("x", "z"), e("y", "z"), e("z", "w")];
    const pos = flowLayout(n("root", "x", "y", "z", "w"), edges, "root");
    for (const edge of edges) {
      expect(pos.get(edge.to)!.x).toBeGreaterThan(pos.get(edge.from)!.x + NODE_W / 2);
    }
  });

  it("puts what fires the focus left of it and what it fires right of it", () => {
    const pos = flowLayout(
      n("root", "c1", "c2", "p1", "p2"),
      [e("root", "c1"), e("root", "c2"), e("p1", "root"), e("p2", "root")],
      "root"
    );
    for (const id of ["c1", "c2"]) expect(pos.get(id)!.x).toBeGreaterThan(pos.get("root")!.x);
    for (const id of ["p1", "p2"]) expect(pos.get(id)!.x).toBeLessThan(pos.get("root")!.x);
  });

  it("lands each card on its rank's column", () => {
    const pos = flowLayout(n("a", "b", "c"), [e("a", "b"), e("b", "c")], "a");
    expect(pos.get("a")!.x).toBeCloseTo(0, 0);
    expect(pos.get("b")!.x).toBeCloseTo(COL_W, 0);
    expect(pos.get("c")!.x).toBeCloseTo(COL_W * 2, 0);
  });

  it("keeps every card clear of every other card, tall cards included", () => {
    const heights = new Map<string, number>();
    const nodes: LayoutNodeInput[] = [{ id: "root" }];
    for (let i = 0; i < 40; i++) {
      const h = i % 3 === 0 ? 230 : NODE_H;
      heights.set(`evt.${i}`, h);
      nodes.push({ id: `evt.${i}`, height: h });
    }
    const edges = [
      ...Array.from({ length: 20 }, (_, i) => e("root", `evt.${i}`)),
      ...Array.from({ length: 15 }, (_, i) => e(`evt.${i}`, `evt.${i + 20}`)),
      ...Array.from({ length: 5 }, (_, i) => e(`evt.${i + 35}`, "root")),
    ];
    const pos = flowLayout(nodes, edges, "root");
    expect(pos.size).toBe(41);
    expect(tooClose(pos, heights)).toBeNull();
  });

  it("gives disconnected nodes a place of their own without overlapping", () => {
    const pos = flowLayout(n("a", "b", "lonely1", "lonely2", "lonely3"), [e("a", "b")], "a");
    expect(pos.size).toBe(5);
    expect(tooClose(pos)).toBeNull();
    expect(allFinite(pos)).toBe(true);
  });

  it("survives cycles and stays finite", () => {
    const pos = flowLayout(n("a", "b", "c"), [e("a", "b"), e("b", "c"), e("c", "a")], "a");
    expect(pos.size).toBe(3);
    expect(allFinite(pos)).toBe(true);
    expect(pos.get("b")!.x).toBeGreaterThan(pos.get("a")!.x);
  });

  it("is deterministic across two runs", () => {
    const nodes = n("root", "x", "y", "z", "w", "orphan");
    const edges = [e("root", "x"), e("root", "y"), e("x", "z"), e("y", "z"), e("z", "w")];
    const first = flowLayout(nodes, edges, "root");
    const second = flowLayout(nodes, edges, "root");
    for (const [id, p] of first) expect(second.get(id)).toEqual(p);
  });

  it("handles an empty graph", () => {
    expect(flowLayout([], []).size).toBe(0);
  });
});

describe("ForceSim: a live graph that reacts and then rests", () => {
  it("stops when cool, and a pinned card stays where it was put", () => {
    const sim = new ForceSim(n("root", "a", "b"), [e("root", "a"), e("root", "b")], "root");
    expect(sim.running).toBe(true);
    sim.settle();
    expect(sim.running).toBe(false);
    expect(sim.tick()).toBe(false);
    sim.pin("a", 900, 300);
    sim.reheat(0.3);
    sim.settle();
    expect(sim.node("a")).toMatchObject({ x: 900, y: 300, fixed: true });
    expect(sim.node("root")).toMatchObject({ x: 0, y: 0 });
  });

  it("a refocus keeps the surviving cards in place and only warms the map up", () => {
    const sim = new ForceSim(n("root", "a", "b"), [e("root", "a"), e("root", "b")], "root");
    sim.settle();
    const before = sim.positions();
    sim.update(n("root", "a", "b", "c"), [e("root", "a"), e("root", "b"), e("a", "c")], "a");
    expect(sim.running).toBe(true);
    // Cards glide from where they were: no teleport on the first tick.
    for (const id of ["b"]) {
      const was = before.get(id)!;
      const now = sim.node(id)!;
      expect(Math.hypot(now.x - was.x, now.y - was.y)).toBeLessThan(1);
    }
    // The new root is pinned on its own column at the axis; the old one is free.
    expect(sim.node("a")).toMatchObject({ x: COL_W, y: 0, fixed: true });
    expect(sim.node("root")!.fixed).toBe(false);
    sim.settle();
    expect(tooClose(sim.positions())).toBeNull();
  });
});
