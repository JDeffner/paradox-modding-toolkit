/**
 * The changenote source git provides, the last commit's subject, against a
 * throwaway repo. The release notes come from GitHub through gh and are not
 * unit-tested; the Markdown-to-BBCode step they go through has its own suite.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { lastCommitSubject } from "../src/steam/gitNotes";

let repo: string;
const git = (...args: string[]): void => {
  cp.execFileSync("git", ["-c", "user.name=px", "-c", "user.email=px@example.com", ...args], {
    cwd: repo,
    stdio: "ignore",
    windowsHide: true,
  });
};
const commit = (subject: string): void => {
  fs.appendFileSync(path.join(repo, "a.txt"), subject + "\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", subject);
};

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "px-workshop-git-"));
  git("init", "-q");
});
afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe("changenote from git", () => {
  it("reads the last subject as the commit note", async () => {
    commit("First cut");
    expect(await lastCommitSubject(repo)).toBe("First cut");
    commit("Fix the ransom trigger");
    expect(await lastCommitSubject(repo)).toBe("Fix the ransom trigger");
  });
});
