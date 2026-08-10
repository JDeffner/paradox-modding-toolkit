/**
 * Scene building: the server's `GuiLayoutNode` tree flattened into a
 * back-to-front draw list.
 *
 * PURE by design. No DOM, no canvas, no host — so the scene-dump harness runs
 * it headless (test/guiEditorScene.test.ts) and the canvas shell stays a thin
 * painter over it.
 *
 * The renderer adds NO LAYOUT OPINIONS. Every `rect` here is the engine's rect,
 * value for value; nothing is rounded, snapped, inflated or re-derived. When a
 * widget is not visible, that is the engine's answer and the scene repeats it.
 * The only pixels this module invents are presentation affordances the engine
 * deliberately leaves to the client, and each one says so.
 */
import type { GuiLayoutFill, GuiLayoutNode, GuiLayoutText } from "@px-lsp/protocol/protocol";

export interface SceneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Placeholder rows of a datamodel list are drawn at this opacity: the engine's
 * GHOST_OPACITY, which its own comment hands to the client renderer. The
 * scene test asserts the two constants are equal.
 */
export const GHOST_OPACITY = 0.45;

/**
 * L11b, the preview half of the content-measurability guard
 * (docs/gui-designer/parity-checklist.md). A CONTENT-SIZED widget that has
 * children yet measures to nothing hit the guard: its content was not
 * statically measurable (`{ 0 0 }` children, a child of a type no file
 * defines, and their kind) and the engine refuses to invent a size, which is
 * the one thing it never does. The canvas answers that with a dashed ghost box
 * at the widget's own origin, at GHOST_OPACITY like the datamodel
 * placeholders, so the widget stays visible and selectable and is plainly
 * marked as estimated.
 *
 * Presentation only, and narrow on purpose:
 * - `rect` stays exactly the engine's, and an axis the engine DID measure is
 *   kept; only the collapsed axis takes the default.
 * - A childless collapse is MEASURED behavior, not an estimate (an empty
 *   container really is 0 in game, L25): no box.
 * - Only the content-sized keys qualify. A `widget` or `button` at 0x0 is the
 *   engine's measured answer (B4-T1), and drawing an estimate over it would be
 *   the renderer inventing pixels. The cost of that line is that an instance of
 *   a custom `type x = container` gets no box either: the wire carries the
 *   source key, not the class the engine resolved it to.
 *
 * 40 is a preview affordance with no measurement behind it: no in-game probe
 * and no vanilla instance pins a number here, which is exactly why G2 deferred
 * the row to this canvas instead of coding a guess into the engine.
 */
export const GHOST_BOX = 40;

/** The keys whose size comes from measuring their content (engine: contentSized). */
const CONTENT_SIZED = new Set(["container", "item"]);

/** One drawn widget. Ancestors come first: the list is painted in order. */
export interface SceneItem {
  key: string;
  name?: string;
  /** The engine's rect, exactly. */
  rect: SceneRect;
  /** Depth in the layout tree (0 = top level). */
  depth: number;
  /**
   * Child indices from the root list down to this widget: the selection's
   * identity across a re-parse. The draw index is only valid inside ONE scene;
   * the path names the same widget in the next one (selection.ts).
   */
  path: number[];
  /** Intersected rect of every clipping ancestor; absent when unclipped. */
  clip?: SceneRect;
  bg?: GuiLayoutFill;
  fill?: GuiLayoutFill;
  text?: GuiLayoutText;
  /** Positioned text lines, pre-computed from the engine's metrics. */
  textLines: SceneTextLine[];
  /** GHOST_OPACITY inside a datamodel placeholder subtree, else 1. */
  opacity: number;
  ghost: boolean;
  /** L11b: the dashed estimate box, when the content was unmeasurable. */
  ghostBox?: SceneRect;
  /** 0-based line of the widget's own statement in the edited document. */
  line?: number;
  /** True when `line` is this widget's own statement (safe to edit). */
  editable: boolean;
  /**
   * `position` / `size` as the ENGINE resolved them through the template and
   * type chain, absent when the widget declares neither anywhere. These are the
   * base an edit gesture adds its delta to (gesture.ts): the rect is where the
   * engine put the widget, the source values are what a write can change.
   */
  srcPosition?: [number, number];
  srcSize?: [number, number];
  /**
   * The widget's index among its parent body's source children, the index a
   * `reorder` / `insert` / `delete` op counts. The server sets it only where an
   * index names something (`GuiLayoutNode.srcIndex`); absent means the widget
   * has no addressable slot, and nothing here counts one up for it.
   */
  srcIndex?: number;
}

export interface SceneTextLine {
  text: string;
  /** Left edge of the line, world coordinates. */
  x: number;
  /** TOP of the glyph box, world coordinates (canvas textBaseline = "top"). */
  y: number;
  fontsize: number;
}

export interface Scene {
  items: SceneItem[];
  /** Total widgets, which is items.length: every node is drawn exactly once. */
  count: number;
}

/**
 * Line box height: 21 at fontsize 15, linear (the engine's calibrated
 * measurer, B1-G/B3-S3). Glyphs sit centred in their line box.
 */
function lineHeight(fontsize: number): number {
  return 21 * (fontsize / 15);
}

function textLinesOf(rect: SceneRect, text: GuiLayoutText | undefined): SceneTextLine[] {
  if (!text || text.lines.length === 0) return [];
  const lh = lineHeight(text.fontsize);
  return text.lines.map((line, i) => ({
    text: line,
    x: rect.x + text.offsetX,
    y: rect.y + text.offsetY + i * lh + (lh - text.fontsize) / 2,
    fontsize: text.fontsize,
  }));
}

/** Overlap of two rects; w/h come out <= 0 when they do not overlap. */
function intersect(a: SceneRect, b: SceneRect): SceneRect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    w: Math.min(a.x + a.w, b.x + b.w) - x,
    h: Math.min(a.y + a.h, b.y + b.h) - y,
  };
}

function ghostBoxOf(node: GuiLayoutNode): SceneRect | undefined {
  if (!CONTENT_SIZED.has(node.key)) return undefined;
  if (node.children.length === 0) return undefined;
  if (node.rect.w >= 1 && node.rect.h >= 1) return undefined;
  return {
    x: node.rect.x,
    y: node.rect.y,
    w: Math.max(node.rect.w, GHOST_BOX),
    h: Math.max(node.rect.h, GHOST_BOX),
  };
}

/**
 * Flatten the layout tree into the draw list, back to front: a widget is drawn
 * before its children, siblings in engine order. Clipping is resolved into a
 * per-item rect rather than a nested canvas state, which is what lets the
 * hit-test and the painter share one list.
 */
export function buildScene(nodes: GuiLayoutNode[]): Scene {
  const items: SceneItem[] = [];
  const visit = (node: GuiLayoutNode, path: number[], clip: SceneRect | undefined, ghost: boolean): void => {
    const isGhost = ghost || node.ghost === true;
    items.push({
      key: node.key,
      name: node.name,
      rect: node.rect,
      depth: path.length - 1,
      path,
      clip,
      bg: node.bg,
      fill: node.fill,
      text: node.text,
      textLines: textLinesOf(node.rect, node.text),
      opacity: isGhost ? GHOST_OPACITY : 1,
      ghost: isGhost,
      ghostBox: ghostBoxOf(node),
      line: node.line,
      editable: node.editable,
      srcPosition: node.srcPosition,
      srcSize: node.srcSize,
      srcIndex: node.srcIndex,
    });
    // A clipping widget clips its CHILDREN; its own fill is drawn against the
    // clip it inherited (the engine keeps true geometry and flags the clip,
    // parity-checklist.md L17c).
    const childClip = node.clip ? (clip ? intersect(clip, node.rect) : node.rect) : clip;
    node.children.forEach((child, i) => visit(child, [...path, i], childClip, isGhost));
  };
  nodes.forEach((node, i) => visit(node, [i], undefined, false));
  return { items, count: items.length };
}

/**
 * One past the last item of the widget's subtree. A parent is drawn immediately
 * before its descendants and every descendant is deeper, so a subtree is one
 * CONTIGUOUS slice of the draw list, which is what lets a drag preview move a
 * widget and everything inside it with a single canvas translate.
 */
export function subtreeEnd(scene: Scene, index: number): number {
  const depth = scene.items[index]?.depth;
  if (depth === undefined) return index;
  let end = index + 1;
  while (end < scene.items.length && scene.items[end].depth > depth) end++;
  return end;
}

/**
 * The widget's parent in the draw list, or null for a root widget. A parent is
 * drawn immediately before its subtree, so it is the nearest EARLIER item one
 * level shallower.
 */
export function parentIndex(scene: Scene, index: number): number | null {
  const depth = scene.items[index]?.depth;
  if (depth === undefined || depth === 0) return null;
  for (let i = index - 1; i >= 0; i--) {
    if (scene.items[i].depth === depth - 1) return i;
  }
  return null;
}

/**
 * The direct children of `parent`, in paint order, or the document's root
 * widgets when it is null. Paint order IS source order, which is why the layers
 * panel can list it and a reorder can act on it.
 */
export function childIndices(scene: Scene, parent: number | null): number[] {
  const depth = parent === null ? 0 : scene.items[parent].depth + 1;
  const start = parent === null ? 0 : parent + 1;
  const end = parent === null ? scene.items.length : subtreeEnd(scene, parent);
  const out: number[] = [];
  for (let i = start; i < end; i++) {
    if (scene.items[i].depth === depth) out.push(i);
  }
  return out;
}

function fillToken(fill: GuiLayoutFill | undefined): string | undefined {
  if (!fill) return undefined;
  if (fill.texture) {
    const mode = fill.mode ?? "stretch";
    return fill.framesize ? `${mode}:frame${fill.frame ?? 1}` : mode;
  }
  return fill.color ? "color" : "empty";
}

/**
 * How the item is painted, as one token for the dump: `<bg>+<fill>` when both
 * are present, the single one when only one is, `none` when neither.
 */
export function fillKind(item: SceneItem): string {
  const bg = fillToken(item.bg);
  const fill = fillToken(item.fill);
  if (bg && fill) return `${bg}+${fill}`;
  return bg ?? fill ?? "none";
}

/**
 * The scene-dump golden format: one indented line per drawn widget,
 * `label x y w h fillKind [flags]`. Rects are the engine's, printed at 2
 * decimals (the exact equality is asserted separately, against the engine's
 * own numbers).
 */
export function dumpScene(scene: Scene): string[] {
  const round = (v: number) => String(Math.round(v * 100) / 100);
  return scene.items.map((item) => {
    const label = item.name ? `${item.key}#${item.name}` : item.key;
    const rect = [item.rect.x, item.rect.y, item.rect.w, item.rect.h].map(round).join(" ");
    const flags = [
      item.clip ? "clipped" : "",
      item.ghost ? "ghost" : "",
      item.ghostBox ? `ghostbox ${round(item.ghostBox.w)}x${round(item.ghostBox.h)}` : "",
      item.textLines.length > 0 ? `text ${item.textLines.length}` : "",
    ].filter(Boolean);
    const suffix = flags.length > 0 ? ` [${flags.join(" ")}]` : "";
    return `${"  ".repeat(item.depth + 1)}${label} ${rect} ${fillKind(item)}${suffix}`;
  });
}
