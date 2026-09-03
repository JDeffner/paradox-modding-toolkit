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
import { helpDialog } from "../../shared/help";
import { installTips } from "../../shared/tips";
import { iconEl } from "../../shared/icons";
import { sidePanel } from "../../shared/sidePanel";
import { modifierLine, renderModifierLine } from "../../shared/modifierLines";
import { saveTargetLine } from "../../shared/saveTarget";
import { scriptSection } from "../../shared/scriptSection";
import {
  iconField,
  locField,
  refField,
  scriptField,
  textField,
  titleCaseFromName,
  type Field,
  type ModifierRow,
} from "../../shared/fields";
import { chanceField, conditionField, effectField, type BlockField, type EffectField } from "./builders";
import type { AppToHost, CreatorInit, HostToApp, LoadedPerk, SaveDefinition } from "../messages";
import { baseName } from "../../shared/scriptBlock";
import { rowsField } from "./rowsField";
import {
  applyValues,
  changedProperties,
  doctrineOf,
  effectLocKey,
  locKeyFor,
  modifierRows,
  newDefBlock,
  parseDefBlock,
  parseModifierBlock,
  perkNameFor,
  updateModifierRows,
  valueOf,
  withDoctrine,
  wrapBlockValue,
  writeDefBlock,
  writeModifierBlock,
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
/** The track picture and the two textures it is drawn through, at row size. */
const ART_DIM = 192;

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
let iconDoc = "";
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
  /** The `doctrine =` line of doctrine_character_modifier, as its own picker. */
  doctrine: Field<string> | null;
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

/** A raw control for a key with no designed widget: a block gets a text area. */
function rawField(spec: DefinitionFormKey, value: string): Field<string> {
  const options = {
    label: spec.key,
    ...(spec.doc ? { doc: spec.doc } : {}),
    ...(spec.example ? { placeholder: spec.example } : {}),
    value,
  };
  return spec.values === "block" || value.startsWith("{")
    ? scriptField({ ...options, rows: 3, placeholder: "{ … }" })
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
// The track section
// ---------------------------------------------------------------------------

function buildTrack(loc: Record<string, string>): void {
  const form = trackForm!;
  const host = $("trackFields");
  const otherHost = $("trackOtherFields");
  host.replaceChildren();
  otherHost.replaceChildren();
  trackLoc = [];
  trackShown = null;
  trackOthers = {};

  const name = trackName();
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
    host.append(field.el);
  }

  if (form.iconFolder) {
    iconDoc =
      `The game reads ${form.iconFolder}/<track key>.dds and there is no icon path to write into the block, ` +
      `so picking a picture here copies it into your mod under your track's key.`;
    trackIcon = iconField({
      label: "Icon",
      doc: iconDoc,
      items: init!.icons,
      value: init!.icons.some((i) => i.key === name) ? name : "",
      onCustom: () => send({ type: "customIcon", track: trackName() }),
      customLabel: "Custom picture…",
    });
    trackIcon.onChange(paintRow);
    host.append(trackIcon.el);
  }

  const owned = [SHOWN_KEY];
  const isShown = form.keys.find((k) => k.key === SHOWN_KEY);
  if (isShown) {
    trackShown = conditionField({
      label: isShown.key,
      ...(isShown.doc ? { doc: isShown.doc } : {}),
      conditions: form.conditions ?? {},
      value: valueOf(trackOriginal ?? newDefBlock(name), isShown.key) ?? "",
      placeholder: EXAMPLE.isShown,
    });
    trackShown.onChange(refreshScript);
    host.append(trackShown.el);
  }

  const others = otherKeys(form, owned, trackOriginal);
  for (const spec of others) {
    const field = rawField(spec, valueOf(trackOriginal ?? newDefBlock(name), spec.key) ?? "");
    trackOthers[spec.key] = field;
    otherHost.append(field.el);
  }
  $("trackOther").hidden = others.length === 0;
  for (const { field } of trackLoc) {
    field.onChange(() => {
      paintRow();
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

/** The row's own words and picture: the header fields, as the game shows them. */
function paintRow(): void {
  const name = trackName();
  const words = trackLoc.map(({ pattern, field }) => ({ pattern, value: field.get().trim() }));
  $("rowName").textContent =
    words.find((w) => w.pattern.endsWith("_name"))?.value || titleCaseFromName(name) || "Your track";
  $("rowDesc").textContent = words.find((w) => !w.pattern.endsWith("_name"))?.value ?? "";

  const art = $("trackArt");
  const picked = trackIcon?.get() || (init?.icons.some((i) => i.key === name) ? name : "");
  const url = init?.icons.find((i) => i.key === picked)?.url;
  const frame = imageUrl(TRACK_FRAME);
  const mask = imageUrl(TRACK_MASK);
  art.replaceChildren();
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = picked;
    art.append(img);
  } else {
    art.append(iconEl("image"));
  }
  if (url && frame && mask) {
    art.dataset.masked = "";
    art.style.setProperty("--frame", `url("${frame}")`);
    art.style.setProperty("--mask", `url("${mask}")`);
  } else {
    art.removeAttribute("data-masked");
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

function addPerk(loaded?: LoadedPerk, loc: Record<string, string> = {}): Perk {
  const form = perkForm!;
  const original = loaded ? parseDefBlock(loaded.text) : null;
  const name = loaded?.name ?? perkNameFor(trackName() || "legacy", perks.length);

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
  const key = textField({
    label: "Key",
    doc: "The perk's key. Its loc key and its default name follow it.",
    value: name,
    placeholder: perkNameFor(trackName() || "legacy", perks.length),
  });
  editor.append(key.el);

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
    doctrine: null,
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
    editor.append(field.el);
  }

  const modBlock = (blockKey: string): void => {
    const spec = form.keys.find((k) => k.key === blockKey);
    if (!spec) return;
    const entries = parseModifierBlock(original ? (valueOf(original, blockKey) ?? "") : "");
    const field = rowsField({
      label: blockKey,
      ...(spec.doc ? { doc: spec.doc } : {}),
      items: (form.modifiers ?? []).map((mod) => ({
        value: mod.name,
        ...(mod.doc ? { doc: mod.doc } : {}),
      })),
      rows: modifierRows(entries),
      addLabel: "Add modifier",
      pickLabel: "pick a modifier",
      step: 0.1,
      preview: (row) => gameLine(row.name, row.value),
    });
    perk.mods[blockKey] = { entries, field };
    editor.append(field.el);
  };

  modBlock(CHAR_MOD);

  // The doctrine block's condition is a key inside it, so it gets its own
  // picker above the modifiers it applies with.
  const doctrineSpec = form.keys.find((k) => k.key === DOCTRINE_MOD);
  if (doctrineSpec) {
    const entries = parseModifierBlock(original ? (valueOf(original, DOCTRINE_MOD) ?? "") : "");
    const inner = form.blocks?.[DOCTRINE_MOD]?.find((k) => k.key === "doctrine");
    const kind = inner?.refKinds?.[0] ?? "doctrine";
    const options = form.options[kind] ?? [];
    const value = doctrineOf(entries);
    perk.doctrine =
      options.length > 0
        ? refField({
            label: "doctrine",
            ...(inner?.doc ? { doc: inner.doc } : {}),
            items: refItems(kind),
            value,
            thumb: (v) => imageUrl(refImage(kind, v)),
          })
        : textField({
            label: "doctrine",
            ...(inner?.doc ? { doc: inner.doc } : {}),
            value,
            ...(inner?.sampled?.length ? { suggestions: inner.sampled } : {}),
            ...(inner?.example ? { placeholder: inner.example } : {}),
          });
    editor.append(perk.doctrine.el);
    modBlock(DOCTRINE_MOD);
  }

  const traitsSpec = form.keys.find((k) => k.key === TRAITS_KEY);
  if (traitsSpec) {
    const entries = parseModifierBlock(original ? (valueOf(original, TRAITS_KEY) ?? "") : "");
    const kind = traitsSpec.refKinds?.[0] ?? TRAIT_KEY;
    const field = rowsField({
      label: TRAITS_KEY,
      ...(traitsSpec.doc ? { doc: traitsSpec.doc } : {}),
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
    editor.append(field.el);
  }

  // The three blocks with a builder. Each is drawn only when the harvest says
  // the kind has the key, and each keeps the whole block as script when the
  // builder cannot show it (app/builders.ts).
  const blockValue = (key: string): string => (original ? (valueOf(original, key) ?? "") : "");
  const docOf = (key: string): { doc?: string } => {
    const doc = form.keys.find((k) => k.key === key)?.doc;
    return doc ? { doc } : {};
  };
  const has = (key: string): boolean => form.keys.some((k) => k.key === key);
  const addBlock = (key: string, field: BlockField): void => {
    perk.blocks[key] = field;
    editor.append(field.el);
  };

  if (has(PICKED_KEY)) {
    addBlock(
      PICKED_KEY,
      conditionField({
        label: PICKED_KEY,
        ...docOf(PICKED_KEY),
        conditions: form.conditions ?? {},
        value: blockValue(PICKED_KEY),
        placeholder: EXAMPLE.canBePicked,
      })
    );
  }
  if (has(EFFECT_KEY)) {
    perk.effect = effectField({
      label: EFFECT_KEY,
      ...docOf(EFFECT_KEY),
      value: blockValue(EFFECT_KEY),
      name,
      placeholder: EXAMPLE.effect,
      locOf: (key) => locValues.get(key),
      onTemplate: (anchor) => pickTemplate(perk, anchor),
    });
    addBlock(EFFECT_KEY, perk.effect);
    askLoc(perk.effect.keys());
  }
  if (has(CHANCE_KEY)) {
    addBlock(
      CHANCE_KEY,
      chanceField({
        label: CHANCE_KEY,
        ...docOf(CHANCE_KEY),
        value: blockValue(CHANCE_KEY),
        placeholder: EXAMPLE.chance,
      })
    );
  }

  const owned = [LEGACY_KEY, CHAR_MOD, DOCTRINE_MOD, TRAITS_KEY, ...BUILT_KEYS];
  const others = otherKeys(form, owned, original);
  if (others.length > 0) {
    const fold = document.createElement("details");
    fold.append(el("summary", "note", "Other keys"));
    for (const spec of others) {
      const field = rawField(spec, original ? (valueOf(original, spec.key) ?? "") : "");
      perk.others[spec.key] = field;
      fold.append(field.el);
    }
    editor.append(fold);
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
  perk.doctrine?.onChange(touched);
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
  $("perks").insertBefore(tile, addTile);
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
  // the one derived from the old name.
  perk.effect?.rename(was, name);
  askLoc(perk.effect?.keys() ?? []);
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
  if (selected) $("sideTitle").textContent = `Perk ${perks.indexOf(selected) + 1}`;
}

function perkBlock(perk: Perk): DefBlock {
  const form = perkForm!;
  const name = perkName(perk) || "unnamed_perk";
  const base = perk.original ? { ...perk.original, name } : newDefBlock(name);
  const values: FieldValue[] = [{ key: LEGACY_KEY, value: trackName() || "unnamed_legacy_track" }];
  for (const [blockKey, mod] of Object.entries(perk.mods)) {
    let entries = updateModifierRows(mod.entries, mod.field.get());
    if (blockKey === DOCTRINE_MOD && perk.doctrine) entries = withDoctrine(entries, perk.doctrine.get());
    values.push({ key: blockKey, value: writeModifierBlock(entries) });
  }
  for (const [blockKey, field] of Object.entries(perk.blocks)) {
    values.push({ key: blockKey, value: field.get() });
  }
  for (const [otherKey, field] of Object.entries(perk.others)) {
    const spec = form.keys.find((k) => k.key === otherKey) ?? { key: otherKey };
    values.push({ key: otherKey, value: rawValue(spec, field) });
  }
  return applyValues(
    base,
    values,
    form.keys.map((k) => k.key)
  );
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

  for (const blockKey of [CHAR_MOD, DOCTRINE_MOD]) {
    for (const row of perk.mods[blockKey]?.field.get() ?? []) {
      const line = gameLine(row.name, row.value);
      if (line) box.append(line);
    }
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
const side = sidePanel($("side"), {
  ...(saved.width ? { width: saved.width } : {}),
  collapsed: true,
  onChange: ({ width }) => vscode.setState({ width }),
});

function selectPerk(perk: Perk | null): void {
  selected = perk;
  for (const other of perks) other.tile.setAttribute("aria-selected", String(other === perk));
  const host = $("perkEditor");
  host.replaceChildren();
  if (!perk) {
    side.toggle(true);
    return;
  }
  $("sideTitle").textContent = `Perk ${perks.indexOf(perk) + 1}`;
  host.append(perk.editor);
  side.toggle(false);
}

$("closeSide").onclick = () => selectPerk(null);

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
      list.insertBefore(tile, others[index]?.tile ?? addTile);
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

/** The two files a save writes, shown from the moment the form loads. */
const targets = {
  track: saveTargetLine(() => send({ type: "changeTarget", which: "track" })),
  perks: saveTargetLine(() => send({ type: "changeTarget", which: "perks" })),
};
targets.track.set(null);
targets.perks.set(null);
$("targets").append(targets.track.el, targets.perks.el);

/** What the mod's two files will contain, as a section of the form. */
const script = scriptSection({
  note: "The track goes into one file and its perks into another; the save target lines say which.",
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
  keys: readonly string[]
): SaveDefinition {
  // A renamed definition is a new one: there is no `<new name> = { … }` in the
  // file to set properties on, so the whole block has to be written.
  const renamed = original !== null && original.name !== block.name;
  const mode = renamed ? "create" : modeFor(source);
  const changed =
    mode === "edit" && original
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

function save(): void {
  if (!trackForm || !perkForm) return;
  const name = trackName();
  if (!NAME_RE.test(name)) {
    toast("The track needs a key: lowercase letters, digits and _, starting with a letter.", "destructive");
    return;
  }
  if (trackSource !== null && trackSource !== "mod" && !overrideMode && name === trackOriginal?.name) {
    toast(`Duplicating ${name} needs a key of its own. Change it, or switch to Override.`, "destructive");
    return;
  }
  const names = perks.map(perkName);
  const bad = names.find((n) => !NAME_RE.test(n));
  if (bad !== undefined) {
    toast(`"${bad}" is not a usable perk key: lowercase letters, digits and _.`, "destructive");
    return;
  }
  if (new Set(names).size !== names.length) {
    toast("Two perks share a key. Each perk needs its own.", "destructive");
    return;
  }

  const trackKeys = trackForm.keys.map((k) => k.key);
  const perkKeys = perkForm.keys.map((k) => k.key);
  const track = definitionFor(
    trackBlock(),
    trackOriginal,
    trackSource,
    trackFile,
    locPairs(trackLoc, name),
    trackKeys
  );
  const written = perks.map((perk) =>
    definitionFor(
      perkBlock(perk),
      perk.original,
      perk.source,
      perk.file,
      // The tooltip lines of the effect builder are loc too: the block writes
      // the key and the sentence has to exist for the player to read it.
      [...locPairs(perk.loc, perkName(perk)), ...(perk.effect?.loc() ?? [])],
      perkKeys
    )
  );
  const picked = trackIcon?.get() ?? "";
  send({
    type: "save",
    track,
    perks: written,
    dropped: dropped.slice(),
    icon: picked && picked !== name ? picked : null,
  });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/** The ghost tile that ends the row: the only way a track grows a perk. */
const addTile = el("div", "perktile");
addTile.dataset.add = "";
addTile.tabIndex = 0;
addTile.setAttribute("role", "button");
addTile.dataset.tip = "Add a perk to the end of the track";
addTile.append(iconEl("plus"), el("span", "", "Add perk"));
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
  $("perks").replaceChildren(addTile);
  buildTrack(loc);
  paintRow();
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
  // The mod is named on the two save-target lines; this says which language
  // the loc lands in, which no target line can.
  $("locLang").textContent = payload.locLanguage;
  const problem = $("problem");
  problem.hidden = payload.problem === null;
  problem.textContent = payload.problem ?? "";
  $<HTMLButtonElement>("save").disabled = payload.problem !== null;
  $("perkNote").textContent =
    payload.perksPerTrack === null
      ? "(the game folder is not set, so the usual number of perks could not be read)"
      : `(vanilla tracks have ${payload.perksPerTrack} perks)`;
  askImages([TRACK_FRAME, TRACK_MASK], ART_DIM);
  reset();
  const slots = payload.perksPerTrack ?? 1;
  for (let i = 0; i < slots; i++) addPerk();
  refreshScript();
}

/** Swap the icon control for one over the folder as it now stands. */
function rebuildIcon(select?: string): void {
  if (!trackIcon || !init) return;
  const previous = trackIcon;
  const value = select ?? previous.get();
  trackIcon = iconField({
    label: "Icon",
    doc: iconDoc,
    items: init.icons,
    value,
    onCustom: () => send({ type: "customIcon", track: trackName() }),
    customLabel: "Custom picture…",
  });
  trackIcon.onChange(paintRow);
  previous.el.replaceWith(trackIcon.el);
  paintRow();
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
  paintRow();
  refreshScript();
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
  paintRow();
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

$("save").onclick = save;

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
            lead: "The icon is not a script key.",
            text: "The game builds the picture's path from the track's key, so picking one here copies that picture into your mod under your key. A custom picture goes through the toolkit's DDS converter.",
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
            text: "to edit that perk on the right. Drag a tile to move it along the track; the numbers follow.",
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
            lead: "Two files, two steps:",
            text: "you pick where the track goes and where the perks go. A file name the game itself uses is refused, because a mod file of that name replaces the whole game file.",
          },
          {
            lead: "Editing a track your mod already has",
            text: "rewrites only the lines that changed. Everything else in the file, comments included, stays byte for byte as it was.",
          },
        ],
      },
    ],
  });

enableTileDrag($("perks"));

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
      if (init) init.icons = message.icons;
      rebuildIcon(message.select);
      break;
    case "images":
      for (const [key, url] of Object.entries(message.urls)) images.set(key, url);
      paintRow();
      if (tipFor) showTip(tipFor);
      break;
    case "locValues":
      for (const [key, value] of Object.entries(message.values)) locValues.set(key, value);
      // A tooltip line the modder has not typed shows the sentence the
      // workspace already has for its key.
      for (const perk of perks) perk.effect?.fillLoc();
      if (tipFor) showTip(tipFor);
      break;
    case "targets":
      targets.track.set(message.track);
      targets.perks.set(message.perks);
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
    case "saved":
      dropped = [];
      break;
    case "toast":
      toast(message.message, message.variant);
      break;
  }
});

send({ type: "ready" });
