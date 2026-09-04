/**
 * The three perk/track blocks a modder should not have to type as script: the
 * condition of a track or a perk (`is_shown`, `can_be_picked`), the sentences a
 * perk's effect prints, and the AI's plain chance number.
 *
 * Each of them is the same shape: a small builder over the shapes the game
 * itself writes, with the raw block underneath as an "Advanced: script" toggle.
 * The builder never hides anything (AD-5): a block it cannot represent opens in
 * script with a note saying why, and comes out byte for byte as it went in.
 *
 * The measurements the shapes are picked from live on the parsers in
 * `script.ts`. Nothing here knows a value: the feature list, the game rules and
 * the scripted triggers all arrive from `DefinitionForm.conditions`.
 *
 * Browser code, styled by ui.css (`.px-field`, `.px-item`, `.px-stack`). No
 * vscode and no host calls.
 */
import type { EventVocabularyItem } from "@px-lsp/protocol/protocol";
import { iconEl } from "../../shared/icons";
import { menu, type MenuItem } from "../../shared/overlay";
import { keyLabel, scriptFoot } from "../../shared/fields";
import { scrubbable } from "../../shared/scrub";
import {
  DLC_TRIGGER,
  RULE_TRIGGER,
  SCRIPTED_TRIGGERS,
  effectKeyFor,
  parseChanceValue,
  readChanceValue,
  readConditions,
  readEffectLines,
  writeChanceValue,
  writeConditions,
  writeEffectLines,
  type Condition,
  type ReadResult,
} from "./script";

/** What every builder here gives its owner: a row, a block, and a signal. */
export interface BlockField {
  el: HTMLElement;
  /** The block's source text (`{ … }`), or null when it says nothing. */
  get(): string | null;
  onChange(listener: () => void): void;
}

function el(tag: string, cls = "", text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function ghost(label: string, icon: Parameters<typeof iconEl>[0]): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "px-btn";
  button.dataset.variant = "ghost";
  button.dataset.size = "xs";
  button.append(iconEl(icon), label);
  return button;
}

function iconButton(tip: string, icon: Parameters<typeof iconEl>[0]): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "px-btn";
  button.dataset.variant = "ghost";
  button.dataset.size = "icon-xs";
  button.dataset.tip = tip;
  button.append(iconEl(icon));
  return button;
}

/** A dropdown over a vocabulary that KEEPS a value the list does not have. */
function picker(
  value: string,
  items: readonly EventVocabularyItem[],
  placeholder: string,
  onPick: (value: string) => void
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "px-btn px-dropdown";
  button.dataset.variant = "outline";
  button.dataset.size = "sm";
  const face = el("span", "px-truncate");
  const paint = (): void => {
    const item = items.find((i) => i.value === value);
    face.textContent = item?.label || value || placeholder;
    if (value) {
      button.removeAttribute("data-placeholder");
      button.dataset.tip = value;
    } else button.dataset.placeholder = "";
  };
  button.append(face, iconEl("chevronDown"));
  paint();
  const menuItems = (): MenuItem[] =>
    items.map((item) => ({
      value: item.value,
      label: item.label || item.value,
      ...(item.label ? { hint: item.value } : item.hint ? { hint: item.hint } : {}),
      ...(item.doc ? { description: item.doc } : {}),
    }));
  button.onclick = () =>
    menu(button, menuItems(), {
      value,
      search: true,
      width: 320,
      onPick: (picked) => {
        value = picked;
        paint();
        onPick(picked);
      },
    });
  return button;
}

/**
 * The label + control grid row the shared fields draw, with a stack of the
 * builder's own rows in the control column.
 */
function builderRow(
  label: string,
  doc: string | undefined,
  body: HTMLElement
): { row: HTMLElement; label: HTMLElement } {
  const row = el("div", "px-field");
  const name = keyLabel(label);
  if (doc) {
    name.dataset.tip = doc;
    name.dataset.tipWrap = "";
  }
  row.append(name, body);
  return { row, label: name };
}

/**
 * The builder/script pair every field here shares: the builder's own body, a
 * toggle, a note when the block could not be read back, and the script area.
 *
 * The toggle always has a way back, which it once did not: an empty area could
 * never return, because every reader asks `bodyOf` first and that used to
 * refuse a text with no `{`. So an empty or whitespace area goes back with no
 * word said, a text the reader understands goes back with the rows it read,
 * and only a text the reader stopped on stays raw — naming the line it stopped
 * on, and offering to throw the script away and keep the rows the builder
 * still holds.
 */
interface Advanced {
  box: HTMLElement;
  body: HTMLElement;
  note: HTMLElement;
  raw: boolean;
  /** What the script area holds. */
  text(): string;
  /** Show the script area instead of the builder (or the other way round). */
  setRaw(raw: boolean, text?: string): void;
  /** The block the builder writes right now, for a freshly opened area. */
  seed(): string | null;
  /** Say why the script stays script, naming the line the reader stopped on. */
  showNote(line: string): void;
}

interface AdvancedOptions {
  /** The builder's own name, for "Back to the <name> builder". */
  label: string;
  placeholder: string;
  /** Why a block the reader stopped on cannot be a set of rows. */
  why: string;
  onChange: () => void;
  /**
   * Read the script back into the builder's rows. `null` on success; the line
   * it stopped on when the rows cannot hold it.
   */
  toBuilder: (text: string) => string | null;
  /** The block the builder writes right now, to seed a freshly opened area. */
  seed: () => string | null;
  /**
   * Save and open the definition in the editor. A textarea has no completion,
   * no hover and no highlighting; a block big enough to need Advanced is a
   * block better written in the file, so every one of these areas says so.
   */
  onOpenFile?: () => void;
}

function advanced(options: AdvancedOptions): Advanced {
  const { label, onChange } = options;
  const box = el("div", "px-stack");
  const body = el("div", "px-stack");
  const note = el("div", "note");
  note.hidden = true;
  const why = el("span");
  const discard = document.createElement("button");
  discard.className = "px-btn";
  discard.dataset.variant = "link";
  discard.dataset.size = "xs";
  discard.textContent = "Discard the script and go back";
  note.append(why, document.createTextNode(" "), discard);
  // The same escape hatch `scriptField` draws, without its label column: this
  // block already has one, on the builder above it.
  const area = document.createElement("textarea");
  area.className = "px-textarea px-mono";
  area.spellcheck = false;
  area.rows = 4;
  area.placeholder = options.placeholder;
  area.addEventListener("change", onChange);
  // The same foot `scriptField` draws under its own area, and hidden with the
  // area: the way out of the webview belongs to the script and not to the
  // builder above it.
  const foot = options.onOpenFile ? scriptFoot(options.onOpenFile) : null;
  const toggle = ghost("Advanced: script", "fileText");
  const face = document.createTextNode("Advanced: script");
  toggle.replaceChildren(iconEl("fileText"), face);
  const state: Advanced = {
    box,
    body,
    note,
    raw: false,
    text: () => area.value,
    seed: options.seed,
    setRaw(raw, text) {
      state.raw = raw;
      if (text !== undefined) area.value = text;
      body.hidden = raw;
      area.hidden = !raw;
      if (foot) foot.hidden = !raw;
      face.textContent = raw ? `Back to the ${label} builder` : "Advanced: script";
    },
    showNote(line) {
      why.textContent = line === "" ? options.why : `${options.why} It stopped on \`${line}\`.`;
      note.hidden = false;
    },
  };
  const back = (): void => {
    note.hidden = true;
    state.setRaw(false);
    onChange();
  };
  toggle.onclick = () => {
    if (!state.raw) {
      // A builder with rows must not lose them to an empty area: what it
      // writes right now is what the modder is about to edit as script.
      state.setRaw(true, area.value.trim() === "" ? (state.seed() ?? "") : undefined);
      return;
    }
    if (area.value.trim() === "") {
      back();
      return;
    }
    const stopped = options.toBuilder(area.value);
    if (stopped !== null) {
      state.showNote(stopped);
      return;
    }
    back();
  };
  discard.onclick = () => {
    state.setRaw(false, "");
    note.hidden = true;
    onChange();
  };
  box.append(body, area, ...(foot ? [foot] : []), note, toggle);
  state.setRaw(false);
  return state;
}

export interface ConditionFieldOptions {
  label: string;
  doc?: string;
  /** Drawn without the label column: the section it sits in already names it. */
  bare?: boolean;
  /** Trigger name -> its values, exactly as `DefinitionForm.conditions` has it. */
  conditions: Record<string, EventVocabularyItem[]>;
  /** The block the file already has, or "" for a new definition. */
  value: string;
  /** A real block from the game's own files, shown while the script is empty. */
  placeholder: string;
  /** Save and open the definition in the editor, from the script area's foot. */
  onOpenFile?: () => void;
}

/**
 * A trigger as rows: "Needs DLC feature X", "or any of these game rules",
 * "<scripted trigger> is yes/no". A row kind whose values the server could not
 * answer is not offered at all, so a picker is never empty.
 */
export function conditionField(options: ConditionFieldOptions): BlockField {
  const listeners: (() => void)[] = [];
  const fire = (): void => listeners.forEach((fn) => fn());
  const features = options.conditions[DLC_TRIGGER] ?? [];
  const rules = options.conditions[RULE_TRIGGER] ?? [];
  const triggers = options.conditions[SCRIPTED_TRIGGERS] ?? [];
  const first = readConditions(options.value);
  let rows: Condition[] = first.ok ? first.value : [];

  const list = el("div", "px-list");
  const add = ghost("Add condition", "plus");
  const kinds = [
    { value: "dlc", label: "Needs a DLC feature", enabled: features.length > 0 },
    { value: "rules", label: "Or one of these game rules", enabled: rules.length > 0 },
    { value: "trigger", label: "A scripted trigger", enabled: triggers.length > 0 },
  ].filter((kind) => kind.enabled);

  const state = advanced({
    label: "condition",
    placeholder: options.placeholder,
    why:
      "This block does more than the rows can show, so it stays script. " +
      "A trigger the builder can read is a DLC feature, a set of game rules, or a scripted trigger set to yes or no.",
    onChange: fire,
    ...(options.onOpenFile ? { onOpenFile: options.onOpenFile } : {}),
    seed: () => writeConditions(rows),
    toBuilder: (text) => {
      const read = readConditions(text);
      if (!read.ok) return read.line;
      rows = read.value;
      paint();
      return null;
    },
  });

  const changed = (): void => {
    paint();
    fire();
  };

  function rowEl(row: Condition, index: number): HTMLElement {
    const line = el("div", "px-item");
    const drop = iconButton("Remove this condition", "trash");
    drop.onclick = () => {
      rows.splice(index, 1);
      changed();
    };
    if (row.kind === "dlc") {
      line.append(el("span", "px-xs px-muted", "Needs DLC feature"));
      line.append(
        picker(row.value, features, "pick a feature", (value) => {
          rows[index] = { kind: "dlc", value };
          fire();
        })
      );
    } else if (row.kind === "rules") {
      line.append(el("span", "px-xs px-muted", "Or any of these game rules"));
      const chips = el("div", "px-chips");
      for (const value of row.values) {
        const chip = el("span", "px-chip");
        chip.append(el("span", "", value));
        const off = iconButton(`Remove ${value}`, "x");
        off.onclick = () => {
          rows[index] = { kind: "rules", values: row.values.filter((v) => v !== value) };
          changed();
        };
        chip.append(off);
        chips.append(chip);
      }
      const more = ghost("Add rule", "plus");
      more.onclick = () =>
        menu(
          more,
          rules
            .filter((item) => !row.values.includes(item.value))
            .map((item) => ({
              value: item.value,
              label: item.label || item.value,
            })),
          {
            search: true,
            width: 320,
            onPick: (value) => {
              rows[index] = { kind: "rules", values: [...row.values, value] };
              changed();
            },
          }
        );
      chips.append(more);
      line.append(chips);
    } else {
      line.append(
        picker(row.name, triggers, "pick a trigger", (name) => {
          rows[index] = { kind: "trigger", name, value: row.value };
          fire();
        })
      );
      const yes = document.createElement("button");
      yes.className = "px-toggle";
      yes.dataset.size = "sm";
      yes.textContent = row.value ? "is yes" : "is no";
      yes.dataset.tip = "Whether the trigger has to be true or false";
      yes.setAttribute("aria-pressed", String(row.value));
      yes.onclick = () => {
        rows[index] = { kind: "trigger", name: row.name, value: !row.value };
        changed();
      };
      line.append(yes);
    }
    line.append(drop);
    return line;
  }

  function paint(): void {
    list.replaceChildren(...rows.map(rowEl));
    list.hidden = rows.length === 0;
    add.hidden = kinds.length === 0;
  }

  add.onclick = () =>
    menu(add, kinds, {
      width: 260,
      onPick: (kind) => {
        rows.push(
          kind === "dlc"
            ? { kind: "dlc", value: "" }
            : kind === "rules"
              ? { kind: "rules", values: [] }
              : { kind: "trigger", name: "", value: true }
        );
        changed();
      },
    });

  state.body.append(list, add);
  paint();
  // A block the rows cannot hold opens as script, with the reason under it.
  openRaw(state, options.value, () => readConditions(options.value));

  return {
    el: options.bare ? state.box : builderRow(options.label, options.doc, state.box).row,
    get: () => (state.raw ? nullIfBlank(state.text()) : writeConditions(rows)),
    onChange: (listener) => listeners.push(listener),
  };
}

/**
 * A loaded block the reader stopped on opens as script, with the line it
 * stopped on already named: the modder should not have to click Advanced to
 * find out why their own file is not showing as rows.
 */
function openRaw(state: Advanced, value: string, read: () => ReadResult<unknown>): void {
  if (value.trim() === "") return;
  const answer = read();
  if (answer.ok) return;
  state.setRaw(true, value);
  state.showNote(answer.line);
}

/** A script area's text as a block value, or null when the modder left it empty. */
function nullIfBlank(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith("{")) return trimmed.replace(/\r\n/g, "\n");
  const body = trimmed
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `\t\t${line.trim()}`)
    .join("\n");
  return `{\n${body}\n\t}`;
}

export interface EffectFieldOptions {
  label: string;
  doc?: string;
  /** Drawn without the label column: the section it sits in already names it. */
  bare?: boolean;
  /** The block the file already has, or "". */
  value: string;
  /** The perk's key: the tooltip loc keys follow it. */
  name: string;
  placeholder: string;
  /** The loc the workspace already has for a key, when the host answered it. */
  locOf: (key: string) => string | undefined;
  /** Offer to copy another perk's effect block in, anchored on the button. */
  onTemplate?: (anchor: HTMLElement) => void;
  /** Save and open the definition in the editor, from the script area's foot. */
  onOpenFile?: () => void;
}

/**
 * One tooltip line. `from` is the key the sentence was READ from when it is not
 * this line's own: a line copied off another perk keeps that perk's key as the
 * place to read its words, while the key it WRITES follows this perk. Writing
 * the copied key instead would override the game's own sentence for every perk
 * that prints it (`localization/replace` is what a vanilla key lands in).
 */
interface TooltipLine {
  key: string;
  text: string;
  from?: string;
}

export interface EffectField extends BlockField {
  /** The loc pairs the tooltip lines need written. */
  loc(): { key: string; value: string }[];
  /** The keys whose sentence the owner should ask the host for. */
  keys(): string[];
  /** Fill the sentences the host answered, for rows the modder has not typed. */
  fillLoc(): void;
  /** Follow the perk's key, for every line whose key was derived from the old one. */
  rename(was: string, now: string): void;
  /** Drop another perk's effect block in as the starting point. */
  useBlock(text: string): void;
}

/**
 * A perk's effect as the sentences it prints. Each row is one tooltip line: the
 * loc key (derived from the perk's key, shown but not typed) and the sentence
 * the player reads. Anything else about an effect stays script.
 */
export function effectField(options: EffectFieldOptions): EffectField {
  const listeners: (() => void)[] = [];
  const fire = (): void => listeners.forEach((fn) => fn());
  let name = options.name;
  const firstRead = readEffectLines(options.value);
  let lines: TooltipLine[] = (firstRead.ok ? firstRead.value : []).map((key) => ({
    key,
    text: options.locOf(key) ?? "",
  }));

  const list = el("div", "px-list");
  const add = ghost("Add a tooltip line", "plus");
  const template = ghost("Start from a game perk's effect", "copy");
  template.hidden = !options.onTemplate;
  template.onclick = () => options.onTemplate?.(template);

  const state = advanced({
    label: "effect",
    placeholder: options.placeholder,
    why:
      "This effect does more than a tooltip line, so it stays script. The perk's own work usually happens in an on_action; " +
      "the effect block is what the player reads.",
    onChange: fire,
    ...(options.onOpenFile ? { onOpenFile: options.onOpenFile } : {}),
    seed: () => writeEffectLines(lines.map((l) => l.key)),
    toBuilder: (text) => {
      const read = readEffectLines(text);
      if (!read.ok) return read.line;
      lines = read.value.map((key) => ({ key, text: options.locOf(key) ?? "" }));
      paint();
      return null;
    },
  });

  function paint(): void {
    list.replaceChildren(
      ...lines.map((line, index) => {
        const box = el("div", "px-item px-stack");
        const input = document.createElement("input");
        input.className = "px-input";
        input.dataset.size = "sm";
        input.value = line.text;
        input.placeholder = "What this perk does, in the player's words";
        input.addEventListener("change", () => {
          lines[index] = { ...lines[index], text: input.value };
          fire();
        });
        const foot = el("div", "px-row");
        const key = el("code", "px-mono px-xs px-muted", line.key);
        key.dataset.tip = "The loc key the game prints. It follows the perk's key, so it is not typed.";
        key.dataset.tipWrap = "";
        const drop = iconButton("Remove this line", "trash");
        drop.onclick = () => {
          lines.splice(index, 1);
          paint();
          fire();
        };
        foot.append(key, el("span", "px-grow"), drop);
        box.append(input, foot);
        return box;
      })
    );
    list.hidden = lines.length === 0;
  }

  add.onclick = () => {
    lines.push({ key: effectKeyFor(name, lines.length), text: "" });
    paint();
    fire();
  };

  state.body.append(list, add, template);
  paint();
  openRaw(state, options.value, () => readEffectLines(options.value));

  return {
    el: options.bare ? state.box : builderRow(options.label, options.doc, state.box).row,
    get: () => (state.raw ? nullIfBlank(state.text()) : writeEffectLines(lines.map((l) => l.key))),
    loc: () =>
      state.raw
        ? []
        : lines
            .filter((l) => l.key.trim() !== "" && l.text.trim() !== "")
            .map((l) => ({ key: l.key, value: l.text })),
    keys: () => [...new Set(lines.flatMap((l) => [l.key, l.from ?? l.key]).filter((key) => key !== ""))],
    fillLoc: () => {
      let filled = false;
      lines = lines.map((line) => {
        const value = options.locOf(line.from ?? line.key);
        if (line.text.trim() !== "" || value === undefined) return line;
        filled = true;
        return { ...line, text: value };
      });
      if (filled) paint();
    },
    rename: (was, now) => {
      name = now;
      lines = lines.map((line, index) =>
        line.key === effectKeyFor(was, index) ? { ...line, key: effectKeyFor(now, index) } : line
      );
      paint();
    },
    useBlock: (text) => {
      const read = readEffectLines(text);
      if (!read.ok) {
        state.setRaw(true, text);
        state.showNote(read.line);
      } else {
        // The copy starts from the other perk's WORDS, under this perk's own
        // keys: its keys stay only as where the sentence is read from.
        lines = read.value.map((key, index) => ({
          key: effectKeyFor(name, index),
          from: key,
          text: options.locOf(key) ?? "",
        }));
        state.note.hidden = true;
        state.setRaw(false);
        paint();
      }
      fire();
    },
    onChange: (listener) => listeners.push(listener),
  };
}

export interface ChanceFieldOptions {
  label: string;
  doc?: string;
  /** Drawn without the label column: the section it sits in already names it. */
  bare?: boolean;
  /** The block the file already has, or "". */
  value: string;
  /** A real number from the game's own files. */
  placeholder: string;
  /** What the number drags on when there is no label column of its own. */
  handle?: HTMLElement;
  /** Save and open the definition in the editor, from the script area's foot. */
  onOpenFile?: () => void;
}

/**
 * The AI's weight for a perk: one number, dragged on its label the way every
 * other number in the creators is (shared/scrub.ts). A block that weighs the
 * choice with `if = { limit = … multiply = … }` opens as script instead.
 */
export function chanceField(options: ChanceFieldOptions): BlockField {
  const listeners: (() => void)[] = [];
  const fire = (): void => listeners.forEach((fn) => fn());
  const input = document.createElement("input");
  input.className = "px-input";
  input.dataset.size = "sm";
  input.type = "number";
  input.step = "1";
  input.placeholder = options.placeholder;
  const parsed = parseChanceValue(options.value);
  input.value = parsed === null ? "" : String(parsed);
  const read = (): number | null => (input.value.trim() === "" ? null : Number(input.value));
  input.addEventListener("change", fire);

  const box = el("div", "px-row");
  box.style.maxWidth = "140px";
  box.append(input);
  const state = advanced({
    label: "chance",
    placeholder: `{ value = ${options.placeholder} }`,
    why: "This block weighs the choice with more than a number, so it stays script.",
    onChange: fire,
    ...(options.onOpenFile ? { onOpenFile: options.onOpenFile } : {}),
    seed: () => writeChanceValue(read()),
    toBuilder: (text) => {
      const answer = readChanceValue(text);
      if (!answer.ok) return answer.line;
      input.value = answer.value === null ? "" : String(answer.value);
      return null;
    },
  });
  state.body.append(box);
  const built = options.bare ? null : builderRow(options.label, options.doc, state.box);
  // The number drags on its label, never on the input, so the box is only
  // ever typed in. Without a label column of its own the owner names a handle.
  const handle = built?.label ?? options.handle;
  scrubbable(input, {
    step: 1,
    ...(handle ? { handle } : {}),
    onChange: () => undefined,
    onCommit: fire,
  });
  openRaw(state, options.value, () => readChanceValue(options.value));
  return {
    el: built?.row ?? state.box,
    get: () => (state.raw ? nullIfBlank(state.text()) : writeChanceValue(read())),
    onChange: (listener) => listeners.push(listener),
  };
}
