import * as fs from "node:fs/promises";
import * as path from "node:path";

const supported = /\.(?:json|cjs|js)$/i;
const excludedDirectories = new Set([".git", "node_modules", ".px-toolkit"]);
const comparePaths = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
export const migrationLibraryPathKey = (filename: string): string =>
  process.platform === "win32" ? filename.toLowerCase() : filename;

export interface MigrationLibraryFile {
  localPath: string;
  label: string;
  dataOnly: boolean;
}

/** Discovery reads directory entries only. Evaluation starts after the user's file selection and trust decision. */
export async function discoverMigrationLibraryFiles(
  paths: readonly string[],
  signal?: AbortSignal,
  limits = { entries: 20_000, files: 2_000, depth: 64 }
): Promise<{ files: MigrationLibraryFile[]; hasFolders: boolean }> {
  const files = new Map<string, MigrationLibraryFile>();
  const directories = new Set<string>();
  let hasFolders = false;
  let entries = 0;
  const check = () => {
    if (signal?.aborted) throw new Error("Migration cancelled.");
  };
  const addFile = async (filename: string, root?: string) => {
    const localPath = await fs.realpath(filename);
    const key = migrationLibraryPathKey(localPath);
    if (!files.has(key)) {
      files.set(key, {
        localPath,
        label: root ? path.relative(root, localPath).split(path.sep).join("/") : path.basename(localPath),
        dataOnly: /\.json$/i.test(localPath),
      });
      if (files.size > limits.files)
        throw new Error(
          `Too many contribution files in ${root ?? filename}. Select smaller folders (limit ${limits.files}).`
        );
    }
  };
  const walk = async (directory: string, root: string, depth: number): Promise<void> => {
    check();
    if (depth > limits.depth)
      throw new Error(
        `Contribution folder nesting exceeds ${limits.depth}: ${directory}. Select a smaller folder.`
      );
    const key = migrationLibraryPathKey(directory);
    if (directories.has(key)) return;
    directories.add(key);
    const children = await fs.readdir(directory, { withFileTypes: true });
    entries += children.length;
    if (entries > limits.entries)
      throw new Error(
        `Contribution discovery exceeds ${limits.entries} directory entries at ${directory}. Select smaller folders.`
      );
    children.sort((left, right) => comparePaths(left.name, right.name));
    for (const child of children) {
      check();
      // Junctions and symbolic links below explicit roots must not broaden the selected library.
      if (child.isSymbolicLink()) continue;
      const filename = path.join(directory, child.name);
      if (child.isDirectory()) {
        if (!excludedDirectories.has(child.name.toLowerCase())) await walk(filename, root, depth + 1);
      } else if (child.isFile() && supported.test(child.name)) await addFile(filename, root);
    }
  };
  const roots = [...new Set(paths.map((filename) => path.resolve(filename)))].sort(comparePaths);
  for (const filename of roots) {
    check();
    try {
      const resolved = await fs.realpath(filename);
      const stat = await fs.stat(resolved);
      if (stat.isDirectory()) {
        hasFolders = true;
        await walk(resolved, resolved, 0);
      } else if (stat.isFile() && supported.test(resolved)) await addFile(resolved);
      else throw new Error("Select a .json note, built .cjs/.js recipe library, or contribution folder.");
    } catch (error) {
      throw new Error(`${filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  check();
  return {
    files: [...files.values()].sort((left, right) => comparePaths(left.localPath, right.localPath)),
    hasFolders,
  };
}
