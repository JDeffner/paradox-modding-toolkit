import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { execFileSync } from "node:child_process";
import { addFile, emptyInventory } from "../packages/vscode/src/compatch/core";
import { needsGameUpdate } from "../packages/vscode/src/compatch/gameUpdate";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { parseScript } from "@px-lsp/server/parser";

export async function run() {
  const mod = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const root = path.dirname(mod);
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
      if (side !== "A") sourceBytes.set(`${dir}/${file}`, text);
    }
  }
  const tasks = [...inventory.entries.values()].filter(needsGameUpdate);
  assert.equal(tasks.length, 17);
  const row = (name: string) => ({ entry: tasks.find((e) => e.name === name)! });
  await vscode.extensions.getExtension("JDeffner.px-toolkit")!.activate();
  await vscode.commands.executeCommand("px.openCompatch");
  const event = row("pilgrimage.2005");
  await vscode.commands.executeCommand("px.compareCompatch", event);
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab!;
  assert.ok(tab.input instanceof vscode.TabInputTextDiff);
  assert.equal(tab.input.original.scheme, "px-compatch");
  assert.equal(tab.input.modified.scheme, "px-compatch");
  assert.ok(tab.label.startsWith("Old Game Version"));
  const target = await vscode.workspace.openTextDocument(tab.input.modified);
  assert.equal(
    target.getText().replace(/\r\n/g, "\n"),
    event.entry.sites.B[0].text.replace(/\r\n/g, "\n"),
    "comparison shows the selected event"
  );
  const before = await read("Practice", eventPath);
  await vscode.commands.executeCommand("px.compatchApplyMerge", event);
  assert.equal(await read("Practice", eventPath), before, "overlapping cooldown changes never write");
  const conflict = vscode.window.tabGroups.activeTabGroup.activeTab!.input as vscode.TabInputTextDiff;
  assert.equal(conflict.modified.scheme, "file", "resolution is a real editable temporary file");
  assert.notEqual(conflict.modified.fsPath, path.join(mod, eventPath));
  const resolution = await vscode.workspace.openTextDocument(conflict.modified);
  const preview = resolution.getText();
  for (const label of ["<<<<<<< Mod", "||||||| Old Game Version", ">>>>>>> New Game Version"])
    assert.ok(preview.includes(label));
  assert.ok(preview.includes("years = 2") && preview.includes("years = 4") && preview.includes("years = 5"));
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
    (await read("Practice", eventPath)).replace(/^\uFEFF/, ""),
    selectedResult.replace(/^\uFEFF/, ""),
    "selected-event resolution preserves every sibling event"
  );
  await vscode.commands.executeCommand("px.compatchPreviewMerge", row(activityPath));
  assert.equal(await read("Practice", activityPath), inventory.files.A.get(activityPath));
  await vscode.commands.executeCommand("px.compatchApplyMerge", row(activityPath));
  const updated = await read("Practice", activityPath);
  assert.equal(updated, await read("Reference 1.19", activityPath));
  assert.ok(updated.includes("has_house_aspiration_parameter") && updated.includes("ph_hospice_patron"));
  // A separate full-file result carries the remaining upstream event changes.
  const fileRow = structuredClone(row(eventPath));
  fileRow.entry.sites.A[0].text = await read("Practice", eventPath);
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
  assert.equal(await read("Practice", eventPath), await read("Reference 1.19", eventPath));
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
  const relocated = await read("Practice", holyNew);
  assert.equal(relocated.replace(/\r\n/g, "\n"), await read("Reference 1.19", holyNew));
  assert.ok(relocated.startsWith("\uFEFF") && !relocated.startsWith("\uFEFF\uFEFF"));
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
          "Git review",
        ],
      },
      null,
      2
    )
  );
  console.log("Pilgrim Hospices: real 1.18 -> 1.19 editor checks passed.");
}
