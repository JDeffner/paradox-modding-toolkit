/**
 * `doctrine_character_modifier` as the list it really is.
 *
 * `_dynasty_perks.info` documents the key once, so the harvest reports it once
 * and a form that models one key models one block. The game writes as many as
 * the perk needs: erudition_legacy_2 has two and erudition_legacy_4 has three
 * (00_dynasty_perks.txt, measured 2026-09-04), one per doctrine, each opening
 * with `name = <perk>_modifier_name` and `doctrine = <key>` before its
 * modifiers. A form with one block silently drops the rest of a loaded perk,
 * which is the one thing a creator may never do.
 *
 * So this is 0..n blocks: each with its doctrine, its optional name (the loc
 * key the game heads the group with) and its modifier rows. Everything a block
 * carries that no row can hold stays a `raw` entry in its own place, so a
 * loaded perk written straight back out is byte for byte what it was.
 *
 * Browser code. No game knowledge: the doctrine vocabulary, the modifier list
 * and the key's own documentation all arrive from the owner.
 */
import type { EventVocabularyItem } from "@px-lsp/protocol/protocol";
import { iconEl } from "../../shared/icons";
import { refField, textField, type Field, type ModifierRow } from "../../shared/fields";
import { rowsField, type RowsItem } from "./rowsField";
import {
  doctrineOf,
  modifierNameOf,
  modifierRows,
  parseModifierBlock,
  updateModifierRows,
  withDoctrine,
  withModifierName,
  writeModifierBlock,
  type ModifierEntry,
} from "./script";

export interface DoctrineFieldOptions {
  /** The blocks the perk already has, in file order; empty for a fresh perk. */
  values: readonly string[];
  /** The perk's key: a name line the modder adds is derived from it. */
  perk: string;
  /** The doctrine vocabulary; an empty list falls back to a plain text box. */
  doctrines: readonly EventVocabularyItem[];
  /** What `_dynasty_perks.info` says about the `doctrine` line, when it says it. */
  doctrineDoc?: string;
  /** A doctrine's picture, when the host resolved one. */
  thumb?: (value: string) => string | null;
  /** The modifier vocabulary the rows pick from. */
  modifiers: readonly RowsItem[];
  /** The line the game prints for a modifier row. */
  preview?: (row: ModifierRow) => HTMLElement | null;
  /** The sentence the workspace already has for a loc key. */
  locOf: (key: string) => string | undefined;
}

export interface DoctrineField {
  el: HTMLElement;
  /** One `{ … }` block per doctrine modifier, in order; empty when there are none. */
  blocks(): string[];
  /** The loc pairs the name lines need written. */
  loc(): { key: string; value: string }[];
  /** The loc keys whose sentence the owner should ask the host for. */
  keys(): string[];
  /** Fill in the sentences the host answered, for names the modder has not typed. */
  fillLoc(): void;
  /** Follow the perk's key, for every name line derived from the old one. */
  rename(was: string, now: string): void;
  /** Every modifier row of every block, for the tile's tooltip. */
  rows(): ModifierRow[];
  /** True while the perk has at least one block, so a section can open on it. */
  any(): boolean;
  onChange(listener: () => void): void;
}

/**
 * The loc key a perk's modifier group is named with. Measured: both perks that
 * name their doctrine modifiers write `<perk key>_modifier_name` on every one
 * of their blocks (erudition_legacy_2, erudition_legacy_4).
 */
export function modifierNameKey(perk: string): string {
  return `${perk}_modifier_name`;
}

interface Block {
  el: HTMLElement;
  /** The block as it was read, so everything no control holds survives a save. */
  entries: ModifierEntry[];
  doctrine: Field<string>;
  rows: Field<ModifierRow[]>;
  /** The `name =` key the FILE had, or "" when the block came with none. */
  fileName: string;
  /** The sentence the player reads, or "" while nobody typed one. */
  text: string;
  input: HTMLInputElement;
  code: HTMLElement;
}

function el(tag: string, cls = "", text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function doctrineField(options: DoctrineFieldOptions): DoctrineField {
  const listeners: (() => void)[] = [];
  const fire = (): void => listeners.forEach((fn) => fn());
  let perk = options.perk;
  const blocks: Block[] = [];

  const list = el("div", "px-stack");
  const box = el("div", "px-stack");
  const add = document.createElement("button");
  add.className = "px-btn";
  add.dataset.variant = "ghost";
  add.dataset.size = "xs";
  add.append(iconEl("plus"), "Add a doctrine modifier");
  box.append(list, add);

  /** The key a block writes on its `name =` line, or "" when it writes none. */
  const nameKeyOf = (block: Block): string => {
    if (block.fileName !== "") return block.fileName;
    return block.text.trim() === "" ? "" : modifierNameKey(perk);
  };

  function makeBlock(value: string): Block {
    const entries = parseModifierBlock(value);
    const card = el("div", "doctrineblock");

    const doctrine =
      options.doctrines.length > 0
        ? refField({
            label: "Doctrine",
            ...(options.doctrineDoc ? { doc: options.doctrineDoc } : {}),
            items: options.doctrines.map((item) => ({ ...item })),
            value: doctrineOf(entries),
            ...(options.thumb ? { thumb: options.thumb } : {}),
          })
        : textField({
            label: "Doctrine",
            ...(options.doctrineDoc ? { doc: options.doctrineDoc } : {}),
            value: doctrineOf(entries),
          });

    const fileName = modifierNameOf(entries);
    const nameRow = el("div", "px-field");
    const nameLabel = el("span", "px-label", "Name");
    nameLabel.dataset.tip =
      "What the game calls this group of modifiers. It writes `name = <loc key>`, and the key follows the perk's.";
    nameLabel.dataset.tipWrap = "";
    const nameBody = el("div", "px-stack");
    const input = document.createElement("input");
    input.className = "px-input";
    input.dataset.size = "sm";
    input.placeholder = "What this group of modifiers is called";
    input.value = options.locOf(fileName) ?? "";
    const foot = el("div", "px-row");
    const code = el("code", "px-mono px-xs px-muted");
    code.dataset.tip = "The loc key the block writes. It follows the perk's key, so it is not typed.";
    code.dataset.tipWrap = "";
    foot.append(code);
    nameBody.append(input, foot);
    nameRow.append(nameLabel, nameBody);

    const rows = rowsField({
      label: "Modifiers",
      items: options.modifiers,
      rows: modifierRows(entries),
      addLabel: "Add modifier",
      pickLabel: "pick a modifier",
      step: 0.1,
      ...(options.preview ? { preview: options.preview } : {}),
    });

    const drop = document.createElement("button");
    drop.className = "px-btn";
    drop.dataset.variant = "ghost";
    drop.dataset.size = "icon-xs";
    drop.dataset.tip = "Remove this doctrine modifier";
    drop.append(iconEl("trash"));
    const tools = el("span", "px-item-tools");
    tools.append(drop);

    const block: Block = { el: card, entries, doctrine, rows, fileName, text: input.value, input, code };
    input.addEventListener("change", () => {
      block.text = input.value;
      paintName(block);
      fire();
    });
    drop.onclick = () => {
      const at = blocks.indexOf(block);
      if (at >= 0) blocks.splice(at, 1);
      card.remove();
      fire();
    };
    doctrine.onChange(fire);
    rows.onChange(fire);

    card.append(tools, doctrine.el, nameRow, rows.el);
    paintName(block);
    return block;
  }

  function paintName(block: Block): void {
    const key = nameKeyOf(block);
    block.code.textContent = key;
    block.code.hidden = key === "";
  }

  add.onclick = () => {
    const block = makeBlock("");
    blocks.push(block);
    list.append(block.el);
    fire();
  };

  for (const value of options.values) {
    const block = makeBlock(value);
    blocks.push(block);
    list.append(block.el);
  }

  return {
    el: box,
    blocks: () =>
      blocks
        .map((block) => {
          let entries = updateModifierRows(block.entries, block.rows.get());
          entries = withDoctrine(entries, block.doctrine.get());
          entries = withModifierName(entries, nameKeyOf(block));
          return writeModifierBlock(entries);
        })
        .filter((text): text is string => text !== null),
    loc: () =>
      blocks
        .filter((block) => block.text.trim() !== "" && nameKeyOf(block) !== "")
        .map((block) => ({ key: nameKeyOf(block), value: block.text.trim() })),
    keys: () => [...new Set(blocks.map(nameKeyOf).filter((key) => key !== ""))],
    fillLoc: () => {
      for (const block of blocks) {
        if (block.text.trim() !== "") continue;
        const value = options.locOf(nameKeyOf(block));
        if (value === undefined) continue;
        block.text = value;
        block.input.value = value;
      }
    },
    rename: (was, now) => {
      perk = now;
      for (const block of blocks) {
        if (block.fileName === modifierNameKey(was)) block.fileName = modifierNameKey(now);
        paintName(block);
      }
    },
    rows: () => blocks.flatMap((block) => block.rows.get()),
    any: () => blocks.length > 0,
    onChange: (listener) => listeners.push(listener),
  };
}
