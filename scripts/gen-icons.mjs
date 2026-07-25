// Generates the 10 file-type icons (5 glyphs x light/dark) into media/fileicons/
// Run: node scripts/gen-icons.mjs   (see docs/file-icons.md)
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "media", "fileicons");
mkdirSync(outDir, { recursive: true });

const icons = {
  // CK3 Script: three-point crown with base band
  paradox: {
    dark: "#E3B341",
    light: "#A87B0F",
    body: (c) => `
  <path fill="${c}" d="M2 3.9 5 6.9 8 2.6l3 4.3 3-3v6.5H2Z"/>
  <rect fill="${c}" x="2" y="11.6" width="12" height="1.8" rx="0.6"/>`,
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
  // Mod Descriptor: jigsaw puzzle piece with top and right knobs
  "paradox-mod": {
    dark: "#E8925A",
    light: "#BC5A18",
    body: (c) => `
  <path fill="${c}" d="M2.2 4.7h3.4a2.6 2.6 0 0 1-0.5-1.5 2.4 2.4 0 0 1 4.8 0 2.6 2.6 0 0 1-0.5 1.5h3.4v3.4a2.6 2.6 0 0 1 1.5-0.5 2.4 2.4 0 0 1 0 4.8 2.6 2.6 0 0 1-1.5-0.5v3.4H2.2Z"/>`,
  },
};

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}\n</svg>\n`;

for (const [name, def] of Object.entries(icons)) {
  writeFileSync(join(outDir, `${name}-dark.svg`), svg(def.body(def.dark)));
  writeFileSync(join(outDir, `${name}-light.svg`), svg(def.body(def.light)));
}
console.log("wrote", Object.keys(icons).length * 2, "files to", outDir);
