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
import type { GuiLayoutNode, GuiLayoutResult, GuiVisibilityOptions } from "@px-lsp/protocol/protocol";
import { collectGuiDefs, emptyGuiDefs, mergeGuiDefs, type GuiDefs } from "./guiDefs";
import {
  calibratedMeasurer,
  computeGuiLayout,
  measurerFromMetrics,
  type LayoutEnv,
  type LayoutNode,
  type LayoutTiming,
  type VisibilityCheck,
} from "./layoutEngine";
import { collectScriptedGuiCalls, emptyGuiScriptLinks, type GuiScriptLinks } from "./guiLinks";
import { activeProfile } from "../games/active";

/**
 * The active game's measured layout environment, when its profile carries
 * probe results (GameProfile.guiTextMetrics / guiLayoutQuirks); undefined
 * falls back to the engine's calibrated defaults.
 */
export function profileMeasurer(): LayoutEnv | undefined {
  const { guiTextMetrics, guiLayoutQuirks } = activeProfile();
  if (!guiTextMetrics && !guiLayoutQuirks) return undefined;
  const base = guiTextMetrics ? measurerFromMetrics(guiTextMetrics) : calibratedMeasurer;
  return { ...base, ...guiLayoutQuirks };
}

/** Matches the game's UI reference resolution at 100% scaling. */
export const VIEWPORT = { w: 1920, h: 1080 };

let cache: { key: string; defs: GuiDefs; files: number; links: GuiScriptLinks } | null = null;

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
): { defs: GuiDefs; files: number; links: GuiScriptLinks } {
  // The stage prefix is part of the key: switching game changes which folder of
  // the same roots the store was built from.
  const stage = activeProfile().stageRoots?.[0] ?? "";
  const key = `${stage}|${engineRoots.join(";")}|${gamePath ?? ""}|${parentPaths.join(";")}|${modPath ?? ""}`;
  if (cache) {
    if (cache.key === key) return cache;
    cache = null;
  }

  // Effective file set: later roots win the same relative path (whole-file
  // replacement) — engine (jomini), vanilla, parent mods in load order, then the
  // mod — and FIOS applies across the sorted result.
  const effective = new Map<string, string>();
  // Content roots of a game with load-stage folders carry the stage prefix
  // (`in_game/gui/`); the engine layer next to the install never does, since it
  // is shared by every stage.
  const stagePrefix = stage ? [stage] : [];
  for (const root of engineRoots) {
    for (const [rel, abs] of listGuiFiles(path.join(root, "gui"))) effective.set(rel, abs);
  }
  for (const root of [gamePath, ...parentPaths, modPath]) {
    if (!root) continue;
    for (const [rel, abs] of listGuiFiles(path.join(root, ...stagePrefix, "gui"))) effective.set(rel, abs);
  }
  const defs = emptyGuiDefs();
  const links = emptyGuiScriptLinks();
  let files = 0;
  for (const rel of [...effective.keys()].sort()) {
    const abs = effective.get(rel)!;
    try {
      const text = fs.readFileSync(abs, "utf8");
      mergeGuiDefs(defs, collectGuiDefs(text, undefined, abs));
      // Piggybacked on the one pass that already reads every .gui file: the
      // scripted_gui call scan is a substring test on all but the few files
      // that hold one, so the link index is effectively free here and a
      // second walk of the tree would not be.
      collectScriptedGuiCalls(text, abs, links);
      files++;
    } catch {
      /* unreadable file: skip */
    }
  }
  cache = { key, defs, files, links };
  return cache;
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

/** The cross-file `GetScriptedGui(...)` call index (cached with the store). */
export function getGuiScriptLinks(
  gamePath: string | null,
  modPath: string | null,
  parentPaths: string[] = [],
  engineRoots: string[] = []
): GuiScriptLinks {
  return buildStore(gamePath, modPath, parentPaths, engineRoots).links;
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
  engineRoots: string[] = [],
  visibility?: GuiVisibilityOptions,
  /** Loc/datafunction resolution for textboxes; absent = raw `text =` values. */
  resolveText?: LayoutEnv["resolveText"]
): GuiLayoutResult {
  const t0 = performance.now();
  const { defs, files } = buildStore(gamePath, modPath, parentPaths, engineRoots);
  const defsMs = performance.now() - t0;
  const checks = new Map<string, VisibilityCheck>();
  const timing: LayoutTiming = { parseMs: 0, layoutMs: 0 };
  const nodes = computeGuiLayout(text, {
    defs,
    viewport: VIEWPORT,
    visibility,
    checks,
    timing,
    measurer: resolveText ? { ...(profileMeasurer() ?? calibratedMeasurer), resolveText } : profileMeasurer(),
  });
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
    visibilityChecks: [...checks.values()].sort((a, b) => a.key.localeCompare(b.key)),
    timings: {
      parseMs: timing.parseMs,
      defsMs,
      layoutMs: timing.layoutMs,
      totalMs: performance.now() - t0,
    },
  };
}
