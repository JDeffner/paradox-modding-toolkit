import { beforeEach, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { StartupNotices } from "../src/notifications";

const mock = vi.hoisted(() => ({
  enabled: true,
  update: vi.fn(),
  information: vi.fn(),
  warning: vi.fn(),
  command: vi.fn(),
}));
vi.mock("vscode", () => ({
  workspace: { getConfiguration: () => ({ get: () => mock.enabled, update: mock.update }) },
  window: {
    showInformationMessage: mock.information,
    showWarningMessage: mock.warning,
    showQuickPick: vi.fn(),
  },
  commands: { executeCommand: mock.command },
  ConfigurationTarget: { Global: 1 },
}));
function context() {
  const values = new Map<string, unknown>();
  const state = {
    get: (key: string) => values.get(key),
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
  return { globalState: state, workspaceState: state } as unknown as vscode.ExtensionContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.enabled = true;
});
it("consolidates activation notices into one actionable message and honors prior dismissals", async () => {
  const ctx = context();
  const log = vi.fn();
  const queue = new StartupNotices(ctx, log);
  queue.add({ message: "Game folder is missing", key: "setup" });
  queue.add({ message: "Large workspace", key: "large", scope: "workspace" });
  mock.information.mockResolvedValueOnce("Setup & Health Check");
  await queue.show();
  expect(mock.information).toHaveBeenCalledTimes(1);
  expect(mock.information.mock.calls[0]?.[0]).toContain("2 setup notices");
  expect(mock.command).toHaveBeenCalledWith("px.setup");
  expect(log).toHaveBeenCalledTimes(2);
  const again = new StartupNotices(ctx, log);
  again.add({ message: "Game folder is missing", key: "setup" });
  await again.show();
  expect(mock.information).toHaveBeenCalledTimes(1);
});
it("persists opt-out but keeps actionable configuration failures visible", async () => {
  const queue = new StartupNotices(context(), vi.fn());
  queue.add({ message: "Optional advice" });
  mock.information.mockResolvedValueOnce("Don't Show Optional Notices");
  await queue.show();
  expect(mock.update).toHaveBeenCalledWith("notifications.startup", false, vscode.ConfigurationTarget.Global);
  mock.enabled = false;
  const next = new StartupNotices(context(), vi.fn());
  next.add({ message: "Optional advice" });
  next.add({ message: "Configured game folder does not exist", essential: true });
  await next.show();
  expect(mock.information).toHaveBeenCalledTimes(1);
  expect(mock.warning).toHaveBeenCalledTimes(1);
  expect(mock.warning.mock.calls[0]?.[0]).toContain("does not exist");
});
