import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { runTargetValidator, summarizeTargetReports, targetInstallRoot } from "../src/tiger/target";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
const roots: string[] = [];
type ProcessCallback = (error: Error | null, stdout: string, stderr: string) => void;
afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("compatch target validation", () => {
  it("requires the selected target installation and never falls back to a configured install", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "px-target-test-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "game"));
    expect(await targetInstallRoot(root)).toBe(await fs.realpath(root));
    expect(await targetInstallRoot(path.join(root, "game"))).toBe(await fs.realpath(root));
    await fs.mkdir(path.join(root, "snapshot"));
    await expect(targetInstallRoot(path.join(root, "snapshot"))).rejects.toThrow(
      "no game installation layout"
    );
  });

  it("passes the explicit new-game root and isolated config to the validator", async () => {
    vi.mocked(execFile).mockImplementation(((
      _binary: string,
      _args: string[],
      _options: object,
      callback: ProcessCallback
    ) => {
      callback(
        null,
        '[{"severity":"error","key":"missing","message":"Broken reference","locations":[]}]',
        ""
      );
    }) as unknown as typeof execFile);
    const result = await runTargetValidator("validator", "vic3", "new install", "mod root", "isolated.conf");
    expect(execFile).toHaveBeenCalledWith(
      "validator",
      ["--json", "--config", "isolated.conf", "--vic3", "new install", "mod root"],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function)
    );
    expect(result).toMatchObject({ errors: 1, warnings: 0, total: 1 });
  });

  it("does not count an unreadable, incompatible or cancelled run as validated", async () => {
    vi.mocked(execFile).mockImplementation(((
      _binary: string,
      _args: string[],
      _options: object,
      callback: ProcessCallback
    ) => {
      callback(Object.assign(new Error("failure"), { code: 2 }), "[]", "wrong version");
    }) as unknown as typeof execFile);
    await expect(runTargetValidator("validator", "ck3", "new", "mod", "config")).rejects.toThrow(
      "wrong version"
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      runTargetValidator("validator", "ck3", "new", "mod", "config", controller.signal)
    ).rejects.toThrow("cancelled");
  });

  it("keeps errors, warnings and other findings distinct", () => {
    const result = summarizeTargetReports(
      ["fatal", "ERROR", "warning", "tips"].map((severity) => ({
        severity,
        key: "test",
        message: "finding",
        locations: [],
      }))
    );
    expect(result).toMatchObject({ errors: 2, warnings: 1, other: 1, total: 4 });
  });
});
