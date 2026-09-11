import { afterEach, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

const launch = vi.hoisted(() => ({
  calls: [] as Array<{
    vscodeExecutablePath?: string;
    launchArgs: string[];
    extensionTestsEnv: { CK3_LIVE_RESULTS: string };
  }>,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    readFileSync: (file: fs.PathOrFileDescriptor, options?: unknown) => {
      if (typeof file === "string" && file.endsWith("dev-paths.json")) {
        return JSON.stringify({
          games: {
            ck3: { modPath: "configured-mod", gamePath: "configured-game", logsPath: "configured-logs" },
          },
        });
      }
      return actual.readFileSync(file, options as BufferEncoding);
    },
  };
});

vi.mock("@vscode/test-electron", () => ({
  runTests: async (options: (typeof launch.calls)[number]) => {
    launch.calls.push(options);
    fs.writeFileSync(
      options.extensionTestsEnv.CK3_LIVE_RESULTS,
      JSON.stringify([{ name: "isolated launch", ok: true }])
    );
  },
}));

import { main } from "../../../scripts/live-pass";

afterEach(() => {
  for (const call of launch.calls) {
    const scratch = path.dirname(call.extensionTestsEnv.CK3_LIVE_RESULTS);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  launch.calls.length = 0;
  vi.unstubAllEnvs();
});

it("reads nested game slots, honors environment overrides and allocates separate editor profiles", async () => {
  for (const name of [
    "PX_CK3_MOD_PATH",
    "PX_CK3_GAME_PATH",
    "PX_CK3_LOGS_PATH",
    "CK3_MOD_PATH",
    "CK3_GAME_PATH",
    "CK3_LOGS_PATH",
    "VSCODE_EXECUTABLE_PATH",
  ])
    vi.stubEnv(name, undefined);
  expect(await main()).toBe(0);
  vi.stubEnv("PX_CK3_MOD_PATH", "environment-mod");
  vi.stubEnv("PX_CK3_GAME_PATH", "environment-game");
  vi.stubEnv("VSCODE_EXECUTABLE_PATH", process.execPath);
  expect(await main()).toBe(0);
  const [configured, overridden] = launch.calls;
  expect(configured.launchArgs[0]).toBe("configured-mod");
  expect(overridden.launchArgs[0]).toBe("environment-mod");
  expect(configured.vscodeExecutablePath).toBeUndefined();
  expect(overridden.vscodeExecutablePath).toBe(process.execPath);
  const profile = (call: (typeof launch.calls)[number]) =>
    call.launchArgs[call.launchArgs.indexOf("--user-data-dir") + 1];
  expect(profile(configured)).not.toBe(profile(overridden));
  expect(
    JSON.parse(fs.readFileSync(path.join(profile(configured), "User", "settings.json"), "utf8"))
  ).toMatchObject({ "px.gamePath": "configured-game", "px.logsPath": "configured-logs" });
  expect(
    JSON.parse(fs.readFileSync(path.join(profile(overridden), "User", "settings.json"), "utf8"))
  ).toMatchObject({ "px.gamePath": "environment-game" });
  expect(configured.launchArgs).toContain("--extensions-dir");
});
