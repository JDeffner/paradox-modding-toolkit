/**
 * Live VS Code pass (Stream E / UPDATE_PLAN A0): boots the locally installed
 * VS Code with an ISOLATED profile (temp user-data/extensions dirs — the real
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
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const VSCODE_EXE = "C:/Users/joeld/AppData/Local/Programs/Microsoft VS Code/Code.exe";

async function main(): Promise<void> {
  const repoRoot = path.resolve(__dirname, "..");
  const devPaths = JSON.parse(fs.readFileSync(path.join(repoRoot, "dev-paths.json"), "utf8"));
  if (!devPaths.modPath || !devPaths.gamePath) {
    console.error("live-pass: dev-paths.json needs modPath and gamePath");
    process.exit(1);
  }

  const scratch = path.join(os.tmpdir(), "ck3-live-pass");
  fs.rmSync(scratch, { recursive: true, force: true });
  const userDataDir = path.join(scratch, "user-data");
  fs.mkdirSync(path.join(userDataDir, "User"), { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, "User", "settings.json"),
    JSON.stringify(
      {
        "px.gamePath": devPaths.gamePath,
        "px.logsPath": devPaths.logsPath ?? null,
        "security.workspace.trust.enabled": false,
        "extensions.autoCheckUpdates": false,
        "extensions.autoUpdate": false,
        "update.mode": "none",
        "telemetry.telemetryLevel": "off",
      },
      null,
      2
    )
  );

  const resultsFile = path.join(scratch, "results.json");
  let failed = false;
  try {
    await runTests({
      vscodeExecutablePath: fs.existsSync(VSCODE_EXE) ? VSCODE_EXE : undefined,
      extensionDevelopmentPath: path.join(repoRoot, "packages", "vscode"),
      extensionTestsPath: path.join(repoRoot, "dist", "live-pass-suite.cjs"),
      launchArgs: [
        devPaths.modPath,
        "--user-data-dir",
        userDataDir,
        "--extensions-dir",
        path.join(scratch, "extensions"),
        "--disable-gpu",
      ],
      extensionTestsEnv: { CK3_LIVE_RESULTS: resultsFile },
    });
  } catch {
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
    process.exit(bad > 0 ? 1 : 0);
  }
  console.error("live-pass: no results file written — host crashed before the suite ran");
  process.exit(failed ? 1 : 2);
}

void main();
