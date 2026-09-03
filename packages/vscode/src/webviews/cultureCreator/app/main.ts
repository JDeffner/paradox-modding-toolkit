/**
 * The Culture Creator app: compose a CK3 culture from the game's own pillars,
 * traditions, name lists and art sets, and write it into the mod.
 *
 * Every list it offers arrives from the language server (paradox/definitionForm)
 * and every value shape it writes is the vanilla file's (app/script.ts). The
 * form holds no key name of its own beyond the sections it groups them into:
 * keys it has a widget for are drawn there, and everything else the request
 * returns lands in "Other keys" as raw script, so a game patch that adds a key
 * is reachable the day it ships (AD-5: annotate, never hide).
 */
import type { DefinitionFormKey, EventVocabularyItem } from "@px-lsp/protocol/protocol";
import { isValidScriptDate, parseScriptDate, type CalendarSetting } from "@px-lsp/protocol/calendar";
import { iconEl } from "../../shared/icons";
import { menu, popover, toast } from "../../shared/overlay";
import { scrubbable } from "../../shared/scrub";
import { installTips } from "../../shared/tips";
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
  buildBlock,
  changedProperties,
  inlineList,
  locKeyFor,
  multiList,
  numberList,
  numbersOf,
  readBlock,
  rgbList,
  rgbOf,
  tokensOf,
  weightList,
  weightRowsOf,
  type BlockChunk,
} from "./script";

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

const NAME_RE = /^[a-z][a-z0-9_]*$/;

/** One key the form binds to: what it writes now, and how to load a value in. */
interface Bound {
  key: string;
  read(): string | null;
}

let init: CultureInit | null = null;
let chunks: BlockChunk[] = [];
/** The values of the block currently loaded, keyed; empty for a new culture. */
let currentValues = new Map<string, string>();
/** What each bound key said when the block was loaded; the changed-key baseline. */
let loaded = new Map<string, string | null>();
let bound: Bound[] = [];
let locRows: { pattern: string; field: Field<string>; touched: boolean }[] = [];
let mode: SaveMode = "create";
/** The name the block was loaded under, for duplicate/override and the file pick. */
let sourceName = "";

const nameInput = $<HTMLInputElement>("name");

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
  values: string[],
  onChange: () => void
): { el: HTMLElement; read(): string[] } {
  let current = [...values];
  const box = el("div", "px-chips");
  const add = ghost("Add", "plus");
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
    box.append(add);
  };
  add.onclick = () => {
    const root = el("div", "px-picker");
    root.style.width = "300px";
    const group = el("div", "px-input-group");
    group.append(iconEl("search"));
    const search = document.createElement("input");
    search.className = "px-input";
    search.dataset.size = "sm";
    search.placeholder = "Search, or type a name";
    search.spellcheck = false;
    group.append(search);
    const body = el("div", "px-picker-results");
    root.append(group, body);
    const close = popover(add, root);
    const take = (value: string): void => {
      if (value !== "" && !current.includes(value)) current.push(value);
      paint();
      onChange();
      close();
    };
    const fill = (): void => {
      body.replaceChildren();
      const matches = filterVocabulary(
        suggestions.map((value) => ({ value })),
        search.value
      ).filter((item) => !current.includes(item.value));
      for (const item of matches.slice(0, 200)) {
        const row = el("div", "px-menu-item", item.value);
        row.setAttribute("role", "option");
        row.onclick = () => take(item.value);
        body.append(row);
      }
      if (matches.length === 0)
        body.append(el("div", "px-menu-empty", "No match. Enter adds what you typed."));
    };
    search.oninput = fill;
    search.onkeydown = (ev) => {
      if (ev.key === "Enter") take(search.value.trim());
    };
    fill();
    search.focus();
  };
  paint();
  return { el: fieldRow(label, doc, box), read: () => [...current] };
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
      name.placeholder = "ethnicity";
      name.addEventListener("change", () => {
        row.value = name.value.trim();
        onChange();
      });
      const pick = document.createElement("button");
      pick.className = "px-btn";
      pick.dataset.variant = "ghost";
      pick.dataset.size = "icon-sm";
      pick.dataset.tip = "Ethnicities the game's own cultures use";
      pick.append(iconEl("chevronDown"));
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
      const drop = document.createElement("button");
      drop.className = "px-btn";
      drop.dataset.variant = "ghost";
      drop.dataset.size = "icon-sm";
      drop.dataset.tip = "Remove this row";
      drop.append(iconEl("x"));
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
function colorRow(raw: string | undefined, onChange: () => void): { el: HTMLElement; read(): string | null } {
  const named = init?.namedColors ?? {};
  const rgb = rgbOf(raw);
  let useNamed = raw !== undefined && rgb === null;
  let name = useNamed ? (raw ?? "") : "";
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
    face.textContent = name || "pick a color";
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
  return {
    el: fieldRow("Color", "The color of the culture, used e.g. on the map", row),
    read: () => {
      if (useNamed) return name === "" ? null : name;
      const value = picker.get();
      return value ? rgbList(value) : null;
    },
  };
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

function section(id: string): HTMLElement {
  const body = $(`body-${id}`);
  $(`sec-${id}`).hidden = false;
  return body;
}

function keyOf(key: string): DefinitionFormKey | undefined {
  return init?.form.keys.find((k) => k.key === key);
}

function docOf(key: string): string | undefined {
  return keyOf(key)?.doc;
}

function optionsOf(kind: string): EventVocabularyItem[] {
  return init?.form.options[kind] ?? [];
}

/** The keys with a designed widget; everything else falls to "Other keys". */
function modelledKeys(): Set<string> {
  return new Set<string>([
    "color",
    ...PILLARS,
    "traditions",
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

function currentName(): string {
  return nameInput.value.trim();
}

function refresh(): void {
  const name = currentName();
  const block = buildBlock(
    name || "culture",
    chunks,
    values(),
    loaded,
    init?.form.keys.map((k) => k.key) ?? []
  );
  $("previewText").textContent = block;
  $("saveNote").textContent = missingNote();

  for (const row of locRows) {
    const key = locKeyFor(row.pattern, name);
    const code = row.field.el.querySelector("code");
    if (code) code.textContent = key;
    if (!row.touched) row.field.set(titleCaseFromName(name));
  }
}

/** Which pillars are still empty, and how much of vanilla sets them. */
function missingNote(): string {
  const empty = PILLARS.filter((key) => (values().get(key) ?? null) === null);
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
  const raw = (key: string): string | undefined => currentValues.get(key);

  // --- Identity -----------------------------------------------------------
  const identity = section("identity");
  identity.replaceChildren();
  for (const pattern of form.locPatterns) {
    const field = locField({
      label: locLabel(pattern),
      key: locKeyFor(pattern, currentName()),
      value: titleCaseFromName(currentName()),
    });
    const row = { pattern, field, touched: false };
    field.onChange(() => {
      row.touched = true;
    });
    locRows.push(row);
    identity.append(field.el);
  }
  const color = colorRow(raw("color"), refresh);
  bind("color", color.read);
  identity.append(color.el);

  // --- Pillars ------------------------------------------------------------
  const pillars = section("pillars");
  pillars.replaceChildren();
  for (const key of PILLARS) {
    // One folder holds all five families; the server labels each option with
    // the `type` its own block declares, which is what splits the pickers.
    const items = optionsOf("culture_pillar").filter((i) => i.group === key || i.group === undefined);
    const field = refField({ label: label(key), doc: docOf(key), items, value: raw(key) ?? "" });
    field.onChange(refresh);
    bind(key, () => field.get() || null);
    pillars.append(field.el);
  }

  // --- Traditions ---------------------------------------------------------
  const traditions = section("traditions");
  traditions.replaceChildren();
  const tradField = multiRefField({
    label: "Traditions",
    doc: docOf("traditions"),
    items: optionsOf("culture_tradition"),
    values: tokensOf(raw("traditions")),
    addLabel: "Add tradition",
  });
  tradField.onChange(refresh);
  bind("traditions", () => multiList(tradField.get()));
  traditions.append(tradField.el);

  // --- Names --------------------------------------------------------------
  const names = section("names");
  names.replaceChildren();
  const nameList = refField({
    label: "Name list",
    doc: docOf("name_list"),
    items: optionsOf("name_list"),
    value: raw("name_list") ?? "",
  });
  nameList.onChange(refresh);
  bind("name_list", () => nameList.get() || null);
  names.append(nameList.el);
  names.append(simpleText("name_order_convention", raw("name_order_convention")));

  // --- Look ---------------------------------------------------------------
  const look = section("look");
  look.replaceChildren();
  for (const key of GFX) {
    const list = tokenListField(
      label(key),
      docOf(key),
      keyOf(key)?.sampled ?? [],
      tokensOf(raw(key)),
      refresh
    );
    bind(key, () => inlineList(list.read()));
    look.append(list.el);
  }
  look.append(simpleText("house_coa_frame", raw("house_coa_frame")));
  for (const key of PAIRS) {
    const pair = numberPairField(label(key), docOf(key), numbersOf(raw(key)), refresh);
    bind(key, () => numberList(pair.read()));
    look.append(pair.el);
  }
  const ethnicities = weightRowsField(
    "Ethnicities",
    docOf("ethnicities"),
    keyOf("ethnicities")?.sampled ?? [],
    weightRowsOf(raw("ethnicities")),
    refresh
  );
  bind("ethnicities", () => weightList(ethnicities.read()));
  look.append(ethnicities.el);

  // --- Origin -------------------------------------------------------------
  const origin = section("origin");
  origin.replaceChildren();
  const parents = multiRefField({
    label: "Parents",
    doc: docOf("parents"),
    items: optionsOf("culture"),
    values: tokensOf(raw("parents")),
    addLabel: "Add parent",
  });
  parents.onChange(refresh);
  bind("parents", () => inlineList(parents.get()));
  origin.append(parents.el);
  const created = textField({
    label: "Created",
    doc: docOf("created"),
    value: raw("created") ?? "",
    placeholder: "650.1.1",
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
  origin.append(created.el, createdNote);

  // --- Other keys ---------------------------------------------------------
  const other = section("other");
  other.replaceChildren();
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
      other.append(field.el);
    } else {
      other.append(simpleText(key.key, raw(key.key)));
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
    suggestions: keyOf(key)?.sampled ?? [],
  });
  field.onChange(refresh);
  bind(key, () => field.get() || null);
  return field.el;
}

/** `head_determination` -> `Head determination`: the key, readable. */
function label(key: string): string {
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a loc pattern asks the modder for. `$` is the culture's own name. */
function locLabel(pattern: string): string {
  if (pattern === "$") return "Name";
  return label(pattern.replace("$_", "").replace("$", ""));
}

// ---------------------------------------------------------------------------
// Host messages
// ---------------------------------------------------------------------------

function applyInit(next: CultureInit): void {
  init = next;
  const current = next.form.current;
  const parsed = current ? readBlock(current.text) : null;
  chunks = parsed?.chunks ?? [];
  currentValues = parsed?.values ?? new Map();
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
  if (mode === "duplicate") banner.append(modeChoice());
  $("target").textContent = next.saveMod
    ? `${next.saveMod} · ${next.form.folder} · ${next.locLanguage}`
    : next.form.folder;
  render();
}

function note(text: string): HTMLElement {
  return el("div", "note", text);
}

/** A game culture can be copied under a new name, or replaced outright. */
function modeChoice(): HTMLElement {
  const wrap = el("div", "px-stack");
  const group = el("div", "px-toggle-group");
  const warn = note("");
  const paint = (): void => {
    for (const button of Array.from(group.children) as HTMLElement[]) {
      button.setAttribute("aria-pressed", String(button.dataset.value === mode));
    }
    warn.textContent =
      mode === "override"
        ? "An override is a whole copy: the game has no partial override, so your copy stops receiving the changes a game patch makes to this culture."
        : "";
  };
  for (const [value, text] of [
    ["duplicate", "Duplicate into my mod"],
    ["override", "Override the game's culture"],
  ] as const) {
    const button = document.createElement("button");
    button.className = "px-toggle";
    button.dataset.size = "sm";
    button.dataset.value = value;
    button.textContent = text;
    button.onclick = () => {
      mode = value;
      nameInput.value = value === "override" ? sourceName : `${init?.prefix ?? "px"}_${sourceName}`;
      nameInput.readOnly = value === "override";
      paint();
      refresh();
    };
    group.append(button);
  }
  paint();
  wrap.append(group, warn);
  return wrap;
}

window.addEventListener("message", (event: MessageEvent<HostToApp>) => {
  const msg = event.data;
  switch (msg.type) {
    case "init":
      applyInit(msg.init);
      break;
    case "loading":
      $("target").textContent = "loading…";
      break;
    case "saved":
      toast(`Saved ${msg.name}`);
      loaded = values();
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
// Toolbar
// ---------------------------------------------------------------------------

nameInput.addEventListener("change", refresh);
nameInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") nameInput.blur();
});

$("open").onclick = () => {
  const items = (init?.form.options.culture ?? []).map((i) => ({
    value: i.value,
    label: i.value,
    ...(i.hint ? { hint: i.hint } : {}),
  }));
  if (items.length === 0) {
    toast("No culture is indexed yet.");
    return;
  }
  menu($("open"), items, { search: true, width: 320, onPick: (name) => send({ type: "load", name }) });
};

$("wiki").onclick = () => send({ type: "openExamples", name: currentName() });

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
  const block = buildBlock(name, chunks, now, loaded, init?.form.keys.map((k) => k.key) ?? []);
  const loc = locRows
    .map((row) => ({ key: locKeyFor(row.pattern, name), value: row.field.get() }))
    .filter((pair) => pair.value.trim() !== "");
  const sourceFile = init?.form.current?.file.split(/[\\/]/).pop();
  send({
    type: "save",
    name,
    mode,
    block,
    ...(mode === "edit" ? { changed: changedProperties(now, loaded) } : {}),
    loc,
    ...(mode === "edit" || mode === "override" ? { sourceFile } : {}),
  });
};

send({ type: "ready" });
