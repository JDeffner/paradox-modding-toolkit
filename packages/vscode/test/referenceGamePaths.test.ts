import { expect, it, vi } from "vitest";
import { vic3Meta } from "@px-lsp/server/games/vic3/meta";
import { URI } from "vscode-uri";

const state = vi.hoisted(() => ({ registry: {} as unknown }));
vi.mock("vscode", () => ({
  workspace: {
    workspaceFile: { toString: () => "test://workspace" },
    workspaceFolders: [],
    getConfiguration: () => ({
      inspect: (key: string) =>
        key === "machinePaths"
          ? { globalValue: state.registry }
          : { workspaceValue: "C:/ck3-workspace-path", globalValue: "C:/ck3-legacy-global" },
    }),
  },
  Uri: { file: URI.file },
}));
vi.mock("../src/steamDetect", () => ({ findGameFolder: () => null }));
import { referenceGamePaths } from "../src/config";
import { inspectMachineSetting } from "../src/machineSettings";

it("uses foreign canonical paths even when a legacy CK3 workspace path has higher inspection precedence", () => {
  state.registry = {
    version: 1,
    defaults: { vic3: { gamePath: "C:/wiki-vic3-game", logsPath: "C:/wiki-vic3-logs" } },
  };
  expect(inspectMachineSetting("gamePath", "vic3", "default").source).toBe("legacyWorkspace");
  expect(
    referenceGamePaths(vic3Meta, {
      gameId: "ck3",
      gamePath: "C:/active-ck3-game",
      logsPath: "C:/active-ck3-logs",
    })
  ).toEqual({ gamePath: "C:/wiki-vic3-game", logsPath: "C:/wiki-vic3-logs" });
  state.registry = {
    version: 1,
    defaults: { vic3: { gamePath: "C:/wiki-vic3-default", logsPath: "C:/wiki-vic3-logs" } },
    workspaces: { "test://workspace": { vic3: { gamePath: "C:/wiki-vic3-workspace" } } },
  };
  expect(
    referenceGamePaths(vic3Meta, { gameId: "ck3", gamePath: "C:/active-ck3-game", logsPath: null }).gamePath
  ).toBe("C:/wiki-vic3-workspace");
});
