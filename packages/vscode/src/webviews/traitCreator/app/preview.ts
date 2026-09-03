/**
 * The trait as the GAME shows it: the tooltip a player reads when they hover
 * the trait, drawn from the same values the form holds.
 *
 * This is the answer to the only question a trait designer really has. Script
 * says `martial = 2`; the game says "+2 Martial" in green under a framed
 * picture, and a form that shows only the first is a text editor with extra
 * steps. `window_character.gui` draws the real tooltip as the framed icon, the
 * name, the description, then the trait's modifier lines, then its relations,
 * which is the order used here.
 *
 * Nothing about a game is decided in this file: the words and colors of every
 * modifier line come from `paradox/modifierFormats` (modifierLines.ts), the
 * name and description from the mod's own loc fields, and the pictures from
 * the host's decoder. Browser code; the only DOM it makes is its own.
 */
import type { ModifierFormat } from "@px-lsp/protocol/protocol";
import { modifierLine, renderModifierLine } from "../../shared/modifierLines";

/** One `name = value` the tooltip prints as a modifier line. */
/**
 * Loc text without the game's markup: `#N ... #!` color codes drop to their
 * text, `[battle|E]` game-concept links to the concept's word. The preview
 * has no tooltip engine, so this is what a player would read.
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

export interface PreviewModifier {
  name: string;
  value: number | string;
}

/** Another trait the tooltip names (an opposite), with what it looks like. */
export interface PreviewTrait {
  value: string;
  label: string;
  url: string | null;
}

export interface PreviewInput {
  /** The definition key, shown in place of the picture when there is none. */
  key: string;
  /** The loc value, or "" while the modder has not written one. */
  name: string;
  desc: string;
  iconUrl: string | null;
  frameUrl: string | null;
  modifiers: PreviewModifier[];
  opposites: PreviewTrait[];
  /** A trait flag, as the player's word for it when the loc resolved. */
  flags: string[];
}

export interface PreviewDeps {
  /** The game's print rules, or undefined until the host has answered. */
  formats: Record<string, ModifierFormat> | undefined;
  /** A texture path a texticon names -> a URL the webview may load. */
  imageUrl: (texture: string) => string | null;
}

/**
 * Which frame the game draws around a trait's picture. The engine picks it in
 * code, so this is a PREVIEW APPROXIMATION matched by file name against the
 * frames that exist in the icon folder (`_frame_education`, `_frame_commander`,
 * `_frame_fame_neutral`, `_frame_health` in
 * gfx/interface/icons/traits/): a category with no frame of its own name is
 * drawn unframed rather than with a guessed one.
 */
export function frameTexture(category: string): string | null {
  switch (category) {
    case "education":
      return "_frame_education.dds";
    case "commander":
    case "winter_commander":
      return "_frame_commander.dds";
    case "fame":
      return "_frame_fame_neutral.dds";
    case "health":
      return "_frame_health.dds";
    default:
      return null;
  }
}

function el(tag: string, cls = "", text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function picture(input: PreviewInput): HTMLElement {
  const box = el("div", "tip-icon");
  if (input.iconUrl) {
    const img = document.createElement("img");
    img.src = input.iconUrl;
    img.alt = "";
    box.append(img);
  } else {
    // No picture resolved (no game folder, or a name the folder has no file
    // for): the key itself, so the tile still says which trait this is.
    box.append(el("div", "noicon", input.key || "trait"));
  }
  if (input.frameUrl) {
    const frame = document.createElement("img");
    frame.className = "frame";
    frame.src = input.frameUrl;
    frame.alt = "";
    box.append(frame);
  }
  return box;
}

/** The tooltip, as one element the caller drops into its panel. */
export function renderTraitTip(input: PreviewInput, deps: PreviewDeps): HTMLElement {
  const tip = el("div", "px-game-tip");

  const head = el("div", "tip-head");
  head.append(picture(input), el("div", "px-game-tip-title", input.name || "(no name yet)"));
  tip.append(head);

  if (input.desc) tip.append(el("div", "px-game-tip-body", input.desc));

  if (input.modifiers.length > 0) {
    const box = el("div", "tip-mods");
    for (const mod of input.modifiers) {
      box.append(
        renderModifierLine(modifierLine(mod.name, mod.value, deps.formats?.[mod.name]), deps.imageUrl)
      );
    }
    tip.append(box);
  }

  if (input.opposites.length > 0) {
    const box = el("div", "tip-rel");
    for (const other of input.opposites) {
      const chip = el("span");
      if (other.url) {
        const img = document.createElement("img");
        img.src = other.url;
        img.alt = "";
        chip.append(img);
      }
      chip.append(el("span", "", other.label));
      box.append(chip);
    }
    const row = el("div", "tip-note", "Opposite of");
    tip.append(row, box);
  }

  for (const flag of input.flags) tip.append(el("div", "tip-note", plainLoc(flag)));
  return tip;
}
