/**
 * Color swatches and the multi-format picker (issue #11), via the standard
 * LSP documentColor / colorPresentation pair so the editor's native picker
 * drives it.
 *
 * The recognised forms are the ones measured in the vanilla files of the two
 * calibrated games (2026-08), not the habits older-engine tools assume:
 *   rgb { 174 169 166 }        ints 0..255
 *   hsv { 0.6 0.5 0.7 }        hue 0..1, NOT 0..360 (998 vanilla uses)
 *   hsv360 { 358 70 65 }       hue 0..360, s and v 0..100 (179 vanilla uses)
 *   hex { 50779b }             six hex digits, no 0x prefix
 *   { 0.9 0.8 0.2 1 }          untagged floats 0..1, alpha optional (.gui, named colors)
 *   { 180 75 80 }              untagged ints 0..255
 * Untagged blocks are only colors when the key says so (`color`, `color1`,
 * `map_color`, ...) or when they sit inside a `colors = { }` table
 * (common/named_colors). Tagged blocks are colors wherever they appear.
 *
 * The untagged int/float split follows the engine: a component with a `.`
 * or every component <= 1 means floats, otherwise 0..255. `{ 1 1 1 }` is
 * therefore white, which is what every vanilla .gui relies on.
 */
import type { Color, ColorInformation, ColorPresentation, Range } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
  walkStatements,
  type AssignmentNode,
  type BlockNode,
  type Statement,
  type ValueNode,
} from "../parser";
import { getParse } from "../parseCache";

/** `rgbf` is a tagged rgb block written with 0..1 components (vanilla named_colors
 *  does this); it is offered back in the same notation, never as 0..255. */
export type ColorFormat = "rgb" | "rgbf" | "hsv" | "hsv360" | "hex" | "float" | "int";

const TAGS: ReadonlySet<string> = new Set(["rgb", "hsv", "hsv360", "hex"]);

/** The format rides along in the ColorInformation so the presentation request
 *  can lead with the author's own notation; the LSP layer passes extra fields
 *  through as plain object data. */
export interface ColorSite extends ColorInformation {
  format: ColorFormat;
  /** The source spelled a fourth component, so presentations keep it. */
  alpha: boolean;
}

interface Decoded {
  color: Color;
  format: ColorFormat;
  alpha: boolean;
}

function numbers(block: BlockNode): number[] | null {
  const out: number[] = [];
  for (const s of block.statements) {
    if (s.kind !== "value" || s.value.kind !== "scalar" || s.value.quoted) return null;
    const n = Number(s.value.text);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out.length === 3 || out.length === 4 ? out : null;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (((i % 6) + 6) % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d > 0) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, max];
}

/** `{ 1 1 1 }` is white and `{ 255 0 0 }` is red: floats when any component
 *  carries a fraction or all of them fit in 0..1. */
function rgbComponents(c: number[], format: ColorFormat): Decoded {
  const floats = c.some((n) => !Number.isInteger(n)) || c.every((n) => n <= 1);
  const k = floats ? 1 : 255;
  const alpha = c.length === 4;
  return {
    color: {
      red: clamp01(c[0] / k),
      green: clamp01(c[1] / k),
      blue: clamp01(c[2] / k),
      alpha: alpha ? clamp01(c[3] / k) : 1,
    },
    format: format === "rgb" ? (floats ? "rgbf" : "rgb") : floats ? "float" : "int",
    alpha,
  };
}

/** Decode one value node into a color, or null when it is not a color. */
function decode(value: ValueNode, keyIsColor: boolean): Decoded | null {
  if (value.kind === "tagged-block") {
    const tag = value.tag.text;
    if (!TAGS.has(tag)) return null;
    if (tag === "hex") {
      const s = value.block.statements;
      if (s.length !== 1 || s[0].kind !== "value" || s[0].value.kind !== "scalar" || s[0].value.quoted)
        return null;
      const m = /^(?:0x)?([0-9a-fA-F]{6})$/.exec(s[0].value.text);
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return {
        color: { red: (n >> 16) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255, alpha: 1 },
        format: "hex",
        alpha: false,
      };
    }
    const c = numbers(value.block);
    if (!c) return null;
    // Vanilla named_colors spells `rgb { 1 0.4 0.6 }`, so rgb follows the untagged split too.
    if (tag === "rgb") return rgbComponents(c, "rgb");
    const alpha = c.length === 4;
    const format: ColorFormat = tag === "hsv360" ? "hsv360" : "hsv";
    const [h, s, v] = format === "hsv360" ? [c[0] / 360, c[1] / 100, c[2] / 100] : [c[0], c[1], c[2]];
    const [r, g, b] = hsvToRgb(((h % 1) + 1) % 1, clamp01(s), clamp01(v));
    return { color: { red: r, green: g, blue: b, alpha: alpha ? clamp01(c[3]) : 1 }, format, alpha };
  }
  if (value.kind === "block" && keyIsColor) {
    const c = numbers(value);
    return c ? rgbComponents(c, "float") : null;
  }
  return null;
}

/** Portrait genes: `hair_color = { 32 235 66 229 }` is two palette coordinates
 *  (x y x y), not RGBA. 766 sites per game in dna_data, ethnicities and
 *  bookmark_portraits would otherwise show a meaningless swatch. */
const GENE_KEYS: ReadonlySet<string> = new Set(["hair_color", "skin_color", "eye_color"]);

function keyNamesColor(stmt: Statement, ancestors: readonly (AssignmentNode | BlockNode)[]): boolean {
  if (stmt.kind === "assignment" && stmt.key.text.includes("color")) return !GENE_KEYS.has(stmt.key.text);
  // common/named_colors: `colors = { english = { 0.8 0.2 0.2 } }`.
  const parent = ancestors[ancestors.length - 2];
  return parent?.kind === "assignment" && parent.key.text === "colors";
}

export function provideDocumentColors(document: TextDocument): ColorSite[] {
  const { result, lineIndex } = getParse(document);
  const out: ColorSite[] = [];
  walkStatements(result.root, (stmt, ancestors) => {
    const value = stmt.value;
    if (!value) return;
    const hit = decode(value, keyNamesColor(stmt, ancestors));
    if (!hit) return;
    const range: Range = {
      start: lineIndex.positionAt(value.range.start),
      end: lineIndex.positionAt(value.range.end),
    };
    out.push({ range, color: hit.color, format: hit.format, alpha: hit.alpha });
  });
  return out;
}

const FORMATS: readonly ColorFormat[] = ["rgb", "hsv", "hsv360", "hex", "float", "int"];

export function renderColor(color: Color, format: ColorFormat, alpha: boolean): string {
  const i = (n: number) => Math.round(n * 255);
  const f = (n: number) => String(Math.round(n * 1000) / 1000);
  const withAlpha = alpha || color.alpha < 1;
  const { red: r, green: g, blue: b, alpha: a } = color;
  switch (format) {
    case "rgb":
      return `rgb { ${i(r)} ${i(g)} ${i(b)}${withAlpha ? ` ${i(a)}` : ""} }`;
    case "rgbf":
      return `rgb { ${f(r)} ${f(g)} ${f(b)}${withAlpha ? ` ${f(a)}` : ""} }`;
    case "int":
      return `{ ${i(r)} ${i(g)} ${i(b)}${withAlpha ? ` ${i(a)}` : ""} }`;
    case "float":
      return `{ ${f(r)} ${f(g)} ${f(b)}${withAlpha ? ` ${f(a)}` : ""} }`;
    case "hex":
      return `hex { ${((i(r) << 16) | (i(g) << 8) | i(b)).toString(16).padStart(6, "0")} }`;
    case "hsv": {
      const [h, s, v] = rgbToHsv(r, g, b);
      return `hsv { ${f(h)} ${f(s)} ${f(v)}${withAlpha ? ` ${f(a)}` : ""} }`;
    }
    case "hsv360": {
      const [h, s, v] = rgbToHsv(r, g, b);
      return `hsv360 { ${Math.round(h * 360)} ${Math.round(s * 100)} ${Math.round(v * 100)}${withAlpha ? ` ${f(a)}` : ""} }`;
    }
  }
}

/**
 * One presentation per format, the author's own notation first so a nudge in
 * the picker never silently rewrites `hsv` as `rgb`. The editor cycles through
 * the rest on click; that is the "multiple format" part of the feature.
 */
export function provideColorPresentations(
  document: TextDocument,
  color: Color,
  range: Range
): ColorPresentation[] {
  const site = provideDocumentColors(document).find(
    (s) => s.range.start.line === range.start.line && s.range.start.character === range.start.character
  );
  const own = site?.format ?? "rgb";
  const alpha = site?.alpha ?? false;
  return [own, ...FORMATS.filter((f) => f !== own)].map((format) => ({
    label: renderColor(color, format, alpha),
  }));
}
