/**
 * Generates every brand asset from scripts/brandGeometry.ts:
 *
 *   packages/vscode/media/icon.png    128x128 Marketplace icon  (PX / TK)
 *   packages/vscode/media/icon.svg    vector source of the same
 *   packages/vscode/media/px-view.svg 24x24 activity bar, monochrome
 *   packages/server/media/px-lsp.svg  the standalone server's tile (PX / LSP)
 *
 * Run: npx esbuild scripts/gen-brand.ts --bundle --platform=node \
 *        --outfile=dist/gen-brand.cjs && node dist/gen-brand.cjs
 * (then delete the .cjs — everything in dist/ ships).
 */
import * as fs from "fs";
import * as path from "path";
import { encodePng } from "../packages/server/src/dds/png";
import {
  CAP,
  CREAM,
  GOLD,
  INK,
  WEIGHT,
  coverage,
  inkBounds,
  lockup,
  toPathData,
  type Stroke,
} from "./brandGeometry";

const ROOT = path.join(__dirname, "..");
const VSCODE_MEDIA = path.join(ROOT, "packages", "vscode", "media");
const SERVER_MEDIA = path.join(ROOT, "packages", "server", "media");

/** Rounded-square coverage, antialiased the same way the glyphs are. */
function tileCoverage(x: number, y: number, size: number, r: number): number {
  let hits = 0;
  for (const oy of [0.25, 0.75]) {
    for (const ox of [0.25, 0.75]) {
      const px = x + ox;
      const py = y + oy;
      const dx = Math.max(r - px, px - (size - r), 0);
      const dy = Math.max(r - py, py - (size - r), 0);
      if (dx * dx + dy * dy <= r * r) hits++;
    }
  }
  return hits / 4;
}

const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];

// ---- 128x128 PNG -----------------------------------------------------------

const S = 128;
const RADIUS = 26;
const { top, bottom, topBand, bottomBand, padding } = lockup("PX", "TK", S);

// The whole point of regenerating these: the reference lockup had uneven
// vertical padding. Assert on the REAL ink box (butt caps on the diagonals push
// ink past the nominal cap height), and fail loudly rather than ship a
// lopsided icon.
{
  const it = inkBounds(top, topBand);
  const ib = inkBounds(bottom, bottomBand);
  const ink = { x0: Math.min(it.x0, ib.x0), y0: it.y0, x1: Math.max(it.x1, ib.x1), y1: ib.y1 };
  const above = ink.y0;
  const below = S - ink.y1;
  const left = ink.x0;
  const right = S - ink.x1;
  if (Math.abs(above - below) > 0.01) {
    throw new Error(`vertical padding uneven: ${above} above vs ${below} below`);
  }
  if (Math.abs(left - right) > 0.01) {
    throw new Error(`horizontal padding uneven: ${left} left vs ${right} right`);
  }
}

const px = new Uint8Array(S * S * 4);
const [br, bg, bb] = hex(INK);
const [cr, cg, cb] = hex(CREAM);
const [gr, gg, gb] = hex(GOLD);

function blend(i: number, r: number, g: number, b: number, a: number): void {
  const inv = 1 - a;
  px[i] = Math.round(px[i] * inv + r * a);
  px[i + 1] = Math.round(px[i + 1] * inv + g * a);
  px[i + 2] = Math.round(px[i + 2] * inv + b * a);
  px[i + 3] = Math.round(px[i + 3] * inv + 255 * a);
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    blend(i, br, bg, bb, tileCoverage(x, y, S, RADIUS));
    const cTop = coverage(top, x, y, topBand);
    if (cTop > 0) blend(i, cr, cg, cb, cTop);
    const cBot = coverage(bottom, x, y, bottomBand);
    if (cBot > 0) blend(i, gr, gg, gb, cBot);
  }
}

fs.mkdirSync(VSCODE_MEDIA, { recursive: true });
fs.writeFileSync(path.join(VSCODE_MEDIA, "icon.png"), encodePng(S, S, px));

// ---- SVGs ------------------------------------------------------------------

const paths = (strokes: Stroke[], color: string): string =>
  strokes.map((s) => `  <path d="${toPathData(s)}" stroke="${color}" />`).join("\n");

function tileSvg(size: number, radius: number, topWord: string, botWord: string): string {
  const l = lockup(topWord, botWord, size);
  // clipPaths, not just butt caps: the diagonals overshoot on purpose so they
  // terminate flat on cap height and baseline like the flat-stemmed letters.
  const band = (b: { top: number; bottom: number }) =>
    `<rect x="0" y="${b.top}" width="${size}" height="${b.bottom - b.top}" />`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <clipPath id="t">${band(l.topBand)}</clipPath>
    <clipPath id="b">${band(l.bottomBand)}</clipPath>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" fill="${INK}" />
  <g fill="none" stroke-width="${WEIGHT}" stroke-linecap="butt" stroke-linejoin="miter">
    <g clip-path="url(#t)">
${paths(l.top, CREAM)}
    </g>
    <g clip-path="url(#b)">
${paths(l.bottom, GOLD)}
    </g>
  </g>
</svg>
`;
}

fs.writeFileSync(path.join(VSCODE_MEDIA, "icon.svg"), tileSvg(S, RADIUS, "PX", "TK"));
fs.mkdirSync(SERVER_MEDIA, { recursive: true });
fs.writeFileSync(path.join(SERVER_MEDIA, "px-lsp.svg"), tileSvg(S, RADIUS, "PX", "LSP"));

// ---- 24x24 activity bar ----------------------------------------------------
// Both lines, like the tile: PX over TK (user decision 2026-08-08; the earlier
// one-line version optimized legibility, this one optimizes brand identity).
// currentColor for both lines: the activity bar is monochrome by design.

const V = 24;
const vl = lockup("PX", "TK", S);
const vit = inkBounds(vl.top, vl.topBand);
const vib = inkBounds(vl.bottom, vl.bottomBand);
const vInk = {
  x0: Math.min(vit.x0, vib.x0),
  y0: vit.y0,
  x1: Math.max(vit.x1, vib.x1),
  y1: vib.y1,
};
// 1px optical margin: at two lines in 24px every scaled pixel of cap height counts.
const margin = 1;
const scale = (V - margin * 2) / Math.max(vInk.x1 - vInk.x0, vInk.y1 - vInk.y0);
const tx = (V - (vInk.x1 - vInk.x0) * scale) / 2 - vInk.x0 * scale;
const ty = (V - (vInk.y1 - vInk.y0) * scale) / 2 - vInk.y0 * scale;
// The clip bands live in lockup coordinates: they sit INSIDE the transformed
// group, so the same rects that cut the tile's diagonals flat cut these.
const viewBand = (b: { top: number; bottom: number }, id: string) =>
  `<clipPath id="${id}"><rect x="${n2(vInk.x0 - 1)}" y="${n2(b.top)}" width="${n2(vInk.x1 - vInk.x0 + 2)}" height="${n2(b.bottom - b.top)}" /></clipPath>`;
function n2(v: number): string {
  return Number(v.toFixed(3)).toString();
}
const viewSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${V} ${V}" fill="none" stroke="currentColor">
  <defs>${viewBand(vl.topBand, "vt")}${viewBand(vl.bottomBand, "vb")}</defs>
  <g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scale.toFixed(5)})" stroke-width="${WEIGHT}">
    <g clip-path="url(#vt)">
${paths(vl.top, "currentColor")}
    </g>
    <g clip-path="url(#vb)">
${paths(vl.bottom, "currentColor")}
    </g>
  </g>
</svg>
`;
fs.writeFileSync(path.join(VSCODE_MEDIA, "px-view.svg"), viewSvg);

console.log(
  `brand assets written. lockup padding ${padding}px top and bottom, cap ${CAP}, weight ${WEIGHT}.`
);
