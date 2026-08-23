/**
 * The inspector: what the selected event is, and the guided way to change it.
 *
 * The guiding is the point. A field whose values the server can enumerate
 * (`type`, `theme`, anything the schema calls a reference field) gets a
 * searchable dropdown that lists every real value with its own one-line
 * documentation; a field with free text keeps an input. Effects and triggers
 * are added the same way, from the game's own token list. Nothing here invents
 * a name: if `paradox/eventVocabulary` does not know a value set, the row is an
 * input and says so by being one.
 *
 * No edit reaches disk from here. Every change is handed to `onEdit` as a
 * PendingEdit, which the history records and the toolbar's Save applies.
 */
import type {
  EventDetail,
  EventFieldInfo,
  EventLocField,
  EventOptionInfo,
  EventVocabularyItem,
  EventVocabularyResult,
} from "@px-lsp/protocol/protocol";
import type { PendingEdit } from "../history";
import type { MenuItem } from "../../shared/overlay";
import { iconEl } from "../../shared/icons";
import { badge, button, dropdown, el, iconButton, input } from "./dom";

export interface InspectorCallbacks {
  onOpen(file: string, line?: number): void;
  onRefocus(id: string): void;
  onSimulate(id: string): void;
  onEdit(label: string, edit: PendingEdit): void;
}

/** Keys that open a block: they are sections and options, not scalar fields. */
const BLOCK_HINT = "block";
/** Option keys that gate or label the option rather than describing an effect. */
const OPTION_META = new Set(["name", "trigger", "ai_chance", "ai_value"]);

const EMPTY_VOCABULARY: EventVocabularyResult = {
  eventKeys: [],
  optionKeys: [],
  values: {},
  effects: [],
  triggers: [],
  savedScopes: [],
};

export class Inspector {
  private vocabulary: EventVocabularyResult = EMPTY_VOCABULARY;
  private pending: PendingEdit[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly cb: InspectorCallbacks
  ) {}

  setVocabulary(vocabulary: EventVocabularyResult): void {
    this.vocabulary = vocabulary;
  }

  showPlaceholder(): void {
    this.root.replaceChildren(
      el("div", "hint", "Click a card to read it, edit its text and fields, and see what it leads to.")
    );
  }

  showLoading(id: string): void {
    this.root.replaceChildren(el("div", "hint", `Loading ${id}…`));
  }

  render(detail: EventDetail | null, id: string, pending: PendingEdit[]): void {
    this.pending = pending;
    this.root.replaceChildren();
    if (!detail) {
      this.root.appendChild(
        el("div", "hint", `No editable detail for ${id}. It is vanilla content, or not an event.`)
      );
      return;
    }

    this.root.appendChild(el("h2", "", detail.id));
    const chips = el("div", "badges");
    if (detail.type) chips.appendChild(badge(detail.type));
    if (detail.hidden) chips.appendChild(badge("hidden"));
    if (chips.childElementCount > 0) this.root.appendChild(chips);

    const actions = el("div", "actions");
    actions.append(
      button("Source", "fileText", `Open the source at line ${detail.line + 1}`, () =>
        this.cb.onOpen(detail.file, detail.line + 1)
      ),
      button("Simulate", "play", `Walk through ${detail.id} step by step`, () =>
        this.cb.onSimulate(detail.id)
      ),
      button("Center", "locate", `Rebuild the graph around ${detail.id}`, () => this.cb.onRefocus(detail.id))
    );
    this.root.appendChild(actions);

    this.renderFields(detail);
    this.renderText(detail);
    this.renderLogic(detail);
    this.renderOptions(detail);
    this.renderRefs(detail);
  }

  // --- sections -------------------------------------------------------------

  private renderFields(detail: EventDetail): void {
    this.section("Event", "How the game presents this event. Lists come from your game files.");
    const written = new Set(detail.fields.map((f) => f.key.toLowerCase()));
    // The keys whose value is one of the strings the Text section already
    // edits: showing `title = my.event.t` here as well would offer two ways to
    // change the same line, one of which writes the key and one the text.
    const owned = locKeys([detail.title, detail.desc, detail.flavor]);
    for (const field of detail.fields) {
      if (owned.has(field.value)) continue;
      this.root.appendChild(this.fieldRow(detail, field, detail.file, 1));
    }
    const offerable = this.vocabulary.eventKeys.filter(
      (k) => k.hint !== BLOCK_HINT && !written.has(k.value.toLowerCase())
    );
    if (offerable.length > 0) {
      this.root.appendChild(
        this.addRow("Add field", offerable, "A key this event does not set yet", (key, value) => {
          this.cb.onEdit(`set ${key}`, {
            kind: "setField",
            id: detail.id,
            file: detail.file,
            key,
            value,
            line: null,
            insertLine: detail.bodyLine,
            indent: 1,
          });
        })
      );
    }
  }

  private renderText(detail: EventDetail): void {
    this.section("Text", "What the player reads. Saving writes these into your localization file.");
    this.locRow("Title", detail.title, detail.id);
    this.locRow("Description", detail.desc, detail.id);
    if (detail.flavor) this.locRow("Flavor", detail.flavor, detail.id);
  }

  private renderLogic(detail: EventDetail): void {
    if (detail.sections.length === 0) return;
    this.section("Logic", "The blocks the game runs, in source order. Click one to open it.");
    for (const s of detail.sections) {
      const row = el("div", "locrow");
      row.appendChild(this.link(s.name, () => this.cb.onOpen(detail.file, s.line + 1)));
      const chips = el("div", "badges");
      for (const key of s.keys) chips.appendChild(badge(key, "outline"));
      row.appendChild(chips);
      this.root.appendChild(row);
    }
  }

  private renderOptions(detail: EventDetail): void {
    this.section(
      `Options (${detail.options.length})`,
      "What the player can choose. Each option's effects run when it is picked."
    );
    detail.options.forEach((option, index) => this.root.appendChild(this.optionBlock(detail, option, index)));

    const add = button(
      "Add option",
      "plus",
      "Insert a scaffolded option and create its localization key",
      () =>
        this.cb.onEdit("add option", {
          kind: "addOption",
          id: detail.id,
          file: detail.file,
          endLine: detail.endLine,
          count: detail.options.length,
        }),
      "outline"
    );
    add.style.alignSelf = "flex-start";
    this.root.appendChild(add);
  }

  private optionBlock(detail: EventDetail, option: EventOptionInfo, index: number): HTMLElement {
    const block = el("div", "block");
    const head = el("div", "head");
    const caret = iconEl("chevronDown", "px-icon caret");
    caret.addEventListener("click", () => block.toggleAttribute("data-collapsed"));
    head.appendChild(caret);
    head.appendChild(this.link(`option ${index + 1}`, () => this.cb.onOpen(detail.file, option.line + 1)));
    if (option.hasTrigger) head.appendChild(badge("trigger", "outline"));
    if (option.hasAiChance) head.appendChild(badge("ai_chance", "outline"));
    block.appendChild(head);

    this.locRow("Text", option.name, detail.id, block);
    const written = new Set(option.fields.map((f) => f.key.toLowerCase()));
    const owned = locKeys([option.name]);
    for (const field of option.fields) {
      if (owned.has(field.value)) continue;
      block.appendChild(this.fieldRow(detail, field, detail.file, 2));
    }
    const effects = option.effectKeys.filter(
      (k) => !OPTION_META.has(k.toLowerCase()) && !written.has(k.toLowerCase())
    );
    if (effects.length > 0) {
      const chips = el("div", "badges");
      for (const key of effects) chips.appendChild(badge(key, "outline"));
      block.appendChild(chips);
    }

    const insert = (label: string, items: EventVocabularyItem[], tip: string) => {
      if (items.length === 0) return;
      block.appendChild(
        this.addRow(label, items, tip, (key, value) => {
          this.cb.onEdit(`add ${key}`, {
            kind: "setField",
            id: detail.id,
            file: detail.file,
            key,
            value,
            line: null,
            insertLine: option.bodyLine,
            indent: 2,
          });
        })
      );
    };
    insert("Add effect", this.vocabulary.effects, "An effect that runs when this option is picked");
    insert("Add trigger", this.vocabulary.triggers, "A check; it belongs inside the option's trigger block");
    return block;
  }

  private renderRefs(detail: EventDetail): void {
    if (detail.refs.length === 0) return;
    this.section(
      `References (${detail.refs.length})`,
      "Every scope, variable, scripted effect and value this event names. Click one to jump to where it is defined."
    );
    const list = el("div", "px-list");
    const order = ["saved_scope", "variable", "scripted_effect", "scripted_trigger", "script_value", "event"];
    const labels: Record<string, string> = {
      saved_scope: "scope",
      variable: "variable",
      scripted_effect: "effect",
      scripted_trigger: "trigger",
      script_value: "value",
      event: "event",
    };
    for (const kind of order) {
      for (const ref of detail.refs.filter((r) => r.kind === kind)) {
        const row = el("div", "px-item");
        row.title = ref.name;
        row.appendChild(el("span", "px-item-kind", labels[kind] ?? kind));
        row.appendChild(el("span", "px-item-label", ref.name));
        if (ref.defFile && (ref.defCount ?? 0) > 1) {
          row.appendChild(el("span", "px-item-label px-xs", `${ref.defCount} sites`));
        }
        row.appendChild(el("span", "px-item-label px-xs", `used @${ref.line + 1}`));
        row.addEventListener("click", () =>
          this.cb.onOpen(ref.defFile ?? detail.file, (ref.defFile ? ref.defLine : ref.line) ?? 0)
        );
        list.appendChild(row);
      }
    }
    this.root.appendChild(list);
  }

  // --- rows -----------------------------------------------------------------

  private section(title: string, hint: string): void {
    this.root.appendChild(el("div", "sub", title));
    this.root.appendChild(el("div", "hint", hint));
  }

  /** One `key = value` row: a dropdown when the value set is known, else an input. */
  private fieldRow(detail: EventDetail, field: EventFieldInfo, file: string, indent: number): HTMLElement {
    const row = el("div", "field");
    row.appendChild(el("span", "k", field.key));
    const holder = el("div", "v");
    const key = `${file}:${field.key}:${field.line}`;
    const current = this.pendingField(key) ?? field.value;
    const commit = (value: string): void => {
      if (value === field.value) return;
      this.cb.onEdit(`set ${field.key}`, {
        kind: "setField",
        id: detail.id,
        file,
        key: field.key,
        value,
        line: field.line,
        insertLine: field.line,
        indent,
      });
    };
    const options = this.vocabulary.values[field.key];
    holder.appendChild(
      options && options.length > 0
        ? dropdown(current, "choose", menuItems(options), docFor(options, current, field.key), commit)
        : input(current, "value", commit)
    );
    holder.appendChild(
      iconButton(
        "cornerDownRight",
        `Open line ${field.line + 1}`,
        () => this.cb.onOpen(file, field.line + 1),
        "icon-xs"
      )
    );
    if (current !== field.value) holder.appendChild(el("span", "pendingMark px-xs", "unsaved"));
    row.appendChild(holder);
    return row;
  }

  /** The "pick a key, type its value, insert it" row shared by fields and effects. */
  private addRow(
    label: string,
    items: EventVocabularyItem[],
    tip: string,
    onAdd: (key: string, value: string) => void
  ): HTMLElement {
    const row = el("div", "field");
    row.appendChild(el("span", "k", label));
    const holder = el("div", "v");
    let key = "";
    const value = input("yes", "value", () => undefined);
    const add = iconButton(
      "plus",
      "Add it. Nothing is written until you save",
      () => {
        if (key === "") return;
        onAdd(key, value.value.trim() === "" ? "yes" : value.value.trim());
      },
      "icon-xs"
    );
    const picker = dropdown("", "choose", menuItems(items), tip, (picked) => {
      key = picked;
    });
    value.style.maxWidth = "72px";
    holder.append(picker, value, add);
    row.appendChild(holder);
    return row;
  }

  /** A localizable string: its key, its current text, and an editable input. */
  private locRow(
    label: string,
    loc: EventLocField | undefined,
    eventId: string,
    into: HTMLElement = this.root
  ): void {
    const row = el("div", "locrow");
    row.appendChild(el("div", "k px-muted px-xs", label + (loc?.key ? ` · ${loc.key}` : "")));
    if (!loc) {
      row.appendChild(el("div", "hint", "This event sets no such text."));
    } else if (loc.dynamic) {
      row.appendChild(
        el("div", "hint", "Built by a block (first_valid / triggered_desc). Edit it in the source.")
      );
    } else {
      const pendingKey = `loc:${loc.key}`;
      const current = this.pendingField(pendingKey) ?? loc.text ?? "";
      const edit = el("div", "edit");
      edit.appendChild(
        input(current, loc.text === undefined ? "No localization yet. Type one" : "", (next) => {
          if (next === (loc.text ?? "")) return;
          this.cb.onEdit(`edit ${loc.key}`, {
            kind: "editLoc",
            id: eventId,
            key: loc.key,
            value: next,
            file: loc.file,
            line: loc.line,
          });
        })
      );
      if (current !== (loc.text ?? "")) edit.appendChild(el("span", "pendingMark px-xs", "unsaved"));
      row.appendChild(edit);
    }
    into.appendChild(row);
  }

  private link(label: string, onClick: () => void): HTMLElement {
    const b = el("button", "px-btn", label);
    b.dataset.variant = "link";
    b.addEventListener("click", onClick);
    return b;
  }

  /** The newest pending value for a field, so an unsaved edit stays visible. */
  private pendingField(key: string): string | undefined {
    let found: string | undefined;
    for (const edit of this.pending) {
      if (edit.kind === "editLoc" && `loc:${edit.key}` === key) found = edit.value;
      else if (edit.kind === "setField" && `${edit.file}:${edit.key}:${edit.line}` === key)
        found = edit.value;
    }
    return found;
  }
}

/** The loc keys a set of localizable fields names, for de-duplicating rows. */
function locKeys(fields: Array<EventLocField | undefined>): Set<string> {
  const keys = new Set<string>();
  for (const field of fields) if (field?.key) keys.add(field.key);
  return keys;
}

function menuItems(items: EventVocabularyItem[]): MenuItem[] {
  return items.map((item) => ({
    value: item.value,
    label: item.value,
    description: item.doc,
    hint: item.hint,
  }));
}

/** The tooltip on a value dropdown: what the current value means. */
function docFor(items: EventVocabularyItem[], current: string, key: string): string {
  const hit = items.find((i) => i.value === current);
  return hit?.doc ? `${current}: ${hit.doc}` : `Pick a value for ${key}`;
}
