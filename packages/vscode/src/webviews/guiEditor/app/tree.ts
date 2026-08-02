/**
 * The widget tree's rows, derived from the SAME scene the canvas paints.
 *
 * Building the tree from the scene rather than from a second server request is
 * what makes selection two-way for free: a row and a drawn rect are the same
 * draw index, so a click on either selects the other with no mapping that could
 * drift. The scene is already a pre-order flatten, so a row's children are the
 * following rows with a greater depth.
 *
 * Source children come in source order (the layout keeps the order the engine
 * expanded them in: type-supplied children first, then the instance's own, each
 * group in source order). A node spliced in from a template or a type is marked
 * SYNTHETIC: it has no statement in this document, so nothing in the editor can
 * write to it.
 *
 * PURE: no DOM.
 */
import type { Scene } from "./scene";

export interface TreeRow {
  /** Draw index in the scene: the shared identity of a row and its rect. */
  index: number;
  depth: number;
  key: string;
  name?: string;
  /** Spliced in from a template or a type: no source of its own in this file. */
  synthetic: boolean;
  /** A datamodel placeholder row: no runtime data exists in a static preview. */
  ghost: boolean;
  hasChildren: boolean;
  collapsed: boolean;
}

/** The stable key a collapsed row is remembered by (paths outlive draw indices). */
export function rowKey(path: readonly number[]): string {
  return path.join(".");
}

/**
 * Visible rows, in draw order, with the subtrees of collapsed rows omitted.
 * A collapsed ancestor hides its whole subtree, however deep.
 */
export function treeRows(scene: Scene, collapsed: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  let hiddenBelow: number | null = null;
  for (let i = 0; i < scene.items.length; i++) {
    const item = scene.items[i];
    if (hiddenBelow !== null) {
      if (item.depth > hiddenBelow) continue;
      hiddenBelow = null;
    }
    const hasChildren = scene.items[i + 1]?.depth === item.depth + 1;
    const isCollapsed = hasChildren && collapsed.has(rowKey(item.path));
    rows.push({
      index: i,
      depth: item.depth,
      key: item.key,
      name: item.name,
      synthetic: !item.editable,
      ghost: item.ghost,
      hasChildren,
      collapsed: isCollapsed,
    });
    if (isCollapsed) hiddenBelow = item.depth;
  }
  return rows;
}

/** Every ancestor path of `index`, so a selection can be revealed in the tree. */
export function ancestorKeys(scene: Scene, index: number): string[] {
  const item = scene.items[index];
  if (!item) return [];
  const keys: string[] = [];
  for (let n = 1; n < item.path.length; n++) keys.push(rowKey(item.path.slice(0, n)));
  return keys;
}
