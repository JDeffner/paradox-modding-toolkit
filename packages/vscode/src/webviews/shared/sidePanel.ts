/**
 * A resizable, collapsible side panel (the markup is documented in ui.css).
 * The owner passes how to remember the width and the collapsed state, since
 * where that lives (workspaceState through the host, localStorage, nothing)
 * is the owner's call. Browser code.
 */
export interface SidePanelOptions {
  min?: number;
  max?: number;
  /** Initial state, normally what the owner remembered last time. */
  width?: number;
  collapsed?: boolean;
  onChange?: (state: { width: number; collapsed: boolean }) => void;
}

export interface SidePanel {
  readonly element: HTMLElement;
  readonly collapsed: boolean;
  toggle(collapsed?: boolean): void;
  /** Set the width without a drag (the owner's remembered value arriving late). */
  setWidth(width: number): void;
}

const DEFAULT_WIDTH = 340;

export function sidePanel(element: HTMLElement, options: SidePanelOptions = {}): SidePanel {
  const min = options.min ?? 220;
  const max = options.max ?? 640;
  const side = element.dataset.side === "left" ? "left" : "right";
  const resizer = element.querySelector<HTMLElement>(".px-sidepanel-resizer");
  const clamp = (w: number): number => Math.max(min, Math.min(max, Math.round(w)));
  let width = clamp(options.width ?? DEFAULT_WIDTH);
  let collapsed = options.collapsed ?? false;

  function apply(): void {
    element.style.setProperty("--px-sidepanel-width", `${width}px`);
    if (collapsed) element.setAttribute("data-collapsed", "");
    else element.removeAttribute("data-collapsed");
  }
  const emit = (): void => options.onChange?.({ width, collapsed });

  resizer?.addEventListener("pointerdown", (down) => {
    if (collapsed) return;
    down.preventDefault();
    resizer.setPointerCapture(down.pointerId);
    const startX = down.clientX;
    const startWidth = width;
    element.setAttribute("data-dragging", "");
    const move = (ev: PointerEvent): void => {
      const delta = side === "right" ? startX - ev.clientX : ev.clientX - startX;
      width = clamp(startWidth + delta);
      apply();
    };
    const up = (): void => {
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", up);
      resizer.removeEventListener("pointercancel", up);
      element.removeAttribute("data-dragging");
      emit();
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", up);
    resizer.addEventListener("pointercancel", up);
  });
  // Double-click the handle: back to the default width.
  resizer?.addEventListener("dblclick", () => {
    width = clamp(DEFAULT_WIDTH);
    apply();
    emit();
  });

  apply();
  return {
    element,
    get collapsed() {
      return collapsed;
    },
    toggle(next = !collapsed) {
      collapsed = next;
      apply();
      emit();
    },
    setWidth(w) {
      width = clamp(w);
      apply();
    },
  };
}
