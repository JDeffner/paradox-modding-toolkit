/**
 * The Dynasty Legacy Creator app: design a legacy track and the perks that
 * hang off it, and hand the host the blocks to write.
 *
 * The shape of the panel is the game's own: a track is a container and its
 * perks are the steps a dynasty unlocks in order (_dynasty_legacies.info,
 * "Dynasty Legacies are containers for perks"), so the perks are a horizontal
 * strip of cards read left to right and `legacy = <track>` is written for the
 * modder instead of being asked for.
 *
 * Nothing here knows a key name or a value list: which keys a legacy and a
 * perk may carry, what they mean, which traits exist and which modifiers exist
 * all arrive from `paradox/definitionForm`. What this file decides is which of
 * those keys gets a designed control and which falls through to the raw
 * fields, and every key reaches the modder either way (AD-5).
 */
import type { DefinitionForm, DefinitionFormKey, EventVocabularyItem } from "@px-lsp/protocol/protocol";
import { confirmDialog, menu, toast } from "../../shared/overlay";
import { helpDialog } from "../../shared/help";
import { installTips } from "../../shared/tips";
import { iconEl } from "../../shared/icons";
import {
  iconField,
  locField,
  modifierListField,
  scriptField,
  textField,
  titleCaseFromName,
  type Field,
  type ModifierRow,
} from "../../shared/fields";
import type { AppToHost, CreatorInit, HostToApp, LoadedPerk, SaveDefinition } from "../messages";
import { baseName } from "../../shared/scriptBlock";
import {
  applyValues,
  changedProperties,
  locKeyFor,
  modifierRows,
  newDefBlock,
  parseDefBlock,
  parseModifierBlock,
  perkNameFor,
  updateModifierRows,
  valueOf,
  wrapBlockValue,
  writeDefBlock,
  writeModifierBlock,
  type DefBlock,
  type FieldValue,
  type ModifierEntry,
} from "./script";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
installTips();

/** A definition key is a name the game reads; anything else is not writable. */
const NAME_RE = /^[a-z][a-z0-9_]*$/;

/**
 * The perk key that names its track. `_dynasty_perks.info`: "legacy = legacy_key
 * # What legacy does this belong to?". The panel writes it and never shows it:
 * a perk card only exists inside a track.
 */
const LEGACY_KEY = "legacy";

/** Keys a modifier-row control owns, in the harvest's own words. */
const MODIFIER_KEYS = ["character_modifier", "doctrine_character_modifier", "traits"];

let init: CreatorInit | null = null;
let trackForm: DefinitionForm | null = null;
let perkForm: DefinitionForm | null = null;
/** The track's block as the file has it, when one was loaded. */
let trackOriginal: DefBlock | null = null;
let trackSource: "mod" | "vanilla" | "parent" | null = null;
let trackFile: string | null = null;
let overrideMode = false;
let cards: PerkCard[] = [];
/** The key every prefilled name was derived from, so a rename can follow it. */
let derivedFrom = "";
/** Perks the modder took off a saved track; the host names the file that keeps them. */
let dropped: { name: string; file: string }[] = [];

// --- the track's own controls ------------------------------------------------
let trackLoc: { pattern: string; field: Field<string> }[] = [];
let trackIcon: Field<string> | null = null;
let iconDoc = "";
let trackScripts: Record<string, Field<string>> = {};
let trackOthers: Record<string, Field<string>> = {};

interface PerkCard {
  el: HTMLElement;
  nameInput: HTMLInputElement;
  original: DefBlock | null;
  source: "mod" | "vanilla" | "parent" | null;
  file: string | null;
  loc: { pattern: string; field: Field<string> }[];
  /** Modifier blocks keep the entries no row can hold, so they survive a save. */
  mods: Record<string, { entries: ModifierEntry[]; field: Field<ModifierRow[]> }>;
  scripts: Record<string, Field<string>>;
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
  const options = { label: spec.key, ...(spec.doc ? { doc: spec.doc } : {}), value };
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

function vocabulary(items: readonly EventVocabularyItem[]): { name: string; doc?: string }[] {
  return items.map((item) => ({ name: item.value, ...(item.doc ? { doc: item.doc } : {}) }));
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
  trackScripts = {};
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
      customLabel: "Convert an image…",
    });
    host.append(trackIcon.el);
  }

  const owned = ["is_shown"];
  const isShown = form.keys.find((k) => k.key === "is_shown");
  if (isShown) {
    const field = scriptField({
      label: isShown.key,
      ...(isShown.doc ? { doc: isShown.doc } : {}),
      value: valueOf(trackOriginal ?? newDefBlock(name), isShown.key) ?? "",
      rows: 4,
      placeholder: '{ has_dlc = "…" }',
    });
    trackScripts[isShown.key] = field;
    host.append(field.el);
  }

  const others = otherKeys(form, owned, trackOriginal);
  for (const spec of others) {
    const field = rawField(spec, valueOf(trackOriginal ?? newDefBlock(name), spec.key) ?? "");
    trackOthers[spec.key] = field;
    otherHost.append(field.el);
  }
  $("trackOther").hidden = others.length === 0;
  for (const { field } of trackLoc) field.onChange(refreshScript);
  for (const field of Object.values(trackScripts)) field.onChange(refreshScript);
  for (const field of Object.values(trackOthers)) field.onChange(refreshScript);
}

function trackBlock(): DefBlock {
  const form = trackForm!;
  const name = trackName() || "unnamed_legacy_track";
  const base = trackOriginal ? { ...trackOriginal, name } : newDefBlock(name);
  const values: FieldValue[] = [];
  for (const [key, field] of Object.entries(trackScripts)) {
    values.push({ key, value: wrapBlockValue(field.get()) });
  }
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

// ---------------------------------------------------------------------------
// The perk cards
// ---------------------------------------------------------------------------

function addCard(loaded?: LoadedPerk, loc: Record<string, string> = {}): PerkCard {
  const form = perkForm!;
  const original = loaded ? parseDefBlock(loaded.text) : null;
  const name = loaded?.name ?? perkNameFor(trackName() || "legacy", cards.length);
  const box = el("div", "perk");
  const header = el("header");
  const step = el("span", "step", String(cards.length + 1));
  const nameInput = document.createElement("input");
  nameInput.className = "px-input";
  nameInput.dataset.size = "sm";
  nameInput.spellcheck = false;
  nameInput.value = name;
  nameInput.dataset.tip = "The perk's key. Its loc key follows it.";
  const drop = document.createElement("button");
  drop.className = "px-btn";
  drop.dataset.variant = "ghost";
  drop.dataset.size = "icon-xs";
  drop.dataset.tip = "Remove this perk";
  drop.append(iconEl("trash"));
  header.append(step, nameInput, drop);
  box.append(header);

  const card: PerkCard = {
    el: box,
    nameInput,
    original,
    source: loaded?.source ?? null,
    file: loaded?.file ?? null,
    loc: [],
    mods: {},
    scripts: {},
    others: {},
  };

  for (const pattern of form.locPatterns) {
    const key = locKeyFor(pattern, name);
    const field = locField({
      label: "Name",
      key,
      value: loc[key] ?? titleCaseFromName(name),
      placeholder: "What the player sees",
    });
    card.loc.push({ pattern, field });
    box.append(field.el);
  }

  for (const key of MODIFIER_KEYS) {
    const spec = form.keys.find((k) => k.key === key);
    if (!spec) continue;
    const entries = parseModifierBlock(original ? (valueOf(original, key) ?? "") : "");
    const refKind = spec.refKinds?.[0];
    const items = refKind ? vocabulary(form.options[refKind] ?? []) : form.modifiers;
    const field = modifierListField({
      label: key,
      ...(spec.doc ? { doc: spec.doc } : {}),
      items,
      rows: modifierRows(entries),
      addLabel: refKind ? `Add ${refKind}` : "Add modifier",
    });
    card.mods[key] = { entries, field };
    box.append(field.el);
  }

  for (const key of ["effect", "can_be_picked", "ai_chance"]) {
    const spec = form.keys.find((k) => k.key === key);
    if (!spec) continue;
    const field = scriptField({
      label: key,
      ...(spec.doc ? { doc: spec.doc } : {}),
      value: original ? (valueOf(original, key) ?? "") : "",
      rows: 3,
      placeholder: "{ … }",
    });
    card.scripts[key] = field;
    box.append(field.el);
  }

  const owned = [LEGACY_KEY, ...MODIFIER_KEYS, "effect", "can_be_picked", "ai_chance"];
  const others = otherKeys(form, owned, original);
  if (others.length > 0) {
    const fold = document.createElement("details");
    const summary = el("summary", "note", "Other keys");
    fold.append(summary);
    for (const spec of others) {
      const field = rawField(spec, original ? (valueOf(original, spec.key) ?? "") : "");
      card.others[spec.key] = field;
      fold.append(field.el);
    }
    box.append(fold);
  }

  nameInput.addEventListener("change", () => {
    renameCard(card);
    refreshScript();
  });
  drop.onclick = () => void removeCard(card);
  for (const { field } of card.loc) field.onChange(refreshScript);
  for (const { field } of Object.values(card.mods)) field.onChange(refreshScript);
  for (const field of Object.values(card.scripts)) field.onChange(refreshScript);
  for (const field of Object.values(card.others)) field.onChange(refreshScript);

  cards.push(card);
  $("perks").append(box);
  return card;
}

/** The loc key follows the name, so a rename repaints the (read-only) keys. */
function renameCard(card: PerkCard): void {
  const name = card.nameInput.value.trim();
  card.loc.forEach(({ pattern, field }) => {
    const code = field.el.querySelector("code");
    if (code) code.textContent = locKeyFor(pattern, name);
  });
}

async function removeCard(card: PerkCard): Promise<void> {
  const name = card.nameInput.value.trim();
  if (card.source === "mod" && card.file) {
    const ok = await confirmDialog({
      title: `Remove ${name} from the track?`,
      description:
        "The card goes away and the perk stops being written. Its block stays in the file it already lives in: " +
        "the toolkit does not delete definitions for you. Delete it there if you want it gone from the game.",
      confirmLabel: "Remove from the track",
      destructive: true,
    });
    if (!ok) return;
    dropped.push({ name, file: card.file });
  }
  cards = cards.filter((c) => c !== card);
  card.el.remove();
  renumber();
  refreshScript();
}

function renumber(): void {
  cards.forEach((card, i) => {
    const step = card.el.querySelector(".step");
    if (step) step.textContent = String(i + 1);
  });
}

function perkBlock(card: PerkCard): DefBlock {
  const form = perkForm!;
  const name = card.nameInput.value.trim() || "unnamed_perk";
  const base = card.original ? { ...card.original, name } : newDefBlock(name);
  const values: FieldValue[] = [{ key: LEGACY_KEY, value: trackName() || "unnamed_legacy_track" }];
  for (const [key, mod] of Object.entries(card.mods)) {
    values.push({ key, value: writeModifierBlock(updateModifierRows(mod.entries, mod.field.get())) });
  }
  for (const [key, field] of Object.entries(card.scripts)) {
    values.push({ key, value: wrapBlockValue(field.get()) });
  }
  for (const [key, field] of Object.entries(card.others)) {
    const spec = form.keys.find((k) => k.key === key) ?? { key };
    values.push({ key, value: rawValue(spec, field) });
  }
  return applyValues(
    base,
    values,
    form.keys.map((k) => k.key)
  );
}

// ---------------------------------------------------------------------------
// Preview and save
// ---------------------------------------------------------------------------

function refreshScript(): void {
  if (!trackForm) return;
  const blocks = [trackBlock(), ...cards.map(perkBlock)].map(writeDefBlock);
  $("script").textContent = blocks.join("\n\n");
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
  const names = cards.map((c) => c.nameInput.value.trim());
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
  const perks = cards.map((card) =>
    definitionFor(
      perkBlock(card),
      card.original,
      card.source,
      card.file,
      locPairs(card.loc, card.nameInput.value.trim()),
      perkKeys
    )
  );
  const picked = trackIcon?.get() ?? "";
  send({
    type: "save",
    track,
    perks,
    dropped: dropped.slice(),
    icon: picked && picked !== name ? picked : null,
  });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function reset(loc: Record<string, string> = {}): void {
  cards = [];
  $("perks").replaceChildren();
  buildTrack(loc);
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
  $("target").textContent = payload.modLabel
    ? `${payload.modLabel} · ${payload.locLanguage}`
    : payload.locLanguage;
  const problem = $("problem");
  problem.hidden = payload.problem === null;
  problem.textContent = payload.problem ?? "";
  $<HTMLButtonElement>("save").disabled = payload.problem !== null;
  $("perkNote").textContent =
    payload.perksPerTrack === null
      ? "the game folder is not set, so the usual number of perks could not be read"
      : `vanilla tracks have ${payload.perksPerTrack} perks`;
  reset();
  const slots = payload.perksPerTrack ?? 1;
  for (let i = 0; i < slots; i++) addCard();
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
    customLabel: "Convert an image…",
  });
  previous.el.replaceWith(trackIcon.el);
}

function applyLoaded(track: DefinitionForm, perks: LoadedPerk[], loc: Record<string, string>): void {
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
  for (const perk of perks) addCard(perk, loc);
  refreshScript();
}

$<HTMLInputElement>("name").addEventListener("change", () => {
  // Everything the modder never has to type follows the track's key: a value
  // that is still the one derived from the OLD key follows the new one, and a
  // value they typed themselves is left alone.
  const name = trackName();
  const was = derivedFrom;
  derivedFrom = name;
  trackLoc.forEach(({ pattern, field }) => {
    const code = field.el.querySelector("code");
    if (code) code.textContent = locKeyFor(pattern, name);
    const derived = field.get().trim() === "" || field.get() === titleCaseFromName(was);
    if (pattern.endsWith("_name") && derived) field.set(titleCaseFromName(name));
  });
  cards.forEach((card, i) => {
    if (card.original || card.nameInput.value.trim() !== perkNameFor(was, i)) return;
    const previous = card.nameInput.value;
    card.nameInput.value = perkNameFor(name, i);
    renameCard(card);
    card.loc.forEach(({ field }) => {
      if (field.get().trim() === "" || field.get() === titleCaseFromName(previous)) {
        field.set(titleCaseFromName(card.nameInput.value));
      }
    });
  });
  refreshScript();
});

$("addPerk").onclick = () => {
  addCard();
  refreshScript();
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
  const existing = trackForm?.existing ?? [];
  if (existing.length === 0) {
    toast("This mod has no dynasty legacy track yet.");
    return;
  }
  menu(
    $("open"),
    existing.map((def) => ({ value: def.name, label: def.name })),
    { search: existing.length > 8, width: 280, onPick: (name) => send({ type: "load", name }) }
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
    paintMode();
  };
}

$("helpBtn").onclick = () =>
  helpDialog({
    title: "Dynasty Legacy Creator",
    intro:
      "A legacy track is a container; the perks are the steps a dynasty buys with prestige. This view designs both at once and writes them into your mod as a track file, a perk file and the localization that goes with them.",
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
            text: "The game builds the picture's path from the track's key, so picking one here copies that picture into your mod under your key. Converting an image does the same through the toolkit's DDS converter.",
          },
        ],
      },
      {
        title: "The perks",
        items: [
          {
            lead: "legacy = <track> is written for you",
            text: "on every card, because a perk only exists inside a track.",
          },
          {
            lead: "A modifier row",
            text: "is one line of a modifier block. Lines a row cannot hold, such as a block's own loc name or a doctrine, are kept exactly where they were.",
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
    case "saved":
      dropped = [];
      break;
    case "toast":
      toast(message.message, message.variant);
      break;
  }
});

send({ type: "ready" });
