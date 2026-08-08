/**
 * Gesture math: what a drag or a resize handle writes.
 *
 * PURE by design (no DOM, no canvas, no host), so every case a mouse can
 * produce is a plain vitest assertion and the shell stays a state machine over
 * this module.
 *
 * The one rule the whole file exists to enforce: a gesture commits
 * EFFECTIVE VALUE + DELTA, never the canvas coordinate under the cursor. The
 * rect a widget lands on is the engine's answer to anchors, parent content
 * boxes, margins and box slots; writing the cursor's world position back would
 * write that whole chain into `position` and move the widget somewhere else the
 * moment the engine re-applied it. The delta, on the other hand, translates 1:1
 * (every one of those rules is an additive offset), so base + delta is the only
 * arithmetic here.
 *
 * Deltas are rounded ONCE, before anything is derived from them, so the preview
 * the user drags is the same number the commit writes, and a west handle's
 * position and size cannot disagree by a rounding error.
 */
import type { SceneItem, SceneRect } from "./scene";

/** The eight resize handles, named by compass point. */
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** Handle square, SCREEN pixels: it stays the same size at every zoom. */
export const HANDLE_SIZE = 9;

/**
 * How far the pointer travels, in SCREEN pixels, before a press becomes a
 * gesture. Below it the press is a click, so selecting never nudges a widget.
 */
export const DRAG_THRESHOLD = 3;

export interface HandlePoint {
  handle: ResizeHandle;
  /** Handle centre, world coordinates. */
  x: number;
  y: number;
}

/**
 * The eight handle centres in world coordinates, CORNERS FIRST: on a small
 * widget the squares overlap, and a corner is the more specific thing to grab.
 */
export function handlePoints(rect: SceneRect): HandlePoint[] {
  const midX = rect.x + rect.w / 2;
  const midY = rect.y + rect.h / 2;
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  return [
    { handle: "nw", x: rect.x, y: rect.y },
    { handle: "ne", x: right, y: rect.y },
    { handle: "se", x: right, y: bottom },
    { handle: "sw", x: rect.x, y: bottom },
    { handle: "n", x: midX, y: rect.y },
    { handle: "e", x: right, y: midY },
    { handle: "s", x: midX, y: bottom },
    { handle: "w", x: rect.x, y: midY },
  ];
}

/** Which handle a world point grabs, or null when it grabs none of them. */
export function handleAt(rect: SceneRect, x: number, y: number, zoom: number): ResizeHandle | null {
  const half = HANDLE_SIZE / 2 / zoom;
  for (const point of handlePoints(rect)) {
    if (Math.abs(x - point.x) <= half && Math.abs(y - point.y) <= half) return point.handle;
  }
  return null;
}

/** The CSS cursor for a handle; the diagonal pairs share one. */
export function handleCursor(handle: ResizeHandle): string {
  if (handle === "nw" || handle === "se") return "nwse-resize";
  if (handle === "ne" || handle === "sw") return "nesw-resize";
  return handle === "n" || handle === "s" ? "ns-resize" : "ew-resize";
}

/**
 * The values a commit adds its delta to: the widget's EFFECTIVE `position` and
 * `size`, as the engine resolved them through the template and type chain
 * (`GuiLayoutNode.srcPosition`/`srcSize`), not what this file happens to say.
 * A widget with no size of its own is sized by the engine, and its laid-out
 * rect is the honest base for the first explicit size a resize writes.
 */
export interface GestureBase {
  position: [number, number];
  size: [number, number];
}

export function baseOf(item: SceneItem): GestureBase {
  return {
    position: item.srcPosition ?? [0, 0],
    size: item.srcSize ?? [item.rect.w, item.rect.h],
  };
}

/**
 * A gesture's delta in whole world pixels. Rounded before ANY value is derived
 * from it: the preview, the readout and the commit then agree by construction.
 */
export function roundDelta(dx: number, dy: number): [number, number] {
  return [Math.round(dx), Math.round(dy)];
}

export interface GestureWrite {
  /** Exactly what the commit sends, in order; empty when there is nothing to write. */
  properties: { key: string; value: string }[];
  /** The previewed rect: what the marquee draws and the readout reports. */
  rect: SceneRect;
  /** How far the widget's own subtree moved (a resize from a west/north edge moves it too). */
  offset: { dx: number; dy: number };
  /** The gesture rounded to less than a pixel: honest nothing, not a silent drop. */
  noop: boolean;
}

/** `{ a b }`, the pair syntax the writer expects, at the game's own precision. */
export function pairValue(a: number, b: number): string {
  return `{ ${formatNumber(a)} ${formatNumber(b)} }`;
}

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** A move writes `position` and nothing else. */
export function moveWrite(base: GestureBase, rect: SceneRect, dx: number, dy: number): GestureWrite {
  const properties =
    dx === 0 && dy === 0
      ? []
      : [{ key: "position", value: pairValue(base.position[0] + dx, base.position[1] + dy) }];
  return {
    properties,
    rect: { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h },
    offset: { dx, dy },
    noop: properties.length === 0,
  };
}

/** Which edges of the rect a handle drags. */
export function edgesOf(handle: ResizeHandle): {
  west: boolean;
  east: boolean;
  north: boolean;
  south: boolean;
} {
  return {
    west: handle === "nw" || handle === "w" || handle === "sw",
    east: handle === "ne" || handle === "e" || handle === "se",
    north: handle === "nw" || handle === "n" || handle === "ne",
    south: handle === "sw" || handle === "s" || handle === "se",
  };
}

/**
 * A resize writes `size`, plus `position` when the dragged edge is the west or
 * north one: moving that edge is a move of the origin and a size change of the
 * opposite amount, and the two have to be one commit or the far edge walks.
 */
export function resizeWrite(
  base: GestureBase,
  rect: SceneRect,
  handle: ResizeHandle,
  dx: number,
  dy: number
): GestureWrite {
  const { west, east, north, south } = edgesOf(handle);

  let px = west ? dx : 0;
  let py = north ? dy : 0;
  let dw = east ? dx : west ? -dx : 0;
  let dh = south ? dy : north ? -dy : 0;
  // A widget never resizes through itself: the clamp stops the dragged edge at
  // the opposite one instead of writing a negative size.
  if (base.size[0] + dw < 0) {
    const over = -(base.size[0] + dw);
    dw += over;
    if (west) px -= over;
  }
  if (base.size[1] + dh < 0) {
    const over = -(base.size[1] + dh);
    dh += over;
    if (north) py -= over;
  }

  const properties: { key: string; value: string }[] = [];
  // Only what actually changed: a north handle dragged straight up must not add
  // an unchanged `position` to a widget that never had one.
  if (px !== 0 || py !== 0) {
    properties.push({ key: "position", value: pairValue(base.position[0] + px, base.position[1] + py) });
  }
  if (dw !== 0 || dh !== 0) {
    properties.push({ key: "size", value: pairValue(base.size[0] + dw, base.size[1] + dh) });
  }
  return {
    properties,
    rect: {
      x: rect.x + px,
      y: rect.y + py,
      w: Math.max(0, rect.w + dw),
      h: Math.max(0, rect.h + dh),
    },
    offset: { dx: px, dy: py },
    noop: properties.length === 0,
  };
}

/**
 * Every property key the gesture COULD write, which is what the gesture-start
 * check asks the guards about. It is a superset of what the commit sends (a
 * handle dragged along one axis only writes one of them), on purpose: the
 * answer has to be known before the widget moves, and it must not depend on
 * where the drag happens to end.
 */
export function gestureKeys(handle: ResizeHandle | null): string[] {
  if (!handle) return ["position"];
  const { west, north } = edgesOf(handle);
  return west || north ? ["position", "size"] : ["size"];
}
