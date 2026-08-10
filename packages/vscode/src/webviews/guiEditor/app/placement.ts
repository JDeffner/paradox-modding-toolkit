/**
 * "Why is it here": the server's placement trace turned into rows a person
 * reads, and the geometry the constraint overlay draws.
 *
 * PURE (no DOM, no host), so the sentences and the numbers are asserted without
 * a canvas.
 *
 * The whole value of this module is that it INVENTS NO ARITHMETIC. The engine
 * already summed the terms (`GuiPlacement.terms`, spec.md B1-B/C/D) and the sum
 * equals the rect origin by construction; everything here either restates one
 * of those numbers or subtracts two of them to find a point that is already
 * implied. Where the server did not say something, this module says nothing
 * rather than deducing it: a placement with no terms is a box slot, and the
 * honest row for that is the container's name, not a made-up anchor sum.
 */
import type {
  GuiPlacementTerm,
  GuiWidgetInfo,
  GuiWidgetOrigin,
  GuiWidgetProperty,
} from "@px-lsp/protocol/protocol";
import { originLabel } from "./inspector";
import type { SceneRect } from "./scene";

/** One line of the anchor sum: what contributed, and how much of each axis. */
export interface PlacementRow {
  label: string;
  dx: number;
  dy: number;
}

export interface PlacementReport {
  /** The terms, in engine order, plus the SUM row that closes them. */
  rows: PlacementRow[];
  /** The rect the terms explain. */
  rect: SceneRect;
  /**
   * Prose the sum cannot carry: the container that assigned the slot, the
   * position it dropped doing so, and the widget that clips the result.
   */
  notes: string[];
  /** No anchor sum to show: a layout container computed the slot instead. */
  boxPlaced: boolean;
}

/** The label a term reads as. `parentOrigin` is the parent's rect, not a property. */
function termLabel(term: GuiPlacementTerm, mirrored: boolean): string {
  switch (term.kind) {
    case "parentOrigin":
      return "the parent's content box";
    case "parentanchor":
      return `parentanchor = ${term.source ?? "top|left"}`;
    case "widgetanchor":
      // B1-B/C: an unwritten widgetanchor mirrors the parentanchor, and the
      // server reports the anchor it mirrored rather than nothing. Saying so is
      // the difference between a row that looks duplicated and one that
      // explains why the widget sits on its own corner.
      return mirrored
        ? `widgetanchor = ${term.source ?? "top|left"} (mirrors parentanchor)`
        : `widgetanchor = ${term.source ?? "top|left"}`;
    case "position":
      return `position = ${term.source ?? "{ 0 0 }"}`;
  }
}

/** Did the widget's own body (or its chain) write a `widgetanchor`? */
function wroteWidgetAnchor(info: GuiWidgetInfo): boolean {
  return info.properties.some((p) => p.key.toLowerCase() === "widgetanchor");
}

/**
 * The rows and the notes for one widget. Null when the request did not ask for
 * the trace, or when the layout never reached the widget (a declaration inside
 * a `tooltipwidget` has a source line and no rect).
 */
export function placementReport(info: GuiWidgetInfo): PlacementReport | null {
  const placement = info.placement;
  if (!placement) return null;
  const mirrored = !wroteWidgetAnchor(info);
  const rows: PlacementRow[] = placement.terms.map((term) => ({
    label: termLabel(term, mirrored),
    dx: term.dx,
    dy: term.dy,
  }));
  if (rows.length > 0) {
    // The closing row is the engine's own rect origin, not a re-addition of the
    // terms above it: printing the sum this module computed would hide exactly
    // the disagreement the row exists to rule out.
    rows.push({ label: "= where it sits", dx: placement.rect.x, dy: placement.rect.y });
  }

  const notes: string[] = [];
  const by = placement.placedBy;
  if (by) {
    const what = by.name ? `${by.key}#${by.name}` : by.key;
    const kind = by.layout === "grid" ? "grid" : by.layout === "flow" ? "flow container" : "box";
    notes.push(`${what} placed it: a ${kind} assigns its children's slots, so there is no anchor sum here.`);
    if (by.droppedPosition) {
      notes.push(
        `Its own position = { ${by.droppedPosition[0]} ${by.droppedPosition[1]} } was DROPPED. ` +
          `The engine logs "Widget cannot have a position in a layout" and lays the widget out anyway.`
      );
    }
  }
  const clip = placement.clippedBy;
  if (clip) {
    const what = clip.name ? `${clip.key}#${clip.name}` : clip.key;
    notes.push(
      `${what} clips it to ${num(clip.rect.x)}, ${num(clip.rect.y)} · ${num(clip.rect.w)} x ${num(clip.rect.h)}. ` +
        `The rect above is the true geometry; only the drawing is cut.`
    );
  }
  return { rows, rect: placement.rect, notes, boxPlaced: by !== undefined };
}

/** One overridden value, and where the value it replaced came from. */
export interface OverrideRow {
  key: string;
  /** The value that won, the one the canvas laid out with. */
  value: string;
  /** The value it directly replaced. */
  was: string;
  /** Where the replaced value came from; "this widget's own body" when local. */
  from: string;
  /** Where the winner came from, same wording. */
  now: string;
}

function whereFrom(origin: readonly GuiWidgetOrigin[]): string {
  return origin.length === 0 ? "this widget's own body" : originLabel(origin);
}

/**
 * Every property the widget assigned more than once, as "X overrides Y from Z".
 * Only the LAST shadowed value is shown per key: the chain can be three deep,
 * and the row a designer needs is the one their write actually replaced.
 */
export function overrideRows(properties: readonly GuiWidgetProperty[]): OverrideRow[] {
  const rows: OverrideRow[] = [];
  for (const property of properties) {
    const shadowed = property.overrides;
    if (!shadowed || shadowed.length === 0) continue;
    const last = shadowed[shadowed.length - 1];
    rows.push({
      key: property.key,
      value: property.value,
      was: last.value,
      from: whereFrom(last.origin),
      now: whereFrom(property.origin),
    });
  }
  return rows;
}

/** Which axes the widget's layout policy lets grow into free space. */
export interface ExpandingAxes {
  x: boolean;
  y: boolean;
  /** The policy words behind the flags, for the label. */
  labelX?: string;
  labelY?: string;
}

/** The policies that take free space from a box (layoutEngine `policy`). */
const GROWS = new Set(["expanding", "growing"]);

/**
 * Read off the widget's own effective properties, never guessed from its rect:
 * a widget that happens to fill its parent is not the same thing as one that
 * was told to. The `expand` KEY is the growing spacer (B4-T8) and expands on
 * whichever axis its box runs along, so both flags are set and the overlay
 * draws what the box actually does with it.
 */
export function expandingAxes(info: GuiWidgetInfo): ExpandingAxes {
  if (info.key.toLowerCase() === "expand") {
    return { x: true, y: true, labelX: "expand", labelY: "expand" };
  }
  const out: ExpandingAxes = { x: false, y: false };
  for (const property of info.properties) {
    const key = property.key.toLowerCase();
    const value = property.value.replace(/"/g, "").trim().toLowerCase();
    if (!GROWS.has(value)) continue;
    if (key === "layoutpolicy_horizontal") {
      out.x = true;
      out.labelX = value;
    } else if (key === "layoutpolicy_vertical") {
      out.y = true;
      out.labelY = value;
    }
  }
  return out;
}

/**
 * What the constraint overlay draws, all of it in world coordinates so the
 * painter needs no arithmetic of its own.
 *
 * The two anchor points come out of the terms rather than out of the anchor
 * words: `parentanchor.dx` IS the parent-side offset the engine used, and
 * `widgetanchor.dx` is the negated widget-side one, so the points are
 * subtractions of numbers the server already committed to. The line between
 * them is therefore exactly the `position` term, drawn.
 */
export interface ConstraintOverlay {
  parent: SceneRect;
  rect: SceneRect;
  /** The point on the parent the anchor names; absent when no anchor was written. */
  parentAnchor?: { x: number; y: number };
  /** The matching point on the widget. */
  widgetAnchor?: { x: number; y: number };
  clip?: SceneRect;
  expand: ExpandingAxes;
}

export function constraintOverlay(info: GuiWidgetInfo): ConstraintOverlay | null {
  const placement = info.placement;
  if (!placement) return null;
  const overlay: ConstraintOverlay = {
    parent: placement.parentRect,
    rect: placement.rect,
    clip: placement.clippedBy?.rect,
    expand: expandingAxes(info),
  };
  const origin = placement.terms.find((t) => t.kind === "parentOrigin");
  const parentAnchor = placement.terms.find((t) => t.kind === "parentanchor");
  const widgetAnchor = placement.terms.find((t) => t.kind === "widgetanchor");
  if (origin && parentAnchor) {
    overlay.parentAnchor = { x: origin.dx + parentAnchor.dx, y: origin.dy + parentAnchor.dy };
  }
  if (widgetAnchor) {
    // The term is -fraction * size, so the point on the widget is its origin
    // MINUS the term.
    overlay.widgetAnchor = {
      x: placement.rect.x - widgetAnchor.dx,
      y: placement.rect.y - widgetAnchor.dy,
    };
  }
  return overlay;
}

/** Two decimals at most, and no trailing zeroes: the readout style everywhere else. */
export function num(v: number): string {
  return String(Math.round(v * 100) / 100);
}
