import { beforeEach, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { DashboardDeps } from "../src/webviews/dashboard/view";

const host = vi.hoisted(() => ({
  registry: undefined as unknown,
  providers: new Map<string, { resolveWebviewView(view: unknown): void }>(),
  updates: [] as { key: string; target: number }[],
}));
const disposable = () => ({ dispose() {} });
vi.mock("vscode", () => ({
  ConfigurationTarget: { Global: 1 },
  workspace: {
    workspaceFolders: [],
    workspaceFile: { toString: () => "test://workspace/current" },
    getConfiguration: () => ({
      get: () => undefined,
      inspect: (key: string) => ({ globalValue: key === "machinePaths" ? host.registry : undefined }),
      update: async (key: string, value: unknown, target: number) => {
        host.registry = value;
        host.updates.push({ key, target });
      },
    }),
    onDidChangeConfiguration: () => disposable(),
    onDidChangeWorkspaceFolders: () => disposable(),
  },
  window: {
    registerWebviewViewProvider: (id: string, provider: { resolveWebviewView(view: unknown): void }) => {
      host.providers.set(id, provider);
      return disposable();
    },
    onDidChangeActiveTextEditor: () => disposable(),
  },
  commands: { registerCommand: () => disposable() },
}));
vi.mock("../src/config", () => ({ allWorkspaceModCandidates: () => [] }));
import { registerDashboardView } from "../src/webviews/dashboard/view";
import { readMachineSetting } from "../src/machineSettings";

beforeEach(() => {
  host.registry = undefined;
  host.providers.clear();
  host.updates = [];
});
function open() {
  const messages: { state: { paths: { source: string }[] } }[] = [];
  let receive: (message: unknown) => void = () => undefined;
  const deps = {
    getCfg: () => ({ gameId: "ck3", excludedMods: [], gamePath: null, logsPath: null, modPath: null }),
    focus: { current: () => null, pinnedRoot: () => null, onDidPin: disposable },
    errorLog: { problemCount: 0, watching: false, onDidChangeState: disposable },
    workspaceState: { get: () => undefined },
  } as unknown as DashboardDeps;
  const dashboard = registerDashboardView({ subscriptions: [] } as unknown as vscode.ExtensionContext, deps);
  host.providers.get("px.paths")!.resolveWebviewView({
    visible: true,
    webview: {
      onDidReceiveMessage: (callback: typeof receive) => {
        receive = callback;
      },
      postMessage: async (message: (typeof messages)[number]) => {
        messages.push(message);
      },
    },
    onDidDispose: disposable,
    onDidChangeVisibility: disposable,
  });
  return { dashboard, messages, receive };
}

it("keeps the Paths view available and identifies invalid personal storage", () => {
  host.registry = { version: 2 };
  const { dashboard, messages } = open();
  dashboard.refresh();
  expect(messages[0].state.paths.length).toBeGreaterThan(0);
  expect(messages[0].state.paths.every(({ source }) => source === "invalid personal paths")).toBe(true);
});

it("writes sidebar exclusions to the personal workspace binding", async () => {
  const { receive } = open();
  receive({ type: "exclude", root: "excluded-mod", excluded: true });
  await vi.waitFor(() => expect(host.updates).toEqual([{ key: "machinePaths", target: 1 }]));
  expect(readMachineSetting("excludedMods", "ck3")).toEqual(["excluded-mod"]);
});
