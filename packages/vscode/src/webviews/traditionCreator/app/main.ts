/**
 * The Tradition Creator's app: a form over one culture tradition, next to the
 * tile and tooltip the game will draw for it.
 *
 * Nothing in the layout knows a tradition key. `paradox/definitionForm` answers
 * what a tradition may contain (the harvest of the game's own traditions
 * folder, the loc key patterns, the tradition list, the modifier vocabulary and
 * the values the game itself writes for each key), the panel's catalog answers
 * what the form request cannot (the picture's layer folders and their contents,
 * the cost currencies `_cultural_traits.info` documents, the parameter names
 * vanilla sets, one real body per script key), traditionModel.ts places those
 * keys into sections, and this file builds the widget each one asked for. A key
 * the game adds shows up under "Advanced" without a code change, and no key is
 * ever hidden (AD-5).
 *
 * The block a save writes is not a re-serialization of the form: scriptBlock.ts
 * keeps the file's own text for everything the modder did not touch, so opening
 * a vanilla tradition and saving it back is a zero-line diff.
 *
 * Browser code: no vscode, no file system, no server. It asks the host.
 */
import type {
  DefinitionForm,
  EventVocabularyItem,
  FormatPart,
  ModifierFormat,
} from "@px-lsp/protocol/protocol";
import {
  boolField,
  infoIcon,
  keyLabel,
  locField,
  multiRefField,
  scriptField,
  textField,
  titleCaseFromName,
  type Field,
  type ModifierRow,
} from "../../shared/fields";
import { helpDialog } from "../../shared/help";
import { iconEl } from "../../shared/icons";
import { modifierLine, renderModifierLine, renderParts } from "../../shared/modifierLines";
import { confirmDialog, menu, toast, type MenuItem } from "../../shared/overlay";
import { saveTargetLine } from "../../shared/saveTarget";
import { baseName, writeBlock } from "../../shared/scriptBlock";
import { scriptSection } from "../../shared/scriptSection";
import { scrubbable } from "../../shared/scrub";
import { sidePanel } from "../../shared/sidePanel";
import { installTips } from "../../shared/tips";
import { traditionIcon, type TraditionLayerImage } from "../../shared/traditionIcon";
import {
  costLocKey,
  type AppToHost,
  type HostToApp,
  type SaveMode,
  type TraditionCreatorInit,
  type TraditionLayerFolder,
  type TraditionSave,
} from "../messages";
import {
  categoryLocKey,
  parameterLocKey,
  renderTraditionTip,
  type PreviewCost,
  type PreviewModifierBlock,
} from "./preview";
import {
  emptyState,
  fieldLines,
  loadTradition,
  locKeys,
  nameProblem,
  traditionFieldSpecs,
  traditionWrites,
  type CostValues,
  type FieldValue,
  type LayerPicks,
  type LoadedTradition,
  type SectionId,
  type TraditionFieldSpec,
  type TraditionState,
} from "./traditionModel";

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
  {
    id: "identity",
    title: "Identity",
    lede: "What the player reads, and how the game groups it.",
    open: true,
  },
  {
    id: "icon",
    title: "Icon",
    lede: "The game builds the picture from one file per layer folder.",
    open: true,
  },
  { id: "cost", title: "Cost", lede: "What a culture pays to establish it.", open: true },
  {
    id: "parameters",
    title: "Parameters",
    lede: "Switches other script reads with has_cultural_parameter.",
    open: true,
  },
  {
    id: "modifiers",
    title: "Modifiers",
    lede: "What the tradition changes while a culture has it.",
    open: true,
  },
  {
    id: "rules",
    title: "Rules",
    lede: "When it can be picked, when it is shown, and how much the AI wants it.",
    open: false,
  },
  {
    id: "advanced",
    title: "Advanced",
    lede: "Every remaining key the game's own traditions write.",
    open: false,
  },
];

/**
 * Longest edge of a thumbnail decode: a layer row's slot, a picker entry, a
 * texticon. The host's own thumbnail cap (textureCache.THUMBNAIL_MAX_DIM), so
 * the DDS hovers and the GUI editor share the cached files.
 */
const THUMB_DIM = 256;
/** No cap: the composed tile is drawn from the layer files as they are (545x285, measured). */
const FULL_DIM = 0;

const HELP = {
  title: "Tradition Creator",
  intro:
    "Design a culture tradition as a form, watch the tile and tooltip the game will draw for it, and " +
    "write it into your mod as script and localization. Every field, its documentation and every list " +
    "you can pick from come from your game files, not from a list built into the toolkit.",
  sections: [
    {
      title: "Making one",
      items: [
        {
          lead: "Name it.",
          text: "Everything else has a default, so a new tradition saves with just a name and a category.",
        },
        {
          lead: "The picture is layered.",
          text: "The game stacks one file per layer folder, so there is one picker per layer rather than one icon file. Start from an existing tradition to fill them all in at once.",
        },
        {
          lead: "The preview is the game.",
          text: "The panel on the right prints the Add Tradition tile and its tooltip, with each modifier's own word, sign, decimals and color read out of the game's modifier format files.",
        },
        {
          lead: "Parameters are switches.",
          text: "Other script asks has_cultural_parameter for them. The list offers the ones the game's own traditions set, and takes a new name.",
        },
      ],
    },
    {
      title: "Editing one that exists",
      items: [
        {
          lead: "Open.",
          text: "The folder button loads a tradition of your mod, or any tradition the game has.",
        },
        {
          lead: "A game tradition.",
          text: "Duplicate makes your own copy under a new name. Override writes the same key into your mod, which replaces the game's whole tradition and stops it receiving patch changes.",
        },
        {
          lead: "Nothing else moves.",
          text: "Keys no field can stand for (a cost written as a script value block, a parameter with a number) are written back exactly as the file has them, and are listed as kept.",
        },
        {
          lead: "A duplicate is the game's own text.",
          text: "Where that text used script values or triggers defined elsewhere, they have to exist for your copy too. ck3-tiger names each one after the save.",
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let init: TraditionCreatorInit | null = null;
let form: DefinitionForm | null = null;
let specs: TraditionFieldSpec[] = [];
let state: TraditionState = { values: {} };
/** What the file said when it was loaded; null for a brand-new tradition. */
let baseline: TraditionState | null = null;
let loaded: LoadedTradition | null = null;
let mode: SaveMode = "create";
const fields = new Map<string, Field<FieldValue>>();
let locFields: { key: string; field: Field<string> }[] = [];
/** One per parameter the workspace has no `culture_parameter_` sentence for. */
let paramLocFields: { key: string; field: Field<string> }[] = [];
/**
 * What the modder typed for each of those, kept outside the fields: adding a
 * parameter or a late loc answer redraws the form, and a sentence already
 * written must survive that.
 */
const paramLocTyped = new Map<string, string>();
/** How the game prints each modifier; undefined until the host answers. */
let formats: Record<string, ModifierFormat> | undefined;
/** `costLocKey(currency)` -> the game's cost line as parts (`[prestige_i] $VALUE|0$`). */
let costLines: Record<string, FormatPart[]> = {};
/**
 * Texture path -> URL, twice: capped decodes for the layer slots, the picker
 * entries and a modifier's texticons, and full-size decodes for the composed
 * tile alone. Only the chosen layers are ever asked for at full size.
 */
const thumbUrls = new Map<string, string | null>();
const fullUrls = new Map<string, string | null>();
const thumbAsked = new Set<string>();
const fullAsked = new Set<string>();
/**
 * The layer picker that is open, so a thumbnail arriving while it is open lands
 * in it: the entries are built when the menu opens, before a cold folder has
 * decoded. `menu()` rebuilds its rows from these same objects on filter.
 */
let openLayerMenu: { items: MenuItem[]; rels: Map<string, string> } | null = null;
/** Controls that draw a texticon and redraw themselves when it arrives; reset by `render()`. */
let latePainters: (() => void)[] = [];
/** Loc key -> the value verbatim, which is what a loc field edits and a save writes. */
const locValues = new Map<string, string>();
/**
 * Loc key -> the same value as the PLAYER reads it (paradox/locText): markup
 * stripped and the game's own datafunction chains resolved. What every place
 * that SHOWS a value uses; `locValues` stays the editable text.
 */
const locTexts = new Map<string, string>();
const locAsked = new Set<string>();

/** The sentence to show for a loc key: the rendered one, else the raw value. */
function locWord(key: string): string | undefined {
  return locTexts.get(key) ?? locValues.get(key);
}

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
 * `handle`: the label the number is drawn under, so typing in the box never
 * moves the value.
 */
function numberInput(
  value: number | null,
  placeholder: string,
  step: number,
  commit: (v: number | null) => void,
  handle?: HTMLElement
): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "px-input";
  input.dataset.size = "sm";
  input.type = "number";
  input.step = String(step);
  input.placeholder = placeholder;
  input.value = value === null ? "" : String(value);
  const read = (): number | null => (input.value.trim() === "" ? null : Number(input.value));
  input.addEventListener("change", () => commit(read()));
  scrubbable(input, {
    step,
    ...(handle ? { handle } : {}),
    onChange: () => undefined,
    onCommit: () => commit(read()),
  });
  return input;
}

/** The shared label + control grid row, with the input's guideline when it has one. */
function fieldRow(spec: TraditionFieldSpec, control: HTMLElement, info?: string): HTMLElement {
  const row = node("div", "px-field");
  const label = keyLabel(spec.key);
  if (spec.doc) {
    label.dataset.tip = spec.doc;
    label.dataset.tipWrap = "";
  }
  if (info) label.append(infoIcon(info));
  row.append(label, control);
  return row;
}

/**
 * What the game expects of a layer picture, behind the (i) on the Icon row.
 *
 * Measured in game/gfx/interface/icons/culture_tradition: every file of every
 * layer folder and subfolder is 545 x 285 and 32-bit with an alpha channel
 * (73 of the 81 items are exactly that, the other 8 within three pixels), which
 * is the size of the tile the Add Tradition view draws.
 */
const LAYER_INFO =
  "545 x 285 pixels: the size every layer file of the game's own tradition art is, measured. " +
  "Transparency is what makes the stack work. The layers are drawn on top of each other, " +
  "so everything but this layer's own paint has to be see-through. " +
  "DDS, and any picture format converts to one. " +
  "Each folder below is one layer, and a value is either a file in it or a subfolder " +
  "the game picks a file out of at random. To add your own, put the DDS in that folder " +
  "of your mod under the same path and it shows up in this picker.";

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

/** The row that names a key the file keeps the last word on. */
function keptRow(key: string, why: string): HTMLElement {
  const row = node("div", "kept");
  row.append(iconEl("lock"));
  const code = document.createElement("code");
  code.textContent = key;
  row.append(code, document.createTextNode(` is kept exactly as the file writes it: ${why}`));
  return row;
}

// ---------------------------------------------------------------------------
// Pictures and loc
// ---------------------------------------------------------------------------

/** A batch of textures at one cap, asked in one message: a layer folder is 81 files. */
function askFor(keys: readonly string[], maxDim: number): void {
  const asked = maxDim === FULL_DIM ? fullAsked : thumbAsked;
  const fresh = keys.filter((key) => !asked.has(key));
  if (fresh.length === 0) return;
  for (const key of fresh) asked.add(key);
  post({ type: "images", keys: fresh, maxDim });
}

/** A thumbnail the form needs; asked for once, drawn when it arrives. */
function textureUrl(texture: string): string | null {
  const known = thumbUrls.get(texture);
  if (known !== undefined) return known;
  askFor([texture], THUMB_DIM);
  return null;
}

/** The same at full size, for the composed tile. */
function fullUrl(texture: string): string | null {
  const known = fullUrls.get(texture);
  if (known !== undefined) return known;
  askFor([texture], FULL_DIM);
  return null;
}

/**
 * Fill in every placeholder whose picture has since arrived. A layer slot and a
 * composed layer both carry their `data-rel`, so a late answer paints without
 * redrawing the form the modder is typing in; a composed layer (inside a
 * `.px-tradicon`) takes the full-size file, everything else the thumbnail.
 */
function paintImages(): void {
  for (const img of Array.from(document.querySelectorAll<HTMLImageElement>("img[data-rel]"))) {
    const urls = img.closest(".px-tradicon") ? fullUrls : thumbUrls;
    const url = urls.get(img.dataset.rel ?? "");
    if (url) {
      img.src = url;
      img.hidden = false;
    }
  }
  for (const paint of latePainters) paint();
  if (!openLayerMenu) return;
  // The open picker's entries: set for the rows `menu()` rebuilds on filter,
  // and drawn into the rows already on screen.
  const rows = new Map<string, HTMLElement>();
  for (const row of Array.from(document.querySelectorAll<HTMLElement>(".px-menu-item"))) {
    rows.set(row.querySelector(".px-grow")?.textContent ?? "", row);
  }
  for (const item of openLayerMenu.items) {
    const rel = openLayerMenu.rels.get(item.value);
    const url = rel ? thumbUrls.get(rel) : null;
    if (!url || item.image) continue;
    item.image = url;
    const row = rows.get(item.label);
    if (!row || row.querySelector("img")) continue;
    const img = document.createElement("img");
    img.className = "px-chip-thumb";
    img.src = url;
    img.alt = "";
    row.querySelector(".px-grow")?.before(img);
  }
}

function askForLoc(keys: readonly string[]): void {
  const fresh = keys.filter((key) => key !== "" && !locAsked.has(key));
  if (fresh.length === 0) return;
  for (const key of fresh) locAsked.add(key);
  post({ type: "loc", keys: fresh });
}

// ---------------------------------------------------------------------------
// Building the form
// ---------------------------------------------------------------------------

/**
 * What an empty input shows. The example is the literal the indexed traditions
 * write most often for the key; a key with none but a sampled value set shows
 * the most used of those.
 */
function placeholderFor(spec: TraditionFieldSpec): string | undefined {
  return spec.example ?? spec.sampled?.[0];
}

function layerFolders(): TraditionLayerFolder[] {
  return init?.catalog.layers ?? [];
}

function buildField(spec: TraditionFieldSpec): Field<FieldValue> {
  const placeholder = placeholderFor(spec);
  const shared = {
    label: spec.key,
    ...(spec.doc ? { doc: spec.doc } : {}),
    ...(placeholder ? { placeholder } : {}),
  };
  const value = state.values[spec.key];
  switch (spec.widget) {
    case "bool":
      return boolField({ ...shared, value: value as boolean | null }) as Field<FieldValue>;
    case "enum":
      return pickField(spec, String(value)) as Field<FieldValue>;
    case "layers":
      return layersField(spec, value as LayerPicks) as Field<FieldValue>;
    case "cost":
      return costField(spec, value as CostValues) as Field<FieldValue>;
    case "parameters":
      return parametersField(spec, value as string[]) as Field<FieldValue>;
    case "modifierBlock":
      return modifierBlockField(spec, value as ModifierRow[]) as Field<FieldValue>;
    case "script":
      return scriptField({
        ...shared,
        value: String(value),
        rows: 5,
        // A textarea has no completion, no hover and no highlighting; the note
        // under it says so and offers the editor, which has all three.
        onOpenFile: () => void openInFile(),
        // The shortest body the game itself writes for the key: an example a
        // modder can read at a glance beats "not set".
        ...(init?.catalog.examples[spec.key]
          ? { placeholder: `{\n\t${init.catalog.examples[spec.key]}\n}` }
          : {}),
      }) as Field<FieldValue>;
    case "number":
      return numberField(spec, value as number | null) as Field<FieldValue>;
    default:
      return textField({
        ...shared,
        value: String(value),
        ...(spec.sampled?.length ? { suggestions: spec.sampled } : {}),
      }) as Field<FieldValue>;
  }
}

/** A plain number row, in the shared `.px-field` grid; the label drags it. */
function numberField(spec: TraditionFieldSpec, value: number | null): Field<number | null> {
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
    1,
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
 * One of a known list. Not the shared `enumField`, because this picker says two
 * different things with the two texts that widget shares: the trigger's face is
 * the EXAMPLE the game writes most often (dimmed, so it reads as a suggestion),
 * while the entry that clears the key reads "Not set".
 */
function pickField(spec: TraditionFieldSpec, value: string): Field<string> {
  const listeners: ((v: string) => void)[] = [];
  const placeholder = placeholderFor(spec) ?? "not set";
  let current = value;
  const trigger = dropdown(current, placeholder);
  trigger.onclick = () => {
    // The file's own value stays pickable even when it is not one the game
    // writes anywhere else (AD-5: annotate, never hide).
    const values = [...(spec.values ?? [])];
    if (current && !values.includes(current)) values.push(current);
    askForLoc(values.map(categoryLocKey));
    menu(
      trigger,
      [
        { value: "", label: "Not set", hint: "the key is left out" },
        ...values.map((v) => ({
          value: v,
          label: v,
          // The category's own word, the way the Add Tradition view heads its
          // group of tiles (`tradition_group_<category>` in the game's loc).
          ...(locWord(categoryLocKey(v)) ? { hint: locWord(categoryLocKey(v))! } : {}),
        })),
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

/** `0-background` -> `background`: the layer's own name, for an empty row. */
function layerName(folder: TraditionLayerFolder): string {
  return folder.label.replace(/^\d+-/, "");
}

/** The picked file's slot in a layer row: the thumbnail, or a dashed empty box the same size. */
function layerSlot(rel: string | null): HTMLElement {
  if (rel === null) {
    const empty = node("span", "layerthumb");
    empty.dataset.empty = "";
    return empty;
  }
  const thumb = document.createElement("img");
  thumb.className = "layerthumb";
  thumb.alt = "";
  thumb.dataset.rel = rel;
  const url = textureUrl(rel);
  if (url) thumb.src = url;
  else thumb.hidden = true;
  return thumb;
}

/** The composed tile at the game's own size, or the same box empty. */
function liveTile(picks: LayerPicks): HTMLElement {
  const box = node("div", "iconlive");
  const layers = layersFrom(picks);
  // One message for the whole picture, before each layer asks for itself.
  askFor(
    layers.map((layer) => layer.rel),
    FULL_DIM
  );
  if (layers.length > 0) box.append(traditionIcon(layers, null, fullUrl));
  else box.append(node("div", "noicon", "No layer picked yet"));
  return box;
}

/**
 * The picture: one row per layer folder, in the index order the engine stacks
 * them, with the composed tile beside the rows. A folder entry is offered as
 * the folder, not as its files, because that is what the game reads as "any
 * of these". "Use an existing tradition's layers" fills every row at once.
 */
function layersField(spec: TraditionFieldSpec, picks: LayerPicks): Field<LayerPicks> {
  const listeners: ((v: LayerPicks) => void)[] = [];
  let current: LayerPicks = { ...picks };
  const block = node("div", "iconblock");
  const rows = node("div", "px-stack");
  const emit = (): void => listeners.forEach((fn) => fn({ ...current }));
  const set = (next: LayerPicks): void => {
    current = { ...next };
    paint();
  };

  const paint = (): void => {
    rows.replaceChildren();
    for (const folder of layerFolders()) {
      const index = String(folder.index);
      const row = node("div", "layerrow");
      const caption = node("span", "px-label", folder.label);
      caption.dataset.tip = `${folder.path}. The layers block writes this one as ${index} = <value>.`;
      caption.dataset.tipWrap = "";
      const value = current[index] ?? "";
      const choice = folder.choices.find((c) => c.value === value);
      const trigger = dropdown(value, `No ${layerName(folder)}`);
      trigger.onclick = () => {
        askFor(
          folder.choices.map((c) => c.rel),
          THUMB_DIM
        );
        const items: MenuItem[] = [
          { value: "", label: "None", hint: "the layer is left out" },
          ...folder.choices.map((c) => ({
            value: c.value,
            label: c.value,
            hint: c.folder ? "a folder the game picks from" : "",
            ...(textureUrl(c.rel) ? { image: textureUrl(c.rel)! } : {}),
          })),
        ];
        openLayerMenu = { items, rels: new Map(folder.choices.map((c) => [c.value, c.rel])) };
        menu(trigger, items, {
          value,
          search: true,
          width: 320,
          onPick: (picked) => {
            openLayerMenu = null;
            if (picked === "") delete current[index];
            else current[index] = picked;
            paint();
            emit();
          },
        });
      };
      row.append(caption, layerSlot(choice ? choice.rel : null), trigger);
      rows.append(row);
    }
    if (layerFolders().length === 0) {
      rows.append(node("div", "lede", "No game folder is set, so the layer folders could not be read."));
    }
    rows.append(startFromRow(set));
    block.replaceChildren(rows, liveTile(current));
  };

  paint();
  const row = fieldRow(spec, block, LAYER_INFO);
  row.dataset.rows = "";
  return {
    el: row,
    get: () => ({ ...current }),
    set,
    onChange: (listener) => listeners.push(listener),
  };
}

/**
 * `cost = { prestige = 300 }`: one field per currency the game's own doc names.
 * The value is TEXT, not a number, because vanilla writes a script value's name
 * or a whole block for it far more often than a literal.
 */
function costField(spec: TraditionFieldSpec, values: CostValues): Field<CostValues> {
  const listeners: ((v: CostValues) => void)[] = [];
  const current: CostValues = { ...values };
  const box = node("div", "px-stack");
  for (const currency of init?.catalog.costKeys ?? []) {
    const row = node("div", "costrow");
    const caption = node("span", "px-label");
    // The currency's own icon, out of the game's cost line for it; drawn again
    // when the sprite arrives, since the form is not redrawn for a picture.
    const icons = (costLines[costLocKey(currency)] ?? []).filter((part) => "icon" in part);
    const paintCaption = (): void => {
      caption.replaceChildren();
      renderParts(icons, caption, textureUrl);
      caption.append(currency);
    };
    paintCaption();
    latePainters.push(paintCaption);
    const input = document.createElement("input");
    input.className = "px-input";
    input.dataset.size = "sm";
    input.type = "text";
    input.spellcheck = false;
    input.dataset.currency = currency;
    input.placeholder = "a number, or a script value";
    input.value = current[currency] ?? "";
    input.addEventListener("change", () => {
      const text = input.value.trim();
      if (text === "") delete current[currency];
      else current[currency] = text;
      listeners.forEach((fn) => fn({ ...current }));
    });
    row.append(caption, input);
    box.append(row);
  }
  if ((init?.catalog.costKeys ?? []).length === 0) {
    box.append(node("div", "lede", "The game's own documentation for a cost could not be read."));
  }
  const row = fieldRow(spec, box);
  row.dataset.rows = "";
  return {
    el: row,
    get: () => ({ ...current }),
    set: (next) => {
      for (const key of Object.keys(current)) delete current[key];
      Object.assign(current, next);
      for (const input of Array.from(box.querySelectorAll<HTMLInputElement>("input[data-currency]"))) {
        input.value = next[input.dataset.currency!] ?? "";
      }
    },
    onChange: (listener) => listeners.push(listener),
  };
}

/**
 * `parameters = { can_raid = yes }`: the switches this tradition turns on. Any
 * name a modder invents is legal (other script asks for it by name), so the
 * picker offers the ones the game's own traditions set and still takes a new
 * one.
 */
function parametersField(spec: TraditionFieldSpec, values: string[]): Field<string[]> {
  const items: EventVocabularyItem[] = (init?.catalog.parameters ?? []).map((name) => ({
    value: name,
    ...(parameterSentence(name) ? { label: parameterSentence(name)! } : {}),
    hint: "the game's own",
  }));
  return multiRefField({
    label: spec.key,
    ...(spec.doc ? { doc: spec.doc } : {}),
    items,
    values,
    allowNew: true,
    addLabel: "Add parameter",
  });
}

/** The parameters the tradition switches on, right now. */
function currentParameters(): string[] {
  return (state.values.parameters as string[] | undefined) ?? [];
}

/**
 * What the player reads for a parameter. The server renders the sentence
 * (`[GetTrait('rough_terrain_expert').GetName( … )]` becomes "Rough Terrain
 * Expert"); a value that still shows a bracket or an unfilled `$slot$` after
 * that is one only the running game can finish, and the parameter's own key
 * says more than half-resolved markup does. Undefined = nothing to show, so
 * the caller falls back to the key.
 */
function parameterSentence(name: string): string | undefined {
  const value = locWord(parameterLocKey(name));
  if (value === undefined || value === "") return undefined;
  return /[[\]$]/.test(value) ? undefined : value;
}

/**
 * The sentence the tooltip reads for each parameter this tradition sets. A
 * parameter the workspace already words (513 of the game's own 515 do) needs
 * nothing; a new one gets a field, because a parameter with no
 * `culture_parameter_` key is a missing localization the game shows as a blank
 * line and ck3-tiger reports.
 */
function parameterLocRows(): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const name of currentParameters()) {
    const key = parameterLocKey(name);
    if (locValues.has(key)) {
      const row = node("div", "kept");
      row.append(iconEl("check"));
      const code = document.createElement("code");
      code.textContent = name;
      row.append(code, document.createTextNode(` already reads "${parameterSentence(name) ?? name}".`));
      rows.push(row);
      continue;
    }
    const field = locField({
      label: name,
      key,
      value: paramLocTyped.get(key) ?? "",
      multiline: false,
      placeholder: "What the tooltip says this parameter does.",
      doc: "The sentence the game prints for this parameter. Written into your mod's localization.",
    });
    field.onChange(() => {
      paramLocTyped.set(key, field.get());
      refreshPreview();
    });
    paramLocFields.push({ key, field });
    rows.push(field.el);
  }
  return rows;
}

/** The picker entries for a modifier: the player's word, the key as the hint. */
function modifierItems(taken: readonly string[]): MenuItem[] {
  return (form?.modifiers ?? [])
    .filter((item) => !taken.includes(item.name))
    .map((item) => {
      const label = formats?.[item.name]?.label;
      return {
        value: item.name,
        label: label || item.name,
        ...(label ? { hint: item.name } : {}),
        ...(item.doc ? { description: item.doc } : {}),
      };
    });
}

/** What the player will read for one `name = value`, as the game prints it. */
function previewLine(name: string, value: number): HTMLElement {
  return renderModifierLine(modifierLine(name, value, formats?.[name]), textureUrl);
}

/**
 * One modifier block (`character_modifier = { … }`): named modifiers with their
 * numbers, each row showing what is written AND what the player will read.
 */
function modifierBlockField(spec: TraditionFieldSpec, rows: ModifierRow[]): Field<ModifierRow[]> {
  const listeners: ((v: ModifierRow[]) => void)[] = [];
  let current = rows.map((row) => ({ ...row }));
  const box = node("div", "px-stack");
  const list = node("div", "px-list");
  const add = ghostButton("Add modifier", "plus");
  add.style.alignSelf = "flex-start";
  const emit = (): void => listeners.forEach((fn) => fn(current.map((row) => ({ ...row }))));

  const paint = (): void => {
    list.replaceChildren();
    current.forEach((row, index) => {
      const line = node("div", "px-item modrow");
      const trigger = dropdown(row.name, "pick a modifier");
      trigger.onclick = () =>
        menu(trigger, modifierItems(current.filter((_, at) => at !== index).map((r) => r.name)), {
          value: row.name,
          search: true,
          width: 340,
          onPick: (picked) => {
            current[index] = { ...current[index], name: picked };
            paint();
            emit();
          },
        });
      const value = numberInput(row.value, "0", 0.1, (v) => {
        current[index] = { ...current[index], value: v ?? 0 };
        paint();
        emit();
      });
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
      if (row.name !== "") line.append(previewLine(row.name, row.value));
      list.append(line);
    });
    list.hidden = current.length === 0;
  };

  add.onclick = () => {
    current.push({ name: "", value: 0 });
    paint();
  };
  paint();
  box.append(list, add);
  return {
    el: fieldRow(spec, box),
    get: () => current.map((row) => ({ ...row })),
    set: (next) => {
      current = next.map((row) => ({ ...row }));
      paint();
    },
    onChange: (listener) => listeners.push(listener),
  };
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
  button.onclick = () =>
    menu(button, modifierItems([]), {
      search: true,
      width: 340,
      onPick: (name) => post({ type: "openExamples", name }),
    });
  return button;
}

/** "Start from the layers of…": every tradition the catalog read, by category. */
function startFromRow(set: (picks: LayerPicks) => void): HTMLElement {
  const button = ghostButton("Use an existing tradition's layers", "image");
  const entries = Object.entries(init?.catalog.traditions ?? {});
  button.onclick = () => {
    const labels = new Map((form?.existing ?? []).map((def) => [def.name, def.label]));
    menu(
      button,
      entries.map(([name, entry]) => ({
        value: name,
        label: labels.get(name) || name,
        hint: entry.category ?? "",
      })),
      {
        search: true,
        width: 340,
        onPick: (name) => {
          const entry = init?.catalog.traditions[name];
          if (!entry) return;
          state.values.layers = { ...entry.layers };
          set({ ...entry.layers });
          refreshPreview();
        },
      }
    );
  };
  return button;
}

function render(): void {
  sectionsBox.replaceChildren();
  fields.clear();
  paramLocFields = [];
  latePainters = [];
  if (!form) return;

  const bySection = new Map<SectionId, TraditionFieldSpec[]>();
  for (const spec of specs) {
    const list = bySection.get(spec.section) ?? [];
    list.push(spec);
    bySection.set(spec.section, list);
  }

  for (const section of SECTIONS) {
    const box = sectionEl(section.title, section.lede, section.open);
    const body = box.lastElementChild as HTMLElement;
    if (section.id === "identity") {
      for (const entry of locFields) body.append(entry.field.el);
    }
    for (const spec of bySection.get(section.id) ?? []) {
      if (loaded?.verbatim.has(spec.key)) {
        body.append(keptRow(spec.key, keptReason(spec)));
        continue;
      }
      const field = buildField(spec);
      field.onChange((value) => {
        state.values[spec.key] = value;
        // A parameter carries a sentence of its own, so the list of loc rows
        // under it follows the list of parameters.
        if (spec.widget === "parameters") {
          askForLoc(currentParameters().map(parameterLocKey));
          render();
          return;
        }
        refreshPreview();
      });
      fields.set(spec.key, field);
      body.append(field.el);
      if (spec.widget === "parameters" && !loaded?.verbatim.has(spec.key)) {
        body.append(...parameterLocRows());
      }
    }
    if (section.id === "modifiers") body.append(examplesRow());
    sectionsBox.append(box);
  }
  refreshPreview();
}

/** Why a key is kept as the file writes it, in the modder's words. */
function keptReason(spec: TraditionFieldSpec): string {
  switch (spec.widget) {
    case "cost":
      return "its value is a script block rather than a plain number.";
    case "parameters":
      return "one of its parameters is a number rather than a switch.";
    case "modifierBlock":
      return "one of its rows is not a plain number.";
    default:
      return "no field here can stand for it.";
  }
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
  const name = currentName() || "tradition";
  return writeBlock(name, loaded?.block ?? null, traditionWrites(specs, state, baseline, loaded?.verbatim));
}

/**
 * The layers the preview draws. `window_culture.gui`'s `widget_tradition_icon`
 * draws the pattern layer TWICE (the second mirrored) and the stroke at 90%,
 * which is why those two indices produce more than one image each.
 */
const PATTERN_INDEX = 1;
const STROKE_INDEX = 3;
const STROKE_SCALE = 0.9;

function layersFrom(picks: LayerPicks): TraditionLayerImage[] {
  const out: TraditionLayerImage[] = [];
  for (const folder of layerFolders()) {
    const value = picks[String(folder.index)];
    const choice = value ? folder.choices.find((c) => c.value === value) : undefined;
    if (!choice) continue;
    out.push({
      rel: choice.rel,
      ...(folder.index === STROKE_INDEX ? { scale: STROKE_SCALE } : {}),
    });
    if (folder.index === PATTERN_INDEX) out.push({ rel: choice.rel, mirrored: true });
  }
  return out;
}

function previewLayers(): TraditionLayerImage[] {
  return layersFrom((state.values.layers as LayerPicks | undefined) ?? {});
}

function previewBlocks(): PreviewModifierBlock[] {
  const out: PreviewModifierBlock[] = [];
  for (const spec of specs) {
    if (spec.widget !== "modifierBlock") continue;
    const rows = (state.values[spec.key] as ModifierRow[] | undefined) ?? [];
    out.push({ key: spec.key, rows: rows.filter((row) => row.name.trim() !== "") });
  }
  return out;
}

function previewCost(): PreviewCost[] {
  const costs = (state.values.cost as CostValues | undefined) ?? {};
  return Object.entries(costs)
    .filter(([, value]) => value.trim() !== "")
    .map(([currency, value]) => {
      // A line whose icon the server could not resolve (CK3's piety icon is a
      // datafunction of the player's faith) prints as number and word instead.
      const line = costLines[costLocKey(currency)];
      const drawn = line?.some((part) => "icon" in part);
      return { currency, value: value.trim(), ...(drawn ? { line } : {}) };
    });
}

function refreshPreview(): void {
  script.set(buildBlock());
  const category = String(state.values.category ?? "");
  if (category) askForLoc([categoryLocKey(category)]);
  const layers = previewLayers();
  askFor(
    layers.map((layer) => layer.rel),
    FULL_DIM
  );
  tipBox.replaceChildren(
    renderTraditionTip(
      {
        key: currentName(),
        name: locFields[0]?.field.get().trim() || titleCaseFromName(currentName()),
        desc: locFields[1]?.field.get().trim() ?? "",
        category: category ? (locWord(categoryLocKey(category)) ?? category) : "",
        layers,
        blocks: previewBlocks(),
        cost: previewCost(),
        // What the player reads for a parameter: the workspace's own sentence,
        // else the one being typed for it, else the bare key.
        parameters: currentParameters().map(
          (name) =>
            parameterSentence(name) ||
            paramLocFields
              .find((entry) => entry.key === parameterLocKey(name))
              ?.field.get()
              .trim() ||
            name
        ),
      },
      { formats, imageUrl: textureUrl, fullImageUrl: fullUrl }
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
 * lines the modder touched and leaves their file alone. Null when a change
 * cannot be one property: the whole block goes instead, which says the same
 * thing and is still surgical.
 */
function changedProperties(): { key: string; value: string | null }[] | null {
  if (!baseline) return null;
  const out: { key: string; value: string | null }[] = [];
  for (const spec of specs) {
    if (loaded?.verbatim.has(spec.key)) continue;
    const lines = fieldLines(spec, state.values[spec.key]);
    const was = fieldLines(spec, baseline.values[spec.key]);
    if (lines.join("\n") === was.join("\n")) continue;
    const text = lines.join("\n");
    out.push({ key: spec.key, value: text === "" ? null : text.slice(spec.key.length + 3) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Loading a definition
// ---------------------------------------------------------------------------

function applyForm(next: DefinitionForm, keepName?: string): void {
  form = next;
  specs = traditionFieldSpecs(next);
  loaded = next.current ? loadTradition(specs, next.current.text) : null;
  state = loaded ? loaded.state : emptyState(specs);
  baseline = loaded ? (JSON.parse(JSON.stringify(loaded.state)) as TraditionState) : null;

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
  // A loaded tradition already sets parameters; their sentences decide whether
  // the form has to ask for one.
  askForLoc(currentParameters().map(parameterLocKey));
}

function parseName(text: string): string {
  return /^\s*([^\s{}="#]+)/.exec(text)?.[1] ?? "";
}

/** The game's own traditions all carry the `tradition_` prefix (196 of 196,
 *  measured), and `add_tradition` names them by that key. */
function defaultName(): string {
  return `tradition_${init?.prefix ?? "mymod"}`;
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
      placeholder: isDesc ? "What the tooltip says about this tradition." : titleCaseFromName(name),
      doc: isDesc
        ? "What the tooltip says about the tradition. Written into your mod's localization."
        : "What the player sees. Written into your mod's localization.",
    });
    // BOTH keys start filled, with the name made readable. A save only writes
    // the keys that have a value, so an empty description used to write no
    // `<key>_desc` at all and the game printed the raw key in its place.
    field.onChange(() => refreshPreview());
    return { key, field };
  });
  // An existing definition already has words in the workspace: show them
  // instead of the title-cased key, so an opened tradition reads as in game.
  if (form.current && parseName(form.current.text) === name) {
    post({ type: "loc", keys: locFields.map((entry) => entry.key) });
  }
}

/**
 * The loc keys follow the name, so a rename rebuilds them. Text the modder
 * typed is kept; the value the panel filled in follows the new name, which is
 * what makes a freshly named tradition readable with nothing else touched.
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
// Saving
// ---------------------------------------------------------------------------

/**
 * Everything a save says, or null when the form is not saveable yet (a name the
 * engine cannot read). Both the Save button and a script box's "Edit in the
 * file" go through it: the file a modder is sent to has to hold what the form
 * says.
 */
function savePayload(): TraditionSave | null {
  if (!form) return null;
  const name = currentName();
  const problem = nameProblem(name);
  if (problem) {
    toast(problem, "destructive");
    return null;
  }
  const changed = mode === "edit" ? changedProperties() : null;
  return {
    name,
    mode,
    block: buildBlock(),
    ...(changed ? { changed } : {}),
    // The tradition's own two keys, plus a sentence for each parameter the
    // workspace does not already word.
    loc: [...locFields, ...paramLocFields]
      .map((entry) => ({ key: entry.key, value: entry.field.get().trim() }))
      .filter((pair) => pair.value !== ""),
    ...(form.current && mode === "edit" ? { sourceFile: baseName(form.current.file) } : {}),
  };
}

/** The override warning, asked once wherever a write is about to happen. */
function confirmOverride(name: string): Promise<boolean> {
  return confirmDialog({
    title: `Override the game's ${name}?`,
    description:
      "A mod definition with the same key replaces the game's whole tradition, so it stops receiving " +
      "changes from every future game patch. Partial overrides do not exist.",
    confirmLabel: "Override",
    destructive: true,
  });
}

async function save(): Promise<void> {
  const payload = savePayload();
  if (!payload) return;
  if (mode === "override" && !(await confirmOverride(payload.name))) return;
  post({ type: "save", save: payload });
}

/** The way out of every script box: save, then open the block in the editor. */
async function openInFile(): Promise<void> {
  const payload = savePayload();
  if (!payload) return;
  if (mode === "override" && !(await confirmOverride(payload.name))) return;
  post({ type: "openFile", name: payload.name, save: payload });
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

const MODES: { value: SaveMode; label: string; description: string }[] = [
  {
    value: "duplicate",
    label: "Duplicate",
    description: "A new tradition of your own, under a new key. The game's stays as it is.",
  },
  {
    value: "override",
    label: "Override",
    description: "Same key, in your mod. Replaces the game's whole tradition, patches included.",
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
        if (currentName() === original) nameInput.value = `tradition_${init?.prefix ?? "mymod"}_${original}`;
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
  // The same form, with nothing loaded into it: a blank tradition needs no
  // round trip, since the form never depended on which one was open.
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
  const items = (form?.existing ?? []).map((def) => {
    const where = SOURCE_HINT[def.source ?? "mod"] ?? def.source ?? "";
    return {
      value: def.name,
      label: def.label || def.name,
      hint: def.label ? `${def.name} · ${where}` : where,
    };
  });
  if (items.length === 0) {
    toast("No tradition is indexed yet. Wait for the index, or just make a new one.");
    return;
  }
  menu(byId("open"), items, { search: true, width: 340, onPick: (name) => post({ type: "load", name }) });
};

revealButton.onclick = () => {
  if (form?.current) post({ type: "revealSource", file: form.current.file, line: form.current.line });
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
    case "init":
      init = message.init;
      problemBox.hidden = message.init.problem === undefined;
      problemBox.textContent = message.init.problem ?? "";
      applyForm(message.init.form);
      break;
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
      costLines = message.lines ?? {};
      render();
      break;
    case "images": {
      // A host that does not say which cap it decoded at answers both.
      const into =
        message.maxDim === undefined
          ? [thumbUrls, fullUrls]
          : [message.maxDim === FULL_DIM ? fullUrls : thumbUrls];
      for (const urls of into) for (const [key, url] of Object.entries(message.urls)) urls.set(key, url);
      // The form is not redrawn: a picture arriving while a modder types must
      // not take their field away. Every image carries its own path.
      paintImages();
      refreshPreview();
      break;
    }
    case "loc": {
      for (const [key, value] of Object.entries(message.values)) {
        locValues.set(key, value);
        const entry = locFields.find((e) => e.key === key);
        if (entry) entry.field.set(value);
      }
      for (const [key, text] of Object.entries(message.texts ?? {})) locTexts.set(key, text);
      render();
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
