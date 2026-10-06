/**
 * Live VS Code pass: boots VS Code with an ISOLATED profile
 * (temp user-data/extensions dirs, the real
 * profile is never touched), loads the extension from this repo against the
 * real mod workspace from dev-paths.json, and runs the in-host checklist in
 * scripts/live-pass-suite.ts through the real client↔server transport.
 *
 * Run (from repo root, after `pnpm run compile`):
 *   npx esbuild scripts/live-pass.ts --bundle --platform=node --outfile=dist/live-pass.cjs
 *   npx esbuild scripts/live-pass-suite.ts --bundle --platform=node --external:vscode --outfile=dist/live-pass-suite.cjs
 *   node dist/live-pass.cjs          (then delete both .cjs — dist/ ships)
 */
import { runTests } from "@vscode/test-electron";
import AdmZip from "adm-zip";
import * as fs from "fs";
import * as path from "path";
import { devPath, requireDevPath } from "./devPaths";

export async function main(): Promise<number> {
  const repoRoot = path.resolve(__dirname, "..");
  const modPath = requireDevPath("modPath", "live-pass");
  const gamePath = requireDevPath("gamePath", "live-pass");
  // Set VSCODE_EXECUTABLE_PATH to use a local editor; otherwise test-electron
  // downloads its isolated test installation using its normal platform discovery.
  const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH;
  if (vscodeExecutablePath && !fs.existsSync(vscodeExecutablePath))
    throw new Error("VSCODE_EXECUTABLE_PATH does not exist");

  const testing = path.join(repoRoot, ".local/testing");
  fs.mkdirSync(testing, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(testing, "live-pass-"));
  const userDataDir = path.join(scratch, "user-data");
  fs.mkdirSync(path.join(userDataDir, "User"), { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, "User", "settings.json"),
    JSON.stringify(
      {
        "px.gamePath": gamePath,
        "px.logsPath": devPath("logsPath"),
        "px.trace.perf": true,
        "files.autoSave": "off",
        "security.workspace.trust.enabled": false,
        "extensions.autoCheckUpdates": false,
        "extensions.autoUpdate": false,
        "update.mode": "none",
        "telemetry.telemetryLevel": "off",
        "chat.disableAIFeatures": true,
      },
      null,
      2
    )
  );

  const resultsFile = path.join(scratch, "results.json");
  const vsix = process.env.PX_LIVE_VSIX;
  const extracted = path.join(scratch, "package");
  if (vsix) new AdmZip(path.resolve(vsix)).extractAllTo(extracted);
  console.log(`live-pass results: ${resultsFile}`);
  let failed = false;
  try {
    delete process.env.ELECTRON_RUN_AS_NODE;
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: vsix
        ? path.join(extracted, "extension")
        : path.join(repoRoot, "packages", "vscode"),
      extensionTestsPath: path.join(repoRoot, "dist", "live-pass-suite.cjs"),
      launchArgs: [
        modPath,
        "--profile",
        "PXTK Development",
        "--user-data-dir",
        userDataDir,
        "--extensions-dir",
        path.join(scratch, "extensions"),
        "--disable-gpu",
      ],
      extensionTestsEnv: { CK3_LIVE_RESULTS: resultsFile },
    });
  } catch (error) {
    console.error(error);
    failed = true; // suite signals soft failures via results.json; still print it
  }

  if (fs.existsSync(resultsFile)) {
    const results: Array<{ name: string; ok: boolean; detail?: string }> = JSON.parse(
      fs.readFileSync(resultsFile, "utf8")
    );
    for (const r of results) {
      console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    }
    const bad = results.filter((r) => !r.ok).length;
    console.log(`\nlive-pass: ${results.length - bad}/${results.length} checks passed`);
    return failed || bad > 0 ? 1 : 0;
  }
  console.error("live-pass: no results file written — host crashed before the suite ran");
  return failed ? 1 : 2;
}

if (require.main === module)
  void main().then((code) => {
    process.exitCode = code;
  });
