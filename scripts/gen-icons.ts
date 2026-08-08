/**
 * Generates the file-type icons (6 glyphs x light/dark) into
 * packages/vscode/media/fileicons/ (see docs/file-icons.md).
 *
 * Run: npx esbuild scripts/gen-icons.ts --bundle --platform=node \
 *        --outfile=dist/gen-icons.cjs && node dist/gen-icons.cjs
 * (then delete the .cjs — everything in dist/ ships).
 *
 * Sizing rule all glyphs obey: content lives inside [1.4, 14.6] of the 16px
 * viewBox. The old puzzle piece violated it silently — its right knob's apex
 * sat at x=16.7, OUTSIDE the viewBox, so renderers clipped it flat and the
 * icon read oversized next to its neighbors.
 */
import * as fs from "fs";
import * as path from "path";
import { glyph, toPathData, WEIGHT, WIDTH, type Stroke } from "./brandGeometry";

const outDir = path.join(__dirname, "..", "packages", "vscode", "media", "fileicons");
fs.mkdirSync(outDir, { recursive: true });

/**
 * The script icon is the brand's own letterforms: "PS" (Paradox Script) from
 * brandGeometry, so the file icon and the product lockup cannot drift apart.
 * Tighter gap than the tile's 7: at 16px every scaled unit of cap counts.
 */
function psBody(color: string): string {
  const GAP16 = 5;
  const strokes: Stroke[] = [...glyph("P", 0, 0), ...glyph("S", WIDTH.P + GAP16, 0)];
  const inkW = WIDTH.P + GAP16 + WIDTH.S; // PS has no diagonal overshoot: ink = advance
  const inkH = 34; // CAP; the S's arcs are designed to the same ink height
  const scale = 13.2 / Math.max(inkW, inkH);
  const tx = (16 - inkW * scale) / 2;
  const ty = (16 - inkH * scale) / 2;
  const d = strokes.map((s) => `  <path d="${toPathData(s)}" />`).join("\n");
  return `
  <g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scale.toFixed(5)})" fill="none" stroke="${color}" stroke-width="${WEIGHT}" stroke-linecap="butt" stroke-linejoin="miter">
${d}
  </g>`;
}

interface IconDef {
  dark: string;
  light: string;
  body: (color: string) => string;
}

const icons: Record<string, IconDef> = {
  // Paradox Script: the brand letterforms
  paradox: {
    dark: "#E3B341",
    light: "#A87B0F",
    body: psBody,
  },
  // Localization: speech bubble with two text lines cut out
  "paradox-loc": {
    dark: "#3FC9B8",
    light: "#137F70",
    body: (c) => `
  <path fill="${c}" fill-rule="evenodd" d="M3.5 1.8h9a2.2 2.2 0 0 1 2.2 2.2v5.4a2.2 2.2 0 0 1-2.2 2.2H7.6l-3.1 2.9v-2.9h-1a2.2 2.2 0 0 1-2.2-2.2V4a2.2 2.2 0 0 1 2.2-2.2ZM4.6 4.9h6.8v1.5H4.6Zm0 2.8h4.6v1.5H4.6Z"/>`,
  },
  // GUI: window frame with title bar and two layout blocks
  "paradox-gui": {
    dark: "#A78BFA",
    light: "#6D4FC2",
    body: (c) => `
  <rect x="1.75" y="2.55" width="12.5" height="10.9" rx="1.6" fill="none" stroke="${c}" stroke-width="1.5"/>
  <line x1="2" y1="6" x2="14" y2="6" stroke="${c}" stroke-width="1.5"/>
  <rect fill="${c}" x="3.9" y="7.9" width="3.5" height="3.5" rx="0.6"/>
  <rect fill="${c}" x="8.6" y="7.9" width="3.5" height="3.5" rx="0.6"/>`,
  },
  // Format Docs: circled "i"
  "paradox-info": {
    dark: "#58A6FF",
    light: "#2361A8",
    body: (c) => `
  <path fill="${c}" fill-rule="evenodd" d="M8 1.4a6.6 6.6 0 1 1 0 13.2A6.6 6.6 0 0 1 8 1.4Zm0 2.4a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6ZM6.9 7.3h2.2V12H6.9Z"/>`,
  },
  // DDS Texture: picture frame with mountain and sun
  dds: {
    dark: "#DD6FA8",
    light: "#A83A78",
    body: (c) => `
  <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.6" fill="none" stroke="${c}" stroke-width="1.5"/>
  <circle fill="${c}" cx="10.4" cy="5.9" r="1.2"/>
  <path fill="${c}" d="M3.3 11.5 6.3 6.9l2.2 3.2 1.3-1.7 2.6 3.1Z"/>`,
  },
  // Mod Descriptor: jigsaw puzzle piece with top and right knobs. The same
  // shape as before, scaled and re-centred so the whole piece (knob apexes
  // included: raw extents x 2.2..16.7, y 0.8..15.3) fits the sizing rule.
  "paradox-mod": {
    dark: "#E8925A",
    light: "#BC5A18",
    body: (c) => `
  <g transform="translate(-0.316 0.916) scale(0.88)">
  <path fill="${c}" d="M2.2 4.7h3.4a2.6 2.6 0 0 1-0.5-1.5 2.4 2.4 0 0 1 4.8 0 2.6 2.6 0 0 1-0.5 1.5h3.4v3.4a2.6 2.6 0 0 1 1.5-0.5 2.4 2.4 0 0 1 0 4.8 2.6 2.6 0 0 1-1.5-0.5v3.4H2.2Z"/>
  </g>`,
  },
};

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}\n</svg>\n`;

for (const [name, def] of Object.entries(icons)) {
  fs.writeFileSync(path.join(outDir, `${name}-dark.svg`), svg(def.body(def.dark)));
  fs.writeFileSync(path.join(outDir, `${name}-light.svg`), svg(def.body(def.light)));
}
console.log("wrote", Object.keys(icons).length * 2, "files to", outDir);
