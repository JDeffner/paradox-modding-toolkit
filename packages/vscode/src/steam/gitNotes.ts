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

/**
 * The mod's latest GitHub release, read through the gh CLI, which finds the
 * repository on the git remote and uses the user's own login: its tag, title
 * and notes (Markdown). Null when gh is missing or signed out, the mod has no
 * GitHub remote, or nothing is released; a release with empty notes comes
 * back with an empty body so the panel can say that rather than fall back
 * silently. A tag alone carries no text, which is why the release is read.
 */
export function latestRelease(root: string): Promise<{ tag: string; name: string; body: string } | null> {
  return new Promise((resolve) => {
    cp.execFile(
      "gh",
      ["release", "view", "--json", "tagName,name,body"],
      { cwd: root, windowsHide: true, timeout: 15_000 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const json = JSON.parse(stdout) as { tagName?: string; name?: string; body?: string };
          if (!json.tagName) return resolve(null);
          resolve({ tag: json.tagName, name: json.name || json.tagName, body: json.body ?? "" });
        } catch {
          resolve(null);
        }
      }
    );
  });
}
