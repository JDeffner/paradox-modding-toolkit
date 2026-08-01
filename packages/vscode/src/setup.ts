/**
 * `Paradox: Run Setup & Health Check` — one command that detects everything it can (Steam install,
 * logs folder, tiger), writes the settings, and reports what remains for the
 * user with concrete instructions. Re-runnable as a health check.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { PxConfig } from "./config";
import { LOG_FILES } from "@px-lsp/protocol/constants";
import { readDescriptorName } from "@px-lsp/protocol/descriptorMod";
import { findGameFolder } from "./steamDetect";
import { downloadLatestTiger, findDownloadedTiger, tigerFlavorFor } from "./tigerDownload";
import { isCk3, metaFor, scriptDocsDir } from "./meta";

export interface SetupDeps {
  storageDir: string;
  getConfig: () => PxConfig;
  /** Re-read config and rebuild data (called after settings were written). */
  refresh: () => void;
  log: (msg: string) => void;
}

function scriptDocsPresent(logsPath: string | null): boolean {
  if (!logsPath) return false;
  return LOG_FILES.every(({ file }) => fs.existsSync(path.join(logsPath, file)));
}

export async function downloadTigerCommand(deps: SetupDeps, askFirst: boolean): Promise<string | null> {
  const meta = metaFor(deps.getConfig().gameId);
  const flavor = tigerFlavorFor(meta.id);
  if (!flavor) {
    // No tiger exists for this game: never prompt, never download.
    void vscode.window.showInformationMessage(
      `Paradox Toolkit: no tiger validator exists for ${meta.name} yet — nothing to download.`
    );
    return null;
  }
  if (askFirst) {
    const choice = await vscode.window.showInformationMessage(
      `Download ${flavor.prefix} (mod validator, ~15 MB) from github.com/${flavor.repoSlug} into the extension's storage?`,
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
      `${flavor.prefix} ${result.version} is ready — diagnostics are enabled.`
    );
    deps.refresh();
    return result.binaryPath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Paradox Toolkit: tiger download failed — ${msg}`);
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
  const modLabel = (p: string) => readDescriptorName(p) ?? path.basename(p);
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

  // 3. Logs / script_docs. Outside CK3 the how-to moves to the top action item
  // below, so it is not repeated here.
  cfg = deps.getConfig();
  const docsOk = scriptDocsPresent(cfg.logsPath);
  if (docsOk) {
    report.push(`✓ script_docs ${docsDir}: ${cfg.logsPath}`);
  } else if (cfg.logsPath) {
    report.push(
      `• script_docs ${docsDir}: not generated yet` +
        (isCk3(meta.id)
          ? ` (bundled wiki data is used meanwhile). Launch ${meta.shortName} with -debug_mode, ` +
            `open the console (\`), run "script_docs", then run "Paradox: Reload Game Data (script_docs)".`
          : ".")
    );
  } else {
    report.push(
      `✗ ${docsDir} folder: not found — set px.logsPath to Documents/Paradox Interactive/${meta.docsFolderName}/${docsDir}`
    );
  }
  if (cfg.logsPath && !fs.existsSync(path.join(cfg.logsPath, "data_types.log"))) {
    report.push(
      `• data types: data_types.log not generated yet` +
        `${isCk3(meta.id) ? " (bundled wiki tables are used meanwhile)" : ""}. ` +
        `Run "DumpDataTypes" in the game console for complete [datafunction] completion in gui/localization files.`
    );
  }

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

  // First-run guidance: outside CK3 there is no bundled wiki fallback, so the
  // script_docs dump is what makes completion/hovers useful. Say so first.
  if (!isCk3(meta.id) && !docsOk) {
    report.unshift(
      `➜ FIRST: run script_docs in ${meta.name}. Launch it with -debug_mode, open the console (\`), ` +
        `type "script_docs"; the dumps land in Documents/Paradox Interactive/${meta.docsFolderName}/${docsDir}. ` +
        `${meta.shortName} ships no bundled fallback data, so until then completion and hovers stay thin. ` +
        `Afterwards run "Paradox: Reload Game Data (script_docs)".`
    );
  }

  deps.refresh();

  deps.log("setup report:\n  " + report.join("\n  "));
  const checks = flavor ? 4 : 3;
  const ok = Math.min(report.filter((l) => l.startsWith("✓")).length, checks);
  const summary = `${meta.shortName} setup: ${ok}/${checks} ready. ${report.some((l) => l.startsWith("✗") || l.startsWith("•") || l.startsWith("➜")) ? "Details in the Paradox Toolkit output." : "All set!"}`;
  const action = await vscode.window.showInformationMessage(summary, "Show details");
  if (action === "Show details") {
    await vscode.commands.executeCommand("workbench.action.output.toggleOutput");
  }
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
      `The Paradox Toolkit can configure itself (find ${meta.name}${meta.tiger ? ", set up tiger" : ""}).`,
      "Run Setup & Health Check",
      "Later"
    )
    .then((choice) => {
      if (choice === "Run Setup & Health Check") void vscode.commands.executeCommand("px.setup");
    });
}
