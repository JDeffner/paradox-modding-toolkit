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
 * Only the rows this document declares take part in a reorder, and the index
 * the op permutes is the SERVER'S `srcIndex`, never a rank counted here: the
 * container's source children include the `blockoverride` / `block` /
 * `template` declarations the preview has no node for, and counting the visible
 * rows is off by one per one of those (README, "The one thing a reorder index
 * cannot say yet", now said).
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
   * The widget's index among its parent body's SOURCE children, straight from
   * the server; -1 when it has none and no index can name it (a synthetic row,
   * a ghost, a named slot's contents).
   */
  source: number;
  /**
   * Rank among the rows that HAVE a source index, in listed order; -1 for the
   * others. This is the panel's own numbering ("3 of 7"), never an op index.
   */
  rank: number;
}

/**
 * The container whose children the panel lists: the selected widget's parent,
 * or null for the document's root list (which is also what an empty selection
 * shows, because the file's own top level is a container too).
 */
export function layerRows(scene: Scene, container: number | null): LayerRow[] {
  let rank = 0;
  return childIndices(scene, container).map((index) => {
    const item = scene.items[index];
    const movable = item.editable && item.line !== undefined && item.srcIndex !== undefined;
    return {
      index,
      key: item.key,
      name: item.name,
      synthetic: !(item.editable && item.line !== undefined),
      ghost: item.ghost,
      source: movable ? item.srcIndex! : -1,
      rank: movable ? rank++ : -1,
    };
  });
}

/**
 * The `to` a `reorder` op takes, from the rank a drop landed on among the
 * movable rows. The op removes the block at `from` and re-inserts it so it ENDS
 * UP at `to`, counting the container's SOURCE children — so a rank has to be
 * translated through `sources` (their source indices, ascending) and the two
 * only agree when nothing else shares the body.
 *
 * Landing at rank r means "immediately before the row that is at rank r now",
 * so any declaration sitting between the two stays on the far side of the move;
 * a drop past the last row lands right after it, not after a trailing
 * `blockoverride`.
 */
export function reorderTo(sources: readonly number[], from: number, to: number): number {
  const moved = sources[from];
  // A drop on its own rank is a no-op, and its index is the one it already has:
  // anything else would hop the block over a neighbouring declaration and
  // change the file without changing the order anyone can see.
  if (to === from) return moved;
  const others = sources.filter((_, i) => i !== from);
  if (others.length === 0) return moved;
  // Removing the moved block shifts every later source index down by one.
  const shifted = (at: number): number => (at > moved ? at - 1 : at);
  if (to >= others.length) return shifted(others[others.length - 1]) + 1;
  return shifted(others[Math.max(0, to)]);
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
