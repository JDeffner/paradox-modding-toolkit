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
import { parentIndex, type Scene } from "./scene";

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
/**
 * Shift+click: add the widget to the selection, or take it back out. The LAST
 * entry is the primary, the one the inspector reads and a wrap is anchored on,
 * so a re-click on a member that is not the primary promotes it rather than
 * removing it: clicking a widget always ends with it being the one the panels
 * are talking about, and a second click on THAT one clears it.
 */
export function toggleSelected(current: readonly number[], index: number): number[] {
  const at = current.indexOf(index);
  if (at < 0) return [...current, index];
  if (at === current.length - 1) return current.slice(0, -1);
  return [...current.slice(0, at), ...current.slice(at + 1), index];
}

/**
 * The members with no selected ancestor, in the order they were given. A
 * widget inside another selected widget is DROPPED, because both readings of
 * keeping it are wrong: a move would shift it once with its parent and once on
 * its own, and a delete of its parent already takes it. Dropping is also what
 * the writer does with an overlapping structural batch (`dropNested`).
 */
export function outermost(scene: Scene, indices: readonly number[]): number[] {
  const set = new Set(indices);
  return indices.filter((index) => {
    for (let p = parentIndex(scene, index); p !== null; p = parentIndex(scene, p)) {
      if (set.has(p)) return false;
    }
    return true;
  });
}

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
