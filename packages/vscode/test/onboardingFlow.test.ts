import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { devPath } from "../../../scripts/devPaths";
import type { PxConfig } from "../src/config";
import manifest from "../package.json";

const state = vi.hoisted(() => ({
  root: "",
  settings: {} as Record<string, unknown>,
  folders: [] as unknown[],
}));
vi.mock("vscode", () => ({
  Uri: {
    file: (fsPath: string) => ({ fsPath, scheme: "file" }),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: path.join(base.fsPath, ...parts),
      scheme: "file",
    }),
  },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  ProgressLocation: { Window: 10, Notification: 15 },
  commands: {
    executeCommand: vi.fn(async () => undefined),
    registerCommand: vi.fn(() => ({ dispose() {} })),
  },
  workspace: {
    get workspaceFolders() {
      return state.folders;
    },
    getConfiguration: () => ({
      get: (key: string) => state.settings[key],
      update: vi.fn(async (key, value) => {
        state.settings[key] = value;
      }),
      inspect: () => ({}),
    }),
    updateWorkspaceFolders: vi.fn(),
  },
  window: {
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
    showOpenDialog: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    withProgress: vi.fn(async (_options, task) => task({ report() {} })),
    registerTreeDataProvider: vi.fn(() => ({ dispose() {} })),
  },
}));
vi.mock("../src/config", () => ({
  gameDocsSubdir: (meta: { id: string }) => path.join(state.root, meta.id, "mod"),
}));
vi.mock("../src/steamDetect", () => ({
  findGameFolder: vi.fn(() => null),
  findSteamLibraries: vi.fn(() => []),
}));
vi.mock("../src/descriptorMod", () => ({ detectGameVersion: vi.fn(() => null) }));
import * as vscode from "vscode";
import { openModCommand, readTutorialStep, startFirstMod } from "../src/onboarding";
import { addModToWorkspace } from "../src/modProjects/addToWorkspace";
import { createModCommand } from "../src/modProjects/command";
import { runSetup, selectGameFolder } from "../src/setup";

const cfg = {
  gameId: "ck3",
  gamePath: null,
  modPath: null,
  workspaceMods: [],
  parentPaths: [],
  isCk3Workspace: false,
} as unknown as PxConfig;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(vscode.window.showQuickPick).mockReset();
  vi.mocked(vscode.window.showInformationMessage).mockReset();
  vi.mocked(vscode.commands.executeCommand).mockReset().mockResolvedValue(undefined);
  vi.mocked(vscode.workspace.updateWorkspaceFolders).mockReset().mockReturnValue(true);
  state.settings = {};
  state.folders = [];
  await fs.mkdir(path.resolve(".local/testing"), { recursive: true });
  state.root = await fs.mkdtemp(path.resolve(".local/testing/onboarding-"));
});
afterEach(async () => {
  await fs.rm(state.root, { recursive: true, force: true });
});

it("exposes start actions before detection and puts the mod before optional tools", () => {
  expect(manifest.contributes.views.px.find((view) => view.id === "px.welcome")?.when).toBe(
    "!px.isCk3Workspace"
  );
  const welcome = manifest.contributes.viewsWelcome.find((view) => view.view === "px.welcome")!.contents;
  for (const command of ["px.createMod", "px.openMod", "px.getStarted"])
    expect(welcome).toContain(`command:${command}`);
  const steps = manifest.contributes.walkthroughs[0].steps;
  expect(steps[0].id).toBe("px.step.mod");
  expect(steps.findIndex((step) => step.id === "px.step.explore")).toBeLessThan(
    steps.findIndex((step) => step.id === "px.step.scriptdocs")
  );
});

it("leaves an empty window unchanged when discovery is cancelled", async () => {
  vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);
  await openModCommand(() => undefined);
  expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ action: "create" })]),
    expect.objectContaining({ placeHolder: expect.stringContaining("No local mods found") })
  );
  expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  expect(await fs.readdir(state.root)).toEqual([]);
});

it("opens every tutorial step's packaged instructions independently of the walkthrough layout", async () => {
  for (const step of manifest.contributes.walkthroughs[0].steps) {
    const match = step.description.match(/command:px\.readTutorialStep\?([^)]*)/);
    expect(match, step.id).not.toBeNull();
    const [name] = JSON.parse(decodeURIComponent(match![1]));
    await readTutorialStep(vscode.Uri.file(path.resolve("packages/vscode")), name);
    const file = path.resolve("packages/vscode", step.media.markdown);
    expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
      "markdown.showPreview",
      expect.objectContaining({ fsPath: file })
    );
    expect(await fs.readFile(file, "utf8")).toMatch(/^# /);
  }
});

it("does not open arbitrary files through the tutorial command", async () => {
  for (const step of [undefined, 1, "../setup", "../../package.json", "unknown"])
    await readTutorialStep(vscode.Uri.file(state.root), step);
  expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
});

it.each(["workspace", "window", "cancel"])(
  "opens a discovered mod with destination %s",
  async (destination) => {
    const folder = path.join(state.root, "ck3/mod/example");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, "descriptor.mod"), 'name="Found Example"\n');
    state.folders = [{ uri: vscode.Uri.file(state.root) }];
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items, options) => {
      const choices = await items;
      if (options?.title === "Open Mod") {
        expect(choices).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ label: "Add to Current Workspace" }),
            expect.objectContaining({ label: "Open in New Window" }),
          ])
        );
        return choices.find(
          (item) => typeof item !== "string" && "destination" in item && item.destination === destination
        ) as never;
      }
      return choices[0] as never;
    });
    await openModCommand(() => undefined);
    if (destination === "window")
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "vscode.openFolder",
        expect.objectContaining({ fsPath: folder }),
        { forceNewWindow: true }
      );
    else expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    if (destination === "workspace")
      expect(vscode.workspace.updateWorkspaceFolders).toHaveBeenCalledWith(1, 0, {
        uri: expect.objectContaining({ fsPath: folder }),
      });
    else expect(vscode.workspace.updateWorkspaceFolders).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(folder, "descriptor.mod"), "utf8")).toContain("Found Example");
  }
);

it("rejects a non-mod browse selection without changing folders", async () => {
  vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ action: "browse" } as never);
  vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([vscode.Uri.file(state.root)]);
  vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
  await openModCommand(() => undefined);
  expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
    expect.stringContaining("not a mod project"),
    "Choose Another Folder"
  );
  expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
});

it.each(
  ["ck3", "vic3", "eu5"].flatMap((gameId) =>
    ["workspace", "window", "cancel"].map((destination) => ({ gameId, destination }))
  )
)(
  "creates a $gameId mod with launcher registration and destination $destination",
  async ({ gameId, destination }) => {
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items, options) => {
      expect(options?.ignoreFocusOut).toBe(true);
      const choices = (await items) as unknown as {
        meta?: { id: string };
        mode?: string;
        destination?: string;
      }[];
      return choices.find((item) =>
        options?.title === "Which game?"
          ? item.meta?.id === gameId
          : options?.title === "New Mod: location"
            ? item.mode === "game"
            : item.destination === destination
      ) as never;
    });
    vi.mocked(vscode.window.showInputBox).mockResolvedValue("First Mod");
    await createModCommand(cfg, () => undefined);
    expect(vscode.window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({ ignoreFocusOut: true })
    );
    const folder = path.join(state.root, gameId, "mod/first_mod");
    expect(JSON.parse(await fs.readFile(path.join(folder, ".vscode/settings.json"), "utf8"))).toEqual({
      "px.gameId": gameId,
    });
    const descriptor = gameId === "ck3" ? "descriptor.mod" : ".metadata/metadata.json";
    expect(await fs.readFile(path.join(folder, descriptor), "utf8")).toContain("First Mod");
    if (gameId === "ck3")
      expect(await fs.readFile(path.join(state.root, gameId, "mod/first_mod.mod"), "utf8")).toContain(
        folder.replaceAll("\\", "/")
      );
    if (destination === "window")
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "vscode.openFolder",
        expect.objectContaining({ fsPath: folder }),
        { forceNewWindow: true }
      );
    else if (destination === "workspace")
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith("workbench.view.explorer");
    else expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    if (destination === "workspace")
      expect(vscode.workspace.updateWorkspaceFolders).toHaveBeenCalledWith(0, 0, {
        uri: expect.objectContaining({ fsPath: folder }),
      });
    else expect(vscode.workspace.updateWorkspaceFolders).not.toHaveBeenCalled();
    if (destination === "cancel")
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining(folder),
        "Add to Current Workspace",
        "Open in New Window"
      );
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  }
);

it.each(["Add to Current Workspace", "Open in New Window"])(
  "recovers a first mod from the creation notification with %s",
  async (action) => {
    vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command) => {
      if (command === "px.createMod") await createModCommand(cfg, () => undefined);
      return undefined;
    });
    vi.mocked(vscode.window.showInputBox).mockResolvedValue("First Mod");
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items, options) => {
      const choices = (await items) as unknown as { meta?: { id: string }; mode?: string }[];
      if (options?.title === "Which game?") return choices.find((item) => item.meta?.id === "ck3") as never;
      if (options?.title === "New Mod: location")
        return choices.find((item) => item.mode === "game") as never;
      expect(options?.ignoreFocusOut).toBe(true);
      return undefined;
    });
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(action as never);
    await startFirstMod();
    const folder = path.join(state.root, "ck3/mod/first_mod");
    expect(await fs.readFile(path.join(folder, "descriptor.mod"), "utf8")).toContain("First Mod");
    if (action === "Add to Current Workspace")
      expect(vscode.workspace.updateWorkspaceFolders).toHaveBeenCalledWith(0, 0, {
        uri: expect.objectContaining({ fsPath: folder }),
      });
    else
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "vscode.openFolder",
        expect.objectContaining({ fsPath: folder }),
        { forceNewWindow: true }
      );
  }
);

it("preserves an existing launcher link and creates no partial mod when the name is taken", async () => {
  const mods = path.join(state.root, "ck3/mod");
  await fs.mkdir(mods, { recursive: true });
  await fs.writeFile(path.join(mods, "first_mod.mod"), "keep this link");
  vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ mode: "game" } as never);
  vi.mocked(vscode.window.showInputBox).mockResolvedValue("First Mod");
  await createModCommand({ ...cfg, isCk3Workspace: true }, () => undefined);
  expect(await fs.readFile(path.join(mods, "first_mod.mod"), "utf8")).toBe("keep this link");
  expect(await fs.readdir(mods)).toEqual(["first_mod.mod"]);
  expect(vscode.window.showErrorMessage).toHaveBeenCalled();
});

it.each(["workspace", "window"])(
  "keeps the created mod and reports its path when opening in %s fails",
  async (destination) => {
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items, options) => {
      const choices = (await items) as unknown as { mode?: string; destination?: string }[];
      return options?.title === "New Mod: location"
        ? (choices.find((item) => item.mode === "game") as never)
        : undefined;
    });
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
      (destination === "workspace" ? "Add to Current Workspace" : "Open in New Window") as never
    );
    vi.mocked(vscode.window.showInputBox).mockResolvedValue("First Mod");
    vi.mocked(vscode.workspace.updateWorkspaceFolders).mockReturnValue(false);
    vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command) => {
      if (command === "vscode.openFolder") throw new Error("Window unavailable");
      return undefined;
    });
    await createModCommand({ ...cfg, isCk3Workspace: true }, () => undefined);
    const folder = path.join(state.root, "ck3/mod/first_mod");
    expect(await fs.readFile(path.join(folder, "descriptor.mod"), "utf8")).toContain("First Mod");
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining(folder));
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalledWith(
      expect.stringContaining("failed to create")
    );
    if (destination === "workspace") expect(vscode.workspace.updateWorkspaceFolders).toHaveBeenCalled();
  }
);

it("does not create files or report success when creation is canceled before choosing a location", async () => {
  vi.mocked(vscode.window.showInputBox).mockResolvedValue("First Mod");
  vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);
  await createModCommand({ ...cfg, isCk3Workspace: true }, () => undefined);
  expect(await fs.readdir(state.root)).toEqual([]);
  expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  expect(vscode.workspace.updateWorkspaceFolders).not.toHaveBeenCalled();
});

const gamePath = devPath("gamePath");
const tigerPath = devPath("tigerPath");
it.skipIf(!gamePath || !tigerPath)(
  "validates a newly created scratch mod with real ck3-tiger",
  async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ mode: "game" } as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue("Onboarding Validator Probe");
    await createModCommand({ ...cfg, gamePath, isCk3Workspace: true }, () => undefined);
    const mod = path.join(state.root, "ck3/mod/onboarding_validator_probe");
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    const result = execFileSync(tigerPath!, ["--json", "--ck3", path.dirname(gamePath!), mod], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
    });
    expect(JSON.parse(result)).toEqual([]);
  },
  65_000
);

it("does not detect or configure a default game when setup runs outside a mod", async () => {
  const refresh = vi.fn();
  vi.mocked(vscode.window.showInformationMessage).mockResolvedValue("Find Existing Mod" as never);
  await runSetup({ getConfig: () => cfg, refresh, storageDir: state.root, log() {}, showOutput() {} });
  expect(refresh).not.toHaveBeenCalled();
  expect(vscode.commands.executeCommand).toHaveBeenCalledWith("px.openMod");
});

it("rejects a missing game-data folder without refreshing configuration", async () => {
  const refresh = vi.fn();
  vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([vscode.Uri.file(state.root)]);
  await selectGameFolder({
    getConfig: () => ({ ...cfg, isCk3Workspace: true }),
    refresh,
    storageDir: state.root,
    log() {},
    showOutput() {},
  });
  expect(refresh).not.toHaveBeenCalled();
  expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
    expect.stringContaining("Your setting was not changed")
  );
});

it("enables scope hints only through the first-mod tutorial action", async () => {
  await startFirstMod();
  expect(state.settings.scopeInlayHints).toBe(true);
  expect(vscode.commands.executeCommand).toHaveBeenCalledWith("px.createMod");
});

it.each(["ck3", "vic3", "eu5"])(
  "adds a discovered %s project to the current workspace without opening a window",
  async (gameId) => {
    const project = path.join(state.root, "projects/Example");
    const content = path.join(project, "mod");
    await fs.mkdir(content, { recursive: true });
    if (gameId === "ck3") await fs.writeFile(path.join(content, "descriptor.mod"), 'name="Example"');
    else {
      await fs.mkdir(path.join(content, ".metadata"));
      await fs.writeFile(
        path.join(content, ".metadata/metadata.json"),
        JSON.stringify({ name: "Example", id: "example", version: "1" })
      );
      if (gameId === "eu5") await fs.mkdir(path.join(content, "in_game"));
    }
    state.settings.modProjectsDir = path.join(state.root, "projects");
    state.folders = [{ uri: vscode.Uri.file(state.root) }];
    vi.mocked(vscode.workspace.updateWorkspaceFolders).mockReturnValue(true);
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items, options) => {
      const choices = await items;
      return (
        options?.title === "Add to Workspace"
          ? choices.find((item) => typeof item !== "string" && "source" in item && item.source === "projects")
          : choices[0]
      ) as never;
    });
    await addModToWorkspace({ ...cfg, gameId }, () => undefined);
    expect(vscode.workspace.updateWorkspaceFolders).toHaveBeenCalledWith(1, 0, {
      uri: expect.objectContaining({ fsPath: project }),
    });
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    state.folders = [{ uri: vscode.Uri.file(content) }];
    vi.mocked(vscode.workspace.updateWorkspaceFolders).mockClear();
    await addModToWorkspace({ ...cfg, gameId }, () => undefined);
    expect(vscode.workspace.updateWorkspaceFolders).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "This folder is already in the workspace."
    );
  }
);

it("adds the configured base game and reports a rejected workspace change", async () => {
  const game = path.join(state.root, "game");
  await fs.mkdir(game);
  vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ source: "game" } as never);
  vi.mocked(vscode.workspace.updateWorkspaceFolders).mockReturnValue(false);
  await addModToWorkspace({ ...cfg, gamePath: game }, () => undefined);
  expect(vscode.workspace.updateWorkspaceFolders).toHaveBeenCalledWith(0, 0, {
    uri: expect.objectContaining({ fsPath: game }),
  });
  expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Could not add"));
});

it("cancels source selection without adding folders", async () => {
  vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);
  await addModToWorkspace(cfg, () => undefined);
  expect(vscode.workspace.updateWorkspaceFolders).not.toHaveBeenCalled();
});
