/**
 * The layer folders a culture tradition's picture is composed from, and what
 * each of them holds.
 *
 * `common/culture/traditions/_traditions.info`: "Layers match the
 * CULTURE_TRADITION_LAYER_PATHS define. Index starts from 0", and a layer value
 * is either a file (`4 = fight.dds`) or a subfolder the engine picks a random
 * file out of (`0 = martial`). The folder list is read from the roots' own
 * `common/defines`, so a game patch or a mod that changes it changes what the
 * creators offer without a release.
 *
 * Lifted out of cultureCreator/catalog.ts when the Tradition Creator needed the
 * same reading; the two small folder readers it needs come with it, because the
 * culture catalog reads the same folders. No `vscode` import: plain Node.
 */
import * as fs from "fs";
import * as path from "path";

/**
 * The layer folders as common/defines/00_defines.txt spells them, used when no
 * root ships a defines file the reader understands (measured 2026-09, CK3
 * 1.18: five folders, 0-background through 4-items).
 */
const FALLBACK_LAYER_PATHS = [
  "gfx/interface/icons/culture_tradition/0-background",
  "gfx/interface/icons/culture_tradition/1-pattern",
  "gfx/interface/icons/culture_tradition/2-support",
  "gfx/interface/icons/culture_tradition/3-stroke",
  "gfx/interface/icons/culture_tradition/4-items",
];

const IMAGE_RE = /\.(dds|tga|png)$/i;

/** One entry a layer folder offers: what the block writes, and its picture. */
export interface TraditionLayerChoice {
  /** What the `layers` block writes: `fight.dds`, or the folder name `martial`. */
  value: string;
  /** The game-relative file to draw for it. */
  rel: string;
  /** True when `value` names a folder the engine picks a random file out of. */
  folder: boolean;
}

/** A game script or defines file's text, BOM stripped, or null. */
export function readGameText(file: string): string | null {
  try {
    // The game writes its script with a BOM; stripping it keeps the first
    // definition of a file from being named "﻿tradition_x".
    return fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  } catch {
    return null;
  }
}

/** The `.txt` files of one root's copy of a game folder, sorted. */
export function gameScriptFiles(root: string, folder: string): string[] {
  const dir = path.join(root, ...folder.split("/"));
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".txt"))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return []; // this root has no such folder
  }
}

/** The layer folders the engine stacks, in index order. */
export function layerPaths(roots: readonly string[]): string[] {
  for (let i = roots.length - 1; i >= 0; i--) {
    for (const file of gameScriptFiles(roots[i], "common/defines")) {
      const text = readGameText(file);
      const at = text?.indexOf("CULTURE_TRADITION_LAYER_PATHS") ?? -1;
      if (!text || at < 0) continue;
      const open = text.indexOf("{", at);
      const close = text.indexOf("}", open);
      if (open < 0 || close < 0) continue;
      const paths = [...text.slice(open, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      if (paths.length > 0) return paths;
    }
  }
  return FALLBACK_LAYER_PATHS;
}

/**
 * A layer value as a game-relative file. A bare value names a folder the game
 * picks a random file from; the form takes the first entry so the picture does
 * not change every time the list repaints.
 */
export function resolveLayer(roots: readonly string[], dir: string, value: string): string | null {
  if (IMAGE_RE.test(value)) return `${dir}/${value}`;
  for (let i = roots.length - 1; i >= 0; i--) {
    const abs = path.join(roots[i], ...dir.split("/"), value);
    let files: string[];
    try {
      files = fs
        .readdirSync(abs)
        .filter((f) => IMAGE_RE.test(f))
        .sort();
    } catch {
      continue;
    }
    if (files.length > 0) return `${dir}/${value}/${files[0]}`;
  }
  return null;
}

/**
 * Everything one layer folder offers, across the load order: its picture files
 * and its subfolders, deduplicated by the value the block would write. A
 * subfolder is offered as itself, not as its files, because that is what the
 * game reads as "any of these" (`_traditions.info`: "By leaving out the index,
 * it'll use a random icon from the folder").
 */
export function layerChoices(roots: readonly string[], dir: string): TraditionLayerChoice[] {
  const byValue = new Map<string, TraditionLayerChoice>();
  for (const root of roots) {
    const abs = path.join(root, ...dir.split("/"));
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue; // this root has no such folder
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const value = entry.name;
      if (entry.isDirectory()) {
        const rel = resolveLayer(roots, dir, value);
        if (rel) byValue.set(value, { value, rel, folder: true });
      } else if (IMAGE_RE.test(value)) {
        byValue.set(value, { value, rel: `${dir}/${value}`, folder: false });
      }
    }
  }
  // Folders first: they are the sets the game randomizes over, and a modder
  // picking a background wants "martial", not one of its three files.
  return [...byValue.values()].sort(
    (a, b) => Number(b.folder) - Number(a.folder) || a.value.localeCompare(b.value)
  );
}
