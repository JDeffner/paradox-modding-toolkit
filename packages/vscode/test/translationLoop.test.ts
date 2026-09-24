import { beforeEach, expect, it, vi } from "vitest";
import * as path from "node:path";
import type { LanguageClient } from "vscode-languageclient/node";
import type { PxConfig } from "../src/config";

const ui = vi.hoisted(() => ({
  showInputBox: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  replace: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("vscode", () => ({ window: ui }));
vi.mock("../src/locCommands", () => ({ replaceLocLineValue: ui.replace, upsertNewModLoc: ui.upsert }));
import { translateNextCommand } from "../src/translationLoop";

const root = path.resolve(".local/testing/translation-loop");
const file = path.join(root, "localization/english/test_l_english.yml");
const changed = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  ui.replace.mockResolvedValue(true);
  ui.upsert.mockResolvedValue(file);
});
async function run() {
  const client = {
    sendRequest: async () => [
      {
        language: "english",
        untranslated: [
          { key: "first", value: "Source", file, line: 1 },
          { key: "second", value: "Second", file, line: 2 },
        ],
        missing: [{ key: "third" }, { key: "fourth" }],
      },
    ],
  } as unknown as LanguageClient;
  await translateNextCommand(client, { modPath: root } as PxConfig, changed);
}

it("Escape in the first phase stops the whole command", async () => {
  ui.showInputBox.mockResolvedValueOnce(undefined);
  await run();
  expect(ui.showInputBox).toHaveBeenCalledTimes(1);
  expect(ui.replace).not.toHaveBeenCalled();
  expect(ui.upsert).not.toHaveBeenCalled();
  expect(ui.showInformationMessage).not.toHaveBeenCalled();
});

it.each(["first", "missing"])("keeps the progress summary when cancelling the %s phase", async (phase) => {
  ui.showInputBox.mockResolvedValueOnce("Translated");
  if (phase === "missing") ui.showInputBox.mockResolvedValueOnce("");
  ui.showInputBox.mockResolvedValueOnce(undefined);
  await run();
  expect(ui.showInputBox).toHaveBeenCalledTimes(phase === "missing" ? 3 : 2);
  expect(ui.replace).toHaveBeenCalledTimes(1);
  expect(ui.upsert).not.toHaveBeenCalled();
  expect(ui.showInformationMessage).toHaveBeenCalledWith(
    expect.stringContaining(
      phase === "missing"
        ? "1 English entry written, 1 skipped (2/4 reviewed)"
        : "1 English entry written (1/4 reviewed)"
    )
  );
});

it.each(["false", "throw"])("stops before the next prompt on a %s write failure", async (failure) => {
  ui.showInputBox.mockResolvedValue("Translated");
  ui.replace.mockResolvedValueOnce(true);
  if (failure === "false") ui.replace.mockResolvedValueOnce(false);
  else ui.replace.mockRejectedValueOnce(new Error("Cannot save"));
  await run();
  expect(ui.showInputBox).toHaveBeenCalledTimes(2);
  expect(ui.replace).toHaveBeenCalledTimes(2);
  expect(ui.upsert).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(ui.showErrorMessage).toHaveBeenCalledTimes(1);
  expect(ui.showInformationMessage).toHaveBeenCalledWith(
    expect.stringContaining("1 English entry written (1/4 reviewed)")
  );
});

it("stops the missing phase after a failed write without counting it as skipped", async () => {
  ui.showInputBox.mockResolvedValueOnce("").mockResolvedValueOnce("").mockResolvedValue("New");
  ui.upsert.mockRejectedValueOnce(new Error("Cannot save"));
  await run();
  expect(ui.showInputBox).toHaveBeenCalledTimes(3);
  expect(ui.upsert).toHaveBeenCalledTimes(1);
  expect(ui.showInformationMessage).toHaveBeenCalledWith(
    expect.stringContaining("0 English entries written, 2 skipped (2/4 reviewed)")
  );
});
