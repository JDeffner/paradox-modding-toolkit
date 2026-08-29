/**
 * Exclude patterns that keep VS CODE ITSELF from crawling game binaries.
 *
 * The toolkit's own index never reads binaries — the definition scan walks
 * schema folders with an extension filter, and the client watchers glob only
 * the txt/yml/gui/mod extensions — but the editor's built-in search and file
 * watcher walk every workspace folder whole. In a game install plus AGOT that
 * is 43,067 of 69,912 files (62%) spent on textures, meshes and audio, and a
 * whole-workspace Find in Files pays for reading them: measured 0.65 s with
 * these patterns against 1.7 s warm and 106 s once the binaries have fallen
 * out of the OS cache (2026-08-27, NVMe, warm-cache best case for both).
 *
 * BY EXTENSION, NEVER BY DIRECTORY. The obvious version of this excluded
 * whole trees: gfx, music, dlc and friends. That is wrong, because those
 * trees hold real script. CK3 indexes seven SCHEMA folders under gfx/
 * alone (portrait_modifiers, court_scene, scripted_illustrations, …), and
 * game + AGOT hold 584 script files under gfx/, 47 under music/ and 3,537
 * under dlc/. A directory exclude hides them from search AND suppresses the
 * watcher events that re-index them on save. An extension exclude cannot:
 * every listed extension is a format the schema never maps and the parser
 * never reads. `editorExcludesSafety.test.ts` enforces that.
 *
 * `files.watcherExclude` and `search.exclude` are the two knobs VS Code
 * offers, both workspace-writable, both object-valued and merged across
 * scopes, so adding keys at workspace scope never erases the defaults
 * (.git, node_modules).
 *
 * No `vscode` imports: merge planning is unit-tested in plain Node.
 */

/**
 * Binary formats no Paradox game stores script in. Extensions only — see the
 * directory warning above. `.asset` and `.particle2` are deliberately absent:
 * they are text, and modders search them for entity and particle names.
 */
export const BINARY_EXTS = ["dds", "tga", "mesh", "anim", "png", "bk2", "bank", "wav", "ttf", "otf"] as const;

const patterns = BINARY_EXTS.map((e) => `**/*.${e}`);

/**
 * For the file watcher. On Windows this does not shrink the watcher (one
 * recursive handle per root either way, measured 123 vs 124 MB), but it keeps
 * a Steam update that rewrites 27k textures from turning into 27k events the
 * editor has to fan out.
 */
export const WATCHER_EXCLUDES: string[] = patterns;

/** For search: the same list. This is where the measured win is. */
export const SEARCH_EXCLUDES: string[] = patterns;

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
