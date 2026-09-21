/**
 * `Paradox: Run Setup & Health Check` — one command that detects everything it can (Steam install,
 * logs folder, tiger), writes the settings, and reports what remains for the
 * user with concrete instructions. Re-runnable as a health check.
 */
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PxConfig } from "./config";
import type { StatusPayload } from "@px-lsp/protocol/protocol";
import { dataHealthLines } from "./dataHealth";
import { readModName } from "@px-lsp/protocol/modName";
import { findGameFolder } from "./steamDetect";
import { downloadLatestTiger, findDownloadedTiger, tigerFlavorFor } from "./tigerDownload";
import { StartupNotices } from "./notifications";
import { metaFor, scriptDocsDir } from "./meta";

export interface SetupDeps {
  storageDir: string;
  getConfig: () => PxConfig;
  /** Re-read config and rebuild data (called after settings were written). */
  refresh: () => Promise<StatusPayload>;
  log: (msg: string) => void;
  /** Reveal the Paradox Modding Toolkit output channel (where the report lands). */
  showOutput: () => void;
}

export async function selectGameFolder(deps: SetupDeps): Promise<void> {
  const cfg = deps.getConfig();
  if (!cfg.isCk3Workspace) {
    await vscode.commands.executeCommand("px.getStarted");
    return;
  }
  const meta = metaFor(cfg.gameId);
  const selected = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    title: `Choose the ${meta.name} installation or game data folder`,
    openLabel: "Use Game Folder",
  });
  if (!selected?.length) return;
  const chosen = selected[0].fsPath;
  const isData = (folder: string) =>
    !fs.existsSync(path.join(folder, "descriptor.mod")) &&
    !fs.existsSync(path.join(folder, ".metadata", "metadata.json")) &&
    ["common", ...(meta.stageRoots ?? []).map((stage) => path.join(stage, "common"))].some((relative) => {
      try {
        return fs.statSync(path.join(folder, relative)).isDirectory();
      } catch {
        return false;
      }
    });
  const folder = [path.join(chosen, "game"), chosen].find(isData);
  if (!folder) {
    void vscode.window.showWarningMessage(
      `No ${meta.shortName} game data found here. Choose the installed game folder, not its Documents folder. Your setting was not changed.`
    );
    return;
  }
  await vscode.workspace
    .getConfiguration("px")
    .update("gamePath", folder, vscode.ConfigurationTarget.Workspace);
  await deps.refresh();
  void vscode.window
    .showInformationMessage(`${meta.shortName} game folder saved for this workspace.`, "Check Setup")
    .then((action) => (action ? vscode.commands.executeCommand("px.setup") : undefined));
}

export async function downloadTigerCommand(deps: SetupDeps, askFirst: boolean): Promise<string | null> {
  const meta = metaFor(deps.getConfig().gameId);
  const flavor = tigerFlavorFor(meta.id);
  if (!flavor) {
    // No tiger exists for this game: never prompt, never download.
    void vscode.window.showInformationMessage(
      `Paradox Modding Toolkit: no tiger validator exists for ${meta.name} yet — nothing to download.`
    );
    return null;
  }
  if (askFirst) {
    const choice = await vscode.window.showInformationMessage(
      `Download ${flavor.prefix} (mod validator, about 15 MB) from github.com/${flavor.repoSlug} into the extension's storage?`,
      "Download",
      "Not now"
    );
    if (choice !== "Download") return null;
  }
  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: flavor.prefix },
      (progress) =>
        downloadLatestTiger(
          deps.storageDir,
          (msg) => {
            deps.log(`tiger download: ${msg}`);
            progress.report({ message: msg });
          },
          flavor
        )
    );
    deps.log(`tiger ${result.version} installed at ${result.binaryPath}`);
    await deps.refresh();
    void vscode.window.setStatusBarMessage(
      `Paradox Modding Toolkit: ${flavor.prefix} ${result.version} is ready. Diagnostics are enabled.`,
      5000
    );
    return result.binaryPath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const retry = await vscode.window.showErrorMessage(
      `Paradox Modding Toolkit: tiger download failed — ${msg}`,
      "Retry"
    );
    if (retry) return downloadTigerCommand(deps, false);
    return null;
  }
}

export async function runSetup(deps: SetupDeps): Promise<void> {
  const report: string[] = [];
  const config = vscode.workspace.getConfiguration("px");
  let cfg = deps.getConfig();
  if (!cfg.isCk3Workspace) {
    const action = await vscode.window.showInformationMessage(
      "Start by opening or creating a mod. The toolkit can find its folder for you.",
      "Find Existing Mod",
      "Create a Mod",
      "Tutorial"
    );
    if (action)
      await vscode.commands.executeCommand(
        action === "Find Existing Mod"
          ? "px.openMod"
          : action === "Create a Mod"
            ? "px.createMod"
            : "px.getStarted"
      );
    return;
  }
  const meta = metaFor(cfg.gameId);
  const docsDir = scriptDocsDir(meta);

  // 1. Game path: detect via Steam when unset/invalid.
  if (cfg.gamePath) {
    report.push(`✓ game: ${cfg.gamePath}`);
  } else {
    const detected = findGameFolder(meta.name);
    if (detected) {
      await config.update("gamePath", detected, vscode.ConfigurationTarget.Workspace);
      report.push(`✓ game: found via Steam and saved to settings — ${detected}`);
    } else {
      report.push(`✗ game: not found in Steam libraries. Use Choose Game Folder for a custom installation.`);
    }
  }

  // 2. Mod folder(s). Descriptor names, so a 20-mod workspace report reads well.
  const modLabel = (p: string) => readModName(p);
  const editedMods = [cfg.modPath, ...cfg.workspaceMods].filter((p): p is string => p !== null);
  report.push(
    editedMods.length > 0
      ? `✓ ${editedMods.length} mod${editedMods.length === 1 ? "" : "s"} (fully indexed and editable` +
          `${meta.tiger ? "; tiger validates the mod of the file you save" : ""}): ` +
          `${editedMods.map(modLabel).join(", ")}`
      : "✗ mods: open your mod folder(s) — or one folder containing them — as the workspace"
  );
  const depParents = cfg.parentPaths.filter((p) => !cfg.workspaceMods.includes(p));
  if (depParents.length > 0) {
    report.push(`• parent mods indexed read-only: ${depParents.map(modLabel).join(", ")}`);
  }

  // Mod projects folder: the recommended layout (content in <project>/mod, git
  // and Workshop listing files next to it, a launcher link in the game's mod
  // folder). Advice, not a blocker.
  // A "✓" here would inflate the ready count, so the set case stays silent.
  if ((config.get<string>("modProjectsDir") ?? "").trim() === "") {
    report.push(
      `• Optional project layout: set px.modProjectsDir to keep content in <project>/mod ` +
        `with Git and Workshop listing files beside it. New Mod offers this layout as an alternative to the game's mod folder.`
    );
  }

  // Report the loaded sources, not merely the presence of dump files.
  const status = await deps.refresh();
  cfg = deps.getConfig();
  const dataTypesCmd = meta.dataTypesCommand ?? "DumpDataTypes";
  const [scriptDocs, dataTypes, advice] = dataHealthLines(status, dataTypesCmd);
  report.push(`${status.tokens > 0 ? "✓" : "✗"} ${scriptDocs}`);
  report.push(`• ${dataTypes}`);
  report.push(`• ${advice}`);
  report.push(
    `• Launch ${meta.shortName} with -debug_mode and open the game console to run both commands. ` +
      `script_docs writes to Documents/Paradox Interactive/${meta.docsFolderName}/${docsDir}; ` +
      `${dataTypesCmd} writes under Documents/Paradox Interactive/${meta.docsFolderName}/logs.`
  );
  report.push(
    cfg.logsPath
      ? `• Dump folder in use (px.logsPath): ${cfg.logsPath}`
      : `• Dump folder not found. Set px.logsPath to Documents/Paradox Interactive/${meta.docsFolderName}/${docsDir} after generating the dumps.`
  );

  // Validation is optional; a health check does not start a download flow.
  const flavor = tigerFlavorFor(cfg.gameId);
  let missingTiger = false;
  if (flavor) {
    const effectiveTiger = cfg.tigerPath ?? findDownloadedTiger(deps.storageDir, flavor);
    if (effectiveTiger) {
      report.push(`✓ ${flavor.prefix}: ${effectiveTiger}`);
    } else {
      missingTiger = true;
      report.push(
        `• Optional ${flavor.prefix}: not installed. Structural checks remain available. Use Download Validator when ready.`
      );
    }
  }

  deps.log("setup report:\n  " + report.join("\n  "));
  const hasBlocker = report.some((l) => l.startsWith("✗") || l.startsWith("➜"));
  const summary = `${meta.shortName}: ${hasBlocker ? "setup needs attention" : "ready to edit"}.${missingTiger ? " The optional validator is not installed." : ""} Details are in the Paradox Modding Toolkit output.`;
  const buttons = [
    "Show details",
    ...(!cfg.gamePath ? ["Choose Game Folder"] : []),
    ...(missingTiger ? ["Download Validator"] : []),
    ...(hasBlocker ? ["Open Settings"] : []),
  ];
  const action = await vscode.window.showInformationMessage(summary, ...buttons);
  if (action === "Show details") deps.showOutput();
  else if (action === "Choose Game Folder") await selectGameFolder(deps);
  else if (action === "Download Validator") await downloadTigerCommand(deps, false);
  else if (action === "Open Settings")
    await vscode.commands.executeCommand("workbench.action.openSettings", "px.");
}

/** One-time nudge on first activation without a configured game path. Only in
 * actual mod workspaces — fresh installs must not be nagged in unrelated
 * projects. */
export function maybeNudgeSetup(
  context: vscode.ExtensionContext,
  cfg: PxConfig,
  notices?: StartupNotices
): void {
  if (!cfg.isCk3Workspace || cfg.gamePath) return;
  const queue = notices ?? new StartupNotices(context, () => undefined);
  const meta = metaFor(cfg.gameId);
  queue.add({
    message: `Paradox Modding Toolkit can find ${meta.name}${meta.tiger ? " and set up its validator" : ""}. Run Setup & Health Check to check this workspace.`,
    key: "px.setupNudged",
    label: "Setup & Health Check",
    command: "px.setup",
  });
  if (!notices) void queue.show();
}
