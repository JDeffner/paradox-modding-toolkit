/**
 * A color picker in a popover: saturation/value square, hue bar, hex field.
 * The same shape as VS Code's editor color picker, so it reads as the one the
 * toolkit already uses on `rgb { }` literals in script files (which cannot be
 * summoned inside a webview). Browser code, styled by ui.css (`.px-picker`).
 */
import { popover } from "./overlay";

export type Rgb = [number, number, number];

export interface ColorPickerOptions {
  /** Every change while dragging. */
  onChange: (rgb: Rgb) => void;
  /** When the picker closes (the undo step). */
  onClose?: () => void;
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
  const hex = document.createElement("input");
  hex.className = "px-input px-mono";
  hex.dataset.size = "sm";
  hex.spellcheck = false;
  hex.maxLength = 7;
  row.append(preview, hex);
  root.append(square, hue, row);

  const current = (): Rgb => hsvToRgb(h, s, v);
  const paint = (): void => {
    square.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h} 100% 50%))`;
    squareThumb.style.left = `${s * 100}%`;
    squareThumb.style.top = `${(1 - v) * 100}%`;
    hueThumb.style.left = `${(h / 360) * 100}%`;
    const rgb = current();
    preview.style.setProperty("--px-swatch", rgbToHex(rgb));
    if (document.activeElement !== hex) hex.value = rgbToHex(rgb);
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
  hex.oninput = () => {
    const rgb = hexToRgb(hex.value);
    if (!rgb) return;
    [h, s, v] = rgbToHsv(rgb);
    emit();
  };
  paint();
  popover(anchor, root, options.onClose);
}
