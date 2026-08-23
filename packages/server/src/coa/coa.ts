/**
 * Coat-of-arms model for the flag builder (every game whose profile opts in
 * shares the format): the types, color resolution and the writer. Parsing lives in
 * coaParse.ts so this module (which the webview app bundles) pulls in no
 * parser and no game profile.
 *
 * The model mirrors what the game reads, no more:
 *
 *   NAME = {
 *     pattern = "pattern_solid.tga"
 *     color1 = "red"                 # named | color3 (reference) | rgb { } | hsv { } | hsv360 { }
 *     colored_emblem = {             # | textured_emblem | sub
 *       texture = "ce_circle.dds"    # sub: parent = "NAME"
 *       mask = { 1 }                 # colored_emblem only: pattern color slot 1..3
 *       color1 = color2
 *       instance = { rotation = 0 scale = { 1 1 } position = { 0.5 0.5 } }
 *     }                              # sub instances: offset = { } scale = { }
 *   }
 *
 * No vscode imports; runs in the extension host, the webview app and tests.
 */
export type Rgb = [number, number, number];

export type CoaColor =
  | { name: string; kind: "named"; value: string }
  | { name: string; kind: "ref"; value: string }
  | { name: string; kind: "rgb"; value: Rgb }
  | { name: string; kind: "hsv360"; value: [number, number, number] };

export interface CoaInstance {
  rotation: number;
  scale: [number, number];
  position: [number, number];
}

export interface CoaSubInstance {
  offset: [number, number];
  scale: [number, number];
}

export type CoaLayer =
  | { kind: "colored_emblem"; texture: string; mask: number; colors: CoaColor[]; instances: CoaInstance[] }
  | { kind: "textured_emblem"; texture: string; instances: CoaInstance[] }
  | { kind: "sub"; parent: string; instances: CoaSubInstance[] };

export interface CoaFlag {
  name: string;
  pattern: string;
  colors: CoaColor[];
  layers: CoaLayer[];
}

/** The slots a flag or a layer may fill, in the order the game names them. */
export const COLOR_SLOTS = [
  "color1",
  "color2",
  "color3",
  "color4",
  "color5",
  "color6",
  "color7",
  "color8",
  "color9",
];

/** Placeholder colors a pattern texture is painted with; slot N maps to color N. */
export const PATTERN_SOURCE_COLORS: Rgb[] = [
  [255, 0, 0],
  [255, 255, 0],
  [255, 255, 255],
];

/** Placeholder colors of a colored emblem (red/green identify the slot, blue is shading). */
export const EMBLEM_SOURCE_COLORS: Rgb[] = [
  [0, 0, 128],
  [0, 255, 128],
  [255, 0, 128],
];

export const DEFAULT_INSTANCE: CoaInstance = { rotation: 0, scale: [1, 1], position: [0.5, 0.5] };
export const DEFAULT_SUB_INSTANCE: CoaSubInstance = { offset: [0, 0], scale: [1, 1] };

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export function hsv360ToRgb(h: number, s: number, v: number): Rgb {
  const hh = (((h % 360) + 360) % 360) / 60;
  const ss = Math.min(1, Math.max(0, s / 100));
  const vv = Math.min(1, Math.max(0, v / 100));
  const c = vv * ss;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = vv - c;
  const sector = Math.floor(hh);
  const [r, g, b] =
    sector === 0
      ? [c, x, 0]
      : sector === 1
        ? [x, c, 0]
        : sector === 2
          ? [0, c, x]
          : sector === 3
            ? [0, x, c]
            : sector === 4
              ? [x, 0, c]
              : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * The rgb a color resolves to: a literal, a named color from the game's
 * tables, or a reference (`color1 = color3`) into the flag's own colors. A
 * reference to a reference is followed once (the game does not chain them).
 */
export function colorToRgb(color: CoaColor, named: Record<string, Rgb>, flagColors: CoaColor[]): Rgb | null {
  switch (color.kind) {
    case "rgb":
      return color.value;
    case "hsv360":
      return hsv360ToRgb(color.value[0], color.value[1], color.value[2]);
    case "named":
      return named[color.value] ?? null;
    case "ref": {
      const base = flagColors.find((c) => c.name === color.value);
      if (!base || base.kind === "ref") return null;
      return colorToRgb(base, named, []);
    }
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");

function writeColor(c: CoaColor): string {
  switch (c.kind) {
    case "named":
      return `${c.name} = "${c.value}"`;
    case "ref":
      return `${c.name} = ${c.value}`;
    case "rgb":
      return `${c.name} = rgb { ${c.value.join(" ")} }`;
    case "hsv360":
      return `${c.name} = hsv360 { ${c.value.map((v) => Math.round(v)).join(" ")} }`;
  }
}

/** The flag as the game reads it: tabs, one attribute per line, no trailing newline. */
export function writeFlag(flag: CoaFlag): string {
  const lines: string[] = [`${flag.name || "NONE"} = {`];
  if (flag.pattern) lines.push(`\tpattern = "${flag.pattern}"`);
  for (const c of flag.colors) lines.push(`\t${writeColor(c)}`);
  for (const layer of flag.layers) {
    lines.push("");
    lines.push(`\t${layer.kind} = {`);
    if (layer.kind === "sub") {
      lines.push(`\t\tparent = "${layer.parent}"`);
      for (const i of layer.instances) {
        lines.push(
          `\t\tinstance = { offset = { ${fmt(i.offset[0])} ${fmt(i.offset[1])} } scale = { ${fmt(i.scale[0])} ${fmt(i.scale[1])} } }`
        );
      }
    } else {
      lines.push(`\t\ttexture = "${layer.texture}"`);
      if (layer.kind === "colored_emblem") {
        if (layer.mask > 0) lines.push(`\t\tmask = { ${layer.mask} }`);
        for (const c of layer.colors) lines.push(`\t\t${writeColor(c)}`);
      }
      for (const i of layer.instances) {
        const parts = [];
        if (i.rotation !== 0) parts.push(`rotation = ${fmt(i.rotation)}`);
        parts.push(`scale = { ${fmt(i.scale[0])} ${fmt(i.scale[1])} }`);
        parts.push(`position = { ${fmt(i.position[0])} ${fmt(i.position[1])} }`);
        lines.push(`\t\tinstance = { ${parts.join(" ")} }`);
      }
    }
    lines.push("\t}");
  }
  lines.push("}");
  return lines.join("\n");
}
