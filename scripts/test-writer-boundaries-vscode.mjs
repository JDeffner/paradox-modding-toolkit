import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const [executable, gameArgument] = process.argv.slice(2);
if (!executable || !gameArgument)
  throw new Error(
    "Usage: node scripts/test-writer-boundaries-vscode.mjs <Code executable> <game-data folder>"
  );
const root = resolve(import.meta.dirname, "..");
const base = join(root, ".local/testing");
await mkdir(base, { recursive: true });
const scratch = await mkdtemp(join(base, "writer-boundaries-"));
for (const folder of [
  "Mod/common/traits",
  "Mod/events",
  "Mod/localization/english",
  "Mod/localization/german",
  "Second/common/dynasties",
  "Reference/common/decisions",
  "Vanilla/common/traits",
  "Vanilla/localization/english",
  "logs",
  "user/User",
  "extensions",
])
  await mkdir(join(scratch, folder), { recursive: true });
for (const folder of ["Mod", "Second", "Reference"])
  await writeFile(join(scratch, folder, "descriptor.mod"), `\uFEFFname="Writer ${folder}"\n`);
const parserFile = join(scratch, "parser.cjs");
await build({
  entryPoints: [join(root, "packages/server/src/parser/index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: parserFile,
});
const { parseScript } = createRequire(import.meta.url)(parserFile);
const source = await readFile(join(gameArgument, "common/traits/00_traits.txt"), "utf8");
const brave = parseScript(source).root.statements.find(
  (statement) => statement.kind === "assignment" && statement.key.text === "brave"
);
if (!brave) throw new Error("Installed game has no brave trait fixture");
const trait = source.slice(brave.range.start, brave.range.end);
await writeFile(join(scratch, "Vanilla/common/traits/vanilla_fixture.txt"), `\uFEFF${trait}\n`);
await writeFile(
  join(scratch, "Mod/common/traits/existing_fixture.txt"),
  `# preserve header\n${trait.replace(/^brave/, "editor_trait")}\n# preserve unrelated tail\n`
);
await writeFile(
  join(scratch, "Vanilla/localization/english/vanilla_l_english.yml"),
  '\uFEFFl_english:\n trait_brave:0 "Brave"\n trait_brave_desc:0 "Reference trait description"\n'
);
await writeFile(
  join(scratch, "Mod/localization/english/translate_l_english.yml"),
  '\uFEFFl_english:\n writer_translation:0 "Source phrase"\n'
);
await writeFile(
  join(scratch, "Mod/localization/german/translate_l_german.yml"),
  '\uFEFFl_french:\n writer_translation:0 "Source phrase"\n'
);
await writeFile(
  join(scratch, "Mod/events/translation.txt"),
  "\uFEFFnamespace = writer\nwriter.1 = { type = character_event title = writer_translation }\n"
);
await writeFile(
  join(scratch, "Reference/common/decisions/keep.txt"),
  "\uFEFF# preserve read-only reference\n"
);
await symlink(join(scratch, "Reference/common/decisions"), join(scratch, "Mod/common/decisions"), "junction");
await writeFile(
  join(scratch, "fixture.json"),
  JSON.stringify(
    {
      provenance: "brave block copied from installed game",
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    },
    null,
    2
  )
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
    "workbench.colorTheme": "Default Dark Modern",
    "git.openRepositoryInParentFolders": "never",
    "px.notifications.startup": false,
  })
);
const workspace = join(scratch, "writers.code-workspace");
await writeFile(
  workspace,
  JSON.stringify({
    folders: [{ path: "Mod" }, { path: "Second" }],
    settings: {
      "px.gameId": "ck3",
      "px.gamePath": join(scratch, "Vanilla"),
      "px.modPath": join(scratch, "Mod"),
      "px.parentMods": [join(scratch, "Reference")],
      "px.logsPath": join(scratch, "logs"),
      "px.indexAssets": false,
      "px.tigerRunOn": "manual",
      "px.calendar": { epoch: 4000, after: "AD", before: "BC" },
    },
  })
);
const { version } = JSON.parse(await readFile(join(root, "packages/vscode/package.json"), "utf8"));
new AdmZip(join(root, `packages/vscode/px-toolkit-test-${version}.vsix`)).extractAllTo(
  join(scratch, "package")
);
const suite = join(scratch, "suite.cjs");
await build({
  entryPoints: [join(root, "scripts/writer-boundaries-vscode-suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: suite,
});
console.log(`Writer boundary editor checks: ${scratch}`);
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: resolve(executable),
  extensionDevelopmentPath: join(scratch, "package/extension"),
  extensionTestsPath: suite,
  extensionTestsEnv: { PX_WRITER_TEST_SCRATCH: scratch },
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
