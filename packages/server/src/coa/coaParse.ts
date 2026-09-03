/**
 * Coat-of-arms parsing: a `common/coat_of_arms/coat_of_arms/*.txt` file into
 * CoaFlags, `common/named_colors/*.txt` into rgb, and the in-place replace
 * of one flag in a file. Numbers may be `@vars` defined at the top of the
 * same file, including `@[ expr ]` arithmetic; both are resolved here so the
 * renderer only sees numbers. `template = { }` blocks are skipped like the
 * game's own tool does.
 *
 * Host and test side only: the tolerant parser brings the game profiles with
 * it, which the webview app must not bundle.
 */
import { parseScript } from "../parser/parser";
import type { BlockNode, Statement, ValueNode } from "../parser/cst";
import {
  COLOR_SLOTS,
  colorToRgb,
  DEFAULT_INSTANCE,
  DEFAULT_SUB_INSTANCE,
  type CoaColor,
  type CoaFlag,
  type CoaInstance,
  type CoaLayer,
  type CoaSubInstance,
  type Rgb,
} from "./coa";

// ---------------------------------------------------------------------------
// @variables
// ---------------------------------------------------------------------------

type Vars = Map<string, number>;

/**
 * Evaluate `@[ expr ]` / `@name` / a plain number. Only `+ - * /`, parentheses
 * and earlier `@vars` are understood, which is all the coa files use; anything
 * else is NaN and the caller keeps its default.
 */
export function resolveNumber(text: string, vars: Vars): number {
  const t = text.trim();
  if (t.startsWith("@[") && t.endsWith("]")) return evalExpr(t.slice(2, -1), vars);
  if (t.startsWith("@")) return vars.get(t) ?? NaN;
  return Number(t);
}

function evalExpr(src: string, vars: Vars): number {
  // Tokens: numbers, @names, operators, parens.
  const tokens = src.match(/\d+(?:\.\d+)?|@[\w.]+|[-+*/()]/g);
  if (!tokens || tokens.join("") !== src.replace(/\s+/g, "")) return NaN;
  let i = 0;
  const primary = (): number => {
    const tok = tokens[i++];
    if (tok === undefined) return NaN;
    if (tok === "(") {
      const v = sum();
      return tokens[i++] === ")" ? v : NaN;
    }
    if (tok === "-") return -primary();
    if (tok.startsWith("@")) return vars.get(tok) ?? NaN;
    return Number(tok);
  };
  const product = (): number => {
    let v = primary();
    while (tokens[i] === "*" || tokens[i] === "/") {
      const op = tokens[i++];
      const r = primary();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (tokens[i] === "+" || tokens[i] === "-") {
      const op = tokens[i++];
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  return i === tokens.length ? v : NaN;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function scalarText(v: ValueNode | null): string | null {
  return v && v.kind === "scalar" ? v.text : null;
}

function numbers(block: BlockNode, vars: Vars): number[] {
  const out: number[] = [];
  for (const s of block.statements) {
    if (s.kind === "value" && s.value.kind === "scalar") out.push(resolveNumber(s.value.text, vars));
  }
  return out;
}

function pair(block: BlockNode, vars: Vars, fallback: [number, number]): [number, number] {
  const n = numbers(block, vars);
  if (n.length !== 2 || n.some((x) => !Number.isFinite(x))) return fallback;
  return [n[0], n[1]];
}

function parseColor(name: string, value: ValueNode, vars: Vars): CoaColor | null {
  if (value.kind === "scalar") {
    if (!value.quoted && COLOR_SLOTS.includes(value.text)) return { name, kind: "ref", value: value.text };
    return { name, kind: "named", value: value.text };
  }
  const tag = value.kind === "tagged-block" ? value.tag.text : "";
  const block = value.kind === "tagged-block" ? value.block : value;
  const n = numbers(block, vars);
  if (n.length !== 3 || n.some((x) => !Number.isFinite(x))) return null;
  if (tag === "hsv") return { name, kind: "hsv360", value: [n[0] * 360, n[1] * 100, n[2] * 100] };
  if (tag === "hsv360") return { name, kind: "hsv360", value: [n[0], n[1], n[2]] };
  // rgb, or untyped: floats 0..1 or bytes 0..255
  const rgb = n.every((x) => x <= 1) ? n.map((x) => Math.round(x * 255)) : n.map((x) => Math.round(x));
  return { name, kind: "rgb", value: [rgb[0], rgb[1], rgb[2]] };
}

function parseColors(statements: Statement[], vars: Vars): CoaColor[] {
  const out: CoaColor[] = [];
  for (const s of statements) {
    if (s.kind !== "assignment" || !s.value || !COLOR_SLOTS.includes(s.key.text)) continue;
    const c = parseColor(s.key.text, s.value, vars);
    if (c) out.push(c);
  }
  return out;
}

function parseInstances(statements: Statement[], vars: Vars): CoaInstance[] {
  const out: CoaInstance[] = [];
  for (const s of statements) {
    if (s.kind !== "assignment" || s.key.text !== "instance" || s.value?.kind !== "block") continue;
    const inst: CoaInstance = { ...DEFAULT_INSTANCE };
    for (const a of s.value.statements) {
      if (a.kind !== "assignment" || !a.value) continue;
      if (a.key.text === "rotation" && a.value.kind === "scalar") {
        const r = resolveNumber(a.value.text, vars);
        if (Number.isFinite(r)) inst.rotation = r;
      } else if (a.key.text === "depth" && a.value.kind === "scalar") {
        const d = resolveNumber(a.value.text, vars);
        if (Number.isFinite(d)) inst.depth = d;
      } else if (a.key.text === "scale" && a.value.kind === "block") inst.scale = pair(a.value, vars, [1, 1]);
      else if (a.key.text === "position" && a.value.kind === "block")
        inst.position = pair(a.value, vars, [0.5, 0.5]);
    }
    out.push(inst);
  }
  return out;
}

function parseSubInstances(statements: Statement[], vars: Vars): CoaSubInstance[] {
  const out: CoaSubInstance[] = [];
  for (const s of statements) {
    if (s.kind !== "assignment" || s.key.text !== "instance" || s.value?.kind !== "block") continue;
    const inst: CoaSubInstance = { ...DEFAULT_SUB_INSTANCE };
    for (const a of s.value.statements) {
      if (a.kind !== "assignment" || a.value?.kind !== "block") continue;
      if (a.key.text === "scale") inst.scale = pair(a.value, vars, [1, 1]);
      else if (a.key.text === "offset") inst.offset = pair(a.value, vars, [0, 0]);
    }
    out.push(inst);
  }
  return out;
}

function parseLayer(kind: string, block: BlockNode, vars: Vars): CoaLayer | null {
  let texture = "";
  let parent = "";
  let mask = 0;
  for (const s of block.statements) {
    if (s.kind !== "assignment" || !s.value) continue;
    const text = scalarText(s.value);
    if (s.key.text === "texture" && text !== null) texture = text;
    else if (s.key.text === "parent" && text !== null) parent = text;
    else if (s.key.text === "mask" && s.value.kind === "block") {
      const n = numbers(s.value, vars);
      if (n.length === 1 && Number.isFinite(n[0])) mask = n[0];
    }
  }
  switch (kind) {
    case "colored_emblem":
      return {
        kind,
        texture,
        mask,
        colors: parseColors(block.statements, vars),
        instances: parseInstances(block.statements, vars),
      };
    case "textured_emblem":
      return { kind, texture, instances: parseInstances(block.statements, vars) };
    case "sub":
      return { kind, parent, instances: parseSubInstances(block.statements, vars) };
  }
  return null;
}

export function parseFlag(name: string, block: BlockNode, vars: Vars = new Map()): CoaFlag {
  const flag: CoaFlag = { name, pattern: "", colors: parseColors(block.statements, vars), layers: [] };
  for (const s of block.statements) {
    if (s.kind !== "assignment" || !s.value) continue;
    if (s.key.text === "pattern") flag.pattern = scalarText(s.value) ?? "";
    else if (s.value.kind === "block") {
      const layer = parseLayer(s.key.text, s.value, vars);
      if (layer) flag.layers.push(layer);
    }
  }
  return flag;
}

/**
 * Every flag in one coa file. `template` blocks are skipped (they are not
 * flags) and so is anything that is not `name = { }`.
 */
export function parseCoaFile(text: string): CoaFlag[] {
  const { root } = parseScript(text);
  const vars: Vars = new Map();
  const flags: CoaFlag[] = [];
  for (const s of root.statements) {
    if (s.kind !== "assignment" || !s.value) continue;
    if (s.key.text.startsWith("@")) {
      const text = scalarText(s.value);
      if (text !== null) {
        const n = resolveNumber(text, vars);
        if (Number.isFinite(n)) vars.set(s.key.text, n);
      }
      continue;
    }
    if (s.key.text === "template" || s.value.kind !== "block") continue;
    flags.push(parseFlag(s.key.text, s.value, vars));
  }
  return flags;
}

/** `colors = { name = hsv360 { } ... }` entries of a named_colors file, as rgb bytes. */
export function parseNamedColors(text: string): Record<string, Rgb> {
  const { root } = parseScript(text);
  const out: Record<string, Rgb> = {};
  for (const s of root.statements) {
    if (s.kind !== "assignment" || s.key.text !== "colors" || s.value?.kind !== "block") continue;
    for (const c of s.value.statements) {
      if (c.kind !== "assignment" || !c.value || c.value.kind === "scalar") continue;
      const color = parseColor(c.key.text, c.value, new Map());
      if (color) {
        const rgb = colorToRgb(color, {}, []);
        if (rgb) out[c.key.text] = rgb;
      }
    }
  }
  return out;
}

/**
 * Replace the top-level `name = { }` block in a coa file with `script`, or
 * append the script when the file has no such block. The rest of the file is
 * untouched (line endings, comments, other flags).
 */
export function upsertFlagInFile(text: string, name: string, script: string): string {
  const { root } = parseScript(text);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const body = script.replace(/\n/g, eol);
  for (const s of root.statements) {
    if (s.kind === "assignment" && s.key.text === name && s.value?.kind === "block") {
      return text.slice(0, s.range.start) + body + text.slice(s.range.end);
    }
  }
  const sep = text.length === 0 || text.endsWith("\n") ? "" : eol;
  return text + sep + eol + body + eol;
}
