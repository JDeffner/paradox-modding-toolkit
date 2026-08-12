/**
 * Which mods `Paradox: Add Dependency Mod` may offer: the Steam workshop scan
 * merged with the dependencies the focused mod declares. No vscode imports, so
 * the part that can silently offer the wrong folder is unit-testable.
 */
import * as fs from "fs";
import * as path from "path";
import { readDescriptorDependencies } from "@px-lsp/protocol/descriptorMod";
import { readMetadata } from "@px-lsp/protocol/descriptorMetadata";
import { readModName } from "@px-lsp/protocol/modName";

/** A dependency the focused mod declares, before it is resolved to a folder. */
export interface DeclaredDependency {
  /** What to call it when nothing on disk matches. */
  label: string;
  /** Everything that may identify the other mod on disk: its name, its id. */
  keys: string[];
}

/** One row of the picker. */
export interface DependencyCandidate {
  /** The mod folder, or null when a declared dependency is not installed. */
  path: string | null;
  /** The mod's own name (descriptor/metadata), else the declared label. */
  label: string;
  /** Workshop item id (the folder name); "" for an unresolved declaration. */
  itemId: string;
  /** The focused mod declares this one. */
  declared: boolean;
}

/** Trailing-separator-free lowercase key for path comparisons. */
function normKey(p: string): string {
  return path
    .normalize(p)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

/** Immediate subdirectories of `dir`, absolute; empty when it is unreadable. */
function subdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/** Every dependency the mod at `modRoot` declares, both descriptor conventions. */
export function declaredDependencies(modRoot: string | null): DeclaredDependency[] {
  if (!modRoot) return [];
  // descriptor.mod lists NAMES, metadata.json relationships list IDS: both are
  // compared against everything a folder is known as.
  const out: DeclaredDependency[] = readDescriptorDependencies(modRoot).map((name) => ({
    label: name,
    keys: [name],
  }));
  for (const rel of readMetadata(modRoot)?.relationships ?? []) {
    if (typeof rel?.id !== "string") continue;
    // rel_type is missing in some real files; treat those as dependencies.
    if (rel.rel_type && rel.rel_type !== "dependency") continue;
    out.push({ label: rel.display_name ?? rel.id, keys: [rel.id, rel.display_name ?? ""] });
  }
  return out;
}

/**
 * The picker's rows: every workshop mod under `workshopRoots` (minus `exclude`,
 * the mods already indexed), flagged when the focused mod declares it, followed
 * by the declared dependencies nothing on disk matched.
 */
export function dependencyCandidates(opts: {
  declared: DeclaredDependency[];
  /** `<library>/steamapps/workshop/content/<appId>` per Steam library. */
  workshopRoots: string[];
  /** Mod roots already indexed (px.parentMods, workspace mods, the mod itself). */
  exclude: string[];
}): DependencyCandidate[] {
  const excluded = new Set(opts.exclude.filter((p) => p !== "").map(normKey));
  const seen = new Set<string>();
  const found: DependencyCandidate[] = [];
  /** Lowercased keys of the declarations that matched a folder. */
  const matched = new Set<string>();

  for (const root of opts.workshopRoots) {
    for (const dir of subdirs(root)) {
      const key = normKey(dir);
      if (excluded.has(key) || seen.has(key)) continue;
      seen.add(key);
      const itemId = path.basename(dir);
      const label = readModName(dir);
      // What this folder may be known as: its display name, its metadata id,
      // and the workshop item id (some authors declare the number).
      const identities = new Set([label.toLowerCase(), itemId.toLowerCase()]);
      const metaId = readMetadata(dir)?.id;
      if (typeof metaId === "string" && metaId.trim() !== "") identities.add(metaId.trim().toLowerCase());
      const hits = opts.declared.filter((d) =>
        d.keys.some((k) => k.trim() !== "" && identities.has(k.trim().toLowerCase()))
      );
      for (const d of hits) for (const k of d.keys) matched.add(k.trim().toLowerCase());
      found.push({ path: dir, label, itemId, declared: hits.length > 0 });
    }
  }

  const byLabel = (a: DependencyCandidate, b: DependencyCandidate) => a.label.localeCompare(b.label);
  const missing: DependencyCandidate[] = opts.declared
    .filter((d) => !d.keys.some((k) => matched.has(k.trim().toLowerCase())))
    .map((d) => ({ path: null, label: d.label, itemId: "", declared: true }));

  return [
    ...found.filter((c) => c.declared).sort(byLabel),
    ...missing,
    ...found.filter((c) => !c.declared).sort(byLabel),
  ];
}
