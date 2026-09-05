/**
 * The changenote sources the repository provides: the last commit's subject
 * (git) and the latest release's notes (GitHub, through gh). Plain Node, no
 * `vscode` import, so the git shape is unit-tested against a throwaway repo.
 */
import * as cp from "child_process";

/** One git command in the mod, its trimmed stdout, or "" when git says no. */
function git(root: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    cp.execFile("git", args, { cwd: root, windowsHide: true }, (err, stdout) =>
      resolve(err ? "" : stdout.trim())
    );
  });
}

/** Subject of the mod's last git commit, as a changenote suggestion. */
export function lastCommitSubject(root: string): Promise<string> {
  return git(root, ["log", "-1", "--format=%s"]);
}

/** One gh command in the mod, its parsed JSON, or null when gh says no. */
function gh<T>(root: string, args: string[]): Promise<T | null> {
  return new Promise((resolve) => {
    cp.execFile("gh", args, { cwd: root, windowsHide: true, timeout: 15_000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        resolve(JSON.parse(stdout) as T);
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * The mod's newest GitHub release, read through the gh CLI, which finds the
 * repository on the git remote and uses the user's own login: its tag, title
 * and notes (Markdown). Newest by publication, a pre-release included: `gh
 * release view` with no tag answers only GitHub's "latest", which skips
 * pre-releases, and a mod that only ever tagged pre-releases would read as
 * having none. Null when gh is missing or signed out, the mod has no GitHub
 * remote, or nothing is released; a release with empty notes comes back with
 * an empty body so the panel can say that rather than fall back silently. A
 * tag alone carries no text, which is why the release is read.
 */
export async function latestRelease(
  root: string
): Promise<{ tag: string; name: string; body: string } | null> {
  const list = await gh<{ tagName?: string }[]>(root, [
    "release",
    "list",
    "--exclude-drafts",
    "--limit",
    "1",
    "--json",
    "tagName",
  ]);
  const tag = list?.[0]?.tagName;
  if (!tag) return null;
  const json = await gh<{ tagName?: string; name?: string; body?: string }>(root, [
    "release",
    "view",
    tag,
    "--json",
    "tagName,name,body",
  ]);
  if (!json?.tagName) return null;
  return { tag: json.tagName, name: json.name || json.tagName, body: json.body ?? "" };
}
