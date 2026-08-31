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

/** Folder name of the mod content inside a project folder. */
export const PROJECT_CONTENT_DIR = "mod";

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

/** The mod content root of a project folder: `<project>/mod` when that is a
 * mod, the project folder itself when IT is one, else null. */
export function projectContentRoot(projectDir: string): string | null {
  const nested = path.join(projectDir, PROJECT_CONTENT_DIR);
  if (looksLikeModDir(nested)) return nested;
  return looksLikeModDir(projectDir) ? projectDir : null;
}

/** Case-normalized comparison key; the launcher's own paths are Windows-born,
 * so path casing must never make two spellings of one folder look different. */
function pathKey(p: string): string {
  return path
    .resolve(p)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

/** Real (non-link) mod folders directly inside the game's mod dir — the mods
 * a move to the projects layout can pick up. Linked folders are already
 * project-managed and stay out of the list. */
export function listGameFolderMods(gameModDir: string): string[] {
  const out: string[] = [];
  try {
    for (const entry of fs.readdirSync(gameModDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(gameModDir, entry.name);
      if (looksLikeModDir(full)) out.push(full);
    }
  } catch {
    // Unreadable folder: contributes nothing.
  }
  return out;
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

/** Move a directory; rename when possible, copy+delete across drives (the
 * Documents mod folder and a projects folder often live on different drives). */
export function moveDir(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}
