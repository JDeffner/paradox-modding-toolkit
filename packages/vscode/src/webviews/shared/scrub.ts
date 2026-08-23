/**
 * Scrubbable number inputs: press and drag sideways to change the value, as
 * in Photoshop or Blender. A plain click still focuses the field for typing.
 * Pointer lock makes the drag infinite (the cursor hides and never hits the
 * window edge); where the webview refuses it the drag still works within the
 * window. Shift drags 10x, Alt 0.1x. Browser code.
 */
export interface ScrubOptions {
  /** Value change per 2px of drag (the input's step by default). */
  step?: number;
  /** Called on every change during the drag. */
  onChange: (value: number) => void;
  /** Called once when the drag ends (the undo step). */
  onCommit?: () => void;
}

const DRAG_THRESHOLD = 3;

export function scrubbable(input: HTMLInputElement, options: ScrubOptions): void {
  input.classList.add("px-scrub");
  input.addEventListener("pointerdown", (down) => {
    // A focused field is being typed in: leave text selection alone.
    if (down.button !== 0 || document.activeElement === input) return;
    // Not focused: hold the focus back until we know this is a click, not a drag.
    down.preventDefault();
    const step = (options.step ?? Number(input.step)) || 1;
    const startX = down.clientX;
    const start = Number(input.value) || 0;
    let dragging = false;
    let locked = false;
    let accumulated = 0;
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));

    const apply = (dx: number, ev: PointerEvent): void => {
      const factor = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const value = Number((start + (dx / 2) * step * factor).toFixed(decimals + 1));
      input.value = String(value);
      options.onChange(value);
    };
    const move = (ev: PointerEvent): void => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD) return;
        dragging = true;
        input.setAttribute("data-scrubbing", "");
        document.body.style.cursor = "ew-resize";
        input.setPointerCapture(down.pointerId);
        input.requestPointerLock?.()?.catch?.(() => undefined);
      }
      if (document.pointerLockElement === input) {
        locked = true;
        accumulated += ev.movementX;
        apply(accumulated, ev);
      } else if (!locked) {
        apply(ev.clientX - startX, ev);
      }
    };
    const up = (): void => {
      input.removeEventListener("pointermove", move);
      input.removeEventListener("pointerup", up);
      input.removeEventListener("pointercancel", up);
      if (!dragging) {
        input.focus();
        input.select();
        return;
      }
      if (document.pointerLockElement === input) document.exitPointerLock();
      document.body.style.cursor = "";
      input.removeAttribute("data-scrubbing");
      options.onCommit?.();
    };
    input.addEventListener("pointermove", move);
    input.addEventListener("pointerup", up);
    input.addEventListener("pointercancel", up);
  });
}
