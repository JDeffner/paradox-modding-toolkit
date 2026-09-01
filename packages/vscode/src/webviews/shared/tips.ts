/**
 * The tooltip runtime every webview shares.
 *
 * `data-tip` used to draw as a CSS ::after on the anchor itself, so a tip on a
 * control near a panel edge was cut off by that edge (a narrow sidebar cut
 * nearly every one). Here ONE fixed element per page carries the text, and it
 * flips to the opposite side or shifts along the edge until it fits.
 *
 * `installTips` may not reference anything outside its own body: `tipScript()`
 * serializes it for the webviews that inline their script instead of bundling
 * one (the pattern eventSim already uses for simulationSteps).
 */
export function installTips(): void {
  const GAP = 6; // anchor to tip
  const EDGE = 4; // tip to viewport edge
  const DELAY = 400; // the delay the CSS tips had
  const WRAP_MAX = 260;

  const tip = document.createElement("div");
  tip.className = "px-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.appendChild(tip);
  // Turns off the ::after fallback ui.css keeps for pages without the runtime.
  document.documentElement.setAttribute("data-px-tips", "js");

  let anchor: Element | null = null;
  let timer = 0;

  const hide = (): void => {
    if (timer) clearTimeout(timer);
    timer = 0;
    anchor = null;
    tip.hidden = true;
  };

  /** The element whose tip should open for a hit, or null for anything else. */
  const tipOf = (node: Element | null): Element | null => {
    const el = node ? node.closest("[data-tip]") : null;
    if (!el) return null;
    const text = el.getAttribute("data-tip");
    if (!text || !text.trim()) return null;
    // A control holding an open menu or popover: a tip over it reads as a glitch.
    if (el.getAttribute("aria-expanded") === "true") return null;
    return el;
  };

  const place = (el: Element): void => {
    if (!el.isConnected) {
      hide();
      return;
    }
    const text = el.getAttribute("data-tip") ?? "";
    tip.textContent = text;
    const avail = Math.max(80, window.innerWidth - 2 * EDGE);
    const multiline = text.indexOf("\n") >= 0;
    const wrap = multiline || el.hasAttribute("data-tip-wrap");
    tip.style.whiteSpace = multiline ? "pre-line" : wrap ? "normal" : "nowrap";
    tip.style.maxWidth = wrap ? Math.min(WRAP_MAX, avail) + "px" : "none";
    // Measure from the left edge. A wrapping tip is shrink-to-fit against the
    // room to ITS right, so measuring where the last tip stood reports a width
    // it will not keep once it moves.
    tip.style.left = "0px";
    tip.style.top = "0px";
    tip.hidden = false;
    let box = tip.getBoundingClientRect();
    // A one-line tip wider than the panel has to wrap: clipping is not an option.
    if (box.width > avail) {
      tip.style.whiteSpace = multiline ? "pre-line" : "normal";
      tip.style.maxWidth = avail + "px";
      box = tip.getBoundingClientRect();
    }

    const a = el.getBoundingClientRect();
    const room: Record<string, number> = {
      top: a.top - GAP - EDGE,
      bottom: window.innerHeight - a.bottom - GAP - EDGE,
      left: a.left - GAP - EDGE,
      right: window.innerWidth - a.right - GAP - EDGE,
    };
    // data-tip-side is a preference; the first side with room wins.
    const orders: Record<string, string[]> = {
      top: ["top", "bottom", "right", "left"],
      bottom: ["bottom", "top", "right", "left"],
      left: ["left", "right", "bottom", "top"],
      right: ["right", "left", "bottom", "top"],
    };
    const order = orders[el.getAttribute("data-tip-side") ?? "bottom"] ?? orders.bottom;
    let side = order[0];
    for (const candidate of order) {
      const need = candidate === "top" || candidate === "bottom" ? box.height : box.width;
      if (room[candidate] >= need) {
        side = candidate;
        break;
      }
    }

    let left: number;
    let top: number;
    if (side === "top" || side === "bottom") {
      top = side === "bottom" ? a.bottom + GAP : a.top - GAP - box.height;
      const align = el.getAttribute("data-tip-align");
      left =
        align === "right"
          ? a.right - box.width
          : align === "left"
            ? a.left
            : a.left + a.width / 2 - box.width / 2;
    } else {
      left = side === "right" ? a.right + GAP : a.left - GAP - box.width;
      top = a.top + a.height / 2 - box.height / 2;
    }
    tip.style.left = Math.max(EDGE, Math.min(left, window.innerWidth - EDGE - box.width)) + "px";
    tip.style.top = Math.max(EDGE, Math.min(top, window.innerHeight - EDGE - box.height)) + "px";
  };

  const open = (el: Element): void => {
    if (anchor === el) return;
    if (timer) clearTimeout(timer);
    anchor = el;
    tip.hidden = true;
    timer = window.setTimeout(() => place(el), DELAY);
  };

  document.addEventListener(
    "pointermove",
    (ev) => {
      // A held button means a drag: no tips, and no hit test in that hot path.
      if (ev.buttons !== 0) {
        hide();
        return;
      }
      // elementFromPoint rather than the event target: hit testing is what the
      // :hover this replaces used, so an element that takes no pointer events
      // of its own (a disabled control) still reads the same either way. The
      // tip itself is pointer-events: none and never hits.
      const el = tipOf(document.elementFromPoint(ev.clientX, ev.clientY));
      if (el) open(el);
      else if (anchor) hide();
    },
    true
  );
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("pointerleave", hide);
  document.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);
  document.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key === "Escape") hide();
    },
    true
  );
  // Keyboard focus opens the tip the way :focus-visible did; a click does not.
  document.addEventListener(
    "focusin",
    (ev) => {
      const target = ev.target as Element | null;
      const el = target && target.matches(":focus-visible") ? tipOf(target) : null;
      if (el) open(el);
      else hide();
    },
    true
  );
  document.addEventListener("focusout", hide, true);
}

/** The runtime as a script tag, for webviews that inline their script. */
export function tipScript(nonce: string): string {
  return `<script nonce="${nonce}">(${installTips.toString()})();</script>`;
}

/** Keep a floating box whose top left wants to sit at (x, y) inside the viewport. */
export function clampToViewport(
  box: { width: number; height: number },
  x: number,
  y: number,
  edge = 4
): { left: number; top: number } {
  return {
    left: Math.max(edge, Math.min(x, window.innerWidth - edge - box.width)),
    top: Math.max(edge, Math.min(y, window.innerHeight - edge - box.height)),
  };
}
