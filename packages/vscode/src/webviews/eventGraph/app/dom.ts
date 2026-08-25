/**
 * The handful of element builders the graph's three views share. Nothing here
 * knows about the graph: it is px-ui markup with a friendlier call shape.
 */
import { iconEl, type IconName } from "../../shared/icons";
import { menu, type MenuItem } from "../../shared/overlay";

export function el(tag: string, cls = "", text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(
  label: string,
  name: IconName | null,
  tip: string,
  onClick: () => void,
  variant: "ghost" | "outline" | "default" | "link" = "ghost"
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "px-btn";
  b.dataset.variant = variant;
  b.dataset.size = "sm";
  b.dataset.tip = tip;
  b.dataset.tipWrap = "";
  if (name) b.appendChild(iconEl(name));
  if (label) b.append(label);
  b.onclick = onClick;
  return b;
}

export function iconButton(
  name: IconName,
  tip: string,
  onClick: (ev: MouseEvent) => void,
  size: "icon-sm" | "icon-xs" = "icon-sm"
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "px-btn";
  b.dataset.variant = "ghost";
  b.dataset.size = size;
  b.dataset.tip = tip;
  b.appendChild(iconEl(name));
  b.onclick = onClick;
  return b;
}

/**
 * The px-dropdown trigger: value on the left, chevron on the right, `menu()`
 * on click. Past eight entries menu() adds its own filter box, which is what
 * makes a 600-effect list usable.
 */
export function dropdown(
  value: string,
  placeholder: string,
  items: MenuItem[],
  tip: string,
  onPick: (value: string) => void
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "px-btn px-dropdown";
  b.dataset.variant = "outline";
  b.dataset.size = "sm";
  b.dataset.tip = tip;
  b.dataset.tipWrap = "";
  const label = el("span", "px-truncate", value || placeholder);
  if (!value) label.classList.add("px-muted");
  b.append(label, iconEl("chevronDown"));
  b.onclick = () =>
    menu(b, items, {
      value,
      width: 300,
      onPick: (picked) => {
        label.textContent = picked;
        label.classList.remove("px-muted");
        onPick(picked);
      },
    });
  return b;
}

export function input(
  value: string,
  placeholder: string,
  onCommit: (value: string) => void
): HTMLInputElement {
  const field = document.createElement("input");
  field.className = "px-input";
  field.dataset.size = "sm";
  field.type = "text";
  field.spellcheck = false;
  field.value = value;
  field.placeholder = placeholder;
  // Committed values, not keystrokes: one undo step per edit, as px-ui asks.
  field.addEventListener("change", () => onCommit(field.value));
  field.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") field.blur();
  });
  return field;
}

export function badge(
  text: string,
  variant: "secondary" | "outline" | "destructive" = "secondary"
): HTMLElement {
  const b = el("span", "px-badge", text);
  b.dataset.variant = variant;
  return b;
}

/**
 * Inline autocomplete on a plain input: a list under the field that filters
 * as you type, arrows + Enter pick, Escape or blur dismisses. The completion
 * story `menu()` cannot tell, because its filter box would steal the focus
 * from the field being typed in.
 */
export function attachSuggest(field: HTMLInputElement, provide: () => MenuItem[]): void {
  let list: HTMLElement | null = null;
  let rows: HTMLElement[] = [];
  let items: MenuItem[] = [];
  let active = -1;

  const close = (): void => {
    list?.remove();
    list = null;
    rows = [];
    active = -1;
  };
  const pick = (value: string): void => {
    field.value = value;
    close();
    field.dispatchEvent(new Event("change"));
  };
  const mark = (index: number): void => {
    rows[active]?.removeAttribute("data-active");
    active = index;
    const row = rows[active];
    if (row) {
      row.setAttribute("data-active", "");
      row.scrollIntoView({ block: "nearest" });
    }
  };
  const update = (): void => {
    const q = field.value.trim().toLowerCase();
    items = provide()
      .filter((i) => !q || i.value.toLowerCase().includes(q))
      .slice(0, 8);
    if (items.length === 0 || (items.length === 1 && items[0].value === field.value)) {
      close();
      return;
    }
    if (!list) {
      list = el("div", "px-menu px-suggest");
      document.body.appendChild(list);
    }
    const r = field.getBoundingClientRect();
    list.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 308))}px`;
    list.style.top = `${r.bottom + 4}px`;
    rows = items.map((item, i) => {
      const row = el("div", "px-menu-item");
      const label = el("span", "px-grow", item.value);
      if (item.description) label.appendChild(el("span", "px-menu-description", item.description));
      if (item.description) row.setAttribute("data-two-line", "");
      row.appendChild(label);
      row.addEventListener("pointerdown", (ev) => ev.preventDefault());
      row.addEventListener("click", () => pick(item.value));
      row.addEventListener("pointerenter", () => mark(i));
      return row;
    });
    list.replaceChildren(...rows);
    active = -1;
  };

  field.addEventListener("input", update);
  field.addEventListener("focus", update);
  // After the click on a row has had its chance (pointerdown prevents blur-close races).
  field.addEventListener("blur", () => setTimeout(close, 100));
  field.addEventListener("keydown", (ev) => {
    if (!list) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      mark(Math.min(rows.length - 1, active + 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      mark(Math.max(0, active - 1));
    } else if (ev.key === "Enter" && active >= 0) {
      ev.preventDefault();
      pick(items[active].value);
    } else if (ev.key === "Escape") {
      ev.stopPropagation();
      close();
    }
  });
}
