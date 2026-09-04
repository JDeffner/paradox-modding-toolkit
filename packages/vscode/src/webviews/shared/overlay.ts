/**
 * Popover and toast: the two transient surfaces the webviews need. Browser
 * code, styled by ui.css (`.px-popover`, `.px-toaster`, `.px-toast`).
 */

let openPopover: (() => void) | null = null;
let openAnchor: HTMLElement | null = null;

/** Close the open popover, if any. */
export function closePopover(): void {
  openPopover?.();
}

/** True when `anchor` currently owns the open popover (so a click on it should close, not reopen). */
export function isPopoverAnchor(anchor: HTMLElement): boolean {
  return openPopover !== null && openAnchor === anchor;
}

/**
 * Show `content` anchored below `anchor` (above when there is no room).
 * Closes on outside click, Escape, or the returned function. One at a time.
 */
export function popover(anchor: HTMLElement, content: HTMLElement, onClose?: () => void): () => void {
  openPopover?.();
  const el = document.createElement("div");
  el.className = "px-popover";
  el.setAttribute("role", "dialog");
  el.append(content);
  document.body.append(el);
  anchor.setAttribute("aria-expanded", "true");

  const a = anchor.getBoundingClientRect();
  const gap = 6;
  const edge = 8;
  // The popover takes the side with more room and never runs off the screen:
  // a menu opened near the bottom of a tall form used to reach past the
  // viewport with its last rows unreachable. The room it has is handed to its
  // scrolling body (`--px-popover-max`, read by .px-menu-list and
  // .px-picker-results), so the LIST shrinks and scrolls, not the page.
  const below = window.innerHeight - a.bottom - gap - edge;
  const above = a.top - gap - edge;
  let r = el.getBoundingClientRect();
  const flip = r.height > below && above > below;
  const room = Math.floor(Math.max(60, flip ? above : below));
  el.style.setProperty("--px-popover-max", `${room}px`);
  el.style.maxHeight = `${room}px`;
  r = el.getBoundingClientRect();
  let top = a.bottom + gap;
  let origin = "top";
  if (flip) {
    top = a.top - gap - r.height;
    origin = "bottom";
  }
  // A popover that would overflow the right edge RIGHT-ALIGNS to its anchor
  // instead of being clamped to the viewport: it stays visually attached to
  // the control that opened it rather than hugging the screen edge.
  let left = a.left;
  if (left + r.width > window.innerWidth - edge) left = a.right - r.width;
  left = Math.max(edge, Math.min(left, window.innerWidth - edge - r.width));
  el.style.top = `${Math.max(edge, top)}px`;
  el.style.left = `${left}px`;
  el.style.setProperty("--px-origin", `${origin} left`);

  const close = (): void => {
    if (openPopover !== close) return;
    openPopover = null;
    openAnchor = null;
    window.removeEventListener("resize", close);
    document.removeEventListener("pointerdown", onPointer, true);
    document.removeEventListener("keydown", onKey, true);
    anchor.removeAttribute("aria-expanded");
    el.remove();
    onClose?.();
  };
  const onPointer = (ev: PointerEvent): void => {
    const t = ev.target as Node;
    if (!el.contains(t) && !anchor.contains(t)) close();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      close();
    }
  };
  // Deferred so the click that opened it does not close it. A resize moves
  // the anchor out from under the popover: close rather than float loose.
  setTimeout(() => {
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close, { once: true });
  }, 0);
  openPopover = close;
  openAnchor = anchor;
  return close;
}

let toaster: HTMLElement | null = null;

export function toast(message: string, variant: "default" | "destructive" = "default", ms = 2600): void {
  if (!toaster) {
    toaster = document.createElement("div");
    toaster.className = "px-toaster";
    document.body.append(toaster);
  }
  const el = document.createElement("div");
  el.className = "px-toast";
  el.dataset.variant = variant;
  el.textContent = message;
  toaster.append(el);
  setTimeout(() => {
    el.setAttribute("data-leaving", "");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, ms);
}

// ---------------------------------------------------------------------------
// Menu (the <select> replacement) and confirm dialog
// ---------------------------------------------------------------------------

export interface MenuItem {
  value: string;
  label: string;
  /** Dimmer text on the right (a source, a count). */
  hint?: string;
  /** CSS color for a swatch on the left. */
  swatch?: string;
  /** A picture for the entry (a decoded game icon), drawn left of the label. */
  image?: string;
  /** A second, dimmer line under the label (a full path, an explanation). */
  description?: string;
}

export interface MenuOptions {
  value?: string;
  /** Show a filter box; on by default past 8 items. */
  search?: boolean;
  /** Minimum width; defaults to the anchor's width. */
  width?: number;
  onPick: (value: string) => void;
}

const CHECK =
  '<svg class="px-icon check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/** Open a list of items under `anchor`; arrows, Enter, Escape and typing work. */
export function menu(anchor: HTMLElement, items: MenuItem[], options: MenuOptions): void {
  // The trigger toggles: a second click closes what the first opened.
  if (isPopoverAnchor(anchor)) {
    closePopover();
    return;
  }
  const root = document.createElement("div");
  root.className = "px-menu";
  root.style.width = `${Math.max(options.width ?? 0, anchor.getBoundingClientRect().width)}px`;
  const search = options.search ?? items.length > 8;
  let input: HTMLInputElement | null = null;
  if (search) {
    input = document.createElement("input");
    input.className = "px-input";
    input.dataset.size = "sm";
    input.placeholder = "Filter…";
    input.spellcheck = false;
    root.append(input);
  }
  const list = document.createElement("div");
  list.className = "px-menu-list";
  list.setAttribute("role", "listbox");
  root.append(list);

  let rows: HTMLElement[] = [];
  let active = -1;
  const setActive = (i: number): void => {
    rows[active]?.removeAttribute("data-active");
    active = Math.max(0, Math.min(rows.length - 1, i));
    const row = rows[active];
    if (row) {
      row.setAttribute("data-active", "");
      row.scrollIntoView({ block: "nearest" });
    }
  };
  const pick = (value: string): void => {
    close();
    options.onPick(value);
  };
  const fill = (): void => {
    const q = (input?.value ?? "").trim().toLowerCase();
    list.replaceChildren();
    rows = [];
    for (const item of items) {
      if (q && !item.label.toLowerCase().includes(q) && !item.hint?.toLowerCase().includes(q)) continue;
      const row = document.createElement("div");
      row.className = "px-menu-item";
      row.setAttribute("role", "option");
      if (item.value === options.value) row.setAttribute("aria-selected", "true");
      row.innerHTML = CHECK;
      if (item.swatch) {
        const sw = document.createElement("span");
        sw.className = "px-swatch";
        sw.style.setProperty("--px-swatch", item.swatch);
        row.append(sw);
      }
      if (item.image) {
        const img = document.createElement("img");
        img.className = "px-chip-thumb";
        img.src = item.image;
        img.alt = "";
        img.loading = "lazy";
        row.append(img);
      }
      const label = document.createElement("span");
      label.className = "px-grow";
      label.textContent = item.label;
      if (item.description) {
        const d = document.createElement("span");
        d.className = "px-menu-description";
        d.textContent = item.description;
        label.append(d);
        row.setAttribute("data-two-line", "");
      }
      row.append(label);
      if (item.hint) {
        const hint = document.createElement("span");
        hint.className = "px-menu-hint";
        hint.textContent = item.hint;
        row.append(hint);
      }
      row.onpointerdown = (e) => e.preventDefault();
      row.onclick = () => pick(item.value);
      list.append(row);
      rows.push(row);
    }
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "px-menu-empty";
      empty.textContent = "No match";
      list.append(empty);
    }
    const current = rows.findIndex((r) => r.getAttribute("aria-selected") === "true");
    active = -1;
    setActive(current >= 0 ? current : 0);
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "ArrowDown") setActive(active + 1);
    else if (ev.key === "ArrowUp") setActive(active - 1);
    else if (ev.key === "Enter") {
      const row = rows[active];
      if (row) row.click();
    } else if (ev.key === "Home") setActive(0);
    else if (ev.key === "End") setActive(rows.length - 1);
    else return;
    ev.preventDefault();
  };
  root.addEventListener("keydown", onKey);
  if (input) input.oninput = fill;
  fill();
  const close = popover(anchor, root, () => document.removeEventListener("keydown", onKeyOutside, true));
  // Without a search box the list itself takes the keys.
  const onKeyOutside = (ev: KeyboardEvent): void => {
    if (!root.contains(ev.target as Node)) onKey(ev);
  };
  document.addEventListener("keydown", onKeyOutside, true);
  if (input) input.focus();
}

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Bullet lines under the description (what exactly will happen). */
  details?: string[];
  /** Arbitrary content between the text and the actions (checkboxes, previews). */
  content?: HTMLElement;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Wider dialog for content-carrying modals. */
  wide?: boolean;
}

/** A modal yes/no; resolves true on confirm. (window.confirm is unavailable in a webview.) */
export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "px-dialog-backdrop";
    const dialog = document.createElement("div");
    dialog.className = "px-dialog";
    dialog.setAttribute("role", "alertdialog");
    const title = document.createElement("div");
    title.className = "px-dialog-title";
    title.textContent = o.title;
    dialog.append(title);
    if (o.wide) dialog.style.maxWidth = "460px";
    if (o.description) {
      const d = document.createElement("div");
      d.className = "px-dialog-description";
      d.textContent = o.description;
      dialog.append(d);
    }
    if (o.details?.length) {
      const ul = document.createElement("ul");
      ul.className = "px-dialog-description";
      ul.style.margin = "0";
      ul.style.paddingLeft = "18px";
      for (const line of o.details) {
        const li = document.createElement("li");
        li.textContent = line;
        li.style.marginTop = "2px";
        ul.append(li);
      }
      dialog.append(ul);
    }
    if (o.content) dialog.append(o.content);
    const actions = document.createElement("div");
    actions.className = "px-dialog-actions";
    const cancel = document.createElement("button");
    cancel.className = "px-btn";
    cancel.dataset.variant = "outline";
    cancel.textContent = o.cancelLabel ?? "Cancel";
    const ok = document.createElement("button");
    ok.className = "px-btn";
    ok.dataset.variant = o.destructive ? "destructive" : "default";
    ok.textContent = o.confirmLabel ?? "Continue";
    actions.append(cancel, ok);
    dialog.append(actions);
    backdrop.append(dialog);
    const done = (value: boolean): void => {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") done(false);
      else if (ev.key === "Enter") done(true);
      else return;
      ev.stopPropagation();
    };
    cancel.onclick = () => done(false);
    ok.onclick = () => done(true);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) done(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.body.append(backdrop);
    ok.focus();
  });
}

// The ? button's tutorial dialog moved to help.ts (helpDialog): structured
// sections with lead-ins and key chips replaced the plain titled paragraphs.
