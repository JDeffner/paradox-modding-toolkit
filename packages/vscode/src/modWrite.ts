import * as fs from "fs";
import * as path from "path";
import type { PxConfig } from "./config";
import { containsPath } from "./commandTargets";

/** Resolve a new file through its nearest existing ancestor, including junctions. */
export function physicalPath(file: string): string {
  let ancestor = path.resolve(file);
  const missing: string[] = [];
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error(`Cannot resolve ${file}`);
    missing.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  return path.join(fs.realpathSync(ancestor), ...missing);
}

/** Keep the logical mod root when it is itself linked, but reject escaping descendants. */
export function assertModWritePath(cfg: PxConfig, file: string): void {
  const target = physicalPath(file);
  if (!cfg.modPath || !containsPath(cfg.modPath, file) || !containsPath(physicalPath(cfg.modPath), target))
    throw new Error("Write destination must stay inside the selected mod");
  // Extra workspace mods are indexed as parents but remain writable targets.
  const referenceRoots = (cfg.parentPaths ?? []).filter(
    (root) => !(cfg.workspaceMods ?? []).some((workspaceRoot) => path.relative(workspaceRoot, root) === "")
  );
  for (const root of [cfg.gamePath, ...referenceRoots]) {
    if (root && containsPath(physicalPath(root), target))
      throw new Error("Vanilla and reference files are read-only");
  }
}
