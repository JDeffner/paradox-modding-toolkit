/**
 * One modifier, printed the way the GAME prints it.
 *
 * A creator that offers `monthly_income = 0.5` has to answer "and what does
 * that look like in the game", and the answer is not the script: it is
 * "[gold_i] +0.50 Monthly Income" in green. The rules come from the server's
 * `paradox/modifierFormats` answer, which reads them out of the game's own
 * format files, loc and texticons, so nothing about a game is decided here.
 * This module only applies them.
 *
 * `modifierLine` is pure (no DOM) and unit-tested; `renderModifierLine` is the
 * one place that turns a line into elements, styled by ui.css (`.px-mod-line`,
 * `.px-texticon`).
 */
import type { FormatPart, ModifierFormat } from "@px-lsp/protocol/protocol";

export interface ModifierLine {
  /** The player's word for the modifier. */
  label: string;
  /** The number as the game writes it: sign, decimals, percent. */
  value: string;
  /** Whether this reads as good or bad FOR THE PLAYER, not by the sign. */
  tone: "good" | "bad" | "neutral";
  prefix: FormatPart[];
  suffix: FormatPart[];
}

/** `monthly_income` -> `Monthly Income`: the fallback when loc has no word. */
function titleCase(name: string): string {
  return name
    .split("_")
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * How one `name = value` row reads in the game. A value that is not a number
 * (a script value's name) is shown verbatim and toned neutral: the game
 * resolves it at runtime and no honest sign can be put on it here.
 */
export function modifierLine(
  name: string,
  value: number | string,
  fmt: ModifierFormat | undefined
): ModifierLine {
  const label = fmt?.label || titleCase(name);
  const numeric = typeof value === "number" ? value : Number(value);
  if (typeof value === "string" && (value.trim() === "" || !Number.isFinite(numeric))) {
    return { label, value, tone: "neutral", prefix: fmt?.prefix ?? [], suffix: fmt?.suffix ?? [] };
  }

  const decimals = fmt?.decimals ?? 2;
  const scaled = fmt?.percent ? numeric * 100 : numeric;
  const digits = Math.abs(scaled).toFixed(decimals);
  const percent = fmt?.percent || fmt?.alreadyPercent ? "%" : "";
  const sign = fmt?.noSign ? "" : scaled < 0 ? "-" : "+";

  // `color` says which direction is good for the player: `bad` (the game's own
  // default) means a positive number is the bad one.
  let tone: ModifierLine["tone"] = "neutral";
  if (fmt?.color !== "neutral" && scaled !== 0) {
    const positiveIsGood = fmt?.color === "good";
    tone = scaled > 0 === positiveIsGood ? "good" : "bad";
  }

  // The game swaps the suffix for negatives when it defines one ("days slower"
  // becomes "days faster"), which is why a hidden sign still reads correctly.
  const suffix = (scaled < 0 && fmt?.negativeSuffix) || fmt?.suffix || [];
  return { label, value: `${sign}${digits}${percent}`, tone, prefix: fmt?.prefix ?? [], suffix };
}

/** The sprite box a texticon draws in, in px. */
const ICON_SIZE = 16;

function texticon(part: Extract<FormatPart, { icon: unknown }>, url: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "px-texticon";
  span.style.backgroundImage = `url("${url}")`;
  const uv = part.icon.uv;
  if (uv) {
    // uv is (u0 v0 u1 v1) in texture fractions: scale the WHOLE sheet so the
    // named rectangle is one icon box, then slide that rectangle into view.
    const width = ICON_SIZE / Math.max(uv[2] - uv[0], 0.0001);
    const height = ICON_SIZE / Math.max(uv[3] - uv[1], 0.0001);
    span.style.backgroundSize = `${width}px ${height}px`;
    span.style.backgroundPosition = `${-uv[0] * width}px ${-uv[1] * height}px`;
  } else {
    span.style.backgroundSize = "contain";
    span.style.backgroundPosition = "center";
  }
  return span;
}

/**
 * `[prefix] value label [suffix]`, the game's own order. `imageUrl` turns a
 * texture path into something the webview may load (the host's decoded PNG);
 * a texture it cannot resolve is left out rather than drawn as a broken image.
 */
export function renderModifierLine(
  line: ModifierLine,
  imageUrl: (texture: string) => string | null
): HTMLElement {
  const row = document.createElement("span");
  row.className = `px-mod-line ${line.tone}`;
  const parts = (list: FormatPart[]): void => {
    for (const part of list) {
      if ("icon" in part) {
        const url = imageUrl(part.icon.texture);
        if (url) row.append(texticon(part, url));
        continue;
      }
      const text = document.createElement("span");
      text.textContent = part.text;
      row.append(text);
    }
  };
  parts(line.prefix);
  const value = document.createElement("span");
  value.className = "px-mod-value";
  value.textContent = line.value;
  row.append(value);
  const label = document.createElement("span");
  label.className = "px-mod-label";
  label.textContent = line.label;
  row.append(label);
  parts(line.suffix);
  return row;
}
