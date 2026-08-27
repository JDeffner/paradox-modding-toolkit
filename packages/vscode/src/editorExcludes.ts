/**
 * Exclude patterns that keep VS CODE ITSELF from crawling game assets.
 *
 * The toolkit's own index never reads binaries — the definition scan walks
 * schema folders with an extension filter, and the client watchers glob only
 * the txt/yml/gui/mod extensions — but the editor's built-in file watcher and
 * search walk every workspace folder whole. A game install is ~100k files of
 * mostly .dds/.mesh/audio, and the field-report workspace (game + 40 mods)
 * multiplies that. `files.watcherExclude` and `search.exclude` are the two
 * knobs VS Code offers, both workspace-writable, both object-valued and
 * merged across scopes, so adding keys at workspace scope never erases the
 * defaults (.git, node_modules).
 *
 * No `vscode` imports: merge planning is unit-tested in plain Node.
 */

/** Asset directories every Jomini game ships, in the install and in mods. */
const ASSET_DIRS = ["gfx", "map_data", "music", "sound", "soundtrack", "dlc", "binaries"];

/** Binary formats that also appear outside those directories. */
const ASSET_EXTS = ["dds", "tga", "mesh", "anim"];

/** For the file watcher: directories plus stray binaries. Watching them buys
 * nothing (the toolkit never indexes them; editors reload on focus anyway). */
export const WATCHER_EXCLUDES: string[] = [
  ...ASSET_DIRS.map((d) => `**/${d}/**`),
  ...ASSET_EXTS.map((e) => `**/*.${e}`),
];

/** For search: directories only. `search.exclude` also filters Quick Open,
 * and dropping whole asset trees is the win; hiding every *.dds by extension
 * would additionally hide loose textures users still open by name. */
export const SEARCH_EXCLUDES: string[] = ASSET_DIRS.map((d) => `**/${d}/**`);

export interface ExcludePlan {
  /** New workspace-scope value, or null when there is nothing to add. */
  value: Record<string, unknown> | null;
  /** The patterns the plan adds. */
  added: string[];
}

/**
 * Additions for one exclude setting. `effective` is the merged view across
 * scopes: a pattern already present anywhere — true from defaults or user
 * settings, or false by the user's explicit choice — is left alone. The new
 * value keeps every existing workspace entry verbatim (search.exclude values
 * may be `{ "when": … }` objects, not just booleans).
 */
export function planExcludes(
  effective: Record<string, unknown> | undefined,
  workspaceValue: Record<string, unknown> | undefined,
  patterns: string[]
): ExcludePlan {
  const added = patterns.filter((p) => !(effective && p in effective));
  if (added.length === 0) return { value: null, added };
  const value: Record<string, unknown> = { ...(workspaceValue ?? {}) };
  for (const p of added) value[p] = true;
  return { value, added };
}
