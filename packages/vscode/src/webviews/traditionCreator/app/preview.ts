/**
 * The tradition as the GAME shows it: the tile of the Add Tradition view, and
 * the tooltip a player reads on it.
 *
 * `window_add_tradition.gui`'s `widget_tradition_item` is the tile (measured):
 * `widget_tradition_icon` at `size = { 220 120 }`, the name centred under it
 * (`text_label_center`, Font_Size_Medium), then a row with the cost
 * (`[AddTraditionWindow.GetTraditionCost]`, Font_Size_Small). The cost prints
 * the way the game's own `<CURRENCY>_COST` loc lines do, `"[prestige_i]
 * $VALUE|0$"`: the currency's texticon, then the number with no decimals.
 * `cooltip.gui`'s `culture_tradition_tooltip` is the tooltip, whose body is
 * CULTURE_TRADITION_GENERAL_TOOLTIP: the effect description first (the
 * modifier lines and the parameter sentences), then the description, which is
 * why the modifiers and parameters sit above the desc here.
 * `window_add_tradition.gui` groups the tiles under the category's own word
 * (`tradition_group_<category>` in the game's loc), which the header shows.
 *
 * Nothing about a game is decided in this file: the words and colors of every
 * modifier line come from `paradox/modifierFormats` (modifierLines.ts), the
 * cost line's parts from the same answer, the name and description from the
 * mod's own loc fields, the picture from the layers the host resolved. Browser
 * code; the only DOM it makes is its own.
 */
import type { FormatPart, ModifierFormat } from "@px-lsp/protocol/protocol";
import { modifierLine, renderModifierLine, renderParts } from "../../shared/modifierLines";
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

/** `prestige = 300` in a cost block, with the game's line for the currency. */
export interface PreviewCost {
  currency: string;
  /** The script text: a number, or a script value's name. */
  value: string;
  /** The game's `<CURRENCY>_COST` loc value as parts, when the host resolved it. */
  line?: FormatPart[];
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
  cost: PreviewCost[];
  /** The parameters the tradition switches on, as the player reads them (game markup kept). */
  parameters: string[];
}

export interface PreviewDeps {
  /** The game's print rules, or undefined until the host has answered. */
  formats: Record<string, ModifierFormat> | undefined;
  /** A texture path -> a URL the webview may load (the host's decoded PNG). */
  imageUrl: (texture: string) => string | null;
  /** The same for a picture drawn at full size: the tile's layers. */
  fullImageUrl?: (texture: string) => string | null;
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

/**
 * The color codes the game's parameter sentences use, as the preview's tones.
 * Measured in game/gui/preload/textformatting.gui: `P` = positive_value =
 * color_green, `N` = negative_value = color_red, `V` = value = color_white (a
 * plain highlighted value). Any other code is dropped to its text.
 */
const TONE_OF: Record<string, string> = { P: "good", N: "bad", V: "value" };

/**
 * Loc text with its `#P … #!` spans kept as coloured runs, everything else as
 * `plainLoc` reads it. Codes do not nest in the game's own parameter sentences
 * (612 measured), so one open span at a time is enough.
 */
export function richLoc(text: string): DocumentFragment {
  const out = document.createDocumentFragment();
  let open: HTMLElement | null = null;
  const re = /#([A-Za-z_]+)\s+|#!/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = plainLoc(text.slice(at, m.index));
    (open ?? out).append(before);
    at = m.index + m[0].length;
    if (m[0] === "#!") {
      open = null;
      continue;
    }
    const tone = TONE_OF[m[1]];
    if (!tone) continue;
    open = el("span", `tip-${tone}`);
    out.append(open);
  }
  (open ?? out).append(plainLoc(text.slice(at)));
  return out;
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

/** `$VALUE|0$`: the slot the game's cost lines leave for the number, decimals after the bar. */
const VALUE_SLOT = /\$VALUE(?:\|(\d))?\$/;

/**
 * One currency of the cost, the game's way: its `<CURRENCY>_COST` parts with
 * the number in the slot. A value that is not a number (a script value's name)
 * is printed as written, since the game resolves it at runtime. Without the
 * game's line (no texticon file, an older server) the number and the
 * currency's word stand in, never an invented icon.
 */
export function renderCostLine(cost: PreviewCost, imageUrl: (texture: string) => string | null): HTMLElement {
  const row = el("span", "tile-cost-line");
  const numeric = Number(cost.value);
  const number = (decimals: number): string =>
    Number.isFinite(numeric) && cost.value.trim() !== "" ? numeric.toFixed(decimals) : cost.value;
  if (!cost.line) {
    row.append(el("span", "tile-cost-value", number(0)), el("span", "tile-cost-word", cost.currency));
    return row;
  }
  renderParts(cost.line, row, imageUrl, (text) => {
    const slot = VALUE_SLOT.exec(text);
    if (!slot) return document.createTextNode(text);
    const box = document.createDocumentFragment();
    box.append(text.slice(0, slot.index));
    box.append(el("span", "tile-cost-value", number(Number(slot[1] ?? 0))));
    box.append(text.slice(slot.index + slot[0].length));
    return box;
  });
  return row;
}

function picture(input: PreviewInput, deps: PreviewDeps): HTMLElement {
  const box = el("div", "tile-icon");
  if (input.layers.length > 0) {
    box.append(traditionIcon(input.layers, null, deps.fullImageUrl ?? deps.imageUrl));
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
    for (const row of input.cost) cost.append(renderCostLine(row, deps.imageUrl));
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

  if (input.parameters.length > 0) {
    const box = el("div", "tip-params");
    for (const name of input.parameters) {
      const line = el("div", "tip-param");
      line.append(richLoc(name));
      box.append(line);
    }
    tip.append(box);
  }

  if (input.desc) tip.append(el("div", "px-game-tip-body", plainLoc(input.desc)));
  return tip;
}
