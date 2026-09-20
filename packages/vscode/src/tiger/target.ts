import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseTigerJson, type TigerReport } from "@px-lsp/protocol/tigerParser";

export interface TargetValidationResult {
  reports: TigerReport[];
  errors: number;
  warnings: number;
  other: number;
  total: number;
}

/** Tiger takes an installation root, never a fallback to another installed game. */
export async function targetInstallRoot(selected: string): Promise<string> {
  const resolved = await fs.realpath(selected);
  const root = path.basename(resolved).toLowerCase() === "game" ? path.dirname(resolved) : resolved;
  try {
    if ((await fs.stat(path.join(root, "game"))).isDirectory()) return root;
  } catch {
    // A comparison snapshot need not have the installation layout Tiger needs.
  }
  throw new Error(
    "Target validation needs the new game's installation folder or its game folder. " +
      "This snapshot can be compared, but it has no game installation layout for the validator."
  );
}

export function summarizeTargetReports(reports: TigerReport[]): TargetValidationResult {
  const errors = reports.filter((report) => /^(fatal|error)$/i.test(report.severity)).length;
  const warnings = reports.filter((report) => /^warning$/i.test(report.severity)).length;
  return { reports, errors, warnings, other: reports.length - errors - warnings, total: reports.length };
}

/** The explicit game flag and isolated config prevent target selection from drifting. */
export function runTargetValidator(
  binary: string,
  gameId: string,
  installRoot: string,
  modRoot: string,
  configFile: string,
  signal?: AbortSignal
): Promise<TargetValidationResult> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      ["--json", "--config", configFile, `--${gameId}`, installRoot, modRoot],
      { windowsHide: true, encoding: "utf8", timeout: 300_000, maxBuffer: 64 * 1024 * 1024, signal },
      (error, stdout, stderr) => {
        if (signal?.aborted) {
          reject(new Error("Target validation cancelled."));
          return;
        }
        const reports = parseTigerJson(stdout);
        if (reports === null || (error && error.code !== 1)) {
          reject(
            new Error(
              "The validator could not check the selected new game data. " +
                "Check that this validator supports the target game version and that the installation is complete. " +
                (stderr.trim() || error?.message || "No readable report was returned.").slice(0, 600)
            )
          );
          return;
        }
        resolve(summarizeTargetReports(reports));
      }
    );
  });
}
