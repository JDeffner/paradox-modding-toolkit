/**
 * `CK3: Run Setup & Health Check` — one command that detects everything it can (Steam install,
 * logs folder, tiger), writes the settings, and reports what remains for the
 * user with concrete instructions. Re-runnable as a health check.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { Ck3Config } from "./config";
import { LOG_FILES } from "../../shared/src/constants";
import { readDescriptorName } from "../../shared/src/descriptorMod";
import { findCk3GamePath } from "./steamDetect";
import { downloadLatestTiger, findDownloadedTiger } from "./tigerDownload";

export interface SetupDeps {
  storageDir: string;
  getConfig: () => Ck3Config;
  /** Re-read config and rebuild data (called after settings were written). */
  refresh: () => void;
  log: (msg: string) => void;
}

function scriptDocsPresent(logsPath: string | null): boolean {
  if (!logsPath) return false;
  return LOG_FILES.every(({ file }) => fs.existsSync(path.join(logsPath, file)));
}

export async function downloadTigerCommand(deps: SetupDeps, askFirst: boolean): Promise<string | null> {
  if (askFirst) {
    const choice = await vscode.window.showInformationMessage(
      "Download ck3-tiger (mod validator, ~15 MB) from github.com/amtep/tiger into the extension's storage?",
      "Download",
      "Not now"
    );
    if (choice !== "Download") return null;
  }
  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "ck3-tiger" },
      (progress) =>
        downloadLatestTiger(deps.storageDir, (msg) => {
          deps.log(`tiger download: ${msg}`);
          progress.report({ message: msg });
        })
    );
    deps.log(`tiger ${result.version} installed at ${result.binaryPath}`);
    void vscode.window.showInformationMessage(`ck3-tiger ${result.version} is ready — diagnostics are enabled.`);
    deps.refresh();
    return result.binaryPath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`CK3: tiger download failed — ${msg}`);
    return null;
  }
}

export async function runSetup(deps: SetupDeps): Promise<void> {
  const report: string[] = [];
  const config = vscode.workspace.getConfiguration("ck3");
  let cfg = deps.getConfig();

  // 1. Game path: detect via Steam when unset/invalid.
  if (cfg.gamePath) {
    report.push(`✓ game: ${cfg.gamePath}`);
  } else {
    const detected = findCk3GamePath();
    if (detected) {
      await config.update("gamePath", detected, vscode.ConfigurationTarget.Global);
      report.push(`✓ game: found via Steam and saved to settings — ${detected}`);
    } else {
      report.push(
        "✗ game: not found in any Steam library. Set ck3.gamePath to .../steamapps/common/Crusader Kings III/game"
      );
    }
  }

  // 2. Mod folder(s). Descriptor names, so a 20-mod workspace report reads well.
  const modLabel = (p: string) => readDescriptorName(p) ?? path.basename(p);
  const editedMods = [cfg.modPath, ...cfg.workspaceMods].filter((p): p is string => p !== null);
  report.push(
    editedMods.length > 0
      ? `✓ ${editedMods.length} mod${editedMods.length === 1 ? "" : "s"} (fully indexed and editable; ` +
          `tiger validates the mod of the file you save): ${editedMods.map(modLabel).join(", ")}`
      : "✗ mods: open your mod folder(s) — or one folder containing them — as the workspace"
  );
  const depParents = cfg.parentPaths.filter((p) => !cfg.workspaceMods.includes(p));
  if (depParents.length > 0) {
    report.push(`• parent mods indexed read-only: ${depParents.map(modLabel).join(", ")}`);
  }

  // 3. Logs / script_docs.
  cfg = deps.getConfig();
  if (scriptDocsPresent(cfg.logsPath)) {
    report.push(`✓ script_docs logs: ${cfg.logsPath}`);
  } else if (cfg.logsPath) {
    report.push(
      `• script_docs logs: not generated yet (bundled wiki data is used meanwhile). ` +
        `Launch CK3 with -debug_mode, open the console (\`), run "script_docs", then run "CK3: Reload Game Data (script_docs)".`
    );
  } else {
    report.push("✗ logs folder: not found — set ck3.logsPath to Documents/Paradox Interactive/Crusader Kings III/logs");
  }
  if (cfg.logsPath && !fs.existsSync(path.join(cfg.logsPath, "data_types.log"))) {
    report.push(
      `• data types: data_types.log not generated yet (bundled wiki tables are used meanwhile). ` +
        `Run "DumpDataTypes" in the game console for complete [datafunction] completion in gui/localization files.`
    );
  }

  // 4. Tiger.
  const effectiveTiger = cfg.tigerPath ?? findDownloadedTiger(deps.storageDir);
  if (effectiveTiger) {
    report.push(`✓ ck3-tiger: ${effectiveTiger}`);
  } else {
    const bin = await downloadTigerCommand(deps, true);
    report.push(bin ? `✓ ck3-tiger: downloaded — ${bin}` : "• ck3-tiger: skipped (diagnostics disabled). Run 'CK3 Tiger: Download or Update Binary' anytime.");
  }

  deps.refresh();

  deps.log("setup report:\n  " + report.join("\n  "));
  const ok = report.filter((l) => l.startsWith("✓")).length;
  const summary = `CK3 setup: ${ok}/4 ready. ${report.some((l) => l.startsWith("✗") || l.startsWith("•")) ? "Details in the CK3 Modding Toolkit output." : "All set!"}`;
  const action = await vscode.window.showInformationMessage(summary, "Show details");
  if (action === "Show details") {
    await vscode.commands.executeCommand("workbench.action.output.toggleOutput");
  }
}

/* The first-activation setup nudge lived here. It offered to configure an
 * extension that is now deprecated, which is advice nobody should act on —
 * the migration notice is the only thing worth interrupting a startup for.
 * `ck3.setup` remains available from the palette for anyone still on this
 * build who needs it today. */
