/**
 * Generates every brand asset from scripts/brandFace.ts:
 *
 *   packages/vscode/media/icon.png    128x128 Marketplace icon  (PX / TK)
 *   packages/vscode/media/icon.svg    vector source of the same
 *   packages/vscode/media/px-view.svg 24x24 activity bar, monochrome
 *   packages/server/media/px-lsp.svg  the standalone server's tile (PX / LSP)
 *
 * The letterforms are the FILLED display face (the original CK3T sidebar
 * glyph's ultra-bold grotesque, see brandFace.ts) — user decision 2026-08-09.
 * The stroked centerlines in brandGeometry.ts remain the source for the 16px
 * file icons only.
 *
 * Run: npx esbuild scripts/gen-brand.ts --bundle --platform=node \
 *        --outfile=dist/gen-brand.cjs && node dist/gen-brand.cjs
 * (then delete the .cjs — everything in dist/ ships.)
 */
import * as fs from "fs";
import * as path from "path";
import { encodePng } from "../packages/server/src/dds/png";
import { faceBounds, faceWord, FACE_CAP, insideEO, type FaceWord } from "./brandFace";
import { CREAM, GOLD, INK } from "./brandGeometry";

const ROOT = path.join(__dirname, "..");
const VSCODE_MEDIA = path.join(ROOT, "packages", "vscode", "media");
const SERVER_MEDIA = path.join(ROOT, "packages", "server", "media");

/** A word placed on the tile: font units y-up -> screen px via (tx, ty, s). */
interface PlacedWord {
  word: FaceWord;
  tx: number;
  ty: number; // baseline in screen px
  s: number;
}

/**
 * The two-line lockup, centred as one ink block: cap height `cap` px per line,
 * `lineGap` px between baseline-to-cap of the lines, equal padding above and
 * below BY CONSTRUCTION (asserted by the caller against real ink).
 */
function placeLockup(topText: string, botText: string, size: number, cap: number, lineGap: number) {
  const s = cap / FACE_CAP;
  const wTop = faceWord(topText);
  const wBot = faceWord(botText);
  const bTop = faceBounds(wTop.polys);
  const bBot = faceBounds(wBot.polys);
  // Ink extents in px, relative to each line's baseline (y-up -> negative up).
  const topAbove = bTop.y1 * s;
  const botBelow = -bBot.y0 * s; // round overshoot below baseline, if any
  const blockH = topAbove + lineGap + cap + botBelow;
  const inkTopY = (size - blockH) / 2;
  const tyTop = inkTopY + topAbove;
  const tyBot = tyTop + lineGap + cap;
  const center = (b: { x0: number; x1: number }) => (size - (b.x1 - b.x0) * s) / 2 - b.x0 * s;
  const top: PlacedWord = { word: wTop, tx: center(bTop), ty: tyTop, s };
  const bot: PlacedWord = { word: wBot, tx: center(bBot), ty: tyBot, s };

  // Real-ink padding assertion: a lopsided icon fails the build, it does not ship.
  const above = tyTop - bTop.y1 * s;
  const below = size - (tyBot - bBot.y0 * s);
  if (Math.abs(above - below) > 0.01) {
    throw new Error(`vertical padding uneven: ${above} above vs ${below} below`);
  }
  for (const [b, p] of [
    [bTop, top],
    [bBot, bot],
  ] as const) {
    const left = p.tx + b.x0 * p.s;
    const right = size - (p.tx + b.x1 * p.s);
    if (Math.abs(left - right) > 0.01) {
      throw new Error(`horizontal padding uneven: ${left} left vs ${right} right`);
    }
  }
  return { top, bot };
}

const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];

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

/** Word coverage of pixel (x, y), 2x2 supersampled, even-odd like the SVG. */
function wordCoverage(p: PlacedWord, x: number, y: number): number {
  let hits = 0;
  for (const oy of [0.25, 0.75]) {
    for (const ox of [0.25, 0.75]) {
      const fx = (x + ox - p.tx) / p.s;
      const fy = (p.ty - (y + oy)) / p.s;
      if (insideEO(p.word.polys, fx, fy)) hits++;
    }
  }
  return hits / 4;
}

// ---- 128x128 PNG -----------------------------------------------------------

const S = 128;
const RADIUS = 26;
const CAP_PX = 34;
const LINE_GAP = 6;
const { top, bot } = placeLockup("PX", "TK", S, CAP_PX, LINE_GAP);

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
    const cTop = wordCoverage(top, x, y);
    if (cTop > 0) blend(i, cr, cg, cb, cTop);
    const cBot = wordCoverage(bot, x, y);
    if (cBot > 0) blend(i, gr, gg, gb, cBot);
  }
}

fs.mkdirSync(VSCODE_MEDIA, { recursive: true });
fs.writeFileSync(path.join(VSCODE_MEDIA, "icon.png"), encodePng(S, S, px));

// ---- SVGs ------------------------------------------------------------------

const n = (v: number): string => Number(v.toFixed(3)).toString();

/** One placed word as a fill group: scale(s, -s) turns y-up font units into
 * screen coordinates with the baseline at ty. */
function wordSvg(p: PlacedWord, color: string): string {
  const paths = p.word.glyphs
    .map((g) => `    <path transform="translate(${n(g.dx)} 0)" d="${g.d}" />`)
    .join("\n");
  return `  <g transform="translate(${n(p.tx)} ${n(p.ty)}) scale(${p.s.toFixed(6)} -${p.s.toFixed(6)})" fill="${color}" fill-rule="evenodd">
${paths}
  </g>`;
}

function tileSvg(size: number, radius: number, topText: string, botText: string): string {
  const l = placeLockup(topText, botText, size, CAP_PX, LINE_GAP);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${INK}" />
${wordSvg(l.top, CREAM)}
${wordSvg(l.bot, GOLD)}
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
{
  const margin = 1;
  // Lay out at tile scale, then scale the whole block into the 24px box.
  const l = placeLockup("PX", "TK", S, CAP_PX, LINE_GAP);
  const bTop = faceBounds(l.top.word.polys);
  const bBot = faceBounds(l.bot.word.polys);
  const ink = {
    x0: Math.min(l.top.tx + bTop.x0 * l.top.s, l.bot.tx + bBot.x0 * l.bot.s),
    y0: l.top.ty - bTop.y1 * l.top.s,
    x1: Math.max(l.top.tx + bTop.x1 * l.top.s, l.bot.tx + bBot.x1 * l.bot.s),
    y1: l.bot.ty - bBot.y0 * l.bot.s,
  };
  const k = (V - margin * 2) / Math.max(ink.x1 - ink.x0, ink.y1 - ink.y0);
  const ox = (V - (ink.x1 - ink.x0) * k) / 2 - ink.x0 * k;
  const oy = (V - (ink.y1 - ink.y0) * k) / 2 - ink.y0 * k;
  const scaled = (p: PlacedWord): PlacedWord => ({
    word: p.word,
    tx: ox + p.tx * k,
    ty: oy + p.ty * k,
    s: p.s * k,
  });
  const viewSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${V} ${V}">
${wordSvg(scaled(l.top), "currentColor")}
${wordSvg(scaled(l.bot), "currentColor")}
</svg>
`;
  fs.writeFileSync(path.join(VSCODE_MEDIA, "px-view.svg"), viewSvg);
}

console.log(`brand assets written in the display face. cap ${CAP_PX}px per line on the ${S}px tile.`);
