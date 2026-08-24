/**
 * A color picker in a popover: saturation/value square, hue bar, and a value
 * field in the color's OWN notation (hex when the caller has none), with copy
 * and liberal paste. The same shape as VS Code's editor color picker, so it
 * reads as the one the toolkit already uses on `rgb { }` literals in script
 * files (which cannot be summoned inside a webview). Browser code, styled by
 * ui.css (`.px-picker`).
 *
 * Alpha is SIMULATED, never edited: a source that spells a fourth component
 * shows it blended over a checkerboard, but there is no slider for it. Script
 * colors are not meant to grow alpha channels by accident.
 */
import { iconEl } from "./icons";
import { popover } from "./overlay";

export type Rgb = [number, number, number];

/** The color's own notation for the picker's value field. */
export interface ColorValueFormat {
  /** The value text for the current color, e.g. `hsv360 { 216 50 70 }`. */
  write: (rgb: Rgb) => string;
  /** Typed or pasted text back to a color; null while it is not one. */
  parse: (text: string) => Rgb | null;
}

export interface ColorPickerOptions {
  /** Every change while dragging. */
  onChange: (rgb: Rgb) => void;
  /** When the picker closes (the undo step). */
  onClose?: () => void;
  /** The value field's notation; a plain hex field when absent. */
  format?: ColorValueFormat;
  /** A source alpha in 0..1, blended into the preview. Not adjustable here. */
  alpha?: number;
  /** Routes the copy button's text; webview hosts own the clipboard. */
  onCopy?: (text: string) => void;
}

export function rgbToHsv(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max ? d / max : 0, max];
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const i = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][i];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function rgbToHex(rgb: Rgb): string {
  return (
    "#" +
    rgb
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Paint a swatch element, blending a locked alpha over the checkerboard. */
export function paintSwatch(swatch: HTMLElement, rgb: Rgb, alpha?: number): void {
  if (alpha !== undefined && alpha < 1) {
    swatch.setAttribute("data-checker", "");
    swatch.style.setProperty("--px-swatch", `rgb(${rgb.join(" ")} / ${alpha})`);
  } else {
    swatch.removeAttribute("data-checker");
    swatch.style.setProperty("--px-swatch", rgbToHex(rgb));
  }
}

export function colorPicker(anchor: HTMLElement, initial: Rgb, options: ColorPickerOptions): void {
  let [h, s, v] = rgbToHsv(initial);

  const root = document.createElement("div");
  root.className = "px-picker";
  const square = document.createElement("div");
  square.className = "px-picker-square";
  const squareThumb = document.createElement("div");
  squareThumb.className = "px-picker-thumb";
  square.append(squareThumb);
  const hue = document.createElement("div");
  hue.className = "px-picker-hue";
  const hueThumb = document.createElement("div");
  hueThumb.className = "px-picker-thumb";
  hue.append(hueThumb);
  const row = document.createElement("div");
  row.className = "px-row";
  const preview = document.createElement("span");
  preview.className = "px-swatch";
  const value = document.createElement("input");
  value.className = "px-input px-mono";
  value.dataset.size = "sm";
  value.spellcheck = false;
  row.append(preview, value);

  const write = options.format?.write ?? rgbToHex;
  // The hex form always parses, whatever notation the field displays.
  const parse = (text: string): Rgb | null => options.format?.parse(text) ?? hexToRgb(text);
  if (!options.format) value.maxLength = 7;

  if (options.onCopy) {
    const copy = document.createElement("button");
    copy.className = "px-btn";
    copy.dataset.variant = "ghost";
    copy.dataset.size = "icon-xs";
    copy.dataset.tip = "Copy the value";
    copy.append(iconEl("copy"));
    copy.onclick = () => options.onCopy!(write(current()));
    row.append(copy);
  }
  root.append(square, hue, row);

  const current = (): Rgb => hsvToRgb(h, s, v);
  const paint = (): void => {
    square.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h} 100% 50%))`;
    squareThumb.style.left = `${s * 100}%`;
    squareThumb.style.top = `${(1 - v) * 100}%`;
    hueThumb.style.left = `${(h / 360) * 100}%`;
    const rgb = current();
    paintSwatch(preview, rgb, options.alpha);
    if (document.activeElement !== value) value.value = write(rgb);
  };
  const emit = (): void => {
    paint();
    options.onChange(current());
  };

  const drag = (el: HTMLElement, onPoint: (x: number, y: number) => void): void => {
    el.addEventListener("pointerdown", (down) => {
      down.preventDefault();
      el.setPointerCapture(down.pointerId);
      const point = (ev: PointerEvent): void => {
        const r = el.getBoundingClientRect();
        onPoint(
          Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)),
          Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))
        );
        emit();
      };
      point(down);
      const up = (): void => {
        el.removeEventListener("pointermove", point);
        el.removeEventListener("pointerup", up);
      };
      el.addEventListener("pointermove", point);
      el.addEventListener("pointerup", up);
    });
  };
  drag(square, (x, y) => {
    s = x;
    v = 1 - y;
  });
  drag(hue, (x) => {
    h = x * 360;
  });
  value.oninput = () => {
    const rgb = parse(value.value);
    if (!rgb) return;
    [h, s, v] = rgbToHsv(rgb);
    emit();
  };
  paint();
  popover(anchor, root, options.onClose);
}
