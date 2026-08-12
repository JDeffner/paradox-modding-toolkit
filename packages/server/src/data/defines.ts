/**
 * Engine defines harvest: `define:NNamespace|CONSTANT` references (grep-verified
 * pipe separator) resolve against top-level namespace blocks in
 * `common/defines/**\/*.txt`. Layers lowest→highest priority: jomini (6 files
 * exist only here), game (00_defines.txt + ai/audio/graphic/jomini subdirs),
 * read-only dependency parents, then the mod. Last-wins per (namespace,
 * constant).
 *
 * In-memory only — a few thousand entries; NOT persisted into the vanillaIndex
 * cache. No `vscode` imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";
import { LineIndex, parseScript, type ValueNode } from "../parser";
import { walkDir } from "@px-lsp/protocol/fsWalk";

export type DefineLayer = "jomini" | "game" | "parent" | "mod";

const LAYER_RANK: Record<DefineLayer, number> = { jomini: 0, game: 1, parent: 2, mod: 3 };

export interface DefineEntry {
  namespace: string;
  name: string;
  /** Rendered value: the scalar text, or a collapsed `{ … }` for block values. */
  value: string;
  file: string;
  line: number; // 0-based
  layer: DefineLayer;
}

export interface DefineResolution {
  winner: DefineEntry;
  /** Lower-priority entries the winner shadows, highest-priority first. */
  shadowed: DefineEntry[];
}

/** Scalar text, or a whitespace-collapsed `{ … }` rendering for block values. */
function renderValue(text: string, value: ValueNode): string {
  if (value.kind === "scalar") return value.quoted ? `"${value.text}"` : value.text;
  const raw = text.slice(value.range.start, value.range.end);
  const collapsed = raw
    .replace(/#[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return collapsed.length > 200 ? collapsed.slice(0, 199) + "…" : collapsed;
}

export class DefinesIndex {
  /** namespace -> constant -> entries in ascending priority (winner last). */
  private ns = new Map<string, Map<string, DefineEntry[]>>();

  /** Harvest one root's `common/defines` tree at the given layer. */
  addLayer(root: string, layer: DefineLayer): void {
    const files: string[] = [];
    walkDir(path.join(root, "common", "defines"), ".txt", files);
    for (const file of files.sort()) {
      let text: string;
      try {
        text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
      } catch {
        continue;
      }
      this.harvestText(text, file, layer);
    }
  }

  /** Parse one defines file: top-level blocks are namespaces, their scalars constants. */
  harvestText(text: string, file: string, layer: DefineLayer): void {
    const { root } = parseScript(text);
    const lines = new LineIndex(text);
    for (const stmt of root.statements) {
      if (stmt.kind !== "assignment" || stmt.key.quoted) continue;
      const block = stmt.value;
      if (!block || block.kind !== "block") continue;
      const namespace = stmt.key.text;
      let consts = this.ns.get(namespace);
      if (!consts) this.ns.set(namespace, (consts = new Map()));
      for (const inner of block.statements) {
        if (inner.kind !== "assignment" || inner.key.quoted || inner.value === null) continue;
        const name = inner.key.text;
        const entry: DefineEntry = {
          namespace,
          name,
          value: renderValue(text, inner.value),
          file,
          line: lines.positionAt(inner.key.range.start).line,
          layer,
        };
        let list = consts.get(name);
        if (!list) consts.set(name, (list = []));
        list.push(entry);
        // Stable sort keeps same-layer insertion order; winner is the last entry.
        list.sort((a, b) => LAYER_RANK[a.layer] - LAYER_RANK[b.layer]);
      }
    }
  }

  namespaces(): string[] {
    return [...this.ns.keys()].sort();
  }

  /** Winning constants of a namespace, name-sorted. */
  constants(namespace: string): DefineEntry[] {
    const consts = this.ns.get(namespace);
    if (!consts) return [];
    return [...consts.values()]
      .map((list) => list[list.length - 1])
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  resolve(namespace: string, name: string): DefineResolution | null {
    const list = this.ns.get(namespace)?.get(name);
    if (!list || list.length === 0) return null;
    return { winner: list[list.length - 1], shadowed: list.slice(0, -1).reverse() };
  }

  /** Winning-constant count across all namespaces (status log line). */
  get count(): number {
    let n = 0;
    for (const consts of this.ns.values()) n += consts.size;
    return n;
  }
}
