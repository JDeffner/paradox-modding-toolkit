/**
 * The three devtools that read the SCENE rather than the selection: the
 * heatmaps, the layout-change diff, and the stats line.
 *
 * PURE (no DOM, no host, no canvas). Each is one linear walk with one
 * allocation, because all three run on a scene that can hold 13,700 widgets and
 * two of them run on every layout push.
 */
import type { GuiLayoutTimings } from "@px-lsp/protocol/protocol";
import type { Scene, SceneItem } from "./scene";

// ---- heatmaps ---------------------------------------------------------------

/** Which property of the tree the tint stands for; `off` draws nothing. */
export type HeatmapMode = "off" | "depth" | "clipped" | "synthetic";

export const HEATMAP_MODES: { mode: HeatmapMode; label: string; title: string }[] = [
  { mode: "off", label: "No heatmap", title: "Draw the scene without a tint" },
  { mode: "depth", label: "Depth", title: "Tint by nesting depth: the deeper a widget, the stronger" },
  { mode: "clipped", label: "Clipped", title: "Tint the widgets a scrollarea or a scissor cuts" },
  {
    mode: "synthetic",
    label: "Synthetic",
    title: "Tint the widgets spliced in from a template or a type",
  },
];

export interface Heatmap {
  /**
   * Per draw item, 0..1 for a tinted widget and -1 for an untinted one. A
   * Float32Array rather than objects: the painter reads it per item per frame.
   */
  values: Float32Array;
  /** What the legend says, including the count, so the mode is never a mystery. */
  legend: string;
}

/**
 * One pass to collect, one to normalise. Depth is a RELATIVE scale (the
 * deepest widget in this document is the full tint) because an absolute one
 * would make every real window look the same shade of nothing: vanilla trees
 * run 10 to 15 deep and a fixed 0..20 ramp puts them all in the first third.
 */
export function buildHeatmap(scene: Scene, mode: HeatmapMode): Heatmap | null {
  if (mode === "off") return null;
  const n = scene.items.length;
  const values = new Float32Array(n);
  let marked = 0;

  if (mode === "depth") {
    let deepest = 0;
    for (let i = 0; i < n; i++) deepest = Math.max(deepest, scene.items[i].depth);
    for (let i = 0; i < n; i++) {
      values[i] = deepest === 0 ? 0 : scene.items[i].depth / deepest;
    }
    return { values, legend: `depth 0 to ${deepest}, over ${n} widgets` };
  }

  const test: (item: SceneItem) => boolean =
    mode === "clipped" ? (item) => item.clip !== undefined : (item) => !item.editable;
  for (let i = 0; i < n; i++) {
    const hit = test(scene.items[i]);
    values[i] = hit ? 1 : -1;
    if (hit) marked++;
  }
  const what =
    mode === "clipped"
      ? "under a scrollarea or a scissor"
      : "spliced in from a template or a type, with no source here";
  return { values, legend: `${marked} of ${n} widgets ${what}` };
}

// ---- the layout-change diff -------------------------------------------------

/**
 * The widget identity a diff uses, and why it is not the selection's.
 *
 * `selection.ts` needs an identity that survives an insert ABOVE the widget,
 * so it falls back to key+name among the same siblings. A diff wants the
 * opposite: a widget whose path changed IS a change worth flashing, because
 * something was inserted or removed next to it. So the key here is the
 * positional path plus the widget's key and name, and nothing is matched
 * across a path move.
 */
function identity(item: SceneItem): string {
  return `${item.path.join(".")}|${item.key}|${item.name ?? ""}`;
}

/** What a layout push changed, as draw indices in the NEW scene. */
export interface SceneDiff {
  /** Widgets whose rect moved or resized, and widgets that are new. */
  changed: number[];
  /** How many widgets the previous scene had that this one does not. */
  removed: number;
}

/** Rects are the engine's own floats; compare them exactly, never with a tolerance. */
function sameRect(a: SceneItem, b: SceneItem): boolean {
  return a.rect.x === b.rect.x && a.rect.y === b.rect.y && a.rect.w === b.rect.w && a.rect.h === b.rect.h;
}

/**
 * Which widgets a re-layout moved. One Map of the OLD scene, then one walk of
 * the new one: two linear passes and one allocation, which is what lets this
 * run on every push without being a toggle the user has to remember.
 *
 * A widget with no counterpart in the old scene counts as changed (it is new,
 * and new is exactly what a pulse should point at). A widget the new scene does
 * not have is only counted, because there is no rect left to flash.
 */
export function diffScenes(before: Scene | null, after: Scene): SceneDiff {
  if (!before || before.items.length === 0) return { changed: [], removed: 0 };
  const old = new Map<string, SceneItem>();
  for (const item of before.items) old.set(identity(item), item);
  const changed: number[] = [];
  let matched = 0;
  for (let i = 0; i < after.items.length; i++) {
    const item = after.items[i];
    const previous = old.get(identity(item));
    if (previous === undefined) {
      changed.push(i);
      continue;
    }
    matched++;
    if (!sameRect(previous, item)) changed.push(i);
  }
  return { changed, removed: before.items.length - matched };
}

/** The status-strip note for a diff, or null when the layout moved nothing. */
export function pulseNote(diff: SceneDiff): string | null {
  if (diff.changed.length === 0 && diff.removed === 0) return null;
  const gone = diff.removed > 0 ? `, ${diff.removed} gone` : "";
  return `layout: ${diff.changed.length} widget${diff.changed.length === 1 ? "" : "s"} changed${gone}`;
}

// ---- the stats line ---------------------------------------------------------

/** What one layout push cost, server side and app side. */
export interface Stats {
  timings: GuiLayoutTimings;
  /** Flattening the layout tree into the draw list. */
  sceneMs: number;
  /** The first full repaint after that scene was built. */
  paintMs: number;
  widgets: number;
}

function ms(v: number): string {
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}ms`;
}

/**
 * One monospace line, the same shape every time so the eye can read a column
 * of them: the server's stages in its own order, then the app's two. `defs` is
 * 0 on a cache hit, which is the normal case and the reason it is worth
 * showing at all: a non-zero one says the template store was rebuilt.
 */
export function statsLine(stats: Stats): string {
  const t = stats.timings;
  return [
    `parse ${ms(t.parseMs)}`,
    `defs ${ms(t.defsMs)}`,
    `layout ${ms(t.layoutMs)}`,
    `server ${ms(t.totalMs)}`,
    `scene ${ms(stats.sceneMs)}`,
    `paint ${ms(stats.paintMs)}`,
    `${stats.widgets}w`,
  ].join("  ");
}
