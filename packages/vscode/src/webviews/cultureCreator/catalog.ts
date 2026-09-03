/**
 * What the Culture Creator's pickers need and paradox/definitionForm cannot
 * answer: a tradition's category and its icon layers, the DLC flags a
 * `dlc_tradition` row may require, and the description line the player reads
 * for a pillar or a tradition.
 *
 * All of it is read from the game and mod folders on disk, never written here.
 * Measured in game/common/culture/traditions/00_combat_traditions.txt:
 *
 *   tradition_winter_warriors = {
 *       category = combat
 *       layers = { 0 = learning  1 = western  4 = fight.dds }
 *   }
 *
 * The layer index picks a folder out of CULTURE_TRADITION_LAYER_PATHS
 * (common/defines/00_defines.txt); a value with a file extension IS the file,
 * and a bare value names a subfolder the engine picks at random.
 *
 * No `vscode` import: this is plain Node, driven by the panel.
 */
import * as fs from "fs";
import * as path from "path";
import { innerOf, scanItems } from "../shared/scriptBlock";
import type { CultureCatalog, TraditionInfo } from "./messages";

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
/** Loc lookups are cheap but there are hundreds; asked in batches, not one file. */
const LOC_CHUNK = 100;

/** One `key = value` entry of a lookup answer; the panel's own LocLookup shape. */
type LocLookup = (key: string) => Promise<{ value?: string }[]>;

function readText(file: string): string | null {
  try {
    // The game writes its script with a BOM; stripping it keeps the first
    // definition of a file from being named "﻿tradition_x".
    return fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  } catch {
    return null;
  }
}

function scriptFiles(root: string, folder: string): string[] {
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
function layerPaths(roots: readonly string[]): string[] {
  for (let i = roots.length - 1; i >= 0; i--) {
    for (const file of scriptFiles(roots[i], "common/defines")) {
      const text = readText(file);
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
function resolveLayer(roots: readonly string[], dir: string, value: string): string | null {
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

/** The top-level `name = { … }` blocks of a script file, name and body text. */
function topLevelBlocks(text: string): { name: string; inner: string }[] {
  const out: { name: string; inner: string }[] = [];
  for (const item of scanItems(text)) {
    if (item.key === null || !item.block) continue;
    const inner = innerOf(item.value);
    if (inner !== null) out.push({ name: item.key, inner });
  }
  return out;
}

/** The scalar written for `key` inside a block body, or undefined. */
function scalarOf(items: ReturnType<typeof scanItems>, key: string): string | undefined {
  const item = items.find((i) => i.key === key && !i.block);
  return item?.value;
}

function readTraditions(roots: readonly string[], dirs: readonly string[]): Record<string, TraditionInfo> {
  const out: Record<string, TraditionInfo> = {};
  // Script databases are last-in-wins, so a later root's tradition replaces an
  // earlier one's rather than being skipped.
  for (const root of roots) {
    for (const file of scriptFiles(root, "common/culture/traditions")) {
      const text = readText(file);
      if (!text) continue;
      for (const { name, inner } of topLevelBlocks(text)) {
        const items = scanItems(inner);
        const category = scalarOf(items, "category");
        const layersItem = items.find((i) => i.key === "layers" && i.block);
        const layers: string[] = [];
        const body = layersItem ? innerOf(layersItem.value) : null;
        for (const layer of body ? scanItems(body) : []) {
          const index = Number(layer.key);
          const dir = Number.isInteger(index) ? dirs[index] : undefined;
          if (!dir) continue;
          const rel = resolveLayer(roots, dir, layer.value);
          if (rel) layers.push(rel);
        }
        out[name] = { ...(category ? { category } : {}), layers };
      }
    }
  }
  return out;
}

/**
 * The DLC flags a `dlc_tradition` row may require. The definition form cannot
 * offer them: the whole block's value set is past its sampling cap (86 distinct
 * values, cap 80), so the flags are counted off the cultures themselves.
 */
function readDlcFlags(roots: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const root of roots) {
    for (const file of scriptFiles(root, "common/culture/cultures")) {
      const text = readText(file);
      if (!text) continue;
      for (const m of text.matchAll(/requires_dlc_flag\s*=\s*([A-Za-z_][\w]*)/g)) seen.add(m[1]);
    }
  }
  return [...seen].sort();
}

/** The `<key>_desc` line for each key that has one, asked in batches. */
async function readDescs(keys: readonly string[], lookup: LocLookup): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < keys.length; i += LOC_CHUNK) {
    const batch = keys.slice(i, i + LOC_CHUNK);
    const answers = await Promise.all(batch.map((key) => lookup(`${key}_desc`).catch(() => [])));
    answers.forEach((entries, at) => {
      // Mod entries come first; the first one with text is what the player reads.
      const value = entries.find((e) => e.value !== undefined && e.value !== "")?.value;
      if (value !== undefined) out[batch[at]] = value;
    });
  }
  return out;
}

/**
 * Everything the pickers need, read once per panel. `roots` is the load order,
 * game first; `describe` are the pillar and tradition keys whose description
 * line the form shows.
 */
export async function buildCatalog(
  roots: readonly string[],
  describe: readonly string[],
  lookup: LocLookup
): Promise<CultureCatalog> {
  const dirs = layerPaths(roots);
  return {
    traditions: readTraditions(roots, dirs),
    descs: await readDescs(describe, lookup),
    dlcFlags: readDlcFlags(roots),
  };
}
