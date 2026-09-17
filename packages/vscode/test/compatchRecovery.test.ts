import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { inspectRecovery } from "../src/compatch/recovery";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

const run = promisify(execFile);
let root: string;
let mod: string;
const git = (...args: string[]) => run("git", args, { cwd: root, windowsHide: true });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "px-recovery-"));
  mod = path.join(root, "mods", "selected mod");
  await fs.mkdir(mod, { recursive: true });
  await git("init", "--quiet");
});
afterEach(async () => {
  vi.mocked(execFile).mockClear();
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("px-recovery-"))
    throw new Error("Unexpected test directory");
  await fs.rm(root, { recursive: true, force: true });
});

describe("compatch recovery inspection", () => {
  it("finds HEAD baselines in a nested mod without changing its dirty worktree or index", async () => {
    const file = path.join(mod, "event.txt");
    await fs.writeFile(file, "original");
    await git("add", ".");
    await git(
      "-c",
      "user.name=Recovery Test",
      "-c",
      "user.email=recovery@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "fixture"
    );
    await fs.writeFile(file, "staged");
    await git("add", ".");
    await fs.writeFile(file, "working");
    await fs.writeFile(path.join(mod, "untracked.txt"), "new");
    const indexBefore = await fs.readFile(path.join(root, ".git", "index"));
    const result = await inspectRecovery(mod, ["event.txt", "untracked.txt", "missing.txt"]);
    expect(result).toMatchObject({
      available: true,
      repositoryPath: root.replace(/\\/g, "/"),
      hasHead: true,
      dirty: true,
      files: [
        {
          relativePath: "event.txt",
          repositoryRelativePath: "mods/selected mod/event.txt",
          tracked: true,
          baseline: "head",
          dirty: true,
        },
        { relativePath: "untracked.txt", tracked: false, baseline: null, dirty: true },
        { relativePath: "missing.txt", tracked: false, baseline: null, dirty: false },
      ],
    });
    expect(await fs.readFile(path.join(root, ".git", "index"))).toEqual(indexBefore);
    expect(await fs.readFile(file, "utf8")).toBe("working");
  });

  it("accepts the stage-zero index as a baseline before the first commit", async () => {
    await fs.writeFile(path.join(mod, "[literal].txt"), "staged");
    await fs.writeFile(path.join(mod, "l.txt"), "untracked");
    await git("add", "--", "mods/selected mod/[literal].txt");
    const result = await inspectRecovery(mod, ["[literal].txt", "l.txt"]);
    expect(result).toMatchObject({
      available: true,
      hasHead: false,
      dirty: true,
      files: [
        { baseline: "index", tracked: true, dirty: true },
        { baseline: null, tracked: false, dirty: true },
      ],
    });
  });

  it("reports unrelated repository changes separately from selected file changes", async () => {
    await fs.writeFile(path.join(mod, "event.txt"), "original");
    await git("add", ".");
    await git(
      "-c",
      "user.name=Recovery Test",
      "-c",
      "user.email=recovery@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "fixture"
    );
    await fs.writeFile(path.join(root, "unrelated.txt"), "dirty");
    expect(await inspectRecovery(mod, ["event.txt"])).toMatchObject({
      available: true,
      dirty: true,
      files: [{ baseline: "head", dirty: false }],
    });
  });

  it("reports missing Git and invalid paths without pretending a baseline exists", async () => {
    vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error, stdout: string, stderr: string) => void;
      callback(Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }), "", "");
      return undefined as never;
    });
    expect(await inspectRecovery(mod, ["event.txt"])).toEqual({
      available: false,
      reason: "spawn git ENOENT",
    });
    expect(await inspectRecovery(mod, ["../outside.txt"])).toMatchObject({ available: false });
    expect(await inspectRecovery(mod, [path.join(root, "outside.txt")])).toMatchObject({ available: false });
  });

  it("reports directories outside a Git repository", async () => {
    await fs.rm(path.join(root, ".git"), { recursive: true, force: true });
    expect(await inspectRecovery(mod, ["event.txt"])).toMatchObject({ available: false });
  });
});
