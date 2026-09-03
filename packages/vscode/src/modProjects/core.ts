/**
 * Mod projects layout: the recommended place for a mod is its own project
 * folder (`px.modProjectsDir`), with the real mod content in `<project>/mod` —
 * so git history, notes and the Workshop listing files (`<project>/workshop`,
 * see steam/workshopFiles.ts) live NEXT to the mod instead of inside the
 * upload. The game still finds the mod through a link in its own mod folder:
 * a `<name>.mod` pointer file (`path=`) for the `.mod`-descriptor games, a
 * directory link (junction/symlink) for the metadata games.
 *
 * No vscode imports: unit-tested in plain Node (test/modProjects.test.ts).
 */
import * as fs from "fs";
import * as path from "path";
import { parseDescriptor, upsertDescriptorValue } from "@px-lsp/protocol/descriptorMod";
import { hasMetadataDescriptor } from "@px-lsp/protocol/descriptorMetadata";
import { resolveConfigDir, type ConfigDirNames } from "@px-lsp/protocol/configDir";

/** Folder name of the mod content inside a project folder. */
export const PROJECT_CONTENT_DIR = "mod";

/** Folder name of the Workshop listing next to the mod content. */
export const PROJECT_WORKSHOP_DIR = "workshop";

/** Launcher-friendly identifier from a display name ("My Mod!" -> "my_mod"). */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "my_mod";
}

/** Filesystem-legal project folder name from the display name (keeps case and
 * spaces, which is how humans name project folders). */
export function projectFolderName(name: string): string {
  const s = name
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return s || slugify(name);
}

/** The launcher reads forward slashes only, on every platform. */
export function launcherPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** The outer `<name>.mod` pointer content: the descriptor's fields plus the
 * `path=` line telling the launcher where the content lives. */
export function pointerModText(descriptorText: string, contentDir: string): string {
  return upsertDescriptorValue(descriptorText, "path", launcherPath(contentDir));
}

// ---- moving between the two layouts -------------------------------------------
//
// The first Move Mod renamed the mod folder and died with EBUSY: the folder was
// open in the workspace, so watchers, Explorer or the launcher held handles.
// This one never renames a folder that may be open. It COPIES the tree, verifies
// the copy file by file, and only then retires the source; a source that cannot
// be removed is renamed aside, and if even that fails the user is told which
// folder to delete by hand. The destination is authoritative from the moment it
// verifies.

/** Mirror of config.looksLikeMod, importable without vscode. */
export function looksLikeModDir(dir: string): boolean {
  try {
    if (fs.existsSync(path.join(dir, "descriptor.mod"))) return true;
    if (hasMetadataDescriptor(dir)) return true;
    return ["common", "events", "localization", "gui", "history"].some((d) =>
      fs.existsSync(path.join(dir, d))
    );
  } catch {
    return false;
  }
}

/** Case-normalized comparison key; the launcher's own paths are Windows-born,
 * so path casing must never make two spellings of one folder look different. */
function pathKey(p: string): string {
  return path
    .resolve(p)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

/** True when `child` sits directly inside `parent`. */
function isChildOf(child: string, parent: string | null): boolean {
  return parent !== null && pathKey(path.dirname(child)) === pathKey(parent);
}

/** The `<name>.mod` pointer file in `gameModDir` whose `path=` resolves to
 * `contentDir` (relative values resolve against the game user dir, the
 * launcher's rule), or null. */
export function findPointerFor(gameModDir: string, contentDir: string): string | null {
  const want = pathKey(contentDir);
  const userDir = path.dirname(gameModDir);
  try {
    for (const name of fs.readdirSync(gameModDir)) {
      if (!/\.mod$/i.test(name)) continue;
      const file = path.join(gameModDir, name);
      let text: string;
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const entry = parseDescriptor(text).find((e) => e.key === "path");
      const value = entry?.value.replace(/^"([^]*)"$/, "$1").trim();
      if (!value) continue;
      if (pathKey(path.resolve(userDir, value)) === want) return file;
    }
  } catch {
    // Unreadable folder: no pointer.
  }
  return null;
}

/** Directory links (symlinks/junctions) in `gameModDir` resolving to
 * `contentDir` — the metadata games' launcher link. */
export function findLinksFor(gameModDir: string, contentDir: string): string[] {
  const want = pathKey(contentDir);
  const out: string[] = [];
  try {
    for (const entry of fs.readdirSync(gameModDir, { withFileTypes: true })) {
      if (!entry.isSymbolicLink()) continue;
      const full = path.join(gameModDir, entry.name);
      try {
        if (pathKey(fs.realpathSync(full)) === want) out.push(full);
      } catch {
        // Dangling link: not a link to contentDir.
      }
    }
  } catch {
    // Unreadable folder: no links.
  }
  return out;
}

export type ModLayout = "game" | "project" | "unknown";

export interface LayoutInfo {
  layout: ModLayout;
  /** The mod content root (unchanged input). */
  content: string;
  /** The project folder holding the content, for the projects layout. */
  projectDir: string | null;
  /** The launcher link that makes the game see a projects-layout mod. */
  pointer: string | null;
  links: string[];
}

/**
 * Which of the two layouts `content` is in: a folder directly inside the game's
 * mod folder is the game layout; a folder the game reaches through a pointer or
 * a directory link, or one under `px.modProjectsDir`, is the projects layout.
 */
export function detectLayout(
  content: string,
  opts: { gameModDir: string | null; projectsDir: string | null; descriptor: "mod" | "metadata" }
): LayoutInfo {
  const pointer =
    opts.gameModDir && opts.descriptor === "mod" ? findPointerFor(opts.gameModDir, content) : null;
  const links =
    opts.gameModDir && opts.descriptor === "metadata" ? findLinksFor(opts.gameModDir, content) : [];
  const linked = pointer !== null || links.length > 0;
  const parent = path.dirname(content);
  const inProjects =
    isChildOf(content, opts.projectsDir) ||
    (path.basename(content) === PROJECT_CONTENT_DIR && isChildOf(parent, opts.projectsDir));
  const projectDir = path.basename(content) === PROJECT_CONTENT_DIR ? parent : content;

  if (isChildOf(content, opts.gameModDir) && !linked) {
    return { layout: "game", content, projectDir: null, pointer, links };
  }
  if (linked || inProjects) {
    return { layout: "project", content, projectDir, pointer, links };
  }
  return { layout: "unknown", content, projectDir: null, pointer, links };
}

/** True when `dir` is free to move into: absent, or a leftover EMPTY folder
 * (e.g. from a previously failed move), which is removed. An existing file or
 * non-empty folder stays and returns false. */
export function claimDest(dir: string): boolean {
  if (!fs.existsSync(dir)) return true;
  try {
    fs.rmdirSync(dir); // only succeeds on an empty directory
    return true;
  } catch {
    return false;
  }
}

/** Where the Workshop listing of a game-folder mod lives: `<configDir>/workshop`,
 * mirroring steam/workshopFiles.resolveWorkshopDir with no explicit setting. */
export function listingDirIn(root: string, names: ConfigDirNames): string {
  return path.join(resolveConfigDir(root, names), PROJECT_WORKSHOP_DIR);
}

export interface MovePlan {
  direction: "toProjects" | "toGame";
  /** Mod content root today. */
  srcContent: string;
  /** Mod content root after the move. */
  destContent: string;
  /** The folder to open as the workspace folder afterwards. */
  destRoot: string;
  /** Trees copied, in order. */
  copies: { from: string; to: string }[];
  /** Renames INSIDE the fresh destination, run after the copies. Nothing there
   * is open in the editor, so a rename is safe. */
  relocate: { from: string; to: string }[];
  /** Source folders retired once every copy verifies. */
  retire: string[];
  /** Removed when the move leaves it empty (the old project folder). */
  pruneIfEmpty: string | null;
  /** True when `px.workshop.dir` pins the listing and the plan leaves it alone. */
  listingPinned: boolean;
}

/**
 * What a move has to copy, relocate and retire. The Workshop listing is the
 * fiddly part: `<mod>/<configDir>/workshop` in the game layout is the sibling
 * `<project>/workshop` in the projects layout (the folder resolveWorkshopDir
 * prefers), so the plan remaps it and the new root finds the listing with no
 * setting change. An explicit `px.workshop.dir` wins: the listing stays where
 * the setting points and the plan does not touch it.
 */
export function planMove(opts: {
  direction: "toProjects" | "toGame";
  srcContent: string;
  /** toProjects: the new project folder. toGame: the new mod folder. */
  destRoot: string;
  /** The project folder the content lives in today (toGame only). */
  projectDir?: string | null;
  names: ConfigDirNames;
  /** `px.workshop.dir`; a non-empty value pins the listing. */
  workshopDirSetting?: string;
}): MovePlan {
  const listingPinned = (opts.workshopDirSetting ?? "").trim() !== "";
  const copies: { from: string; to: string }[] = [];
  const relocate: { from: string; to: string }[] = [];
  const retire: string[] = [opts.srcContent];

  if (opts.direction === "toProjects") {
    const destContent = path.join(opts.destRoot, PROJECT_CONTENT_DIR);
    copies.push({ from: opts.srcContent, to: destContent });
    if (!listingPinned) {
      const srcListing = listingDirIn(opts.srcContent, opts.names);
      if (fs.existsSync(srcListing)) {
        // The tree copy carries it inside the mod; lift it out to the sibling.
        relocate.push({
          from: path.join(destContent, path.relative(opts.srcContent, srcListing)),
          to: path.join(opts.destRoot, PROJECT_WORKSHOP_DIR),
        });
      }
    }
    return {
      direction: "toProjects",
      srcContent: opts.srcContent,
      destContent,
      destRoot: opts.destRoot,
      copies,
      relocate,
      retire,
      pruneIfEmpty: null,
      listingPinned,
    };
  }

  const destContent = opts.destRoot;
  copies.push({ from: opts.srcContent, to: destContent });
  const projectDir = opts.projectDir ?? null;
  const nested = projectDir !== null && pathKey(projectDir) !== pathKey(opts.srcContent);
  if (!listingPinned && nested) {
    const sibling = path.join(projectDir, PROJECT_WORKSHOP_DIR);
    if (fs.existsSync(sibling)) {
      copies.push({
        from: sibling,
        to: path.join(destContent, opts.names.configDirName, PROJECT_WORKSHOP_DIR),
      });
      retire.push(sibling);
    }
  }
  return {
    direction: "toGame",
    srcContent: opts.srcContent,
    destContent,
    destRoot: destContent,
    copies,
    relocate,
    retire,
    pruneIfEmpty: nested ? projectDir : null,
    listingPinned,
  };
}

/** Every file under `dir`, as relative path -> size. */
function fileSizes(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) out.set(child, fs.statSync(path.join(dir, child)).size);
    }
  };
  walk("");
  return out;
}

/**
 * Copy `src` to `dest` and check every file arrived at its full size. Throws
 * (after removing the half-written destination) when anything is missing or
 * short, so a failed copy never costs the user the source.
 */
export function copyTreeVerified(src: string, dest: string): { files: number; bytes: number } {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.cpSync(src, dest, { recursive: true, preserveTimestamps: true });
    const from = fileSizes(src);
    const to = fileSizes(dest);
    let bytes = 0;
    for (const [rel, size] of from) {
      const got = to.get(rel);
      if (got === undefined) throw new Error(`${rel} did not arrive in ${dest}`);
      if (got !== size) throw new Error(`${rel} is ${got} bytes at ${dest}, ${size} at the source`);
      bytes += size;
    }
    return { files: from.size, bytes };
  } catch (err) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw err;
  }
}

export interface RetireResult {
  /** The folder is gone. */
  removed: boolean;
  /** Set when the folder could not be removed but could be renamed aside. */
  renamedTo?: string;
  /** Set when the folder is still there under its own name. */
  left?: string;
}

/**
 * Retire a copied-and-verified source folder. Removing it is best; a locked
 * folder (watchers, Explorer, the launcher) is renamed aside so the name is
 * free again; if even that fails the caller tells the user to delete it.
 */
export function retireSource(dir: string, stamp = new Date()): RetireResult {
  if (!fs.existsSync(dir)) return { removed: true };
  try {
    fs.rmSync(dir, { recursive: true });
    return { removed: true };
  } catch {
    const suffix = stamp.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const aside = `${dir}.moved-${suffix}`;
    try {
      fs.renameSync(dir, aside);
      return { removed: false, renamedTo: aside };
    } catch {
      return { removed: false, left: dir };
    }
  }
}
