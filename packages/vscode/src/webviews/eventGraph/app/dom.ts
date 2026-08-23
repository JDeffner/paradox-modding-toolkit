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
