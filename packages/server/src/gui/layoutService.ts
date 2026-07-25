/**
 * paradox/guiLayout request backend: lazily builds the cross-file template/type
 * store from the vanilla + mod gui trees (FIOS: path-sorted, first definition
 * wins; a mod file replaces the vanilla file at the same relative path), then
 * runs the measured layout engine over the requested document.
 *
 * The store build costs ~200ms over the full vanilla tree and is cached per
 * (gamePath, modPath) pair; mod .gui edits re-collect only the mod side.
 */
import * as fs from "fs";
import * as path from "path";
import type { GuiLayoutNode, GuiLayoutResult } from "@px-lsp/protocol/protocol";
import { collectGuiDefs, emptyGuiDefs, mergeGuiDefs, type GuiDefs } from "./guiDefs";
import { computeGuiLayout, type LayoutNode } from "./layoutEngine";

/** Matches the game's UI reference resolution at 100% scaling. */
const VIEWPORT = { w: 1920, h: 1080 };

let cache: { key: string; defs: GuiDefs; files: number } | null = null;

function listGuiFiles(root: string): Map<string, string> {
  // relative path (lowercased, forward slashes) -> absolute path
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith(".gui")) {
        out.set(path.relative(root, p).toLowerCase().replace(/\\/g, "/"), p);
      }
    }
  };
  walk(root);
  return out;
}

function buildStore(
  gamePath: string | null,
  modPath: string | null,
  parentPaths: string[],
  engineRoots: string[]
): { defs: GuiDefs; files: number } {
  const key = `${engineRoots.join(";")}|${gamePath ?? ""}|${parentPaths.join(";")}|${modPath ?? ""}`;
  if (cache && cache.key === key) return { defs: cache.defs, files: cache.files };

  // Effective file set: later roots win the same relative path (whole-file
  // replacement) — engine (jomini), vanilla, parent mods in load order, then the
  // mod — and FIOS applies across the sorted result.
  const effective = new Map<string, string>();
  for (const root of [...engineRoots, gamePath, ...parentPaths, modPath]) {
    if (!root) continue;
    for (const [rel, abs] of listGuiFiles(path.join(root, "gui"))) effective.set(rel, abs);
  }
  const defs = emptyGuiDefs();
  let files = 0;
  for (const rel of [...effective.keys()].sort()) {
    const abs = effective.get(rel)!;
    try {
      mergeGuiDefs(defs, collectGuiDefs(fs.readFileSync(abs, "utf8"), undefined, abs));
      files++;
    } catch {
      /* unreadable file: skip */
    }
  }
  cache = { key, defs, files };
  return { defs, files };
}

/** The cross-file template/type store (cached), for navigation and hover. */
export function getGuiDefs(
  gamePath: string | null,
  modPath: string | null,
  parentPaths: string[] = [],
  engineRoots: string[] = []
): GuiDefs {
  return buildStore(gamePath, modPath, parentPaths, engineRoots).defs;
}

/** Drop the cached store (mod .gui saved, settings changed). */
export function invalidateGuiDefsCache(): void {
  cache = null;
}

export function computeGuiLayoutResult(
  text: string,
  gamePath: string | null,
  modPath: string | null,
  parentPaths: string[] = [],
  engineRoots: string[] = []
): GuiLayoutResult {
  const { defs, files } = buildStore(gamePath, modPath, parentPaths, engineRoots);
  const nodes = computeGuiLayout(text, { defs, viewport: VIEWPORT });
  const textures = new Set<string>();
  let nodeCount = 0;
  const visit = (n: LayoutNode): void => {
    nodeCount++;
    if (n.bg?.texture) textures.add(n.bg.texture);
    if (n.fill?.texture) textures.add(n.fill.texture);
    for (const c of n.children) visit(c);
  };
  for (const n of nodes) visit(n);
  return {
    // LayoutNode is structurally identical to the wire type.
    nodes: nodes as unknown as GuiLayoutNode[],
    textures: [...textures].sort(),
    nodeCount,
    defsFiles: files,
  };
}
