/**
 * The layers panel's rows, and the index arithmetic a reorder needs.
 *
 * PURE: no DOM.
 *
 * A container's children are listed in PAINT ORDER, which is source order,
 * which is the order the file has them in. That single order is why the panel
 * can be read three ways at once and never lie about any of them: for an
 * overlay parent the last row is the one on top, for an hbox/vbox/flowcontainer
 * it is the last one laid out, and for the document it is the last one written.
 * The panel says which of those it is rather than reversing the list for one
 * reading and misleading the other two.
 *
 * A row spliced in from a template or a type is SYNTHETIC: it has no bytes at
 * this use site, so it cannot be dragged and nothing can be dropped against it.
 * Only the rows this document declares take part in a reorder, and their rank
 * among themselves is what the `reorder` op is asked to permute.
 */
import { childIndices, type Scene } from "./scene";

export interface LayerRow {
  /** Draw index in the scene: the shared identity of a row, a tree row and a rect. */
  index: number;
  key: string;
  name?: string;
  /** Spliced in from a template or a type: no source of its own here. */
  synthetic: boolean;
  ghost: boolean;
  /**
   * Rank among the container's children THIS DOCUMENT DECLARES, which is what a
   * reorder op indexes; -1 for a synthetic row, which has no source rank.
   */
  source: number;
}

/**
 * The container whose children the panel lists: the selected widget's parent,
 * or null for the document's root list (which is also what an empty selection
 * shows, because the file's own top level is a container too).
 */
export function layerRows(scene: Scene, container: number | null): LayerRow[] {
  let source = 0;
  return childIndices(scene, container).map((index) => {
    const item = scene.items[index];
    const editable = item.editable && item.line !== undefined;
    return {
      index,
      key: item.key,
      name: item.name,
      synthetic: !editable,
      ghost: item.ghost,
      source: editable ? source++ : -1,
    };
  });
}

/**
 * Where a drop lands, as the `to` index of a `reorder` op: the op removes the
 * block at `from` and re-inserts it so it ENDS UP at `to`, so "before the row
 * currently at rank r" and "after the row currently at rank r" are both simply
 * r, whichever side of the moved row it is on. Null when the move is a no-op.
 */
export function reorderTarget(from: number, to: number): number | null {
  return from === to ? null : to;
}

/**
 * The axis a layout container arranges its children along, read off the
 * children themselves rather than the container's key: a custom type whose base
 * is a vbox reports the key it was written with, and the rects do not lie. The
 * wider spread of centres wins; a single child has no axis to read and defaults
 * to vertical, the commoner box.
 */
export function boxAxis(rects: readonly { x: number; y: number; w: number; h: number }[]): "x" | "y" {
  if (rects.length < 2) return "y";
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    minX = Math.min(minX, cx);
    maxX = Math.max(maxX, cx);
    minY = Math.min(minY, cy);
    maxY = Math.max(maxY, cy);
  }
  return maxX - minX > maxY - minY ? "x" : "y";
}

/**
 * The rank a pointer at `at` (world coordinates, along `axis`) drops into: how
 * many of the OTHER children it has already passed the centre of. That count is
 * the post-removal index, which is exactly what the op's `to` means.
 */
export function dropRank(
  rects: readonly { x: number; y: number; w: number; h: number }[],
  moving: number,
  axis: "x" | "y",
  at: number
): number {
  let rank = 0;
  for (let i = 0; i < rects.length; i++) {
    if (i === moving) continue;
    const r = rects[i];
    const centre = axis === "x" ? r.x + r.w / 2 : r.y + r.h / 2;
    if (centre < at) rank++;
  }
  return rank;
}
