import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PxConfig } from "../src/config";

const state = vi.hoisted(() => ({
  selected: "",
  detected: null as string | null,
  registry: undefined as unknown,
  fail: false,
  updates: [] as { key: string; target: number }[],
}));
vi.mock("vscode", () => ({
  ConfigurationTarget: { Global: 1 },
  workspace: {
    workspaceFile: { toString: () => "test://workspace/current" },
    workspaceFolders: [],
    getConfiguration: () => ({
      inspect: (key: string) => ({ globalValue: key === "machinePaths" ? state.registry : undefined }),
      update: async (key: string, value: unknown, target: number) => {
        if (state.fail) throw new Error("settings are read-only");
        state.updates.push({ key, target });
        state.registry = value;
      },
    }),
  },
  commands: { executeCommand: vi.fn() },
  window: {
    showOpenDialog: async () => [{ fsPath: state.selected }],
    showInformationMessage: vi.fn(async () => undefined),
    showWarningMessage: vi.fn(),
  },
}));
vi.mock("../src/steamDetect", () => ({ findGameFolder: () => state.detected }));
import { runSetup, selectGameFolder } from "../src/setup";
import { readMachineSetting } from "../src/machineSettings";

const base = path.resolve(".local/testing");
let temporary: string;
beforeEach(() => {
  fs.mkdirSync(base, { recursive: true });
  temporary = fs.mkdtempSync(path.join(base, "setup-machine-"));
  state.selected = temporary;
  state.detected = null;
  state.registry = undefined;
  state.fail = false;
  state.updates = [];
});
afterEach(() => {
  if (!temporary.startsWith(base + path.sep)) throw new Error("Unexpected cleanup path");
  fs.rmSync(temporary, { recursive: true, force: true });
});
function deps(gameId = "ck3") {
  return {
    storageDir: temporary,
    getConfig: () =>
      ({
        gameId,
        gamePath: null,
        logsPath: null,
        modPath: null,
        workspaceMods: [],
        parentPaths: [],
        isCk3Workspace: true,
      }) as unknown as PxConfig,
    refresh: vi.fn(async () => ({ tokens: 0, tokensFromScriptDocs: false, definitions: 0, indexing: false })),
    log() {},
    showOutput() {},
  };
}

it.each(["ck3", "vic3", "eu5"])(
  "stores selected %s installation in a personal workspace binding",
  async (gameId) => {
    fs.mkdirSync(path.join(temporary, "common"));
    const services = deps(gameId);
    await selectGameFolder(services);
    expect(state.updates).toEqual([{ key: "machinePaths", target: 1 }]);
    expect(readMachineSetting("gamePath", gameId)).toBe(temporary);
    expect(services.refresh).toHaveBeenCalledOnce();
  }
);

it("stores Steam detection through the same personal binding", async () => {
  state.detected = temporary;
  await runSetup(deps());
  expect(state.updates).toEqual([{ key: "machinePaths", target: 1 }]);
  expect(readMachineSetting("gamePath", "ck3")).toBe(temporary);
});

it("does not refresh or claim success after a failed settings save", async () => {
  fs.mkdirSync(path.join(temporary, "common"));
  state.fail = true;
  const services = deps();
  await expect(selectGameFolder(services)).rejects.toThrow("read-only");
  expect(services.refresh).not.toHaveBeenCalled();
  expect(state.registry).toBeUndefined();
});
