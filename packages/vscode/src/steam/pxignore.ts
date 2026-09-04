/**
 * `<mod>/.pxignore`: what a toolkit upload leaves out of the mod folder, in
 * gitignore syntax. The file is created with the default list the first time
 * a mod is uploaded through the toolkit and is the full list from then on:
 * the defaults are not re-applied behind it, so deleting a line uploads that
 * path. The Paradox launcher knows nothing of this file and uploads the whole
 * folder, which is why the header says so.
 *
 * Two things are never uploaded and never kept, whatever the file says: the
 * file itself and the toolkit's config dirs. `.metadata/` and `descriptor.mod`
 * are always kept: without them the game does not see the mod.
 *
 * No vscode imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";
import ignore from "ignore";

export const PXIGNORE_FILE = ".pxignore";

export const DEFAULT_PXIGNORE = `# Files and folders the Paradox Modding Toolkit leaves out when it uploads this
# mod to the Steam Workshop. gitignore syntax: one pattern per line, "!" to
# keep something a line above excluded, "/" at the end for folders only.
#
# This only works for uploads made through the toolkit. The Paradox launcher
# uploads the whole folder, so it would ship everything listed here.
#
# The toolkit's own files (.pxignore, .px-toolkit/) are always left out, and
# descriptor.mod / .metadata/ are always uploaded.

# version control
.git/
.gitignore
.gitattributes
.github/

# editors and agents
.vscode/
.idea/
.claude/
CLAUDE.md
AGENTS.md

# tooling
node_modules/
*-tiger.conf
*.psd
*.xcf
*.kra
*.blend
*.zip
*.7z
*.rar

# operating system noise
Thumbs.db
.DS_Store
desktop.ini
`;

/** Never uploaded regardless of the file. */
const ALWAYS_EXCLUDED = new Set([PXIGNORE_FILE, ".px-toolkit", ".ck3modding", ".vic3modding", ".eu5modding"]);
/** Never excluded regardless of the file. */
const ALWAYS_KEPT = new Set([".metadata", "descriptor.mod"]);

/**
 * Create `<root>/.pxignore` with the defaults when it is missing. Returns true
 * when the file was created now, which is what triggers the one-time notice.
 */
export function ensurePxIgnore(root: string): boolean {
  const file = path.join(root, PXIGNORE_FILE);
  if (fs.existsSync(file)) return false;
  fs.writeFileSync(file, DEFAULT_PXIGNORE, "utf8");
  return true;
}

/**
 * The upload filter for `root`: true = the entry ships. `rel` is the path
 * relative to the mod root. Without a `.pxignore` the defaults apply.
 */
export function pxIgnoreFilter(root: string): (rel: string, isDir: boolean) => boolean {
  const file = path.join(root, PXIGNORE_FILE);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : DEFAULT_PXIGNORE;
  const ig = ignore().add(text);
  return (rel, isDir) => {
    const posix = rel.split(path.sep).join("/");
    const top = posix.split("/")[0];
    if (ALWAYS_EXCLUDED.has(top)) return false;
    if (ALWAYS_KEPT.has(top)) return true;
    return !ig.ignores(isDir ? posix + "/" : posix);
  };
}

/**
 * Copy the mod into a staging folder for the upload, leaving out what the
 * filter excludes. `extraExcluded` are absolute paths (the listing folder of a
 * project-layout mod, which sits outside the root anyway but may be pointed
 * inside it by `px.workshop.dir`).
 */
export function stageContent(root: string, staging: string, extraExcluded: string[] = []): void {
  fs.rmSync(staging, { recursive: true, force: true });
  const keep = pxIgnoreFilter(root);
  const skip = extraExcluded.map((p) => path.resolve(p).toLowerCase());
  fs.cpSync(root, staging, {
    recursive: true,
    filter: (src) => {
      if (src === root) return true;
      if (skip.includes(path.resolve(src).toLowerCase())) return false;
      return keep(path.relative(root, src), fs.statSync(src).isDirectory());
    },
  });
}
