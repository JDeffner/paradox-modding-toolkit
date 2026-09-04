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

/**
 * One of the game's trait-tooltip loc values with the names filled in.
 *
 * The engine resolves `[TRAIT.GetName( … )]` against the trait the tooltip is
 * for and `[TRAIT_2. … ]` against the other one; `$TRAIT$`, `$OTHER_TRAIT$`
 * and `$VALUE|=+0$` are the same three pieces written as parameters (compare
 * `TRAIT_OPINION_SAME_TRAIT` with `TRAIT_COMPATIBILITY_LIKES`). Everything
 * after that is ordinary markup, which `plainLoc` takes off.
 */
export function fillTraitLoc(
  template: string,
  parts: { trait: string; other?: string; value?: number }
): string {
  // `$VALUE|=+0$`: a whole number that always carries its sign.
  const signed = parts.value === undefined ? "" : `${parts.value >= 0 ? "+" : ""}${parts.value}`;
  const filled = template
    .replace(/\[TRAIT_2\.[^\]]*\]/g, parts.other ?? "")
    .replace(/\[TRAIT\.[^\]]*\]/g, parts.trait)
    .replace(/\$TRAIT\$/g, parts.trait)
    .replace(/\$OTHER_TRAIT\$/g, parts.other ?? "")
    .replace(/\$VALUE[^$]*\$/g, signed);
  return plainLoc(filled).replace(/\s+/g, " ").trim();
}

export interface PreviewModifier {
  name: string;
  value: number | string;
}

/** One opinion effect, already worded by the game's own loc entry for it. */
export interface PreviewOpinion {
  label: string;
  value: number;
}

/** A line the tooltip prints as prose, with one line of explanation under it. */
export interface PreviewFact {
  text: string;
  note?: string;
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
  /**
   * `same_opinion` and its neighbours, worded through the game's own
   * `TRAIT_OPINION_*` loc entries by the caller (which is the only side that
   * can resolve loc). Optional so another panel may reuse this tooltip
   * without them.
   */
  opinions?: PreviewOpinion[];
  /** `compatibility` rows, each already a whole `TRAIT_COMPATIBILITY_*` line. */
  compatibility?: PreviewFact[];
  /** `triggered_opinion` blocks: the opinion modifier, and its conditions. */
  triggered?: PreviewFact[];
  /**
   * What the trait does that the player never reads as a tooltip line: the
   * modifiers the game's format files mark `hidden`, and the rule keys that
   * only change behaviour. Each carries one line saying how the game does
   * surface it, if it does.
   */
  hidden?: PreviewFact[];
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

/**
 * The framed picture. The game draws ONE icon widget for a trait
 * (`trait_icon_texture` in gui/shared/icons.gui, `texture =
 * "[Trait.GetIcon(Character.Self)]"`; the trait tooltip this preview stands in
 * for sizes it 52x52, gui/shared/cooltip.gui `character_trait_tooltip`): the
 * frame is not a second widget, it is part of the art, and every
 * `gfx/interface/icons/traits/*.dds` shares one 120x120 canvas with the
 * `_frame_*.dds` templates (measured).
 *
 * So the frame goes UNDER the picture, at the same size. Drawn over it, it
 * hides the trait: the frames are opaque in the middle (alpha 255 at the centre
 * in 9 of the 10 templates, 0 at every corner; 37-53% of their pixels are
 * opaque, measured).
 */
function picture(input: PreviewInput): HTMLElement {
  const box = el("div", "tip-icon");
  if (input.frameUrl) {
    const frame = document.createElement("img");
    frame.className = "frame";
    frame.src = input.frameUrl;
    frame.alt = "";
    box.append(frame);
  }
  if (input.iconUrl) {
    const img = document.createElement("img");
    img.src = input.iconUrl;
    img.alt = "";
    box.append(img);
  } else {
    // No picture resolved yet (no game folder, or a name the folder has no
    // file for): an empty tile, the way the game shows a missing texture. The
    // title beside it already names the trait.
    const empty = el("div", "noicon");
    empty.title = input.key ? `No picture named ${input.key} in the icon folder` : "No picture";
    box.append(empty);
  }
  return box;
}

/**
 * How the game prints an opinion number: a whole number with a forced sign.
 * That is `$VALUE|=+0$`, the format its own loc entries use for one
 * (`TRAIT_COMPATIBILITY_LIKES`, `OPINION_MTTH` in core_l_english.yml). The
 * label is the caller's, read out of the game's `TRAIT_OPINION_*` entries.
 */
function opinionFormat(label: string): ModifierFormat {
  return { label, decimals: 0, color: "good" };
}

/** A prose line of the tooltip, with the one line of explanation under it. */
function factRow(fact: PreviewFact): HTMLElement {
  const row = el("div", "tip-fact");
  row.append(el("div", "", fact.text));
  if (fact.note) row.append(el("div", "tip-note", fact.note));
  return row;
}

/**
 * The heading the hidden group carries. It is UI copy, not a game string: the
 * game has no tooltip for "you will not see this", which is exactly why the
 * panel has to say it.
 */
const HIDDEN_TITLE = "Not shown to the player";

/** The tooltip, as one element the caller drops into its panel. */
export function renderTraitTip(input: PreviewInput, deps: PreviewDeps): HTMLElement {
  const tip = el("div", "px-game-tip");

  const head = el("div", "tip-head");
  head.append(picture(input), el("div", "px-game-tip-title", input.name || "(no name yet)"));
  tip.append(head);

  if (input.desc) tip.append(el("div", "px-game-tip-body", input.desc));

  // `hidden = yes` in the game's modifier_definition_formats means the game
  // never prints the modifier (13 blocks write it in 00_definitions.txt, the
  // whole `ai_*` family): those lines belong under the separator, not in the
  // tooltip the player reads.
  const isHidden = (mod: PreviewModifier): boolean => deps.formats?.[mod.name]?.hidden === true;
  const shownMods = input.modifiers.filter((mod) => !isHidden(mod));
  const hiddenMods = input.modifiers.filter(isHidden);
  const line = (mod: PreviewModifier): HTMLElement =>
    renderModifierLine(modifierLine(mod.name, mod.value, deps.formats?.[mod.name]), deps.imageUrl);

  if (shownMods.length > 0) {
    const box = el("div", "tip-mods");
    for (const mod of shownMods) box.append(line(mod));
    tip.append(box);
  }

  const opinions = input.opinions ?? [];
  if (opinions.length > 0) {
    const box = el("div", "tip-mods");
    for (const opinion of opinions) {
      box.append(
        renderModifierLine(
          modifierLine(opinion.label, opinion.value, opinionFormat(opinion.label)),
          deps.imageUrl
        )
      );
    }
    tip.append(box);
  }

  for (const fact of input.compatibility ?? []) tip.append(factRow(fact));
  for (const fact of input.triggered ?? []) tip.append(factRow(fact));

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

  const facts = input.hidden ?? [];
  if (hiddenMods.length > 0 || facts.length > 0) {
    const box = el("div", "tip-hidden");
    box.append(el("div", "tip-hidden-title", HIDDEN_TITLE));
    if (hiddenMods.length > 0) {
      const mods = el("div", "tip-mods");
      for (const mod of hiddenMods) mods.append(line(mod));
      box.append(mods);
    }
    for (const fact of facts) box.append(factRow(fact));
    tip.append(box);
  }
  return tip;
}
