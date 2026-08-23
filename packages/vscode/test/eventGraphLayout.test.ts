/**
 * The event graph's radial layout. What matters to a reader is checked here,
 * because it is what a screenshot cannot prove: the focused event really is in
 * the middle, no two cards overlap (the failure the old layered layout hid
 * behind a wide canvas), what the focus fires and what fires it land on
 * opposite sides, and two runs of the same graph agree.
 */
import { describe, expect, it } from "vitest";
import {
  NODE_H,
  NODE_W,
  radialLayout,
  type LayoutEdgeInput,
  type LayoutNodeInput,
  type LayoutPos,
} from "../src/webviews/eventGraph/layout";

const n = (...ids: string[]): LayoutNodeInput[] => ids.map((id) => ({ id }));
const e = (from: string, to: string): LayoutEdgeInput => ({ from, to });

/** The first overlapping pair, or null. Boxes touching exactly is not overlap. */
function overlap(pos: Map<string, LayoutPos>): [string, string] | null {
  const entries = [...pos.entries()];
  for (let a = 0; a < entries.length; a++) {
    for (let b = a + 1; b < entries.length; b++) {
      const [idA, pa] = entries[a];
      const [idB, pb] = entries[b];
      if (Math.abs(pa.x - pb.x) < NODE_W && Math.abs(pa.y - pb.y) < NODE_H) return [idA, idB];
    }
  }
  return null;
}

function allFinite(pos: Map<string, LayoutPos>): boolean {
  for (const p of pos.values()) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  return true;
}

describe("radialLayout", () => {
  it("pins the focused node at the centre", () => {
    const pos = radialLayout(n("a", "b", "c"), [e("a", "b"), e("a", "c")], "a");
    expect(pos.get("a")).toEqual({ x: 0, y: 0 });
  });

  it("puts what the focus fires opposite what fires the focus", () => {
    const pos = radialLayout(n("root", "child", "parent"), [e("root", "child"), e("parent", "root")], "root");
    expect(pos.get("child")!.x).toBeGreaterThan(0);
    expect(pos.get("parent")!.x).toBeLessThan(0);
  });

  it("keeps every card clear of every other card", () => {
    const nodes = n("root", ...Array.from({ length: 40 }, (_, i) => `evt.${i}`));
    const edges = [
      ...Array.from({ length: 20 }, (_, i) => e("root", `evt.${i}`)),
      ...Array.from({ length: 15 }, (_, i) => e(`evt.${i}`, `evt.${i + 20}`)),
      ...Array.from({ length: 5 }, (_, i) => e(`evt.${i + 35}`, "root")),
    ];
    const pos = radialLayout(nodes, edges, "root");
    expect(pos.size).toBe(41);
    expect(overlap(pos)).toBeNull();
  });

  it("gives disconnected nodes a place of their own without overlapping", () => {
    const pos = radialLayout(n("a", "b", "lonely1", "lonely2", "lonely3"), [e("a", "b")], "a");
    expect(pos.size).toBe(5);
    expect(overlap(pos)).toBeNull();
  });

  it("survives cycles, self-loops, unknown edge ends and duplicate ids", () => {
    const pos = radialLayout(
      n("a", "a", "b", "c"),
      [e("a", "a"), e("a", "b"), e("b", "c"), e("c", "a"), e("a", "ghost")],
      "a"
    );
    expect(pos.size).toBe(3);
    expect(allFinite(pos)).toBe(true);
  });

  it("is deterministic across two runs", () => {
    const nodes = n("root", "x", "y", "z", "w", "orphan");
    const edges = [e("root", "x"), e("root", "y"), e("x", "z"), e("y", "z"), e("z", "w")];
    const first = radialLayout(nodes, edges, "root");
    const second = radialLayout(nodes, edges, "root");
    for (const [id, p] of first) expect(second.get(id)).toEqual(p);
  });

  it("centres the busiest node when there is no focus, and handles an empty graph", () => {
    const pos = radialLayout(n("hub", "a", "b", "c"), [e("hub", "a"), e("hub", "b"), e("hub", "c")]);
    expect(pos.get("hub")).toEqual({ x: 0, y: 0 });
    expect(radialLayout([], []).size).toBe(0);
  });
});
