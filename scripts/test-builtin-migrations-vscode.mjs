import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import AdmZip from "adm-zip";
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

const [executable, sourceArgument, targetArgument, targetVersionArgument] = process.argv.slice(2);
if (!executable || !sourceArgument || !targetArgument)
  throw new Error(
    "Usage: node scripts/test-builtin-migrations-vscode.mjs <Code executable> <source game-data folder> <target game-data folder> [exact archived target version]"
  );
const root = resolve(import.meta.dirname, "..");
const source = resolve(sourceArgument),
  target = resolve(targetArgument);
for (const folder of [source, target]) await readdir(join(folder, "common/religion"));
let detectedTargetVersion;
try {
  detectedTargetVersion = JSON.parse(
    await readFile(join(dirname(target), "launcher/launcher-settings.json"), "utf8")
  ).rawVersion;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (detectedTargetVersion && targetVersionArgument && detectedTargetVersion !== targetVersionArgument)
  throw new Error(
    `Selected target ${targetVersionArgument} differs from installed ${detectedTargetVersion}.`
  );
const targetVersion = detectedTargetVersion ?? targetVersionArgument;
if (!["1.20.0.2", "1.20.0.3"].includes(targetVersion))
  throw new Error(
    "Target must be a verified installed build, or an explicitly labelled archive, of 1.20.0.2 or 1.20.0.3."
  );
const base = join(root, ".local/testing");
await mkdir(base, { recursive: true });
const scratch = await mkdtemp(join(base, "builtin-migrations-"));
for (const folder of [
  "Mod/common/religion/religion_types",
  "Mod/gfx",
  "user/User/profiles/pxtk-builtin",
  "user/User/globalStorage",
  "extensions",
  "logs",
])
  await mkdir(join(scratch, folder), { recursive: true });
const ddsModule = join(scratch, "dds.cjs");
await build({
  entryPoints: [join(root, "packages/server/src/dds/migrateMips.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: ddsModule,
});
const { inspectDdsResource } = createRequire(import.meta.url)(ddsModule);
const variationRoot = join(target, "gfx/portraits/accessory_variations");
const candidates = new Map();
for (const entry of await readdir(variationRoot, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".txt")) continue;
  const consumer = join(entry.parentPath, entry.name);
  for (const match of (await readFile(consumer, "utf8")).matchAll(/\bcolormask\s*=\s*"([^"]+\.dds)"/g))
    if (!candidates.has(match[1])) candidates.set(match[1], relative(target, consumer).replaceAll("\\", "/"));
}
let fixture;
const discoveryErrors = [];
for (const [texture, consumer] of candidates) {
  try {
    const before = await readFile(join(source, texture));
    const after = await readFile(join(target, texture));
    const a = inspectDdsResource(before),
      b = inspectDdsResource(after);
    if (
      a.resourceKind !== "2d" ||
      b.resourceKind !== "2d" ||
      a.mipLevelCount !== a.fullMipLevelCount ||
      a.mipLevelCount <= b.mipLevelCount ||
      a.width !== b.width ||
      a.height !== b.height ||
      a.format !== b.format ||
      before.length > 16 * 1024 * 1024
    )
      continue;
    fixture = {
      targetVersion,
      texture,
      consumer,
      source: "real archived mask and same-path target consumer",
      before: a,
      after: b,
    };
    await mkdir(dirname(join(scratch, "Mod", texture)), { recursive: true });
    await writeFile(join(scratch, "Mod", texture), before);
    await writeFile(join(scratch, "original-mask.dds"), before);
    break;
  } catch (error) {
    if (error.code !== "ENOENT") discoveryErrors.push(`${texture}: ${String(error)}`);
  }
}
if (!fixture)
  throw new Error(
    `No matching real full-mip source mask and reduced-mip target consumer found. ${discoveryErrors.join("\n")}`
  );
const faith =
  "\uFEFF# preserve this religion comment\r\ncustom_religion = { family = rf_pagan doctrine = doctrine_pluralism_pluralistic traits = { virtues = { brave } } faiths = { parent = { color = { 0.2 0.3 0.4 } doctrine = tenet_ritual_celebrations holy_site = rome } child = { color = { 0.4 0.3 0.2 } doctrine = tenet_ritual_celebrations } } }\r\n# preserve this unrelated tail\r\n";
await writeFile(join(scratch, "Mod/common/religion/religion_types/custom.txt"), faith);
await writeFile(join(scratch, "original-faith.txt"), faith);
await writeFile(
  join(scratch, "Mod/descriptor.mod"),
  '\uFEFFname="Built-in Migration Tests"\nsupported_version="1.19.*"\n'
);
await writeFile(join(scratch, "Mod/unrelated.txt"), "\uFEFF# unrelated user content\r\nkeep = yes\r\n");
await writeFile(join(scratch, "fixture.json"), JSON.stringify(fixture, null, 2));
const installation = dirname(resolve(executable));
const workbenchRelative = "resources/app/out/vs/workbench/workbench.desktop.main.js";
let workbench = join(installation, workbenchRelative);
try {
  await access(workbench);
} catch {
  const versions = (await readdir(installation, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory()
  );
  let found = false;
  for (const entry of versions) {
    const candidate = join(installation, entry.name, workbenchRelative);
    try {
      await access(candidate);
      workbench = candidate;
      found = true;
      break;
    } catch {
      // Current Windows installations keep resources under a version directory.
    }
  }
  if (!found) throw new Error(`Cannot locate the VS Code workbench under ${installation}`);
}
if (!(await readFile(workbench, "utf8")).includes("window.dialogStyle"))
  throw new Error(
    "This VS Code build does not expose window.dialogStyle. The real reference-folder picker remains unverified."
  );
await writeFile(
  join(scratch, "user/User/settings.json"),
  JSON.stringify({
    "security.workspace.trust.enabled": false,
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "update.mode": "none",
    "files.autoSave": "off",
    "chat.disableAIFeatures": true,
    "workbench.startupEditor": "none",
    "window.title": "PXTK Built-in Migration Test",
    "window.commandCenter": false,
    "window.dialogStyle": "custom",
    "files.simpleDialog.enable": true,
    "workbench.colorTheme": "Default Dark Modern",
    "git.openRepositoryInParentFolders": "never",
    "px.notifications.startup": false,
  })
);
const workspace = join(scratch, "builtin-migrations.code-workspace");
await writeFile(
  join(scratch, "user/User/profiles/pxtk-builtin/settings.json"),
  await readFile(join(scratch, "user/User/settings.json"))
);
await writeFile(
  join(scratch, "user/User/globalStorage/storage.json"),
  JSON.stringify({ userDataProfiles: [{ location: "pxtk-builtin", name: "PXTK Development" }] })
);
await writeFile(
  workspace,
  JSON.stringify(
    {
      folders: [{ path: "Mod" }],
      settings: {
        "px.gameId": "ck3",
        "px.gamePath": target,
        "px.modPath": join(scratch, "Mod"),
        "px.logsPath": join(scratch, "logs"),
        "px.experimentalFeatures": true,
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
  entryPoints: [join(root, "scripts/builtin-migrations-vscode-suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: suite,
});
console.log(`Built-in migration editor checks: ${scratch}`);
console.log(`DDS fixture: ${fixture.texture} (${fixture.source})`);
console.log(
  `Target game build: ${targetVersion} (${detectedTargetVersion ? "launcher metadata" : "explicit archive label, executable unverified"})`
);
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: resolve(executable),
  extensionDevelopmentPath: join(scratch, "package/extension"),
  extensionTestsPath: suite,
  extensionTestsEnv: {
    PX_BUILTIN_MIGRATION_SCRATCH: scratch,
    PX_BUILTIN_MIGRATION_SOURCE: source,
    PX_BUILTIN_MIGRATION_TARGET: target,
    PX_BUILTIN_MIGRATION_TARGET_VERSION: targetVersion,
  },
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
