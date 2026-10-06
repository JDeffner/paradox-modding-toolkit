/**
 * The toolkit's per-mod config dir: `<mod>/.px-toolkit/`, holding
 * `workshop.json`, `schema.json`, `playset.json`, the tiger baseline, the GUI
 * preview values and the Workshop listing folder. Mods created before 0.4.0
 * have a per-game name instead (each GameMeta's `legacyConfigDirName`);
 * reads resolve each artifact separately. New writes use the current name.
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

function validateNames(names: ConfigDirNames): void {
  const folders = [names.configDirName];
  if (names.legacyConfigDirName !== undefined) folders.push(names.legacyConfigDirName);
  for (const name of folders) {
    if (!name || !/^[A-Za-z0-9_.-]+$/.test(name) || name === "." || name === ".." || /[.]$/.test(name)) {
      throw new Error("Config directory names must be single safe folder names");
    }
  }
}

function relativeParts(relative: string): string[] {
  const parts = relative.split(/[\\/]/);
  if (
    !relative ||
    /[<>:"|?*]/.test(relative) ||
    [...relative].some((character) => character.charCodeAt(0) < 32) ||
    parts.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part))
  ) {
    throw new Error("Config paths must be safe relative paths without traversal");
  }
  return parts;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function pathExists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** Resolve existing ancestors too, so a not-yet-created file cannot escape via a link. */
function physicalPath(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch (error) {
    if (!isMissing(error) || pathExists(file)) throw error;
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(physicalPath(parent), path.basename(file));
  }
}

function contains(parent: string, file: string): boolean {
  const relative = path.relative(parent, file);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

/**
 * Validate a config target before reading or writing it. Existing links must
 * stay inside the selected folder, including links in a missing file's parents.
 * This is a preflight check; writers must still handle filesystem errors.
 */
export function assertConfigPath(
  root: string,
  names: ConfigDirNames,
  relative: string,
  legacy = false
): string {
  validateNames(names);
  const dir = legacy ? names.legacyConfigDirName : names.configDirName;
  if (!dir) throw new Error("No legacy config directory is defined");
  const parts = relativeParts(relative);
  const absoluteRoot = path.resolve(root);
  const folder = path.join(absoluteRoot, dir);
  const file = path.join(folder, ...parts);
  const physicalFolder = path.join(physicalPath(absoluteRoot), dir);
  if (!contains(physicalFolder, physicalPath(folder)) || !contains(physicalFolder, physicalPath(file))) {
    throw new Error(`Config path escapes its directory: ${file}`);
  }
  return file;
}

/** The current artifact path for every new write. Does not create or migrate files. */
export function canonicalConfigPath(root: string, names: ConfigDirNames, relative: string): string {
  return assertConfigPath(root, names, relative);
}

/** Resolve one artifact independently; an existing invalid current file still wins. */
export function resolveConfigPath(root: string, names: ConfigDirNames, relative: string): string {
  const current = canonicalConfigPath(root, names, relative);
  if (pathExists(current) || !names.legacyConfigDirName) return current;
  const legacy = assertConfigPath(root, names, relative, true);
  return pathExists(legacy) ? legacy : current;
}

/** Both names are watched, including files that do not exist yet. */
export function indexConfigWatchPatterns(names: ConfigDirNames): string[] {
  validateNames(names);
  return [names.configDirName, names.legacyConfigDirName]
    .filter((name): name is string => !!name)
    .map((name) => `**/${name}/{schema,playset,project}.json`);
}

/** Only overlays belonging to an editable workspace root can change its index. */
export function isIndexConfigFile(file: string, roots: string[], names: ConfigDirNames): boolean {
  validateNames(names);
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const candidate = normalize(file);
  return roots.some((root) =>
    [names.configDirName, names.legacyConfigDirName].some(
      (dir) =>
        dir &&
        ["schema.json", "playset.json", "project.json"].some(
          (name) => normalize(path.join(root, dir, name)) === candidate
        )
    )
  );
}

/**
 * The config dir to READ from: the current name when it exists, else the
 * legacy one when that exists, else the current name. Never touches disk.
 * @deprecated Resolve each artifact with resolveConfigPath instead.
 */
export function resolveConfigDir(root: string, names: ConfigDirNames): string {
  validateNames(names);
  const current = path.join(root, names.configDirName);
  if (!names.legacyConfigDirName || fs.existsSync(current)) return current;
  const legacy = path.join(root, names.legacyConfigDirName);
  return fs.existsSync(legacy) ? legacy : current;
}

/**
 * The config dir to WRITE to. Renames a legacy dir to the current name first;
 * if the rename fails (locked file, read-only parent) the legacy dir stays in
 * use so the write still lands where reads look.
 * @deprecated Use canonicalConfigPath and copy only the artifact being upgraded.
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
