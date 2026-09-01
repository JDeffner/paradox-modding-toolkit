/**
 * The ? button's tutorial, shared by every webview (event graph, GUI editor,
 * flag builder, Project panel, wiki hub, Examples Wiki, Workshop) so each view
 * teaches itself the same way: one modal, scannable sections, a bold lead-in
 * per row, kbd chips for the keys. It carries the depth the tooltips dropped:
 * a tip names a control in one line, the dialog explains the view.
 *
 * Content is data, not markup: a view declares what it wants said (HelpSpec)
 * and this renders it, so the tutorials cannot drift apart in look and a
 * section reads the same in every view. Browser code, styled by ui.css
 * (`.px-help*`), closed by its button, Escape, the X or the backdrop.
 */
import { icon } from "./icons";

export interface HelpItem {
  /** Bold lead-in naming the action ("Move a card"). */
  lead?: string;
  /** The explanation that follows it, plain prose. */
  text: string;
  /** Keys rendered as chips after the text, joined with +. */
  keys?: string[];
}

export interface HelpSection {
  title: string;
  /** One or two framing sentences under the title. */
  intro?: string;
  items?: HelpItem[];
  /** A compact keys -> action table; `keys` chips are joined with +. */
  shortcuts?: { keys: string[]; does: string }[];
}

export interface HelpSpec {
  title: string;
  /** What this view IS, in a sentence or two: the first thing a new user reads. */
  intro: string;
  sections: HelpSection[];
}

/**
 * The dialog itself, as ONE self-contained factory: it takes the close icon as
 * markup and gives back the opener. Self-contained on purpose, exactly like
 * `installTips`: `helpScript()` serializes it for the webviews that inline
 * their script (the Project panel), so the logic below is the only copy.
 */
function helpRuntime(closeIcon: string): (spec: HelpSpec) => void {
  function el(tag: string, cls?: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** "Ctrl", "Z" -> chips with a small + between them. */
  function keyChips(keys: readonly string[]): HTMLElement {
    const holder = el("span", "keys");
    keys.forEach((key, i) => {
      if (i > 0) holder.appendChild(el("span", "plus", "+"));
      holder.appendChild(el("kbd", "px-kbd", key));
    });
    return holder;
  }

  return function open(spec: HelpSpec): void {
    const existing = document.querySelector(".px-help-backdrop");
    if (existing) existing.remove();

    const backdrop = el("div", "px-dialog-backdrop px-help-backdrop");
    const dialog = el("div", "px-dialog px-help");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", spec.title);

    const head = el("div", "px-help-head");
    const heading = el("div", "px-grow");
    heading.appendChild(el("div", "px-help-title", spec.title));
    heading.appendChild(el("div", "px-help-intro", spec.intro));
    head.appendChild(heading);
    const close = el("button", "px-btn") as HTMLButtonElement;
    close.dataset.variant = "ghost";
    close.dataset.size = "icon-sm";
    close.setAttribute("aria-label", "Close");
    // The icon arrives as markup so this stays free of imports; it is a
    // compile-time constant from icons.ts, never user text.
    const holder = el("template") as HTMLTemplateElement;
    holder.innerHTML = closeIcon;
    const glyph = holder.content.firstElementChild;
    if (glyph) close.appendChild(glyph);
    head.appendChild(close);
    dialog.appendChild(head);

    const body = el("div", "px-help-body");
    for (const section of spec.sections) {
      const box = el("div", "px-help-section");
      box.appendChild(el("div", "px-help-section-title", section.title));
      if (section.intro) box.appendChild(el("div", "px-help-prose", section.intro));
      for (const item of section.items ?? []) {
        const row = el("div", "px-help-item");
        if (item.lead) row.appendChild(el("span", "lead", item.lead + " "));
        row.appendChild(document.createTextNode(item.text));
        if (item.keys && item.keys.length > 0) {
          row.appendChild(document.createTextNode(" "));
          row.appendChild(keyChips(item.keys));
        }
        box.appendChild(row);
      }
      if (section.shortcuts && section.shortcuts.length > 0) {
        const table = el("div", "px-help-keysGrid");
        for (const row of section.shortcuts) {
          table.appendChild(keyChips(row.keys));
          table.appendChild(el("span", "does", row.does));
        }
        box.appendChild(table);
      }
      body.appendChild(box);
    }
    dialog.appendChild(body);

    const foot = el("div", "px-help-foot");
    const ok = el("button", "px-btn") as HTMLButtonElement;
    ok.dataset.variant = "default";
    ok.textContent = "Got it";
    foot.appendChild(ok);
    dialog.appendChild(foot);

    backdrop.appendChild(dialog);
    const done = (): void => {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== "Escape") return;
      // Capture + stop, so the view behind does not also clear its selection.
      ev.stopPropagation();
      done();
    };
    close.onclick = done;
    ok.onclick = done;
    backdrop.onclick = (ev) => {
      if (ev.target === backdrop) done();
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(backdrop);
    ok.focus();
  };
}

let opener: ((spec: HelpSpec) => void) | undefined;

/** Open the tutorial. One at a time; a second call replaces the first. */
export function helpDialog(spec: HelpSpec): void {
  opener ??= helpRuntime(icon("x"));
  opener(spec);
}

/**
 * The dialog as a script tag, for webviews that inline their script instead of
 * bundling one (the Project panel). It puts one opener on `window`, so the page
 * calls `pxHelpDialog(spec)` with exactly the HelpSpec shape above.
 */
export function helpScript(nonce: string): string {
  return `<script nonce="${nonce}">window.pxHelpDialog = (${helpRuntime.toString()})(${JSON.stringify(
    icon("x")
  )});</script>`;
}
