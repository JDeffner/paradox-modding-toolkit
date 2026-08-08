/**
 * tiger `load_mod` blocks: dependency mods (px.parentMods + other workspace
 * mods) declared in the conf so tiger resolves their definitions instead of
 * reporting them unknown (Discord report, 2026-08-04).
 *
 * The key is per game family, matching tiger's conf grammar: `.mod`-descriptor
 * games (CK3) take `modfile = "<dir>/descriptor.mod"` — tiger special-cases a
 * descriptor.mod path to mean its own directory — while `.metadata` games
 * (Vic3) take `mod = "<dir>"`. Paths use forward slashes, as tiger asks.
 *
 * No vscode imports: unit-tested directly.
 */
import * as fs from "fs";
import * as path from "path";

export interface LoadModBlocks {
  /** Conf text ("" when no dependency survived), one `load_mod` block per mod. */
  conf: string;
  /** Roots that produced a block, in load order. */
  loaded: string[];
  /** Roots dropped because the path (or its descriptor.mod) does not exist. */
  skipped: string[];
}

/** Trailing-separator-free lowercase key, mirroring config.ts's path identity. */
function normKey(p: string): string {
  return p.replace(/[\\/]+$/, "").toLowerCase();
}

const fwd = (p: string): string => p.replace(/\\/g, "/");

/**
 * Render `load_mod` blocks for validating the mod at `modRoot`, given the
 * resolved dependency roots (cfg.parentPaths: load order, base first).
 * `modRoot` itself is excluded — a mod is not its own dependency.
 */
export function renderLoadModBlocks(
  descriptor: "mod" | "metadata",
  parentPaths: string[],
  modRoot: string
): LoadModBlocks {
  const self = normKey(modRoot);
  const seen = new Set<string>();
  const loaded: string[] = [];
  const skipped: string[] = [];
  const blocks: string[] = [];
  for (const dir of parentPaths) {
    const key = normKey(dir);
    if (key === self || seen.has(key)) continue;
    seen.add(key);
    const target = descriptor === "mod" ? path.join(dir, "descriptor.mod") : dir;
    if (!fs.existsSync(target)) {
      skipped.push(dir);
      continue;
    }
    blocks.push(
      [
        "load_mod = {",
        `\tlabel = "${path.basename(dir)}"`,
        descriptor === "mod" ? `\tmodfile = "${fwd(target)}"` : `\tmod = "${fwd(dir)}"`,
        "}",
      ].join("\n")
    );
    loaded.push(dir);
  }
  return { conf: blocks.length > 0 ? blocks.join("\n") + "\n" : "", loaded, skipped };
}
