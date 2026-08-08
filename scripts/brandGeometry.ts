/**
 * The PX brand lockup, defined once as geometry so the SVG and the PNG cannot
 * drift apart. Every glyph is a stroked centreline (segments plus, for the P
 * bowl, one semicircular arc), which stays crisp at 24 px and rasterizes with
 * a plain distance test — no font dependency, no tracing.
 *
 * Layout rule: the two text lines are ONE optical block, centred in the tile,
 * so the padding above "PX" equals the padding below the second line exactly.
 */

export interface Seg {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
/**
 * A circular arc swept from `a0` to `a1` (radians, y-down, so a positive sweep
 * is clockwise on screen). Signed sweep is what distinguishes the two bowls of
 * an S, so it must be kept rather than normalized.
 */
export interface Arc {
  kind: "arc";
  cx: number;
  cy: number;
  r: number;
  a0: number;
  a1: number;
}
export type Stroke = Seg | Arc;

const line = (x1: number, y1: number, x2: number, y2: number): Seg => ({ kind: "line", x1, y1, x2, y2 });

/** Cap height, stroke weight and advance widths of the four glyphs we need. */
export const CAP = 34;
export const WEIGHT = 8;
const HALF = WEIGHT / 2;

// Extended face: 28-unit caps (was 24) so the lockup fills more of the tile.
export const WIDTH: Record<string, number> = { P: 28, X: 28, T: 28, K: 28, L: 25, S: 21 };

const D = Math.PI / 180;
const arc = (cx: number, cy: number, r: number, a0: number, a1: number): Arc => ({
  kind: "arc",
  cx,
  cy,
  r,
  a0: a0 * D,
  a1: a1 * D,
});

/** Centrelines of one glyph, with its top-left at (x, y). */
export function glyph(ch: string, x: number, y: number): Stroke[] {
  const b = y + CAP; // baseline
  switch (ch) {
    case "P":
      // Stem, then a bowl: two horizontals joined by a semicircle bulging right.
      // Outer edge lands at x+28 = x + WIDTH.P exactly (16 + r8 + HALF).
      return [
        line(x + HALF, y, x + HALF, b),
        line(x + HALF, y + HALF, x + 16, y + HALF),
        arc(x + 16, y + 12, 8, -90, 90),
        line(x + HALF, y + 20, x + 16, y + 20),
      ];
    case "X":
      // Overshoot: the band clip cuts these flat at cap height and baseline,
      // the way a real face terminates a diagonal. Cutting perpendicular
      // (the natural butt cap) makes X and K sit lower than P and T.
      return [line(x + 2, y - 5, x + 26, b + 5), line(x + 26, y - 5, x + 2, b + 5)];
    case "T":
      return [line(x, y + HALF, x + 28, y + HALF), line(x + 14, y, x + 14, b)];
    case "K":
      // Both diagonals meet ON the stem centreline so the butt caps are buried
      // inside the stem and the junction reads as one clean vertex.
      return [
        line(x + HALF, y, x + HALF, b),
        line(x + 27, y - 3, x + HALF, y + 17),
        line(x + HALF, y + 17, x + 27, b + 3),
      ];
    case "L":
      // Stem runs to the baseline, not to the bar's centreline, or the
      // bottom-left corner is left unfilled.
      return [line(x + HALF, y, x + HALF, b), line(x + HALF, b - HALF, x + 25, b - HALF)];
    case "S":
      // Two bowls sweeping in OPPOSITE directions: the upper one counter-
      // clockwise from upper-right over the top, the lower one clockwise from
      // there down and round to lower-left. The circles are TANGENT at
      // (x+10.5, y+17), and both arcs terminate exactly there, so the spine
      // joins smoothly instead of crossing. r=6.5 makes the ink height 4r+
      // WEIGHT = 34, matching the other caps.
      return [arc(x + 10.5, y + 10.5, 6.5, -20, -270), arc(x + 10.5, y + 23.5, 6.5, -90, 160)];
    default:
      throw new Error(`no glyph for ${ch}`);
  }
}

/** Advance width of a word, including the inter-letter gap. */
export const GAP = 7;
export function wordWidth(word: string): number {
  return [...word].reduce((w, ch) => w + WIDTH[ch], 0) + GAP * (word.length - 1);
}

/** Strokes for a word whose left edge is `x` and cap-top is `y`. */
export function word(text: string, x: number, y: number): Stroke[] {
  const out: Stroke[] = [];
  let cx = x;
  for (const ch of text) {
    out.push(...glyph(ch, cx, y));
    cx += WIDTH[ch] + GAP;
  }
  return out;
}

/**
 * Two stacked words centred as one block in a `size` square.
 * Returns the strokes plus the padding actually used, so callers can assert it.
 */
export function lockup(
  top: string,
  bottom: string,
  size: number,
  lineGap = 6
): { top: Stroke[]; bottom: Stroke[]; topBand: Band; bottomBand: Band; padding: number } {
  // Lay the two lines out at an arbitrary origin, measure the REAL ink of the
  // block, then translate so the ink is centred both ways. Padding above the
  // first line then equals padding below the second by construction.
  let a = word(top, 0, 0);
  let b = word(bottom, 0, CAP + lineGap);
  let bandA: Band = { top: 0, bottom: CAP };
  let bandB: Band = { top: CAP + lineGap, bottom: CAP * 2 + lineGap };
  const blockTop = inkBounds(a, bandA).y0;
  const blockBot = inkBounds(b, bandB).y1;
  const dy = (size - (blockBot - blockTop)) / 2 - blockTop;

  // Each line is centred on its own ink so neither reads as indented.
  const ba = inkBounds(a, bandA);
  const bb = inkBounds(b, bandB);
  a = shift(a, (size - (ba.x1 - ba.x0)) / 2 - ba.x0, dy);
  b = shift(b, (size - (bb.x1 - bb.x0)) / 2 - bb.x0, dy);
  bandA = { top: bandA.top + dy, bottom: bandA.bottom + dy };
  bandB = { top: bandB.top + dy, bottom: bandB.bottom + dy };
  return { top: a, bottom: b, topBand: bandA, bottomBand: bandB, padding: blockTop + dy };
}

/** Distance from (px,py) to a stroke's centreline. */
/**
 * Distance to a stroke's centreline, or Infinity past its ends. Returning
 * Infinity rather than the endpoint distance is what makes the caps BUTT — the
 * earlier version measured to the endpoint, which silently produced round caps
 * in the PNG while the SVG declared `stroke-linecap="butt"`.
 */
export function distance(s: Stroke, px: number, py: number): number {
  if (s.kind === "arc") {
    const dx = px - s.cx;
    const dy = py - s.cy;
    const lo = Math.min(s.a0, s.a1);
    const hi = Math.max(s.a0, s.a1);
    // atan2 returns (-pi, pi], so fold it into [lo, lo+2pi) in one step. The
    // incremental while-loop version silently dropped points near +-pi, which
    // ate most of the S.
    const TAU = 2 * Math.PI;
    const raw = Math.atan2(dy, dx);
    const a = lo + ((((raw - lo) % TAU) + TAU) % TAU);
    if (a > hi) return Infinity;
    return Math.abs(Math.hypot(dx, dy) - s.r);
  }
  const vx = s.x2 - s.x1;
  const vy = s.y2 - s.y1;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : ((px - s.x1) * vx + (py - s.y1) * vy) / len2;
  if (t < 0 || t > 1) return Infinity;
  return Math.hypot(px - (s.x1 + t * vx), py - (s.y1 + t * vy));
}

/**
 * Exact ink bounding box of a stroked shape. Centring must use this, not the
 * nominal advance widths: a diagonal's butt cap pushes ink sideways by
 * HALF*sin(angle), so an X's real extent differs from its advance and the
 * lockup ends up visibly off-centre if you trust the table.
 */
export function inkBounds(
  strokes: Stroke[],
  band?: Band
): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const s of strokes) {
    if (s.kind === "arc") {
      // Sample the swept range; the caps are radial so the ends are covered.
      const steps = 64;
      for (let i = 0; i <= steps; i++) {
        const a = s.a0 + ((s.a1 - s.a0) * i) / steps;
        const cx = s.cx + s.r * Math.cos(a);
        const cy = s.cy + s.r * Math.sin(a);
        add(cx + HALF * Math.cos(a), cy + HALF * Math.sin(a));
        add(cx - HALF * Math.cos(a), cy - HALF * Math.sin(a));
      }
      continue;
    }
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1;
    // Unit normal: the butt cap extends the ink perpendicular to the run.
    const nx = (-(s.y2 - s.y1) / len) * HALF;
    const ny = ((s.x2 - s.x1) / len) * HALF;
    for (const [px2, py2] of [
      [s.x1, s.y1],
      [s.x2, s.y2],
    ] as Array<[number, number]>) {
      add(px2 + nx, py2 + ny);
      add(px2 - nx, py2 - ny);
    }
  }
  if (band) {
    y0 = Math.max(y0, band.top);
    y1 = Math.min(y1, band.bottom);
  }
  return { x0, y0, x1, y1 };
}

/** The cap-height/baseline band a word is clipped to. */
export interface Band {
  top: number;
  bottom: number;
}

/** Translate every stroke by (dx, dy). */
export function shift(strokes: Stroke[], dx: number, dy: number): Stroke[] {
  return strokes.map((s) =>
    s.kind === "arc"
      ? { ...s, cx: s.cx + dx, cy: s.cy + dy }
      : { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }
  );
}

/** Coverage of pixel (px,py) by `strokes`, antialiased by 2x2 supersampling. */
export function coverage(strokes: Stroke[], px: number, py: number, band?: Band): number {
  let hits = 0;
  for (const oy of [0.25, 0.75]) {
    for (const ox of [0.25, 0.75]) {
      const x = px + ox;
      const y = py + oy;
      if (band && (y < band.top || y > band.bottom)) continue;
      if (strokes.some((s) => distance(s, x, y) <= HALF)) hits++;
    }
  }
  return hits / 4;
}

/** SVG path data for a stroke (paired with stroke-width=WEIGHT, fill=none). */
const n = (v: number): string => Number(v.toFixed(3)).toString();

export function toPathData(s: Stroke): string {
  if (s.kind === "arc") {
    const x1 = s.cx + s.r * Math.cos(s.a0);
    const y1 = s.cy + s.r * Math.sin(s.a0);
    const x2 = s.cx + s.r * Math.cos(s.a1);
    const y2 = s.cy + s.r * Math.sin(s.a1);
    const sweep = s.a1 - s.a0;
    const large = Math.abs(sweep) > Math.PI ? 1 : 0;
    const dir = sweep > 0 ? 1 : 0; // SVG sweep-flag: 1 = increasing angle
    return `M${n(x1)} ${n(y1)}A${n(s.r)} ${n(s.r)} 0 ${large} ${dir} ${n(x2)} ${n(y2)}`;
  }
  return `M${n(s.x1)} ${n(s.y1)}L${n(s.x2)} ${n(s.y2)}`;
}

/** Brand palette, sampled from the reference lockup. */
export const INK = "#17161A";
export const CREAM = "#F2EDE3";
export const GOLD = "#C8952F";
