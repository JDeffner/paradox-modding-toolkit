import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseDescriptor } from "@px-lsp/protocol/descriptorMod";
import { readModName } from "@px-lsp/protocol/modName";
import { looksLikeModDir, PROJECT_CONTENT_DIR } from "./core";

export interface ModLocation {
  folder: string;
  label: string;
  /** Launcher .mod paths are relative to the game's user folder. */
  launcher?: boolean;
  /** Include subscribed copies only for an explicit Workshop source selection. */
  workshop?: boolean;
}

export interface FoundMod {
  folder: string;
  name: string;
  location: string;
}

/** Resolve a mod or a project containing mod/, without treating vanilla as editable. */
export async function modInFolder(folder: string): Promise<string | null> {
  const exists = async (file: string) =>
    fs.access(file).then(
      () => true,
      () => false
    );
  if (
    (await exists(path.join(folder, "checksum_manifest.txt"))) ||
    (await exists(path.join(folder, "game", "checksum_manifest.txt")))
  )
    return null;
  if (looksLikeModDir(folder)) return folder;
  const content = path.join(folder, PROJECT_CONTENT_DIR);
  return looksLikeModDir(content) ? content : null;
}

/** Inspect known containers only, never recursively crawl a disk or index game content. */
export async function discoverMods(
  locations: ModLocation[]
): Promise<{ mods: FoundMod[]; issues: string[] }> {
  const mods: FoundMod[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();
  const add = async (folder: string, location: ModLocation) => {
    const content = await modInFolder(folder);
    if (!content) return;
    const resolved = await fs.realpath(content);
    // Subscribed copies are managed by Steam; discover local editing projects instead.
    if (
      !location.workshop &&
      resolved.replaceAll("\\", "/").toLowerCase().includes("/steamapps/workshop/content/")
    )
      return;
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) return;
    seen.add(key);
    mods.push({ folder, name: readModName(content), location: location.label });
  };
  for (const location of locations) {
    try {
      const entries = await fs.readdir(location.folder, { withFileTypes: true });
      for (const entry of entries) {
        const file = path.join(location.folder, entry.name);
        try {
          if (entry.isDirectory() || entry.isSymbolicLink()) await add(file, location);
          else if (location.launcher && entry.name.endsWith(".mod")) {
            const descriptor = parseDescriptor(await fs.readFile(file, "utf8"));
            const target = descriptor.find((field) => field.key === "path")?.value.replace(/^"|"$/g, "");
            if (target) await add(path.resolve(location.folder, "..", target), location);
          }
        } catch (error) {
          issues.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        issues.push(`${location.folder}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  mods.sort((a, b) => a.name.localeCompare(b.name) || a.folder.localeCompare(b.folder));
  return { mods, issues };
}
