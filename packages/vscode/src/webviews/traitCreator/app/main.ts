/**
 * The Trait Creator's app: a form over one trait definition, next to the
 * tooltip the game will draw for it.
 *
 * Nothing in the layout knows a trait key. `paradox/definitionForm` answers
 * what a trait may contain (60 documented keys with the game's own one-line
 * docs, the loc key patterns, the icon folder, the trait list, the modifier
 * vocabulary, the values the game itself writes for each key), traitModel.ts
 * places those keys into sections, and this file builds the widget each one
 * asked for. A key the game adds shows up under "Advanced" without a code
 * change, and no key is ever hidden (AD-5).
 *
 * Two rules the layout follows. Every list a modder picks from is a picker
 * over what the game HAS, never a text box; and every empty input shows the
 * literal the game writes most often for that key (`DefinitionFormKey.example`)
 * as its placeholder, so no field says only "not set".
 *
 * The block a save writes is not a re-serialization of the form: script.ts
 * keeps the file's own text for everything the modder did not touch, so
 * opening a vanilla trait and saving it back is a zero-line diff.
 *
 * Browser code: no vscode, no file system, no server. It asks the host.
 */
import type { DefinitionForm, EventVocabularyItem, ModifierFormat } from "@px-lsp/protocol/protocol";
import {
  boolField,
  iconField,
  locField,
  multiRefField,
  textField,
  titleCaseFromName,
  type Field,
  type IconChoice,
  type ModifierRow,
  keyLabel,
} from "../../shared/fields";
import { helpDialog } from "../../shared/help";
import { iconEl } from "../../shared/icons";
import { modifierLine, renderModifierLine } from "../../shared/modifierLines";
import { menu, toast, confirmDialog, type MenuItem } from "../../shared/overlay";
import { scriptSection } from "../../shared/scriptSection";
import { saveTargetLine } from "../../shared/saveTarget";
import { scrubbable } from "../../shared/scrub";
import { sidePanel } from "../../shared/sidePanel";
import { installTips } from "../../shared/tips";
import type { AppToHost, HostToApp, SaveMode, TraitCreatorInit } from "../messages";
import { baseName, writeBlock } from "../../shared/scriptBlock";
import {
  fillTraitLoc,
  frameTexture,
  plainLoc,
  renderTraitTip,
  type PreviewFact,
  type PreviewModifier,
  type PreviewOpinion,
  type PreviewTrait,
} from "./preview";
import {
  emptyState,
  fieldLines,
  fieldStatements,
  loadTrait,
  locKeys,
  nameProblem,
  readTriggeredOpinions,
  traitFieldSpecs,
  traitWrites,
  TRIGGERED_OPINION_KEY,
  type FieldValue,
  type LoadedTrait,
  type SectionId,
  type TraitFieldSpec,
  type TraitState,
} from "./traitModel";

/** What the panel remembers between openings; the host keeps it for us. */
interface AppState {
  sideWidth?: number;
  sideHidden?: boolean;
}

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState?(): AppState | undefined;
  setState?(state: AppState): void;
};
const vscode = acquireVsCodeApi();
const post = (message: AppToHost): void => vscode.postMessage(message);

const SECTIONS: { id: SectionId; title: string; lede?: string; open: boolean }[] = [
  { id: "identity", title: "Identity", lede: "What the player reads and sees.", open: true },
  { id: "skills", title: "Skills", lede: "What holding the trait adds to a character.", open: true },
  { id: "opinions", title: "Opinions", open: true },
  { id: "relations", title: "Relations", open: true },
  {
    id: "advanced",
    title: "Advanced",
    lede: "Every remaining key the game documents for a trait.",
    open: false,
  },
];

/** The Modifiers section is not a key list, so it is placed by hand. */
const MODIFIERS_AFTER: SectionId = "opinions";

const HELP = {
  title: "Trait Creator",
  intro:
    "Design a trait as a form, watch the game's own tooltip for it on the right, and write it into " +
    "your mod as script, localization and an icon. Every field, its documentation and every list you " +
    "can pick from come from your game files, not from a list built into the toolkit.",
  sections: [
    {
      title: "Making one",
      items: [
        { lead: "Name it.", text: "Everything else has a default, so a new trait saves with just a name." },
        {
          lead: "The preview is the game.",
          text: "The panel on the right prints the trait the way the game's tooltip does, with each modifier's own word, sign, decimals and color read out of the game's modifier format files.",
        },
        {
          lead: "Identity.",
          text: "The two loc values are written into your mod's localization; the icon grid lists the game's own trait icons, and Custom picture takes any image format, asks which folder of your mod it goes into, and writes the DDS under the trait's name.",
        },
        {
          lead: "Modifiers.",
          text: "A trait's unknown properties are modifiers, so anything the game's modifier list knows can be added as a row.",
        },
      ],
    },
    {
      title: "Editing one that exists",
      items: [
        {
          lead: "Open.",
          text: "The folder button loads a trait of your mod, or any trait the game has.",
        },
        {
          lead: "A game trait.",
          text: "Duplicate makes your own copy under a new name. Override writes the same key into your mod, which replaces the game's whole trait and stops it receiving patch changes.",
        },
        {
          lead: "Nothing else moves.",
          text: "A key no ordinary field can stand for (a dynamic desc, a block written several times) opens as script boxes holding the file's own text, one per statement, and everything you do not touch is written back byte for byte.",
        },
        {
          lead: "A duplicate is the game's own text.",
          text: "Where that text used @values defined at the top of the game's file, copy those into your file too. ck3-tiger names each one after the save.",
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let init: TraitCreatorInit | null = null;
let form: DefinitionForm | null = null;
let specs: TraitFieldSpec[] = [];
let state: TraitState = { values: {}, modifiers: [] };
/** What the file said when it was loaded; null for a brand-new trait. */
let baseline: TraitState | null = null;
let loaded: LoadedTrait | null = null;
let mode: SaveMode = "create";
const fields = new Map<string, Field<FieldValue>>();
let locFields: { key: string; field: Field<string> }[] = [];
/** How the game prints each modifier; undefined until the host answers. */
let formats: Record<string, ModifierFormat> | undefined;
/** Icon thumbnails, filled as the host answers; the picker reads it live. */
const iconItems: IconChoice[] = [];
const iconAsked = new Set<string>();
/** Texture path -> URL, for the texticons of a modifier line. */
const textureUrls = new Map<string, string | null>();
const textureAsked = new Set<string>();
/** Flag name -> the player's word for it, when the loc index had one. */
const flagLoc = new Map<string, string>();
const flagAsked = new Set<string>();
/** Any loc key the preview asked for -> the game's value. */
const locText = new Map<string, string>();
const locAsked = new Set<string>();

/**
 * The loc entry the game's trait tooltip prints each opinion key through, from
 * `localization/english/custom_localization/character_relations_l_english.yml`
 * (`TRAIT_OPINION_SAME_TRAIT` = "Opinion of [TRAIT.GetName( GetNullCharacter )]
 * Characters", and its three neighbours). A key with no entry of its own falls
 * back to its own name made readable, the way a modifier line does.
 */
const OPINION_LOC: Record<string, string> = {
  same_opinion: "TRAIT_OPINION_SAME_TRAIT",
  same_opinion_if_same_faith: "TRAIT_OPINION_SAME_TRAIT_AND_SAME_FAITH",
  opposite_opinion: "TRAIT_OPINION_OPPOSITE_TRAIT",
  attraction_opinion: "TRAIT_OPINION_ATTRACTION",
};

/**
 * How the game prints one `compatibility` row: `core_l_english.yml`,
 * "$TRAIT$ likes $OTHER_TRAIT$: $VALUE|=+0$" and its dislikes twin.
 */
const COMPATIBILITY_LOC = { likes: "TRAIT_COMPATIBILITY_LIKES", dislikes: "TRAIT_COMPATIBILITY_DISLIKES" };

/**
 * The three keys of `_traits.info`'s "Loc/icon" section: they ARE the tooltip's
 * words and picture, so the hidden group does not repeat them as rules.
 */
const TOOLTIP_KEYS = new Set(["name", "desc", "icon"]);

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const nameInput = byId<HTMLInputElement>("name");
const sourceBadge = byId("source");
const modeButton = byId<HTMLButtonElement>("mode");
const saveButton = byId<HTMLButtonElement>("save");
const revealButton = byId<HTMLButtonElement>("reveal");
const sectionsBox = byId("sections");
const problemBox = byId("problem");
const tipBox = byId("tip");
const previewButton = byId<HTMLButtonElement>("togglePreview");

/** Where the next save lands, shown from the moment the form loads. */
const target = saveTargetLine(() => post({ type: "changeTarget" }));
target.set(null);
byId("target").append(target.el);

/** The block a save will write, as a section of the preview panel. */
const script = scriptSection({
  note: "This is what your mod file will contain.",
  onCopy: (text) => post({ type: "copy", text }),
});
byId("scriptSlot").replaceWith(script.el);
byId("scriptCopy").replaceWith(script.copyButton);

/** The name field's own tip, restored when a typed name stops being wrong. */
const NAME_TIP = nameInput.dataset.tip ?? "";

const side = sidePanel(byId("side"), {
  width: vscode.getState?.()?.sideWidth ?? 340,
  collapsed: vscode.getState?.()?.sideHidden ?? false,
  onChange: ({ width, collapsed }) =>
    vscode.setState?.({ ...vscode.getState?.(), sideWidth: width, sideHidden: collapsed }),
});

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function node(tag: string, cls = "", text?: string): HTMLElement {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (text !== undefined) element.textContent = text;
  return element;
}

function ghostButton(label: string, glyph: Parameters<typeof iconEl>[0]): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "px-btn";
  button.dataset.variant = "ghost";
  button.dataset.size = "xs";
  button.append(iconEl(glyph), document.createTextNode(label));
  return button;
}

/** The outline button that opens a `menu()`; never a native `<select>`. */
function dropdown(value: string, placeholder: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "px-btn px-dropdown";
  button.dataset.variant = "outline";
  button.dataset.size = "sm";
  button.append(node("span", "px-truncate"), iconEl("chevronDown"));
  paintDropdown(button, value, placeholder);
  return button;
}

function paintDropdown(button: HTMLButtonElement, value: string, placeholder: string): void {
  const face = button.firstElementChild as HTMLElement;
  face.textContent = value || placeholder;
  if (value) button.removeAttribute("data-placeholder");
  else button.dataset.placeholder = "";
}

/**
 * A number input that commits on change. It scrubs (px-ui rule 5) by its
 * `handle`: the label or caption the number is drawn under, so typing in the
 * box never moves the value. A row with no name of its own (a modifier row's
 * value) passes nothing and drags on the input itself.
 */
function numberInput(
  value: number | null,
  placeholder: string,
  commit: (v: number | null) => void,
  handle?: HTMLElement
) {
  const input = document.createElement("input");
  input.className = "px-input";
  input.dataset.size = "sm";
  input.type = "number";
  input.step = "1";
  input.placeholder = placeholder;
  input.value = value === null ? "" : String(value);
  const read = (): number | null => (input.value.trim() === "" ? null : Number(input.value));
  input.addEventListener("change", () => commit(read()));
  scrubbable(input, {
    step: 1,
    ...(handle ? { handle } : {}),
    onChange: () => undefined,
    onCommit: () => commit(read()),
  });
  return input;
}

// ---------------------------------------------------------------------------
// Building the form
// ---------------------------------------------------------------------------

/**
 * What an empty input shows. The example is the literal the indexed traits
 * write most often for the key; a key with none but a sampled value set shows
 * the most used of those. Only a key the game never writes falls through with
 * no placeholder at all.
 */
function placeholderFor(spec: TraitFieldSpec): string | undefined {
  return spec.example ?? spec.sampled?.[0];
}

/**
 * What the game expects of a trait's picture, behind the (i) on the icon row.
 *
 * Measured in game/gfx/interface/icons/traits: 375 of its 409 .dds files are
 * exactly 120 x 120, and every one of them is 32-bit with an alpha channel.
 * The frame under the icon shares that canvas (preview.ts), and the tooltip
 * draws the pair at 52 x 52 (gui/shared/cooltip.gui). The folder is the form's,
 * never spelled here.
 */
function iconInfo(): string {
  const folder = form?.iconFolder ?? "the game's trait icon folder";
  return (
    "120 x 120 pixels: the size 375 of the game's 409 trait icons are, measured. " +
    "Transparency matters. The category frame is drawn under the icon on the same canvas, " +
    "so everything around the emblem has to be see-through. " +
    "Custom picture… takes PNG, JPEG, WebP, GIF, BMP, TGA or DDS and writes the DDS for you. " +
    `The game reads ${folder}/<the trait's key>.dds and the tooltip draws it at 52 x 52.`
  );
}

function optionsFor(spec: TraitFieldSpec): EventVocabularyItem[] {
  return spec.refKind ? (form?.options[spec.refKind] ?? []) : [];
}

/** The decoded picture of a trait's own icon, by the name the game derives. */
function traitThumb(name: string): string | null {
  return iconItems.find((item) => item.key === `${name}.dds`)?.url ?? null;
}

/**
 * The loc key a trait flag is read under. `_traits.info` documents it inside
 * the key's own doc line ("localized as TRAIT_FLAG_DESC_name"), so the prefix
 * is read out of the harvest rather than written here.
 */
function flagLocPrefix(): string | null {
  const doc = specs.find((spec) => spec.key === "flag")?.doc ?? "";
  return /localized as ([A-Za-z_]+?)name\b/.exec(doc)?.[1] ?? null;
}

/** Resolve loc keys the preview prints through; each is asked for once. */
function askForLoc(keys: readonly string[]): void {
  const fresh = keys.filter((key) => key !== "" && !locAsked.has(key));
  if (fresh.length === 0) return;
  for (const key of fresh) locAsked.add(key);
  post({ type: "loc", keys: fresh });
}

function askForFlagLoc(names: readonly string[]): void {
  const prefix = flagLocPrefix();
  if (!prefix) return;
  const fresh = names.filter((name) => name !== "" && !flagAsked.has(name));
  if (fresh.length === 0) return;
  for (const name of fresh) flagAsked.add(name);
  post({ type: "loc", keys: fresh.map((name) => `${prefix}${name}`) });
}

function buildField(spec: TraitFieldSpec): Field<FieldValue> {
  const label = spec.key;
  const placeholder = placeholderFor(spec);
  const shared = {
    label,
    ...(spec.doc ? { doc: spec.doc } : {}),
    ...(placeholder ? { placeholder } : {}),
  };
  const value = state.values[spec.key];
  switch (spec.widget) {
    case "number":
      return numberField(spec, value as number | null) as Field<FieldValue>;
    case "bool":
      return boolField({
        ...shared,
        // A tri-state has no placeholder slot, so the value the game itself
        // writes for the key rides in the label's own tip instead.
        ...(placeholder
          ? { doc: `${spec.doc ? `${spec.doc} ` : ""}The game writes ${placeholder} here.` }
          : {}),
        value: value as boolean | null,
      }) as Field<FieldValue>;
    case "enum":
      return pickField(spec, String(value)) as Field<FieldValue>;
    case "multiRef":
      return multiRefField({
        ...shared,
        items: optionsFor(spec),
        values: value as string[],
        thumb: traitThumb,
        addLabel: "Add trait",
      }) as Field<FieldValue>;
    case "refRows":
      return traitRowsField(spec, value as ModifierRow[]) as Field<FieldValue>;
    case "chips":
      return flagsField(spec, value as string[]) as Field<FieldValue>;
    case "icon":
      return iconField({
        ...shared,
        info: iconInfo(),
        items: iconItems,
        value: String(value),
        onCustom: () => post({ type: "convertIcon", name: nameInput.value.trim() }),
      }) as Field<FieldValue>;
    case "script":
      return scriptListField(spec, value as string[]) as Field<FieldValue>;
    default:
      return textField({
        ...shared,
        value: String(value),
        // A key the game writes a small set of values for offers them behind
        // the chevron rather than leaving the modder to guess the spelling.
        ...(spec.sampled?.length ? { suggestions: spec.sampled } : {}),
      }) as Field<FieldValue>;
  }
}

/**
 * A key written as script, once or many times. The game reads a repeated key
 * as several statements (vanilla writes up to 7 `culture_modifier` and 7
 * `triggered_opinion` blocks in one trait, measured in 00_traits.txt), so this
 * is a LIST of script boxes rather than one: it is what lets every line of an
 * opened trait come back to a control instead of staying raw text.
 */
function scriptListField(spec: TraitFieldSpec, values: string[]): Field<string[]> {
  const listeners: ((v: string[]) => void)[] = [];
  // Always one box: an empty one writes nothing, and a key with no box would
  // be a row with nothing to type in.
  let current = values.length > 0 ? [...values] : [""];
  const placeholder = placeholderFor(spec) ?? "";
  const box = node("div", "px-stack");
  const list = node("div", "px-stack");
  const add = ghostButton("Add another", "plus");
  add.dataset.tip = "The game reads a key written twice as two statements.";
  const emit = (): void => listeners.forEach((fn) => fn([...current]));

  const paint = (): void => {
    list.replaceChildren();
    current.forEach((text, index) => {
      const row = node("div", "scriptrow");
      const area = document.createElement("textarea");
      area.className = "px-textarea px-mono";
      area.spellcheck = false;
      area.rows = Math.min(10, Math.max(3, text.split("\n").length));
      area.value = text;
      if (placeholder) area.placeholder = placeholder;
      area.setAttribute("aria-label", spec.key);
      area.addEventListener("change", () => {
        current[index] = area.value;
        emit();
      });
      area.addEventListener("keydown", (ev) => {
        if (ev.key !== "Tab" || ev.shiftKey) return;
        ev.preventDefault();
        const start = area.selectionStart;
        area.value = area.value.slice(0, start) + "\t" + area.value.slice(area.selectionEnd);
        area.selectionStart = area.selectionEnd = start + 1;
      });
      row.append(area);
      if (current.length > 1) {
        const drop = document.createElement("button");
        drop.className = "px-btn";
        drop.dataset.variant = "ghost";
        drop.dataset.size = "icon-xs";
        drop.dataset.tip = "Remove this statement";
        drop.append(iconEl("trash"));
        drop.onclick = () => {
          current.splice(index, 1);
          paint();
          emit();
        };
        row.append(drop);
      }
      list.append(row);
    });
  };

  add.onclick = () => {
    current.push("");
    paint();
    emit();
  };
  paint();
  add.style.alignSelf = "flex-start";
  box.append(list, add);
  return {
    el: fieldRow(spec, box),
    get: () => [...current],
    set: (next) => {
      current = next.length > 0 ? [...next] : [""];
      paint();
    },
    onChange: (listener) => listeners.push(listener),
  };
}

/**
 * One of a known list. Not the shared `enumField`, because this picker says two
 * different things with the two texts that widget shares: the trigger's face is
 * the EXAMPLE the game writes most often (dimmed, so it reads as a suggestion),
 * while the entry that clears the key reads "Not set".
 */
function pickField(spec: TraitFieldSpec, value: string): Field<string> {
  const listeners: ((v: string) => void)[] = [];
  const placeholder = placeholderFor(spec) ?? "not set";
  let current = value;
  const trigger = dropdown(current, placeholder);
  trigger.onclick = () => {
    // The file's own value stays pickable even when it is not one the game
    // writes anywhere else (AD-5: annotate, never hide).
    const values = [...(spec.values ?? [])];
    if (current && !values.includes(current)) values.push(current);
    menu(
      trigger,
      [
        { value: "", label: "Not set", hint: "the key is left out" },
        ...values.map((v) => ({ value: v, label: v })),
      ],
      {
        value: current,
        width: 260,
        onPick: (picked) => {
          current = picked;
          paintDropdown(trigger, current, placeholder);
          listeners.forEach((fn) => fn(current));
        },
      }
    );
  };
  return {
    el: fieldRow(spec, trigger),
    get: () => current,
    set: (next) => {
      current = next;
      paintDropdown(trigger, current, placeholder);
    },
    onChange: (listener) => listeners.push(listener),
  };
}

/** A plain number row, in the shared `.px-field` grid; the label drags it. */
function numberField(spec: TraitFieldSpec, value: number | null): Field<number | null> {
  const listeners: ((v: number | null) => void)[] = [];
  const row = node("div", "px-field");
  const label = keyLabel(spec.key);
  if (spec.doc) {
    label.dataset.tip = spec.doc;
    label.dataset.tipWrap = "";
  }
  const input = numberInput(
    value,
    placeholderFor(spec) ?? "",
    (v) => listeners.forEach((fn) => fn(v)),
    label
  );
  const box = node("div", "px-row");
  box.style.maxWidth = "140px";
  box.append(input);
  row.append(label, box);
  return {
    el: row,
    get: () => (input.value.trim() === "" ? null : Number(input.value)),
    set: (v) => {
      input.value = v === null ? "" : String(v);
    },
    onChange: (listener) => listeners.push(listener),
  };
}

/**
 * The six skills as one row of captioned inputs. A `.px-field` each would put
 * six 112px label columns on the page; a character sheet reads them as a set,
 * so the caption sits over the input instead of beside it.
 */
function skillsRow(list: readonly TraitFieldSpec[]): HTMLElement {
  const box = node("div", "skills");
  for (const spec of list) {
    const cell = node("div", "skill");
    const caption = node("span", "", spec.key);
    if (spec.doc) {
      caption.dataset.tip = spec.doc;
      caption.dataset.tipWrap = "";
    }
    const input = numberInput(
      state.values[spec.key] as number | null,
      placeholderFor(spec) ?? "",
      (value) => {
        state.values[spec.key] = value;
        refreshPreview();
      },
      // The caption over the box is this number's label: it is what drags.
      caption
    );
    input.setAttribute("aria-label", spec.key);
    input.dataset.key = spec.key;
    cell.append(caption, input);
    box.append(cell);
  }
  return box;
}

/** Every modifier the game knows: the player's word, the key as the hint. */
function allModifierItems(): MenuItem[] {
  return (form?.modifiers ?? []).map((item) => {
    const label = formats?.[item.name]?.label;
    return {
      value: item.name,
      label: label || item.name,
      ...(label ? { hint: item.name } : {}),
      ...(item.doc ? { description: item.doc } : {}),
    };
  });
}

/**
 * The same list MINUS every name this form already draws a field for.
 *
 * `_traits.info` reads an unknown property as a modifier, so the six skills and
 * the `ai_*` family are modifiers AND documented keys: the Skills row and the
 * Advanced section already write them. Offered in the Modifiers picker too, a
 * modder could add `martial` a second time, and the game would read the two
 * statements as one key written twice. A file that HAS such a statement still
 * round-trips: `loadTrait` puts it in the designed field, never in a row.
 */
function modifierItems(): MenuItem[] {
  const drawn = new Set(specs.map((spec) => spec.key));
  return allModifierItems().filter((item) => !drawn.has(item.value));
}

/** The picker entries for a trait: the player's word, the key as the hint. */
function traitItems(items: readonly EventVocabularyItem[], taken: readonly string[]): MenuItem[] {
  return items
    .filter((item) => !taken.includes(item.value))
    .map((item) => {
      const url = traitThumb(item.value);
      return {
        value: item.value,
        label: item.label || item.value,
        ...(item.label ? { hint: item.value } : item.hint ? { hint: item.hint } : {}),
        ...(url ? { image: url } : {}),
      };
    });
}

interface RowListOptions {
  rows: readonly ModifierRow[];
  items: () => MenuItem[];
  placeholder: string;
  addLabel: string;
  step: number;
  /** What the player reads for this row, drawn under it. */
  line?: (row: ModifierRow) => HTMLElement | null;
  onChange: (rows: ModifierRow[]) => void;
}

/**
 * A list of `name = number` rows with a searchable picker per row: what both a
 * modifier block and a `compatibility` block are. The row shows the value it
 * writes AND, when the caller can print one, the line the player will read.
 */
function rowList(options: RowListOptions): HTMLElement {
  const current = options.rows.map((row) => ({ ...row }));
  const box = node("div", "px-stack");
  const list = node("div", "px-list");
  const add = ghostButton(options.addLabel, "plus");
  const emit = (): void => options.onChange(current.map((row) => ({ ...row })));

  const paint = (): void => {
    list.replaceChildren();
    current.forEach((row, index) => {
      const line = node("div", "px-item modrow");
      const trigger = dropdown(row.name, options.placeholder);
      trigger.onclick = () =>
        menu(trigger, options.items(), {
          value: row.name,
          search: true,
          width: 340,
          onPick: (picked) => {
            current[index] = { ...current[index], name: picked };
            paint();
            emit();
          },
        });
      const value = numberInput(row.value, "0", (v) => {
        current[index] = { ...current[index], value: v ?? 0 };
        paint();
        emit();
      });
      value.step = String(options.step);
      const drop = document.createElement("button");
      drop.className = "px-btn";
      drop.dataset.variant = "ghost";
      drop.dataset.size = "icon-xs";
      drop.dataset.tip = "Remove this row";
      drop.append(iconEl("trash"));
      drop.onclick = () => {
        current.splice(index, 1);
        paint();
        emit();
      };
      line.append(trigger, value, drop);
      const printed = row.name === "" ? null : (options.line?.(row) ?? null);
      if (printed) line.append(printed);
      list.append(line);
    });
    list.hidden = current.length === 0;
  };

  add.onclick = () => {
    current.push({ name: "", value: 0 });
    paint();
  };
  paint();
  // A flex column stretches its children: the ghost button would span the
  // column and read as centered text.
  add.style.alignSelf = "flex-start";
  box.append(list, add);
  return box;
}

/** `compatibility = { trait = number }`: traits with labels and thumbnails. */
function traitRowsField(spec: TraitFieldSpec, rows: ModifierRow[]): Field<ModifierRow[]> {
  const listeners: ((v: ModifierRow[]) => void)[] = [];
  let current = rows.map((row) => ({ ...row }));
  const control = rowList({
    rows: current,
    items: () =>
      traitItems(
        optionsFor(spec),
        current.map((row) => row.name)
      ),
    placeholder: "pick a trait",
    addLabel: "Add trait",
    step: 1,
    onChange: (next) => {
      current = next;
      listeners.forEach((fn) => fn(next.map((row) => ({ ...row }))));
    },
  });
  return {
    el: fieldRow(spec, control),
    get: () => current.map((row) => ({ ...row })),
    set: (next) => {
      current = next.map((row) => ({ ...row }));
    },
    onChange: (listener) => listeners.push(listener),
  };
}

/**
 * `flag = <name>`: any name a modder invents, so the picker offers the ones the
 * game already writes (sampled) and still takes a new one.
 */
function flagsField(spec: TraitFieldSpec, values: string[]): Field<string[]> {
  const items: EventVocabularyItem[] = (spec.sampled ?? []).map((name) => ({
    value: name,
    ...(flagLoc.get(name) ? { label: flagLoc.get(name)! } : {}),
    hint: "the game's own",
  }));
  askForFlagLoc(spec.sampled ?? []);
  return multiRefField({
    label: spec.key,
    ...(spec.doc ? { doc: spec.doc } : {}),
    items,
    values,
    allowNew: true,
    addLabel: "Add flag",
  });
}

/** The shared label + control grid row, for the fields this file builds itself. */
function fieldRow(spec: TraitFieldSpec, control: HTMLElement): HTMLElement {
  const row = node("div", "px-field");
  const label = keyLabel(spec.key);
  if (spec.doc) {
    label.dataset.tip = spec.doc;
    label.dataset.tipWrap = "";
  }
  row.append(label, control);
  return row;
}

/** A folding section (px-ui rule 7), open unless the caller says otherwise. */
function sectionEl(title: string, lede: string | undefined, open: boolean): HTMLElement {
  const box = node("section", "fold");
  if (open) box.dataset.open = "";
  const head = document.createElement("button");
  head.className = "fold-head";
  head.type = "button";
  head.append(iconEl("chevronRight"), node("span", "fold-title", title));
  head.onclick = () => {
    if (box.hasAttribute("data-open")) box.removeAttribute("data-open");
    else box.dataset.open = "";
  };
  const body = node("div", "fold-body");
  if (lede) body.append(node("div", "lede", lede));
  box.append(head, body);
  return box;
}

/**
 * "What does this modifier do?" is a question the toolkit already answers, so
 * the panel links into the Examples Wiki rather than repeating its article.
 */
function examplesRow(): HTMLElement {
  const button = document.createElement("button");
  button.className = "px-btn";
  button.dataset.variant = "link";
  button.dataset.size = "xs";
  button.textContent = "Look a modifier up in the Examples Wiki";
  // Every modifier, not the picker's list: looking `martial` up is a fair
  // question even though the Skills row is where a trait writes it.
  button.onclick = () =>
    menu(button, allModifierItems(), {
      search: true,
      width: 340,
      onPick: (name) => post({ type: "openExamples", name }),
    });
  return button;
}

/** The Modifiers section: rows that show both what is written and what is read. */
function modifiersSection(): HTMLElement {
  const box = sectionEl("Modifiers", "Anything else the trait adds while it is held.", true);
  const body = box.lastElementChild as HTMLElement;
  body.append(
    rowList({
      rows: state.modifiers,
      items: modifierItems,
      placeholder: "pick a modifier",
      addLabel: "Add modifier",
      step: 0.1,
      line: (row) => previewLine(row.name, row.value),
      onChange: (rows) => {
        state.modifiers = rows;
        refreshPreview();
      },
    }),
    examplesRow()
  );
  return box;
}

function render(): void {
  sectionsBox.replaceChildren();
  fields.clear();
  if (!form) return;

  const bySection = new Map<SectionId, TraitFieldSpec[]>();
  for (const spec of specs) {
    const list = bySection.get(spec.section) ?? [];
    list.push(spec);
    bySection.set(spec.section, list);
  }

  for (const section of SECTIONS) {
    const box = sectionEl(section.title, section.lede, section.open);
    const body = box.lastElementChild as HTMLElement;
    const list = bySection.get(section.id) ?? [];
    if (section.id === "identity") {
      for (const entry of locFields) body.append(entry.field.el);
    }
    // The skills are one row of six; the opinions are two per row. Everything
    // else is one field per row, in the shared label + control grid.
    if (section.id === "skills") {
      body.append(skillsRow(list));
    } else {
      const pairs = section.id === "opinions" ? node("div", "pairs") : body;
      if (pairs !== body) body.append(pairs);
      for (const spec of list) {
        const field = buildField(spec);
        field.onChange((value) => {
          state.values[spec.key] = value;
          if (spec.key === "flag") askForFlagLoc(value as string[]);
          refreshPreview();
        });
        fields.set(spec.key, field);
        // Two opinion NUMBERS fit a row; `triggered_opinion` is script, and a
        // half-width box is not something a block can be read in.
        (spec.widget === "script" ? body : pairs).append(field.el);
      }
    }
    sectionsBox.append(box);
    if (section.id === MODIFIERS_AFTER) sectionsBox.append(modifiersSection());
  }
  refreshPreview();
}

// ---------------------------------------------------------------------------
// The block and the preview
// ---------------------------------------------------------------------------

function currentName(): string {
  return nameInput.value.trim();
}

/**
 * The block a save writes. A duplicate and an override start from the game's
 * own text too: keeping its spans is what makes a clone a clone rather than a
 * reformatted guess at one.
 */
function buildBlock(): string {
  const name = currentName() || "trait";
  return writeBlock(name, loaded?.block ?? null, traitWrites(specs, state, baseline));
}

/** A texture a modifier line needs; asked for once, drawn when it arrives. */
function textureUrl(texture: string): string | null {
  const known = textureUrls.get(texture);
  if (known !== undefined) return known;
  if (!textureAsked.has(texture)) {
    textureAsked.add(texture);
    post({ type: "images", keys: [texture], maxDim: 32 });
  }
  return null;
}

/** What the player will read for one `name = value`, as the game prints it. */
function previewLine(name: string, value: number | string): HTMLElement {
  return renderModifierLine(modifierLine(name, value, formats?.[name]), textureUrl);
}

/**
 * Which of the form's own keys the tooltip prints as a modifier line: the ones
 * the GAME formats as modifiers (the six skills, `health`, the `ai_*` family),
 * never a key like `minimum_age` that is a rule rather than a bonus. The
 * opinion keys are out because the game prints them through their own
 * `TRAIT_OPINION_*` lines instead. Before the host has answered, the section
 * the layout already calls modifier-shaped stands in.
 */
function isModifierKey(spec: TraitFieldSpec): boolean {
  if (spec.section === "opinions") return false;
  if (formats) return formats[spec.key] !== undefined;
  return spec.section === "skills";
}

function previewModifiers(): PreviewModifier[] {
  const out: PreviewModifier[] = [];
  for (const spec of specs) {
    if (!isModifierKey(spec)) continue;
    const value = state.values[spec.key];
    // A key whose widget is a text box still holds a number the game formats
    // (`health = 1`); a script value's name comes through verbatim and the
    // line tones itself neutral.
    if (typeof value === "number") out.push({ name: spec.key, value });
    else if (typeof value === "string" && value.trim() !== "")
      out.push({ name: spec.key, value: value.trim() });
  }
  for (const row of state.modifiers) {
    if (row.name.trim() !== "") out.push({ name: row.name, value: row.value });
  }
  return out;
}

/** The name the tooltip's own title shows, which its opinion lines name too. */
function traitDisplayName(): string {
  return locFields[0]?.field.get().trim() || titleCaseFromName(currentName());
}

/** Every opposite as one phrase, for the `[TRAIT_2 …]` slot of an opinion line. */
function oppositeNames(): string {
  return previewOpposites()
    .map((other) => other.label)
    .join(", ");
}

/**
 * `same_opinion` and its three neighbours, worded through the entries the
 * game's own trait tooltip prints them with. A key whose entry the loc index
 * cannot resolve, or whose line needs an opposite the trait does not name,
 * falls back to its own key made readable rather than to invented prose.
 */
function previewOpinions(): PreviewOpinion[] {
  askForLoc(Object.values(OPINION_LOC));
  const other = oppositeNames();
  const out: PreviewOpinion[] = [];
  for (const spec of specs) {
    if (spec.section !== "opinions" || spec.key === TRIGGERED_OPINION_KEY) continue;
    const value = state.values[spec.key];
    if (typeof value !== "number") continue;
    const template = locText.get(OPINION_LOC[spec.key] ?? "");
    const needsOther = template !== undefined && /\[TRAIT_2\.|\$OTHER_TRAIT\$/.test(template);
    const label =
      template === undefined || (needsOther && other === "")
        ? titleCaseFromName(spec.key)
        : fillTraitLoc(template, { trait: traitDisplayName(), other });
    out.push({ label: label || titleCaseFromName(spec.key), value });
  }
  return out;
}

/** `compatibility` rows, each as the whole line the game prints for one. */
function previewCompatibility(): PreviewFact[] {
  askForLoc([COMPATIBILITY_LOC.likes, COMPATIBILITY_LOC.dislikes]);
  // A block of @script_values is not rows any more: it opened as script, and
  // the preview cannot print a number it does not have.
  if (!widgetIs("compatibility", "refRows")) return [];
  const rows = (state.values.compatibility as ModifierRow[] | undefined) ?? [];
  const items = form?.options.trait ?? [];
  const out: PreviewFact[] = [];
  for (const row of rows) {
    if (row.name.trim() === "") continue;
    const other = items.find((item) => item.value === row.name)?.label || row.name;
    const key = row.value < 0 ? COMPATIBILITY_LOC.dislikes : COMPATIBILITY_LOC.likes;
    const template = locText.get(key);
    out.push({
      text: template
        ? fillTraitLoc(template, { trait: traitDisplayName(), other, value: row.value })
        : `${traitDisplayName()} / ${other}: ${row.value >= 0 ? "+" : ""}${row.value}`,
    });
  }
  return out;
}

/**
 * `triggered_opinion` blocks. The game has no loc line of its own for one: it
 * applies the named opinion modifier, so the line is that modifier's own word
 * (its loc entry, else its key) and the block's other statements are shown as
 * the conditions `_traits.info` documents them to be.
 */
function previewTriggered(): PreviewFact[] {
  const raw = (state.values[TRIGGERED_OPINION_KEY] as string[] | undefined) ?? [];
  const blocks = readTriggeredOpinions(raw);
  askForLoc(blocks.map((entry) => entry.modifier));
  return blocks
    .filter((entry) => entry.modifier !== "")
    .map((entry) => ({
      text: opinionModifierWord(entry.modifier),
      ...(entry.conditions.length > 0 ? { note: entry.conditions.join(", ") } : {}),
    }));
}

/**
 * The player's word for an opinion modifier. The game's own entry when it
 * resolves to prose; the key itself when the entry is still a datafunction the
 * panel has no character to run it against (`kinslayer_intolerant` is
 * "Known [GetTrait('kinslayer_3').GetName( … )]"), because the key at least
 * says something true.
 */
function opinionModifierWord(name: string): string {
  const value = locText.get(name);
  if (value === undefined) return name;
  const text = plainLoc(value).trim();
  return text === "" || text.includes("[") ? name : text;
}

/**
 * What the trait does that no tooltip line says: the rule keys of the Advanced
 * section that carry a value (`immortal`, `physical`, `minimum_age`, `group`).
 * The note under each is the game's own sentence about the key from
 * `_traits.info`, which is the only honest answer to "so where does the player
 * notice this".
 *
 * A key written as a block is left out: `culture_modifier` and its kind DO
 * reach the player, conditionally, and their bodies are already in the script
 * section below in full.
 */
function previewHidden(): PreviewFact[] {
  const out: PreviewFact[] = [];
  for (const spec of specs) {
    if (spec.section !== "advanced" || spec.widget === "script") continue;
    if (TOOLTIP_KEYS.has(spec.key) || isModifierKey(spec)) continue;
    for (const line of fieldLines(spec, state.values[spec.key])) {
      out.push({ text: oneLine(line), ...(spec.doc ? { note: spec.doc } : {}) });
    }
  }
  return out;
}

/** A statement on one line, so a block body reads as a row of the tooltip. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 89)}…` : flat;
}

/**
 * Whether a key still has its designed widget. A loaded file can promote one to
 * script (a `compatibility` block of @script_values, an `icon` written as a
 * dynamic block), and then its value is raw text: the readers that expect the
 * designed shape have to ask first.
 */
function widgetIs(key: string, widget: TraitFieldSpec["widget"]): boolean {
  return specs.find((spec) => spec.key === key)?.widget === widget;
}

function previewOpposites(): PreviewTrait[] {
  if (!widgetIs("opposites", "multiRef")) return [];
  const values = (state.values.opposites as string[] | undefined) ?? [];
  const items = form?.options.trait ?? [];
  return values.map((value) => ({
    value,
    label: items.find((item) => item.value === value)?.label || value,
    url: traitThumb(value),
  }));
}

/** The picture the game will draw: the chosen icon, else the one the key names. */
function previewIcon(): string | null {
  const chosen = widgetIs("icon", "icon") ? String(state.values.icon ?? "") : "";
  return chosen ? (iconItems.find((item) => item.key === chosen)?.url ?? null) : traitThumb(currentName());
}

function refreshPreview(): void {
  script.set(buildBlock());
  const category = String(state.values.category ?? "");
  const frame = frameTexture(category);
  if (frame) askForIcons([frame]);
  tipBox.replaceChildren(
    renderTraitTip(
      {
        key: currentName(),
        name: traitDisplayName(),
        desc: locFields[1]?.field.get().trim() ?? "",
        iconUrl: previewIcon(),
        frameUrl: frame ? (iconItems.find((item) => item.key === frame)?.url ?? null) : null,
        modifiers: previewModifiers(),
        opinions: previewOpinions(),
        compatibility: previewCompatibility(),
        triggered: previewTriggered(),
        opposites: previewOpposites(),
        flags: widgetIs("flag", "chips")
          ? ((state.values.flag as string[] | undefined) ?? []).map((name) => flagLoc.get(name) ?? name)
          : [],
        hidden: previewHidden(),
      },
      { formats, imageUrl: textureUrl }
    )
  );

  const problem = nameProblem(currentName());
  saveButton.disabled = problem !== null || init?.problem !== undefined;
  nameInput.setAttribute("aria-invalid", String(problem !== null));
  // The tip says what is wrong while it is wrong, and goes back to the rule.
  nameInput.dataset.tip = problem ?? NAME_TIP;
}

/**
 * Edit mode sends only what moved, as raw script text, so a save rewrites the
 * lines the modder touched and leaves their file alone. Null when one of the
 * changes cannot be one property (a key written twice, like `flag`): the whole
 * block goes instead, which says the same thing and is still surgical.
 */
function changedProperties(): { key: string; value: string | null }[] | null {
  if (!baseline) return null;
  const out: { key: string; value: string | null }[] = [];
  for (const spec of specs) {
    // Statements, not lines: a `compatibility` block is one property written
    // over three lines, where two `flag` lines are two statements and no single
    // property can stand for them.
    const now = fieldStatements(spec, state.values[spec.key]);
    const was = fieldStatements(spec, baseline.values[spec.key]);
    if (now.join("\n") === was.join("\n")) continue;
    if (now.length > 1) return null;
    out.push({ key: spec.key, value: now.length === 0 ? null : now[0].slice(spec.key.length + 3) });
  }
  const before = new Map(baseline.modifiers.map((row) => [row.name, row.value]));
  for (const row of state.modifiers) {
    if (row.name.trim() === "") continue;
    if (before.get(row.name) !== row.value) out.push({ key: row.name, value: String(row.value) });
    before.delete(row.name);
  }
  for (const [name] of before) out.push({ key: name, value: null });
  return out;
}

// ---------------------------------------------------------------------------
// Loading a definition
// ---------------------------------------------------------------------------

function applyForm(next: DefinitionForm, keepName?: string): void {
  form = next;
  const modifiers = new Set(next.modifiers.map((m) => m.name));
  const designed = traitFieldSpecs(next);
  loaded = next.current ? loadTrait(designed, next.current.text, modifiers) : null;
  // A loaded file may need a wider widget for one of its keys than the harvest
  // alone asks for, so the specs the form draws are the ones the load settled.
  specs = loaded ? loaded.specs : designed;
  state = loaded ? loaded.state : emptyState(specs);
  baseline = loaded ? (JSON.parse(JSON.stringify(loaded.state)) as TraitState) : null;

  const name = keepName ?? (next.current ? parseName(next.current.text) : defaultName());
  nameInput.value = name;
  const source = next.current?.source;
  mode = source === "mod" ? "edit" : source ? "duplicate" : "create";
  sourceBadge.textContent = source === "mod" ? "Mod" : source ? "Game" : "New";
  modeButton.hidden = source !== "vanilla" && source !== "parent";
  paintMode();
  revealButton.hidden = !next.current;

  buildLocFields(name);
  render();
  askForIcons(iconKeysToShow());
}

function parseName(text: string): string {
  return /^\s*([^\s{}="#]+)/.exec(text)?.[1] ?? "";
}

function defaultName(): string {
  return `${init?.prefix ?? "mymod"}_trait`;
}

/** The name the loc fields were built for, so a rename can tell a typed value
 *  from the one the panel filled in. */
let locName = "";

function buildLocFields(name: string): void {
  if (!form) return;
  locName = name;
  locFields = locKeys(form, name).map((key, index) => {
    const isDesc = index > 0;
    const field = locField({
      label: isDesc ? "Description" : "Name",
      key,
      value: titleCaseFromName(name),
      multiline: isDesc,
      placeholder: isDesc ? "What the tooltip says about this trait." : titleCaseFromName(name),
      doc: isDesc
        ? "What the tooltip says about the trait. Written into your mod's localization."
        : "What the player sees. Written into your mod's localization.",
    });
    // BOTH keys start filled, with the name made readable. A save only writes
    // the keys that have a value, so an empty description used to write no
    // `trait_<key>_desc` at all and the game printed the raw key where the
    // sentence should be. A prefilled one is text to replace, not a hole.
    field.onChange(() => refreshPreview());
    return { key, field };
  });
  // An existing definition already has words in the workspace: show them
  // instead of the title-cased key, so an opened trait reads as it does in game.
  if (form.current && parseName(form.current.text) === name) {
    post({ type: "loc", keys: locFields.map((entry) => entry.key) });
  }
}

/**
 * The loc keys follow the name, so a rename rebuilds them. Text the modder
 * typed is kept; the value the panel filled in follows the new name, which is
 * what makes a freshly named trait readable with nothing else touched.
 */
function renameLoc(): void {
  if (!form) return;
  const wasDefault = titleCaseFromName(locName);
  const typed = locFields.map((entry) => entry.field.get());
  buildLocFields(currentName());
  locFields.forEach((entry, index) => {
    if (typed[index] && typed[index] !== wasDefault) entry.field.set(typed[index]);
  });
  render();
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function iconKeysToShow(): string[] {
  const keys = init?.iconKeys ?? [];
  const wanted = new Set<string>(keys.slice(0, 200));
  const current = state.values.icon;
  if (typeof current === "string" && current) wanted.add(current);
  // The picture the key alone names, and the ones the opposites name: the
  // preview draws all of them.
  wanted.add(`${currentName()}.dds`);
  for (const value of (state.values.opposites as string[] | undefined) ?? []) wanted.add(`${value}.dds`);
  return [...wanted].filter((key) => keys.includes(key));
}

function askForIcons(keys: string[]): void {
  const fresh = keys.filter((key) => !iconAsked.has(key));
  if (fresh.length === 0) return;
  for (const key of fresh) iconAsked.add(key);
  post({ type: "icons", keys: fresh });
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

async function save(): Promise<void> {
  if (!form) return;
  const name = currentName();
  const problem = nameProblem(name);
  if (problem) {
    toast(problem, "destructive");
    return;
  }
  if (mode === "override") {
    const ok = await confirmDialog({
      title: `Override the game's ${name}?`,
      description:
        "A mod definition with the same key replaces the game's whole trait, so it stops receiving " +
        "changes from every future game patch. Partial overrides do not exist.",
      confirmLabel: "Override",
      destructive: true,
    });
    if (!ok) return;
  }
  const changed = mode === "edit" ? changedProperties() : null;
  post({
    type: "save",
    save: {
      name,
      mode,
      block: buildBlock(),
      ...(changed ? { changed } : {}),
      loc: locFields
        .map((entry) => ({ key: entry.key, value: entry.field.get().trim() }))
        .filter((pair) => pair.value !== ""),
      ...(form.current && mode === "edit" ? { sourceFile: baseName(form.current.file) } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

const MODES: { value: SaveMode; label: string; description: string }[] = [
  {
    value: "duplicate",
    label: "Duplicate",
    description: "A new trait of your own, under a new key. The game's trait stays as it is.",
  },
  {
    value: "override",
    label: "Override",
    description: "Same key, in your mod. Replaces the game's whole trait, patches included.",
  },
];

function paintMode(): void {
  const chosen = MODES.find((m) => m.value === mode);
  (modeButton.firstElementChild as HTMLElement).textContent = chosen?.label ?? "Duplicate";
}

modeButton.onclick = () =>
  menu(modeButton, MODES, {
    value: mode,
    width: 320,
    onPick: (picked) => {
      mode = picked as SaveMode;
      // A duplicate needs a key of its own; an override IS the game's key.
      if (mode === "duplicate" && form?.current) {
        const original = parseName(form.current.text);
        if (currentName() === original) nameInput.value = `${init?.prefix ?? "mymod"}_${original}`;
      } else if (mode === "override" && form?.current) {
        nameInput.value = parseName(form.current.text);
      }
      paintMode();
      renameLoc();
    },
  });

nameInput.addEventListener("change", renameLoc);
nameInput.addEventListener("input", refreshPreview);

byId("new").onclick = () => {
  if (!form) return;
  // The same form, with nothing loaded into it: a blank trait needs no round
  // trip to the server, since the form never depended on which one was open.
  const blank: DefinitionForm = { ...form };
  delete blank.current;
  applyForm(blank, defaultName());
};

/** Where a listed definition comes from, in the words the pickers use. */
const SOURCE_HINT: Record<string, string> = {
  mod: "this mod",
  vanilla: "the game",
  parent: "a dependency",
};

byId("open").onclick = () => {
  const items = [
    // Every trait the index has, the mod's own first: a modder opens a game
    // trait to duplicate or override it as often as their own to edit it.
    ...(form?.existing ?? []).map((def) => {
      const where = SOURCE_HINT[def.source ?? "mod"] ?? def.source ?? "";
      return {
        value: def.name,
        label: def.label || def.name,
        hint: def.label ? `${def.name} · ${where}` : where,
      };
    }),
    ...(form?.options.trait ?? [])
      .filter((item) => !(form?.existing ?? []).some((def) => def.name === item.value))
      .map((item) => ({
        value: item.value,
        label: item.label || item.value,
        ...(item.label ? { hint: item.value } : item.hint ? { hint: item.hint } : {}),
        ...(item.doc ? { description: item.doc } : {}),
      })),
  ];
  if (items.length === 0) {
    toast("No trait is indexed yet. Wait for the index, or just make a new one.");
    return;
  }
  menu(byId("open"), items, { search: true, width: 340, onPick: (name) => post({ type: "load", name }) });
};

revealButton.onclick = () => {
  if (form?.current) post({ type: "openFile", file: form.current.file, line: form.current.line });
};

function paintPreviewButton(): void {
  previewButton.replaceChildren(iconEl(side.collapsed ? "panelRightOpen" : "panelRightClose"));
}
previewButton.onclick = () => {
  side.toggle();
  paintPreviewButton();
};
paintPreviewButton();

saveButton.onclick = () => void save();
byId("helpBtn").onclick = () => helpDialog(HELP);

// ---------------------------------------------------------------------------
// Host messages
// ---------------------------------------------------------------------------

window.addEventListener("message", (event: MessageEvent<HostToApp>) => {
  const message = event.data;
  switch (message.type) {
    case "init": {
      init = message.init;
      problemBox.hidden = message.init.problem === undefined;
      problemBox.textContent = message.init.problem ?? "";
      applyForm(message.init.form);
      break;
    }
    case "form":
      applyForm(message.form);
      break;
    case "target":
      target.set(message.target);
      break;
    case "modifierFormats":
      // The formats reach a modifier row's label, so the whole form is redrawn
      // rather than only the preview.
      formats = message.formats ?? undefined;
      render();
      break;
    case "icons": {
      let fresh = false;
      for (const [key, url] of Object.entries(message.urls)) {
        if (url) {
          iconItems.push({ key, url });
          fresh = true;
        }
      }
      if (fresh) refreshPreview();
      break;
    }
    case "images":
      for (const [key, url] of Object.entries(message.urls)) textureUrls.set(key, url);
      refreshPreview();
      break;
    case "loc": {
      const prefix = flagLocPrefix() ?? "";
      for (const [key, value] of Object.entries(message.values)) {
        locText.set(key, value);
        if (prefix && key.startsWith(prefix)) flagLoc.set(key.slice(prefix.length), value);
        const entry = locFields.find((e) => e.key === key);
        if (entry) entry.field.set(value);
      }
      render();
      break;
    }
    case "iconWritten": {
      // A picture the modder sent to a folder of their own is not in the icon
      // folder, so it is not one of the grid's entries and it is not what the
      // game will draw for this key: the host has already said so.
      if (!message.inPlace) break;
      const field = fields.get("icon");
      if (message.url) iconItems.push({ key: message.key, url: message.url });
      // In place, the picture lands under the trait's own name, which is
      // exactly the path the game derives from the key: no `icon` line at all.
      if (field) field.set("");
      state.values.icon = "";
      refreshPreview();
      break;
    }
    case "saved":
      // The definition is now the mod's, so the form reloads from what was
      // written: the next save is an edit of real lines, not a second insert.
      if (message.ok) post({ type: "load", name: message.name });
      break;
    case "toast":
      toast(message.message, message.variant ?? "default");
      break;
  }
});

installTips();
post({ type: "ready" });
