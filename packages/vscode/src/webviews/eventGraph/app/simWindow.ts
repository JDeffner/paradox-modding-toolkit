/**
 * The simulation window: "what happens when this event fires", floating over
 * the graph instead of in a tab of its own, so the chain stays on screen while
 * you read one link of it.
 *
 * The ordering is `simulationSteps` from the event simulator, imported as a
 * normal module, so both views walk an event the same way. The differences here
 * are the ones that were wrong before: the chevron folds the section (it used
 * to be decoration), jumping to the source is its own small button on the
 * header, and the script is colored with the shared tokenizer.
 */
import type { EventDetail, EventStepTarget } from "@px-lsp/protocol/protocol";
import { simulationSteps, type SimStep } from "../../eventSim/steps";
import { tokenizeScriptLine } from "../tokenize";
import { iconEl } from "../../shared/icons";
import { badge, el, iconButton } from "./dom";

export interface SimCallbacks {
  onOpen(file: string, line?: number): void;
  /** Ask the host for an event's detail (the window shows it when it arrives). */
  onNeedDetail(id: string): void;
  onMoved(x: number, y: number): void;
  onClosed(): void;
}

export class SimWindow {
  private readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  /** Events stepped through to get here, oldest first. */
  private stack: string[] = [];
  private current: string | null = null;

  constructor(
    root: HTMLElement,
    private readonly cb: SimCallbacks
  ) {
    this.root = root;
    this.bar = root.querySelector<HTMLElement>("#simBar")!;
    this.title = root.querySelector<HTMLElement>("#simTitle")!;
    this.body = root.querySelector<HTMLElement>("#simBody")!;
    this.backBtn = root.querySelector<HTMLButtonElement>("#simBack")!;
    this.backBtn.onclick = () => this.back();
    root.querySelector<HTMLButtonElement>("#simClose")!.onclick = () => this.close();
    this.installDrag();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Open on `id` from a fresh stack. */
  open(id: string): void {
    this.stack = [];
    this.load(id);
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
    this.current = null;
    this.cb.onClosed();
  }

  setPosition(x: number, y: number): void {
    const parent = this.root.parentElement;
    const bounds = parent?.getBoundingClientRect();
    const maxX = Math.max(8, (bounds?.width ?? 0) - this.root.offsetWidth - 8);
    const maxY = Math.max(8, (bounds?.height ?? 0) - 40);
    this.root.style.left = `${Math.min(Math.max(8, x), maxX)}px`;
    this.root.style.top = `${Math.min(Math.max(8, y), maxY)}px`;
  }

  private load(id: string): void {
    this.current = id;
    this.title.textContent = `Simulate ${id}`;
    this.backBtn.disabled = this.stack.length === 0;
    this.backBtn.dataset.tip =
      this.stack.length > 0 ? `Back to ${this.stack[this.stack.length - 1]}` : "Back";
    this.body.replaceChildren(el("div", "note", `Loading ${id}…`));
    this.cb.onNeedDetail(id);
  }

  private back(): void {
    const previous = this.stack.pop();
    if (previous === undefined) return;
    this.load(previous);
  }

  private step(id: string): void {
    if (this.current !== null) this.stack.push(this.current);
    this.load(id);
  }

  /** The host answered. Ignores a stale answer for an event we left. */
  show(detail: EventDetail | null, id: string): void {
    if (id !== this.current) return;
    this.body.replaceChildren();
    if (!detail) {
      this.body.appendChild(el("h3", "", id));
      this.body.appendChild(
        el(
          "div",
          "note",
          "No indexed event with this id, or its block could not be parsed. Nothing to walk through."
        )
      );
      return;
    }
    this.body.appendChild(el("h3", "", detail.id));
    const subtitle = locText(detail.title);
    if (subtitle) this.body.appendChild(el("div", "dim", subtitle));

    const chips = el("div", "badges");
    chips.style.margin = "6px 0";
    if (detail.type) chips.appendChild(badge(detail.type));
    if (detail.theme) chips.appendChild(badge(`theme: ${detail.theme}`));
    if (detail.hidden) chips.appendChild(badge("hidden"));
    chips.appendChild(
      iconButton(
        "fileText",
        "Open the event's source",
        () => this.cb.onOpen(detail.file, detail.line + 1),
        "icon-xs"
      )
    );
    this.body.appendChild(chips);

    for (const step of simulationSteps(detail)) this.body.appendChild(this.renderStep(detail, step));
  }

  private renderStep(detail: EventDetail, step: SimStep): HTMLElement {
    const card = el("div", `step ${step.kind}`);
    const head = el("div", "px-panel-title");
    // The chevron folds the section. It used to look like it did and did not.
    const fold = iconButton(
      "chevronDown",
      "Fold this section",
      () => {
        card.toggleAttribute("data-collapsed");
        fold.dataset.tip = card.hasAttribute("data-collapsed") ? "Unfold this section" : "Fold this section";
      },
      "icon-xs"
    );
    fold.classList.add("caret");
    fold.replaceChildren(iconEl("chevronDown"));
    head.appendChild(fold);
    head.appendChild(el("span", "t", step.title));
    head.appendChild(el("span", "s", step.subtitle));
    head.appendChild(
      iconButton(
        "cornerDownRight",
        `Open ${detail.file} at line ${step.line + 1}`,
        () => this.cb.onOpen(detail.file, step.line),
        "icon-xs"
      )
    );
    card.appendChild(head);

    const body = el("div", "step-body");
    card.appendChild(body);
    if (step.note) body.appendChild(el("div", "note", step.note));
    if (step.lines.length > 0) {
      const script = el("div", "script");
      for (const line of step.lines) {
        const row = el("div", "ln");
        row.title = `Open line ${line.line + 1}`;
        for (const token of tokenizeScriptLine("  ".repeat(line.depth) + line.text)) {
          row.appendChild(el("span", `tok-${token.kind}`, token.text));
        }
        row.addEventListener("click", () => this.cb.onOpen(detail.file, line.line));
        script.appendChild(row);
      }
      body.appendChild(script);
    }
    if (step.hidden > 0) {
      body.appendChild(el("div", "more", `… ${step.hidden} more lines (open the source to read them)`));
    }
    if (step.targets.length > 0) {
      const leads = el("div", "leads");
      const label = el("div", "px-label", "Leads to");
      label.style.padding = "0 6px";
      leads.appendChild(label);
      for (const target of step.targets) this.renderTarget(leads, target, false);
      if (step.hiddenTargets > 0) {
        leads.appendChild(el("div", "target dim", `… ${step.hiddenTargets} more`));
      }
      body.appendChild(leads);
    }
    return card;
  }

  private renderTarget(container: HTMLElement, target: EventStepTarget, nested: boolean): void {
    const row = el("div", nested ? "target fires" : "target");
    row.appendChild(el("span", "via", target.via));
    if (target.kind === "event") {
      const link = el("button", "px-btn", target.name);
      link.dataset.variant = "link";
      link.prepend(iconEl("cornerDownRight"));
      link.dataset.tip = `Step into ${target.name} (Ctrl/Cmd+click opens its source)`;
      link.addEventListener("click", (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && target.file) {
          this.cb.onOpen(target.file, target.defLine);
          return;
        }
        this.step(target.name);
      });
      row.appendChild(link);
    } else if (target.kind === "on_action") {
      if (target.file) {
        const link = el("button", "px-btn", target.name);
        link.dataset.variant = "link";
        link.dataset.tip = "Open this on_action's definition";
        link.addEventListener("click", () => this.cb.onOpen(target.file!, target.defLine));
        row.appendChild(link);
      } else {
        row.appendChild(el("span", "", target.name));
      }
      // A mod extending a vanilla on_action has several definition sites, and
      // `fires` reads only the one the server resolved.
      if ((target.defCount ?? 1) > 1) {
        row.appendChild(el("span", "dim", `(1 of ${target.defCount} definition sites)`));
      }
      if (nested) {
        row.appendChild(el("span", "dim", "(chained on_action, open it to see what it fires)"));
      } else if (target.fires === undefined) {
        row.appendChild(el("span", "dim", "(on_action definition not readable)"));
      } else if (target.fires.length === 0) {
        row.appendChild(el("span", "dim", "(its definition names no events)"));
      }
    } else {
      row.appendChild(el("span", "", target.name));
      row.appendChild(el("span", "dim", "(not indexed, nothing to step into)"));
    }
    container.appendChild(row);

    for (const fired of target.fires ?? []) this.renderTarget(container, fired, true);
    const hiddenFires = (target.firesTotal ?? 0) - (target.fires?.length ?? 0);
    if (hiddenFires > 0) container.appendChild(el("div", "target fires dim", `… ${hiddenFires} more`));
  }

  /**
   * Drag by the title bar only, and report where it landed so the host can
   * remember it. Pointer capture, because a release outside the webview never
   * delivers a window pointerup.
   */
  private installDrag(): void {
    let from: { x: number; y: number; left: number; top: number } | null = null;
    this.bar.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 || (ev.target as HTMLElement).closest("button")) return;
      ev.preventDefault();
      this.bar.setPointerCapture(ev.pointerId);
      this.bar.classList.add("dragging");
      from = { x: ev.clientX, y: ev.clientY, left: this.root.offsetLeft, top: this.root.offsetTop };
    });
    this.bar.addEventListener("pointermove", (ev) => {
      if (!from) return;
      this.setPosition(from.left + (ev.clientX - from.x), from.top + (ev.clientY - from.y));
    });
    const end = (ev: PointerEvent): void => {
      if (!from) return;
      from = null;
      this.bar.classList.remove("dragging");
      if (this.bar.hasPointerCapture(ev.pointerId)) this.bar.releasePointerCapture(ev.pointerId);
      this.cb.onMoved(this.root.offsetLeft, this.root.offsetTop);
    };
    this.bar.addEventListener("pointerup", end);
    this.bar.addEventListener("pointercancel", end);
  }
}

function locText(field: EventDetail["title"]): string {
  if (!field) return "";
  if (field.text) return field.text;
  if (field.dynamic) return "(dynamic title, resolved in game)";
  if (field.key) return `${field.key} (no localization)`;
  return "";
}
