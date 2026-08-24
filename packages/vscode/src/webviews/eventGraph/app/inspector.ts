/**
 * The inspector: the selected event as a STRUCTURED EDITOR, not a summary.
 *
 * Every block the event runs — immediate, after, each option's effects, its
 * trigger, its ai_chance — renders as an indented tree of the real script.
 * The tree READS as plain tokenized text: a value only becomes a control
 * (a menu when the server can enumerate the values, an input with inline
 * completions otherwise) when it is clicked, so a hundred lines never look
 * like a hundred form fields. The same restraint applies to inserts: every
 * "Add …" is one muted button that expands into its picker on demand, and
 * Settings, Options and References start folded, each header carrying
 * enough (the option's text, the keys set) to be read without unfolding.
 *
 * No edit reaches disk from here. Every change is handed to `onEdit` as a
 * PendingEdit, which the history records and the toolbar's Save applies. Until
 * then the panel draws the detail with those edits folded over it
 * (pendingView.ts), each changed or added row marked "unsaved".
 *
 * What acts on the whole event (open the source, simulate it, re-centre the
 * graph on it) is NOT here: those are the tools rail's, and one button per job
 * beats the same button in two places.
 */
import type {
  EventDetail,
  EventGateInfo,
  EventLocField,
  EventOptionInfo,
  EventScriptLine,
  EventSectionInfo,
  EventVocabularyItem,
  EventVocabularyResult,
} from "@px-lsp/protocol/protocol";
import type { PendingEdit } from "../history";
import { menu, type MenuItem } from "../../shared/overlay";
import { iconEl } from "../../shared/icons";
import { attachSuggest, badge, button, dropdown, el, iconButton, input } from "./dom";
import { fieldRowKey, locRowKey, pendingOverlay, type PendingOverlay } from "./pendingView";

export interface InspectorCallbacks {
  onOpen(file: string, line?: number): void;
  onEdit(label: string, edit: PendingEdit): void;
}

/** Keys that open a block: they are sections and options, not scalar fields. */
const BLOCK_HINT = "block";
/** Inside these blocks, the "+" offers TRIGGERS; anywhere else, effects. */
const TRIGGER_BLOCKS = new Set(["trigger", "limit", "and", "or", "not", "nor", "nand", "trigger_if"]);
/** `key op value` on one rendered line; openers end in `{` and never match. */
const SCALAR_LINE = /^(\S+) (=|\?=|==|!=|<=|>=|<|>) (?!.*\{$)(.+)$/;
/** `key op {` or `key op tag {`. */
const OPENER_LINE = /^(\S+) (=|\?=|==|!=|<=|>=|<|>)( \S+)? \{$/;

const EMPTY_VOCABULARY: EventVocabularyResult = {
  eventKeys: [],
  optionKeys: [],
  values: {},
  effects: [],
  triggers: [],
  savedScopes: [],
};

const EMPTY_OVERLAY: PendingOverlay = { values: new Map(), inserted: new Map(), options: 0 };

export class Inspector {
  private vocabulary: EventVocabularyResult = EMPTY_VOCABULARY;
  private view: PendingOverlay = EMPTY_OVERLAY;
  /** The mod's own event ids, so firing keys get completions, not a blank. */
  private eventIds: string[] = [];
  /** Explicit fold choices, by `<event>:<line>`; forgotten with the panel.
   *  Blocks without an entry use their own default (options start folded). */
  private folded = new Map<string, boolean>();

  constructor(
    private readonly root: HTMLElement,
    private readonly cb: InspectorCallbacks
  ) {}

  setVocabulary(vocabulary: EventVocabularyResult): void {
    this.vocabulary = vocabulary;
  }

  setCatalog(ids: string[]): void {
    this.eventIds = ids;
  }

  showPlaceholder(): void {
    this.root.replaceChildren(
      el(
        "div",
        "hint",
        "Click a card to read it, edit its text, fields and effects, and see what it leads to."
      )
    );
  }

  showLoading(id: string): void {
    this.root.replaceChildren(el("div", "hint", `Loading ${id}…`));
  }

  /** Scroll to the option or section that starts at source `line`, and flash it. */
  revealLine(line: number): void {
    const target = this.root.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (!target) return;
    const body = target.querySelector<HTMLElement>(".bbody");
    if (body?.hidden) target.querySelector<HTMLElement>(".head")?.click();
    target.scrollIntoView({ block: "start", behavior: "smooth" });
    target.classList.add("revealed");
    setTimeout(() => target.classList.remove("revealed"), 1600);
  }

  render(detail: EventDetail | null, id: string, pending: PendingEdit[]): void {
    this.view = pendingOverlay(id, pending);
    this.root.replaceChildren();
    if (!detail) {
      this.root.appendChild(
        el("div", "hint", `No editable detail for ${id}. It is vanilla content, or not an event.`)
      );
      return;
    }

    const head = el("div", "insHead");
    head.appendChild(el("h2", "", detail.id));
    head.appendChild(
      iconButton("fileText", "Open the source", () => this.cb.onOpen(detail.file, detail.line + 1), "icon-xs")
    );
    this.root.appendChild(head);
    const chips = el("div", "badges");
    if (detail.type) chips.appendChild(badge(detail.type));
    if (detail.hidden) chips.appendChild(badge("hidden"));
    if (chips.childElementCount > 0) this.root.appendChild(chips);

    this.renderText(detail);
    this.renderFields(detail);
    for (const s of detail.sections) this.renderSection(detail, s);
    this.renderOptions(detail);
    this.renderRefs(detail);
  }

  // --- sections -------------------------------------------------------------

  private renderText(detail: EventDetail): void {
    this.section("Text", "What the player reads. Saving writes these into your localization file.");
    this.locRow("Title", detail.title, detail.id);
    this.locRow("Description", detail.desc, detail.id);
    if (detail.flavor) this.locRow("Flavor", detail.flavor, detail.id);
  }

  private renderFields(detail: EventDetail): void {
    const written = new Set(detail.fields.map((f) => f.key.toLowerCase()));
    const owned = locKeys([detail.title, detail.desc, detail.flavor]);
    const fields = detail.fields.filter((f) => !owned.has(f.value));
    const block = this.foldable(
      detail,
      "settings",
      "Settings",
      detail.line,
      (body) => {
        if (fields.length === 0) body.appendChild(el("div", "hint", "Nothing set beyond the defaults."));
        for (const field of fields) {
          body.appendChild(this.scalarRow(detail, field.key, field.value, field.line, 1, 0, "="));
        }
        this.insertedRows(detail.bodyLine, body);
        const offerable = this.vocabulary.eventKeys.filter(
          (k) => k.hint !== BLOCK_HINT && !written.has(k.value.toLowerCase())
        );
        if (offerable.length > 0) {
          body.appendChild(
            this.addRow("Add field", offerable, "A key this event does not set yet", (key, value) => {
              this.insertEdit(detail, key, value, detail.bodyLine, 1);
            })
          );
        }
      },
      { folded: true, subtitle: fields.map((f) => f.key).join(" · ") }
    );
    this.root.appendChild(block);
  }

  /** An event-level block (trigger, immediate, after…): a collapsible tree. */
  private renderSection(detail: EventDetail, s: EventSectionInfo): void {
    const context = TRIGGER_BLOCKS.has(s.name.toLowerCase()) ? "trigger" : "effect";
    const block = this.foldable(detail, `sec:${s.line}`, cap(s.name), s.line, (body) => {
      this.tree(detail, s.lines, s.totalLines, 2, s.line, context, body);
      this.insertedRows(s.line + 1, body);
      body.appendChild(
        this.addRow(
          context === "trigger" ? "Add condition" : "Add effect",
          context === "trigger" ? this.vocabulary.triggers : this.vocabulary.effects,
          context === "trigger" ? "A check this block also requires" : "An effect this block also runs",
          (key, value) => this.insertEdit(detail, key, value, s.line + 1, 2)
        )
      );
    });
    block.dataset.line = String(s.line);
    this.root.appendChild(block);
  }

  private renderOptions(detail: EventDetail): void {
    this.section(
      `Options (${detail.options.length})`,
      "What the player can choose. Each option's effects run when it is picked."
    );
    detail.options.forEach((option, index) => this.root.appendChild(this.optionBlock(detail, option, index)));
    // The options this session added are not in `detail` (nothing is written
    // before Save), so they are drawn from the pending list instead.
    for (let i = 0; i < this.view.options; i++) {
      const block = el("div", "block");
      const head = el("div", "head");
      head.append(
        el("span", "", `option ${detail.options.length + i + 1}`),
        el("span", "pendingMark px-xs", "unsaved")
      );
      block.append(head, el("div", "hint", "Saving writes this option and its localization key."));
      this.root.appendChild(block);
    }

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
          count: detail.options.length + this.view.options,
        }),
      "outline"
    );
    add.style.alignSelf = "flex-start";
    this.root.appendChild(add);
  }

  private optionBlock(detail: EventDetail, option: EventOptionInfo, index: number): HTMLElement {
    const opts = { folded: true, subtitle: option.name?.text ?? option.name?.key ?? "" };
    const block = this.foldable(detail, `opt:${option.line}`, `Option ${index + 1}`, option.line, (body) => {
      this.locRow("Text", option.name, detail.id, body);

      // The gate: when the option is offered at all.
      this.gate(
        detail,
        body,
        "Condition",
        "Shown to the player only while this holds",
        option.trigger,
        "trigger",
        () =>
          this.addRow(
            "Add condition",
            this.vocabulary.triggers,
            "Creates the option's trigger block with this first check",
            (key, value) => this.insertEdit(detail, "trigger", `{ ${key} = ${value} }`, option.bodyLine, 2)
          )
      );

      // The AI's willingness to pick it.
      this.gate(
        detail,
        body,
        "AI chance",
        "How much the AI wants this option",
        option.aiChance,
        "effect",
        () =>
          button(
            "Add AI chance",
            "plus",
            "Insert ai_chance = { base = 100 }; tune the base and add modifiers after",
            () => this.insertEdit(detail, "ai_chance", "{ base = 100 }", option.bodyLine, 2),
            "ghost"
          )
      );

      body.appendChild(this.subhead("Effects", "What happens when the player picks it"));
      this.tree(detail, option.lines, option.totalLines, 2, option.line, "effect", body);
      this.insertedRows(option.bodyLine, body);
      body.appendChild(
        this.addRow(
          "Add effect",
          this.vocabulary.effects,
          "An effect that runs when this option is picked",
          (key, value) => this.insertEdit(detail, key, value, option.bodyLine, 2)
        )
      );
    }, opts);
    block.dataset.line = String(option.line);
    return block;
  }

  /** One gate (Condition / AI chance): its tree when present, its add-button otherwise. */
  private gate(
    detail: EventDetail,
    into: HTMLElement,
    label: string,
    hint: string,
    info: EventGateInfo | undefined,
    context: "trigger" | "effect",
    makeAdd: () => HTMLElement
  ): void {
    if (!info) {
      const row = makeAdd();
      row.classList.add("gateAdd");
      into.appendChild(row);
      return;
    }
    into.appendChild(this.subhead(label, hint));
    this.tree(detail, info.lines, info.totalLines, 3, info.line, context, into);
    this.insertedRows(info.line + 1, into);
    into.appendChild(
      this.addRow(
        context === "trigger" ? "Add condition" : "Add entry",
        context === "trigger" ? this.vocabulary.triggers : this.vocabulary.effects,
        context === "trigger" ? "Another check this option requires" : "Another entry in this block",
        (key, value) => this.insertEdit(detail, key, value, info.line + 1, 3)
      )
    );
  }

  private renderRefs(detail: EventDetail): void {
    if (detail.refs.length === 0) return;
    const block = this.foldable(
      detail,
      "refs",
      `References (${detail.refs.length})`,
      detail.line,
      (body) => body.appendChild(this.refList(detail)),
      { folded: true }
    );
    block
      .querySelector(".btitle")
      ?.setAttribute(
        "data-tip",
        "Every scope, variable, scripted effect and value this event names. Click one to jump to where it is defined."
      );
    this.root.appendChild(block);
  }

  private refList(detail: EventDetail): HTMLElement {
    const list = el("div", "px-list");
    const order = ["saved_scope", "variable", "scripted_effect", "scripted_trigger", "script_value", "event"];
    const labels: Record<string, string> = {
      saved_scope: "scope",
      variable: "variable",
      scripted_effect: "effect",
      scripted_trigger: "trigger",
      script_value: "<SV>",
      event: "event",
    };
    for (const kind of order) {
      for (const ref of detail.refs.filter((r) => r.kind === kind)) {
        const row = el("div", "px-item");
        row.title =
          kind === "script_value"
            ? `Script Value\n${ref.name}: a number computed by script, defined under common/script_values.`
            : ref.name;
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
    return list;
  }

  // --- the script tree ------------------------------------------------------

  /**
   * A rendered block as an editable tree. Scalar assignments become rows with
   * a value control; block openers become collapsible headers with their own
   * "+ inside"; closers vanish; bare scalars (list entries) stay read-only.
   * `baseIndent` is the FILE indent of the block's direct children, so an
   * in-place rewrite or a nested insert lands at the right depth.
   */
  private tree(
    detail: EventDetail,
    lines: EventScriptLine[],
    totalLines: number,
    baseIndent: number,
    blockLine: number,
    context: "trigger" | "effect",
    into: HTMLElement
  ): void {
    if (lines.length === 0 && totalLines === 0) {
      into.appendChild(el("div", "hint", "Empty."));
      return;
    }
    const wrap = el("div", "tree");
    const containers: HTMLElement[] = [wrap];
    const ctx: Array<"trigger" | "effect"> = [context];
    const top = (): HTMLElement => containers[containers.length - 1];

    for (const line of lines) {
      if (line.text === "}") {
        if (containers.length > 1) {
          containers.pop();
          ctx.pop();
        }
        continue;
      }
      const opener = OPENER_LINE.exec(line.text) ?? (line.text === "{" ? ["{", "", "="] : null);
      if (opener) {
        const key = opener[1] === "{" ? "" : opener[1];
        const inner = TRIGGER_BLOCKS.has(key.toLowerCase()) ? "trigger" : ctx[ctx.length - 1];
        const children = el("div", "tchildren");
        const row = this.blockRow(detail, line, key, inner, baseIndent, children);
        top().append(row, children);
        containers.push(children);
        ctx.push(inner);
        continue;
      }
      const scalar = SCALAR_LINE.exec(line.text);
      if (scalar) {
        top().appendChild(
          this.scalarRow(
            detail,
            scalar[1],
            scalar[3],
            line.line,
            baseIndent + line.depth,
            line.depth,
            scalar[2]
          )
        );
        continue;
      }
      // A bare list entry (`traits = { brave ambitious }`): read it, edit it in source.
      const bare = el("div", "trow tbare");
      bare.style.paddingLeft = `${line.depth * 14 + 4}px`;
      bare.appendChild(el("span", "tk px-muted", line.text));
      top().appendChild(bare);
    }
    if (totalLines > lines.length) {
      const more = el(
        "button",
        "px-btn trow-more",
        `+${totalLines - lines.length} more lines — open the source`
      );
      more.dataset.variant = "link";
      more.addEventListener("click", () => this.cb.onOpen(detail.file, blockLine + 1));
      wrap.appendChild(more);
    }
    into.appendChild(wrap);
  }

  /** A collapsible block header inside a tree, with its own "+ inside". */
  private blockRow(
    detail: EventDetail,
    line: EventScriptLine,
    key: string,
    context: "trigger" | "effect",
    baseIndent: number,
    children: HTMLElement
  ): HTMLElement {
    const row = el("div", "trow thead");
    row.style.paddingLeft = `${line.depth * 14 + 4}px`;
    const foldKey = `${detail.id}:${line.line}`;
    const caret = iconEl("chevronDown", "px-icon caret");
    const applyFold = (): void => {
      const folded = this.folded.get(foldKey) ?? false;
      children.hidden = folded;
      caret.classList.toggle("closed", folded);
    };
    caret.addEventListener("click", () => {
      this.folded.set(foldKey, !(this.folded.get(foldKey) ?? false));
      applyFold();
    });
    row.appendChild(caret);
    row.appendChild(el("span", "tk", line.text));
    const tools = el("span", "ttools");
    // The "+" inserts INSIDE this block, at its children's own depth.
    let adder: HTMLElement | null = null;
    tools.appendChild(
      iconButton(
        "plus",
        context === "trigger" ? "Add a condition inside this block" : "Add an entry inside this block",
        () => {
          if (!adder) {
            adder = this.addRowExpanded(
              context === "trigger" ? "condition" : "entry",
              context === "trigger" ? this.vocabulary.triggers : this.vocabulary.effects,
              (k, v) => this.insertEdit(detail, k, v, line.line + 1, baseIndent + line.depth + 1)
            );
            children.prepend(adder);
          } else {
            adder.hidden = !adder.hidden;
          }
          this.folded.set(foldKey, false);
          applyFold();
        },
        "icon-xs"
      )
    );
    tools.appendChild(
      iconButton(
        "cornerDownRight",
        `Open line ${line.line + 1}`,
        () => this.cb.onOpen(detail.file, line.line + 1),
        "icon-xs"
      )
    );
    row.appendChild(tools);
    applyFold();
    return row;
  }

  /**
   * One editable `key op value` row of a tree (or of the Settings list). The
   * value READS as plain tokenized text; clicking it opens the editor — a
   * menu when the values can be enumerated, an inline input otherwise — so
   * a long event never renders as a wall of form controls.
   */
  private scalarRow(
    detail: EventDetail,
    key: string,
    rawValue: string,
    line: number,
    indent: number,
    depth: number,
    op: string
  ): HTMLElement {
    const row = el("div", "trow");
    row.style.paddingLeft = `${depth * 14 + 4}px`;
    row.appendChild(el("span", "tk", key));
    row.appendChild(el("span", "top", op));
    const current = this.view.values.get(fieldRowKey(detail.file, key, line)) ?? rawValue;
    const commit = (value: string): void => {
      if (value === rawValue || value.trim() === "") return;
      this.cb.onEdit(`set ${key}`, {
        kind: "setField",
        id: detail.id,
        file: detail.file,
        key,
        value,
        line,
        insertLine: line,
        indent,
      });
    };
    const holder = el("span", "tv");
    const options = this.vocabulary.values[key];
    const val = el("span", `tval ${tokClass(current)}`, current);
    if (options && options.length > 0) {
      val.dataset.tip = docFor(options, current, key);
      val.dataset.tipWrap = "";
      val.addEventListener("click", () =>
        menu(val, menuItems(options), { value: current, width: 300, onPick: commit })
      );
    } else {
      val.addEventListener("click", () => this.editValue(val, current, key, commit));
    }
    holder.appendChild(val);
    if (current !== rawValue) holder.appendChild(el("span", "pendingMark px-xs", "unsaved"));
    row.appendChild(holder);
    const tools = el("span", "ttools");
    tools.appendChild(
      iconButton(
        "cornerDownRight",
        `Open line ${line + 1}`,
        () => this.cb.onOpen(detail.file, line + 1),
        "icon-xs"
      )
    );
    row.appendChild(tools);
    return row;
  }

  /** Swap a value's text for a focused input; text comes back on blur. */
  private editValue(span: HTMLElement, current: string, key: string, commit: (v: string) => void): void {
    const field = input(current, "value", commit);
    attachSuggest(field, () => this.valueSuggestions(key));
    span.replaceWith(field);
    field.focus();
    field.select();
    // A commit that changes the value re-renders the panel; this restore is
    // for the click-in, click-out case. The delay lets a suggestion click land.
    field.addEventListener("blur", () =>
      setTimeout(() => {
        if (field.isConnected) field.replaceWith(span);
      }, 120)
    );
  }

  // --- rows -----------------------------------------------------------------

  private section(title: string, hint: string): void {
    const head = el("div", "sub", title);
    head.dataset.tip = hint;
    head.dataset.tipWrap = "";
    this.root.appendChild(head);
  }

  private subhead(title: string, hint: string): HTMLElement {
    const head = el("div", "subhead2", title);
    head.dataset.tip = hint;
    head.dataset.tipWrap = "";
    return head;
  }

  /** A collapsible titled block (a section, an option, the settings). */
  private foldable(
    detail: EventDetail,
    key: string,
    title: string,
    line: number,
    fill: (body: HTMLElement) => void,
    opts: { folded?: boolean; subtitle?: string } = {}
  ): HTMLElement {
    const block = el("div", "block");
    const head = el("div", "head");
    const foldKey = `${detail.id}:${key}`;
    const isFolded = (): boolean => this.folded.get(foldKey) ?? opts.folded ?? false;
    const caret = iconEl("chevronDown", "px-icon caret");
    const body = el("div", "bbody");
    const applyFold = (): void => {
      body.hidden = isFolded();
      caret.classList.toggle("closed", isFolded());
    };
    head.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).closest("button")) return;
      this.folded.set(foldKey, !isFolded());
      applyFold();
    });
    head.appendChild(caret);
    head.appendChild(el("span", "btitle", title));
    head.appendChild(el("span", "bsub px-muted px-xs px-truncate", opts.subtitle ?? ""));
    head.appendChild(
      iconButton(
        "cornerDownRight",
        `Open line ${line + 1}`,
        () => this.cb.onOpen(detail.file, line + 1),
        "icon-xs"
      )
    );
    block.append(head, body);
    fill(body);
    applyFold();
    return block;
  }

  /** The pending edit an Add row produces, shared by every insert point. */
  private insertEdit(
    detail: EventDetail,
    key: string,
    value: string,
    insertLine: number,
    indent: number
  ): void {
    this.cb.onEdit(`add ${key}`, {
      kind: "setField",
      id: detail.id,
      file: detail.file,
      key,
      value,
      line: null,
      insertLine,
      indent,
    });
  }

  /** The rows this session added to one body, none of them written yet. */
  private insertedRows(bodyLine: number, into: HTMLElement): void {
    for (const added of this.view.inserted.get(bodyLine) ?? []) {
      const row = el("div", "trow");
      row.appendChild(el("span", "tk", added.key));
      const holder = el("span", "tv");
      holder.append(
        el("span", "px-grow px-truncate", added.value),
        el("span", "pendingMark px-xs", "unsaved")
      );
      row.appendChild(holder);
      into.appendChild(row);
    }
  }

  /**
   * Every "Add …" is ONE muted button until it is wanted: clicking it swaps
   * in the expanded picker row. A panel with ten insert points therefore
   * shows ten quiet words, not ten dropdown-and-input pairs.
   */
  private addRow(
    label: string,
    items: EventVocabularyItem[],
    tip: string,
    onAdd: (key: string, value: string) => void
  ): HTMLElement {
    const row = el("div", "trow tadd");
    const reveal = button(label, "plus", tip, () => {
      row.replaceWith(this.addRowExpanded(label, items, onAdd));
    });
    row.appendChild(reveal);
    return row;
  }

  /**
   * The "pick a key, type its value, insert it" row shared by fields, effects
   * and conditions. The value control follows the key: a key that fires an
   * event gets the mod's own event ids, everything else a free input with
   * inline completions, defaulting to `yes`.
   */
  private addRowExpanded(
    label: string,
    items: EventVocabularyItem[],
    onAdd: (key: string, value: string) => void
  ): HTMLElement {
    const row = el("div", "trow tadd");
    row.appendChild(el("span", "tk px-muted", label));
    const holder = el("span", "tv");
    let key = "";
    const valueBox = el("span");
    valueBox.style.display = "contents";
    let readValue: () => string = () => "yes";
    const setValueControl = (): void => {
      valueBox.replaceChildren();
      const field = input("yes", "value", () => undefined);
      attachSuggest(field, () => this.valueSuggestions(key));
      field.style.maxWidth = "110px";
      valueBox.appendChild(field);
      readValue = () => field.value.trim() || "yes";
      if (key === "trigger_event" && this.eventIds.length > 0) field.value = "";
    };
    const add = iconButton(
      "plus",
      "Add it. Nothing is written until you save",
      () => {
        if (key === "") return;
        const value = readValue();
        if (value === "") return;
        onAdd(key, value);
      },
      "icon-xs"
    );
    const picker = dropdown("", "choose", menuItems(items), "Pick what to add", (picked) => {
      key = picked;
      setValueControl();
    });
    setValueControl();
    holder.append(picker, valueBox, add);
    row.appendChild(holder);
    return row;
  }

  private valueSuggestions(key: string): MenuItem[] {
    const known = this.vocabulary.values[key];
    if (known && known.length > 0) return menuItems(known);
    if (key === "trigger_event") return this.eventIds.map((id) => ({ value: id, label: id }));
    return [
      { value: "yes", label: "yes" },
      { value: "no", label: "no" },
      ...this.vocabulary.savedScopes.slice(0, 6).map((s) => ({ value: `scope:${s}`, label: `scope:${s}` })),
    ];
  }

  /** A localizable string: its key, its current text, and an editable input. */
  private locRow(
    label: string,
    loc: EventLocField | undefined,
    eventId: string,
    into: HTMLElement = this.root
  ): void {
    const row = el("div", "locrow");
    const k = el("div", "k px-muted px-xs", label);
    // The loc key matters when hunting a string in the .yml, not before.
    if (loc?.key) k.dataset.tip = loc.key;
    row.appendChild(k);
    if (!loc) {
      row.appendChild(el("div", "hint", "This event sets no such text."));
    } else if (loc.dynamic) {
      row.appendChild(
        el("div", "hint", "Built by a block (first_valid / triggered_desc). Edit it in the source.")
      );
    } else {
      const current = this.view.values.get(locRowKey(loc.key)) ?? loc.text ?? "";
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
}

/** The loc keys a set of localizable fields names, for de-duplicating rows. */
function locKeys(fields: Array<EventLocField | undefined>): Set<string> {
  const keys = new Set<string>();
  for (const field of fields) if (field?.key) keys.add(field.key);
  return keys;
}

function cap(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The syntax color a value would get in the read-only script view. */
function tokClass(value: string): string {
  if (/^-?[\d.]+$/.test(value)) return "tok-number";
  if (value === "yes" || value === "no") return "tok-bool";
  return "tok-string";
}

function menuItems(items: EventVocabularyItem[]): MenuItem[] {
  return items.map((item) => ({
    value: item.value,
    label: item.value,
    description: item.doc,
    // "none" is the engine's way of saying "no scopes": pure noise in a list.
    hint: item.hint && item.hint.toLowerCase() !== "none" ? item.hint : undefined,
  }));
}

/** The tooltip on a value dropdown: what the current value means. */
function docFor(items: EventVocabularyItem[], current: string, key: string): string {
  const hit = items.find((i) => i.value === current);
  return hit?.doc ? `${current}: ${hit.doc}` : `Pick a value for ${key}`;
}
