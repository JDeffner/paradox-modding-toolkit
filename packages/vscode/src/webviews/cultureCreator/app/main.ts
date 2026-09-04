/**
 * The Culture Creator app: compose a CK3 culture out of the game's own pillars,
 * traditions, name lists and art sets, and watch it fill in the culture window
 * while you do it.
 *
 * Every list it offers arrives from the language server (paradox/definitionForm)
 * or from the game's own files (the host's catalog), and every value shape it
 * writes is the vanilla file's (app/script.ts). The form holds no key name of
 * its own beyond the sections it groups them into: keys it has a widget for are
 * drawn there, and everything else the request returns lands in "Advanced" as
 * raw script, so a game patch that adds a key is reachable the day it ships
 * (AD-5: annotate, never hide).
 *
 * The preview on the right is game/gui/window_culture.gui, not a design: the
 * name over the culture's color, the pillar row, the traditions grid with the
 * count the window prints beside it, and the game's own description text on
 * hover.
 */
import type { DefinitionFormKey, EventVocabularyItem } from "@px-lsp/protocol/protocol";
import { isValidScriptDate, parseScriptDate, type CalendarSetting } from "@px-lsp/protocol/calendar";
import { iconEl } from "../../shared/icons";
import { menu, popover, toast } from "../../shared/overlay";
import { scrubbable } from "../../shared/scrub";
import { scriptSection } from "../../shared/scriptSection";
import { saveTargetLine } from "../../shared/saveTarget";
import { sidePanel } from "../../shared/sidePanel";
import { clampToViewport, installTips } from "../../shared/tips";
import { traditionIcon as traditionIconEl } from "../../shared/traditionIcon";
import {
  colorField,
  filterVocabulary,
  locField,
  multiRefField,
  refField,
  scriptField,
  textField,
  titleCaseFromName,
  type Field,
} from "../../shared/fields";
import type { AppToHost, CultureInit, HostToApp, SaveMode } from "../messages";
import {
  changedProperties,
  firstValues,
  locKeyFor,
  parseBlock,
  type ParsedBlock,
} from "../../shared/scriptBlock";
import {
  buildBlock,
  dlcTraditionStatements,
  dlcTraditionsOf,
  inlineList,
  multiList,
  numberList,
  numbersOf,
  rgbList,
  rgbOf,
  sameDlcTraditions,
  tokensOf,
  weightList,
  weightRowsOf,
  type DlcTradition,
} from "./script";
import { flatIcon, maskedArt } from "./gameArt";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: AppToHost): void => vscode.postMessage(m);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
installTips();

/** The five pillar keys, in the order the vanilla files write them. */
const PILLARS = ["ethos", "heritage", "language", "martial_custom", "head_determination"] as const;
/** The art sets: one inline list each (00_arabic.txt `coa_gfx = { … }`). */
const GFX = ["coa_gfx", "building_gfx", "clothing_gfx", "unit_gfx"] as const;
/** Two numbers each, the way the file writes them. */
const PAIRS = ["house_coa_mask_offset", "house_coa_mask_scale"] as const;
/**
 * Where the engine reads a pillar's picture. `CulturePillar.GetIcon` in
 * window_culture.gui resolves to this folder; measured, the file is named after
 * the pillar for ethos and martial_custom and after the FAMILY for heritage and
 * language (heritage.dds, language.dds), and head_determination has none.
 */
const PILLAR_ICONS = "gfx/interface/icons/culture_pillars";
/**
 * The ethos is the one pillar family the game draws as a painted banner rather
 * than as an icon (window_culture.gui, container_pillar_item: a 592x130
 * `highlight_icon` in a box the culture window overrides to 400x100), and its
 * files are 1200x260 where the other pillar icons are 120x120.
 */
const ETHOS = "ethos";
/** The color the flat-icon template tints through (gameArt.ts). */
const COLORS_TEXTURE = "gfx/interface/colors/colors_textured.dds";
/** The rough-edge cutout the ethos banner is drawn with (gameArt.ts). */
const MASK_TEXTURE = "gfx/interface/component_masks/mask_rough_edges.dds";
/** Decodes per request, so a folder of hundreds never blocks the extension host. */
const IMAGE_CHUNK = 40;
/**
 * How big each picture is decoded. One number per kind, because a downscale
 * that suits a chip ruins the two textures that are read by their geometry:
 * colors_textured.dds is ten 96px cells across and the mask is a nine-slice.
 */
const IMAGE_DIM = 64;
/** The pillar icons' own size; the culture window draws them at 44x44. */
const PILLAR_DIM = 120;
/** The tradition layer files are 545x285 and the game's tile is 276 wide. */
const TRADITION_DIM = 276;
/** The ethos banner, at twice the game's 400px box so it stays sharp. */
const ETHOS_DIM = 800;
/** Both texture atlases are asked for whole: their cells are the geometry. */
const COLORS_DIM = 960;
const MASK_DIM = 300;
/** icon_doctrine size = { 44 44 } in window_culture.gui. */
const PILLAR_ICON_PX = 44;
/** container_pillar_item's box in the culture window: blockoverride 400x100. */
const ETHOS_BOX_W = 400;
const ETHOS_BOX_RATIO = 4;

const NAME_RE = /^[a-z][a-z0-9_]*$/;

/** What the mono key under a loc field says on hover. */
const KEY_TIP =
  "The loc key the game looks up. It is built from the culture key in the top-left field, so it changes with it and cannot be typed here.";

/** One key the form binds to: what it writes now, and how to load a value in. */
interface Bound {
  key: string;
  read(): string | null;
}

let init: CultureInit | null = null;
/** The block as the file has it, when one was loaded; null for a new culture. */
let source: ParsedBlock | null = null;
/** The values of the block currently loaded, keyed; empty for a new culture. */
let currentValues = new Map<string, string>();
/** What each bound key said when the block was loaded; the changed-key baseline. */
let loaded = new Map<string, string | null>();
let bound: Bound[] = [];
let locRows: { pattern: string; field: Field<string>; touched: boolean }[] = [];
let mode: SaveMode = "create";
/** The name the block was loaded under, for duplicate/override and the file pick. */
let sourceName = "";
/** `dlc_tradition` is written more than once, so it is rows and not a field. */
let dlcRows: DlcTradition[] = [];
let loadedDlcRows: DlcTradition[] = [];
/** What the preview draws, kept as the fields change so it never re-reads them. */
let pillarPicks = new Map<string, string>();
let traditionPicks: string[] = [];

const nameInput = $<HTMLInputElement>("name");

/** Where the next save lands, shown from the moment the form loads. */
const target = saveTargetLine(() => send({ type: "changeTarget" }));
target.set(null);
$("target").append(target.el);

/** The block a save will write, as an ordinary section of the form. */
const script = scriptSection({
  note: "This is what your mod file will contain.",
  onCopy: (text) => send({ type: "copy", text }),
});
$("scriptSlot").replaceWith(script.el);
$("scriptCopy").replaceWith(script.copyButton);

// ---------------------------------------------------------------------------
// Pictures: the app names game asset paths, the host answers with URLs
// ---------------------------------------------------------------------------

/** rel -> the URL the host gave, or null when no root has the file. */
const images = new Map<string, string | null>();
/** rel -> the decode size it was asked at; one request carries one size. */
const queued = new Map<string, number>();
const queue: string[] = [];
let inFlight = false;

function pump(): void {
  if (inFlight || queue.length === 0) return;
  // `maxDim` is per message, so a batch only ever holds keys of one size.
  const dim = queued.get(queue[0]) ?? IMAGE_DIM;
  const keys: string[] = [];
  for (let i = 0; i < queue.length && keys.length < IMAGE_CHUNK;) {
    if ((queued.get(queue[i]) ?? IMAGE_DIM) === dim) keys.push(queue.splice(i, 1)[0]);
    else i++;
  }
  inFlight = true;
  send({ type: "images", keys, maxDim: dim });
}

/** The picture for a game-relative path, asking for it the first time. */
function imageUrl(rel: string, maxDim = IMAGE_DIM): string | null {
  const known = images.get(rel);
  if (known !== undefined) return known;
  if (!queued.has(rel)) {
    queued.set(rel, maxDim);
    queue.push(rel);
    pump();
  }
  return null;
}

/** The first of several candidate paths that resolved (a pillar's own icon, then its family's). */
function firstImage(rels: readonly string[], maxDim = IMAGE_DIM): string | null {
  for (const rel of rels) {
    const url = imageUrl(rel, maxDim);
    if (url) return url;
  }
  return null;
}

/** The two files a pillar's picture may be, most specific first. */
function pillarIcons(value: string, family: string): string[] {
  return value === "" ? [] : [`${PILLAR_ICONS}/${value}.dds`, `${PILLAR_ICONS}/${family}.dds`];
}

/** A pillar's picture at the size its family is drawn at. */
function pillarImage(value: string, family: string): string | null {
  return firstImage(pillarIcons(value, family), family === ETHOS ? ETHOS_DIM : PILLAR_DIM);
}

/**
 * What a pillar's own picture has to be, behind the (i) on its row. A pillar
 * is picked here rather than drawn, but a modder who writes one needs the file
 * that goes with it.
 *
 * Measured in game/gfx/interface/icons/culture_pillars: the seven ethos files
 * are 1200 x 260 and the other eight are 120 x 120, all 32-bit with an alpha
 * channel. The boxes they are drawn in are the culture window's
 * (window_culture.gui: 400 x 100 for the ethos banner, 44 x 44 for an icon).
 */
function pillarArtInfo(family: string): string {
  const where = `The game reads ${PILLAR_ICONS}/<the pillar's key>.dds, and falls back to ${PILLAR_ICONS}/${family}.dds. DDS, and any picture format converts to one.`;
  return family === ETHOS
    ? `1200 x 260 pixels: the size all seven of the game's ethos banners are, measured. The culture window stretches it into a 400 x 100 box and cuts it out with a rough-edge mask, so paint to the edges and let the mask do the shaping. Transparency is kept. ${where}`
    : `120 x 120 pixels: the size the game's other eight pillar icons are, measured. The window draws it at 44 x 44 and tints the silhouette through its own color table, so give it a transparent background and a solid shape. ${where}`;
}

/** Fill in every placeholder whose picture has since arrived. */
function paintImages(): void {
  for (const img of Array.from(document.querySelectorAll<HTMLImageElement>("img[data-rel]"))) {
    const url = images.get(img.dataset.rel ?? "");
    if (url) {
      img.src = url;
      img.hidden = false;
    }
  }
}

/**
 * A tradition's icon: the game stacks one file per layer folder in index order
 * (CULTURE_TRADITION_LAYER_PATHS), which the shared composer draws in the order
 * the host resolved them.
 */
function traditionIcon(name: string, size: number): HTMLElement {
  const layers = init?.catalog.traditions[name]?.layers ?? [];
  return traditionIconEl(
    layers.map((rel) => ({ rel })),
    size,
    (rel) => imageUrl(rel, TRADITION_DIM)
  );
}

// ---------------------------------------------------------------------------
// Small widgets this form needs and no other creator does
// ---------------------------------------------------------------------------

function el(tag: string, cls = "", text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fieldRow(label: string, doc: string | undefined, control: HTMLElement): HTMLElement {
  const row = el("div", "px-field");
  const span = el("span", "px-label", label);
  if (doc) {
    span.dataset.tip = doc;
    span.dataset.tipWrap = "";
    span.style.cursor = "help";
  }
  row.append(span, control);
  return row;
}

function ghost(label: string, name: Parameters<typeof iconEl>[0]): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "px-btn";
  button.dataset.variant = "ghost";
  button.dataset.size = "xs";
  button.append(iconEl(name), label);
  return button;
}

function iconButton(name: Parameters<typeof iconEl>[0], tip: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "px-btn";
  button.dataset.variant = "ghost";
  button.dataset.size = "icon-sm";
  button.dataset.tip = tip;
  button.append(iconEl(name));
  return button;
}

function numberInput(value: number | null, onCommit: () => void): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "px-input";
  input.dataset.size = "sm";
  input.type = "number";
  input.step = "0.01";
  input.value = value === null ? "" : String(value);
  input.addEventListener("change", onCommit);
  scrubbable(input, { step: 0.01, onChange: () => undefined, onCommit });
  return input;
}

/**
 * Chips over values that are NOT definitions: an art set names a folder of
 * portraits, not something the index can list, so the offer is what the game
 * and the mods already write for the key (DefinitionFormKey.sampled) and a
 * typed name is always allowed.
 */
function tokenListField(
  label: string,
  doc: string | undefined,
  suggestions: readonly string[],
  placeholder: string,
  values: string[],
  onChange: () => void
): { el: HTMLElement; read(): string[] } {
  let current = [...values];
  const box = el("div", "px-chips");
  const add = ghost("Add", "plus");
  const empty = el("span", "px-muted px-xs", placeholder);
  const paint = (): void => {
    box.replaceChildren();
    for (const value of current) {
      const chip = el("span", "px-chip");
      chip.append(el("span", "", value));
      const drop = document.createElement("button");
      drop.className = "px-btn";
      drop.dataset.variant = "ghost";
      drop.dataset.size = "icon-xs";
      drop.dataset.tip = `Remove ${value}`;
      drop.append(iconEl("x"));
      drop.onclick = () => {
        current = current.filter((v) => v !== value);
        paint();
        onChange();
      };
      chip.append(drop);
      box.append(chip);
    }
    if (current.length === 0 && placeholder !== "") box.append(empty);
    box.append(add);
  };
  add.onclick = () => {
    searchPopover(add, `Search, or type a name`, (query, body, close) => {
      body.replaceChildren();
      const take = (value: string): void => {
        if (value !== "" && !current.includes(value)) current.push(value);
        paint();
        onChange();
        close();
      };
      const matches = filterVocabulary(
        suggestions.map((value) => ({ value })),
        query
      ).filter((item) => !current.includes(item.value));
      const typed = query.trim();
      if (typed !== "" && !matches.some((item) => item.value === typed)) {
        const row = el("div", "px-menu-item");
        row.append(iconEl("plus"), el("span", "px-grow", typed), el("span", "px-menu-hint", "add"));
        row.onclick = () => take(typed);
        body.append(row);
      }
      for (const item of matches.slice(0, 200)) {
        const row = el("div", "px-menu-item", item.value);
        row.setAttribute("role", "option");
        row.onclick = () => take(item.value);
        body.append(row);
      }
      if (matches.length === 0 && typed === "")
        body.append(el("div", "px-menu-empty", "Nothing indexed for this key."));
    });
  };
  paint();
  return { el: fieldRow(label, doc, box), read: () => [...current] };
}

/** A search box over a list, in a popover; the shape every picker here takes. */
function searchPopover(
  anchor: HTMLElement,
  placeholder: string,
  render: (query: string, body: HTMLElement, close: () => void) => void
): void {
  const root = el("div", "px-picker");
  root.style.width = "320px";
  const group = el("div", "px-input-group");
  group.append(iconEl("search"));
  const search = document.createElement("input");
  search.className = "px-input";
  search.dataset.size = "sm";
  search.placeholder = placeholder;
  search.spellcheck = false;
  group.append(search);
  const body = el("div", "px-picker-results");
  root.append(group, body);
  const close = popover(anchor, root);
  const fill = (): void => render(search.value, body, close);
  search.oninput = fill;
  fill();
  search.focus();
}

/**
 * The traditions a culture has: chips with the composed icon, added from a
 * picker grouped by `category` the way the game's own Add Tradition view groups
 * them, each entry carrying its picture and the line the player reads.
 */
function traditionsField(
  values: readonly string[],
  onChange: () => void
): { el: HTMLElement; read(): string[] } {
  let current = [...values];
  const box = el("div", "px-chips");
  const add = ghost("Add tradition", "plus");
  const items = (): EventVocabularyItem[] => optionsOf("culture_tradition");
  // A tradition the game does not have yet is its own creator; this only opens it.
  const create = ghost("New tradition", "filePlus");
  create.dataset.tip = "Design a new tradition in the Tradition Creator, then add it here.";
  create.onclick = () => send({ type: "editTradition", name: "" });
  const paint = (): void => {
    box.replaceChildren();
    for (const value of current) {
      const chip = el("span", "px-chip");
      chip.append(traditionIcon(value, 16), el("span", "", labelOf(value)));
      const edit = document.createElement("button");
      edit.className = "px-btn";
      edit.dataset.variant = "ghost";
      edit.dataset.size = "icon-xs";
      edit.dataset.tip = `Open ${value} in the Tradition Creator`;
      edit.append(iconEl("pencil"));
      edit.onclick = () => send({ type: "editTradition", name: value });
      const drop = document.createElement("button");
      drop.className = "px-btn";
      drop.dataset.variant = "ghost";
      drop.dataset.size = "icon-xs";
      drop.dataset.tip = `Remove ${value}`;
      drop.append(iconEl("x"));
      drop.onclick = () => {
        current = current.filter((v) => v !== value);
        paint();
        onChange();
      };
      chip.append(edit, drop);
      box.append(chip);
    }
    if (current.length === 0)
      box.append(el("span", "px-muted px-xs", "No tradition yet. The game allows several."));
    box.append(add, create);
  };
  add.onclick = () =>
    searchPopover(add, "Search traditions…", (query, body, close) => {
      body.replaceChildren();
      const matches = filterVocabulary(items(), query).filter((item) => !current.includes(item.value));
      if (matches.length === 0) {
        body.append(el("div", "px-menu-empty", "No match"));
        return;
      }
      // Grouped by the tradition's own `category`, which is what the game's
      // Add Tradition view groups by; anything without one goes last.
      const groups = new Map<string, EventVocabularyItem[]>();
      for (const item of matches) {
        const category = init?.catalog.traditions[item.value]?.category ?? "other";
        const bucket = groups.get(category);
        if (bucket) bucket.push(item);
        else groups.set(category, [item]);
      }
      const order = [...groups.keys()].sort((a, b) =>
        a === "other" ? 1 : b === "other" ? -1 : a.localeCompare(b)
      );
      let drawn = 0;
      for (const category of order) {
        body.append(el("div", "catgroup", readable(category)));
        for (const item of groups.get(category)!) {
          if (drawn++ >= 300) break;
          const row = el("div", "px-menu-item");
          row.setAttribute("role", "option");
          row.dataset.twoLine = "";
          row.append(traditionIcon(item.value, 24));
          const face = el("span", "px-grow", item.label || item.value);
          const desc = init?.catalog.descs[item.value];
          if (desc) face.append(el("span", "px-menu-description", desc));
          row.append(face, el("span", "px-menu-hint", item.value));
          row.onclick = () => {
            current.push(item.value);
            paint();
            onChange();
            close();
          };
          body.append(row);
        }
      }
    });
  paint();
  return { el: fieldRow("Traditions", docOf("traditions"), box), read: () => [...current] };
}

/**
 * `dlc_tradition = { trait = X requires_dlc_flag = Y fallback = Z }`: a
 * tradition the culture only gets when a DLC is on, with the one it falls back
 * to otherwise. A culture may write several (00_balto_finnic.txt writes two).
 */
function dlcTraditionRows(onChange: () => void): { el: HTMLElement; read(): DlcTradition[] } {
  const box = el("div", "px-stack");
  const add = ghost("Add DLC tradition", "plus");
  const pickRow = (
    caption: string,
    doc: string,
    value: string,
    items: readonly EventVocabularyItem[],
    commit: (picked: string) => void
  ): HTMLElement => {
    const field = refField({
      label: caption,
      doc,
      items,
      value,
      placeholder: pickerPlaceholder(items[0]?.value),
    });
    field.onChange(commit);
    return field.el;
  };
  const paint = (): void => {
    box.replaceChildren();
    dlcRows.forEach((row, index) => {
      const card = el("div", "dlcrow");
      const head = el("div", "dlchead");
      head.append(el("span", "", `DLC tradition ${index + 1}`));
      const drop = iconButton("x", "Remove this DLC tradition");
      drop.onclick = () => {
        dlcRows.splice(index, 1);
        paint();
        onChange();
      };
      head.append(drop);
      const traditions = optionsOf("culture_tradition");
      card.append(
        head,
        pickRow(
          "Tradition",
          "The tradition the culture gets when the DLC is on",
          row.trait,
          traditions,
          (v) => {
            row.trait = v;
            onChange();
          }
        ),
        pickRow(
          "Requires DLC",
          "The DLC flag the tradition needs",
          row.requires_dlc_flag,
          (init?.catalog.dlcFlags ?? []).map((value) => ({ value })),
          (v) => {
            row.requires_dlc_flag = v;
            onChange();
          }
        ),
        pickRow(
          "Fallback",
          "The tradition used instead when the DLC is off. Vanilla leaves it out as often as not.",
          row.fallback,
          traditions,
          (v) => {
            row.fallback = v;
            onChange();
          }
        )
      );
      box.append(card);
    });
    box.append(add);
  };
  add.onclick = () => {
    dlcRows.push({ trait: "", requires_dlc_flag: "", fallback: "" });
    paint();
    onChange();
  };
  paint();
  return { el: fieldRow("DLC traditions", docOf("dlc_tradition"), box), read: () => dlcRows };
}

/** `ethnicities = { 100 = arab }`: a weight and an ethnicity per row. */
function weightRowsField(
  label: string,
  doc: string | undefined,
  suggestions: readonly string[],
  rows: { weight: number; value: string }[],
  onChange: () => void
): { el: HTMLElement; read(): { weight: number; value: string }[] } {
  const current = rows.map((r) => ({ ...r }));
  const box = el("div", "px-stack");
  const add = ghost("Add ethnicity", "plus");
  const paint = (): void => {
    box.replaceChildren();
    current.forEach((row, i) => {
      const line = el("div", "wrow");
      const weight = numberInput(row.weight, () => {
        row.weight = Number(weight.value) || 0;
        onChange();
      });
      weight.step = "1";
      weight.dataset.tip = "How common this ethnicity is inside the culture.";
      const name = document.createElement("input");
      name.className = "px-input";
      name.dataset.size = "sm";
      name.value = row.value;
      name.spellcheck = false;
      name.placeholder = suggestions[0] ?? "ethnicity";
      name.addEventListener("change", () => {
        row.value = name.value.trim();
        onChange();
      });
      const pick = iconButton("chevronDown", "Ethnicities the game's own cultures use");
      pick.onclick = () =>
        menu(
          pick,
          suggestions.map((value) => ({ value, label: value })),
          {
            value: row.value,
            width: 240,
            onPick: (picked) => {
              row.value = picked;
              name.value = picked;
              onChange();
            },
          }
        );
      const drop = iconButton("x", "Remove this row");
      drop.onclick = () => {
        current.splice(i, 1);
        paint();
        onChange();
      };
      line.append(weight, name, pick, drop);
      box.append(line);
    });
    box.append(add);
  };
  add.onclick = () => {
    current.push({ weight: 100, value: "" });
    paint();
    onChange();
  };
  paint();
  return { el: fieldRow(label, doc, box), read: () => current.filter((r) => r.value.trim() !== "") };
}

/** Two numbers on one row (`house_coa_mask_offset = { 0.0 -0.03 }`). */
function numberPairField(
  label: string,
  doc: string | undefined,
  values: number[],
  onChange: () => void
): { el: HTMLElement; read(): (number | null)[] } {
  const row = el("div", "pair");
  const read = (input: HTMLInputElement): number | null =>
    input.value.trim() === "" ? null : Number(input.value);
  const x = numberInput(values[0] ?? null, onChange);
  const y = numberInput(values[1] ?? null, onChange);
  row.append(x, y);
  return { el: fieldRow(label, doc, row), read: () => [read(x), read(y)] };
}

/**
 * The culture color: a name from common/named_colors (`color = bedouin`) or
 * three components (`color = { 0.3 0.95 0.3 }`). Both are vanilla, so both are
 * offered rather than one being invented as the right one.
 */
function colorRow(
  raw: string | undefined,
  onChange: () => void
): { el: HTMLElement; read(): string | null; rgb(): [number, number, number] | null } {
  const named = init?.namedColors ?? {};
  const rgb = rgbOf(raw);
  // A culture that has no color yet starts on the named list, because that is
  // what most of the game's own cultures write (00_arabic.txt: `color =
  // bedouin`); a loaded block keeps whichever of the two shapes IT uses.
  let useNamed = raw === undefined || rgb === null;
  let name = raw !== undefined && rgb === null ? raw : "";
  const row = el("div", "px-row");
  const group = el("div", "px-toggle-group");
  const picker = colorField({ label: "", value: rgb ?? null });
  const custom = picker.el.lastElementChild as HTMLElement;
  const trigger = document.createElement("button");
  trigger.className = "px-btn px-dropdown";
  trigger.dataset.variant = "outline";
  trigger.dataset.size = "sm";
  const face = el("span", "px-truncate");
  trigger.append(face, iconEl("chevronDown"));
  const swatchCss = (c: [number, number, number]): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  const paint = (): void => {
    face.textContent = name || Object.keys(named).sort()[0] || "pick a color";
    if (name) trigger.removeAttribute("data-placeholder");
    else trigger.dataset.placeholder = "";
    trigger.hidden = !useNamed;
    custom.hidden = useNamed;
    for (const button of Array.from(group.children) as HTMLElement[]) {
      button.setAttribute("aria-pressed", String(button.dataset.value === (useNamed ? "named" : "custom")));
    }
  };
  for (const [value, label] of [
    ["named", "Named"],
    ["custom", "Custom"],
  ]) {
    const button = document.createElement("button");
    button.className = "px-toggle";
    button.dataset.size = "sm";
    button.dataset.value = value;
    button.textContent = label;
    button.onclick = () => {
      useNamed = value === "named";
      paint();
      onChange();
    };
    group.append(button);
  }
  trigger.onclick = () =>
    menu(
      trigger,
      Object.entries(named)
        .map(([key, value]) => ({ key, value }))
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(({ key, value }) => ({ value: key, label: key, swatch: swatchCss(value) })),
      {
        value: name,
        search: true,
        width: 260,
        onPick: (picked) => {
          name = picked;
          paint();
          onChange();
        },
      }
    );
  picker.onChange(onChange);
  row.append(group, trigger, custom);
  paint();
  const rgbNow = (): [number, number, number] | null => (useNamed ? (named[name] ?? null) : picker.get());
  return {
    el: fieldRow("Color", "The color of the culture, used e.g. on the map", row),
    read: () => {
      if (useNamed) return name === "" ? null : name;
      const value = picker.get();
      return value ? rgbList(value) : null;
    },
    rgb: rgbNow,
  };
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

function section(id: string): HTMLElement {
  $(`sec-${id}`).hidden = false;
  return $(`rows-${id}`);
}

function keyOf(key: string): DefinitionFormKey | undefined {
  return init?.form.keys.find((k) => k.key === key);
}

function docOf(key: string): string | undefined {
  return keyOf(key)?.doc;
}

/**
 * What an empty input shows: the literal the game itself writes most often for
 * the key, or the first of its sampled value set. An example, never an
 * instruction (px-ui rule).
 */
function exampleOf(key: string): string | undefined {
  const spec = keyOf(key);
  return spec?.example ?? spec?.sampled?.[0];
}

/**
 * What an empty picker reads. `refField` uses one placeholder for BOTH the
 * empty face and the menu's "clear it" row, so the example is written as an
 * aside: as the row's whole label it would read as a value to pick and then
 * clear the field instead.
 */
function pickerPlaceholder(example: string | undefined): string {
  return example ? `not set (e.g. ${example})` : "not set";
}

function optionsOf(kind: string): EventVocabularyItem[] {
  return init?.form.options[kind] ?? [];
}

/** The name the player reads for a definition, falling back to its key. */
function labelOf(value: string): string {
  for (const kind of ["culture_tradition", "culture_pillar", "culture"]) {
    const item = init?.form.options[kind]?.find((i) => i.value === value);
    if (item?.label) return item.label;
  }
  return value;
}

/** The keys with a designed widget; everything else falls to "Advanced". */
function modelledKeys(): Set<string> {
  return new Set<string>([
    "color",
    ...PILLARS,
    "traditions",
    "dlc_tradition",
    "name_list",
    "name_order_convention",
    ...GFX,
    "house_coa_frame",
    ...PAIRS,
    "ethnicities",
    "parents",
    "created",
  ]);
}

function bind(key: string, read: () => string | null): void {
  bound.push({ key, read });
}

function values(): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const b of bound) out.set(b.key, b.read());
  return out;
}

/** The `dlc_tradition` statements, and whether they moved since the load. */
function dlcWrite(): Map<string, { lines: string[]; changed: boolean }> {
  const changed = !sameDlcTraditions(dlcRows, loadedDlcRows);
  const lines = dlcTraditionStatements(dlcRows);
  if (!changed && lines.length === 0 && loadedDlcRows.length === 0) return new Map();
  return new Map([["dlc_tradition", { lines, changed }]]);
}

function currentName(): string {
  return nameInput.value.trim();
}

function block(name: string): string {
  return buildBlock(name, source, values(), loaded, init?.form.keys.map((k) => k.key) ?? [], dlcWrite());
}

function refresh(): void {
  const name = currentName();
  script.set(block(name || "culture"));
  $("saveNote").textContent = missingNote();

  for (const row of locRows) {
    const key = locKeyFor(row.pattern, name);
    const code = row.field.el.querySelector("code");
    if (code) code.textContent = key;
    if (!row.touched) row.field.set(titleCaseFromName(name));
  }
  paintPreview();
}

/** Which pillars are still empty, and how much of vanilla sets them. */
function missingNote(): string {
  const empty = PILLARS.filter((key) => (pillarPicks.get(key) ?? "") === "");
  if (empty.length === 0) return "";
  const freq = keyOf(empty[0])?.freq;
  const how = freq ? ` (${freq} of the game's own cultures set each of them)` : "";
  return `Not set: ${empty.join(", ")}${how}. The game decides what it accepts; save and let ck3-tiger judge.`;
}

function render(): void {
  if (!init) return;
  const { form } = init;
  bound = [];
  locRows = [];
  pillarPicks = new Map();
  const raw = (key: string): string | undefined => currentValues.get(key);

  // --- Identity -----------------------------------------------------------
  const identity = section("identity");
  identity.replaceChildren();
  for (const pattern of form.locPatterns) {
    const field = locField({
      label: locLabel(pattern),
      key: locKeyFor(pattern, currentName()),
      keyTip: KEY_TIP,
      value: titleCaseFromName(currentName()),
      placeholder: titleCaseFromName(currentName()) || "Bedouin",
    });
    const row = { pattern, field, touched: false };
    field.onChange(() => {
      row.touched = true;
      paintPreview();
    });
    locRows.push(row);
    identity.append(field.el);
  }
  const color = colorRow(raw("color"), refresh);
  bind("color", color.read);
  bandColor = color.rgb;
  identity.append(color.el);

  // --- Pillars ------------------------------------------------------------
  const pillars = section("pillars");
  pillars.replaceChildren();
  for (const key of PILLARS) {
    // One folder holds all five families; the server labels each option with
    // the `type` its own block declares, which is what splits the pickers.
    const items = optionsOf("culture_pillar").filter((i) => i.group === key || i.group === undefined);
    const field = refField({
      label: label(key),
      doc: docOf(key),
      info: pillarArtInfo(key),
      items,
      value: raw(key) ?? "",
      placeholder: pickerPlaceholder(exampleOf(key) ?? items[0]?.value),
      thumb: (value) => pillarImage(value, key),
    });
    pillarPicks.set(key, raw(key) ?? "");
    field.onChange((value) => {
      pillarPicks.set(key, value);
      refresh();
    });
    bind(key, () => field.get() || null);
    pillars.append(field.el);
  }

  // --- Traditions ---------------------------------------------------------
  const traditions = section("traditions");
  traditions.replaceChildren();
  traditionPicks = tokensOf(raw("traditions"));
  const tradField = traditionsField(traditionPicks, () => {
    traditionPicks = tradField.read();
    refresh();
  });
  bind("traditions", () => multiList(tradField.read()));
  traditions.append(tradField.el);
  loadedDlcRows = dlcTraditionsOf(source);
  dlcRows = loadedDlcRows.map((row) => ({ ...row }));
  traditions.append(dlcTraditionRows(refresh).el);

  // --- Names --------------------------------------------------------------
  const names = section("names");
  names.replaceChildren();
  const nameList = refField({
    label: "Name list",
    doc: docOf("name_list"),
    items: optionsOf("name_list"),
    value: raw("name_list") ?? "",
    placeholder: pickerPlaceholder(exampleOf("name_list") ?? optionsOf("name_list")[0]?.value),
  });
  nameList.onChange(refresh);
  bind("name_list", () => nameList.get() || null);
  names.append(nameList.el);
  names.append(simpleText("name_order_convention", raw("name_order_convention")));
  const ethnicities = weightRowsField(
    "Ethnicities",
    docOf("ethnicities"),
    keyOf("ethnicities")?.sampled ?? [],
    weightRowsOf(raw("ethnicities")),
    refresh
  );
  bind("ethnicities", () => weightList(ethnicities.read()));
  names.append(ethnicities.el);

  // --- Graphics -----------------------------------------------------------
  const graphics = section("graphics");
  graphics.replaceChildren();
  for (const key of GFX) {
    const list = tokenListField(
      label(key),
      docOf(key),
      keyOf(key)?.sampled ?? [],
      exampleOf(key) ?? "",
      tokensOf(raw(key)),
      refresh
    );
    bind(key, () => inlineList(list.read()));
    graphics.append(list.el);
  }

  // --- Advanced -----------------------------------------------------------
  const advanced = section("advanced");
  advanced.replaceChildren();
  const parents = multiRefField({
    label: "Parents",
    doc: docOf("parents"),
    items: optionsOf("culture"),
    values: tokensOf(raw("parents")),
    addLabel: "Add parent",
  });
  parents.onChange(refresh);
  bind("parents", () => inlineList(parents.get()));
  advanced.append(parents.el);
  const created = textField({
    label: "Created",
    doc: docOf("created"),
    value: raw("created") ?? "",
    placeholder: exampleOf("created") ?? "650.1.1",
    suggestions: keyOf("created")?.sampled ?? [],
  });
  const createdNote = el("div", "note");
  const checkCreated = (): void => {
    const text = created.get();
    const date = text === "" ? null : parseScriptDate(text);
    // Only the month/day bounds are read here (monthsOf), never the era
    // labels, so a workspace with no px.calendar gets the standard months
    // isValidScriptDate falls back to anyway.
    const cal: CalendarSetting = init?.calendar ?? { epoch: 1, after: "AD" };
    createdNote.textContent =
      text !== "" && (date === null || !isValidScriptDate(cal, date.y, date.m, date.d))
        ? `${text} is not a date the game reads. Write it as year.month.day, e.g. 650.1.1.`
        : "";
    refresh();
  };
  created.onChange(checkCreated);
  bind("created", () => created.get() || null);
  advanced.append(created.el, createdNote);
  advanced.append(simpleText("house_coa_frame", raw("house_coa_frame")));
  for (const key of PAIRS) {
    const pair = numberPairField(label(key), docOf(key), numbersOf(raw(key)), refresh);
    bind(key, () => numberList(pair.read()));
    advanced.append(pair.el);
  }
  const modelled = modelledKeys();
  for (const key of form.keys) {
    if (modelled.has(key.key)) continue;
    if (key.values === "block") {
      const field = scriptField({
        label: label(key.key),
        doc: key.doc,
        value: raw(key.key) ?? "",
        placeholder: "{ … }",
        rows: 3,
      });
      field.onChange(refresh);
      bind(key.key, () => field.get().trim() || null);
      advanced.append(field.el);
    } else {
      advanced.append(simpleText(key.key, raw(key.key)));
    }
  }

  // The baseline every "did this change?" question is asked against.
  loaded = values();
  refresh();
}

/** A plain key: free text, with the values the game itself writes behind the chevron. */
function simpleText(key: string, value: string | undefined): HTMLElement {
  const field = textField({
    label: label(key),
    doc: docOf(key),
    value: value ?? "",
    ...(exampleOf(key) ? { placeholder: exampleOf(key)! } : {}),
    suggestions: keyOf(key)?.sampled ?? [],
  });
  field.onChange(refresh);
  bind(key, () => field.get() || null);
  return field.el;
}

/** `head_determination` -> `Head determination`: the key, readable. */
function label(key: string): string {
  return readable(key);
}

function readable(word: string): string {
  const words = word.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a loc pattern asks the modder for. `$` is the culture's own name. */
function locLabel(pattern: string): string {
  if (pattern === "$") return "Name";
  return label(pattern.replace("$_", "").replace("$", ""));
}

// ---------------------------------------------------------------------------
// The preview: the culture window's header
// ---------------------------------------------------------------------------

/** How the color field answers right now; set when the Identity section renders. */
let bandColor: () => [number, number, number] | null = () => null;

const tip = $("pvTip");

function showTip(anchor: HTMLElement, title: string, body: string): void {
  tip.replaceChildren();
  tip.append(el("div", "px-game-tip-title", title));
  if (body) tip.append(el("div", "px-game-tip-body", body));
  tip.hidden = false;
  const box = tip.getBoundingClientRect();
  const at = anchor.getBoundingClientRect();
  const { left, top } = clampToViewport(box, at.left - box.width - 8, at.top);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

/** The game's own description on hover, quoted as the game prints it. */
function withTip(node: HTMLElement, title: string, body: string): HTMLElement {
  node.addEventListener("pointerenter", () => showTip(node, title, body));
  node.addEventListener("pointerleave", () => {
    tip.hidden = true;
  });
  return node;
}

/**
 * The ethos as the culture window draws it: the pillar's art stretched into a
 * 400x100 box, cut out by Mask_Rough_Edges, with its name centred over it.
 */
function paintEthos(): void {
  const slot = $("pvEthos");
  slot.replaceChildren();
  const value = pillarPicks.get(ETHOS) ?? "";
  const box = el("div", "pvethos");
  const url = value === "" ? null : pillarImage(value, ETHOS);
  if (!url) {
    box.dataset.empty = "";
    box.textContent = value === "" ? "No ethos yet" : "No picture for this ethos";
    slot.append(box);
    return;
  }
  // The banner fills the panel, up to the box the game itself gives it.
  const width = Math.min(ETHOS_BOX_W, slot.clientWidth || ETHOS_BOX_W);
  box.append(maskedArt(url, imageUrl(MASK_TEXTURE, MASK_DIM), width, width / ETHOS_BOX_RATIO));
  box.append(el("span", "ename", labelOf(value)));
  slot.append(withTip(box, labelOf(value), init?.catalog.descs[value] ?? value));
}

function paintPreview(): void {
  const name = currentName();
  const shown = locRows[0]?.field.get().trim() || titleCaseFromName(name) || "Your culture";
  $("pvName").textContent = shown;
  $("pvKey").textContent = name || "culture";
  const rgb = bandColor();
  const band = $("pvBand");
  if (rgb) {
    band.style.setProperty("--px-band", `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`);
    // The game prints the culture's name on its color; keep it readable on both
    // a dark and a light one rather than trusting the theme's foreground.
    const luma = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    band.style.setProperty("--px-band-fg", luma > 0.6 ? "#101010" : "#f5f5f5");
  } else {
    band.style.removeProperty("--px-band");
    band.style.removeProperty("--px-band-fg");
  }

  paintEthos();

  const pillars = $("pvPillars");
  pillars.replaceChildren();
  for (const key of PILLARS) {
    if (key === ETHOS) continue; // drawn above, as the banner the game draws
    const value = pillarPicks.get(key) ?? "";
    const row = el("div", "pvpillar");
    // The box keeps its width even when the family has no picture (measured:
    // head_determination ships none), so the rows stay one column.
    const box = el("span", "picon");
    const url = pillarImage(value, key);
    // icon_doctrine tints the black silhouette through colors_textured; the
    // canvas does what the game's template does (gameArt.ts).
    if (url) box.append(flatIcon(url, imageUrl(COLORS_TEXTURE, COLORS_DIM), PILLAR_ICON_PX));
    row.append(box);
    const text = el("div", "ptext");
    text.append(el("span", "pfam", label(key)));
    const named = el("span", "pname", value ? labelOf(value) : "not set");
    if (!value) named.dataset.empty = "";
    text.append(named);
    row.append(text);
    if (value) withTip(row, labelOf(value), init?.catalog.descs[value] ?? value);
    pillars.append(row);
  }

  const grid = $("pvTraditions");
  grid.replaceChildren();
  for (const value of traditionPicks) {
    const tile = el("div", "pvtrad");
    tile.append(traditionIcon(value, 56), el("span", "tname", labelOf(value)));
    grid.append(withTip(tile, labelOf(value), init?.catalog.descs[value] ?? value));
  }
  if (traditionPicks.length === 0)
    grid.append(el("div", "pvempty", "No tradition yet. Add one and it shows up here."));
  $("pvCount").textContent =
    traditionPicks.length === 1 ? "1 tradition" : `${traditionPicks.length} traditions`;
  $("pvNote").textContent = init?.noGame
    ? "The game folder is not set, so the pillars and traditions have no pictures here. Run Setup & Health Check."
    : "";
  $("count-traditions").textContent = `${traditionPicks.length}`;
  $("count-pillars").textContent = `${[...pillarPicks.values()].filter((v) => v !== "").length} of 5`;
}

// ---------------------------------------------------------------------------
// Host messages
// ---------------------------------------------------------------------------

function applyInit(next: CultureInit): void {
  init = next;
  const current = next.form.current;
  const parsed = current ? parseBlock(current.text) : null;
  source = parsed;
  currentValues = parsed ? firstValues(parsed) : new Map();
  sourceName = parsed?.name ?? "";

  nameInput.readOnly = false;
  if (!parsed) {
    mode = "create";
    nameInput.value = `${next.prefix}_culture`;
  } else if (current?.source === "mod") {
    // setProperties targets the definition by name, so an edit cannot rename.
    mode = "edit";
    nameInput.value = parsed.name;
    nameInput.readOnly = true;
  } else {
    mode = "duplicate";
    nameInput.value = `${next.prefix}_${parsed.name}`;
  }

  // Only says something when a culture was LOADED: beside a New button, a
  // badge reading "New" is noise.
  const badge = $("source");
  badge.hidden = current === undefined;
  if (current) badge.textContent = current.source === "mod" ? "your mod" : "the game";

  const banner = $("banner");
  banner.replaceChildren();
  if (next.noMod) {
    banner.append(
      note(
        "No mod folder found. Open your mod folder (the one with the mod's descriptor) as a workspace folder before saving."
      )
    );
  }
  // Only a game culture offers the choice; loading never selects "override".
  $("mode").hidden = parsed === null || current?.source === "mod";
  paintMode();
  render();
  prefetch();
}

/** Ask for every picture the pickers will want, before a menu is ever opened. */
function prefetch(): void {
  // The two atlases the preview composites with, whole: their cells ARE the
  // geometry, so a thumbnail-sized decode would be useless (gameArt.ts).
  imageUrl(COLORS_TEXTURE, COLORS_DIM);
  imageUrl(MASK_TEXTURE, MASK_DIM);
  for (const family of PILLARS) {
    imageUrl(`${PILLAR_ICONS}/${family}.dds`, family === ETHOS ? ETHOS_DIM : PILLAR_DIM);
  }
  for (const item of optionsOf("culture_pillar")) {
    const dim = item.group === ETHOS ? ETHOS_DIM : PILLAR_DIM;
    imageUrl(`${PILLAR_ICONS}/${item.value}.dds`, dim);
  }
  for (const trad of Object.values(init?.catalog.traditions ?? {})) {
    for (const rel of trad.layers) imageUrl(rel, TRADITION_DIM);
  }
}

function note(text: string): HTMLElement {
  return el("div", "note", text);
}

/** A game culture can be copied under a new name, or replaced outright. */
function paintMode(): void {
  const button = $("mode");
  const face = button.firstElementChild as HTMLElement;
  face.textContent = mode === "override" ? "Override" : "Duplicate";
  const banner = $("banner");
  banner.querySelector(".override-warning")?.remove();
  if (mode === "override") {
    const line = note(
      "An override is a whole copy: the game has no partial override, so your copy stops receiving the changes a game patch makes to this culture."
    );
    line.classList.add("override-warning");
    banner.append(line);
  }
}

window.addEventListener("message", (event: MessageEvent<HostToApp>) => {
  const msg = event.data;
  switch (msg.type) {
    case "init":
      applyInit(msg.init);
      break;
    case "images":
      for (const [key, url] of Object.entries(msg.urls)) images.set(key, url);
      inFlight = false;
      pump();
      paintImages();
      // The preview picks between a pillar's own icon and its family's, so it
      // has to choose again once more of them have answered.
      if (init) paintPreview();
      break;
    case "loading":
      // Where the next save goes is not known until the form has answered.
      target.set(null);
      break;
    case "target":
      target.set(msg.target);
      break;
    case "toast":
      toast(msg.message, msg.variant);
      break;
    case "saved":
      toast(`Saved ${msg.name}`);
      loaded = values();
      loadedDlcRows = dlcRows.map((row) => ({ ...row }));
      refresh();
      break;
    case "idle":
      break;
    case "error":
      toast(msg.message, "destructive", 6000);
      break;
  }
});

// ---------------------------------------------------------------------------
// Toolbar and shell
// ---------------------------------------------------------------------------

// Wide enough by default for the ethos banner and the traditions grid at the
// sizes the culture window uses (a 400x100 banner, 276-wide tradition tiles).
sidePanel($("side"), { min: 260, max: 760, width: 460 });

for (const fold of Array.from(document.querySelectorAll<HTMLButtonElement>(".fold"))) {
  fold.onclick = () => {
    const open = fold.getAttribute("aria-expanded") === "true";
    fold.setAttribute("aria-expanded", String(!open));
    const body = fold.nextElementSibling as HTMLElement;
    body.hidden = open;
  };
}

nameInput.addEventListener("change", refresh);
nameInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") nameInput.blur();
});

$("new").onclick = () => send({ type: "new" });

$("open").onclick = () => {
  const items = optionsOf("culture").map((i) => ({
    value: i.value,
    label: i.label || i.value,
    ...(i.label ? { hint: i.value } : i.hint ? { hint: i.hint } : {}),
  }));
  if (items.length === 0) {
    toast("No culture is indexed yet.");
    return;
  }
  menu($("open"), items, { search: true, width: 320, onPick: (name) => send({ type: "load", name }) });
};

$("mode").onclick = () =>
  menu(
    $("mode"),
    [
      { value: "duplicate", label: "Duplicate into my mod", hint: "a new key" },
      { value: "override", label: "Override the game's culture", hint: "its key" },
    ],
    {
      value: mode,
      width: 260,
      onPick: (picked) => {
        mode = picked as SaveMode;
        nameInput.value = picked === "override" ? sourceName : `${init?.prefix ?? "px"}_${sourceName}`;
        nameInput.readOnly = picked === "override";
        paintMode();
        refresh();
      },
    }
  );

$("wiki").onclick = () => send({ type: "openExamples" });

$("save").onclick = () => {
  const name = currentName();
  if (!NAME_RE.test(name)) {
    toast(
      "A culture key is lowercase letters, digits and underscores, starting with a letter.",
      "destructive"
    );
    return;
  }
  const now = values();
  // `setProperties` rewrites ONE statement per key, and a culture may write
  // `dlc_tradition` several times. When those rows moved, the save goes back as
  // the whole block (into the same file) rather than as a key diff that could
  // only touch the last one.
  const dlcMoved = !sameDlcTraditions(dlcRows, loadedDlcRows);
  const loc = locRows
    .map((row) => ({ key: locKeyFor(row.pattern, name), value: row.field.get() }))
    .filter((pair) => pair.value.trim() !== "");
  send({
    type: "save",
    name,
    mode,
    block: block(name),
    ...(mode === "edit" && !dlcMoved ? { changed: changedProperties(loaded, now) } : {}),
    loc,
  });
};

send({ type: "ready" });
