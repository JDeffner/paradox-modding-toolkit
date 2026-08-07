/**
 * Which roots the client wires a recursive FileSystemWatcher on
 * (perf campaign §B5).
 *
 * The naive list is `[modPath, ...parentPaths]`, and config.ts pushes every
 * workspace mod into `parentPaths`, so a 20-mod workspace wired ~21 recursive
 * watchers per window — and the worst field report had ~30 windows open. Every
 * watcher on a nested root is pure duplication: the enclosing root's recursive
 * glob already reports the same file, and the server then re-parses it once per
 * watcher that fired.
 *
 * Rules: compare case-insensitively (Windows) with trailing separators
 * ignored, drop a root that lives inside another root, and never watch under
 * the game install (vanilla is read-only context, and the tree is ~100k files).
 *
 * String comparison only. A junction or symlink that mounts the same tree at a
 * second path stays two roots and gets two watchers: resolving real paths would
 * fold them together, but the events would then arrive under the resolved path
 * instead of the root the server indexed those files under.
 *
 * No `vscode` import here: the planning is unit-tested in plain Node.
 */
import * as path from "path";

/** Trailing-separator-free, lowercase, normalized key for path comparisons. */
function normKey(p: string): string {
  return path
    .normalize(p)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

function isUnder(child: string, ancestor: string): boolean {
  return child === ancestor || child.startsWith(ancestor + path.sep);
}

/** The distinct top-level roots of `roots`, in input order. */
export function planWatchRoots(
  roots: ReadonlyArray<string | null | undefined>,
  gamePath?: string | null
): string[] {
  const candidates: Array<{ root: string; key: string }> = [];
  const seen = new Set<string>();
  const gameKey = gamePath ? normKey(gamePath) : null;
  for (const root of roots) {
    if (!root) continue;
    const key = normKey(root);
    if (key === "" || seen.has(key)) continue;
    if (gameKey && isUnder(key, gameKey)) continue;
    seen.add(key);
    candidates.push({ root, key });
  }
  // Shortest first: an ancestor is always shorter than what it contains, so one
  // pass against what is already kept is enough.
  const byDepth = [...candidates].sort((a, b) => a.key.length - b.key.length);
  const kept = new Set<string>();
  for (const { key } of byDepth) {
    if ([...kept].some((k) => isUnder(key, k))) continue;
    kept.add(key);
  }
  return candidates.filter((c) => kept.has(c.key)).map((c) => c.root);
}
