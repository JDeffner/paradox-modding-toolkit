/**
 * Activation-time big-workspace warning (perf campaign §C3). No `vscode`
 * imports: unit-tested in plain Node.
 *
 * The two workspaces the field reports describe are the game mounted several
 * times plus ~20 mods (many roots, each small) and the game plus one total
 * conversion twice (three roots, 11,880 script files). Both cost gigabytes:
 * measured post-GC, the second one retains 1412 MB of index in the server,
 * ~2 GB RSS, and EVERY VS Code window forks its own server. So the cost is
 * k x that for k windows, against a per-server ceiling of 4096 MB
 * (serverHeap.ts) and whatever physical memory the machine has. One report had
 * 30 windows open.
 *
 * Neither shape is something the extension can index cheaply, so the honest
 * move is to tell the user which knobs exist before the machine swaps:
 * `px.excludedMods` drops mods from indexing entirely, and `px.tigerRunOn`
 * decides whether every save also spawns a validator process.
 *
 * `px.tigerRunOn` is NOT degraded automatically above the threshold. It already
 * ships defaulting to "manual", so a workspace that runs tiger on save has been
 * switched there deliberately, and silently ignoring a setting the user chose
 * is worse than naming it. Tiger also runs out of process: it competes for CPU,
 * not for the server's heap, which is what this warning is about.
 */
import * as fs from "fs";
import * as path from "path";

/** Roots past which one window's index stops being an ordinary workspace. */
export const ROOT_THRESHOLD = 6;
/**
 * Script files (.txt/.yml) past which the same is true, whatever the root
 * count. Set above ONE total conversion (AGOT is 5,940 files and fits in a
 * window at ~1.5 GB) and below two of them, which is the recipe that does not.
 */
export const FILE_THRESHOLD = 10_000;

export interface WorkspaceSize {
  /** Distinct indexed mod roots (the game is not one of them). */
  roots: string[];
  /** Script files under those roots, or null when the roots alone decided it. */
  files: number | null;
  /** True when counting stopped at the cap, i.e. `files` is a floor. */
  partial: boolean;
}

/**
 * The distinct roots the server will index, game excluded: modPath, the other
 * workspace mods, and the parent mods (which is also where a workspace mod
 * mounted as a dependency, or the game mounted as a "parent", shows up).
 */
export function indexedModRoots(cfg: {
  modPath: string | null;
  workspaceMods: string[];
  parentPaths: string[];
  gamePath: string | null;
}): string[] {
  const norm = (p: string) =>
    path
      .normalize(p)
      .replace(/[\\/]+$/, "")
      .toLowerCase();
  const seen = new Set<string>();
  if (cfg.gamePath) seen.add(norm(cfg.gamePath));
  const roots: string[] = [];
  for (const p of [cfg.modPath, ...cfg.workspaceMods, ...cfg.parentPaths]) {
    if (!p) continue;
    const key = norm(p);
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(p);
  }
  return roots;
}

/**
 * Script files under `roots`, stopping at `cap`. Bounded on purpose: this runs
 * on the activation path, and a total conversion holds thousands of files whose
 * exact number does not change the answer. Symlinked subtrees are not followed
 * (the indexer's walk does, with cycle guards; here a cheap count must not be
 * able to loop), and dot-directories are skipped like everywhere else.
 */
export function countScriptFiles(roots: string[], cap: number): { files: number; partial: boolean } {
  let files = 0;
  const stack = [...roots];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable folder contributes nothing
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
      else if (entry.isFile() && /\.(txt|yml)$/i.test(entry.name)) {
        if (++files >= cap) return { files, partial: true };
      }
    }
  }
  return { files, partial: false };
}

export function measureWorkspace(
  cfg: {
    modPath: string | null;
    workspaceMods: string[];
    parentPaths: string[];
    gamePath: string | null;
  },
  cap = FILE_THRESHOLD
): WorkspaceSize {
  const roots = indexedModRoots(cfg);
  // Already over on roots alone: do not walk 20 mod trees to say so.
  if (roots.length > ROOT_THRESHOLD) return { roots, files: null, partial: false };
  const { files, partial } = countScriptFiles(roots, cap);
  return { roots, files, partial };
}

/**
 * The warning for a workspace this size, or null when it is an ordinary one.
 * Kept as a string so the caller decides between a notification and a log line.
 */
export function bigWorkspaceWarning(size: WorkspaceSize, tigerRunOn: "save" | "manual"): string | null {
  const byRoots = size.roots.length > ROOT_THRESHOLD;
  const byFiles = size.files !== null && size.files >= FILE_THRESHOLD;
  if (!byRoots && !byFiles) return null;
  const roots = `${size.roots.length} mod root${size.roots.length === 1 ? "" : "s"}`;
  const summary =
    size.files === null
      ? roots
      : `${roots} holding ${size.partial ? `${size.files}+` : size.files} script files`;
  const tiger =
    tigerRunOn === "save"
      ? ' Every save here also spawns a validator run ("px.tigerRunOn": "save"); switch it to "manual" to run tiger on demand instead.'
      : "";
  return (
    `This workspace indexes ${summary}. Every window runs its own indexer, so a workspace this ` +
    `size costs gigabytes of memory per window. Use "px.excludedMods" to drop the mods you are ` +
    `not working on.` +
    tiger
  );
}
