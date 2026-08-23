/**
 * The event graph's layout. What matters to a reader is checked here, because
 * it is what a screenshot cannot prove: the focused event really is in the
 * middle, no two cards come within the 24 px gap of each other (the failure the
 * old layered layout hid behind a wide canvas), what the focus fires and what
 * fires it land on opposite SIDES rather than merely opposite directions, and
 * two runs of the same graph agree.
 */
import { describe, expect, it } from "vitest";
import {
  GAP,
  NODE_H,
  NODE_W,
  radialLayout,
  type LayoutEdgeInput,
  type LayoutNodeInput,
  type LayoutPos,
} from "../src/webviews/eventGraph/layout";
import { ForceSim } from "../src/webviews/eventGraph/force";

const n = (...ids: string[]): LayoutNodeInput[] => ids.map((id) => ({ id }));
const e = (from: string, to: string): LayoutEdgeInput => ({ from, to });

/** The first pair closer than a card plus the demanded gap, or null. */
function tooClose(pos: Map<string, LayoutPos>): [string, string] | null {
  const entries = [...pos.entries()];
  for (let a = 0; a < entries.length; a++) {
    for (let b = a + 1; b < entries.length; b++) {
      const [idA, pa] = entries[a];
      const [idB, pb] = entries[b];
      const clearX = Math.abs(pa.x - pb.x) >= NODE_W + GAP - 0.5;
      const clearY = Math.abs(pa.y - pb.y) >= NODE_H + GAP - 0.5;
      if (!clearX && !clearY) return [idA, idB];
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

  it("puts what fires the focus left of it and what it fires right of it", () => {
    const pos = radialLayout(
      n("root", "c1", "c2", "c3", "p1", "p2"),
      [e("root", "c1"), e("root", "c2"), e("root", "c3"), e("p1", "root"), e("p2", "root")],
      "root"
    );
    for (const id of ["c1", "c2", "c3"]) expect(pos.get(id)!.x).toBeGreaterThan(NODE_W / 2);
    for (const id of ["p1", "p2"]) expect(pos.get(id)!.x).toBeLessThan(-NODE_W / 2);
  });

  it("keeps the sides apart even when one of them is crowded", () => {
    const children = Array.from({ length: 22 }, (_, i) => `c.${i}`);
    const pos = radialLayout(
      n("root", ...children, "p1"),
      [...children.map((id) => e("root", id)), e("p1", "root")],
      "root"
    );
    for (const id of children) expect(pos.get(id)!.x).toBeGreaterThan(0);
    expect(pos.get("p1")!.x).toBeLessThan(0);
    expect(tooClose(pos)).toBeNull();
  });

  it("puts a child's own children near that child", () => {
    // Two branches off the root; each grandchild should sit on its parent's side
    // of the fan rather than being sprayed over the whole ring.
    const pos = radialLayout(
      n("root", "a", "b", "a1", "a2", "b1", "b2"),
      [e("root", "a"), e("root", "b"), e("a", "a1"), e("a", "a2"), e("b", "b1"), e("b", "b2")],
      "root"
    );
    const nearer = (child: string, mine: string, other: string): boolean =>
      Math.abs(pos.get(child)!.y - pos.get(mine)!.y) < Math.abs(pos.get(child)!.y - pos.get(other)!.y);
    for (const child of ["a1", "a2"]) expect(nearer(child, "a", "b")).toBe(true);
    for (const child of ["b1", "b2"]) expect(nearer(child, "b", "a")).toBe(true);
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
    expect(tooClose(pos)).toBeNull();
  });

  it("gives disconnected nodes a place of their own without overlapping", () => {
    const pos = radialLayout(n("a", "b", "lonely1", "lonely2", "lonely3"), [e("a", "b")], "a");
    expect(pos.size).toBe(5);
    expect(tooClose(pos)).toBeNull();
    expect(allFinite(pos)).toBe(true);
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
    // The new root is pinned at the origin; the old one is free again.
    expect(sim.node("a")).toMatchObject({ x: 0, y: 0, fixed: true });
    expect(sim.node("root")!.fixed).toBe(false);
    sim.settle();
    expect(tooClose(sim.positions())).toBeNull();
  });
});
