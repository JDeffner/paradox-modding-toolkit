/**
 * Pointer-driven reordering for a vertical list of `.px-item` rows.
 *
 * Press and drag a row: a copy of it follows the pointer, the row itself
 * stays in the list as a ghost and moves to where it would land, and the
 * other rows slide out of the way (FLIP: measure, move in the DOM, animate
 * from the old position). Release: `onReorder(from, to)`. No HTML5 drag
 * and drop, so the look is ours and it works the same in every webview.
 */
export interface SortableOptions {
  /** Rows that may be dragged (others are fixed, like a header row). */
  rows: () => HTMLElement[];
  onReorder: (from: number, to: number) => void;
}

const DRAG_THRESHOLD = 4;

export function sortable(list: HTMLElement, options: SortableOptions): void {
  list.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    const target = (down.target as HTMLElement).closest<HTMLElement>(".px-item");
    if (!target || (down.target as HTMLElement).closest("button, input")) return;
    const rows = options.rows();
    const from = rows.indexOf(target);
    if (from < 0 || rows.length < 2) return;

    let dragging = false;
    let ghost: HTMLElement | null = null;
    let to = from;
    const startY = down.clientY;
    const offsetY = down.clientY - target.getBoundingClientRect().top;
    const offsetX = down.clientX - target.getBoundingClientRect().left;

    const begin = (): void => {
      dragging = true;
      list.setPointerCapture(down.pointerId);
      ghost = target.cloneNode(true) as HTMLElement;
      ghost.className = target.className + " px-drag-ghost";
      ghost.removeAttribute("aria-selected");
      ghost.style.width = `${target.getBoundingClientRect().width}px`;
      document.body.append(ghost);
      target.setAttribute("data-dragging", "");
      document.body.style.cursor = "grabbing";
    };

    const move = (ev: PointerEvent): void => {
      if (!dragging) {
        if (Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
        begin();
      }
      ghost!.style.transform = `translate(${ev.clientX - offsetX}px, ${ev.clientY - offsetY}px)`;
      // Where does the pointer land among the other rows?
      const others = options.rows().filter((r) => r !== target);
      let index = others.length;
      for (let i = 0; i < others.length; i++) {
        const r = others[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          index = i;
          break;
        }
      }
      if (index === to) return;
      // FLIP: remember where everything is, move the ghost row, animate the rest.
      const before = new Map(options.rows().map((r) => [r, r.getBoundingClientRect().top]));
      const anchor = others[index] ?? null;
      if (anchor) list.insertBefore(target, anchor);
      else list.append(target);
      to = index;
      for (const [row, top] of before) {
        if (row === target) continue;
        const delta = top - row.getBoundingClientRect().top;
        if (!delta) continue;
        row.style.transition = "none";
        row.style.transform = `translateY(${delta}px)`;
        // Next frame: let it slide to its new place.
        requestAnimationFrame(() => {
          row.style.transition = "transform 140ms cubic-bezier(0.2, 0, 0, 1)";
          row.style.transform = "";
        });
      }
    };

    const end = (): void => {
      list.removeEventListener("pointermove", move);
      list.removeEventListener("pointerup", end);
      list.removeEventListener("pointercancel", end);
      if (!dragging) return;
      ghost?.remove();
      target.removeAttribute("data-dragging");
      document.body.style.cursor = "";
      for (const r of options.rows()) {
        r.style.transition = "";
        r.style.transform = "";
      }
      if (to !== from) options.onReorder(from, to);
    };

    list.addEventListener("pointermove", move);
    list.addEventListener("pointerup", end);
    list.addEventListener("pointercancel", end);
  });
}
