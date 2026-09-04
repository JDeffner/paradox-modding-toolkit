/**
 * A `name = number` list whose rows SHOW what they mean.
 *
 * A dynasty perk is almost nothing but such lists: `character_modifier` and
 * `doctrine_character_modifier` are modifiers with their numbers, `traits` is
 * traits with their AI weights. The shared `modifierListField` draws the same
 * shape, but its entries are bare keys: it cannot show the player's word for a
 * trait, its picture, or the line the game prints for a modifier, and this
 * panel's whole point is that the modder reads what the player will read.
 *
 * So this is that field with three additions and nothing else: `label` and
 * `image` on an entry, and a `preview` the owner renders per row (the game's
 * own modifier line). If `shared/fields.ts` ever grows them, this file goes.
 *
 * Browser code, styled by ui.css (`.px-field`, `.px-item`, `.px-modrow`). No
 * game knowledge: every entry, word and picture arrives from the owner.
 */
import { iconEl } from "../../shared/icons";
import { menu, type MenuItem } from "../../shared/overlay";
import { scrubbable } from "../../shared/scrub";
import type { Field, ModifierRow } from "../../shared/fields";

export interface RowsItem {
  value: string;
  /** The player's word for it; the key stays visible as the hint. */
  label?: string;
  hint?: string;
  doc?: string;
}

export interface RowsFieldOptions {
  label: string;
  doc?: string;
  /** Drawn without the label column: the section it sits in already names it. */
  bare?: boolean;
  items: readonly RowsItem[];
  rows?: readonly ModifierRow[];
  addLabel: string;
  /** What an empty picker reads as ("pick a modifier"). */
  pickLabel: string;
  /** An EXAMPLE number, shown while the row still carries the default. */
  placeholder?: string;
  /** Scrub and step size: 0.1 for a modifier, 1 for an AI weight. */
  step?: number;
  /** A picture for an entry, when the owner resolved one. */
  image?: (value: string) => string | null;
  /** The line the game prints for the row, drawn under the controls. */
  preview?: (row: ModifierRow) => HTMLElement | null;
}

function el(tag: string, cls = "", text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function rowsField(options: RowsFieldOptions): Field<ModifierRow[]> {
  const listeners: ((value: ModifierRow[]) => void)[] = [];
  let current: ModifierRow[] = (options.rows ?? []).map((row) => ({ ...row }));
  const read = (): ModifierRow[] => current.map((row) => ({ ...row }));
  const fire = (): void => listeners.forEach((fn) => fn(read()));
  const step = options.step ?? 0.1;

  const box = el("div", "px-stack");
  const list = el("div", "px-list");
  const add = document.createElement("button");
  add.className = "px-btn";
  add.dataset.variant = "ghost";
  add.dataset.size = "xs";
  add.append(iconEl("plus"), options.addLabel);

  const menuItems = (): MenuItem[] =>
    options.items.map((item) => {
      const url = options.image?.(item.value) ?? null;
      return {
        value: item.value,
        label: item.label || item.value,
        ...(item.label ? { hint: item.value } : item.hint ? { hint: item.hint } : {}),
        ...(item.doc ? { description: item.doc } : {}),
        ...(url ? { image: url } : {}),
      };
    });

  /** The picker's face: the player's word, with the key it writes underneath. */
  const faceOf = (value: string): string => {
    if (value === "") return options.pickLabel;
    return options.items.find((item) => item.value === value)?.label || value;
  };

  const paint = (): void => {
    list.replaceChildren();
    current.forEach((row, index) => {
      const line = el("div", "px-item px-modrow");
      const trigger = document.createElement("button");
      trigger.className = "px-btn px-dropdown";
      trigger.dataset.variant = "outline";
      trigger.dataset.size = "sm";
      const url = options.image?.(row.name) ?? null;
      if (url) {
        const img = document.createElement("img");
        img.className = "px-chip-thumb";
        img.src = url;
        img.alt = "";
        trigger.append(img);
      }
      const face = el("span", "px-truncate", faceOf(row.name));
      if (row.name === "") trigger.dataset.placeholder = "";
      else trigger.dataset.tip = row.name;
      trigger.append(face, iconEl("chevronDown"));
      trigger.onclick = () =>
        menu(trigger, menuItems(), {
          value: row.name,
          search: true,
          width: 320,
          onPick: (picked) => {
            current[index] = { ...current[index], name: picked };
            paint();
            fire();
          },
        });

      const value = document.createElement("input");
      value.className = "px-input";
      value.dataset.size = "sm";
      value.type = "number";
      value.step = String(step);
      value.value = String(row.value);
      if (options.placeholder) value.placeholder = options.placeholder;
      const commit = (): void => {
        current[index] = { ...current[index], value: Number(value.value) || 0 };
        paint();
        fire();
      };
      value.addEventListener("change", commit);
      scrubbable(value, { step, onChange: () => undefined, onCommit: commit });

      const drop = document.createElement("button");
      drop.className = "px-btn";
      drop.dataset.variant = "ghost";
      drop.dataset.size = "icon-xs";
      drop.dataset.tip = "Remove this row";
      drop.append(iconEl("trash"));
      drop.onclick = () => {
        current.splice(index, 1);
        paint();
        fire();
      };

      line.append(trigger, value, drop);
      list.append(line);
      const preview = row.name === "" ? null : (options.preview?.(row) ?? null);
      if (preview) {
        const under = el("div", "rows-preview");
        under.append(preview);
        list.append(under);
      }
    });
    list.hidden = current.length === 0;
  };

  add.onclick = () => {
    current.push({ name: "", value: Number(options.placeholder ?? "0") || 0 });
    paint();
    fire();
  };

  box.append(list, add);
  paint();

  let row: HTMLElement = box;
  if (!options.bare) {
    row = el("div", "px-field");
    const label = el("span", "px-label", options.label);
    if (options.doc) {
      label.dataset.tip = options.doc;
      label.dataset.tipWrap = "";
      label.style.cursor = "help";
    }
    row.append(label, box);
  }

  return {
    el: row,
    get: read,
    set: (rows) => {
      current = rows.map((r) => ({ ...r }));
      paint();
    },
    onChange: (listener) => listeners.push(listener),
  };
}
