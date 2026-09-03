/**
 * The decisions behind a creator's "where does this go?" step, with no vscode
 * in them so they can be unit-tested: the default file name, the vanilla-name
 * refusal, and the BOM rule every script writer follows.
 *
 * The UI that asks the questions lives in save.ts.
 */

/** Every script and loc file the games read is UTF-8 with a BOM. */
export const BOM = "﻿";

/** A bare file name, no folders: anything else could write outside the mod. */
export function isPlainScriptFileName(name: string): boolean {
  return /^[\w.-]+\.txt$/.test(name);
}

/**
 * The file a new definition of `kind` goes into by default: `<prefix>_<kind>s.txt`
 * (`mymod_traits.txt`), with the English `y -> ies` so a `dynasty` does not read
 * as `dynastys`. The prefix is the one the New Content flow remembers, so a
 * modder's files keep one naming scheme across both commands.
 */
export function defaultDefinitionFileName(prefix: string, kind: string): string {
  const plural = kind.endsWith("s")
    ? kind // `coat_of_arms` is already the folder's own plural
    : /[^aeiou]y$/.test(kind)
      ? `${kind.slice(0, -1)}ies`
      : `${kind}s`;
  return `${prefix}_${plural}.txt`;
}

/**
 * The file a creator saves into when nobody picks another, so the top bar can
 * name the target from the moment the form loads instead of asking at save
 * time: the file an edited definition came from, else the default name.
 *
 * `sourceFile` is a bare file name of the mod's own folder; anything else (a
 * vanilla file, a path) is ignored, because a save may not write there.
 */
export function defaultTargetFileName(opts: { sourceFile?: string; prefix: string; kind: string }): string {
  const source = opts.sourceFile?.trim();
  return source && isPlainScriptFileName(source) ? source : defaultDefinitionFileName(opts.prefix, opts.kind);
}

/**
 * Why this file name must not be used, or null when it is fine.
 *
 * Script databases are last-in-wins per FILE NAME, not per definition: a mod
 * file called `00_traits.txt` replaces the game's whole `00_traits.txt`, so
 * every definition that file held disappears. The creators refuse the name
 * rather than let a modder delete 300 traits by accident.
 *
 * `gameFiles` is the game folder's listing (bare file names); an empty list
 * (no game path configured, or the folder does not exist) refuses nothing,
 * which is honest: we cannot check what we cannot read.
 */
export function vanillaNameClash(
  fileName: string,
  gameFiles: readonly string[],
  folder: string
): string | null {
  const lower = fileName.toLowerCase();
  if (!gameFiles.some((f) => f.toLowerCase() === lower)) return null;
  return (
    `${fileName} is the name of a game file in ${folder}. A mod file with the same name replaces the ` +
    `whole game file, not just the entry you are writing, so everything else it defines would be gone. ` +
    `Pick a different name.`
  );
}
