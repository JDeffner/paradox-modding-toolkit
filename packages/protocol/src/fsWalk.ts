/**
 * Recursive file listing shared by the server indexer and client-side
 * reference scans. No `vscode` imports.
 */
import * as fs from "fs";
import * as path from "path";

/**
 * Directory entries between two `null` ticks from `iterFiles`. Measured walk
 * throughput on a real tree is 4.2k entries/s cold and 29k/s warm, so 500
 * entries is tens of milliseconds of blocking at worst.
 */
export const WALK_TICK = 500;

/**
 * Every file under `dir` (recursive) with the given extension (lowercase
 * match), yielded as it is found, plus a `null` every WALK_TICK entries
 * VISITED.
 *
 * The nulls are what lets an async caller pace the listing: a subtree with no
 * match in it at all (a mod's `gfx/` under a `.txt` scan) still costs one
 * readdirSync per directory, so a caller handed only paths would have nothing
 * to pace itself against and would block for the whole traversal.
 */
export function* iterFiles(dir: string, ext: string): Generator<string | null> {
  yield* iterFilesInRoots([dir], ext);
}

/** Visit roots in priority order, sharing canonical-directory deduplication.
 * A caller can put semantic folders before a containing fallback root so an
 * alias that supplies the folder's meaning keeps its logical path. */
export function* iterFilesInRoots(dirs: readonly string[], ext: string): Generator<string | null> {
  const visited = new Set<string>();
  const tick = { count: 0 };
  for (const dir of dirs) {
    let real: string;
    try {
      real = fs.realpathSync(dir);
    } catch {
      continue;
    }
    const links: Array<{ full: string; host: string }> = [];
    // Within each root, ordinary paths win over aliases. Deferred links then
    // use sorted DFS encounter order, so sibling aliases have a stable winner.
    // Keep dir as the logical root, even when the configured root is itself a link.
    yield* walk(dir, real, ext, visited, tick, links);
    for (let i = 0; i < links.length; i++) {
      // Resolving a long deferred-link queue also does filesystem work, even if
      // every target was already visited and contributes no directory entries.
      if (++tick.count % WALK_TICK === 0) yield null;
      yield* followLink(links[i].full, links[i].host, ext, visited, tick, links);
    }
  }
}

/** All files under `dir` (recursive) with the given extension (lowercase match). */
export function listFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  walkDir(dir, ext, out);
  return out;
}

export function walkDir(dir: string, ext: string, out: string[]): void {
  for (const file of iterFiles(dir, ext)) {
    if (file !== null) out.push(file);
  }
}

function* walk(
  dir: string,
  real: string,
  ext: string,
  visited: Set<string>,
  tick: { count: number },
  links: Array<{ full: string; host: string }>
): Generator<string | null> {
  const key = norm(real);
  if (visited.has(key)) return;
  visited.add(key);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    // Dot-directories (.git, .claude worktrees, …) are never game content and
    // can hold stale copies of the whole mod — indexing them pollutes results.
    if (entry.name.startsWith(".")) continue;
    if (++tick.count % WALK_TICK === 0) yield null;
    const full = path.join(dir, entry.name);
    // An ordinary child of a canonical directory needs no additional realpath.
    if (entry.isDirectory()) yield* walk(full, path.join(real, entry.name), ext, visited, tick, links);
    else if (entry.isFile()) {
      if (entry.name.toLowerCase().endsWith(ext)) yield full;
    } else if (entry.isSymbolicLink()) links.push({ full, host: real });
  }
}

/** Case-folded on Windows, trailing separator stripped. */
function norm(p: string): string {
  const n = process.platform === "win32" ? p.toLowerCase() : p;
  return n.replace(/[\\/]+$/, "");
}

/** True when `inner` is `outer` itself or sits below it. */
function isSameOrBelow(outer: string, inner: string): boolean {
  const a = norm(outer);
  const b = norm(inner);
  return b === a || b.startsWith(a + path.sep);
}

/**
 * A Dirent reports a symlink as neither file nor directory, so links need an
 * explicit stat. Following them is not optional: symlinking a mod into the
 * Paradox `mod/` folder is the standard Linux workflow, and Windows junctions
 * do the same for a redirected Documents folder. Entries keep the LINK path so
 * definitions stay attributed to the root the user configured.
 *
 * Two guards keep a malformed tree from looping or double-indexing: a link
 * resolving to the directory it sits in (or one of its ancestors) is skipped
 * outright, and every visited directory is remembered for the rest of the walk.
 */
function* followLink(
  full: string,
  host: string,
  ext: string,
  visited: Set<string>,
  tick: { count: number },
  links: Array<{ full: string; host: string }>
): Generator<string | null> {
  let target: fs.Stats;
  let real: string;
  try {
    target = fs.statSync(full); // follows the link; throws when dangling
    real = fs.realpathSync(full);
  } catch {
    return; // dangling or unreadable link indexes nothing
  }
  if (target.isFile()) {
    if (path.basename(full).toLowerCase().endsWith(ext)) yield full;
    return;
  }
  if (!target.isDirectory()) return;

  if (isSameOrBelow(real, host)) return; // points back into the tree being walked
  yield* walk(full, real, ext, visited, tick, links);
}
