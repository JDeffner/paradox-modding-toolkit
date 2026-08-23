/**
 * Smart guides: where a dragged rect wants to land, and the lines that say why.
 *
 * PURE by design (no DOM, no camera, no host): the shell converts its screen
 * tolerance into world units and hands in the sibling rects, so every alignment
 * case is a plain vitest assertion.
 *
 * The snap is applied to the DELTA, before anything is derived from it, for the
 * same reason gesture.ts rounds there: the preview, the readout and the commit
 * all come out of one number, so a snapped drag cannot show one value and write
 * another.
 *
 * Per axis, exactly one rule fires, in this order:
 * 1. an EDGE or CENTRE alignment with a sibling, or with the PARENT's own
 *    content box (its edges and its centre), when one is inside tolerance;
 * 2. EQUAL SIZE with a sibling (resizes only: the dragged edge lands where the
 *    rect's extent matches a neighbour's);
 * 3. EQUAL SPACING between the two siblings the rect sits between (moves only:
 *    a resize has no second gap to equalise);
 * 4. the GRID, when it is on. It is last because a guide is a statement about
 *    the file's own geometry and a grid is an arbitrary lattice over it.
 */
import type { SceneRect } from "./scene";

/** World-unit grid step. Not a measured number: a round lattice to nudge along. */
export const GRID_STEP = 8;

/** One alignment line: `at` on `axis`, drawn across the perpendicular span. */
export interface Guide {
  axis: "x" | "y";
  at: number;
  start: number;
  end: number;
}

/** One equal-spacing bar: a gap segment along `axis`, at the perpendicular `on`. */
export interface SpacingBar {
  axis: "x" | "y";
  on: number;
  start: number;
  end: number;
}

export interface SnapResult {
  /** Extra offset the snap adds to the gesture's own delta. */
  dx: number;
  dy: number;
  guides: Guide[];
  bars: SpacingBar[];
}

export interface SnapConfig {
  /** How close an alignment has to be to take, in WORLD units (screen px / zoom). */
  tolerance: number;
  /** Grid step in world units, or 0 when the grid is off. */
  grid: number;
  /** Sibling alignment and equal spacing are on. */
  guides: boolean;
}

/** Which edges of the rect the gesture is moving; a move moves all four. */
export interface SnapEdges {
  west: boolean;
  east: boolean;
  north: boolean;
  south: boolean;
}

export const MOVE_EDGES: SnapEdges = { west: true, east: true, north: true, south: true };

/**
 * What the rect can align to besides its siblings. `parent` is the container's
 * content box (the engine's rect for it: a child's position is already
 * relative to that box, so its edges and centre are the lines a designer means
 * by "flush left" and "centred"). Optional, so a caller with siblings alone
 * keeps its old call.
 */
export interface SnapContext {
  parent?: SceneRect | null;
}

const NOTHING: SnapResult = { dx: 0, dy: 0, guides: [], bars: [] };

interface Axis {
  /** Low edge of a rect on this axis. */
  lo: (r: SceneRect) => number;
  /** Extent of a rect on this axis. */
  len: (r: SceneRect) => number;
  /** Low edge on the OTHER axis, for the span a guide is drawn over. */
  crossLo: (r: SceneRect) => number;
  crossLen: (r: SceneRect) => number;
}

const AXIS_X: Axis = { lo: (r) => r.x, len: (r) => r.w, crossLo: (r) => r.y, crossLen: (r) => r.h };
const AXIS_Y: Axis = { lo: (r) => r.y, len: (r) => r.h, crossLo: (r) => r.x, crossLen: (r) => r.w };

/**
 * The offset the snap adds to a gesture that would put the moving widget at
 * `rect`. `siblings` are the other children of the same container: the only
 * rects a designer aligns against, and few enough that the whole search is
 * linear per pointer move.
 */
export function snapRect(
  rect: SceneRect,
  siblings: readonly SceneRect[],
  edges: SnapEdges,
  config: SnapConfig,
  context: SnapContext = {}
): SnapResult {
  if (!config.guides && config.grid <= 0) return NOTHING;
  const parent = context.parent ?? null;
  const x = snapAxis(rect, siblings, parent, AXIS_X, edges.west, edges.east, config, "x");
  const y = snapAxis(rect, siblings, parent, AXIS_Y, edges.north, edges.south, config, "y");
  return {
    dx: x.offset,
    dy: y.offset,
    guides: [...x.guides, ...y.guides],
    bars: [...x.bars, ...y.bars],
  };
}

interface AxisSnap {
  offset: number;
  guides: Guide[];
  bars: SpacingBar[];
}

function snapAxis(
  rect: SceneRect,
  siblings: readonly SceneRect[],
  parent: SceneRect | null,
  axis: Axis,
  low: boolean,
  high: boolean,
  config: SnapConfig,
  name: "x" | "y"
): AxisSnap {
  if (!low && !high) return { offset: 0, guides: [], bars: [] };

  if (config.guides) {
    // The parent's box offers the same three lines a sibling does. It is not a
    // sibling for size or spacing: a rect is never "between" or "as big as"
    // the container it sits in.
    const targets = parent ? [...siblings, parent] : siblings;
    const aligned = alignAxis(rect, targets, axis, low, high, config.tolerance, name);
    if (aligned) return { offset: aligned.offset, guides: aligned.guides, bars: [] };
    if (low !== high) {
      // One edge moves: a resize. Matching a neighbour's extent is what the
      // dragged edge most often wants, and the bars mark the two equal lengths.
      const sized = sizeAxis(rect, siblings, axis, low, config.tolerance, name);
      if (sized) return { offset: sized.offset, guides: [], bars: sized.bars };
    }
    // Equal spacing is a statement about a rect that keeps its size, so it is
    // offered to a move and never to a resize.
    if (low && high) {
      const spaced = spaceAxis(rect, siblings, axis, config.tolerance, name);
      if (spaced) return { offset: spaced.offset, guides: [], bars: spaced.bars };
    }
  }
  if (config.grid > 0) {
    const value = low ? axis.lo(rect) : axis.lo(rect) + axis.len(rect);
    return { offset: Math.round(value / config.grid) * config.grid - value, guides: [], bars: [] };
  }
  return { offset: 0, guides: [], bars: [] };
}

/**
 * The closest edge-or-centre alignment inside tolerance. Every sibling offers
 * three lines (low edge, centre, high edge) and the moving rect offers the ones
 * the gesture actually moves; the smallest correction wins, and every candidate
 * that lands on the same line is drawn, so aligning a column of three shows one
 * guide through all of them.
 */
function alignAxis(
  rect: SceneRect,
  siblings: readonly SceneRect[],
  axis: Axis,
  low: boolean,
  high: boolean,
  tolerance: number,
  name: "x" | "y"
): { offset: number; guides: Guide[] } | null {
  const moving: number[] = [];
  if (low) moving.push(axis.lo(rect));
  if (high) moving.push(axis.lo(rect) + axis.len(rect));
  // A centre only tracks the rect when the whole rect travels.
  if (low && high) moving.push(axis.lo(rect) + axis.len(rect) / 2);

  let best: number | null = null;
  let bestOffset = 0;
  for (const sibling of siblings) {
    const lo = axis.lo(sibling);
    const len = axis.len(sibling);
    for (const target of [lo, lo + len / 2, lo + len]) {
      for (const value of moving) {
        const offset = target - value;
        if (Math.abs(offset) > tolerance) continue;
        if (best !== null && Math.abs(offset) >= Math.abs(bestOffset)) continue;
        best = target;
        bestOffset = offset;
      }
    }
  }
  if (best === null) return null;

  // The line is drawn over everything it touches: the moved rect and every
  // sibling that shares it.
  const at = best;
  let start = axis.crossLo(rect);
  let end = start + axis.crossLen(rect);
  for (const sibling of siblings) {
    const lo = axis.lo(sibling);
    const len = axis.len(sibling);
    if (![lo, lo + len / 2, lo + len].some((t) => Math.abs(t - at) < 0.001)) continue;
    start = Math.min(start, axis.crossLo(sibling));
    end = Math.max(end, axis.crossLo(sibling) + axis.crossLen(sibling));
  }
  return { offset: bestOffset, guides: [{ axis: name, at, start, end }] };
}

/**
 * Equal spacing: the rect sits between two siblings, and the gap to each is
 * within tolerance of the other, so the drag lands it exactly halfway. Only the
 * nearest sibling on each side counts, which is the gap a designer is looking
 * at while dragging.
 */
function spaceAxis(
  rect: SceneRect,
  siblings: readonly SceneRect[],
  axis: Axis,
  tolerance: number,
  name: "x" | "y"
): { offset: number; bars: SpacingBar[] } | null {
  const lo = axis.lo(rect);
  const hi = lo + axis.len(rect);
  let before: SceneRect | null = null;
  let after: SceneRect | null = null;
  for (const sibling of siblings) {
    const sLo = axis.lo(sibling);
    const sHi = sLo + axis.len(sibling);
    if (sHi <= lo && (before === null || sHi > axis.lo(before) + axis.len(before))) before = sibling;
    if (sLo >= hi && (after === null || sLo < axis.lo(after))) after = sibling;
  }
  if (!before || !after) return null;

  const gapBefore = lo - (axis.lo(before) + axis.len(before));
  const gapAfter = axis.lo(after) - hi;
  const offset = (gapAfter - gapBefore) / 2;
  if (Math.abs(offset) > tolerance) return null;

  const on = axis.crossLo(rect) + axis.crossLen(rect) / 2;
  return {
    offset,
    bars: [
      { axis: name, on, start: axis.lo(before) + axis.len(before), end: lo + offset },
      { axis: name, on, start: hi + offset, end: axis.lo(after) },
    ],
  };
}

/**
 * Equal size: the closest sibling whose extent on this axis is within tolerance
 * of the rect's. The offset moves the DRAGGED edge (the low one when `low`) so
 * the two extents match exactly, and the bars run the length of both rects so
 * the match reads as a measure rather than a line.
 */
function sizeAxis(
  rect: SceneRect,
  siblings: readonly SceneRect[],
  axis: Axis,
  low: boolean,
  tolerance: number,
  name: "x" | "y"
): { offset: number; bars: SpacingBar[] } | null {
  const len = axis.len(rect);
  let best: SceneRect | null = null;
  let bestDiff = 0;
  for (const sibling of siblings) {
    const diff = axis.len(sibling) - len;
    if (Math.abs(diff) > tolerance) continue;
    if (best !== null && Math.abs(diff) >= Math.abs(bestDiff)) continue;
    best = sibling;
    bestDiff = diff;
  }
  if (best === null) return null;
  // Growing by `diff` means the high edge moves out by it, or the low edge in.
  const offset = low ? -bestDiff : bestDiff;
  const lo = axis.lo(rect) + (low ? offset : 0);
  return {
    offset,
    bars: [
      { axis: name, on: axis.crossLo(rect) + axis.crossLen(rect) / 2, start: lo, end: lo + len + bestDiff },
      {
        axis: name,
        on: axis.crossLo(best) + axis.crossLen(best) / 2,
        start: axis.lo(best),
        end: axis.lo(best) + axis.len(best),
      },
    ],
  };
}
