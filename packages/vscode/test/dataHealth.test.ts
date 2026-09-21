import { describe, expect, it, vi } from "vitest";
import type { StatusPayload } from "@px-lsp/protocol/protocol";
import type { PxConfig } from "../src/config";
import { dataHealthLines, onboardingReadiness } from "../src/dataHealth";

vi.mock("vscode", () => ({
  commands: { executeCommand: vi.fn(async () => undefined) },
  workspace: { getConfiguration: () => ({ get: () => "configured" }) },
  window: {
    showInformationMessage: vi.fn(async () => undefined),
    createStatusBarItem: () => ({}),
  },
  StatusBarAlignment: { Right: 2 },
  MarkdownString: class {
    constructor(public value: string) {}
  },
}));

import { runSetup } from "../src/setup";
import { PxStatusBar } from "../src/statusBar";
import * as vscode from "vscode";

const status: StatusPayload = {
  tokens: 10,
  tokensFromScriptDocs: true,
  tokensFromBundledDumps: true,
  dataTypesSource: "bundled",
  definitions: 10,
  indexing: false,
};

it("reports mixed, missing and unreported sources without claiming both are generated", () => {
  const mixed = dataHealthLines({ ...status, tokensFromBundledDumps: false }, "DumpDataTypes");
  expect(mixed[0]).toContain("your generated dump");
  expect(mixed[1]).toContain("toolkit-provided set");
  const missing = dataHealthLines({ ...status, tokens: 0, dataTypesSource: "none" }, "DumpDataTypes");
  expect(missing[0]).toContain("no usable data");
  expect(missing[1]).toContain("no usable data");
  expect(dataHealthLines({ ...status, dataTypesSource: undefined }, "DumpDataTypes")[1]).toContain(
    "not reported"
  );
});

describe.each([
  ["ck3", "DumpDataTypes"],
  ["vic3", "dump_data_types"],
  ["eu5", "dump_data_types"],
])("%s Setup and Health", (gameId, command) => {
  it("shows loaded sources in the report and tooltip, then reflects regenerated dumps", async () => {
    const cfg = {
      gameId,
      gamePath: "/game",
      modPath: "/mod",
      logsPath: "/dumps",
      workspaceMods: [],
      parentPaths: [],
      tigerPath: "/tiger",
      isCk3Workspace: true,
    } as unknown as PxConfig;
    const bar = new PxStatusBar();
    // The status item is private; capture the public API that receives the tooltip.
    const tooltip = vi.spyOn(vscode, "MarkdownString");
    const reports: string[] = [];
    for (const generated of [false, true]) {
      const loaded: StatusPayload = {
        ...status,
        tokensFromBundledDumps: !generated,
        dataTypesSource: generated ? "generated" : "bundled",
      };
      await runSetup({
        storageDir: "/storage",
        getConfig: () => cfg,
        refresh: async () => loaded,
        log: (line) => reports.push(line),
        showOutput: () => undefined,
      });
      bar.update({
        ...loaded,
        tokensFromBundledDumps: !generated,
        dataTypesCommand: command,
        gameOk: true,
        modOk: true,
        tigerOk: true,
        tigerName: null,
      });
      const expected = generated ? "your generated dump" : "toolkit-provided set";
      expect(reports.at(-1)?.match(new RegExp(expected, "g"))).toHaveLength(2);
      expect(reports.at(-1)).toContain(`script_docs and ${command}`);
      expect(vi.mocked(vscode.window.showInformationMessage).mock.calls.at(-1)?.[0]).toContain(
        "ready to edit"
      );
      expect(tooltip.mock.calls.at(-1)?.[0]).toContain(expected);
      expect(tooltip.mock.calls.at(-1)?.[0]).toContain(`script_docs and ${command}`);
    }
    tooltip.mockRestore();
  });
});

it("keeps failed or incomplete setup unfinished and recognizes an already configured workspace", () => {
  const ready = { ...status, gameOk: true, modOk: true, tigerOk: true, tigerName: "validator" };
  expect(onboardingReadiness(ready)).toMatchObject({
    "px.setupReady": true,
    "px.modReady": true,
    "px.tigerReady": true,
    "px.dumpsReady": false,
  });
  for (const incomplete of [{ gameOk: false }, { modOk: false }, { tokens: 0 }, { indexing: true }]) {
    expect(onboardingReadiness({ ...ready, ...incomplete })["px.setupReady"]).toBe(false);
  }
  expect(onboardingReadiness({ ...ready, tigerOk: false })).toMatchObject({
    "px.setupReady": true,
    "px.tigerReady": false,
  });
  expect(onboardingReadiness({ ...ready, tigerName: null, tigerOk: false })).toMatchObject({
    "px.setupReady": true,
    "px.tigerReady": false,
  });
  expect(
    onboardingReadiness({ ...ready, tokensFromBundledDumps: false, dataTypesSource: "generated" })[
      "px.dumpsReady"
    ]
  ).toBe(true);
  expect(
    onboardingReadiness({ ...ready, tokensFromBundledDumps: false, dataTypesSource: "none" })["px.dumpsReady"]
  ).toBe(false);
});
