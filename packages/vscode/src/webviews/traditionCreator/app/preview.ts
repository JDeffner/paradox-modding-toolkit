/**
 * The tradition as the GAME shows it: the tile of the Add Tradition view, and
 * the tooltip a player reads on it.
 *
 * `window_add_tradition.gui`'s `widget_tradition_item` is the tile: the layered
 * picture at 220x120, the tradition's name centred under it, then its cost.
 * `cooltip.gui`'s `culture_tradition_tooltip` is the tooltip, whose body is
 * CULTURE_TRADITION_GENERAL_TOOLTIP - the effect description first, then the
 * description - which is why the modifier lines sit above the desc here.
 * `window_add_tradition.gui` groups the tiles under the category's own word
 * (`tradition_group_<category>` in the game's loc), which the header shows.
 *
 * Nothing about a game is decided in this file: the words and colors of every
 * modifier line come from `paradox/modifierFormats` (modifierLines.ts), the
 * name and description from the mod's own loc fields, the picture from the
 * layers the host resolved. Browser code; the only DOM it makes is its own.
 */
import type { ModifierFormat } from "@px-lsp/protocol/protocol";
import { modifierLine, renderModifierLine } from "../../shared/modifierLines";
import { traditionIcon, type TraditionLayerImage } from "../../shared/traditionIcon";

/** One `name = value` the tooltip prints as a modifier line. */
export interface PreviewModifier {
  name: string;
  value: number | string;
}

/**
 * One modifier block. A tradition has several (`_cultural_traits.info`
 * documents one per thing they apply to: characters, provinces, counties), and
 * the game prints each group on its own, so the preview names the block its
 * rows come from rather than running them together.
 */
export interface PreviewModifierBlock {
  /** The block's key (`character_modifier`), which is the caption. */
  key: string;
  rows: PreviewModifier[];
}

export interface PreviewInput {
  /** The definition key, shown in place of the picture when there is none. */
  key: string;
  /** The loc value, or "" while the modder has not written one. */
  name: string;
  desc: string;
  /** The category's own word, when the loc index resolved its group key. */
  category: string;
  layers: TraditionLayerImage[];
  blocks: PreviewModifierBlock[];
  /** `cost = { prestige = 300 }` as "prestige 300" rows. */
  cost: { currency: string; value: string }[];
  /** The parameters the tradition switches on, as the player reads them. */
  parameters: string[];
}

export interface PreviewDeps {
  /** The game's print rules, or undefined until the host has answered. */
  formats: Record<string, ModifierFormat> | undefined;
  /** A texture path -> a URL the webview may load (the host's decoded PNG). */
  imageUrl: (texture: string) => string | null;
}

function el(tag: string, cls = "", text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Loc text without the game's markup: `#N ... #!` color codes drop to their
 * text, `[battle|E]` game-concept links to the concept's word. The preview has
 * no tooltip engine, so this is what a player would read.
 */
export function plainLoc(text: string): string {
  return text
    .replace(/#[A-Za-z_]+\s+/g, "")
    .replace(/#!/g, "")
    .replace(/\[([A-Za-z_]+)\|E\]/g, (_, concept: string) =>
      concept
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    );
}

/** The loc key the game reads a category's own word under. Measured in
 *  game/localization/english: `tradition_group_combat:0 "Warfare"`. */
export function categoryLocKey(category: string): string {
  return `tradition_group_${category}`;
}

/**
 * The loc key the tooltip reads a parameter's own sentence under. Measured in
 * game/localization/english: 513 of the 515 parameters the game's own
 * traditions set have a `culture_parameter_<name>` key
 * (`culture_parameter_cheaper_book_inspiration`), and ck3-tiger reports a
 * parameter without one as a missing localization.
 */
export function parameterLocKey(name: string): string {
  return `culture_parameter_${name}`;
}

function picture(input: PreviewInput, deps: PreviewDeps): HTMLElement {
  const box = el("div", "tile-icon");
  if (input.layers.length > 0) {
    box.append(traditionIcon(input.layers, null, deps.imageUrl));
  } else {
    // Nothing picked yet, or no game folder to read the layers from: an empty
    // tile, the way the game shows a picture it cannot load.
    const empty = el("div", "noicon");
    empty.title = input.key ? `${input.key} has no layers picked yet` : "No picture";
    box.append(empty);
  }
  return box;
}

/** The tile and its tooltip, as one element the caller drops into its panel. */
export function renderTraditionTip(input: PreviewInput, deps: PreviewDeps): HTMLElement {
  const tip = el("div", "px-game-tip");

  if (input.category) tip.append(el("div", "tip-group", input.category));

  const tile = el("div", "tile");
  tile.append(picture(input, deps), el("div", "px-game-tip-title", input.name || "(no name yet)"));
  if (input.cost.length > 0) {
    const cost = el("div", "tile-cost");
    for (const row of input.cost) {
      cost.append(el("span", "", `${row.value} ${row.currency}`));
    }
    tile.append(cost);
  }
  tip.append(tile);

  for (const block of input.blocks) {
    if (block.rows.length === 0) continue;
    tip.append(el("div", "tip-note px-mono", block.key));
    const box = el("div", "tip-mods");
    for (const mod of block.rows) {
      box.append(
        renderModifierLine(modifierLine(mod.name, mod.value, deps.formats?.[mod.name]), deps.imageUrl)
      );
    }
    tip.append(box);
  }

  if (input.desc) tip.append(el("div", "px-game-tip-body", plainLoc(input.desc)));

  if (input.parameters.length > 0) {
    const box = el("div", "tip-params");
    for (const name of input.parameters) box.append(el("span", "", plainLoc(name)));
    tip.append(box);
  }
  return tip;
}
