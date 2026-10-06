import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Sources of the owned Wiki articles; diagnostic pages are discovered below. */
const articleSources = [
  "packages/vscode/media/image-guidelines.md",
  "packages/vscode/media/steam-workshop-error-codes.md",
  "packages/vscode/media/steam-bbcode.md",
  "packages/vscode/src/webviews/credits/credits.ts",
  "packages/vscode/src/webviews/wiki/moddingTools.ts",
  "packages/vscode/src/webviews/wiki/moddingGuides.ts",
];

/** Git is a build input only. Missing history must not become a build date. */
export function wikiRevisions(root) {
  const sources = [
    ...articleSources,
    ...readdirSync(join(root, "docs/diagnostics"))
      .filter((name) => name.endsWith(".md") && name !== "README.md")
      .sort()
      .map((name) => `docs/diagnostics/${name}`),
  ];
  const revisions = Object.fromEntries(sources.map((source) => [source, { uncommitted: false }]));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    if (git("rev-parse", "--show-prefix").trim()) {
      throw new Error("the build source directory is not a Git repository root");
    }
    if (!git("log", "-1", "--format=%H", "--all").trim()) {
      for (const source of sources) revisions[source].uncommitted = existsSync(join(root, source));
      console.warn("Wiki edit dates unavailable: Git history has no commits.");
      return revisions;
    }
    // Compare the content we package with HEAD, including staged edits. Git
    // status can report changes even when the working file was restored to HEAD.
    const changed = [
      ...git("diff", "HEAD", "--name-only", "-z", "--", ...sources).split("\0"),
      ...git("ls-files", "--others", "-z", "--", ...sources).split("\0"),
    ];
    for (const source of changed) {
      if (revisions[source]) revisions[source].uncommitted = true;
    }
    if (git("rev-parse", "--is-shallow-repository").trim() === "true") {
      console.warn("Wiki edit dates unavailable: shallow Git history. Fetch full history before building.");
      return revisions;
    }
    const committed = new Set(
      git("ls-tree", "-r", "--name-only", "-z", "HEAD", "--", ...sources).split("\0")
    );
    for (const source of sources) {
      // A new source can reuse a path deleted from history. That history
      // belongs to the old article, not the uncommitted replacement.
      if (!committed.has(source)) continue;
      const date = git("log", "-1", "--format=%cI", "--follow", "--", source).trim();
      if (date) revisions[source].lastEdited = date;
    }
  } catch (error) {
    console.warn(`Wiki edit dates unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return revisions;
}
