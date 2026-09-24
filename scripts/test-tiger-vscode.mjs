// Run the actual packaged extension with real Tiger in a disposable editor.
import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import AdmZip from "adm-zip";

const [executable, vsix] = process.argv.slice(2);
if (!executable || !vsix)
  throw new Error("Usage: node scripts/test-tiger-vscode.mjs <Code executable> <VSIX>");
const root = resolve(import.meta.dirname, "..");
const game = process.env.PX_CK3_GAME_PATH;
const tiger = process.env.PX_CK3_TIGER_PATH;
if (!game || !tiger) throw new Error("Set PX_CK3_GAME_PATH and PX_CK3_TIGER_PATH.");
const evidence = await readFile(join(game, "common/scripted_effects/00_intercourse_effects.txt"), "utf8");
if (!/add_gold\s*=\s*1\b/.test(evidence)) throw new Error("Vanilla must verify the fixture's effect.");
await mkdir(join(root, ".local/testing"), { recursive: true });
const scratch = await mkdtemp(join(root, ".local/testing/pxtk editor "));
const mod = join(scratch, "mod");
await mkdir(join(mod, "common/scripted_effects"), { recursive: true });
await writeFile(join(mod, "descriptor.mod"), '\uFEFFname="Tiger editor smoke"\n');
await writeFile(
  join(mod, "common/scripted_effects/probe.txt"),
  "\uFEFFpxtk_editor_probe = { pxtk_intentionally_invalid_effect = yes }\n"
);
const workspace = join(scratch, "test.code-workspace");
await writeFile(
  workspace,
  JSON.stringify({
    folders: [{ path: mod }],
    settings: {
      "security.workspace.trust.enabled": false,
      "extensions.autoUpdate": false,
      "extensions.autoCheckUpdates": false,
      "update.mode": "none",
      "px.gameId": "ck3",
      "px.gamePath": game,
      "px.modPath": mod,
      "px.tigerPath": tiger,
      "px.tigerRunOn": "manual",
      "px.logsPath": process.env.PX_CK3_LOGS_PATH ?? "",
      "px.indexAssets": false,
      "files.autoSave": "off",
    },
  })
);
const extracted = join(scratch, "packed");
new AdmZip(resolve(vsix)).extractAllTo(extracted);
const suite = join(scratch, "suite.cjs");
await build({
  entryPoints: [join(root, "scripts/tiger-vscode-suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: suite,
});
delete process.env.ELECTRON_RUN_AS_NODE;
console.log(`Packaged Tiger editor check: ${scratch}`);
await runTests({
  vscodeExecutablePath: resolve(executable),
  extensionDevelopmentPath: join(extracted, "extension"),
  extensionTestsPath: suite,
  extensionTestsEnv: {
    PX_TEST_NODE: process.execPath,
    PX_TEST_LOGS: join(scratch, "user/logs"),
    PX_TEST_PACKED_EXTENSION: join(extracted, "extension"),
  },
  launchArgs: [
    workspace,
    "--profile",
    "PXTK Development",
    "--user-data-dir",
    join(scratch, "user"),
    "--extensions-dir",
    join(scratch, "extensions"),
    "--disable-gpu",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
  ],
});
