/**
 * Selection identity across a re-parse.
 *
 * A draw index means nothing once the document changed and the server sent a
 * fresh layout, so the selection is stored as a POSITIONAL PATH (child indices
 * from the root) plus the widget's key and name. Those three together survive
 * the edits an editor actually makes:
 *
 * - a property write or a drag commit: the path still points at the same
 *   widget, key and name unchanged;
 * - an insert or delete ABOVE the selection: the path now points at a sibling,
 *   and key+name find the widget again among its siblings;
 * - the selected widget deleted: nothing matches, and the selection clears.
 *
 * The name is REQUIRED, which costs a renamed widget its selection, and that is
 * the deliberate half of the trade. Deleting a widget leaves its next sibling
 * at the very same path with the very same key, so a match on path+key alone
 * cannot tell a rename from a delete; it would silently move the selection to a
 * DIFFERENT widget, and the next drag would move the wrong one. Clearing is the
 * answer that cannot be wrong. (An inspector rename knows what it wrote and can
 * re-point its own selection; the reader cannot guess.)
 *
 * PURE: no DOM, no host.
 */
import type { Scene } from "./scene";

export interface Selection {
  path: number[];
  key: string;
  name?: string;
}

export function selectionAt(scene: Scene, index: number): Selection | null {
  const item = scene.items[index];
  if (!item) return null;
  return { path: item.path, key: item.key, name: item.name };
}

function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The draw index of `selection` in `scene`, or null when it is gone: the same
 * path holding the same widget, else the same widget among the same siblings
 * (an insert or a delete above it shifted every index).
 */
export function indexOfSelection(scene: Scene, selection: Selection): number | null {
  const parent = selection.path.slice(0, -1);
  let sibling: number | null = null;
  for (let i = 0; i < scene.items.length; i++) {
    const item = scene.items[i];
    if (item.key !== selection.key || item.name !== selection.name) continue;
    if (samePath(item.path, selection.path)) return i;
    if (
      sibling === null &&
      item.path.length === selection.path.length &&
      samePath(item.path.slice(0, -1), parent)
    ) {
      sibling = i;
    }
  }
  return sibling;
}
