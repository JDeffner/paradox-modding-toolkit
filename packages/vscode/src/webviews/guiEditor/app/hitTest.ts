/**
 * Hit-testing: which widget a point in WORLD coordinates lands on.
 *
 * PURE by design (no DOM, no canvas, no camera): the shell converts the pointer
 * to world coordinates through the one canvas transform and asks this module,
 * so every click case is a plain vitest assertion.
 *
 * The order is the Studio's measured one, and the tie-break is the part that
 * was learned the hard way: the SMALLEST rect wins, because a click means the
 * most specific thing under the cursor; when two rects have the same area the
 * DEEPER one wins, because an anchored box that exactly fills its parent would
 * otherwise swallow every click meant for the child that gave it that size.
 */
import type { Scene, SceneItem, SceneRect } from "./scene";

/**
 * The rect a click lands on. A widget whose content the engine could not
 * measure has a zero rect and an L11b estimate box; the box is what is drawn,
 * so it is what is clickable, or the widget would be visible and unreachable.
 */
export function hitRect(item: SceneItem): SceneRect {
  return item.ghostBox ?? item.rect;
}

/**
 * What is on screen for this widget: its hit rect cut down by every clipping
 * ancestor (the scene already intersected those into one). Ordering by the
 * VISIBLE rect is what makes a scrollarea behave: a long list clipped to a
 * small viewport is exactly as specific as the viewport it shows through, and
 * the depth tie-break then picks the content over the frame.
 */
function visibleRect(item: SceneItem): SceneRect {
  const rect = hitRect(item);
  if (!item.clip) return rect;
  const x = Math.max(rect.x, item.clip.x);
  const y = Math.max(rect.y, item.clip.y);
  return {
    x,
    y,
    w: Math.min(rect.x + rect.w, item.clip.x + item.clip.w) - x,
    h: Math.min(rect.y + rect.h, item.clip.y + item.clip.h) - y,
  };
}

/** Half-open containment: a rect owns its left/top edge, not its right/bottom. */
function contains(rect: SceneRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

/**
 * Every widget under (x, y), best candidate FIRST. A widget clipped away by an
 * ancestor is not under the cursor: it is not on screen there.
 *
 * `skip` is the layers panel's lock and eye, and the tree's subtree focus, as
 * one mask: a locked widget is still drawn and still selectable from a panel,
 * it just stops swallowing clicks meant for what is underneath it, which is the
 * blunt answer to overlapping widgets that Alt-cycling only softens.
 */
export function hitStack(scene: Scene, x: number, y: number, skip?: Uint8Array | null): number[] {
  const hits: number[] = [];
  const areas = new Map<number, number>();
  for (let i = 0; i < scene.items.length; i++) {
    if (skip?.[i]) continue;
    const rect = visibleRect(scene.items[i]);
    if (!contains(rect, x, y)) continue;
    hits.push(i);
    areas.set(i, rect.w * rect.h);
  }
  return hits.sort((a, b) => {
    if (areas.get(a) !== areas.get(b)) return areas.get(a)! - areas.get(b)!;
    const depthA = scene.items[a].depth;
    const depthB = scene.items[b].depth;
    if (depthA !== depthB) return depthB - depthA;
    // Same area, same depth: the one painted last is the one on top.
    return b - a;
  });
}

/**
 * A marquee's catch: every widget whose visible rect is ENTIRELY inside the
 * dragged rectangle. Containment rather than intersection, because a marquee
 * drawn across a window would otherwise select the window, its every ancestor
 * and everything it clips — the rule every canvas editor settled on.
 *
 * Zero-area widgets are skipped: they are inside every rectangle, and selecting
 * a widget the user cannot see is a selection they cannot explain.
 */
export function marqueeHits(scene: Scene, area: SceneRect, skip?: Uint8Array | null): number[] {
  const x1 = area.x + area.w;
  const y1 = area.y + area.h;
  const hits: number[] = [];
  for (let i = 0; i < scene.items.length; i++) {
    if (skip?.[i]) continue;
    const rect = visibleRect(scene.items[i]);
    if (rect.w <= 0 || rect.h <= 0) continue;
    if (rect.x >= area.x && rect.y >= area.y && rect.x + rect.w <= x1 && rect.y + rect.h <= y1) {
      hits.push(i);
    }
  }
  return hits;
}

/**
 * Alt+click: step to the next candidate under the cursor, wrapping. A selection
 * that is not in this stack (the click moved) starts the cycle over at the top
 * candidate, so alt-clicking somewhere new never returns nothing.
 */
export function nextInStack(stack: readonly number[], current: number | null): number | null {
  if (stack.length === 0) return null;
  const at = current === null ? -1 : stack.indexOf(current);
  return at < 0 ? stack[0] : stack[(at + 1) % stack.length];
}
