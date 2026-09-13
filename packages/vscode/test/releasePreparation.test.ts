import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = path.resolve("scripts/prepare-release.mjs");
let cwd: string;

function manifest(file: string, version: string) {
  writeFileSync(path.join(cwd, file), JSON.stringify({ version }));
}

function run(tag = "v0.4.4") {
  return spawnSync(process.execPath, [script], {
    cwd,
    env: { ...process.env, RELEASE_TAG: tag },
    encoding: "utf8",
  });
}

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "px-release-test-"));
  mkdirSync(path.join(cwd, "packages/vscode"), { recursive: true });
  mkdirSync(path.join(cwd, "docs/release"), { recursive: true });
  manifest("package.json", "0.4.4");
  manifest("packages/vscode/package.json", "0.4.4");
  writeFileSync(path.join(cwd, "docs/release/0.4.4.md"), "# Release\n\n- Fix edits.\n");
});

afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe("release preparation CLI", () => {
  it("collects the exact version's notes without the title or changelog footer", () => {
    writeFileSync(
      path.join(cwd, "docs/release/0.4.4.md"),
      "\uFEFF# Release\r\n\r\n- Fix edits.\r\n\r\n### Full changelog\r\nOld link\r\n"
    );
    expect(run().status).toBe(0);
    expect(readFileSync(path.join(cwd, "release-body.md"), "utf8")).toBe("- Fix edits.\n");
  });

  it.each(["package.json", "packages/vscode/package.json"])(
    "fails before producing notes when %s does not match the tag",
    (file) => {
      manifest(file, "0.4.3");
      const result = run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`${file} version 0.4.3`);
      expect(existsSync(path.join(cwd, "release-body.md"))).toBe(false);
    }
  );

  it.each(["main", "", "v0.4.4/../../other", "v0.4.4-beta.1"])("rejects invalid release tag %j", (tag) => {
    expect(run(tag).status).not.toBe(0);
    expect(existsSync(path.join(cwd, "release-body.md"))).toBe(false);
  });

  it("fails when the matching release notes are missing", () => {
    expect(run("v0.4.5").status).not.toBe(0);
    rmSync(path.join(cwd, "docs/release/0.4.4.md"));
    expect(run().status).not.toBe(0);
    expect(existsSync(path.join(cwd, "release-body.md"))).toBe(false);
  });

  it("fails when the release file contains only a title", () => {
    writeFileSync(path.join(cwd, "docs/release/0.4.4.md"), "# Release\n");
    expect(run().stderr).toContain("must contain release notes");
    expect(existsSync(path.join(cwd, "release-body.md"))).toBe(false);
  });
});
