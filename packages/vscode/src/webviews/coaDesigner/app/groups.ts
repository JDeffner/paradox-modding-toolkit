/**
 * What a multi-selection of emblems does when it is moved, scaled, rotated,
 * mirrored, aligned, distributed or snapped to the grid.
 *
 * PURE by design (no DOM, no canvas), like elements.ts, and in the same space:
 * ARMS FRACTIONS, x and y running 0..1 across the arms rectangle. The app
 * turns the pointer into fractions and asks this module, so every gesture a
 * mouse can produce is a plain vitest assertion.
 *
 * Everything here takes and returns whole boxes rather than deltas, because a
 * coat of arms instance IS its box: `position` and `scale` are absolute
 * fractions with no anchor chain under them, so writing a box back is exactly
 * what the script says (which is why the GUI editor's align.ts, whose widgets
 * sit on an anchor chain, has to speak in deltas instead).
 */
import { corners, resizeBox, type Corner, type ElementBox } from "../../flagBuilder/app/elements";

/** An axis-aligned rectangle in arms fractions. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The arms themselves: what a single selected emblem aligns against. */
export const ARMS_RECT: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** Which edge or centre line to line up on. */
export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

export interface Delta {
  du: number;
  dv: number;
}

/** The box's own extent, rotation included: a turned emblem is wider than its scale. */
export function boxBounds(box: ElementBox): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of corners(box)) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The one box that holds every member: what the group handles are drawn on. */
export function selectionBounds(boxes: readonly ElementBox[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const box of boxes) {
    const r = boxBounds(box);
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rectCentre(r: Rect): [number, number] {
  return [r.x + r.w / 2, r.y + r.h / 2];
}

export function moveGroup(boxes: readonly ElementBox[], du: number, dv: number): ElementBox[] {
  return boxes.map((box) => ({ ...box, cx: box.cx + du, cy: box.cy + dv }));
}

/**
 * A corner drag on the group's own box. The factor and the anchor are
 * resizeBox's (aspect locked, the opposite corner stays put), applied to every
 * member: one gesture scales the arrangement, not each emblem separately.
 */
export function scaleGroup(boxes: readonly ElementBox[], corner: Corner, u: number, v: number): ElementBox[] {
  const bounds = selectionBounds(boxes);
  if (bounds.w === 0 || bounds.h === 0) return [...boxes];
  const [gx, gy] = rectCentre(bounds);
  const group: ElementBox = { cx: gx, cy: gy, w: bounds.w, h: bounds.h, rotation: 0 };
  const next = resizeBox(group, corner, u, v);
  const factor = next.w / bounds.w;
  return boxes.map((box) => ({
    ...box,
    cx: next.cx + (box.cx - gx) * factor,
    cy: next.cy + (box.cy - gy) * factor,
    w: box.w * factor,
    h: box.h * factor,
  }));
}

/** Turn the whole arrangement about the selection's centre. */
export function rotateGroup(boxes: readonly ElementBox[], degrees: number): ElementBox[] {
  const [gx, gy] = rectCentre(selectionBounds(boxes));
  const t = (degrees * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return boxes.map((box) => ({
    ...box,
    cx: gx + (box.cx - gx) * cos - (box.cy - gy) * sin,
    cy: gy + (box.cx - gx) * sin + (box.cy - gy) * cos,
    rotation: box.rotation + degrees,
  }));
}

/**
 * Mirror the selection about its own centre line. A mirrored instance is a
 * NEGATIVE scale on that axis, which is how the game writes one
 * (`scale = { -0.61 0.61 }` in 01_landed_titles.txt), and the rotation turns
 * the other way with it.
 */
export function mirrorGroup(boxes: readonly ElementBox[], axis: "x" | "y"): ElementBox[] {
  const bounds = selectionBounds(boxes);
  const [gx, gy] = rectCentre(bounds);
  return boxes.map((box) =>
    axis === "x"
      ? { ...box, cx: 2 * gx - box.cx, w: -box.w, rotation: -box.rotation }
      : { ...box, cy: 2 * gy - box.cy, h: -box.h, rotation: -box.rotation }
  );
}

/**
 * How far each member moves to line up on `frame`: the arms rectangle when one
 * emblem is selected (there is nothing else to line it up on) and the
 * selection's own bounding box when several are.
 */
export function alignDeltas(boxes: readonly ElementBox[], mode: AlignMode, frame: Rect): Delta[] {
  return boxes.map((box) => {
    const r = boxBounds(box);
    switch (mode) {
      case "left":
        return { du: frame.x - r.x, dv: 0 };
      case "right":
        return { du: frame.x + frame.w - (r.x + r.w), dv: 0 };
      case "hcenter":
        return { du: frame.x + frame.w / 2 - (r.x + r.w / 2), dv: 0 };
      case "top":
        return { du: 0, dv: frame.y - r.y };
      case "bottom":
        return { du: 0, dv: frame.y + frame.h - (r.y + r.h) };
      case "vcenter":
        return { du: 0, dv: frame.y + frame.h / 2 - (r.y + r.h / 2) };
    }
  });
}

/**
 * How far each member moves to leave EQUAL GAPS along one axis. The two
 * outermost stay where they are (they define the span), and the order is the
 * members' own along that axis, not the order they were selected in. Fewer
 * than three have no gap to equalise.
 */
export function distributeDeltas(boxes: readonly ElementBox[], axis: "x" | "y"): Delta[] {
  const none: Delta = { du: 0, dv: 0 };
  const deltas: Delta[] = boxes.map(() => none);
  if (boxes.length < 3) return deltas;
  const rects = boxes.map(boxBounds);
  const lo = (r: Rect): number => (axis === "x" ? r.x : r.y);
  const size = (r: Rect): number => (axis === "x" ? r.w : r.h);

  const order = rects.map((_, i) => i).sort((a, b) => lo(rects[a]) - lo(rects[b]));
  const first = rects[order[0]];
  const last = rects[order[order.length - 1]];
  const span = lo(last) + size(last) - lo(first);
  let filled = 0;
  for (const r of rects) filled += size(r);
  const gap = (span - filled) / (rects.length - 1);

  let at = lo(first);
  for (const i of order) {
    const delta = at - lo(rects[i]);
    deltas[i] = axis === "x" ? { du: delta, dv: 0 } : { du: 0, dv: delta };
    at += size(rects[i]) + gap;
  }
  return deltas;
}

/** The nearest grid line, the grid dividing the arms into `div` cells per axis. */
export function snapValue(v: number, div: number): number {
  return Math.round(v * div) / div;
}

/**
 * What a dragged selection has to shift by to sit on the grid: on each axis
 * the smallest correction its two edges and its centre ask for, and nothing at
 * all when the nearest of them is further away than `tol`.
 *
 * The centre is a candidate so that centring an emblem is one drag: every even
 * subdivision puts a line on 0.5, which is the arms' own centre line.
 */
export function snapDelta(bounds: Rect, div: number, tol: number): Delta {
  const best = (lo: number, size: number): number => {
    let pick = 0;
    let closest = Infinity;
    for (const at of [lo, lo + size / 2, lo + size]) {
      const to = snapValue(at, div) - at;
      if (Math.abs(to) < closest) {
        closest = Math.abs(to);
        pick = to;
      }
    }
    return closest <= tol ? pick : 0;
  };
  return { du: best(bounds.x, bounds.w), dv: best(bounds.y, bounds.h) };
}

/** How close a drag has to be to a grid line to take it, in arms fractions. */
export function snapTolerance(div: number): number {
  return Math.min(0.02, 0.4 / div);
}

// ---------------------------------------------------------------------------
// The grid the keyboard steps over
// ---------------------------------------------------------------------------

/**
 * The subdivisions the grid offers, cells per axis. Every one is even, so the
 * arms' own centre line is always a grid line; the fine end matters because
 * emblem positions are written with three decimals, and a quarter of the arms
 * is far coarser than the numbers a real design uses.
 */
export const GRID_DIVISIONS = [4, 8, 16, 32, 64] as const;

/** The grid a fresh panel starts on: fine enough to place against, coarse enough to read. */
export const DEFAULT_GRID_DIVISION = 16;

/** A remembered subdivision the picker no longer offers falls back to the default. */
export function validGridDivision(div: number | undefined): number {
  return (GRID_DIVISIONS as readonly number[]).includes(div ?? 0) ? div! : DEFAULT_GRID_DIVISION;
}

/**
 * How far one arrow press moves the selection, in arms fractions.
 *
 * With the grid ON an arrow is one CELL and Shift is four of them, so the
 * keyboard lands on the same lines a drag snaps to. With the grid off there is
 * no cell to follow, so the step is a fixed fraction of the arms: 1/256 is half
 * a pixel of the 512px preview, the smallest move worth making, and Shift's
 * 1/32 crosses the whole arms in 32 presses.
 */
export function nudgeStep(gridOn: boolean, div: number, shift: boolean): number {
  if (!gridOn) return shift ? 1 / 32 : 1 / 256;
  return (shift ? 4 : 1) / div;
}
