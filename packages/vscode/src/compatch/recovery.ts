import { execFile } from "node:child_process";
import * as path from "node:path";

export interface RecoveryFile {
  relativePath: string;
  repositoryRelativePath: string;
  /** Present in HEAD or the index, including a staged deletion. */
  tracked: boolean;
  baseline: "head" | "index" | null;
  /** Has staged, unstaged or untracked changes before the operation. */
  dirty: boolean;
}

export type RecoveryInfo =
  | { available: false; reason: string }
  | {
      available: true;
      repositoryPath: string;
      hasHead: boolean;
      /** Any preexisting repository changes, including files outside the mod. */
      dirty: boolean;
      files: RecoveryFile[];
    };

function git(cwd: string, args: string[], allowMissingHead = false): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["--no-optional-locks", "--literal-pathspecs", ...args],
      { cwd, encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && !(allowMissingHead && error.code === 1)) {
          reject(new Error(stderr.trim() || error.message));
        } else resolve(stdout);
      }
    );
  });
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** Inspect recovery sources only. Never stages, commits, stashes or refreshes the index. */
export async function inspectRecovery(
  modRoot: string,
  relativePaths: readonly string[]
): Promise<RecoveryInfo> {
  try {
    const root = path.resolve(modRoot);
    const requested = relativePaths.map((relativePath) => {
      const file = path.resolve(root, relativePath);
      if (path.isAbsolute(relativePath) || !inside(root, file)) {
        throw new Error(`Expected a file path inside the mod: ${relativePath}`);
      }
      return { relativePath, file };
    });
    const repositoryPath = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
    const repositoryPaths = requested.map(({ file }) =>
      path.relative(repositoryPath, file).split(path.sep).join("/")
    );
    const [head, status, staged] = await Promise.all([
      git(repositoryPath, ["rev-parse", "--verify", "--quiet", "HEAD"], true),
      git(repositoryPath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
      requested.length ? git(repositoryPath, ["ls-files", "--stage", "-z", "--", ...repositoryPaths]) : "",
    ]);
    const hasHead = head.trim() !== "";
    const committed =
      hasHead && requested.length
        ? await git(repositoryPath, ["ls-tree", "--full-tree", "-r", "-z", "HEAD", "--", ...repositoryPaths])
        : "";
    const headFiles = new Set(
      committed
        .split("\0")
        .filter((entry) => /^\d+ blob /.test(entry))
        .map((entry) => entry.slice(entry.indexOf("\t") + 1))
    );
    // Only stage 0 is a recoverable complete file. Conflict stages are not a baseline.
    const trackedIndexFiles = new Set(
      staged
        .split("\0")
        .filter(Boolean)
        .map((entry) => entry.slice(entry.indexOf("\t") + 1))
    );
    const indexFiles = new Set(
      staged
        .split("\0")
        .filter((entry) => /^(100\d+|120000) [\da-f]+ 0\t/.test(entry))
        .map((entry) => entry.slice(entry.indexOf("\t") + 1))
    );
    const dirtyFiles = new Set<string>();
    const records = status.split("\0");
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (!record) continue;
      dirtyFiles.add(record.slice(3));
      if (/[RC]/.test(record.slice(0, 2))) dirtyFiles.add(records[++i]);
    }
    return {
      available: true,
      repositoryPath,
      hasHead,
      dirty: dirtyFiles.size > 0,
      files: requested.map(({ relativePath }, i) => {
        const repositoryRelativePath = repositoryPaths[i];
        const baseline = headFiles.has(repositoryRelativePath)
          ? "head"
          : indexFiles.has(repositoryRelativePath)
            ? "index"
            : null;
        return {
          relativePath,
          repositoryRelativePath,
          tracked: headFiles.has(repositoryRelativePath) || trackedIndexFiles.has(repositoryRelativePath),
          baseline,
          dirty: dirtyFiles.has(repositoryRelativePath),
        };
      }),
    };
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
