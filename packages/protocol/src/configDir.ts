/**
 * The toolkit's per-mod config dir: `<mod>/.px-toolkit/`, holding
 * `workshop.json`, `schema.json`, `playset.json`, the tiger baseline, the GUI
 * preview values and the Workshop listing folder. Mods created before 0.4.0
 * have a per-game name instead (each GameMeta's `legacyConfigDirName`);
 * reads keep finding it, and the first write renames it.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";

export const PX_CONFIG_DIR = ".px-toolkit";

export interface ConfigDirNames {
  configDirName: string;
  /** The pre-0.4.0 per-game name, still read as a fallback. */
  legacyConfigDirName?: string;
}

/**
 * The config dir to READ from: the current name when it exists, else the
 * legacy one when that exists, else the current name. Never touches disk.
 */
export function resolveConfigDir(root: string, names: ConfigDirNames): string {
  const current = path.join(root, names.configDirName);
  if (!names.legacyConfigDirName || fs.existsSync(current)) return current;
  const legacy = path.join(root, names.legacyConfigDirName);
  return fs.existsSync(legacy) ? legacy : current;
}

/**
 * The config dir to WRITE to. Renames a legacy dir to the current name first;
 * if the rename fails (locked file, read-only parent) the legacy dir stays in
 * use so the write still lands where reads look.
 */
export function migrateConfigDir(root: string, names: ConfigDirNames): string {
  const current = path.join(root, names.configDirName);
  const resolved = resolveConfigDir(root, names);
  if (resolved === current) return current;
  try {
    fs.renameSync(resolved, current);
    return current;
  } catch {
    return resolved;
  }
}
