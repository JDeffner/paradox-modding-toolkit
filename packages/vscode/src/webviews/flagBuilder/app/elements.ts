/**
 * The flag's elements on the canvas: where each instance of each layer lands,
 * which one a click grabs, and what a drag or a corner handle writes.
 *
 * PURE by design (no DOM, no canvas): the app turns the pointer into flag
 * fractions and asks this module, so every case a mouse can produce is a plain
 * vitest assertion and the shell stays a state machine over it.
 *
 * Everything here is in FLAG FRACTIONS, the space render.ts paints in: x and y
 * run 0..1 across the flag and a rotation turns in that (non-square) space,
 * exactly as the game stretches a rotated emblem on a 3:2 flag. Which is why a
 * box is centre-based even for a sub flag, whose script is corner-based: one
 * shape means one set of gestures.
 */
import { DEFAULT_INSTANCE, DEFAULT_SUB_INSTANCE, type CoaLayer } from "@px-lsp/server/coa/coa";

/** Handle square, SCREEN pixels: the GUI editor's size, so the two editors match. */
export const HANDLE_SIZE = 9;

/** How far the pointer travels, in SCREEN pixels, before a press becomes a drag. */
export const DRAG_THRESHOLD = 3;

/** A resize never shrinks an element past this fraction of itself in one step. */
const MIN_FACTOR = 0.02;

export type Corner = "nw" | "ne" | "se" | "sw";

/** One instance of one layer: what a click selects and a drag moves. */
export interface ElementRef {
  layer: number;
  instance: number;
}

/** An element's placement, centre-based like a colored emblem's own. */
export interface ElementBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Degrees; a sub flag is always 0, the game does not turn those. */
  rotation: number;
}

/** How many elements a layer shows: an empty `instances` still draws one, the default. */
export function instanceCount(layer: CoaLayer): number {
  return Math.max(1, layer.instances.length);
}

/** The box of instance `i`, falling back to the default instance the renderer uses. */
export function boxOf(layer: CoaLayer, i: number): ElementBox {
  if (layer.kind === "sub") {
    const inst = layer.instances[i] ?? DEFAULT_SUB_INSTANCE;
    return {
      cx: inst.offset[0] + inst.scale[0] / 2,
      cy: inst.offset[1] + inst.scale[1] / 2,
      w: inst.scale[0],
      h: inst.scale[1],
      rotation: 0,
    };
  }
  const inst = layer.instances[i] ?? DEFAULT_INSTANCE;
  return {
    cx: inst.position[0],
    cy: inst.position[1],
    w: inst.scale[0],
    h: inst.scale[1],
    rotation: inst.rotation,
  };
}

/** The inspector shows three decimals; the model holds exactly what it shows. */
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Write a box back into instance `i`, which must exist: the caller materializes
 * an implicit default instance before a gesture, so that the edit has something
 * to live in and the script gains the block the user just moved.
 */
export function writeBox(layer: CoaLayer, i: number, box: ElementBox): void {
  if (layer.kind === "sub") {
    const inst = layer.instances[i];
    inst.offset = [round(box.cx - box.w / 2), round(box.cy - box.h / 2)];
    inst.scale = [round(box.w), round(box.h)];
    return;
  }
  const inst = layer.instances[i];
  inst.position = [round(box.cx), round(box.cy)];
  inst.scale = [round(box.w), round(box.h)];
}

function trig(box: ElementBox): [number, number] {
  const t = (box.rotation * Math.PI) / 180;
  return [Math.cos(t), Math.sin(t)];
}

/** Flag fractions to the box's own frame (its centre at the origin, unrotated). */
function toLocal(box: ElementBox, u: number, v: number): [number, number] {
  const [cos, sin] = trig(box);
  const dx = u - box.cx;
  const dy = v - box.cy;
  return [dx * cos + dy * sin, -dx * sin + dy * cos];
}

/** The box's own frame back to flag fractions. */
function toFlag(box: ElementBox, lx: number, ly: number): [number, number] {
  const [cos, sin] = trig(box);
  return [box.cx + lx * cos - ly * sin, box.cy + lx * sin + ly * cos];
}

/** Half-sizes, so a mirrored instance (a negative scale) is still grabbable. */
function halves(box: ElementBox): [number, number] {
  return [Math.abs(box.w) / 2, Math.abs(box.h) / 2];
}

export function containsPoint(box: ElementBox, u: number, v: number): boolean {
  const [lx, ly] = toLocal(box, u, v);
  const [hx, hy] = halves(box);
  return Math.abs(lx) <= hx && Math.abs(ly) <= hy;
}

/** The four corners in flag fractions, clockwise from the top-left of the box's own frame. */
export function corners(box: ElementBox): { corner: Corner; x: number; y: number }[] {
  const [hx, hy] = halves(box);
  const signs: [Corner, number, number][] = [
    ["nw", -1, -1],
    ["ne", 1, -1],
    ["se", 1, 1],
    ["sw", -1, 1],
  ];
  return signs.map(([corner, sx, sy]) => {
    const [x, y] = toFlag(box, sx * hx, sy * hy);
    return { corner, x, y };
  });
}

/**
 * Which corner handle a point grabs. The tolerances are per axis because the
 * squares are screen-aligned on a flag that is wider than it is tall: half a
 * handle is a different fraction across than it is down.
 */
export function cornerAt(box: ElementBox, u: number, v: number, tolU: number, tolV: number): Corner | null {
  for (const point of corners(box)) {
    if (Math.abs(u - point.x) <= tolU && Math.abs(v - point.y) <= tolV) return point.corner;
  }
  return null;
}

/**
 * The element under (u, v), topmost first: layers draw in order, so the last
 * one painted is the one a click means, and the same within a layer's instances.
 */
export function hitElement(layers: readonly CoaLayer[], u: number, v: number): ElementRef | null {
  for (let l = layers.length - 1; l >= 0; l--) {
    const layer = layers[l];
    for (let i = instanceCount(layer) - 1; i >= 0; i--) {
      if (containsPoint(boxOf(layer, i), u, v)) return { layer: l, instance: i };
    }
  }
  return null;
}

export function moveBox(box: ElementBox, du: number, dv: number): ElementBox {
  return { ...box, cx: box.cx + du, cy: box.cy + dv };
}

/**
 * A corner drag, with the ASPECT RATIO LOCKED: both axes scale by one factor
 * and the opposite corner stays where it is. The factor is the pointer's
 * projection onto the box's own diagonal, so a drag that wanders off the
 * diagonal still resizes smoothly instead of fighting the lock.
 */
export function resizeBox(box: ElementBox, corner: Corner, u: number, v: number): ElementBox {
  const sx = corner === "ne" || corner === "se" ? 1 : -1;
  const sy = corner === "se" || corner === "sw" ? 1 : -1;
  // Anchor (the opposite corner) to the dragged corner, in the box's own frame.
  const dx = sx * box.w;
  const dy = sy * box.h;
  const len = dx * dx + dy * dy;
  if (len === 0) return box;
  const [lx, ly] = toLocal(box, u, v);
  const factor = Math.max(MIN_FACTOR, ((lx + dx / 2) * dx + (ly + dy / 2) * dy) / len);
  const [cx, cy] = toFlag(box, (dx * (factor - 1)) / 2, (dy * (factor - 1)) / 2);
  return { ...box, cx, cy, w: box.w * factor, h: box.h * factor };
}

/** The CSS cursor for a corner handle; the diagonal pairs share one. */
export function cornerCursor(corner: Corner): string {
  return corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize";
}
