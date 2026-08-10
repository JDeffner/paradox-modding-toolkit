/**
 * §B5: one recursive FileSystemWatcher per DISTINCT TOP-LEVEL root. The naive
 * `[modPath, ...parentPaths]` wired one per workspace mod (config.ts pushes
 * every workspace mod into parentPaths), and each redundant watcher costs the
 * OS a recursive subscription and the server one extra parse per file change.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { planWatchRoots } from "../src/watchRoots";

const p = (...parts: string[]) => path.join(...parts);

describe("planWatchRoots", () => {
  it("keeps distinct sibling roots, in input order", () => {
    const roots = [p("D:", "mods", "a"), p("D:", "mods", "b"), p("E:", "other")];
    expect(planWatchRoots(roots)).toEqual(roots);
  });

  it("drops empty entries and exact duplicates, case- and separator-insensitively", () => {
    expect(
      planWatchRoots([
        p("D:", "mods", "a"),
        null,
        "",
        p("D:", "MODS", "A") + path.sep,
        undefined,
        p("D:", "mods", "a"),
      ])
    ).toEqual([p("D:", "mods", "a")]);
  });

  it("drops a root nested in another root, whichever order they arrive in", () => {
    const outer = p("D:", "mods");
    const inner = p("D:", "mods", "submod");
    expect(planWatchRoots([outer, inner])).toEqual([outer]);
    expect(planWatchRoots([inner, outer])).toEqual([outer]);
    // A sibling whose name merely starts the same way is NOT nested.
    expect(planWatchRoots([outer, p("D:", "mods-backup")])).toEqual([outer, p("D:", "mods-backup")]);
  });

  it("never watches the game install or anything inside it", () => {
    const game = p("F:", "SteamLibrary", "steamapps", "common", "Crusader Kings III", "game");
    const mod = p("D:", "mods", "a");
    expect(planWatchRoots([mod, game, p(game, "common")], game)).toEqual([mod]);
  });

  it("collapses a 20-mod workspace under one container to a single watcher", () => {
    const container = p("D:", "Documents", "Paradox Interactive", "Crusader Kings III", "mod");
    const mods = Array.from({ length: 20 }, (_, i) => p(container, `mod${i}`));
    expect(planWatchRoots([mods[0], ...mods.slice(1), container])).toEqual([container]);
    // Without the container in the list they stay distinct top-level roots.
    expect(planWatchRoots(mods)).toHaveLength(20);
  });

  it("does NOT fold a junction that mounts the same tree twice (documented §B5 caveat)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "px-watchroots-"));
    try {
      const real = path.join(tmp, "real");
      fs.mkdirSync(real);
      const link = path.join(tmp, "mounted");
      fs.symlinkSync(real, link, "junction");
      // String comparison only: the events of a resolved root would arrive
      // under a path the server never indexed those files under.
      expect(planWatchRoots([real, link])).toEqual([real, link]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
