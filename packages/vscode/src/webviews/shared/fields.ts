/**
 * The form controls every visual content creator is built from.
 *
 * A creator's job is to let a modder say what a definition IS without typing
 * script, and the definitions differ far more than the questions do: a trait,
 * a dynasty legacy and a culture all ask for names, numbers, yes/no switches,
 * one-of-a-list picks, several-of-a-list picks, an icon and a block of script
 * no widget can express. Those live here once so the creators differ in the
 * FORM they draw, never in how a field behaves.
 *
 * Every builder returns the same shape: the row to append, `get`/`set` for the
 * value, and `onChange` for the listeners. `set` never fires the listeners, so
 * loading a definition into a form cannot be mistaken for the user editing it.
 * A value the modder has not given is `null` (or `""`, or an empty list), which
 * is what lets a creator leave the key out of the block instead of writing a
 * default the game did not ask for.
 *
 * Every field takes an optional `doc`: the game's own one-line documentation,
 * shown on the label through the shared `data-tip` runtime (tips.ts). The
 * deeper "what is this view" prose is the ? dialog's (help.ts), not a field's.
 *
 * Browser code, styled by ui.css (`.px-field`, `.px-chips`, `.px-icongrid`,
 * `.px-modrow`). No vscode, no host calls: a field is DOM and a value.
 */
import type { EventVocabularyItem } from "@px-lsp/protocol/protocol";
import { colorPicker, paintSwatch, type Rgb } from "./colorPicker";
import { iconEl } from "./icons";
import { menu, popover, type MenuItem } from "./overlay";
import { scrubbable } from "./scrub";

/** What every builder gives back. */
export interface Field<T> {
  /** The row (label + control) to append to a section. */
  el: HTMLElement;
  get(): T;
  /** Load a value WITHOUT notifying listeners: this is not a user edit. */
  set(value: T): void;
  onChange(listener: (value: T) => void): void;
}

export interface FieldOptions {
  label: string;
  /** The game's own one-line doc for the key, shown as the label's tooltip. */
  doc?: string;
  /**
   * What an empty input shows: an EXAMPLE value, not an instruction. Every
   * creator has one to hand (`DefinitionFormKey.example` is the literal the
   * game itself writes most often for the key), and a form whose blank fields
   * say nothing is a form nobody can start filling in.
   */
  placeholder?: string;
}

/** One `name = value` row of a modifier block. */
export interface ModifierRow {
  name: string;
  value: number;
}

/** A picture the icon grid can show: the game's key and a URL the host gave. */
export interface IconChoice {
  key: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Pure decisions (unit-tested without a DOM)
// ---------------------------------------------------------------------------

/**
 * The entries a search box should still show. Name, source badge and the doc
 * line all match, because a modder looking for "the one about stress" knows
 * the sentence and not the key.
 */
export function filterVocabulary<T extends { value: string; doc?: string; hint?: string; label?: string }>(
  items: readonly T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...items];
  return items.filter(
    (item) =>
      item.value.toLowerCase().includes(q) ||
      (item.label ?? "").toLowerCase().includes(q) ||
      (item.hint ?? "").toLowerCase().includes(q) ||
      (item.doc ?? "").toLowerCase().includes(q)
  );
}

/** Add to a chip list, keeping the order the user picked and never twice. */
export function addChip(values: readonly string[], value: string): string[] {
  return values.includes(value) ? [...values] : [...values, value];
}

export function removeChip(values: readonly string[], value: string): string[] {
  return values.filter((v) => v !== value);
}

/**
 * Modifier rows as the statements of a modifier block, one per line, no
 * indentation (the caller owns the block it goes into). Rows with no modifier
 * chosen are dropped rather than written as an empty key.
 */
export function modifierRowsToScript(rows: readonly ModifierRow[]): string {
  return rows
    .filter((row) => row.name.trim() !== "")
    .map((row) => `${row.name} = ${row.value}`)
    .join("\n");
}

/** `px_iron_willed` -> `Iron Willed`: the loc value a creator prefills. */
export function titleCaseFromName(name: string): string {
  return name
    .split("_")
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function el(tag: string, cls = "", text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * A field label for a script key. The key wraps at its underscores, never
 * inside a word (`same_opinion_if_same_faith` in a 112px column): a <wbr>
 * after each underscore gives the browser the break and leaves the text
 * untouched, so `textContent` is still the key.
 */
export function keyLabel(text: string): HTMLSpanElement {
  const label = el("span", "px-label");
  text.split("_").forEach((part, index) => {
    if (index > 0) label.append("_", document.createElement("wbr"));
    label.append(part);
  });
  return label;
}

/** The label + control grid row every field shares, with its label: a number
 *  field drags on the label, so the builder needs the element back. */
function labelledRow(
  options: FieldOptions,
  control: HTMLElement
): { row: HTMLElement; label: HTMLSpanElement } {
  const row = el("div", "px-field");
  const label = keyLabel(options.label);
  if (options.doc) {
    label.dataset.tip = options.doc;
    label.dataset.tipWrap = "";
  }
  row.append(label, control);
  return { row, label };
}

/**
 * The label + control row on its own, for a creator that builds a control the
 * field builders do not cover (the Dynasty Tree's date parts) and still has to
 * line up with the rows around it.
 */
export function fieldRow(options: FieldOptions, control: HTMLElement): HTMLElement {
  return labelledRow(options, control).row;
}

function emitter<T>(): { listeners: ((value: T) => void)[]; fire: (value: T) => void } {
  const listeners: ((value: T) => void)[] = [];
  return { listeners, fire: (value) => listeners.forEach((fn) => fn(value)) };
}

function ghostButton(label: string, iconName: Parameters<typeof iconEl>[0]): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "px-btn";
  button.dataset.variant = "ghost";
  button.dataset.size = "xs";
  button.append(iconEl(iconName), label);
  return button;
}

function dropdownTrigger(placeholder: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "px-btn px-dropdown";
  button.dataset.variant = "outline";
  button.dataset.size = "sm";
  const value = el("span", "px-truncate", placeholder);
  button.append(value, iconEl("chevronDown"));
  return button;
}

/** Fill a dropdown trigger's face; an unset value reads as the placeholder. */
function paintTrigger(button: HTMLButtonElement, value: string, placeholder: string): void {
  const face = button.firstElementChild as HTMLElement;
  face.textContent = value || placeholder;
  if (value) button.removeAttribute("data-placeholder");
  else button.dataset.placeholder = "";
}

/**
 * The picker's face for an indexed definition. A definition the loc index has
 * a name for reads as that name, with its KEY as the dimmer hint: a modder
 * picking "Brave" still has to see it is `brave` that gets written. Without a
 * label the key leads and the hint stays the source badge.
 */
function vocabularyItems(items: readonly EventVocabularyItem[]): MenuItem[] {
  return items.map((item) => ({
    value: item.value,
    label: item.label || item.value,
    ...(item.label ? { hint: item.value } : item.hint ? { hint: item.hint } : {}),
    ...(item.doc ? { description: item.doc } : {}),
  }));
}

/**
 * A search box over a list, in a popover: the shape the pickers that cannot be
 * a `menu()` need (chips keep their own list, icons draw a grid). `render`
 * fills the body with whatever the picker shows for the entries that match.
 */
function searchPopover(
  anchor: HTMLElement,
  placeholder: string,
  render: (query: string, body: HTMLElement, close: () => void) => void
): void {
  const root = el("div", "px-picker");
  root.style.width = "300px";
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

// ---------------------------------------------------------------------------
// The fields
// ---------------------------------------------------------------------------

export interface TextFieldOptions extends FieldOptions {
  value?: string;
  /** Values the game already uses for this key, offered behind a chevron. */
  suggestions?: readonly string[];
}

/** Free text. `""` means the key is not written. */
export function textField(options: TextFieldOptions): Field<string> {
  const { listeners, fire } = emitter<string>();
  const input = document.createElement("input");
  input.className = "px-input";
  input.dataset.size = "sm";
  input.type = "text";
  input.spellcheck = false;
  input.value = options.value ?? "";
  if (options.placeholder) input.placeholder = options.placeholder;
  // Committed values, not keystrokes (px-ui rule 5).
  input.addEventListener("change", () => fire(input.value.trim()));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") input.blur();
  });

  let control: HTMLElement = input;
  const suggestions = options.suggestions ?? [];
  if (suggestions.length > 0) {
    const row = el("div", "px-row");
    const open = document.createElement("button");
    open.className = "px-btn";
    open.dataset.variant = "ghost";
    open.dataset.size = "icon-sm";
    open.dataset.tip = "Values the game itself uses for this key";
    open.dataset.tipWrap = "";
    open.append(iconEl("chevronDown"));
    open.onclick = () =>
      menu(
        open,
        suggestions.map((value) => ({ value, label: value })),
        {
          value: input.value,
          width: 240,
          onPick: (picked) => {
            input.value = picked;
            fire(picked);
          },
        }
      );
    row.append(input, open);
    control = row;
  }

  return {
    el: fieldRow(options, control),
    get: () => input.value.trim(),
    set: (value) => {
      input.value = value;
    },
    onChange: (listener) => listeners.push(listener),
  };
}

export interface NumberFieldOptions extends FieldOptions {
  value?: number | null;
  /** Scrub and typing step; 1 by default (most script numbers are integers). */
  step?: number;
}

/** A number whose LABEL drags it (scrub.ts). Blank is `null`: the key is not
 *  written. */
export function numberField(options: NumberFieldOptions): Field<number | null> {
  const { listeners, fire } = emitter<number | null>();
  const step = options.step ?? 1;
  const input = document.createElement("input");
  input.className = "px-input";
  input.dataset.size = "sm";
  input.type = "number";
  input.step = String(step);
  input.placeholder = options.placeholder ?? "not set";
  input.value = options.value === null || options.value === undefined ? "" : String(options.value);
  const read = (): number | null => (input.value.trim() === "" ? null : Number(input.value));
  input.addEventListener("change", () => fire(read()));

  const box = el("div", "px-row");
  box.style.maxWidth = "140px";
  box.append(input);
  // The label is the drag handle, so the input is only ever typed in.
  const { row, label } = labelledRow(options, box);
  scrubbable(input, {
    step,
    handle: label,
    onChange: () => undefined,
    onCommit: () => fire(read()),
  });
  return {
    el: row,
    get: read,
    set: (value) => {
      input.value = value === null ? "" : String(value);
    },
    onChange: (listener) => listeners.push(listener),
  };
}

export interface BoolFieldOptions extends FieldOptions {
  value?: boolean | null;
}

/**
 * Yes / no, with "not set" as a real third answer: a trait that does not
 * mention `physical` is not the same file as one that writes `physical = no`,
 * and a form that could only say the second would put keys in every block.
 */
export function boolField(options: BoolFieldOptions): Field<boolean | null> {
  const { listeners, fire } = emitter<boolean | null>();
  let current: boolean | null = options.value ?? null;
  const group = el("div", "px-toggle-group");
  const choices: { label: string; value: boolean | null; tip: string }[] = [
    { label: "Not set", value: null, tip: "The key is left out of the block." },
    { label: "Yes", value: true, tip: "Written as yes." },
    { label: "No", value: false, tip: "Written as no." },
  ];
  const buttons = choices.map((choice) => {
    const button = document.createElement("button");
    button.className = "px-toggle";
    button.dataset.size = "sm";
    button.dataset.tip = choice.tip;
    button.textContent = choice.label;
    button.onclick = () => {
      current = choice.value;
      paint();
      fire(current);
    };
    group.append(button);
    return button;
  });
  const paint = (): void => {
    buttons.forEach((button, i) => button.setAttribute("aria-pressed", String(choices[i].value === current)));
  };
  paint();
  return {
    el: fieldRow(options, group),
    get: () => current,
    set: (value) => {
      current = value;
      paint();
    },
    onChange: (listener) => listeners.push(listener),
  };
}

export interface EnumFieldOptions extends FieldOptions {
  values: readonly string[];
  value?: string;
}

/** One of a known list, through `menu()` (never a native `<select>`). */
export function enumField(options: EnumFieldOptions): Field<string> {
  const { listeners, fire } = emitter<string>();
  const placeholder = options.placeholder ?? "not set";
  let current = options.value ?? "";
  const trigger = dropdownTrigger(placeholder);
  paintTrigger(trigger, current, placeholder);
  trigger.onclick = () =>
    menu(
      trigger,
      [{ value: "", label: placeholder }, ...options.values.map((value) => ({ value, label: value }))],
      {
        value: current,
        width: 240,
        onPick: (picked) => {
          current = picked;
          paintTrigger(trigger, current, placeholder);
          fire(current);
        },
      }
    );
  return {
    el: fieldRow(options, trigger),
    get: () => current,
    set: (value) => {
      current = value;
      paintTrigger(trigger, current, placeholder);
    },
    onChange: (listener) => listeners.push(listener),
  };
}

export interface RefFieldOptions extends FieldOptions {
  /** Everything the index knows of the kind: value, source badge, doc line. */
  items: readonly EventVocabularyItem[];
  value?: string;
  /** A picture for an entry, when the kind has one (an icon URL). */
  thumb?: (value: string) => string | null;
}

/** One definition of another kind, picked from the index. */
export function refField(options: RefFieldOptions): Field<string> {
  const { listeners, fire } = emitter<string>();
  const placeholder = options.placeholder ?? "not set";
  let current = options.value ?? "";
  const trigger = dropdownTrigger(placeholder);
  paintTrigger(trigger, current, placeholder);
  const items = (): MenuItem[] =>
    vocabularyItems(options.items).map((item) => {
      const url = options.thumb?.(item.value);
      return url ? { ...item, image: url } : item;
    });
  trigger.onclick = () =>
    menu(trigger, [{ value: "", label: placeholder }, ...items()], {
      value: current,
      search: true,
      width: 320,
      onPick: (picked) => {
        current = picked;
        paintTrigger(trigger, current, placeholder);
        fire(current);
      },
    });
  return {
    el: fieldRow(options, trigger),
    get: () => current,
    set: (value) => {
      current = value;
      paintTrigger(trigger, current, placeholder);
    },
    onChange: (listener) => listeners.push(listener),
  };
}

export interface MultiRefFieldOptions extends FieldOptions {
  items: readonly EventVocabularyItem[];
  values?: readonly string[];
  /** A picture for an entry, when the kind has one (an icon URL). */
  thumb?: (value: string) => string | null;
  addLabel?: string;
  /**
   * The search box can also ADD what was typed. For lists the game does not
   * enumerate: a trait's `flag` is any name a modder invents, and refusing an
   * unlisted one would make the field useless.
   */
  allowNew?: boolean;
}

/** Several definitions of another kind: chips, plus a searchable picker. */
export function multiRefField(options: MultiRefFieldOptions): Field<string[]> {
  const { listeners, fire } = emitter<string[]>();
  let current = [...(options.values ?? [])];
  const box = el("div", "px-chips");
  const add = ghostButton(options.addLabel ?? "Add", "plus");

  const paint = (): void => {
    box.replaceChildren();
    for (const value of current) {
      const chip = el("span", "px-chip");
      const url = options.thumb?.(value);
      if (url) {
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        chip.append(img);
      }
      chip.append(el("span", "", value));
      const drop = document.createElement("button");
      drop.className = "px-btn";
      drop.dataset.variant = "ghost";
      drop.dataset.size = "icon-xs";
      drop.dataset.tip = `Remove ${value}`;
      drop.append(iconEl("x"));
      drop.onclick = () => {
        current = removeChip(current, value);
        paint();
        fire([...current]);
      };
      chip.append(drop);
      box.append(chip);
    }
    box.append(add);
  };

  add.onclick = () =>
    searchPopover(add, "Search…", (query, body, close) => {
      body.replaceChildren();
      const matches = filterVocabulary(options.items, query).filter((item) => !current.includes(item.value));
      const typed = query.trim();
      if (options.allowNew && typed !== "" && !matches.some((item) => item.value === typed)) {
        const row = el("div", "px-menu-item");
        row.append(iconEl("plus"), el("span", "px-grow", typed));
        row.append(el("span", "px-menu-hint", "add"));
        row.onclick = () => {
          current = addChip(current, typed);
          paint();
          fire([...current]);
          close();
        };
        body.append(row);
      } else if (matches.length === 0) {
        body.append(el("div", "px-menu-empty", "No match"));
        return;
      }
      for (const item of matches.slice(0, 200)) {
        const row = el("div", "px-menu-item");
        row.setAttribute("role", "option");
        const url = options.thumb?.(item.value);
        if (url) {
          const img = document.createElement("img");
          img.className = "px-chip-thumb";
          img.src = url;
          img.alt = "";
          row.append(img);
        }
        const label = el("span", "px-grow", item.label || item.value);
        if (item.doc) {
          row.dataset.twoLine = "";
          label.append(el("span", "px-menu-description", item.doc));
        }
        row.append(label);
        const hint = item.label ? item.value : item.hint;
        if (hint) row.append(el("span", "px-menu-hint", hint));
        row.onclick = () => {
          current = addChip(current, item.value);
          paint();
          fire([...current]);
          close();
        };
        body.append(row);
      }
    });

  paint();
  return {
    el: fieldRow(options, box),
    get: () => [...current],
    set: (values) => {
      current = [...values];
      paint();
    },
    onChange: (listener) => listeners.push(listener),
  };
}

export interface ColorFieldOptions extends FieldOptions {
  value?: Rgb | null;
}

/** A color, through the shared picker. `null` = the key is not written. */
export function colorField(options: ColorFieldOptions): Field<Rgb | null> {
  const { listeners, fire } = emitter<Rgb | null>();
  let current: Rgb | null = options.value ?? null;
  const row = el("div", "px-row");
  const swatch = document.createElement("button");
  swatch.className = "px-swatch";
  swatch.style.width = "24px";
  swatch.style.height = "24px";
  swatch.dataset.tip = "Pick a color";
  const clear = ghostButton("Clear", "x");
  const paint = (): void => {
    if (current) {
      swatch.removeAttribute("data-missing");
      paintSwatch(swatch, current);
    } else {
      swatch.dataset.missing = "";
      swatch.style.removeProperty("--px-swatch");
    }
    clear.hidden = current === null;
  };
  swatch.onclick = () =>
    colorPicker(swatch, current ?? [128, 128, 128], {
      onChange: (rgb) => {
        current = rgb;
        paint();
      },
      onClose: () => fire(current),
    });
  clear.onclick = () => {
    current = null;
    paint();
    fire(null);
  };
  row.append(swatch, clear);
  paint();
  return {
    el: fieldRow(options, row),
    get: () => (current ? ([...current] as Rgb) : null),
    set: (value) => {
      current = value ? ([...value] as Rgb) : null;
      paint();
    },
    onChange: (listener) => listeners.push(listener),
  };
}

export interface IconFieldOptions extends FieldOptions {
  /** The pictures of the kind's icon folder, mod entries first. */
  items: readonly IconChoice[];
  value?: string;
  /** Offered under the grid; the panel owns the file dialog and the encoder. */
  onCustom?: () => void;
  customLabel?: string;
}

/** The kind's icon, picked from the folder the game reads it from. */
export function iconField(options: IconFieldOptions): Field<string> {
  const { listeners, fire } = emitter<string>();
  let current = options.value ?? "";
  const row = el("div", "px-row");
  const preview = document.createElement("img");
  preview.className = "px-icontile";
  preview.alt = "";
  const face = el("span", "px-truncate px-xs px-muted");
  const choose = ghostButton("Choose…", "image");
  const clear = ghostButton("Clear", "x");

  const urlOf = (key: string): string | null => options.items.find((i) => i.key === key)?.url ?? null;
  const paint = (): void => {
    const url = urlOf(current);
    preview.hidden = url === null;
    if (url) preview.src = url;
    face.textContent = current || "the game's default for this name";
    clear.hidden = current === "";
  };

  choose.onclick = () =>
    searchPopover(choose, "Search icons…", (query, body, close) => {
      body.replaceChildren();
      const q = query.trim().toLowerCase();
      const matches = options.items.filter((item) => item.key.toLowerCase().includes(q));
      const grid = el("div", "px-icongrid");
      for (const item of matches.slice(0, 400)) {
        const tile = document.createElement("button");
        tile.className = "px-btn";
        tile.dataset.variant = "ghost";
        tile.dataset.tip = item.key;
        tile.dataset.tipWrap = "";
        const img = document.createElement("img");
        img.className = "px-icontile";
        img.src = item.url;
        img.alt = item.key;
        img.loading = "lazy";
        tile.append(img);
        tile.onclick = () => {
          current = item.key;
          paint();
          fire(current);
          close();
        };
        grid.append(tile);
      }
      if (matches.length === 0) grid.append(el("div", "px-menu-empty", "No match"));
      body.append(grid);
      if (options.onCustom) {
        const custom = ghostButton(options.customLabel ?? "Custom image…", "imageDown");
        custom.style.width = "100%";
        custom.onclick = () => {
          close();
          options.onCustom?.();
        };
        body.append(custom);
      }
    });
  clear.onclick = () => {
    current = "";
    paint();
    fire(current);
  };

  row.append(preview, face, choose, clear);
  paint();
  return {
    el: fieldRow(options, row),
    get: () => current,
    set: (value) => {
      current = value;
      paint();
    },
    onChange: (listener) => listeners.push(listener),
  };
}

export interface ModifierListFieldOptions extends FieldOptions {
  /** The modifier vocabulary the server holds, most used first. */
  items: readonly { name: string; doc?: string }[];
  rows?: readonly ModifierRow[];
  addLabel?: string;
}

/** A modifier block: named modifiers with their numbers, added and removed. */
export function modifierListField(options: ModifierListFieldOptions): Field<ModifierRow[]> {
  const { listeners, fire } = emitter<ModifierRow[]>();
  let current: ModifierRow[] = (options.rows ?? []).map((row) => ({ ...row }));
  const box = el("div", "px-stack");
  const list = el("div", "px-list");
  const add = ghostButton(options.addLabel ?? "Add modifier", "plus");
  // The stack stretches its children; a stretched ghost button reads as
  // centered text, so the button keeps its own width at the left edge.
  add.style.alignSelf = "flex-start";
  const menuItems: MenuItem[] = options.items.map((item) => ({
    value: item.name,
    label: item.name,
    ...(item.doc ? { description: item.doc } : {}),
  }));

  const paint = (): void => {
    list.replaceChildren();
    current.forEach((row, index) => {
      const line = el("div", "px-item px-modrow");
      const trigger = dropdownTrigger("pick a modifier");
      paintTrigger(trigger, row.name, "pick a modifier");
      trigger.onclick = () =>
        menu(trigger, menuItems, {
          value: row.name,
          search: true,
          width: 320,
          onPick: (picked) => {
            current[index] = { ...current[index], name: picked };
            paintTrigger(trigger, picked, "pick a modifier");
            fire(read());
          },
        });
      const value = document.createElement("input");
      value.className = "px-input";
      value.dataset.size = "sm";
      value.type = "number";
      value.step = "0.1";
      value.value = String(row.value);
      const commit = (): void => {
        current[index] = { ...current[index], value: Number(value.value) || 0 };
        fire(read());
      };
      value.addEventListener("change", commit);
      // An inline pair has no label of its own, so the input stays the handle.
      scrubbable(value, { step: 0.1, onChange: () => undefined, onCommit: commit });
      const drop = document.createElement("button");
      drop.className = "px-btn";
      drop.dataset.variant = "ghost";
      drop.dataset.size = "icon-xs";
      drop.dataset.tip = "Remove this modifier";
      drop.append(iconEl("trash"));
      drop.onclick = () => {
        current.splice(index, 1);
        paint();
        fire(read());
      };
      line.append(trigger, value, drop);
      list.append(line);
    });
    list.hidden = current.length === 0;
  };
  const read = (): ModifierRow[] => current.map((row) => ({ ...row }));

  add.onclick = () => {
    current.push({ name: "", value: 0 });
    paint();
  };
  box.append(list, add);
  paint();
  return {
    el: fieldRow(options, box),
    get: read,
    set: (rows) => {
      current = rows.map((row) => ({ ...row }));
      paint();
    },
    onChange: (listener) => listeners.push(listener),
  };
}

export interface LocFieldOptions extends FieldOptions {
  /** The generated key, shown but never editable: the game derives it. */
  key: string;
  value?: string;
  multiline?: boolean;
}

/** A loc pair: the key the game generates, and the text the player reads. */
export function locField(options: LocFieldOptions): Field<string> {
  const { listeners, fire } = emitter<string>();
  const box = el("div", "px-stack");
  const input = options.multiline
    ? document.createElement("textarea")
    : (document.createElement("input") as HTMLInputElement);
  input.className = options.multiline ? "px-textarea" : "px-input";
  if (!options.multiline) (input as HTMLInputElement).dataset.size = "sm";
  input.spellcheck = true;
  input.value = options.value ?? "";
  if (options.placeholder) input.placeholder = options.placeholder;
  input.addEventListener("change", () => fire(input.value));
  const key = el("code", "px-mono px-xs px-muted", options.key);
  key.dataset.tip = "The loc key the game looks up. It follows the name, so it is not editable.";
  key.dataset.tipWrap = "";
  box.append(input, key);
  return {
    el: fieldRow(options, box),
    get: () => input.value,
    set: (value) => {
      input.value = value;
    },
    onChange: (listener) => listeners.push(listener),
  };
}

export interface ScriptFieldOptions extends FieldOptions {
  value?: string;
  rows?: number;
}

/**
 * The escape hatch: a block no widget can express (a trigger, an effect, a
 * `desc = { first_valid … }`) stays script, written by hand and preserved
 * verbatim. Tab types a tab, because script is tab-indented and a form that
 * ate the key would send the modder to the file.
 */
export function scriptField(options: ScriptFieldOptions): Field<string> {
  const { listeners, fire } = emitter<string>();
  const area = document.createElement("textarea");
  area.className = "px-textarea px-mono";
  area.spellcheck = false;
  area.rows = options.rows ?? 4;
  area.value = options.value ?? "";
  if (options.placeholder) area.placeholder = options.placeholder;
  area.addEventListener("change", () => fire(area.value));
  area.addEventListener("keydown", (ev) => {
    if (ev.key !== "Tab" || ev.shiftKey) return;
    ev.preventDefault();
    const start = area.selectionStart;
    const end = area.selectionEnd;
    area.value = area.value.slice(0, start) + "\t" + area.value.slice(end);
    area.selectionStart = area.selectionEnd = start + 1;
  });
  return {
    el: fieldRow(options, area),
    get: () => area.value,
    set: (value) => {
      area.value = value;
    },
    onChange: (listener) => listeners.push(listener),
  };
}
