/**
 * §C3: the activation-time warning for a workspace that costs gigabytes per
 * window. It must fire on both field recipes (the game mounted several times
 * plus ~20 mods, and the game plus a total conversion twice) and stay silent on
 * an ordinary single-mod workspace.
 */
import { afterAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  FILE_THRESHOLD,
  bigWorkspaceWarning,
  countScriptFiles,
  indexedModRoots,
  measureWorkspace,
  type WorkspaceSize,
} from "../src/bigWorkspace";

const tmpRoots: string[] = [];

function modTree(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "px-bigws-"));
  tmpRoots.push(root);
  for (const rel of files) {
    const full = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "x");
  }
  return root;
}

afterAll(() => {
  for (const root of tmpRoots) fs.rmSync(root, { recursive: true, force: true });
});

const cfgOf = (roots: string[], gamePath: string | null = "D:/CK3/game") => ({
  modPath: roots[0] ?? null,
  workspaceMods: roots.slice(1),
  // The client mirrors every workspace mod into parentPaths (config.ts).
  parentPaths: roots.slice(1),
  gamePath,
});

describe("indexedModRoots", () => {
  it("counts each root once and never counts the game", () => {
    const roots = indexedModRoots(cfgOf([path.join("D:", "a"), path.join("D:", "b")]));
    expect(roots).toEqual([path.join("D:", "a"), path.join("D:", "b")]);
  });

  it("folds case and trailing separators, and tolerates no mod at all", () => {
    expect(
      indexedModRoots({
        modPath: null,
        workspaceMods: [path.join("D:", "Mods", "A")],
        parentPaths: [path.join("D:", "mods", "a") + path.sep, path.join("D:", "CK3", "game")],
        gamePath: path.join("D:", "ck3", "GAME"),
      })
    ).toEqual([path.join("D:", "Mods", "A")]);
  });
});

describe("countScriptFiles", () => {
  it("counts script files, ignores everything else and dot-directories", () => {
    const root = modTree([
      "descriptor.mod",
      "events/a.txt",
      "events/b.txt",
      "localization/english/a_l_english.yml",
      "gfx/portraits/p.dds",
      ".git/objects/pack.txt",
    ]);
    expect(countScriptFiles([root], 1000)).toEqual({ files: 3, partial: false });
  });

  it("stops at the cap instead of walking a total conversion out", () => {
    const files: string[] = [];
    for (let i = 0; i < 12; i++) files.push(`events/e${i}.txt`);
    const root = modTree(files);
    expect(countScriptFiles([root], 5)).toEqual({ files: 5, partial: true });
  });

  it("stops on entries visited too, not only on files matched", () => {
    // A tree with no script files at all: the file cap can never fire, so
    // without an entry bound this walks the whole thing on the activation path.
    const files: string[] = [];
    for (let i = 0; i < 40; i++) files.push(`gfx/portraits/p${i}.dds`);
    const root = modTree(files);
    expect(countScriptFiles([root], 2)).toEqual({ files: 0, partial: true });
  });

  it("contributes nothing for a root that does not exist", () => {
    expect(countScriptFiles([path.join("D:", "nope", "gone")], 10)).toEqual({ files: 0, partial: false });
  });
});

describe("bigWorkspaceWarning", () => {
  const size = (roots: number, files: number | null, partial = false): WorkspaceSize => ({
    roots: Array.from({ length: roots }, (_, i) => path.join("D:", `mod${i}`)),
    files,
    partial,
  });

  it("fires on recipe 1: the game mounted 3x plus 20 mods", () => {
    // 20 mods + 3 vanilla mounts wired as parent roots.
    const warning = bigWorkspaceWarning(size(23, null), "manual");
    expect(warning).toContain("23 mod roots");
    expect(warning).toContain("px.excludedMods");
    expect(warning).not.toContain("tigerRunOn"); // already manual: nothing to change
  });

  it("fires on recipe 2: three roots holding a total conversion twice", () => {
    const warning = bigWorkspaceWarning(size(3, FILE_THRESHOLD, true), "save");
    expect(warning).toContain("3 mod roots");
    expect(warning).toContain(`${FILE_THRESHOLD}+ script files`);
    expect(warning).toContain("px.excludedMods");
    // The setting is named, never overridden: it ships as "manual", so a
    // workspace on "save" was put there deliberately (§C3).
    expect(warning).toContain("px.tigerRunOn");
  });

  it("is silent on an ordinary single-mod workspace", () => {
    expect(bigWorkspaceWarning(size(1, 420), "save")).toBeNull();
    // One total conversion (AGOT: 5,940 script files) still fits in a window.
    expect(bigWorkspaceWarning(size(1, 5940), "save")).toBeNull();
  });
});

describe("measureWorkspace", () => {
  it("does not walk the trees when the root count already decided", () => {
    const roots: string[] = [];
    for (let i = 0; i < 8; i++) roots.push(modTree(["events/a.txt"]));
    const measured = measureWorkspace(cfgOf(roots));
    expect(measured.roots).toHaveLength(8);
    expect(measured.files).toBeNull();
    expect(bigWorkspaceWarning(measured, "manual")).toContain("8 mod roots");
  });

  it("measures a single-mod workspace exactly, and stays silent", () => {
    const root = modTree(["descriptor.mod", "events/a.txt", "common/scripted_effects/e.txt"]);
    const measured = measureWorkspace(cfgOf([root]));
    expect(measured).toEqual({ roots: [root], files: 2, partial: false });
    expect(bigWorkspaceWarning(measured, "save")).toBeNull();
  });

  it("reports a floor once a root passes the cap", () => {
    const files: string[] = [];
    for (let i = 0; i < 10; i++) files.push(`events/e${i}.txt`);
    const measured = measureWorkspace(cfgOf([modTree(files)], null), 4);
    expect(measured.partial).toBe(true);
    expect(measured.files).toBe(4);
  });
});
