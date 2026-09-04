/**
 * The Dynasty Legacy Creator app: design a legacy track and the perks that
 * hang off it, and hand the host the blocks to write.
 *
 * The shape of the panel is the game's own legacy window
 * (gui/window_dynasty_legacy.gui, measured): the track's picture drawn through
 * the game's frame and mask, its name and description beside it, and the perks
 * as ONE row of tiles read left to right, which is how a dynasty buys them.
 * A tile answers "what does this perk do" on hover, in the words the player
 * reads (`paradox/modifierFormats`), and opens the perk's form on click. The
 * form is a side panel rather than a card in the row, because five open forms
 * side by side is what made the first version unreadable.
 *
 * Nothing here knows a key name or a value list: which keys a legacy and a
 * perk may carry, what they mean, which traits exist and which modifiers exist
 * all arrive from `paradox/definitionForm`. What this file decides is which of
 * those keys gets a designed control and which falls through to the raw
 * fields, and every key reaches the modder either way (AD-5).
 */
import type {
  DefinitionForm,
  DefinitionFormKey,
  EventVocabularyItem,
  ModifierFormat,
} from "@px-lsp/protocol/protocol";
import { confirmDialog, menu, toast } from "../../shared/overlay";
import { helpDialog, type HelpItem, type HelpSpec } from "../../shared/help";
import { installTips } from "../../shared/tips";
import { iconEl } from "../../shared/icons";
import { sidePanel } from "../../shared/sidePanel";
import { modifierLine, renderModifierLine } from "../../shared/modifierLines";
import { saveTargetLine, shortPath } from "../../shared/saveTarget";
import { scriptSection } from "../../shared/scriptSection";
import {
  iconField,
  locField,
  scriptField,
  textField,
  titleCaseFromName,
  type Field,
  type ModifierRow,
} from "../../shared/fields";
import { chanceField, conditionField, effectField, type BlockField, type EffectField } from "./builders";
import type {
  AppToHost,
  CreatorInit,
  HostToApp,
  IconEntry,
  LoadedPerk,
  SaveDefinition,
  TargetKind,
} from "../messages";
import type { CreatorSaveTarget } from "../../shared/creatorMessages";
import { baseName } from "../../shared/scriptBlock";
import { rowsField } from "./rowsField";
import { doctrineField, type DoctrineField } from "./doctrineField";
import {
  applyRepeated,
  applyValues,
  changedProperties,
  effectLocKey,
  freePerkName,
  locKeyFor,
  modifierBlockValue,
  modifierRows,
  newDefBlock,
  parseDefBlock,
  parseModifierBlock,
  perkNameFor,
  valueOf,
  valuesOf,
  wrapBlockValue,
  writeDefBlock,
  type DefBlock,
  type FieldValue,
  type ModifierEntry,
} from "./script";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
installTips();

/** A definition key is a name the game reads; anything else is not writable. */
const NAME_RE = /^[a-z][a-z0-9_]*$/;

/**
 * The perk key that names its track. `_dynasty_perks.info`: "legacy = legacy_key
 * # What legacy does this belong to?". The panel writes it and never shows it:
 * a perk only exists inside a track.
 */
const LEGACY_KEY = "legacy";

/** The two blocks whose rows are modifiers, in the harvest's own words. */
const CHAR_MOD = "character_modifier";
const DOCTRINE_MOD = "doctrine_character_modifier";
const TRAITS_KEY = "traits";
/**
 * The line inside a doctrine modifier block that is the CONDITION and not a
 * modifier, per `_dynasty_perks.info`: `doctrine = doctrine_theocracy_lay_clergy`.
 */
const DOCTRINE_KEY = "doctrine";
/** The scalar key that hands a perk's holder one fixed trait. */
const TRAIT_KEY = "trait";
/**
 * The three perk keys with a builder of their own (app/builders.ts), and the
 * one track key. Each one still reaches the modder as script when its block is
 * more than the builder can show, and a key the harvest does not carry is not
 * drawn at all.
 */
const SHOWN_KEY = "is_shown";
const PICKED_KEY = "can_be_picked";
const EFFECT_KEY = "effect";
const CHANCE_KEY = "ai_chance";
const BUILT_KEYS = [PICKED_KEY, EFFECT_KEY, CHANCE_KEY];

/**
 * Blocks the game itself writes, shown while a field is empty. Measured in
 * game/common/dynasty_legacies/97_ep1_legacies.txt (ep1_culture_legacy_track),
 * common/dynasty_perks/05_ce1_dynasty_perks.txt (10 perks gate on that one
 * feature), 00_dynasty_perks.txt (blood_legacy_4's effect, blood_legacy_1's
 * chance).
 */
const EXAMPLE = {
  isShown: "{ has_dlc_feature = hybridize_culture }",
  canBePicked: "{ has_dlc_feature = legends_of_the_dead }",
  effect: "{ custom_description_no_bullet = { text = blood_legacy_4_effect } }",
  chance: "11",
};

/**
 * What the game draws the track picture through
 * (gui/window_dynasty_legacy.gui, measured: two `modify_texture` layers with
 * blend_mode = alphamultiply over `[DynastyLegacy.GetTrackIcon]`). Both are
 * asked of the host like any other asset, so a game whose install is not
 * configured, or whose legacy window uses other textures, simply gets the
 * plain square instead of a broken picture.
 */
const TRACK_FRAME = "gfx/interface/component_tiles/tile_frame_thin_02.dds";
const TRACK_MASK = "gfx/interface/component_masks/mask_legacy_track.dds";

/** Small enough for a picker row, big enough for a chip: the thumbnails' cap. */
const THUMB_DIM = 48;
/**
 * The strip's own decodes: the illustration and the two textures it is drawn
 * through. The illustration is 4216 x 368 (measured over the game's 21 files),
 * far the largest texture any creator loads, and the strip is a few hundred
 * pixels wide, so the decode is capped rather than paid in full.
 */
const STRIP_DIM = 1024;

let init: CreatorInit | null = null;
let trackForm: DefinitionForm | null = null;
let perkForm: DefinitionForm | null = null;
/** The track's block as the file has it, when one was loaded. */
let trackOriginal: DefBlock | null = null;
let trackSource: "mod" | "vanilla" | "parent" | null = null;
let trackFile: string | null = null;
let overrideMode = false;
let perks: Perk[] = [];
let selected: Perk | null = null;
/** The key every prefilled name was derived from, so a rename can follow it. */
let derivedFrom = "";
/** Perks the modder took off a saved track; the host names the file that keeps them. */
let dropped: { name: string; file: string }[] = [];

// --- the track's own controls ------------------------------------------------
let trackLoc: { pattern: string; field: Field<string> }[] = [];
let trackIcon: Field<string> | null = null;
let trackIllustration: Field<string> | null = null;
let trackShown: BlockField | null = null;
let trackOthers: Record<string, Field<string>> = {};

interface Perk {
  /** The tile in the row. */
  tile: HTMLElement;
  step: HTMLElement;
  face: HTMLElement;
  /** The form, built once and parked off-screen until the tile is clicked. */
  editor: HTMLElement;
  key: Field<string>;
  /** The key as it stood last, so a rename can move what was derived from it. */
  lastKey: string;
  original: DefBlock | null;
  source: "mod" | "vanilla" | "parent" | null;
  file: string | null;
  loc: { pattern: string; field: Field<string> }[];
  /** Modifier blocks keep the entries no row can hold, so they survive a save. */
  mods: Record<string, { entries: ModifierEntry[]; field: Field<ModifierRow[]> }>;
  /** `doctrine_character_modifier` as the 0..n blocks a perk really writes. */
  doctrines: DoctrineField | null;
  /** The three blocks with a builder: can_be_picked, effect, ai_chance. */
  blocks: Record<string, BlockField>;
  /** The effect builder again, for the loc and the keys only it knows. */
  effect: EffectField | null;
  others: Record<string, Field<string>>;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function el(tag: string, cls = "", text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function trackName(): string {
  return $<HTMLInputElement>("name").value.trim();
}

/**
 * A folding section with a one-line lede: the Tradition Creator's own section
 * chrome, so a modder who learned one creator has learned this one. The head
 * is what names a key here, which is why the controls inside are drawn `bare`.
 */
interface Fold {
  el: HTMLElement;
  body: HTMLElement;
  title: HTMLElement;
  open(next: boolean): void;
}

function fold(
  title: string,
  lede: string | undefined,
  isOpen: boolean,
  /**
   * What the ? in the head says. A function, not a spec: the sentences name
   * the track and the perk the section is filling in right now, and both move
   * while the form is open.
   */
  help?: () => HelpSpec
): Fold {
  const box = el("section", "fold");
  if (isOpen) box.dataset.open = "";
  const row = el("div", "fold-head-row");
  const head = document.createElement("button");
  head.className = "fold-head";
  head.type = "button";
  const caption = el("span", "fold-title", title);
  head.append(iconEl("chevronRight"), caption);
  head.onclick = () => {
    if (box.hasAttribute("data-open")) box.removeAttribute("data-open");
    else box.dataset.open = "";
  };
  row.append(head);
  if (help) {
    // Beside the head and not inside it: a button in a button is not markup a
    // browser keeps, and the ? must not fold the section it explains.
    const ask = document.createElement("button");
    ask.className = "px-btn";
    ask.type = "button";
    ask.dataset.variant = "ghost";
    ask.dataset.size = "icon-xs";
    ask.dataset.tip = `What ${title} writes, and what it takes`;
    ask.setAttribute("aria-label", `About ${title}`);
    ask.append(iconEl("circleHelp"));
    ask.onclick = () => helpDialog(help());
    row.append(ask);
  }
  const body = el("div", "fold-body");
  if (lede) body.append(el("div", "lede", lede));
  box.append(row, body);
  return {
    el: box,
    body,
    title: caption,
    open: (next) => {
      if (next) box.dataset.open = "";
      else box.removeAttribute("data-open");
    },
  };
}

function perkName(perk: Perk): string {
  return perk.key.get().trim();
}

// ---------------------------------------------------------------------------
// Pictures and loc the host resolves for us
// ---------------------------------------------------------------------------

/** Game asset path -> the URL the host decoded, or null when nothing has it. */
const images = new Map<string, string | null>();
const imagesAsked = new Set<string>();
/** Loc key -> the value the workspace has. A key with none stays absent. */
const locValues = new Map<string, string>();
const locAsked = new Set<string>();

function askImages(keys: readonly string[], maxDim = THUMB_DIM): void {
  const wanted = keys.filter((key) => key !== "" && !imagesAsked.has(key));
  if (wanted.length === 0) return;
  for (const key of wanted) imagesAsked.add(key);
  send({ type: "images", keys: wanted, maxDim });
}

function askLoc(keys: readonly string[]): void {
  const wanted = keys.filter((key) => key !== "" && !locAsked.has(key));
  if (wanted.length === 0) return;
  for (const key of wanted) locAsked.add(key);
  send({ type: "loc", keys: wanted });
}

const imageUrl = (key: string): string | null => images.get(key) ?? null;

/** `<the trait folder>/<key>.dds`, or "" when that kind ships no icon folder. */
function refImage(kind: string, value: string): string {
  const folder = init?.refIconFolders[kind];
  return folder && value !== "" ? `${folder}/${value}.dds` : "";
}

/** Keys of a form that no designed control owns, plus any the block itself has. */
function otherKeys(
  form: DefinitionForm,
  owned: readonly string[],
  block: DefBlock | null
): DefinitionFormKey[] {
  const seen = new Set(owned);
  const out: DefinitionFormKey[] = [];
  for (const key of form.keys) {
    if (seen.has(key.key)) continue;
    seen.add(key.key);
    out.push(key);
  }
  for (const st of block?.statements ?? []) {
    if (seen.has(st.key)) continue;
    seen.add(st.key);
    out.push({ key: st.key });
  }
  return out;
}

/**
 * A raw control for a key with no designed widget: a block gets a text area,
 * and every text area offers the file, because a webview has no completion,
 * no hover and no highlighting and the editor has all three.
 */
function rawField(spec: DefinitionFormKey, value: string, onOpenFile: () => void): Field<string> {
  const options = {
    label: spec.key,
    ...(spec.doc ? { doc: spec.doc } : {}),
    ...(spec.example ? { placeholder: spec.example } : {}),
    value,
  };
  return spec.values === "block" || value.startsWith("{")
    ? scriptField({ ...options, rows: 3, placeholder: "{ … }", onOpenFile })
    : textField(options);
}

/** What a raw control contributes: a block value keeps its braces. */
function rawValue(spec: DefinitionFormKey, field: Field<string>): string | null {
  const text = field.get();
  if (text.trim() === "") return null;
  return spec.values === "block" || text.trim().startsWith("{") ? wrapBlockValue(text) : text.trim();
}

function vocabulary(items: readonly EventVocabularyItem[]): EventVocabularyItem[] {
  return items.map((item) => ({ ...item }));
}

// ---------------------------------------------------------------------------
// The row the game draws: the icon, the words, the illustration, the perks
// ---------------------------------------------------------------------------

/**
 * The legacy window's own row, built once and moved into its section on every
 * rebuild (`window_dynasty_legacy.gui`, measured): the 80 x 80 icon beside the
 * track's name and description, and under them the illustration with the perk
 * tiles laid across it.
 *
 * The illustration is ONE picture behind the whole row, not one per perk: the
 * game's two `background` widgets fill the box the perk items define, so the
 * 4216 x 368 file is stretched over the tiles and drawn twice, each pass
 * multiplied by the frame and the mask. Two stacked layers here compose the
 * same way a second pass does in the game.
 */
function buildDrawn(): {
  el: HTMLElement;
  note: HTMLElement;
  perks: HTMLElement;
  add: HTMLElement;
} {
  const row = el("div");
  row.id = "legacyRow";

  const box = el("div");
  box.id = "trackBox";
  const art = el("div");
  art.id = "trackArt";
  art.dataset.tip = "The game builds this picture's path from the track's key.";
  art.dataset.tipWrap = "";
  art.append(iconEl("image"));
  const words = el("div");
  words.id = "trackWords";
  const rowName = el("div");
  rowName.id = "rowName";
  const rowDesc = el("div");
  rowDesc.id = "rowDesc";
  words.append(rowName, rowDesc);
  box.append(art, words);

  const stripRow = el("div");
  stripRow.id = "stripRow";
  const strip = el("div");
  strip.id = "strip";
  const stripArt = el("div");
  stripArt.id = "stripArt";
  stripArt.dataset.empty = "";
  stripArt.dataset.tip =
    "The illustration, stretched behind every perk of the track. The game builds its path from the track's key.";
  stripArt.dataset.tipWrap = "";
  const perksHost = el("div");
  perksHost.id = "perks";
  strip.append(stripArt, perksHost);

  const add = el("div", "perktile");
  add.id = "addPerk";
  add.dataset.add = "";
  add.tabIndex = 0;
  add.setAttribute("role", "button");
  add.dataset.tip = "Add a perk to the end of the track";
  add.append(iconEl("plus"), el("span", "", "Add perk"));
  stripRow.append(strip, add);

  const note = el("div", "lede");
  note.id = "perkNote";
  row.append(box, stripRow);
  return { el: row, note, perks: perksHost, add };
}

const drawn = buildDrawn();

// ---------------------------------------------------------------------------
// The track's sections
// ---------------------------------------------------------------------------

/**
 * What the game reads each picture from, and what it expects to find there.
 * Both paths are built from the track's key and neither is written into the
 * block, so a pick is a file copy and never a script line. The sizes are the
 * game's own files, measured over its 21 tracks (2026-09-04).
 */
/** What every picture field of this creator says about formats. */
const IMPORT_NOTE =
  "The file the game reads is a DDS; a PNG, JPEG, WebP, GIF, BMP, AVIF, ICO, SVG or TGA you pick is converted into one, and transparency is kept.";

const ART_NOTES = {
  icon: {
    doc: "There is no icon path to write into the block, so picking a picture here copies it into your mod under your track's key.",
    info:
      "140 x 140 px in the game's own files, drawn at 80 x 80 in the legacy window. " +
      `${IMPORT_NOTE} ` +
      "The game builds the path from the track's key, so a pick copies the picture into your mod under that key and you are asked which folder it goes to.",
  },
  illustration: {
    doc: "The window's wide picture, stretched under the whole row of perks. Picking one copies it into your mod under your track's key.",
    info:
      "4216 x 368 px in the game's own 21 files. The window draws it twice behind the perks, each pass masked to 2108 x 184, so a picture that is not that wide is stretched to it. " +
      `${IMPORT_NOTE} ` +
      "The game builds the path from the track's key, so a pick copies the picture into your mod under that key and you are asked which folder it goes to.",
  },
};

// ---------------------------------------------------------------------------
// What each section of the form writes, behind its ? button
// ---------------------------------------------------------------------------

/**
 * One section's ? dialog: what it WRITES as the intro (the key, and the
 * harvest's own sentence about it where there is one), then what it takes and
 * what the game does with it.
 *
 * Every number below is measured and its source is the comment on the parser
 * that reads the same block (app/script.ts) or the harvest the form carries
 * (`DefinitionFormKey.doc`, quoted through `spec.doc` rather than retyped).
 */
function sectionHelp(title: string, writes: string, items: HelpItem[]): HelpSpec {
  return { title, intro: writes, sections: [{ title: "What it takes", items }] };
}

/** The harvest's sentence for a key, as a clause after the key's own name. */
function writesKey(form: DefinitionForm | null, key: string, shape: string): string {
  const doc = form?.keys.find((k) => k.key === key)?.doc;
  return doc ? `${shape} The game's own note on it: "${doc}"` : shape;
}

/** The escape-hatch item every section with a script area carries. */
const SCRIPT_ITEM: HelpItem = {
  lead: "A block the rows cannot hold stays script.",
  text: "Advanced: script keeps it byte for byte and names the line the builder stopped on. There is no completion in a text area, so Edit in the file saves first and opens the block in the editor.",
};

/** The grammar both trigger builders share, in one sentence. */
const TRIGGER_ITEM: HelpItem = {
  lead: "The builder writes three shapes:",
  text: "has_dlc_feature = <feature>, OR = { has_game_rule = … } for any one of a set of rules, and <scripted trigger> = yes or no.",
};

const TRACK_HELP = {
  identity: (): HelpSpec =>
    sectionHelp(
      "Identity",
      "The key names the block the game reads (<key> = { … }); the two lines under it are its localization, <key>_name and <key>_desc.",
      [
        {
          lead: "The key",
          text: "is lowercase letters, digits and _, starting with a letter. It is the only thing you must type: the perk keys, both picture paths and every loc key follow it, and each stays editable.",
        },
        {
          lead: "Name and description are localization, not script.",
          text: "They are written to the loc file named after the track's own script file, in the language the top bar names.",
        },
        {
          lead: "All 21 of the game's tracks define both keys.",
          text: "A track with no name shows the player its raw key instead.",
        },
        {
          lead: "Changing the key later",
          text: "moves everything that still follows it and leaves anything you typed yourself alone.",
        },
      ]
    ),
  art: (): HelpSpec =>
    sectionHelp(
      "Art",
      "Nothing. Neither picture is a script key: the game builds both paths from the track's key, so a pick copies the file into your mod under that key.",
      [
        {
          lead: "The icon",
          text: "is 140 x 140 in the game's own files and drawn at 80 x 80 beside the track's name.",
        },
        {
          lead: "The illustration",
          text: "is 4216 x 368 over the game's 21 files. The window stretches it behind the whole row of perks and draws it twice, each pass masked to 2108 x 184.",
        },
        { lead: "Custom picture…", text: IMPORT_NOTE },
        {
          lead: "Where it goes is asked.",
          text: "The game's own folder by default, or any folder inside your mod. Anywhere else the game will not find it by name, so you reference it yourself.",
        },
      ]
    ),
  shown: (): HelpSpec =>
    sectionHelp(
      "Shown when",
      writesKey(trackForm, SHOWN_KEY, "is_shown = { … }, a trigger in character scope."),
      [
        TRIGGER_ITEM,
        {
          lead: "A track with no is_shown is always offered.",
          text: "The trigger decides whether the game shows the track at all, not whether its perks can be bought.",
        },
        {
          lead: "Measured over the game's 21 tracks:",
          text: "all 14 is_shown blocks open with has_dlc_feature, and 10 of them wrap the rest in OR = { has_game_rule = … }.",
        },
        SCRIPT_ITEM,
      ]
    ),
  others: (): HelpSpec =>
    sectionHelp("Other keys", "Whatever you type, straight into the track's block.", [
      {
        lead: "These are the keys the harvest reports for a dynasty legacy",
        text: "that no control above stands for, plus any key your own file already carries. Nothing is hidden from you and nothing is dropped on save.",
      },
      {
        lead: "A block value keeps your braces",
        text: "and gets ours when you leave them off, so has_trait = brave lands as a block and not as a bare line.",
      },
      SCRIPT_ITEM,
    ]),
};

const PERK_HELP = {
  identity: (): HelpSpec =>
    sectionHelp(
      "Identity",
      "The key names the perk's block, legacy = <track key> is written under it for you, and the line under the key is <perk key>_name.",
      [
        {
          lead: "A perk only exists inside a track.",
          text: "legacy = <track key> is written on every perk and never shown: it is how the game knows which track the perk hangs off.",
        },
        {
          lead: "The key is prefilled",
          text: "as the track's stem plus the first number no perk on the track uses. 18 of the game's 21 tracks name their perks that way; the other three shorten the stem, so it is a default and not a rule.",
        },
        {
          lead: "Only the name is localization.",
          text: "The game generates no description key for a perk. What a perk does is the sentences its effect prints.",
        },
      ]
    ),
  characterModifier: (): HelpSpec =>
    sectionHelp(
      "Modifiers for every dynasty member",
      writesKey(perkForm, CHAR_MOD, "character_modifier = { <modifier> = <number> … }."),
      [
        {
          lead: "One row is one modifier and one number.",
          text: "The line beside it is what the player reads, printed the way the game prints it.",
        },
        {
          lead: "Drag a number to scrub it.",
          text: "A number you do not touch keeps its own text, so 0.30 stays 0.30 rather than becoming 0.3.",
        },
        {
          lead: "A line the rows cannot hold",
          text: "(a name = <loc key> heading for the group, a comment) stays where it is in the block and is written back untouched.",
        },
        { lead: "78 of the game's 105 perks", text: "carry this block." },
      ]
    ),
  doctrines: (): HelpSpec =>
    sectionHelp(
      "Doctrine modifiers",
      writesKey(perkForm, DOCTRINE_MOD, "One doctrine_character_modifier = { … } block per doctrine."),
      [
        {
          lead: "It is a list, not one block.",
          text: "The game's own erudition legacy writes three of them, so add as many as the perk needs.",
        },
        {
          lead: "doctrine = <doctrine> is the condition, not a modifier.",
          text: "The rows apply only to a dynasty member whose faith has that doctrine.",
        },
        {
          lead: "name = <loc key> heads the group in the tooltip.",
          text: "It follows the perk's key, and the sentence you type for it is written with the rest of the localization.",
        },
        {
          lead: "A key written more than once cannot be edited line by line,",
          text: "so a perk whose doctrine list moved is written back as a whole block.",
        },
      ]
    ),
  traits: (): HelpSpec =>
    sectionHelp("Traits granted", writesKey(perkForm, TRAITS_KEY, "traits = { <trait> = <number> … }."), [
      {
        lead: "The player picks one of the listed traits",
        text: "when the perk is unlocked.",
      },
      {
        lead: "The number is the AI's chance of picking that trait,",
        text: "not a modifier. The game's own weighted traits use 100.",
      },
      {
        lead: "The choice is saved on the dynasty",
        text: "as var:<perk key>_<trait key>, which is where the rest of your script reads it back from.",
      },
      { lead: "4 of the game's 105 perks", text: "use it." },
    ]),
  canBePicked: (): HelpSpec =>
    sectionHelp(
      "Can be picked when",
      writesKey(perkForm, PICKED_KEY, "can_be_picked = { … }, a trigger in character scope."),
      [
        TRIGGER_ITEM,
        {
          lead: "A perk with no can_be_picked can always be bought",
          text: "once the perks before it on the track are.",
        },
        {
          lead: "Measured over the game's 105 perks:",
          text: "of their 54 can_be_picked blocks, 10 are a DLC feature and 44 are a scripted trigger set to yes.",
        },
        SCRIPT_ITEM,
      ]
    ),
  effect: (): HelpSpec =>
    sectionHelp(
      "On pick",
      writesKey(perkForm, EFFECT_KEY, "effect = { custom_description_no_bullet = { text = <loc key> } … }."),
      [
        {
          lead: "Each row is one tooltip line.",
          text: "The sentence you type is the localization the game prints for it.",
        },
        {
          lead: "The loc key follows the perk's key",
          text: "(<perk>_effect, then <perk>_effect_2 and so on), which is why it is shown and not typed.",
        },
        {
          lead: "Most perks do nothing here but talk.",
          text: "74 of the game's 82 effect blocks are nothing but these lines; the perk's real work happens in an on_action that reads the perk.",
        },
        {
          lead: "Start from a game perk's effect",
          text: "copies another perk's lines in under YOUR keys, so your mod does not replace the game's own sentences.",
        },
        SCRIPT_ITEM,
      ]
    ),
  chance: (): HelpSpec =>
    sectionHelp("AI weight", writesKey(perkForm, CHANCE_KEY, "ai_chance = { value = <number> }."), [
      {
        lead: "One number, weighed against the other perks the AI could buy.",
        text: "It is not a percentage. An empty field leaves the key out and the game uses its own default.",
      },
      { lead: "Drag the section's title", text: "to scrub the number." },
      {
        lead: "12 of the game's 37 ai_chance blocks are exactly this.",
        text: "The other 25 weigh the choice with if = { limit = … multiply = … } and stay script.",
      },
      SCRIPT_ITEM,
    ]),
  others: (): HelpSpec =>
    sectionHelp("Other keys", "Whatever you type, straight into the perk's block.", [
      {
        lead: "These are the keys the harvest reports for a dynasty perk",
        text: "that no section above stands for, plus any key your own file already carries.",
      },
      {
        lead: "A block value keeps your braces",
        text: "and gets ours when you leave them off.",
      },
      SCRIPT_ITEM,
    ]),
};

/** One picture picker and the path the game reads it from. */
function artRow(field: Field<string>, folder: string): HTMLElement[] {
  const line = el("div", "artnote");
  const code = document.createElement("code");
  code.textContent = `${folder}/<track key>.dds`;
  line.append(code);
  return [field.el, line];
}

function buildTrack(loc: Record<string, string>): void {
  const form = trackForm!;
  const host = $("sections");
  host.replaceChildren();
  trackLoc = [];
  trackIcon = null;
  trackIllustration = null;
  trackShown = null;
  trackOthers = {};

  const name = trackName();

  // --- Identity ------------------------------------------------------------
  const identity = fold(
    "Identity",
    "The key is the only thing you must type. The names, the perk keys and both pictures follow it.",
    true,
    TRACK_HELP.identity
  );
  for (const pattern of form.locPatterns) {
    const key = locKeyFor(pattern, name);
    const isName = pattern.endsWith("_name");
    const field = locField({
      label: isName ? "Name" : "Description",
      key,
      value: loc[key] ?? (isName ? titleCaseFromName(name) : ""),
      multiline: !isName,
      placeholder: isName ? "What the player sees" : "One line under the track's name",
    });
    trackLoc.push({ pattern, field });
    identity.body.append(field.el);
  }
  host.append(identity.el);

  // --- Art -----------------------------------------------------------------
  const art = fold(
    "Art",
    "Two pictures, both found by the track's key and neither written into the block.",
    true,
    TRACK_HELP.art
  );
  const block = el("div", "artblock");
  const pickers = el("div", "px-stack");
  if (form.iconFolder) {
    trackIcon = iconField({
      label: "Icon",
      doc: ART_NOTES.icon.doc,
      info: ART_NOTES.icon.info,
      items: init!.icons,
      value: init!.icons.some((i) => i.key === name) ? name : "",
      onCustom: () => send({ type: "customIcon", track: trackName(), which: "icon" }),
      customLabel: "Custom picture…",
    });
    trackIcon.onChange(paintArt);
    pickers.append(...artRow(trackIcon, form.iconFolder));
  }
  if (init?.illustrationFolder) {
    trackIllustration = iconField({
      label: "Illustration",
      doc: ART_NOTES.illustration.doc,
      info: ART_NOTES.illustration.info,
      items: init.illustrations,
      value: init.illustrations.some((i) => i.key === name) ? name : "",
      onCustom: () => send({ type: "customIcon", track: trackName(), which: "illustration" }),
      customLabel: "Custom picture…",
      // 4216 x 368 is 11:1; a square tile of it is 44 x 4 px of paint, which
      // is what made the grid unreadable. One strip per row instead.
      tile: "wide",
    });
    trackIllustration.onChange(paintArt);
    pickers.append(...artRow(trackIllustration, init.illustrationFolder));
  }
  block.append(pickers);
  art.body.append(block);
  if (form.iconFolder || init?.illustrationFolder) host.append(art.el);

  // --- Shown when ----------------------------------------------------------
  const isShown = form.keys.find((k) => k.key === SHOWN_KEY);
  if (isShown) {
    const shown = fold(
      "Shown when",
      isShown.doc ?? "When the game offers this track at all.",
      false,
      TRACK_HELP.shown
    );
    trackShown = conditionField({
      label: isShown.key,
      bare: true,
      conditions: form.conditions ?? {},
      value: valueOf(trackOriginal ?? newDefBlock(name), isShown.key) ?? "",
      placeholder: EXAMPLE.isShown,
      onOpenFile: () => openInFile("track", trackName),
    });
    trackShown.onChange(refreshScript);
    shown.body.append(trackShown.el);
    host.append(shown.el);
  }

  // --- Other keys ----------------------------------------------------------
  const others = otherKeys(form, [SHOWN_KEY], trackOriginal);
  if (others.length > 0) {
    const rest = fold(
      "Other keys the game documents for a legacy",
      "Everything the harvest reports that no control above stands for.",
      false,
      TRACK_HELP.others
    );
    for (const spec of others) {
      const field = rawField(spec, valueOf(trackOriginal ?? newDefBlock(name), spec.key) ?? "", () =>
        openInFile("track", trackName)
      );
      trackOthers[spec.key] = field;
      rest.body.append(field.el);
    }
    host.append(rest.el);
  }

  // --- The row the game draws ---------------------------------------------
  const shape = fold("The track as the game draws it", undefined, true);
  shape.body.append(drawn.note, drawn.el);
  host.append(shape.el);

  for (const { field } of trackLoc) {
    field.onChange(() => {
      paintArt();
      refreshScript();
    });
  }
  for (const field of Object.values(trackOthers)) field.onChange(refreshScript);
}

function trackBlock(): DefBlock {
  const form = trackForm!;
  const name = trackName() || "unnamed_legacy_track";
  const base = trackOriginal ? { ...trackOriginal, name } : newDefBlock(name);
  const values: FieldValue[] = [];
  if (trackShown) values.push({ key: SHOWN_KEY, value: trackShown.get() });
  for (const [key, field] of Object.entries(trackOthers)) {
    const spec = form.keys.find((k) => k.key === key) ?? { key };
    values.push({ key, value: rawValue(spec, field) });
  }
  return applyValues(
    base,
    values,
    form.keys.map((k) => k.key)
  );
}

/** The picture the modder picked, falling back to the one the key would find. */
function pickedArt(field: Field<string> | null, items: readonly IconEntry[]): string {
  const name = trackName();
  return field?.get() || (items.some((i) => i.key === name) ? name : "");
}

/** Put the frame and the mask on a picture, when the host resolved both. */
function maskWith(box: HTMLElement, on: boolean): void {
  const frame = imageUrl(TRACK_FRAME);
  const mask = imageUrl(TRACK_MASK);
  if (on && frame && mask) {
    box.dataset.masked = "";
    box.classList.add("masked");
    box.style.setProperty("--frame", `url("${frame}")`);
    box.style.setProperty("--mask", `url("${mask}")`);
  } else {
    box.removeAttribute("data-masked");
    box.classList.remove("masked");
  }
}

/** The row's own words and pictures: the header fields, as the game shows them. */
function paintArt(): void {
  const name = trackName();
  const words = trackLoc.map(({ pattern, field }) => ({ pattern, value: field.get().trim() }));
  $("rowName").textContent =
    words.find((w) => w.pattern.endsWith("_name"))?.value || titleCaseFromName(name) || "Your track";
  $("rowDesc").textContent = words.find((w) => !w.pattern.endsWith("_name"))?.value ?? "";

  const icon = $("trackArt");
  const pickedIcon = pickedArt(trackIcon, init?.icons ?? []);
  const iconUrl = init?.icons.find((i) => i.key === pickedIcon)?.url;
  icon.replaceChildren();
  if (iconUrl) {
    const img = document.createElement("img");
    img.src = iconUrl;
    img.alt = pickedIcon;
    icon.append(img);
  } else {
    icon.append(iconEl("image"));
  }
  maskWith(icon, iconUrl !== undefined);

  paintStrip();
}

/**
 * The illustration under the perks. It is asked for at the strip's own cap and
 * not at the thumbnail cap: the file is the widest texture any creator loads,
 * and a 256 px decode of it is 22 px tall.
 */
function paintStrip(): void {
  const strip = $("stripArt");
  const picked = pickedArt(trackIllustration, init?.illustrations ?? []);
  const folder = init?.illustrationFolder;
  const path = folder && picked ? `${folder}/${picked}.dds` : "";
  if (path) askImages([path], STRIP_DIM);
  const url = path ? imageUrl(path) : null;
  strip.replaceChildren();
  if (url) {
    // Two passes, exactly as the window draws it: the second multiplies the
    // frame and the mask into the picture a second time.
    for (let i = 0; i < 2; i++) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = i === 0 ? picked : "";
      maskWith(img, true);
      strip.append(img);
    }
    strip.removeAttribute("data-empty");
  } else {
    strip.dataset.empty = "";
  }
}

// ---------------------------------------------------------------------------
// The perk tiles
// ---------------------------------------------------------------------------

/** The picker entries for a ref kind, with the pictures asked for up front. */
function refItems(kind: string): EventVocabularyItem[] {
  const items = vocabulary(perkForm?.options[kind] ?? []);
  askImages(items.map((item) => refImage(kind, item.value)));
  return items;
}

/**
 * The perk's form, section by section. Every title is the prose the key means
 * and every lede is the harvest's own sentence about it, so the raw key is
 * only ever a tooltip; the controls inside are drawn `bare` because the
 * section head already names them.
 */
function addPerk(loaded?: LoadedPerk, loc: Record<string, string> = {}): Perk {
  const form = perkForm!;
  const original = loaded ? parseDefBlock(loaded.text) : null;
  // The first FREE number, not the perk count: removing the third of five and
  // adding one back handed the new perk the fifth's own key.
  const fresh = freePerkName(trackName() || "legacy", perks.map(perkName));
  const name = loaded?.name ?? fresh;

  const tile = el("div", "perktile");
  tile.tabIndex = 0;
  tile.setAttribute("role", "button");
  const step = el("span", "step");
  const face = el("span", "face");
  const tools = el("span", "px-item-tools");
  const drop = document.createElement("button");
  drop.className = "px-btn";
  drop.dataset.variant = "ghost";
  drop.dataset.size = "icon-xs";
  drop.dataset.tip = "Remove this perk from the track";
  drop.append(iconEl("trash"));
  tools.append(drop);
  tile.append(step, face, tools);

  const editor = el("div");
  const identity = fold(
    "Identity",
    "The key the game reads, and the name the player sees.",
    true,
    PERK_HELP.identity
  );
  const key = textField({
    label: "Key",
    doc: "The perk's key. Its loc key and its default name follow it.",
    value: name,
    placeholder: fresh,
  });
  identity.body.append(key.el);
  editor.append(identity.el);

  const perk: Perk = {
    tile,
    step,
    face,
    editor,
    key,
    lastKey: name,
    original,
    source: loaded?.source ?? null,
    file: loaded?.file ?? null,
    loc: [],
    mods: {},
    doctrines: null,
    blocks: {},
    effect: null,
    others: {},
  };

  for (const pattern of form.locPatterns) {
    const field = locField({
      label: "Name",
      key: locKeyFor(pattern, name),
      value: loc[locKeyFor(pattern, name)] ?? titleCaseFromName(name),
      placeholder: titleCaseFromName(name) || "What the player sees",
    });
    perk.loc.push({ pattern, field });
    identity.body.append(field.el);
  }

  const modifiers = (form.modifiers ?? []).map((mod) => ({
    value: mod.name,
    ...(mod.doc ? { doc: mod.doc } : {}),
  }));

  /** One `name = number` block of the perk, in a section of its own. */
  const modBlock = (blockKey: string, title: string, isOpen: boolean, help: () => HelpSpec): void => {
    const spec = form.keys.find((k) => k.key === blockKey);
    if (!spec) return;
    const entries = parseModifierBlock(original ? (valueOf(original, blockKey) ?? "") : "");
    const section = fold(title, spec.doc, isOpen || entries.length > 0, help);
    section.title.dataset.tip = blockKey;
    const field = rowsField({
      label: blockKey,
      bare: true,
      items: modifiers,
      rows: modifierRows(entries),
      addLabel: "Add modifier",
      pickLabel: "pick a modifier",
      step: 0.1,
      preview: (row) => gameLine(row.name, row.value),
    });
    perk.mods[blockKey] = { entries, field };
    section.body.append(field.el);
    editor.append(section.el);
  };

  modBlock(CHAR_MOD, "Modifiers for every dynasty member", true, PERK_HELP.characterModifier);

  // A perk writes ONE `doctrine_character_modifier` per doctrine, and the
  // game's own erudition_legacy_4 writes three, so the form holds a list.
  const doctrineSpec = form.keys.find((k) => k.key === DOCTRINE_MOD);
  if (doctrineSpec) {
    const values = original ? valuesOf(original, DOCTRINE_MOD) : [];
    const section = fold("Doctrine modifiers", doctrineSpec.doc, values.length > 0, PERK_HELP.doctrines);
    section.title.dataset.tip = DOCTRINE_MOD;
    const inner = form.blocks?.[DOCTRINE_MOD]?.find((k) => k.key === "doctrine");
    const kind = inner?.refKinds?.[0] ?? DOCTRINE_KEY;
    const doctrines = form.options[kind] ?? [];
    perk.doctrines = doctrineField({
      values,
      perk: name,
      doctrines: doctrines.length > 0 ? refItems(kind) : [],
      ...(inner?.doc ? { doctrineDoc: inner.doc } : {}),
      thumb: (v) => imageUrl(refImage(kind, v)),
      modifiers,
      preview: (row) => gameLine(row.name, row.value),
      locOf: (locKey) => locValues.get(locKey),
    });
    askLoc(perk.doctrines.keys());
    section.body.append(perk.doctrines.el);
    editor.append(section.el);
  }

  const traitsSpec = form.keys.find((k) => k.key === TRAITS_KEY);
  if (traitsSpec) {
    const entries = parseModifierBlock(original ? (valueOf(original, TRAITS_KEY) ?? "") : "");
    const kind = traitsSpec.refKinds?.[0] ?? TRAIT_KEY;
    const section = fold("Traits granted", traitsSpec.doc, entries.length > 0, PERK_HELP.traits);
    section.title.dataset.tip = TRAITS_KEY;
    const field = rowsField({
      label: TRAITS_KEY,
      bare: true,
      items: refItems(kind),
      rows: modifierRows(entries),
      addLabel: "Add trait",
      pickLabel: "pick a trait",
      step: 1,
      // The weight the game's own weighted traits carry most often
      // (00_dynasty_perks.txt blood_legacy_4, measured).
      placeholder: "100",
      image: (v) => imageUrl(refImage(kind, v)),
    });
    perk.mods[TRAITS_KEY] = { entries, field };
    section.body.append(field.el);
    editor.append(section.el);
  }

  // The three blocks with a builder. Each is drawn only when the harvest says
  // the kind has the key, and each keeps the whole block as script when the
  // builder cannot show it (app/builders.ts).
  const blockValue = (blockKey: string): string => (original ? (valueOf(original, blockKey) ?? "") : "");
  const docOf = (blockKey: string): string | undefined => form.keys.find((k) => k.key === blockKey)?.doc;
  const has = (blockKey: string): boolean => form.keys.some((k) => k.key === blockKey);
  const addBlock = (blockKey: string, section: Fold, field: BlockField): void => {
    perk.blocks[blockKey] = field;
    section.title.dataset.tip = blockKey;
    section.body.append(field.el);
    editor.append(section.el);
  };

  // Every script area of a perk opens the perks' file at THIS perk's block.
  const openPerkFile = (): void => openInFile("perks", () => perkName(perk));

  if (has(PICKED_KEY)) {
    const section = fold(
      "Can be picked when",
      docOf(PICKED_KEY),
      blockValue(PICKED_KEY) !== "",
      PERK_HELP.canBePicked
    );
    addBlock(
      PICKED_KEY,
      section,
      conditionField({
        label: PICKED_KEY,
        bare: true,
        conditions: form.conditions ?? {},
        value: blockValue(PICKED_KEY),
        placeholder: EXAMPLE.canBePicked,
        onOpenFile: openPerkFile,
      })
    );
  }
  if (has(EFFECT_KEY)) {
    const section = fold("On pick", docOf(EFFECT_KEY), true, PERK_HELP.effect);
    perk.effect = effectField({
      label: EFFECT_KEY,
      bare: true,
      value: blockValue(EFFECT_KEY),
      name,
      placeholder: EXAMPLE.effect,
      locOf: (locKey) => locValues.get(locKey),
      onTemplate: (anchor) => pickTemplate(perk, anchor),
      onOpenFile: openPerkFile,
    });
    addBlock(EFFECT_KEY, section, perk.effect);
    askLoc(perk.effect.keys());
  }
  if (has(CHANCE_KEY)) {
    const section = fold("AI weight", docOf(CHANCE_KEY), blockValue(CHANCE_KEY) !== "", PERK_HELP.chance);
    addBlock(
      CHANCE_KEY,
      section,
      chanceField({
        label: CHANCE_KEY,
        bare: true,
        handle: section.title,
        value: blockValue(CHANCE_KEY),
        placeholder: EXAMPLE.chance,
        onOpenFile: openPerkFile,
      })
    );
  }

  const owned = [LEGACY_KEY, CHAR_MOD, DOCTRINE_MOD, TRAITS_KEY, ...BUILT_KEYS];
  const others = otherKeys(form, owned, original);
  if (others.length > 0) {
    const section = fold(
      "Other keys",
      "Everything the harvest reports that no section above stands for.",
      false,
      PERK_HELP.others
    );
    for (const spec of others) {
      const field = rawField(spec, original ? (valueOf(original, spec.key) ?? "") : "", openPerkFile);
      perk.others[spec.key] = field;
      section.body.append(field.el);
    }
    editor.append(section.el);
  }

  key.onChange(() => {
    renamePerk(perk);
    paintTile(perk);
    refreshScript();
  });
  perk.effect?.onChange(() => askLoc(perk.effect?.keys() ?? []));
  const touched = (): void => {
    paintTile(perk);
    refreshScript();
  };
  for (const { field } of perk.loc) field.onChange(touched);
  for (const { field } of Object.values(perk.mods)) field.onChange(touched);
  perk.doctrines?.onChange(() => {
    askLoc(perk.doctrines?.keys() ?? []);
    touched();
  });
  for (const field of Object.values(perk.blocks)) field.onChange(touched);
  for (const field of Object.values(perk.others)) field.onChange(touched);

  tile.onclick = () => selectPerk(perk);
  tile.onkeydown = (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      selectPerk(perk);
    }
  };
  tile.addEventListener("pointerenter", () => showTip(perk));
  tile.addEventListener("pointerleave", hideTip);
  drop.onclick = (ev) => {
    ev.stopPropagation();
    void removePerk(perk);
  };

  perks.push(perk);
  drawn.perks.append(tile);
  paintTile(perk);
  return perk;
}

/** Where a listed definition comes from, in the words the pickers use. */
const SOURCE_WORD: Record<string, string> = {
  mod: "this mod",
  vanilla: "the game",
  parent: "a dependency",
};

/** The perk whose effect the template picker is filling, until the host answers. */
let templateFor: Perk | null = null;

/**
 * Start a perk's effect from one the game already writes. The blocks live on
 * disk, so the app names the perk and the host hands back its effect.
 */
function pickTemplate(perk: Perk, anchor: HTMLElement): void {
  const items = (perkForm?.existing ?? [])
    .filter((def) => def.name !== perkName(perk))
    .map((def) => {
      const where = SOURCE_WORD[def.source ?? "mod"] ?? def.source ?? "";
      return {
        value: def.name,
        label: def.label || def.name,
        hint: def.label ? `${def.name} · ${where}` : where,
      };
    });
  if (items.length === 0) {
    toast("No perk to copy an effect from yet.");
    return;
  }
  templateFor = perk;
  menu(anchor, items, {
    search: true,
    width: 340,
    onPick: (name) => send({ type: "perkEffect", name }),
  });
}

/** The tile's face: its place in the track, and the name the player reads. */
function paintTile(perk: Perk): void {
  const index = perks.indexOf(perk);
  perk.step.textContent = String(index + 1);
  const name = perk.loc[0]?.field.get().trim();
  perk.face.textContent = name || perkName(perk) || "unnamed perk";
  if (tipFor === perk) showTip(perk);
}

/** The loc key follows the name, so a rename repaints the (read-only) keys. */
function renamePerk(perk: Perk): void {
  const name = perkName(perk);
  const was = perk.lastKey;
  perk.lastKey = name;
  perk.loc.forEach(({ pattern, field }) => {
    const code = field.el.querySelector("code");
    if (code) code.textContent = locKeyFor(pattern, name);
  });
  // The tooltip lines' loc keys follow it too, for every line whose key was
  // the one derived from the old name, and so do the doctrine blocks' names.
  perk.effect?.rename(was, name);
  perk.doctrines?.rename(was, name);
  askLoc([...(perk.effect?.keys() ?? []), ...(perk.doctrines?.keys() ?? [])]);
}

async function removePerk(perk: Perk): Promise<void> {
  const name = perkName(perk);
  if (perk.source === "mod" && perk.file) {
    const ok = await confirmDialog({
      title: `Remove ${name} from the track?`,
      description:
        "The tile goes away and the perk stops being written. Its block stays in the file it already lives in: " +
        "the toolkit does not delete definitions for you. Delete it there if you want it gone from the game.",
      confirmLabel: "Remove from the track",
      destructive: true,
    });
    if (!ok) return;
    dropped.push({ name, file: perk.file });
  }
  perks = perks.filter((p) => p !== perk);
  perk.tile.remove();
  if (selected === perk) selectPerk(null);
  if (tipFor === perk) hideTip();
  renumber();
  refreshScript();
}

function renumber(): void {
  for (const perk of perks) paintTile(perk);
  paintSideHead();
}

function perkBlock(perk: Perk): DefBlock {
  const form = perkForm!;
  const name = perkName(perk) || "unnamed_perk";
  const base = perk.original ? { ...perk.original, name } : newDefBlock(name);
  const order = form.keys.map((k) => k.key);
  const values: FieldValue[] = [{ key: LEGACY_KEY, value: trackName() || "unnamed_legacy_track" }];
  for (const [blockKey, mod] of Object.entries(perk.mods)) {
    values.push({
      key: blockKey,
      // The file's own block when the rows write nothing: an empty
      // `character_modifier = { }` is a key the perk HAS (script.ts).
      value: modifierBlockValue(
        mod.entries,
        mod.field.get(),
        perk.original ? valueOf(perk.original, blockKey) : null
      ),
    });
  }
  for (const [blockKey, field] of Object.entries(perk.blocks)) {
    values.push({ key: blockKey, value: field.get() });
  }
  for (const [otherKey, field] of Object.entries(perk.others)) {
    const spec = form.keys.find((k) => k.key === otherKey) ?? { key: otherKey };
    values.push({ key: otherKey, value: rawValue(spec, field) });
  }
  const block = applyValues(base, values, order);
  // The one key a perk may write more than once, so it is set as a list and
  // not as a value (script.ts `applyRepeated`).
  return perk.doctrines ? applyRepeated(block, DOCTRINE_MOD, perk.doctrines.blocks(), order) : block;
}

/**
 * True when the perk's doctrine blocks are not the ones the file has. A key
 * written several times cannot go through `setProperties`, which rewrites the
 * LAST entry for a key and would leave the others behind, so a perk whose list
 * moved is written as a whole block.
 */
function doctrineMoved(perk: Perk): boolean {
  const was = perk.original ? valuesOf(perk.original, DOCTRINE_MOD) : [];
  const now = perk.doctrines?.blocks() ?? [];
  return was.length !== now.length || was.some((value, i) => value !== now[i]);
}

// ---------------------------------------------------------------------------
// The tooltip: the perk as the game prints it
// ---------------------------------------------------------------------------

/** One modifier row, in the player's words, or null when nothing was picked. */
function gameLine(name: string, value: number): HTMLElement | null {
  if (name.trim() === "") return null;
  const fmt: ModifierFormat | undefined = init?.formats?.[name];
  for (const part of [...(fmt?.prefix ?? []), ...(fmt?.suffix ?? []), ...(fmt?.negativeSuffix ?? [])]) {
    if ("icon" in part) askImages([part.icon.texture]);
  }
  return renderModifierLine(modifierLine(name, value, fmt), imageUrl);
}

/** The player's word for one entry of a ref kind, or the key when it has none. */
function refLabel(kind: string, value: string): string {
  return perkForm?.options[kind]?.find((item) => item.value === value)?.label || value;
}

/** The tooltip's body: name, what it grants, and what its effect says. */
function tipBody(perk: Perk): HTMLElement {
  const box = el("div", "px-game-tip");
  box.append(el("div", "px-game-tip-title", perk.face.textContent ?? ""));

  for (const row of [...(perk.mods[CHAR_MOD]?.field.get() ?? []), ...(perk.doctrines?.rows() ?? [])]) {
    const line = gameLine(row.name, row.value);
    if (line) box.append(line);
  }

  const traitKind = perkForm?.keys.find((k) => k.key === TRAITS_KEY)?.refKinds?.[0] ?? TRAIT_KEY;
  const traits = (perk.mods[TRAITS_KEY]?.field.get() ?? [])
    .filter((row) => row.name.trim() !== "")
    .map((row) => refLabel(traitKind, row.name));
  const fixed = perk.others[TRAIT_KEY]?.get().trim();
  if (fixed) traits.unshift(refLabel(traitKind, fixed));
  if (traits.length > 0) {
    box.append(el("div", "px-game-tip-body", `Grants a trait: ${traits.join(", ")}`));
  }

  const effect = perk.blocks[EFFECT_KEY]?.get()?.trim() ?? "";
  if (effect !== "") {
    const key = effectLocKey(effect);
    // The sentence the modder just typed outranks the one the workspace has:
    // the tooltip has to show what this perk will say, not what it said.
    const typed = new Map((perk.effect?.loc() ?? []).map((pair) => [pair.key, pair.value]));
    const prose = key ? (typed.get(key) ?? locValues.get(key)) : undefined;
    if (key) askLoc([key]);
    box.append(
      el(
        "div",
        "px-game-tip-body",
        prose ??
          (key
            ? key
            : `Scripted effect: ${effect
                .replace(/^\{\s*/, "")
                .split("\n")[0]
                .trim()}`)
      )
    );
  }
  if (box.children.length === 1) {
    box.append(el("div", "px-game-tip-body", "This perk does nothing yet."));
  }
  return box;
}

let tipFor: Perk | null = null;

function showTip(perk: Perk): void {
  tipFor = perk;
  const tip = $("perkTip");
  tip.replaceChildren(tipBody(perk));
  tip.hidden = false;
  const anchor = perk.tile.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  const left = Math.max(4, Math.min(window.innerWidth - box.width - 4, anchor.left));
  const below = anchor.bottom + 6;
  const top = below + box.height > window.innerHeight - 4 ? anchor.top - box.height - 6 : below;
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(4, top)}px`;
}

function hideTip(): void {
  tipFor = null;
  $("perkTip").hidden = true;
}

// ---------------------------------------------------------------------------
// The perk editor, in the side panel
// ---------------------------------------------------------------------------

interface PanelState {
  width?: number;
}

const saved = (vscode.getState() as PanelState | null) ?? {};
/** What the form beside it needs to stay a form: the strip's own floor plus room. */
const MIN_FORM = 360;
const side = sidePanel($("side"), {
  ...(saved.width ? { width: saved.width } : {}),
  collapsed: true,
  // A width remembered from a wide window would otherwise leave nothing for
  // the track itself when the panel is narrow.
  max: () => Math.max(220, document.documentElement.clientWidth - MIN_FORM),
  onChange: ({ width }) => vscode.setState({ width }),
});

window.addEventListener("resize", () => {
  side.reclamp();
  // The tooltip is positioned from a tile's rectangle, which the resize just
  // moved; it would sit over the form at its old place until the pointer came
  // back. Popovers and menus close themselves (shared/overlay.ts).
  hideTip();
});
// The same for a scroll: the form scrolls under the tip, and so does the
// strip itself once the row is wider than the panel.
document.addEventListener("scroll", hideTip, true);

/** The panel's head: the perk it is showing, and where it sits on the track. */
function paintSideHead(): void {
  const at = selected ? perks.indexOf(selected) : -1;
  const title = $("sideTitle");
  title.textContent = selected ? selected.face.textContent || perkName(selected) || "Perk" : "Perk";
  title.dataset.tip = at >= 0 ? `Perk ${at + 1} of ${perks.length}` : "";
  $<HTMLButtonElement>("prevPerk").disabled = at <= 0;
  $<HTMLButtonElement>("nextPerk").disabled = at < 0 || at >= perks.length - 1;
}

function selectPerk(perk: Perk | null): void {
  selected = perk;
  for (const other of perks) other.tile.setAttribute("aria-selected", String(other === perk));
  const host = $("perkEditor");
  host.replaceChildren();
  if (!perk) {
    side.toggle(true);
    paintSideHead();
    return;
  }
  host.append(perk.editor);
  side.toggle(false);
  paintSideHead();
}

/** The perk one step along the track, when there is one. */
function stepPerk(by: number): void {
  const at = selected ? perks.indexOf(selected) : -1;
  const next = perks[at + by];
  if (next) selectPerk(next);
}

$("closeSide").onclick = () => selectPerk(null);
$("prevPerk").onclick = () => stepPerk(-1);
$("nextPerk").onclick = () => stepPerk(1);
$("togglePerk").onclick = () => {
  if (!side.collapsed) {
    selectPerk(null);
    return;
  }
  // Opening on nothing would show an empty panel; the track always starts
  // at its first perk.
  selectPerk(selected ?? perks[0] ?? null);
};

// Escape closes the perk editor. The overlays (menu, popover, confirm dialog)
// listen in the CAPTURE phase and stop the event there, so an open menu takes
// its own Escape and this only ever sees the ones nothing else wanted.
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape" || selected === null) return;
  ev.preventDefault();
  selectPerk(null);
});

// ---------------------------------------------------------------------------
// Dragging a tile to another place in the track
// ---------------------------------------------------------------------------

/**
 * `shared/sortable.ts` does this for a VERTICAL list: it hit-tests on clientY
 * only, so every tile of a row reads as the same place. The row is the game's
 * own layout and cannot become a column, so the pointer handling lives here
 * until sortable takes an axis.
 */
function enableTileDrag(list: HTMLElement): void {
  list.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    const tile = (down.target as HTMLElement).closest<HTMLElement>(".perktile");
    if (!tile || tile.dataset.add !== undefined) return;
    if ((down.target as HTMLElement).closest("button")) return;
    const from = perks.findIndex((p) => p.tile === tile);
    if (from < 0 || perks.length < 2) return;

    const startX = down.clientX;
    let dragging = false;
    let to = from;

    const move = (ev: PointerEvent): void => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < 4) return;
        dragging = true;
        hideTip();
        list.setPointerCapture(down.pointerId);
        tile.dataset.dragging = "";
      }
      const others = perks.filter((p) => p.tile !== tile);
      let index = others.length;
      for (let i = 0; i < others.length; i++) {
        const box = others[i].tile.getBoundingClientRect();
        if (ev.clientX < box.left + box.width / 2) {
          index = i;
          break;
        }
      }
      if (index === to) return;
      to = index;
      list.insertBefore(tile, others[index]?.tile ?? null);
    };

    const end = (): void => {
      list.removeEventListener("pointermove", move);
      list.removeEventListener("pointerup", end);
      list.removeEventListener("pointercancel", end);
      if (!dragging) return;
      tile.removeAttribute("data-dragging");
      // The pointer sequence ends in a click; a drag must not also open the
      // editor for the tile it just moved.
      tile.addEventListener("click", (click) => click.stopPropagation(), {
        capture: true,
        once: true,
      });
      const moved = perks.splice(from, 1)[0];
      perks.splice(to, 0, moved);
      renumber();
      refreshScript();
    };

    list.addEventListener("pointermove", move);
    list.addEventListener("pointerup", end);
    list.addEventListener("pointercancel", end);
  });
}

// ---------------------------------------------------------------------------
// Preview and save
// ---------------------------------------------------------------------------

/**
 * Where the save goes. A legacy is two files, but it is ONE save into one mod,
 * so the top bar carries one line: it names the mod and the track's file, its
 * tooltip names both files, and clicking it asks which of the two to move
 * before handing that question to the host's own picker.
 */
const targetFiles: Record<TargetKind, CreatorSaveTarget | null> = { track: null, perks: null };
const target = saveTargetLine(() => pickTargetFile());
target.set(null);
$("target").append(target.el);

function paintTargets(): void {
  target.set(targetFiles.track);
  if (!targetFiles.track) return;
  const perksPath = targetFiles.perks ? shortPath(targetFiles.perks.path) : "nowhere yet";
  target.el.dataset.tip =
    `The track goes to ${shortPath(targetFiles.track.path)} and its perks to ${perksPath}, ` +
    `both in ${targetFiles.track.modLabel}. Click to move one of them.`;
  target.el.dataset.tipWrap = "";
}

function pickTargetFile(): void {
  const line = (which: TargetKind, label: string): { value: string; label: string; hint: string } => ({
    value: which,
    label,
    hint: targetFiles[which] ? shortPath(targetFiles[which]!.path) : "not chosen yet",
  });
  menu(target.el, [line("track", "The track's file"), line("perks", "The perks' file")], {
    width: 320,
    onPick: (which) => send({ type: "changeTarget", which: which as TargetKind }),
  });
}

/** What the mod's two files will contain, as a section of the form. */
const script = scriptSection({
  note: "The track goes into one file and its perks into another; the save line says which.",
  onCopy: (text) => send({ type: "copy", text }),
});
$("scriptSlot").replaceWith(script.el);
$("scriptCopy").replaceWith(script.copyButton);

function refreshScript(): void {
  if (!trackForm) return;
  const blocks = [trackBlock(), ...perks.map(perkBlock)].map(writeDefBlock);
  script.set(blocks.join("\n\n"));
}

/** `create`, `edit` or `override`, from where the loaded definition came from. */
function modeFor(source: "mod" | "vanilla" | "parent" | null): SaveDefinition["mode"] {
  if (source === null) return "create";
  if (source === "mod") return "edit";
  return overrideMode ? "override" : "create";
}

function locPairs(
  entries: readonly { pattern: string; field: Field<string> }[],
  name: string
): { key: string; value: string }[] {
  const pairs: { key: string; value: string }[] = [];
  for (const { pattern, field } of entries) {
    const value = field.get().trim();
    if (value !== "") pairs.push({ key: locKeyFor(pattern, name), value });
  }
  return pairs;
}

function definitionFor(
  block: DefBlock,
  original: DefBlock | null,
  source: "mod" | "vanilla" | "parent" | null,
  file: string | null,
  loc: { key: string; value: string }[],
  keys: readonly string[],
  /** Rewrite the whole block, even on an edit: a repeated key moved. */
  whole = false
): SaveDefinition {
  // A renamed definition is a new one: there is no `<new name> = { … }` in the
  // file to set properties on, so the whole block has to be written.
  const renamed = original !== null && original.name !== block.name;
  const mode = renamed ? "create" : modeFor(source);
  const changed =
    mode === "edit" && original && !whole
      ? changedProperties(original, block, [...new Set([...keys, ...original.statements.map((s) => s.key)])])
      : undefined;
  return {
    name: block.name,
    mode,
    block: writeDefBlock(block),
    ...(changed ? { changed } : {}),
    loc,
    ...(source === "mod" && file ? { sourceFile: baseName(file) } : {}),
  };
}

/**
 * The blocks the last save handed the host, kept until it answers. They are
 * what the definitions BECOME once the write lands, and they are snapshotted
 * here rather than rebuilt from the form on the reply, so an edit made while
 * the save was in flight is still an edit and not something already written.
 */
let pendingSave: { track: DefBlock; perks: { perk: Perk; block: DefBlock }[] } | null = null;

/** True when the save was handed to the host; false when the form refused it. */
function save(): boolean {
  if (!trackForm || !perkForm) return false;
  const name = trackName();
  if (!NAME_RE.test(name)) {
    toast("The track needs a key: lowercase letters, digits and _, starting with a letter.", "destructive");
    return false;
  }
  if (trackSource !== null && trackSource !== "mod" && !overrideMode && name === trackOriginal?.name) {
    toast(`Duplicating ${name} needs a key of its own. Change it, or switch to Override.`, "destructive");
    return false;
  }
  const names = perks.map(perkName);
  const bad = names.find((n) => !NAME_RE.test(n));
  if (bad !== undefined) {
    toast(`"${bad}" is not a usable perk key: lowercase letters, digits and _.`, "destructive");
    return false;
  }
  if (new Set(names).size !== names.length) {
    toast("Two perks share a key. Each perk needs its own.", "destructive");
    return false;
  }

  const trackKeys = trackForm.keys.map((k) => k.key);
  const perkKeys = perkForm.keys.map((k) => k.key);
  const trackBody = trackBlock();
  const perkBodies = perks.map((perk) => ({ perk, block: perkBlock(perk) }));
  const track = definitionFor(
    trackBody,
    trackOriginal,
    trackSource,
    trackFile,
    locPairs(trackLoc, name),
    trackKeys
  );
  const written = perkBodies.map(({ perk, block }) =>
    definitionFor(
      block,
      perk.original,
      perk.source,
      perk.file,
      // The tooltip lines of the effect builder and the names of the doctrine
      // blocks are loc too: the block writes the key and the sentence has to
      // exist for the player to read it.
      [
        ...locPairs(perk.loc, perkName(perk)),
        ...(perk.effect?.loc() ?? []),
        ...(perk.doctrines?.loc() ?? []),
      ],
      perkKeys,
      doctrineMoved(perk)
    )
  );
  const icon = trackIcon?.get() ?? "";
  const illustration = trackIllustration?.get() ?? "";
  pendingSave = { track: trackBody, perks: perkBodies };
  send({
    type: "save",
    track,
    perks: written,
    dropped: dropped.slice(),
    icon: icon && icon !== name ? icon : null,
    illustration: illustration && illustration !== name ? illustration : null,
  });
  return true;
}

/**
 * A landed save makes the form's own blocks the ones on disk.
 *
 * Without this the app still held `original = null` after a create, so every
 * later save wrote each block WHOLE over a file the modder may have edited by
 * hand in between. From here the next save is an edit that rewrites only the
 * keys that moved; a definition renamed afterwards goes back to a create,
 * because there is no block of that new name in the file.
 */
function adoptSaved(trackTo: string, perksTo: string | null): void {
  const sent = pendingSave;
  pendingSave = null;
  if (!sent) return;
  trackOriginal = sent.track;
  trackSource = "mod";
  trackFile = trackTo;
  overrideMode = false;
  paintMode();
  const badge = $("source");
  badge.hidden = false;
  badge.textContent = "this mod";
  // The Duplicate/Override choice is about the game's copy of a track; the
  // track is now the mod's own, and there is nothing left to choose.
  $("mode").hidden = true;
  for (const { perk, block } of sent.perks) {
    if (!perks.includes(perk)) continue;
    perk.original = block;
    perk.source = "mod";
    perk.file = perksTo;
  }
}

/**
 * "Edit in the file": save, then open the definition where it landed.
 *
 * The host holds no blocks of its own, so it cannot write them and then open
 * the file by itself. The app saves, and asks from the REPLY: one message
 * after the other, never two the host could answer out of order.
 */
let openAfterSave: { name: string; which: TargetKind } | null = null;

function openInFile(which: TargetKind, nameOf: () => string): void {
  const name = nameOf().trim();
  if (!NAME_RE.test(name)) {
    toast("Give it a key first: the file opens at the definition's own block.", "destructive");
    return;
  }
  openAfterSave = { name, which };
  if (!save()) openAfterSave = null;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * The tile that ends the row: the only way a track grows a perk. It stands
 * BESIDE the illustration and not on it, because the strip is exactly the box
 * the game's own perks define and a sixth tile would stretch the picture.
 */
const addTile = drawn.add;
const addPerkClicked = (): void => {
  const perk = addPerk();
  refreshScript();
  selectPerk(perk);
};
addTile.onclick = addPerkClicked;
addTile.onkeydown = (ev) => {
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    addPerkClicked();
  }
};

function reset(loc: Record<string, string> = {}): void {
  perks = [];
  selectPerk(null);
  hideTip();
  drawn.perks.replaceChildren();
  buildTrack(loc);
  paintArt();
  refreshScript();
}

function applyInit(payload: CreatorInit): void {
  init = payload;
  trackForm = payload.legacy;
  perkForm = payload.perk;
  trackOriginal = null;
  trackSource = null;
  trackFile = null;
  dropped = [];
  const nameInput = $<HTMLInputElement>("name");
  if (nameInput.value.trim() === "") nameInput.value = `${payload.prefix}_legacy_track`;
  derivedFrom = nameInput.value.trim();
  // The mod is named on the save line; this says which language the loc lands
  // in, which no target line can.
  $("locLang").textContent = payload.locLanguage;
  const problem = $("problem");
  problem.hidden = payload.problem === null;
  problem.textContent = payload.problem ?? "";
  $<HTMLButtonElement>("save").disabled = payload.problem !== null;
  drawn.note.textContent =
    payload.perksPerTrack === null
      ? "The illustration is one picture stretched behind every perk. (The game folder is not set, so the usual number of perks could not be read.)"
      : `The illustration is one picture stretched behind every perk. (Vanilla tracks have ${payload.perksPerTrack} perks.)`;
  askImages([TRACK_FRAME, TRACK_MASK], STRIP_DIM);
  reset();
  const slots = payload.perksPerTrack ?? 1;
  for (let i = 0; i < slots; i++) addPerk();
  refreshScript();
}

/**
 * Swap one picture control for one over the folder as it now stands: the host
 * wrote into that folder, so its list changed under the open picker.
 */
function rebuildArt(which: "icon" | "illustration", select?: string): void {
  const previous = which === "icon" ? trackIcon : trackIllustration;
  if (!previous || !init) return;
  const isIcon = which === "icon";
  const note = isIcon ? ART_NOTES.icon : ART_NOTES.illustration;
  const rebuilt = iconField({
    label: isIcon ? "Icon" : "Illustration",
    doc: note.doc,
    info: note.info,
    items: isIcon ? init.icons : init.illustrations,
    value: select ?? previous.get(),
    onCustom: () => send({ type: "customIcon", track: trackName(), which }),
    customLabel: "Custom picture…",
    ...(isIcon ? {} : { tile: "wide" as const }),
  });
  rebuilt.onChange(paintArt);
  previous.el.replaceWith(rebuilt.el);
  if (isIcon) trackIcon = rebuilt;
  else trackIllustration = rebuilt;
  paintArt();
}

function applyLoaded(track: DefinitionForm, loaded: LoadedPerk[], loc: Record<string, string>): void {
  trackForm = track;
  trackOriginal = track.current ? parseDefBlock(track.current.text) : null;
  trackSource = track.current?.source ?? null;
  trackFile = track.current?.file ?? null;
  dropped = [];
  overrideMode = false;
  paintMode();
  if (trackOriginal) $<HTMLInputElement>("name").value = trackOriginal.name;
  derivedFrom = trackName();
  const badge = $("source");
  badge.hidden = trackSource === null;
  badge.textContent =
    trackSource === "mod" ? "this mod" : trackSource === "vanilla" ? "the game" : "a parent mod";
  $("mode").hidden = trackSource === null || trackSource === "mod";
  reset(loc);
  for (const perk of loaded) addPerk(perk, loc);
  paintArt();
  refreshScript();
  // A loaded track opens on its first perk: the panel's whole subject is the
  // perks, and an empty side panel next to five filled tiles says nothing.
  if (perks.length > 0) selectPerk(perks[0]);
}

/**
 * Everything the modder never has to type follows the track's key: a value
 * that is still the one derived from the OLD key follows the new one, and a
 * value they typed themselves is left alone. A perk loaded from the game
 * follows too, because duplicating a track under a new key that kept the
 * game's perk keys would override those perks instead of copying them.
 */
function renameFromTrackKey(): void {
  const name = trackName();
  const was = derivedFrom;
  derivedFrom = name;
  trackLoc.forEach(({ pattern, field }) => {
    const code = field.el.querySelector("code");
    if (code) code.textContent = locKeyFor(pattern, name);
    const derived = field.get().trim() === "" || field.get() === titleCaseFromName(was);
    if (pattern.endsWith("_name") && derived) field.set(titleCaseFromName(name));
  });
  perks.forEach((perk, i) => {
    if (perkName(perk) !== perkNameFor(was, i)) return;
    const previous = perkName(perk);
    perk.key.set(perkNameFor(name, i));
    renamePerk(perk);
    perk.loc.forEach(({ field }) => {
      if (field.get().trim() === "" || field.get() === titleCaseFromName(previous)) {
        field.set(titleCaseFromName(perkName(perk)));
      }
    });
    paintTile(perk);
  });
  paintArt();
  refreshScript();
}

$<HTMLInputElement>("name").addEventListener("change", renameFromTrackKey);

$("new").onclick = () => {
  if (!init) return;
  $<HTMLInputElement>("name").value = "";
  $("source").hidden = true;
  $("mode").hidden = true;
  applyInit(init);
};

$("save").onclick = () => {
  save();
};

$("lookup").onclick = () => {
  const items = (perkForm?.modifiers ?? []).map((mod) => ({
    value: mod.name,
    label: mod.name,
    ...(mod.doc ? { description: mod.doc } : {}),
  }));
  if (items.length === 0) {
    toast("The language server has no modifier list yet.");
    return;
  }
  menu($("lookup"), items, {
    search: true,
    width: 340,
    onPick: (name) => send({ type: "openExamples", name }),
  });
};

$("open").onclick = () => {
  // Every track the index has, the mod's own first: a modder opens one of the
  // game's tracks to duplicate or override it as often as their own to edit
  // it, so each entry says where it comes from.
  const existing = trackForm?.existing ?? [];
  if (existing.length === 0) {
    toast("No dynasty legacy track is indexed yet. Wait for the index, or just make a new one.");
    return;
  }
  menu(
    $("open"),
    existing.map((def) => {
      const where = SOURCE_WORD[def.source ?? "mod"] ?? def.source ?? "";
      return {
        value: def.name,
        label: def.label || def.name,
        hint: def.label ? `${def.name} · ${where}` : where,
      };
    }),
    { search: true, width: 320, onPick: (name) => send({ type: "load", name }) }
  );
};

const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#mode .px-toggle"));

function paintMode(): void {
  for (const button of modeButtons) {
    button.setAttribute("aria-pressed", String((button.dataset.mode === "override") === overrideMode));
  }
}

for (const button of modeButtons) {
  button.onclick = () => {
    overrideMode = button.dataset.mode === "override";
    // A duplicate needs keys of its own; an override IS the game's own key.
    // The perks follow the track's, which is what makes a whole game track
    // duplicable in one move.
    const original = trackOriginal?.name;
    const input = $<HTMLInputElement>("name");
    if (original && overrideMode && trackName() !== original) {
      input.value = original;
      renameFromTrackKey();
    } else if (original && !overrideMode && trackName() === original) {
      input.value = `${init?.prefix ?? "px"}_${original}`;
      renameFromTrackKey();
    }
    paintMode();
  };
}

$("helpBtn").onclick = () =>
  helpDialog({
    title: "Dynasty Legacy Creator",
    intro:
      "A legacy track is a container; the perks are the steps a dynasty buys with prestige. This view draws the track the way the game's own legacy window does and writes it into your mod as a track file, a perk file and the localization that goes with them.",
    sections: [
      {
        title: "The track",
        items: [
          {
            lead: "The key is the only thing you must type.",
            text: "The loc keys, the perk keys, the perk names and the icon path all follow it, and every one of them stays editable.",
          },
          {
            lead: "Neither picture is a script key.",
            text: "The game builds both paths from the track's key, so picking one here copies that picture into your mod under your key. A custom picture goes through the toolkit's DDS converter.",
          },
          {
            lead: "The illustration is one picture, not five.",
            text: "It is stretched behind the whole row of perks and drawn twice, each pass through the window's frame and mask, which is why the row shows it under all the tiles at once.",
          },
        ],
      },
      {
        title: "The perks",
        items: [
          {
            lead: "Hover a tile",
            text: "to read the perk as the player will: every modifier in the game's own words, the trait it grants, and what its effect says.",
          },
          {
            lead: "Click a tile",
            text: "to edit that perk on the right, one perk at a time; the panel's arrows walk the track. Drag a tile to move it along the track; the numbers follow.",
          },
          {
            lead: "Doctrine modifiers are a list.",
            text: "A perk applies one block per doctrine, and the game's own erudition legacy writes three of them, so add as many as the perk needs.",
          },
          {
            lead: "legacy = <track> is written for you",
            text: "on every perk, because a perk only exists inside a track.",
          },
          {
            lead: "Removing a saved perk",
            text: "takes it off the track but leaves its block in the file it already lives in. The toolkit never deletes a definition for you.",
          },
        ],
      },
      {
        title: "Saving",
        items: [
          {
            lead: "One line, two files:",
            text: "the save line names the mod and the track's file; clicking it asks which of the two files to move. A file name the game itself uses is refused, because a mod file of that name replaces the whole game file.",
          },
          {
            lead: "Editing a track your mod already has",
            text: "rewrites only the lines that changed. Everything else in the file, comments included, stays byte for byte as it was.",
          },
        ],
      },
    ],
  });

enableTileDrag(drawn.perks);

window.addEventListener("message", (event: MessageEvent<HostToApp>) => {
  const message = event.data;
  switch (message.type) {
    case "init":
      applyInit(message.init);
      break;
    case "loaded":
      applyLoaded(message.track, message.perks, message.loc);
      break;
    case "icons":
      if (init) {
        if (message.which === "illustration") init.illustrations = message.icons;
        else init.icons = message.icons;
      }
      rebuildArt(message.which ?? "icon", message.select);
      break;
    case "images":
      for (const [key, url] of Object.entries(message.urls)) images.set(key, url);
      paintArt();
      if (tipFor) showTip(tipFor);
      break;
    case "locValues":
      for (const [key, value] of Object.entries(message.values)) locValues.set(key, value);
      // A tooltip line the modder has not typed shows the sentence the
      // workspace already has for its key; so does a doctrine block's name.
      for (const perk of perks) {
        perk.effect?.fillLoc();
        perk.doctrines?.fillLoc();
      }
      if (tipFor) showTip(tipFor);
      break;
    case "targets":
      targetFiles.track = message.track;
      targetFiles.perks = message.perks;
      paintTargets();
      break;
    case "perkEffect": {
      const perk = templateFor;
      templateFor = null;
      if (!perk) break;
      const block = message.block ? parseDefBlock(message.block) : null;
      const effect = block ? valueOf(block, EFFECT_KEY) : null;
      if (effect === null) {
        toast(`${message.name} has no ${EFFECT_KEY} block to copy.`);
        break;
      }
      perk.effect?.useBlock(effect);
      paintTile(perk);
      refreshScript();
      break;
    }
    case "saved": {
      adoptSaved(message.trackFile, message.perksFile);
      dropped = [];
      const open = openAfterSave;
      openAfterSave = null;
      if (open) send({ type: "openFile", name: open.name, which: open.which });
      break;
    }
    case "toast":
      toast(message.message, message.variant);
      break;
  }
});

send({ type: "ready" });
