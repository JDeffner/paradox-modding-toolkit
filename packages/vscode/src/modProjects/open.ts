import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import { modInFolder } from "./discover";

/** Resolve launcher links and project/content aliases before adding a root. */
export async function addFolderToWorkspace(folder: string): Promise<void> {
  const identity = async (dir: string) => {
    const resolved = await fs.realpath((await modInFolder(dir)) ?? dir);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const target = await identity(folder);
  const existing = vscode.workspace.workspaceFolders ?? [];
  for (const root of existing) {
    if (root.uri.scheme === "file" && (await identity(root.uri.fsPath)) === target) {
      void vscode.window.showInformationMessage("This folder is already in the workspace.");
      return;
    }
  }
  if (!vscode.workspace.updateWorkspaceFolders(existing.length, 0, { uri: vscode.Uri.file(folder) })) {
    void vscode.window.showErrorMessage(
      `Could not add ${folder} to the workspace. Wait for any pending workspace change, then try again.`
    );
  }
}

/** Both welcome actions make the destination explicit before changing windows. */
export async function chooseModDestination(folder: string, created = false): Promise<void> {
  const destinations = [
    {
      label: "Add to Current Workspace",
      detail: "Keep this window and add the mod to Explorer.",
      destination: "workspace",
    },
    {
      label: "Open in New Window",
      detail: "Open a separate window and keep this one available.",
      destination: "window",
    },
  ];
  let choice = await vscode.window.showQuickPick(destinations, {
    title: created ? "Mod Created: Choose Where to Open It" : "Open Mod",
    placeHolder: folder,
    ignoreFocusOut: created,
  });
  // Creation has already succeeded. Dismissing the picker must leave a visible
  // path and a way to open the files without repeating the creation wizard.
  if (!choice && created) {
    const action = await vscode.window.showInformationMessage(
      `Mod created at ${folder}. Choose where to open it.`,
      ...destinations.map((item) => item.label)
    );
    choice = destinations.find((item) => item.label === action);
  }
  if (!choice) return;
  try {
    if (choice.destination === "workspace") {
      // Adding the first folder restarts the extension host, so select Explorer first.
      if (created) await vscode.commands.executeCommand("workbench.view.explorer");
      await addFolderToWorkspace(folder);
    } else if (choice.destination === "window")
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(folder), {
        forceNewWindow: true,
      });
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Could not open the mod at ${folder}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
