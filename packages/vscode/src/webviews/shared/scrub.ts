/**
 * Scrubbable numbers: press and drag sideways to change the value, as in
 * Photoshop or Blender. The handle is the field's LABEL wherever the number
 * has one, so typing in the input is never a drag; a number with no label of
 * its own drags on the input itself. A plain click on either focuses the field
 * for typing.
 *
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
  /**
   * What the modder drags. The field's LABEL where the number has one, so the
   * input stays a plain typing field and a press inside it never moves the
   * value; the input itself where there is no label (an inline pair, a
   * captionless box), which is the default.
   */
  handle?: HTMLElement;
}

const DRAG_THRESHOLD = 3;

export function scrubbable(input: HTMLInputElement, options: ScrubOptions): void {
  const handle = options.handle ?? input;
  const marks = handle === input ? [input] : [handle, input];
  handle.classList.add("px-scrub");
  handle.addEventListener("pointerdown", (down) => {
    // A focused field is being typed in: leave text selection alone.
    if (down.button !== 0 || document.activeElement === handle) return;
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
        for (const mark of marks) mark.setAttribute("data-scrubbing", "");
        document.body.style.cursor = "ew-resize";
        handle.setPointerCapture(down.pointerId);
        handle.requestPointerLock?.()?.catch?.(() => undefined);
      }
      if (document.pointerLockElement === handle) {
        locked = true;
        accumulated += ev.movementX;
        apply(accumulated, ev);
      } else if (!locked) {
        apply(ev.clientX - startX, ev);
      }
    };
    const up = (): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (!dragging) {
        // A press that never moved is a click: on a label that means "let me
        // type here", the same as clicking the input.
        input.focus();
        input.select();
        return;
      }
      if (document.pointerLockElement === handle) document.exitPointerLock();
      document.body.style.cursor = "";
      for (const mark of marks) mark.removeAttribute("data-scrubbing");
      options.onCommit?.();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}
