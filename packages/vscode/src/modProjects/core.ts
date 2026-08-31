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
import { upsertDescriptorValue } from "@px-lsp/protocol/descriptorMod";

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
