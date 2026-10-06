import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import AdmZip from "adm-zip";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [executable] = process.argv.slice(2);
if (!executable) throw new Error("Usage: node scripts/test-wiki-vscode.mjs <Code executable>");
const root = resolve(import.meta.dirname, "..");
const base = join(root, ".local/testing");
const artifacts = join(root, ".local/artifacts");
await mkdir(base, { recursive: true });
await mkdir(artifacts, { recursive: true });
const scratch = await mkdtemp(join(base, "wiki-"));
for (const folder of ["Mod", "logs", "user/User", "extensions"])
  await mkdir(join(scratch, folder), { recursive: true });
await writeFile(join(scratch, "Mod/descriptor.mod"), '\uFEFFname="Wiki editor check"\n');
await writeFile(
  join(scratch, "user/User/settings.json"),
  JSON.stringify({
    "security.workspace.trust.enabled": false,
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "update.mode": "none",
    "chat.disableAIFeatures": true,
    "workbench.startupEditor": "none",
    "window.title": "PXTK Wiki Test",
    "workbench.colorTheme": "Default Dark Modern",
    "git.openRepositoryInParentFolders": "never",
    "px.notifications.startup": false,
  })
);
// Reuse the path loader, with its configuration file anchored at the repository.
const pathsModule = join(scratch, "dev-paths.cjs");
await build({
  entryPoints: [join(root, "scripts/devPaths.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  define: { __dirname: JSON.stringify(join(root, "scripts")) },
  outfile: pathsModule,
});
const { devPath } = await import(pathToFileURL(pathsModule).href);
const gamePath = devPath("gamePath", "ck3");
const workspace = join(scratch, "wiki.code-workspace");
await writeFile(
  workspace,
  JSON.stringify(
    {
      folders: [{ path: "Mod" }],
      settings: {
        "px.gameId": "ck3",
        ...(gamePath ? { "px.gamePath": gamePath } : {}),
        "px.modPath": join(scratch, "Mod"),
        "px.logsPath": join(scratch, "logs"),
        "px.indexAssets": false,
        "px.tigerRunOn": "manual",
      },
    },
    null,
    2
  )
);
const { version } = JSON.parse(await readFile(join(root, "packages/vscode/package.json"), "utf8"));
new AdmZip(join(root, `packages/vscode/px-toolkit-test-${version}.vsix`)).extractAllTo(
  join(scratch, "package")
);
const suite = join(scratch, "suite.cjs");
await build({
  entryPoints: [join(root, "scripts/wiki-vscode-suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: suite,
});
console.log(`Wiki editor checks: ${scratch}`);
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: resolve(executable),
  extensionDevelopmentPath: join(scratch, "package/extension"),
  extensionTestsPath: suite,
  extensionTestsEnv: { PX_WIKI_TEST_SCRATCH: scratch, PX_WIKI_TEST_ARTIFACTS: artifacts },
  launchArgs: [
    workspace,
    "--profile",
    "PXTK Development",
    "--user-data-dir",
    join(scratch, "user"),
    "--extensions-dir",
    join(scratch, "extensions"),
    "--remote-debugging-port=9339",
    "--disable-gpu",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
  ],
});
