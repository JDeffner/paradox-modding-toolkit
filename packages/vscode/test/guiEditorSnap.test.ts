/**
 * The smart guides' pure half (app/snap.ts): the parent's box as a target,
 * equal-size matching on a resize, and the order the rules fire in. Sibling
 * alignment and equal spacing are driven end to end in guiEditorSmoke.test.ts;
 * these pin the increment 1 additions without a DOM.
 */
import { describe, expect, it } from "vitest";
import { GRID_STEP, MOVE_EDGES, snapRect, type SnapConfig } from "../src/webviews/guiEditor/app/snap";

const config: SnapConfig = { tolerance: 6, grid: 0, guides: true };
const parent = { x: 100, y: 100, w: 400, h: 300 };
const eastOnly = { west: false, east: true, north: false, south: false };
const westOnly = { west: true, east: false, north: false, south: false };

describe("the parent's content box is a snap target", () => {
  it("pulls a move onto the parent's edge when no sibling is near", () => {
    const snap = snapRect({ x: 104, y: 200, w: 40, h: 40 }, [], MOVE_EDGES, config, { parent });
    expect(snap.dx).toBe(-4);
    expect(snap.dy).toBe(0);
    // The line runs the parent's whole edge: the parent shares it.
    expect(snap.guides).toEqual([{ axis: "x", at: 100, start: 100, end: 400 }]);
  });

  it("offers the parent's centre as well as its edges", () => {
    // Parent centre x = 300; a 40-wide rect centred at 303.
    const snap = snapRect({ x: 283, y: 200, w: 40, h: 40 }, [], MOVE_EDGES, config, { parent });
    expect(snap.dx).toBe(-3);
    expect(snap.guides[0]).toMatchObject({ axis: "x", at: 300 });
  });

  it("is not offered without a parent, so every old call answers as before", () => {
    const snap = snapRect({ x: 104, y: 200, w: 40, h: 40 }, [], MOVE_EDGES, config);
    expect(snap).toEqual({ dx: 0, dy: 0, guides: [], bars: [] });
  });

  it("loses to a closer sibling line", () => {
    const sibling = { x: 106, y: 300, w: 40, h: 40 };
    const snap = snapRect({ x: 104, y: 200, w: 40, h: 40 }, [sibling], MOVE_EDGES, config, { parent });
    expect(snap.dx).toBe(2);
  });
});

describe("equal size on a resize", () => {
  it("stretches the dragged edge until the width matches a sibling's", () => {
    const sibling = { x: 300, y: 300, w: 60, h: 40 };
    // 57 wide, dragging the east edge: the sibling is 60.
    const snap = snapRect({ x: 10, y: 10, w: 57, h: 40 }, [sibling], eastOnly, config);
    expect(snap.dx).toBe(3);
    expect(snap.dy).toBe(0);
    // Two bars, one along each matched rect.
    expect(snap.bars).toEqual([
      { axis: "x", on: 30, start: 10, end: 70 },
      { axis: "x", on: 320, start: 300, end: 360 },
    ]);
  });

  it("moves the west edge the other way to reach the same width", () => {
    const sibling = { x: 300, y: 300, w: 60, h: 40 };
    const snap = snapRect({ x: 13, y: 10, w: 57, h: 40 }, [sibling], westOnly, config);
    expect(snap.dx).toBe(-3);
    expect(snap.bars[0]).toEqual({ axis: "x", on: 30, start: 10, end: 70 });
  });

  it("is never offered to a move, which keeps its size by definition", () => {
    const sibling = { x: 300, y: 300, w: 60, h: 40 };
    const snap = snapRect({ x: 10, y: 10, w: 57, h: 40 }, [sibling], MOVE_EDGES, config);
    expect(snap.dx).toBe(0);
    expect(snap.bars).toEqual([]);
  });

  it("yields to an edge alignment on the same axis", () => {
    // The east edge at 67 is 3 from the sibling's west edge at 70: an alignment,
    // and an alignment comes first.
    const sibling = { x: 70, y: 300, w: 60, h: 40 };
    const snap = snapRect({ x: 10, y: 10, w: 57, h: 40 }, [sibling], eastOnly, config);
    expect(snap.dx).toBe(3);
    expect(snap.guides).toHaveLength(1);
    expect(snap.bars).toEqual([]);
  });

  it("ignores a sibling outside tolerance", () => {
    const sibling = { x: 300, y: 300, w: 80, h: 40 };
    const snap = snapRect({ x: 10, y: 10, w: 57, h: 40 }, [sibling], eastOnly, config);
    expect(snap.dx).toBe(0);
  });
});

describe("the grid", () => {
  it("is eight world pixels, and the lattice is the last rule to fire", () => {
    expect(GRID_STEP).toBe(8);
    const snap = snapRect({ x: 13, y: 21, w: 40, h: 40 }, [], MOVE_EDGES, { ...config, grid: GRID_STEP });
    expect([snap.dx, snap.dy]).toEqual([3, 3]);
    // A parent edge inside tolerance wins over the lattice.
    const onParent = snapRect(
      { x: 103, y: 200, w: 40, h: 40 },
      [],
      MOVE_EDGES,
      { ...config, grid: GRID_STEP },
      { parent }
    );
    expect(onParent.dx).toBe(-3);
  });
});
