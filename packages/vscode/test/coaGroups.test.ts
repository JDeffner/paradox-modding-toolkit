/**
 * The Coat of Arms Designer's group geometry (app/groups.ts): what a
 * multi-selection does when it is scaled, rotated, mirrored, aligned,
 * distributed or snapped.
 *
 * Pure arithmetic in arms fractions, so every case is an assertion rather than
 * a mouse. The sibling suite for one element is flagBuilderElements.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { ElementBox } from "../src/webviews/flagBuilder/app/elements";
import {
  alignDeltas,
  ARMS_RECT,
  boxBounds,
  distributeDeltas,
  mirrorGroup,
  moveGroup,
  rotateGroup,
  scaleGroup,
  selectionBounds,
  snapDelta,
  snapValue,
} from "../src/webviews/coaDesigner/app/groups";

const box = (cx: number, cy: number, w: number, h: number, rotation = 0): ElementBox => ({
  cx,
  cy,
  w,
  h,
  rotation,
});

const near = (a: number, b: number, digits = 6): void => expect(a).toBeCloseTo(b, digits);

describe("bounds", () => {
  it("a turned emblem is wider than its scale", () => {
    const square = boxBounds(box(0.5, 0.5, 0.2, 0.2, 45));
    near(square.w, 0.2 * Math.SQRT2);
    near(square.h, 0.2 * Math.SQRT2);
  });

  it("a mirrored emblem is still the same size", () => {
    expect(boxBounds(box(0.5, 0.5, -0.2, 0.2))).toEqual(boxBounds(box(0.5, 0.5, 0.2, 0.2)));
  });

  it("the selection box holds every member", () => {
    const bounds = selectionBounds([box(0.2, 0.2, 0.2, 0.2), box(0.8, 0.6, 0.2, 0.2)]);
    near(bounds.x, 0.1);
    near(bounds.y, 0.1);
    near(bounds.w, 0.8);
    near(bounds.h, 0.6);
  });

  it("an empty selection has no box", () => {
    expect(selectionBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("group transforms", () => {
  it("a move shifts every member by the same amount", () => {
    const moved = moveGroup([box(0.2, 0.2, 0.1, 0.1), box(0.8, 0.8, 0.1, 0.1)], 0.1, -0.05);
    expect(moved.map((b) => [b.cx, b.cy])).toEqual([
      [0.30000000000000004, 0.15000000000000002],
      [0.9, 0.75],
    ]);
  });

  it("a corner drag keeps the opposite corner and the arrangement's shape", () => {
    const boxes = [box(0.3, 0.3, 0.2, 0.2), box(0.7, 0.7, 0.2, 0.2)];
    // Selection box is 0.2..0.8 both ways; drag the SE corner out to 1.4.
    const next = scaleGroup(boxes, "se", 1.4, 1.4);
    const before = selectionBounds(boxes);
    const after = selectionBounds(next);
    // The NW corner stays put, which is what an opposite-corner anchor means.
    near(after.x, before.x);
    near(after.y, before.y);
    // One factor on both axes: the members grow by it and stay square.
    const factor = after.w / before.w;
    near(next[0].w, boxes[0].w * factor);
    near(next[0].h, boxes[0].h * factor);
    near(next[1].w, boxes[1].w * factor);
  });

  it("a group scale keeps a mirrored member mirrored", () => {
    const next = scaleGroup([box(0.3, 0.3, -0.2, 0.2), box(0.7, 0.7, 0.2, 0.2)], "se", 1.2, 1.2);
    expect(next[0].w).toBeLessThan(0);
  });

  it("a rotate turns the arrangement about its own centre", () => {
    const boxes = [box(0.3, 0.5, 0.1, 0.1), box(0.7, 0.5, 0.1, 0.1)];
    const next = rotateGroup(boxes, 90);
    // The pair was side by side; a quarter turn stacks it.
    near(next[0].cx, 0.5);
    near(next[0].cy, 0.3);
    near(next[1].cx, 0.5);
    near(next[1].cy, 0.7);
    expect(next.map((b) => b.rotation)).toEqual([90, 90]);
  });

  it("a mirror is a negative scale and a swapped position", () => {
    const boxes = [box(0.3, 0.5, 0.2, 0.2), box(0.7, 0.5, 0.2, 0.2)];
    const next = mirrorGroup(boxes, "x");
    near(next[0].cx, 0.7);
    near(next[1].cx, 0.3);
    expect(next[0].w).toBe(-0.2);
    // The other axis is untouched.
    expect(next.map((b) => b.cy)).toEqual([0.5, 0.5]);
    expect(next.map((b) => b.h)).toEqual([0.2, 0.2]);
  });

  it("a mirror turns a rotated emblem the other way", () => {
    expect(mirrorGroup([box(0.5, 0.5, 0.2, 0.2, 15)], "x")[0].rotation).toBe(-15);
  });

  it("mirroring twice is where it started", () => {
    const boxes = [box(0.3, 0.4, 0.2, 0.1, 20), box(0.9, 0.5, 0.1, 0.3)];
    const back = mirrorGroup(mirrorGroup(boxes, "y"), "y");
    back.forEach((b, i) => {
      near(b.cx, boxes[i].cx);
      near(b.cy, boxes[i].cy);
      near(b.h, boxes[i].h);
      near(b.rotation, boxes[i].rotation);
    });
  });
});

describe("align and distribute", () => {
  it("one emblem lines up against the arms themselves", () => {
    // Its box runs 0.3..0.5, so "left" pulls it to the arms' own edge.
    const one = [box(0.4, 0.4, 0.2, 0.2)];
    expect(alignDeltas(one, "left", ARMS_RECT)[0].du).toBeCloseTo(-0.3, 6);
    expect(alignDeltas(one, "right", ARMS_RECT)[0].du).toBeCloseTo(0.5, 6);
    expect(alignDeltas(one, "hcenter", ARMS_RECT)[0].du).toBeCloseTo(0.1, 6);
    expect(alignDeltas(one, "vcenter", ARMS_RECT)[0].dv).toBeCloseTo(0.1, 6);
  });

  it("several line up on the box they share, and only on one axis", () => {
    const boxes = [box(0.3, 0.2, 0.2, 0.2), box(0.7, 0.8, 0.2, 0.2)];
    const deltas = alignDeltas(boxes, "left", selectionBounds(boxes));
    near(deltas[0].du, 0);
    near(deltas[1].du, -0.4);
    expect(deltas.map((d) => d.dv)).toEqual([0, 0]);
  });

  it("distribute leaves equal gaps and does not move the outermost", () => {
    const boxes = [box(0.1, 0.5, 0.1, 0.1), box(0.3, 0.5, 0.1, 0.1), box(0.9, 0.5, 0.1, 0.1)];
    const deltas = distributeDeltas(boxes, "x");
    near(deltas[0].du, 0);
    near(deltas[2].du, 0);
    const spread = boxes.map((b, i) => b.cx + deltas[i].du).sort((a, b) => a - b);
    near(spread[1] - spread[0], spread[2] - spread[1]);
  });

  it("distribute sorts by position, not by pick order", () => {
    const boxes = [box(0.9, 0.5, 0.1, 0.1), box(0.1, 0.5, 0.1, 0.1), box(0.4, 0.5, 0.1, 0.1)];
    const deltas = distributeDeltas(boxes, "x");
    // The two outermost are the ones at 0.1 and 0.9, whichever slot they sit in.
    near(deltas[0].du, 0);
    near(deltas[1].du, 0);
  });

  it("fewer than three has no gap to equalise", () => {
    expect(distributeDeltas([box(0.2, 0.2, 0.1, 0.1), box(0.8, 0.2, 0.1, 0.1)], "x")).toEqual([
      { du: 0, dv: 0 },
      { du: 0, dv: 0 },
    ]);
  });
});

describe("the grid", () => {
  it("snaps to the nearest line of the subdivision", () => {
    expect(snapValue(0.26, 4)).toBe(0.25);
    expect(snapValue(0.6, 2)).toBe(0.5);
  });

  it("centring is one drag: the centre line is a candidate", () => {
    // A 0.2 box dropped just off centre; nothing else is nearer.
    const to = snapDelta({ x: 0.39, y: 0.39, w: 0.2, h: 0.2 }, 2, 0.02);
    near(to.du, 0.01);
    near(to.dv, 0.01);
  });

  it("an edge can win over the centre", () => {
    // Centre 0.31 is 0.06 off the 0.25 line; the left edge at 0.26 is 0.01 off.
    const to = snapDelta({ x: 0.26, y: 0.5, w: 0.1, h: 0.1 }, 4, 0.02);
    near(to.du, -0.01);
  });

  it("nothing snaps when nothing is close", () => {
    expect(snapDelta({ x: 0.13, y: 0.13, w: 0.11, h: 0.11 }, 8, 0.005)).toEqual({ du: 0, dv: 0 });
  });
});
