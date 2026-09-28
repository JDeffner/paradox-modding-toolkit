import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { URI } from "vscode-uri";
import manifest from "../package.json";
import type { AppToHost, HostToApp, SettingsState } from "../src/webviews/settings/messages";
import type { PxConfig } from "../src/config";

const host = vi.hoisted(() => ({
  posted: [] as HostToApp[],
  receive: (_msg: AppToHost) => {},
  close: () => {},
  values: {} as Record<number, Record<string, unknown>>,
  update: vi.fn(),
  command: vi.fn(),
}));
vi.mock("vscode", async () => {
  const { URI } = await import("vscode-uri");
  const disposable = { dispose() {} };
  return {
    Uri: URI,
    ViewColumn: { Active: 1 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    commands: { executeCommand: (...args: unknown[]) => host.command(...args) },
    workspace: {
      workspaceFolders: [{ uri: URI.file("/mods/test"), name: "Test" }],
      workspaceFile: URI.file("/mods/test.code-workspace"),
      onDidChangeConfiguration: () => disposable,
      onDidChangeWorkspaceFolders: () => disposable,
      getConfiguration: (_section: string, uri?: URI) => ({
        get: (key: string, fallback: unknown) => host.values[2]?.[key] ?? host.values[1]?.[key] ?? fallback,
        inspect: (key: string) => ({
          globalValue: host.values[1]?.[key],
          workspaceValue: host.values[2]?.[key],
          workspaceFolderValue: uri ? host.values[3]?.[key] : undefined,
        }),
        update: (key: string, value: unknown, target: number) => host.update(key, value, target),
      }),
    },
    window: {
      showOpenDialog: async () => undefined,
      createWebviewPanel: () => ({
        reveal() {},
        dispose() {},
        onDidDispose: (cb: () => void) => {
          host.close = cb;
          return disposable;
        },
        webview: {
          html: "",
          postMessage: (m: HostToApp) => host.posted.push(m),
          onDidReceiveMessage: (cb: (m: AppToHost) => void) => {
            host.receive = cb;
            return disposable;
          },
        },
      }),
    },
  };
});
vi.mock("../src/config", () => ({ coaLibraryDir: () => null }));
vi.mock("../src/webviews/devReload", () => ({
  webviewSource: () => ({ root: URI.file("/extension"), watch: false }),
  bundleUri: () => "app.js",
  watchBundle: () => ({ dispose() {} }),
}));
vi.mock("../src/webviews/tabIcons", () => ({ tabIcon: () => undefined }));
import { SettingsPanel } from "../src/webviews/settings/panel";

beforeEach(() => {
  host.values = { 1: {}, 2: { unrelated: "keep" }, 3: {} };
  host.posted = [];
  host.command.mockReset();
  host.update.mockReset().mockImplementation(async (key, value, target) => {
    host.values[target][key] = value;
  });
  SettingsPanel.show(
    {
      subscriptions: [],
      extension: { packageJSON: manifest },
    } as unknown as import("vscode").ExtensionContext,
    {
      getCfg: () =>
        ({
          gameId: "ck3",
          gamePath: null,
          logsPath: null,
          modPath: null,
          tigerPath: null,
          warnings: [],
        }) as unknown as PxConfig,
      getStatus: () => ({ tokens: 0, definitions: 0, tokensFromScriptDocs: false, indexing: false }),
    }
  );
});
afterEach(() => host.close());
async function receive(m: AppToHost) {
  const before = host.posted.length;
  host.receive(m);
  await vi.waitFor(() => expect(host.posted.length).toBeGreaterThan(before));
}
async function open(): Promise<SettingsState> {
  await receive({ type: "ready" });
  const m = host.posted.at(-1)!;
  if (m.type !== "state") throw new Error("No state");
  return m.state;
}

it("writes and resets only the selected setting and scope", async () => {
  await open();
  await receive({
    type: "save",
    id: 1,
    key: "scopeInlayHints",
    target: "user",
    stamp: "undefined",
    value: true,
  });
  expect(host.values[1].scopeInlayHints).toBe(true);
  expect(host.values[2]).toEqual({ unrelated: "keep" });
  await receive({
    type: "save",
    id: 2,
    key: "scopeInlayHints",
    target: "user",
    stamp: "true",
    value: null,
    reset: true,
  });
  expect(host.values[1].scopeInlayHints).toBeUndefined();
});

it("refuses stale values, unsupported folder scopes, unknown keys and invalid values", async () => {
  const state = await open();
  const folder = state.targets.find((t) => t.id.startsWith("folder:"))!.id;
  for (const [id, key, target, stamp, value] of [
    [1, "scopeInlayHints", "workspace", "true", false],
    [2, "gamePath", folder, "undefined", ""],
    [3, "unknown", "workspace", "undefined", true],
    [4, "hover.detail", "workspace", "undefined", "huge"],
  ] as const)
    await receive({ type: "save", id, key, target, stamp, value });
  expect(host.update).not.toHaveBeenCalled();
  expect(host.posted.filter((m) => m.type === "result" && m.error)).toHaveLength(4);
  await receive({
    type: "save",
    id: 5,
    key: "characterHistory.quoteNames",
    target: folder,
    stamp: "undefined",
    value: false,
  });
  expect(host.values[3]["characterHistory.quoteNames"]).toBe(false);
});

it("reports write failures and refuses arbitrary commands", async () => {
  await open();
  host.update.mockRejectedValueOnce(new Error("Cannot write settings"));
  await receive({
    type: "save",
    id: 1,
    key: "scopeInlayHints",
    target: "workspace",
    stamp: "undefined",
    value: true,
  });
  expect(host.posted).toContainEqual({ type: "result", id: 1, error: "Cannot write settings" });
  await receive({ type: "action", command: "arbitrary.command" });
  expect(host.command).not.toHaveBeenCalled();
});

it("keeps settings usable while an action waits for its own prompt", async () => {
  await open();
  let finish!: () => void;
  host.command.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  host.receive({ type: "action", command: "px.setup" });
  await receive({
    type: "save",
    id: 1,
    key: "scopeInlayHints",
    target: "workspace",
    stamp: "undefined",
    value: true,
  });
  expect(host.values[2].scopeInlayHints).toBe(true);
  finish();
});
