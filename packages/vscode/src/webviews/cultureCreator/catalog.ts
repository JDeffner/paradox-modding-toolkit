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
 * and a bare value names a subfolder the engine picks at random. That reading
 * is shared with the Tradition Creator (creators/traditionLayers.ts).
 *
 * No `vscode` import: this is plain Node, driven by the panel.
 */
import {
  defaultLayer,
  gameScriptFiles as scriptFiles,
  layerPaths,
  readGameText as readText,
  resolveLayer,
} from "../../creators/traditionLayers";
import { innerOf, readQuoted, scanItems } from "../shared/scriptBlock";
import type { CultureCatalog, TraditionInfo } from "./messages";

/** Loc lookups are cheap but there are hundreds; asked in batches, not one file. */
const LOC_CHUNK = 100;

/** One `key = value` entry of a lookup answer; the panel's own LocLookup shape. */
type LocLookup = (key: string) => Promise<{ value?: string }[]>;

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
        const named = new Map<number, string>();
        const body = layersItem ? innerOf(layersItem.value) : null;
        for (const layer of body ? scanItems(body) : []) {
          const index = Number(layer.key);
          if (Number.isInteger(index) && dirs[index])
            named.set(index, readQuoted(layer.value) ?? layer.value);
        }
        // One slot per layer folder: a named layer resolved, a left-out one
        // the folder's stand-in for the random file the game draws there.
        const layers = dirs.map((dir, index) => {
          const value = named.get(index);
          return (value ? resolveLayer(roots, dir, value) : defaultLayer(roots, dir)) ?? "";
        });
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
