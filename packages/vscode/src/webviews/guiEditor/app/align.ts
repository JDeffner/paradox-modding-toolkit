/**
 * Align and distribute: what a multi-selection's members have to MOVE BY.
 *
 * PURE (no DOM, no host), and deltas rather than coordinates, for the reason
 * gesture.ts writes `base + delta`: the rect a widget sits on is the engine's
 * answer to anchors, parent content boxes and margins, so writing a canvas
 * coordinate back into `position` would write that whole chain into it. Every
 * placement rule under a positioned widget is an additive offset, so a delta
 * translates 1:1 and is the only arithmetic that survives the round trip.
 *
 * Deltas are whole pixels, rounded here, so the preview, the readout and the
 * commit cannot disagree by a rounding error (gesture.ts's rule).
 */
import type { SceneRect } from "./scene";

/** Which edge or centre line of the selection's bounding box to line up on. */
export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

export interface AlignDelta {
  dx: number;
  dy: number;
}

const NONE: AlignDelta = { dx: 0, dy: 0 };

/** The selection's bounding box. */
function bounds(rects: readonly SceneRect[]): SceneRect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * How far each member moves to line up on the selection's own bounding box.
 * Two members are the minimum: aligning one widget to itself is nothing.
 */
export function alignDeltas(rects: readonly SceneRect[], mode: AlignMode): AlignDelta[] {
  if (rects.length < 2) return rects.map(() => NONE);
  const box = bounds(rects);
  return rects.map((r) => {
    switch (mode) {
      case "left":
        return { dx: Math.round(box.x - r.x), dy: 0 };
      case "right":
        return { dx: Math.round(box.x + box.w - (r.x + r.w)), dy: 0 };
      case "hcenter":
        return { dx: Math.round(box.x + box.w / 2 - (r.x + r.w / 2)), dy: 0 };
      case "top":
        return { dx: 0, dy: Math.round(box.y - r.y) };
      case "bottom":
        return { dx: 0, dy: Math.round(box.y + box.h - (r.y + r.h)) };
      case "vcenter":
        return { dx: 0, dy: Math.round(box.y + box.h / 2 - (r.y + r.h / 2)) };
    }
  });
}

/**
 * How far each member moves to leave EQUAL GAPS along one axis. The two
 * outermost stay where they are (they define the span the rest is spread
 * across), and the order is the members' own along that axis, not the order
 * they were selected in. Fewer than three members have no gap to equalise.
 */
export function distributeDeltas(rects: readonly SceneRect[], axis: "x" | "y"): AlignDelta[] {
  const deltas = rects.map(() => NONE);
  if (rects.length < 3) return deltas;
  const lo = (r: SceneRect) => (axis === "x" ? r.x : r.y);
  const size = (r: SceneRect) => (axis === "x" ? r.w : r.h);

  const order = rects.map((_, i) => i).sort((a, b) => lo(rects[a]) - lo(rects[b]));
  const first = rects[order[0]];
  const last = rects[order[order.length - 1]];
  const span = lo(last) + size(last) - lo(first);
  let filled = 0;
  for (const r of rects) filled += size(r);
  const gap = (span - filled) / (rects.length - 1);

  let at = lo(first);
  for (const i of order) {
    const delta = Math.round(at - lo(rects[i]));
    deltas[i] = axis === "x" ? { dx: delta, dy: 0 } : { dx: 0, dy: delta };
    at += size(rects[i]) + gap;
  }
  return deltas;
}
