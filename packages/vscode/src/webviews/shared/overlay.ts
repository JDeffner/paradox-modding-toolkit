/**
 * Popover and toast: the two transient surfaces the webviews need. Browser
 * code, styled by ui.css (`.px-popover`, `.px-toaster`, `.px-toast`).
 */

let openPopover: (() => void) | null = null;

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
  const r = el.getBoundingClientRect();
  const gap = 6;
  let top = a.bottom + gap;
  let origin = "top";
  if (top + r.height > window.innerHeight - 8 && a.top - gap - r.height > 8) {
    top = a.top - gap - r.height;
    origin = "bottom";
  }
  let left = a.left;
  if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - r.width);
  el.style.top = `${Math.max(8, top)}px`;
  el.style.left = `${left}px`;
  el.style.setProperty("--px-origin", `${origin} left`);

  const close = (): void => {
    if (openPopover !== close) return;
    openPopover = null;
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
  // Deferred so the click that opened it does not close it.
  setTimeout(() => {
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  openPopover = close;
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
