/**
 * The brand's DISPLAY FACE: filled letterforms in the ultra-bold grotesque of
 * the original CK3T sidebar glyph (user decision 2026-08-09: that face IS the
 * brand). K and T are the original outlines verbatim (from the pre-rebrand
 * media/ck3-view.svg, x-normalized); P, X and L are drawn to the same metrics
 * — 453-unit stems, 330-340-unit round strokes, flat terminals, diagonals cut
 * flat at cap height and baseline; S is the stroked brand S's two tangent
 * circles rendered at this face's round weight.
 *
 * Font units, y-UP, flat cap at 1466 (round overshoot reaches 1491). This
 * module carries the logo lockups. The 16px FILE icons keep the stroked
 * centerlines of brandGeometry.ts: at a 6px cap a filled ultra-bold glyph's
 * counters close up, a stroked one stays crisp.
 */

export const FACE_CAP = 1466;
export const FACE_GAP = 200;

export interface FaceGlyph {
  /** SVG path data (M/L/H/V/Q/Z, even-odd), y-up in font units. */
  d: string;
  /** Advance width (ink width; side bearings are the layout's business). */
  width: number;
}

/** The S: the stroked brand S's two tangent bowls, drawn as filled ring
 * segments at the face's round weight. The bowls are ELLIPSES (wider than
 * tall): the vertical extent is pinned by cap height and overshoot, and a
 * circular bowl at this weight reads as a dollar-sign spine, not an S. */
function sGlyph(): FaceGlyph {
  const RX = 390; // centreline radii
  const RY = 294;
  const HALF = 175; // half of the round-stroke weight (350)
  const CX = RX + HALF;
  const TOP_CY = 1491 - RY - HALF; // round overshoot to 1491, like C and 3
  const BOT_CY = TOP_CY - 2 * RY; // tangent at the spine
  const D = Math.PI / 180;
  const seg = (cy: number, a0: number, a1: number): string => {
    const steps = 48;
    const pt = (g: number, a: number) =>
      `${(CX + (RX + g) * Math.cos(a)).toFixed(1)} ${(cy + (RY + g) * Math.sin(a)).toFixed(1)}`;
    const outer: string[] = [];
    const inner: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      outer.push(pt(HALF, a));
      inner.push(pt(-HALF, a));
    }
    inner.reverse();
    return `M${outer[0]}L${outer.slice(1).join("L")}L${inner.join("L")}Z`;
  };
  // brandGeometry angles are y-down; y-up negates them. Slightly shorter
  // sweeps than the stroked S keep the apertures open at this weight.
  // The spine ends stay at exactly 270/90 so the two ring cross-sections
  // coincide and the join is seamless; only the aperture ends are trimmed.
  const d = seg(TOP_CY, 25 * D, 270 * D) + seg(BOT_CY, 90 * D, -155 * D);
  return { d, width: CX + RX + HALF };
}

export const FACE: Record<string, FaceGlyph> = {
  // Original outline, x-normalized by -1745.
  K: {
    d: "M0 1466H453V912L928 1466H1530L996 913L1554 0H996L687 603L453 358V0H0Z",
    width: 1554,
  },
  // Original outline, x-normalized by -1413.
  T: {
    d: "M0 1466H1377V1104H915V0H462V1104H0Z",
    width: 1377,
  },
  // Stem 453; bowl to 58% of cap with 330-unit strokes, flat against the cap
  // like the face's other flat-topped forms.
  P: {
    d:
      "M0 0L0 1466L700 1466Q1010 1466 1140 1362Q1270 1258 1270 1040Q1270 822 1140 719Q1010 616 700 616L453 616L453 0Z" +
      "M453 946L690 946Q900 946 900 1040Q900 1136 690 1136L453 1136Z",
    width: 1270,
  },
  // Two crossing diagonals, 560-unit horizontal cuts at cap and baseline —
  // the perpendicular weight lands on the stem weight, like K's leg.
  X: {
    d: "M0 1466L560 1466L750 1169.7L940 1466L1500 1466L1030 733L1500 0L940 0L750 296.3L560 0L0 0L470 733Z",
    width: 1500,
  },
  L: {
    d: "M0 0L0 1466L453 1466L453 362L1080 362L1080 0Z",
    width: 1080,
  },
  S: sGlyph(),
};

export type Pt = [number, number];

/** Flattens M/L/H/V/Q/Z path data into polygons (quadratics sampled). */
export function flatten(d: string): Pt[][] {
  const polys: Pt[][] = [];
  let poly: Pt[] = [];
  let x = 0;
  let y = 0;
  const re = /([MLHVQZ])([^MLHVQZ]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    const cmd = m[1].toUpperCase();
    const nums = (m[2].match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (cmd === "M") {
      if (poly.length) polys.push(poly);
      poly = [];
      x = nums[0];
      y = nums[1];
      poly.push([x, y]);
      for (let i = 2; i + 1 < nums.length; i += 2) {
        x = nums[i];
        y = nums[i + 1];
        poly.push([x, y]);
      }
    } else if (cmd === "L") {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        x = nums[i];
        y = nums[i + 1];
        poly.push([x, y]);
      }
    } else if (cmd === "H") {
      for (const nx of nums) {
        x = nx;
        poly.push([x, y]);
      }
    } else if (cmd === "V") {
      for (const ny of nums) {
        y = ny;
        poly.push([x, y]);
      }
    } else if (cmd === "Q") {
      for (let i = 0; i + 3 < nums.length; i += 4) {
        const cx = nums[i];
        const cy = nums[i + 1];
        const ex = nums[i + 2];
        const ey = nums[i + 3];
        for (let t = 1; t <= 16; t++) {
          const u = t / 16;
          poly.push([
            (1 - u) * (1 - u) * x + 2 * (1 - u) * u * cx + u * u * ex,
            (1 - u) * (1 - u) * y + 2 * (1 - u) * u * cy + u * u * ey,
          ]);
        }
        x = ex;
        y = ey;
      }
    } else if (cmd === "Z") {
      if (poly.length) {
        polys.push(poly);
        poly = [];
      }
    }
  }
  if (poly.length) polys.push(poly);
  return polys;
}

/** Even-odd point-in-polygons test — the same rule the SVG paths declare. */
export function insideEO(polys: Pt[][], px: number, py: number): boolean {
  let odd = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) odd = !odd;
    }
  }
  return odd;
}

export interface FaceWord {
  /** Per-glyph: path data and its x offset, for SVG emission. */
  glyphs: { d: string; dx: number }[];
  /** Flattened polygons of the whole word, x-offsets applied. */
  polys: Pt[][];
  width: number;
}

/** A word laid out left to right in font units, y-up, baseline at 0. */
export function faceWord(text: string): FaceWord {
  const glyphs: { d: string; dx: number }[] = [];
  const polys: Pt[][] = [];
  let cx = 0;
  for (const ch of text) {
    const g = FACE[ch];
    if (!g) throw new Error(`no face glyph for ${ch}`);
    glyphs.push({ d: g.d, dx: cx });
    for (const poly of flatten(g.d)) polys.push(poly.map(([x, y]): Pt => [x + cx, y]));
    cx += g.width + FACE_GAP;
  }
  return { glyphs, polys, width: cx - FACE_GAP };
}

/** Exact ink bounds of flattened polygons. */
export function faceBounds(polys: Pt[][]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return { x0, y0, x1, y1 };
}
