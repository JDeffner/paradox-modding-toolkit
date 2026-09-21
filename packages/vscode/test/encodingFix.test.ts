import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PxConfig } from "../src/config";

const host = vi.hoisted(() => ({
  command: undefined as ((arg?: unknown) => Promise<void>) | undefined,
  openTextDocument: vi.fn(),
  executeCommand: vi.fn(),
  showTextDocument: vi.fn(),
  showErrorMessage: vi.fn(),
}));
vi.mock("../src/commandTargets", () => ({
  targetUri: (arg: unknown) => arg,
  writableRoot: () => "fixture/mod",
}));
vi.mock("vscode", () => ({
  commands: {
    registerCommand: (_name: string, handler: typeof host.command) => {
      host.command = handler;
      return { dispose() {} };
    },
    executeCommand: host.executeCommand,
  },
  languages: { registerCodeActionsProvider: () => ({ dispose() {} }) },
  CodeActionKind: { QuickFix: "quickfix" },
  workspace: { openTextDocument: host.openTextDocument },
  window: {
    showTextDocument: host.showTextDocument,
    showInformationMessage: vi.fn(),
    showErrorMessage: host.showErrorMessage,
  },
}));
import * as vscode from "vscode";
import { registerEncodingFix } from "../src/encodingFix";

beforeEach(() => {
  vi.resetAllMocks();
  registerEncodingFix({ subscriptions: [] } as unknown as vscode.ExtensionContext, () => ({}) as PxConfig);
});

describe("encoding picker failure recovery", () => {
  it.each(["open", "picker"])(
    "preserves dirty source after %s failure and permits retry",
    async (failure) => {
      const text = "# Unsaved caf\u00e9 \u65e5\u672c\u8a9e\r\n";
      const document = {
        uri: { path: "/fixture/mod/events/test.txt", toString: () => "file:///fixture/mod/events/test.txt" },
        languageId: "paradox-ck3",
        isDirty: true,
        getText: () => text,
        save: vi.fn(),
      };
      host.openTextDocument.mockResolvedValue(document);
      if (failure === "open") host.openTextDocument.mockRejectedValueOnce(new Error("Document unavailable"));
      if (failure === "picker")
        host.executeCommand.mockRejectedValueOnce(new Error("Encoding picker unavailable"));
      await host.command!(document.uri);
      expect(document.getText()).toBe(text);
      expect(document.isDirty).toBe(true);
      expect(document.save).not.toHaveBeenCalled();
      expect(host.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Could not"));
      const failedAttempts = host.executeCommand.mock.calls.length;
      await host.command!(document.uri);
      expect(host.executeCommand.mock.calls.length).toBe(failedAttempts + 1);
      expect(host.executeCommand).toHaveBeenLastCalledWith("workbench.action.editor.changeEncoding");
      expect(document.getText()).toBe(text);
      expect(document.isDirty).toBe(true);
      expect(document.save).not.toHaveBeenCalled();
    }
  );
});
