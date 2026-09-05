/**
 * What the Tradition Creator's form needs and paradox/definitionForm cannot
 * answer: the picture's layer folders and what they hold, the currencies a
 * `cost` block may name, the parameter names the game's own traditions set,
 * the layer picks of every existing tradition, and one real vanilla body per
 * script key.
 *
 * All of it is read off the game and mod folders at panel time, never written
 * here. Measured in game/common/culture/traditions/00_combat_traditions.txt:
 *
 *   tradition_winter_warriors = {
 *       category = combat
 *       layers = { 0 = learning  1 = western  4 = fight.dds }
 *       parameters = { winter_trait_bonuses = yes }
 *       cost = { prestige = { … } }
 *   }
 *
 * and documented in game/common/culture/_cultural_traits.info, whose `cost`
 * block names the three currencies.
 *
 * No `vscode` import: plain Node, driven by the panel.
 */
import * as path from "path";
import { gameScriptFiles, layerChoices, layerPaths, readGameText } from "../../creators/traditionLayers";
import { innerOf, readQuoted, scanItems } from "../shared/scriptBlock";
import type { TraditionCatalog, TraditionEntry, TraditionLayerFolder } from "./messages";

/** The folder the traditions themselves live in; the schema's own path. */
const TRADITIONS = "common/culture/traditions";
/** The folder holding the doc that documents them (`_cultural_traits.info`). */
const CULTURE = "common/culture";

/** The script keys a form shows an example body for. */
const SCRIPT_KEYS = ["can_pick", "can_pick_for_hybridization", "is_shown", "ai_will_do"];

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

function scalarOf(items: ReturnType<typeof scanItems>, key: string): string | undefined {
  return items.find((i) => i.key === key && !i.block)?.value;
}

function blockOf(items: ReturnType<typeof scanItems>, key: string): string | null {
  const item = items.find((i) => i.key === key && i.block);
  return item ? innerOf(item.value) : null;
}

/**
 * The layer folders, with everything each one offers. The folder list comes
 * from the roots' own defines; the entries from the folders themselves, so a
 * mod that ships its own background is offered beside the game's.
 */
function readLayers(roots: readonly string[]): TraditionLayerFolder[] {
  return layerPaths(roots).map((dir, index) => ({
    index,
    path: dir,
    label: dir.split("/").pop() ?? dir,
    choices: layerChoices(roots, dir),
  }));
}

/**
 * The body of the first `<key> = { … }` anywhere in a text, braces balanced.
 * The `.info` docs are prose with one structure block in them, so the block a
 * doc documents is nested rather than top level.
 */
function namedBlockAnywhere(text: string, key: string): string | null {
  const at = new RegExp(`(?:^|\\s)${key}\\s*=\\s*\\{`, "m").exec(text);
  if (!at) return null;
  const open = text.indexOf("{", at.index);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

/**
 * The currencies `_cultural_traits.info` documents inside its `cost` block
 * ("cost = { gold = script value, prestige = …, piety = … }"). Read rather
 * than listed: a game that adds a fourth currency adds a field.
 */
function readCostKeys(roots: readonly string[]): string[] {
  for (let i = roots.length - 1; i >= 0; i--) {
    const text = readGameText(path.join(roots[i], ...CULTURE.split("/"), "_cultural_traits.info"));
    const cost = text ? namedBlockAnywhere(text, "cost") : null;
    const keys = cost
      ? scanItems(cost)
          .filter((item) => item.key !== null && !item.block)
          .map((item) => item.key!)
      : [];
    if (keys.length > 0) return keys;
  }
  return [];
}

/**
 * Everything the traditions themselves say: their category and layer picks,
 * the parameter names they set, and one real body per script key. One pass over
 * the folder, because a second would read the same files again.
 */
function readTraditions(
  roots: readonly string[]
): Pick<TraditionCatalog, "traditions" | "parameters" | "examples"> {
  const traditions: Record<string, TraditionEntry> = {};
  const parameterCounts = new Map<string, number>();
  /** Script key -> body -> how many traditions write exactly that body. */
  const exampleCounts = new Map<string, Map<string, number>>();
  // Script databases are last-in-wins, so a later root's tradition replaces an
  // earlier one's rather than being skipped.
  for (const root of roots) {
    for (const file of gameScriptFiles(root, TRADITIONS)) {
      const text = readGameText(file);
      if (!text) continue;
      for (const { name, inner } of topLevelBlocks(text)) {
        const items = scanItems(inner);
        const category = scalarOf(items, "category");
        const layers: Record<string, string> = {};
        const body = blockOf(items, "layers");
        for (const layer of body ? scanItems(body) : []) {
          if (layer.key !== null && !layer.block) layers[layer.key] = readQuoted(layer.value) ?? layer.value;
        }
        traditions[name] = { ...(category ? { category } : {}), layers };

        const params = blockOf(items, "parameters");
        for (const param of params ? scanItems(params) : []) {
          if (param.key === null || param.block) continue;
          parameterCounts.set(param.key, (parameterCounts.get(param.key) ?? 0) + 1);
        }
        for (const key of SCRIPT_KEYS) {
          const example = blockOf(items, key);
          // The game's files are CRLF; a placeholder is shown, never written.
          const trimmed = example === null ? "" : example.replace(/\r\n/g, "\n").trim();
          if (trimmed === "") continue;
          const seen = exampleCounts.get(key) ?? new Map<string, number>();
          seen.set(trimmed, (seen.get(trimmed) ?? 0) + 1);
          exampleCounts.set(key, seen);
        }
      }
    }
  }
  const parameters = [...parameterCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
  // The body the game writes MOST OFTEN for the key, the way every other
  // example in the toolkit is chosen; a tie goes to the shorter one, so a
  // placeholder shows the shape rather than a 60-line cost breakdown.
  const examples: Record<string, string> = {};
  for (const [key, seen] of exampleCounts) {
    examples[key] = [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
  }
  return { traditions, parameters, examples };
}

/**
 * Everything the form needs, read once per panel. `roots` is the load order,
 * game first.
 */
export function buildTraditionCatalog(roots: readonly string[]): TraditionCatalog {
  return {
    layers: readLayers(roots),
    costKeys: readCostKeys(roots),
    ...readTraditions(roots),
  };
}
