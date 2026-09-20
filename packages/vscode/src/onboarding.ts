import * as vscode from "vscode";
import { gameDocsSubdir, readConfig } from "./config";
import { addModToWorkspace } from "./modProjects/addToWorkspace";
import { chooseModDestination } from "./modProjects/open";
import { GAME_METAS } from "./gameDetect";
import { discoverMods, modInFolder, type ModLocation } from "./modProjects/discover";

const WALKTHROUGH = "JDeffner.px-toolkit#px.gettingStarted";
const TUTORIAL_STEPS = ["mod", "setup", "explore", "overview", "tiger", "scriptdocs", "advanced"];

/** The native walkthrough hides its media pane in narrow editor groups. */
export async function readTutorialStep(extensionUri: vscode.Uri, step: unknown): Promise<void> {
  if (typeof step !== "string" || !TUTORIAL_STEPS.includes(step)) return;
  await vscode.commands.executeCommand(
    "markdown.showPreview",
    vscode.Uri.joinPath(extensionUri, "media", "walkthrough", `${step}.md`)
  );
}

export async function openModCommand(log: (message: string) => void): Promise<void> {
  try {
    const locations: ModLocation[] = Object.values(GAME_METAS).flatMap((meta) => {
      const folder = gameDocsSubdir(meta, "mod");
      return folder ? [{ folder, label: meta.name, launcher: true }] : [];
    });
    const projects = vscode.workspace.getConfiguration("px").get<string>("modProjectsDir")?.trim();
    if (projects) locations.unshift({ folder: projects, label: "Mod projects" });
    const { mods, issues } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Finding local mods" },
      () => discoverMods(locations)
    );
    for (const issue of issues) log(`Find Existing Mod: ${issue}`);
    type Choice = vscode.QuickPickItem & { folder?: string; action?: "browse" | "create" };
    const choices: Choice[] = [
      ...mods.map((mod) => ({
        label: mod.name,
        description: mod.location,
        detail: mod.folder,
        folder: mod.folder,
      })),
      {
        label: "Browse for a mod or project folder...",
        detail: "Use a custom location or a cloned repository.",
        action: "browse",
      },
      {
        label: "Create a new mod...",
        detail: "Choose a game and name. The toolkit finds its mod folder.",
        action: "create",
      },
    ];
    const choice = await vscode.window.showQuickPick(choices, {
      title: "Find Existing Mod",
      placeHolder: issues.length
        ? "Some locations could not be read. Browse manually; details are in Output."
        : mods.length
          ? "Choose a local mod, or browse to a project you already know"
          : "No local mods found. Browse to yours or create your first mod.",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!choice) return;
    if (choice.action === "create") {
      await vscode.commands.executeCommand("px.createMod");
      return;
    }
    let folder = choice.folder;
    if (choice.action === "browse") {
      const selected = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        title: "Open the mod itself, or a project containing a mod folder",
        openLabel: "Open Mod",
        defaultUri: locations[0] ? vscode.Uri.file(locations[0].folder) : undefined,
      });
      folder = selected?.[0]?.fsPath;
    }
    if (!folder) return;
    if (!(await modInFolder(folder))) {
      const retry = await vscode.window.showWarningMessage(
        "This folder is not a mod project. Choose the folder with descriptor.mod, .metadata/metadata.json or mod content, not the game installation or the folder holding all your mods.",
        "Choose Another Folder"
      );
      if (retry) await openModCommand(log);
      return;
    }
    await chooseModDestination(folder);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Could not open the mod: ${error instanceof Error ? error.message : String(error)}. Try Find Existing Mod again or open its folder from File > Open Folder.`
    );
  }
}

export function registerOnboarding(context: vscode.ExtensionContext, log: (message: string) => void): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("px.getStarted", () =>
      vscode.commands.executeCommand("workbench.action.openWalkthrough", WALKTHROUGH, false)
    ),
    vscode.commands.registerCommand("px.openMod", () => openModCommand(log)),
    vscode.commands.registerCommand("px.addModToWorkspace", () => addModToWorkspace(readConfig(), log)),
    vscode.commands.registerCommand("px.startFirstMod", startFirstMod),
    vscode.commands.registerCommand("px.readTutorialStep", (step: unknown) =>
      readTutorialStep(context.extensionUri, step)
    ),
    vscode.window.registerTreeDataProvider("px.welcome", {
      getChildren: () => [],
      getTreeItem: (item: vscode.TreeItem) => item,
    })
  );
}

export async function startFirstMod(): Promise<void> {
  const config = vscode.workspace.getConfiguration("px");
  await config.update("scopeInlayHints", true, vscode.ConfigurationTarget.Global);
  if (config.inspect("scopeInlayHints")?.workspaceValue !== undefined)
    await config.update("scopeInlayHints", true, vscode.ConfigurationTarget.Workspace);
  await vscode.commands.executeCommand("px.createMod");
}
