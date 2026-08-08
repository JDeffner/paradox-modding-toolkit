/**
 * The `parentanchor` / `widgetanchor` vocabulary, and the fractions the layout
 * engine turns it into.
 *
 * A dependency-free leaf like `fillGeometry.ts`, and for the same reason: the
 * engine imports it to place widgets and the webview's anchor picker imports it
 * to OFFER anchors. One table means the picker cannot offer a word the engine
 * does not parse, which would write a value the game silently ignores.
 *
 * The engine reads a spec as `|`-separated words, in either order, and ignores
 * anything it does not know (B1-B/C). Every word here is one the engine reads.
 */

/** The horizontal words, left to right: fraction = index / 2. */
export const ANCHOR_X = ["left", "hcenter", "right"] as const;
/** The vertical words, top to bottom: fraction = index / 2. */
export const ANCHOR_Y = ["top", "vcenter", "bottom"] as const;
/** The one word that sets BOTH axes to the middle. */
export const ANCHOR_CENTER = "center";

export type AnchorX = (typeof ANCHOR_X)[number];
export type AnchorY = (typeof ANCHOR_Y)[number];

/**
 * `parentanchor`/`widgetanchor` -> fractional point (0 = left/top, 1 =
 * right/bottom). An empty or unknown spec anchors at the origin, which is the
 * engine's own default.
 */
export function anchorFractions(spec: string | undefined): [number, number] {
  let fx = 0;
  let fy = 0;
  if (!spec) return [0, 0];
  for (const raw of spec.toLowerCase().split("|")) {
    const part = raw.trim();
    if (part === ANCHOR_CENTER) {
      fx = 0.5;
      fy = 0.5;
      continue;
    }
    const x = ANCHOR_X.indexOf(part as AnchorX);
    if (x >= 0) {
      fx = x / 2;
      continue;
    }
    const y = ANCHOR_Y.indexOf(part as AnchorY);
    if (y >= 0) fy = y / 2;
  }
  return [fx, fy];
}

/**
 * The spec a 9-point picker writes for one cell. `center` for the middle,
 * because the engine has that exact word and vanilla writes it; everything else
 * is `<vertical>|<horizontal>`, the order vanilla uses (`bottom|right`), though
 * the engine reads either.
 */
export function anchorSpec(x: AnchorX, y: AnchorY): string {
  if (x === "hcenter" && y === "vcenter") return ANCHOR_CENTER;
  return `${y}|${x}`;
}

/** The cell a written spec lands on, so a picker can show what the file says. */
export function anchorCell(spec: string | undefined): { x: AnchorX; y: AnchorY } {
  const [fx, fy] = anchorFractions(spec);
  return { x: ANCHOR_X[Math.round(fx * 2)], y: ANCHOR_Y[Math.round(fy * 2)] };
}
