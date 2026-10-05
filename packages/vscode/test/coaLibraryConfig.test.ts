import { beforeEach, expect, it, vi } from "vitest";
import type { Uri } from "vscode";
import { getMachineSetting, setMachineSetting, type MachineSettings } from "@px-lsp/protocol/machineSettings";

const state = vi.hoisted(() => ({
  registry: { version: 1 } as MachineSettings,
  picked: undefined as string | undefined,
  posts: [] as unknown[],
}));
vi.mock("vscode", () => ({
  ConfigurationTarget: { Global: 1 },
  Uri: { file: (root: string) => ({ fsPath: root, toString: () => `test://${root}` }) },
  workspace: {
    workspaceFile: { toString: () => "test://workspace" },
    workspaceFolders: [],
    getWorkspaceFolder: (resource: Uri) => ({ uri: resource }),
    getConfiguration: () => ({
      inspect: (key: string) => (key === "machinePaths" ? { globalValue: state.registry } : {}),
      update: async (_key: string, registry: MachineSettings) => {
        state.registry = registry;
      },
    }),
  },
  window: {
    showOpenDialog: async () => (state.picked ? [{ fsPath: state.picked }] : undefined),
  },
}));
vi.mock("../src/webviews/guiEditor/textureCache", () => ({ GuiTextureCache: class {} }));
vi.mock("../src/scaffold/command", () => ({ scaffoldPrefix: () => "" }));
import { coaLibraryDir, gameDocsSubdir, COA_LIBRARY_SUBDIR } from "../src/config";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { CoaDesignerPanel } from "../src/webviews/coaDesigner/panel";
import type { AppToHost } from "../src/webviews/coaDesigner/messages";

const mod = { fsPath: "mod", toString: () => "test://mod" } as Uri;
const identity = { workspaceUri: "test://workspace", folderUri: "test://mod" };
const panel = () =>
  Object.assign(Object.create(CoaDesignerPanel.prototype), {
    options: { meta: ck3Meta, cfg: { modPath: "mod" } },
    panel: { webview: { postMessage: (message: unknown) => state.posts.push(message) } },
  }) as { onMessage(message: AppToHost): Promise<void>; libraryState(): { dir: string; chosen: boolean } };

beforeEach(() => {
  state.registry = setMachineSetting(
    { version: 1 },
    "coaLibraryDir",
    "workspace-library",
    "ck3",
    "workspace",
    identity
  );
  state.registry = setMachineSetting(
    state.registry,
    "coaLibraryDir",
    "mod-library",
    "ck3",
    "folder",
    identity
  );
  state.picked = undefined;
  state.posts = [];
});

it("resolves the selected mod's library while preserving no-resource behavior", () => {
  expect(coaLibraryDir(ck3Meta, mod)).toBe("mod-library");
  expect(coaLibraryDir(ck3Meta)).toBe("workspace-library");
  expect(panel().libraryState()).toEqual({ dir: "mod-library", chosen: true });
});

it("uses the automatic Documents library for an empty folder override", () => {
  state.registry = setMachineSetting(state.registry, "coaLibraryDir", "", "ck3", "folder", identity);
  const automatic = gameDocsSubdir(ck3Meta, COA_LIBRARY_SUBDIR);
  expect(coaLibraryDir(ck3Meta, mod)).toBe(automatic);
  expect(coaLibraryDir(ck3Meta)).toBe("workspace-library");
  expect(panel().libraryState()).toEqual({ dir: automatic, chosen: false });
});

it("the designer folder picker updates the active mod binding", async () => {
  state.picked = "picked-library";
  const designer = panel();
  await designer.onMessage({ type: "libraryDir" });
  expect(getMachineSetting(state.registry, "coaLibraryDir", "ck3", "folder", identity)).toBe(
    "picked-library"
  );
  expect(getMachineSetting(state.registry, "coaLibraryDir", "ck3", "workspace", identity)).toBe(
    "workspace-library"
  );
  expect(getMachineSetting(state.registry, "coaLibraryDir", "ck3", "default", identity)).toBeUndefined();
  expect(designer.libraryState()).toEqual({ dir: "picked-library", chosen: true });
});
