/**
 * Recursive file listing shared by the server indexer and client-side
 * reference scans. No `vscode` imports.
 */
import * as fs from "fs";
import * as path from "path";

/** All files under `dir` (recursive) with the given extension (lowercase match). */
export function listFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  walkDir(dir, ext, out);
  return out;
}

export function walkDir(dir: string, ext: string, out: string[]): void {
  // One visited-target set per walk: shared across sibling links so two links
  // to the same tree cannot index it twice. walkDir runs once per schema folder
  // (tens of times per root), never per directory, so the Set is free.
  walk(dir, ext, out, new Set<string>());
}

function walk(dir: string, ext: string, out: string[], visited: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    // Dot-directories (.git, .claude worktrees, …) are never game content and
    // can hold stale copies of the whole mod — indexing them pollutes results.
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, out, visited);
    else if (entry.isFile()) {
      if (entry.name.toLowerCase().endsWith(ext)) out.push(full);
    } else if (entry.isSymbolicLink()) followLink(full, ext, out, visited);
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
 * outright, and every followed target is remembered for the rest of the walk.
 */
function followLink(full: string, ext: string, out: string[], visited: Set<string>): void {
  let target: fs.Stats;
  let real: string;
  try {
    target = fs.statSync(full); // follows the link; throws when dangling
    real = fs.realpathSync(full);
  } catch {
    return; // dangling or unreadable link indexes nothing
  }
  if (target.isFile()) {
    if (path.basename(full).toLowerCase().endsWith(ext)) out.push(full);
    return;
  }
  if (!target.isDirectory()) return;

  let host: string;
  try {
    host = fs.realpathSync(path.dirname(full));
  } catch {
    return;
  }
  if (isSameOrBelow(real, host)) return; // points back into the tree being walked

  const key = norm(real);
  if (visited.has(key)) return;
  visited.add(key);
  walk(full, ext, out, visited);
}
