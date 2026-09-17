import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { URI } from "vscode-uri";
import type { DefinitionForm } from "@px-lsp/protocol/protocol";
import type { PxConfig } from "../src/config";
import type { GameMeta } from "@px-lsp/server/games/profile";
import type { SaveTargetChoice } from "../src/creators/save";
import fixture from "./fixtures/traitForm.json";

interface Posted {
  type: string;
  init?: { form: DefinitionForm };
  target?: { path: string; modLabel: string };
}
const ui = vi.hoisted(() => ({
  panels: [] as Array<{
    posted: Posted[];
    receive: (message: unknown) => void;
    close: () => void;
  }>,
  pickTarget: vi.fn<() => Promise<SaveTargetChoice | null>>(),
}));

vi.mock("vscode", async () => {
  const { URI } = await import("vscode-uri");
  const disposable = { dispose() {} };
  return {
    Uri: URI,
    ViewColumn: { Active: 1 },
    EventEmitter: class {
      event = () => disposable;
    },
    commands: { registerCommand: () => disposable },
    window: {
      createWebviewPanel: () => {
        const entry = { posted: [] as Posted[], receive: (_message: unknown) => {}, close: () => {} };
        ui.panels.push(entry);
        return {
          reveal() {},
          dispose() {},
          onDidDispose: (callback: () => void) => {
            entry.close = callback;
            return disposable;
          },
          webview: {
            html: "",
            cspSource: "test",
            asWebviewUri: (uri: URI) => uri,
            postMessage: (message: Posted) => {
              entry.posted.push(message);
              return Promise.resolve(true);
            },
            onDidReceiveMessage: (callback: (message: unknown) => void) => {
              entry.receive = callback;
              return disposable;
            },
          },
        };
      },
    },
  };
});
vi.mock("../src/webviews/devReload", () => ({
  webviewSource: () => ({ root: URI.file("/extension"), watch: false }),
  bundleUri: () => "app.js",
  watchBundle: () => ({ dispose() {} }),
}));
vi.mock("../src/webviews/tabIcons", () => ({ tabIcon: () => undefined }));
vi.mock("../src/calendarInsert", () => ({ calendarForMod: () => ({}) }));
vi.mock("../src/scaffold/command", () => ({ scaffoldPrefix: () => "test" }));
vi.mock("../src/creators/save", async (original) => ({
  ...(await original<typeof import("../src/creators/save")>()),
  pickSaveTargetChoice: () => ui.pickTarget(),
}));
vi.mock("../src/webviews/cultureCreator/catalog", () => ({
  buildCatalog: async () => ({ traditions: [], descs: {}, dlcFlags: [] }),
}));
vi.mock("../src/webviews/traditionCreator/catalog", () => ({
  buildTraditionCatalog: () => ({ costKeys: [] }),
}));

import { CultureCreatorPanel } from "../src/webviews/cultureCreator/panel";
import { TraitCreatorPanel } from "../src/webviews/traitCreator/panel";
import { TraditionCreatorPanel } from "../src/webviews/traditionCreator/panel";
import { DynastyTreePanel, type DynastyTreeActions } from "../src/webviews/dynastyTree/panel";
import { EventGraphPanel, type EventGraphActions } from "../src/webviews/eventGraph/panel";

let root: string;
let context: import("vscode").ExtensionContext;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "px-creator-targets-"));
  context = {
    globalStorageUri: URI.file(root),
    workspaceState: { get() {}, update: async () => {} },
  } as unknown as import("vscode").ExtensionContext;
  ui.panels.length = 0;
  ui.pickTarget.mockReset();
});
afterEach(() => {
  for (const panel of ui.panels) panel.close();
  fs.rmSync(root, { recursive: true, force: true });
});
function cfg(mod: string): PxConfig {
  return {
    gameId: "ck3",
    modPath: path.join(root, mod),
    gamePath: null,
    parentPaths: [],
    workspaceMods: [],
    locLanguage: "english",
  } as unknown as PxConfig;
}
function form(mod: string, kind: string, file = "source.txt"): DefinitionForm {
  return {
    ...fixture,
    kind,
    folder: `common/${kind}`,
    current: {
      file: path.join(root, mod, "common", kind, file),
      line: 0,
      source: "mod",
      text: "same_key = {}",
    },
  } as DefinitionForm;
}
async function initialized(count: number) {
  await vi.waitFor(() =>
    expect(ui.panels[0].posted.filter((message) => message.type === "init")).toHaveLength(count)
  );
}

it("reuses the culture panel with the new clicked-source callbacks for a duplicate name", async () => {
  const a = vi.fn(async () => form("A", "culture"));
  const b = vi.fn(async () => form("B", "culture"));
  const actions = { applyEdits: vi.fn(), lookupLoc: vi.fn() };
  CultureCreatorPanel.show(context, cfg("A"), { ...actions, fetchForm: a }, "same_key");
  ui.panels[0].receive({ type: "ready" });
  await initialized(1);
  CultureCreatorPanel.show(context, cfg("B"), { ...actions, fetchForm: b }, "same_key");
  await initialized(2);
  expect(ui.panels).toHaveLength(1);
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).toHaveBeenCalledWith({ kind: "culture", modRoot: cfg("B").modPath, name: "same_key" });
  expect(
    ui.panels[0].posted.filter((message) => message.type === "init").at(-1)?.init?.form.current?.file
  ).toBe(form("B", "culture").current!.file);
});

describe.each([
  ["trait", TraitCreatorPanel],
  ["culture_tradition", TraditionCreatorPanel],
] as const)("%s panel save target", (kind, Panel) => {
  it("preserves an intentional same-form choice and resets for another mod or source", async () => {
    const options = (mod: string, file = "source.txt") => ({
      cfg: cfg(mod),
      meta: { name: "Test" } as GameMeta,
      name: "same_key",
      lookupLoc: vi.fn(),
      actions: { fetchForm: vi.fn(async () => form(mod, kind, file)), editDefinition: vi.fn() },
    });
    Panel.show(context, options("A"));
    const panel = ui.panels[0];
    panel.receive({ type: "ready" });
    await initialized(1);
    ui.pickTarget.mockResolvedValue({ modPath: cfg("A").modPath!, modLabel: "A", file: "chosen.txt" });
    panel.receive({ type: "changeTarget" });
    await vi.waitFor(() => expect(panel.posted.at(-1)?.target?.path).toBe(`common/${kind}/chosen.txt`));
    Panel.show(context, options("A"));
    await initialized(2);
    expect(panel.posted.at(-1)?.target?.path).toBe(`common/${kind}/chosen.txt`);
    Panel.show(context, options("B"));
    await initialized(3);
    expect(panel.posted.at(-1)?.target).toEqual({ modLabel: "B", path: `common/${kind}/source.txt` });
    ui.pickTarget.mockResolvedValue({ modPath: cfg("B").modPath!, modLabel: "B", file: "chosen.txt" });
    panel.receive({ type: "changeTarget" });
    await vi.waitFor(() => expect(panel.posted.at(-1)?.target?.path).toBe(`common/${kind}/chosen.txt`));
    Panel.show(context, options("B", "other-source.txt"));
    await initialized(4);
    expect(panel.posted.at(-1)?.target?.path).toBe(`common/${kind}/other-source.txt`);
  });
});

it("replaces graph callbacks when reopening the singleton for another mod", async () => {
  const graph = { nodes: [], edges: [], truncated: false };
  const firstFetch = vi.fn(async () => graph);
  const secondFetch = vi.fn(async () => graph);
  const firstDetail = vi.fn(async () => null);
  const secondDetail = vi.fn(async () => null);
  const actions = (fetchDetail: typeof firstDetail) =>
    ({
      fetchDetail,
      textureRoots: () => ({ gamePath: null, modPath: null }),
    }) as unknown as EventGraphActions;
  EventGraphPanel.show(context, firstFetch, { modRoot: cfg("A").modPath }, actions(firstDetail));
  EventGraphPanel.show(context, secondFetch, { modRoot: cfg("B").modPath }, actions(secondDetail));
  ui.panels[0].receive({ type: "select", id: "same_key", file: "/B/source.txt" });
  await vi.waitFor(() => expect(secondDetail).toHaveBeenCalledWith("same_key", "/B/source.txt"));
  expect(firstDetail).not.toHaveBeenCalled();
  expect(secondFetch).toHaveBeenCalledWith({ modRoot: cfg("B").modPath });
  expect(firstFetch).not.toHaveBeenCalled();
});

it("replaces dynasty callbacks when reopening the same dynasty in another mod", async () => {
  const result = { supported: true, dynasties: [] };
  const firstFetch = vi.fn(async () => result);
  const secondFetch = vi.fn(async () => result);
  const options = (mod: string) => ({
    cfg: cfg(mod),
    meta: { name: "Test" } as GameMeta,
    mods: [],
    modRoot: cfg(mod).modPath,
  });
  DynastyTreePanel.show(context, { fetchTree: firstFetch } as unknown as DynastyTreeActions, options("A"));
  ui.panels[0].receive({ type: "open", dynasty: "same_key" });
  await vi.waitFor(() =>
    expect(firstFetch).toHaveBeenCalledWith({ modRoot: cfg("A").modPath, dynasty: "same_key" })
  );
  DynastyTreePanel.show(
    context,
    { fetchTree: secondFetch } as unknown as DynastyTreeActions,
    options("B"),
    "same_key"
  );
  await vi.waitFor(() =>
    expect(secondFetch).toHaveBeenCalledWith({ modRoot: cfg("B").modPath, dynasty: "same_key" })
  );
  expect(firstFetch).toHaveBeenCalledTimes(1);
  expect(ui.panels).toHaveLength(1);
});
