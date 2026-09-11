/**
 * `Paradox: Run Setup & Health Check` — one command that detects everything it can (Steam install,
 * logs folder, tiger), writes the settings, and reports what remains for the
 * user with concrete instructions. Re-runnable as a health check.
 */
import * as vscode from "vscode";
import type { PxConfig } from "./config";
import type { StatusPayload } from "@px-lsp/protocol/protocol";
import { dataHealthLines } from "./dataHealth";
import { readModName } from "@px-lsp/protocol/modName";
import { findGameFolder } from "./steamDetect";
import { downloadLatestTiger, findDownloadedTiger, tigerFlavorFor } from "./tigerDownload";
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
    void vscode.window.showInformationMessage(
      `Paradox Modding Toolkit: ${flavor.prefix} ${result.version} is ready — diagnostics are enabled.`
    );
    await deps.refresh();
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
  const meta = metaFor(cfg.gameId);
  const docsDir = scriptDocsDir(meta);

  // 1. Game path: detect via Steam when unset/invalid.
  if (cfg.gamePath) {
    report.push(`✓ game: ${cfg.gamePath}`);
  } else {
    const detected = findGameFolder(meta.name);
    if (detected) {
      await config.update("gamePath", detected, vscode.ConfigurationTarget.Global);
      report.push(`✓ game: found via Steam and saved to settings — ${detected}`);
    } else {
      report.push(
        `✗ game: not found in any Steam library. Set px.gamePath to .../steamapps/common/${meta.name}/game`
      );
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
      `• mod projects folder: not set. Recommended: keep each mod in its own project folder ` +
        `(px.modProjectsDir) with the content in <project>/mod — git and Steam Workshop listing files ` +
        `stay outside the upload, and the launcher loads the mod via a link. ` +
        `"Paradox: New Mod" sets this up.`
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

  // 4. Tiger — only for games one exists for (EU5 has none; skip silently).
  const flavor = tigerFlavorFor(cfg.gameId);
  if (flavor) {
    const effectiveTiger = cfg.tigerPath ?? findDownloadedTiger(deps.storageDir, flavor);
    if (effectiveTiger) {
      report.push(`✓ ${flavor.prefix}: ${effectiveTiger}`);
    } else {
      const bin = await downloadTigerCommand(deps, true);
      report.push(
        bin
          ? `✓ ${flavor.prefix}: downloaded — ${bin}`
          : `• ${flavor.prefix}: skipped (external diagnostics disabled). Run 'Paradox Tiger: Download or Update Binary' anytime.`
      );
    }
  }

  deps.log("setup report:\n  " + report.join("\n  "));
  const checks = flavor ? 4 : 3;
  const ok = Math.min(report.filter((l) => l.startsWith("✓")).length, checks);
  const hasBlocker = report.some((l) => l.startsWith("✗") || l.startsWith("➜"));
  const summary = `${meta.shortName} setup: ${ok}/${checks} ready. ${hasBlocker || report.some((l) => l.startsWith("•")) ? "Details in the Paradox Modding Toolkit output." : "All set!"}`;
  const buttons = hasBlocker ? ["Show details", "Open Settings"] : ["Show details"];
  const action = await vscode.window.showInformationMessage(summary, ...buttons);
  if (action === "Show details") deps.showOutput();
  else if (action === "Open Settings")
    await vscode.commands.executeCommand("workbench.action.openSettings", "px.");
}

/** One-time nudge on first activation without a configured game path. Only in
 * actual mod workspaces — fresh installs must not be nagged in unrelated
 * projects. */
export function maybeNudgeSetup(context: vscode.ExtensionContext, cfg: PxConfig): void {
  if (!cfg.isCk3Workspace) return;
  if (cfg.gamePath) return;
  if (context.globalState.get<boolean>("px.setupNudged")) return;
  void context.globalState.update("px.setupNudged", true);
  const meta = metaFor(cfg.gameId);
  void vscode.window
    .showInformationMessage(
      `The Paradox Modding Toolkit can configure itself (find ${meta.name}${meta.tiger ? ", set up tiger" : ""}).`,
      "Run Setup & Health Check",
      "Later"
    )
    .then((choice) => {
      if (choice === "Run Setup & Health Check") void vscode.commands.executeCommand("px.setup");
    });
}
