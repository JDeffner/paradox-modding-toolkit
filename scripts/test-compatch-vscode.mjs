// Exercise real diff tabs, virtual documents and in-place writes in an isolated editor.
import { runTests } from "@vscode/test-electron";
import { mkdtemp, mkdir, writeFile, cp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [example, executable, suiteFile] = process.argv.slice(2);
if (!example || !executable)
  throw new Error("Usage: node scripts/test-compatch-vscode.mjs <generated example> <Code executable>");
const root = resolve(import.meta.dirname, "..");
const scratch = await mkdtemp(join(tmpdir(), "px-compatch-editor-"));
for (const name of ["Mod", "Vanilla", "New Game Version"])
  await cp(join(example, name), join(scratch, name), { recursive: true });
// Explicit mock game folder prevents installation discovery. This suite needs no installed game.
await mkdir(join(scratch, "user/User"), { recursive: true });
await writeFile(
  join(scratch, "user/User/settings.json"),
  JSON.stringify({
    "security.workspace.trust.enabled": false,
    "extensions.autoUpdate": false,
    "update.mode": "none",
    "px.gameId": "ck3",
    "px.gamePath": join(scratch, "Vanilla"),
    "px.modPath": join(scratch, "Mod"),
    "px.tigerRunOn": "manual",
    "px.indexAssets": false,
  })
);
const suite = join(scratch, "suite.cjs");
if (suiteFile) await writeFile(suite, await readFile(resolve(suiteFile), "utf8"));
else
  await writeFile(
    suite,
    `
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
exports.run = async () => {
  const root = path.dirname(vscode.workspace.workspaceFolders[0].uri.fsPath);
  const mod = path.join(root, "Mod");
  await vscode.extensions.getExtension("JDeffner.px-toolkit").activate();
  await vscode.commands.executeCommand("px.openCompatch");
  async function row(name) {
    const sites = {};
    for (const [side, folder] of Object.entries({A:"Mod", base:"Vanilla", B:"New Game Version"}))
      sites[side] = [{path:name, line:1, text:await fs.readFile(path.join(root,folder,name),"utf8")}];
    return {entry:{id:JSON.stringify(["file",name]), kind:"file", name, sites}};
  }
  const event = await row("events/legacy_events/dynasty_legacy_events.txt");
  await vscode.commands.executeCommand("px.compareCompatch",event);
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  assert.ok(tab.input instanceof vscode.TabInputTextDiff, "real diff tab opened");
  assert.equal(tab.input.original.scheme,"px-compatch");
  assert.equal(tab.input.modified.toString(),vscode.Uri.file(path.join(mod,event.entry.name)).toString());
  const source = await vscode.workspace.openTextDocument(tab.input.original);
  assert.ok(source.getText().includes("namespace = dynasty_legacy"),"complete source file");
  assert.ok(source.getText().includes("id_override_priority"),"new version snapshot has content");
  await vscode.commands.executeCommand("px.compatchGameChanges",event);
  const gameTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const old = await vscode.workspace.openTextDocument(gameTab.input.original);
  assert.ok(!old.getText().includes("id_override_priority"));
  const before = await fs.readFile(path.join(mod,event.entry.name),"utf8");
  await vscode.commands.executeCommand("px.compatchApplyMerge",event);
  assert.equal(await fs.readFile(path.join(mod,event.entry.name),"utf8"),before,"conflict never writes");
  const conflictTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  assert.equal(conflictTab.input.modified.scheme,"file","editable temporary resolution");
  assert.notEqual(conflictTab.input.modified.fsPath,path.join(mod,event.entry.name));
  const resolution = await vscode.workspace.openTextDocument(conflictTab.input.modified);
  assert.ok(resolution.getText().includes("<<<<<<< Mod"));
  assert.ok(resolution.getText().includes("||||||| Old Game Version"));
  for (const name of ["traits_on_actions.txt", "court_type_on_actions.txt", "decision_on_actions.txt"]) {
  const clean = await row("common/on_action/" + name);
  await vscode.commands.executeCommand("px.compatchPreviewMerge",clean);
  assert.equal(await fs.readFile(path.join(mod,clean.entry.name),"utf8"),clean.entry.sites.A[0].text,"preview never writes");
  await vscode.commands.executeCommand("px.compatchApplyMerge",clean);
  const bytes = await fs.readFile(path.join(mod,clean.entry.name));
  assert.deepEqual([...bytes.subarray(0,3)],[239,187,191],"BOM preserved exactly once");
  assert.notEqual(bytes.toString("utf8")[1],"\\uFEFF");
  assert.equal(bytes.toString("utf8").replace(/\\r\\n/g,"\\n"),clean.entry.sites.B[0].text.replace(/\\r\\n/g,"\\n"),"applied to original mod");
  assert.equal(await fs.readFile(path.join(root,"Vanilla",clean.entry.name),"utf8"),clean.entry.sites.base[0].text);
  assert.equal(await fs.readFile(path.join(root,"New Game Version",clean.entry.name),"utf8"),clean.entry.sites.B[0].text);
  }
  // Resolve the deliberate conflict as a modder: keep the mod reward, carry over the mock property.
  const edit = new vscode.WorkspaceEdit();
  edit.replace(resolution.uri, new vscode.Range(resolution.positionAt(0),resolution.positionAt(resolution.getText().length)),
    before.replace(/^\\uFEFF/,"").replace("hidden = yes","hidden = yes\\n\\tid_override_priority = 10 # MOCK practice only"));
  assert.ok(await vscode.workspace.applyEdit(edit));
  assert.equal(await fs.readFile(path.join(mod,event.entry.name),"utf8"),before,"editing the temporary result leaves the mod unchanged");
  await vscode.window.showTextDocument(resolution);
  await vscode.commands.executeCommand("px.compatchApplyResolved");
  await vscode.commands.executeCommand("px.refreshCompatch");
  const resolved = await fs.readFile(path.join(mod,event.entry.name),"utf8");
  assert.ok(resolved.includes("add_diplomacy_skill = 2"));
  assert.ok(resolved.includes("id_override_priority = 10"));
  assert.ok(!resolved.includes("<<<<<<<"));
  assert.equal(await fs.readFile(path.join(root,"Vanilla",event.entry.name),"utf8"),event.entry.sites.base[0].text);
  assert.equal(await fs.readFile(path.join(root,"New Game Version",event.entry.name),"utf8"),event.entry.sites.B[0].text);
  await vscode.commands.executeCommand("px.compatchSourceControl");
  const {execFileSync} = require("node:child_process");
  const changed = execFileSync("git",["-C",mod,"diff","--name-only"],{encoding:"utf8",windowsHide:true}).trim().split(/\\r?\\n/);
  assert.equal(changed.length,4,"only the four intended mod files changed");
  assert.ok(changed.includes(event.entry.name));
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("px.compatchEditorActions"));
  console.log("Compatch editor smoke passed: three clean updates, manual conflict resolution, source preservation, editor actions and Git review of exactly four files.");
};
`
  );
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: executable,
  extensionDevelopmentPath: join(root, "packages/vscode"),
  extensionTestsPath: suite,
  launchArgs: [
    join(scratch, "Mod"),
    "--user-data-dir",
    join(scratch, "user"),
    "--extensions-dir",
    join(scratch, "extensions"),
    "--disable-gpu",
    "--no-sandbox",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
  ],
});
