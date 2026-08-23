/**
 * Keyboard navigation over the scene: which widget Tab, Enter and Escape land
 * on. PURE (no DOM beyond the one predicate that asks whether a key belongs to
 * a text field), so every walk is a plain assertion over a scene.
 *
 * Everything here works in DRAW indices of one scene and skips what the
 * canvas itself skips (`skip`: hidden, locked, outside the focus), so a Tab
 * never selects a widget the user cannot see or click.
 */
import { childIndices, parentIndex, type Scene } from "./scene";

/** True when the key press belongs to a field the user is typing in, not to the canvas. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const node = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable === true;
}

/**
 * The next (or previous) sibling of `index` that the canvas shows, wrapping
 * around the parent's children. A lone child comes back as itself, and an
 * index with no sibling to go to stays put; null only when the scene is empty.
 */
export function siblingFrom(
  scene: Scene,
  index: number,
  direction: 1 | -1,
  skip: Uint8Array | null
): number | null {
  const siblings = childIndices(scene, parentIndex(scene, index)).filter((i) => !skip?.[i]);
  if (siblings.length === 0) return null;
  const at = siblings.indexOf(index);
  if (at < 0) return siblings[0];
  return siblings[(at + direction + siblings.length) % siblings.length];
}

/** The first shown child of `index`, or null when it has none. */
export function firstChildOf(scene: Scene, index: number, skip: Uint8Array | null): number | null {
  const children = childIndices(scene, index).filter((i) => !skip?.[i]);
  return children.length > 0 ? children[0] : null;
}

/** The first shown root widget, where Tab starts from with nothing selected. */
export function firstRoot(scene: Scene, skip: Uint8Array | null): number | null {
  const roots = childIndices(scene, null).filter((i) => !skip?.[i]);
  return roots.length > 0 ? roots[0] : null;
}
