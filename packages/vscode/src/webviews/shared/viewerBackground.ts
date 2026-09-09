import { colorPicker, hexToRgb, rgbToHex } from "./colorPicker";
import { iconEl } from "./icons";
import { menu } from "./overlay";

export type ViewerBackground = "default" | "dark" | "light" | `#${string}`;

export function readViewerBackground(value: unknown): ViewerBackground {
  if (value === "dark" || value === "light") return value;
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
    return value.toLowerCase() as ViewerBackground;
  }
  return "default";
}

// Fixed contrast references, independent of the editor theme.
const DARK = "#181818";
const LIGHT = "#f2f2f2";

/** Preview-only paint. Reset releases the page's original CSS background. */
export function viewerBackground(
  stage: HTMLElement,
  tools: HTMLElement,
  onChange: (value: ViewerBackground) => void,
  image?: HTMLElement | null
): { restore: (value: unknown) => void } {
  let value: ViewerBackground = "default";
  const button = document.createElement("button");
  button.className = "px-btn";
  button.dataset.variant = "ghost";
  button.dataset.size = "icon-sm";
  button.dataset.tipSide = "top";
  button.setAttribute("aria-label", "Viewer background");
  button.setAttribute("aria-haspopup", "dialog");
  button.append(iconEl("palette"));
  tools.append(button);

  const restore = (saved: unknown): void => {
    value = readViewerBackground(saved);
    const color = value === "dark" ? DARK : value === "light" ? LIGHT : value;
    if (value === "default") {
      stage.style.background = "";
      if (image) image.style.background = "";
    } else {
      stage.style.background = color;
      // The DDS checkerboard is on the image itself, above the stage.
      if (image) image.style.background = "none";
    }
    const label = value.startsWith("#") ? value : value[0].toUpperCase() + value.slice(1);
    button.dataset.tip = `Viewer background: ${label}`;
  };
  const choose = (next: ViewerBackground): void => {
    restore(next);
    onChange(value);
  };
  button.onclick = () => {
    menu(
      button,
      [
        { value: "dark", label: "Dark", swatch: DARK },
        { value: "light", label: "Light", swatch: LIGHT },
        { value: "custom", label: "Custom color…", swatch: value.startsWith("#") ? value : undefined },
        { value: "default", label: "Reset to default" },
      ],
      {
        value: value.startsWith("#") ? "custom" : value,
        width: 190,
        onPick: (picked) => {
          if (picked !== "custom") {
            choose(readViewerBackground(picked));
            return;
          }
          const initial = hexToRgb(value === "light" ? LIGHT : value === "dark" ? DARK : value);
          colorPicker(button, initial ?? [128, 128, 128], {
            onChange: (rgb) => choose(readViewerBackground(rgbToHex(rgb))),
          });
          const input = document.querySelector<HTMLInputElement>(".px-picker input");
          input?.setAttribute("aria-label", "Custom background color (hex)");
          input?.focus();
          input?.select();
        },
      }
    );
  };
  restore(value);
  return { restore };
}
