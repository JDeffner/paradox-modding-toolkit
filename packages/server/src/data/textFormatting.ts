/**
 * Loc text-formatting tag harvest: `#G`, `#bold`, … tags come from
 * `textformatting = { format = { name = G format = "color:{0,1,0}" } … }`
 * blocks in .gui files. Layers in load order: jomini
 * (gui/jomini/basetextformatting.gui base set), game (gui/**), then the mod.
 *
 * Resolution is gui FIOS (AGENTS.md): the FIRST-loaded definition of a name
 * wins, and `override = no` (the base set's default) confirms that; a later
 * definition only replaces it with `override = yes`. So the jomini base `G`
 * (green, override=no) is NOT clobbered by game's `G` (which sets no override) —
 * matching the engine and the Paradox modding convention (a mod overrides a base
 * format with `override = yes`). Callers must addLayer in load order.
 *
 * Aliases chain (`I` → `instruction` → `G;italic` → G's color); the resolved
 * [r,g,b] is the first `color:{r,g,b}` reached along the chain (0..1 floats).
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import { LineIndex, parseScript, type BlockNode } from "../parser";
import { listFiles } from "@px-lsp/protocol/fsWalk";
import * as path from "path";

export type FormatLayer = "jomini" | "game" | "mod" | "builtin";

export interface FormatEntry {
  name: string;
  /** The raw `format = "…"` string (empty for style-only tags like editor_formatting). */
  format: string;
  file: string;
  line: number; // 0-based
  layer: FormatLayer;
}

export type Rgb = [number, number, number];

export interface FormatResolution {
  /** Names visited resolving the tag, e.g. ["I","instruction","G","italic"]. */
  chain: string[];
  /** First color reached (0..1 floats), or null for style-only / unknown tags. */
  rgb: Rgb | null;
}

/**
 * Engine-native formats referenced by the harvested format strings but never
 * declared as `format` blocks: the style primitives the format-string grammar
 * uses. Included so completion/hover recognize `#bold`, `#italic`.
 */
const ENGINE_BUILTINS = ["bold", "italic"];

/** Parse `color:{r,g,b}` (0..1 floats, space/comma separated) → [r,g,b]. */
function parseColor(segment: string): Rgb | null {
  const m = /^color\s*:\s*\{\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*\}$/.exec(segment.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export class TextFormattingIndex {
  /** name -> the FIOS winner (first loaded, unless a later `override = yes`). */
  private byName = new Map<string, FormatEntry>();

  constructor() {
    for (const name of ENGINE_BUILTINS) {
      this.byName.set(name, { name, format: "", file: "", line: 0, layer: "builtin" });
    }
  }

  /** Harvest every .gui file under `root/gui` whose text mentions `textformatting`. */
  addLayer(root: string, layer: FormatLayer): void {
    for (const file of listFiles(path.join(root, "gui"), ".gui").sort()) {
      let text: string;
      try {
        text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
      } catch {
        continue;
      }
      if (!text.includes("textformatting")) continue; // cheap prefilter
      this.harvestText(text, file, layer);
    }
  }

  harvestText(text: string, file: string, layer: FormatLayer): void {
    const { root } = parseScript(text);
    const lines = new LineIndex(text);
    for (const stmt of root.statements) {
      if (stmt.kind !== "assignment" || stmt.key.text.toLowerCase() !== "textformatting") continue;
      if (stmt.value?.kind !== "block") continue;
      this.harvestBlock(stmt.value, file, layer, lines);
    }
  }

  private harvestBlock(block: BlockNode, file: string, layer: FormatLayer, lines: LineIndex): void {
    for (const stmt of block.statements) {
      if (stmt.kind !== "assignment" || stmt.key.text.toLowerCase() !== "format") continue;
      if (stmt.value?.kind !== "block") continue;
      let name: string | null = null;
      let format = "";
      let nameLine = 0;
      let override = false; // FIOS default (absent / `override = no`)
      for (const inner of stmt.value.statements) {
        if (inner.kind !== "assignment" || inner.value?.kind !== "scalar") continue;
        const key = inner.key.text.toLowerCase();
        if (key === "name") {
          name = inner.value.text;
          nameLine = lines.positionAt(inner.key.range.start).line;
        } else if (key === "format") {
          format = inner.value.text;
        } else if (key === "override") {
          override = inner.value.text.toLowerCase() === "yes";
        }
      }
      if (name === null) continue;
      // FIOS: keep the first definition unless this one explicitly overrides.
      if (this.byName.has(name) && !override) continue;
      this.byName.set(name, { name, format, file, line: nameLine, layer });
    }
  }

  /** Winning entry for a tag name, or null when unknown. */
  winner(name: string): FormatEntry | null {
    return this.byName.get(name) ?? null;
  }

  names(): string[] {
    return [...this.byName.keys()].sort();
  }

  /** Follow the alias chain, collecting the visited names and the first color. */
  resolve(name: string): FormatResolution {
    const chain: string[] = [];
    const seen = new Set<string>();
    let rgb: Rgb | null = null;
    const visit = (n: string): void => {
      if (seen.has(n)) return;
      seen.add(n);
      chain.push(n);
      const entry = this.winner(n);
      if (!entry) return; // builtin / unknown leaf
      for (const seg of entry.format
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)) {
        const color = parseColor(seg);
        if (color) {
          if (!rgb) rgb = color;
          continue;
        }
        visit(seg);
      }
    };
    visit(name);
    return { chain, rgb };
  }

  get count(): number {
    return this.byName.size;
  }
}

/** Format a 0..1 rgb triple as `rgb(0, 255, 0)` (0..255 ints) for docs. */
export function rgbCss(rgb: Rgb): string {
  const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${to255(rgb[0])}, ${to255(rgb[1])}, ${to255(rgb[2])})`;
}
