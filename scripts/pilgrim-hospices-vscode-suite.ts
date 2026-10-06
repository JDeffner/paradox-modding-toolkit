import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { execFileSync } from "node:child_process";
import { addFile, emptyInventory } from "../packages/vscode/src/compatch/core";
import { needsGameUpdate } from "../packages/vscode/src/compatch/gameUpdate";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { parseScript } from "@px-lsp/server/parser";
import { connect } from "./webview-cdp";

async function checks() {
  const originalMod = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const root = path.dirname(originalMod);
  const mod = path.join(root, "Result");
  const eventPath = "events/activities/pilgrimage_activity/pilgrimage_events.txt";
  const activityPath = "common/activities/activity_types/pilgrimage.txt";
  const holyOld = "common/religion/holy_sites/00_holy_sites.txt";
  const holyNew = "common/religion/holy_site_types/00_holy_site_types.txt";
  const read = (role: string, file: string) => fs.readFile(path.join(root, role, file), "utf8");
  const inventory = emptyInventory();
  const sourceBytes = new Map<string, string>();
  for (const [side, dir, files] of [
    ["A", "Practice", [eventPath, activityPath, holyOld]],
    ["base", "Vanilla 1.18", [eventPath, activityPath, holyOld]],
    ["B", "Vanilla 1.19", [eventPath, activityPath, holyNew]],
  ] as const) {
    for (const file of files) {
      const text = await read(dir, file);
      addFile(inventory, side, file, text, ck3Meta.compatch);
      sourceBytes.set(`${dir}/${file}`, text);
    }
  }
  const tasks = [...inventory.entries.values()].filter(needsGameUpdate);
  assert.equal(tasks.length, 17);
  const row = (name: string) => ({ entry: tasks.find((e) => e.name === name)! });
  await vscode.extensions.getExtension("JDeffner.px-toolkit")!.activate();
  await vscode.commands.executeCommand("px.openCompatch");
  execFileSync("git", ["-C", mod, "init"], { windowsHide: true });
  execFileSync("git", ["-C", mod, "add", "."], { windowsHide: true });
  console.log("Pilgrim: separate Result initialized; original Mod and both game sources are read-only.");
  const event = row("pilgrimage.2005");
  await vscode.commands.executeCommand("px.compareCompatch", event);
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab!;
  assert.ok(tab.input instanceof vscode.TabInputTextDiff);
  assert.equal(tab.input.modified.scheme, "px-compatch", "game comparison is read-only");
  assert.ok(tab.label.startsWith("Old Game Version"));
  const editor = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === (tab.input as vscode.TabInputTextDiff).modified.toString()
  )!;
  assert.ok(editor.document.getText().includes("pilgrimage.2005"), "comparison contains the selected event");
  const before = await read("Result", eventPath);
  await vscode.commands.executeCommand("px.compatchApplyMerge", event);
  assert.equal(await read("Result", eventPath), before, "overlapping cooldown changes never write");
  const conflict = vscode.window.tabGroups.activeTabGroup.activeTab!.input as vscode.TabInputTextDiff;
  assert.equal(conflict.modified.scheme, "file", "resolution is a real editable temporary file");
  assert.notEqual(conflict.modified.fsPath, path.join(mod, eventPath));
  const resolution = await vscode.workspace.openTextDocument(conflict.modified);
  const preview = resolution.getText();
  for (const label of ["<<<<<<< Mod", "||||||| Old Game Version", ">>>>>>> New Game Version"])
    assert.ok(preview.includes(label));
  assert.ok(preview.includes("years = 2") && preview.includes("years = 4") && preview.includes("years = 5"));
  const ui = await connect("Boolean(document.querySelector('.monaco-workbench'))");
  await ui.screenshot(path.join(root, "pilgrim-conflict.png"));
  ui.close();
  const reference = await read("Reference 1.19", eventPath);
  const selectedEvent = (text: string) => {
    const found = parseScript(text).root.statements.find(
      (statement) => statement.kind === "assignment" && statement.key.text === event.entry.name
    );
    assert.ok(found, "selected event exists");
    return found.range;
  };
  const oldRange = selectedEvent(before),
    referenceRange = selectedEvent(reference);
  const selectedResult =
    before.slice(0, oldRange.start) +
    reference.slice(referenceRange.start, referenceRange.end) +
    before.slice(oldRange.end);
  const selectedEdit = new vscode.WorkspaceEdit();
  selectedEdit.replace(
    resolution.uri,
    new vscode.Range(resolution.positionAt(0), resolution.positionAt(resolution.getText().length)),
    selectedResult.replace(/^\uFEFF/, "")
  );
  assert.ok(await vscode.workspace.applyEdit(selectedEdit));
  await vscode.window.showTextDocument(resolution);
  await vscode.commands.executeCommand("px.compatchApplyResolved");
  assert.equal(
    (await read("Result", eventPath)).replace(/^\uFEFF/, ""),
    selectedResult.replace(/^\uFEFF/, ""),
    "selected-event resolution preserves every sibling event"
  );
  await vscode.commands.executeCommand("px.compatchPreviewMerge", row(activityPath));
  assert.equal(await read("Result", activityPath), inventory.files.A.get(activityPath));
  await vscode.commands.executeCommand("px.compatchApplyMerge", row(activityPath));
  const updated = await read("Result", activityPath);
  assert.equal(updated, await read("Reference 1.19", activityPath));
  assert.ok(updated.includes("has_house_aspiration_parameter") && updated.includes("ph_hospice_patron"));
  // A separate full-file result carries the remaining upstream event changes.
  const fileRow = structuredClone(row(eventPath));
  await vscode.commands.executeCommand("px.compatchPreviewMerge", fileRow);
  const fullConflict = vscode.window.tabGroups.activeTabGroup.activeTab!.input as vscode.TabInputTextDiff;
  const doc = await vscode.workspace.openTextDocument(fullConflict.modified);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    doc.uri,
    new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
    (await read("Reference 1.19", eventPath)).replace(/^\uFEFF/, "")
  );
  assert.ok(await vscode.workspace.applyEdit(edit));
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand("px.compatchApplyResolved");
  assert.equal(await read("Result", eventPath), await read("Reference 1.19", eventPath));
  // File relocation is a manual review operation, not a guessed automatic rename.
  const move = new vscode.WorkspaceEdit();
  move.deleteFile(vscode.Uri.file(path.join(mod, holyOld)));
  move.createFile(vscode.Uri.file(path.join(mod, holyNew)));
  move.insert(
    vscode.Uri.file(path.join(mod, holyNew)),
    new vscode.Position(0, 0),
    await read("Reference 1.19", holyNew)
  );
  assert.ok(await vscode.workspace.applyEdit(move));
  assert.ok(await (await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(mod, holyNew)))).save());
  await vscode.commands.executeCommand("px.refreshCompatch");
  for (const [file, text] of sourceBytes)
    assert.equal(await fs.readFile(path.join(root, file), "utf8"), text);
  const changed = execFileSync("git", ["-C", mod, "diff", "--name-only"], {
    encoding: "utf8",
    windowsHide: true,
  })
    .trim()
    .split(/\r?\n/);
  assert.deepEqual(changed.sort(), [activityPath, eventPath, holyOld].sort());
  const relocated = await read("Result", holyNew);
  assert.equal(relocated.replace(/\r\n/g, "\n"), await read("Reference 1.19", holyNew));
  assert.ok(relocated.startsWith("\uFEFF") && !relocated.startsWith("\uFEFF\uFEFF"));
  const finalUi = await connect("Boolean(document.querySelector('.monaco-workbench'))");
  await finalUi.screenshot(path.join(root, "pilgrim-result.png"));
  finalUi.close();
  await fs.writeFile(
    path.join(root, "editor-results.json"),
    JSON.stringify(
      {
        passed: true,
        initialEntries: tasks.length,
        checks: [
          "selected-event navigation",
          "editable temporary conflict result",
          "all three cooldowns visible",
          "clean merge equals reference",
          "BOM preservation",
          "explicit resolved-result apply",
          "selected-event resolution preserves siblings",
          "manual schema relocation",
          "source preservation",
          "separate Result preserves original mod",
          "Git review",
        ],
      },
      null,
      2
    )
  );
  console.log("Pilgrim Hospices: real 1.18 -> 1.19 editor checks passed.");
}

export async function run() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      checks(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Pilgrim editor checks exceeded 180 seconds")), 180_000);
      }),
    ]);
  } catch (error) {
    const root = path.dirname(vscode.workspace.workspaceFolders![0].uri.fsPath);
    await fs.writeFile(
      path.join(root, "failure.json"),
      JSON.stringify(
        { error: String(error), stack: error instanceof Error ? error.stack : undefined },
        null,
        2
      )
    );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
