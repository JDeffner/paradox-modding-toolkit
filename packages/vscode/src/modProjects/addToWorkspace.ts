import * as vscode from "vscode";
import * as path from "node:path";
import { gameDocsSubdir, type PxConfig } from "../config";
import { addFolderToWorkspace } from "./open";
import { detectGameId } from "../gameDetect";
import { metaFor } from "../meta";
import { findGameFolder, findSteamLibraries } from "../steamDetect";
import { discoverMods, modInFolder, type ModLocation } from "./discover";

/** Add another root without replacing the current workspace or opening a window. */
export async function addModToWorkspace(cfg: PxConfig, log: (message: string) => void): Promise<void> {
  const meta = metaFor(cfg.gameId);
  const source = await vscode.window.showQuickPick(
    [
      {
        label: "Documents mod folder",
        source: "documents",
        detail: `Local ${meta.name} mods and launcher links.`,
      },
      {
        label: "Mod projects folder",
        source: "projects",
        detail: "Projects in your configured mod projects folder.",
      },
      {
        label: "Steam Workshop",
        source: "workshop",
        detail: `Subscribed ${meta.name} mods. Steam may replace these files when it updates them.`,
      },
      { label: "Base game", source: "game", detail: `Add the ${meta.name} game data folder for reference.` },
    ],
    { title: "Add to Workspace", placeHolder: "Where do you want to find the mod?" }
  );
  if (!source) return;
  try {
    let folder: string | undefined;
    if (source.source === "game") {
      folder = cfg.gamePath ?? findGameFolder(meta.name) ?? undefined;
      if (!folder) {
        void vscode.window.showWarningMessage(`Could not find ${meta.name}. Run Choose Game Folder first.`);
        return;
      }
    } else {
      let locations: ModLocation[];
      if (source.source === "documents") {
        const documents = gameDocsSubdir(meta, "mod");
        locations = documents ? [{ folder: documents, label: meta.name, launcher: true }] : [];
      } else if (source.source === "workshop") {
        locations = findSteamLibraries().map((library) => ({
          folder: path.join(library, "steamapps", "workshop", "content", String(meta.steamAppId)),
          label: "Steam Workshop",
          workshop: true,
        }));
      } else {
        const projects = vscode.workspace.getConfiguration("px").get<string>("modProjectsDir")?.trim();
        if (!projects) {
          const action = await vscode.window.showInformationMessage(
            "Set your mod projects folder before searching it.",
            "Open Setting"
          );
          if (action)
            await vscode.commands.executeCommand("workbench.action.openSettings", "px.modProjectsDir");
          return;
        }
        locations = [{ folder: projects, label: "Mod projects" }];
      }
      const { mods, issues } = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "Finding mods" },
        () => discoverMods(locations)
      );
      for (const issue of issues) log(`Add to Workspace: ${issue}`);
      const candidates = [];
      for (const mod of mods) {
        const content = await modInFolder(mod.folder);
        if (content && detectGameId("auto", content) === meta.id) candidates.push(mod);
      }
      const picked = await vscode.window.showQuickPick(
        candidates.map((mod) => ({ label: mod.name, detail: mod.folder, folder: mod.folder })),
        {
          title: `Add ${meta.name} Mod to Workspace`,
          placeHolder: issues.length
            ? "Some locations could not be read; details are in Output."
            : candidates.length
              ? "Choose a mod to add to this window"
              : "No mods for this game found in this location",
          matchOnDetail: true,
        }
      );
      folder = picked?.folder;
    }
    if (!folder) return;
    await addFolderToWorkspace(folder);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Could not add the folder: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
