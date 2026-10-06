import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { connect } from "./webview-cdp";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(read: () => Promise<boolean> | boolean, label: string): Promise<void> {
  const end = Date.now() + 90_000;
  while (Date.now() < end) {
    if (await read()) return;
    await pause(200);
  }
  throw new Error("Timed out: " + label);
}
async function logsContain(dir: string, text: string): Promise<boolean> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory() && (await logsContain(file, text))) return true;
    if (entry.isFile() && entry.name.endsWith(".log") && (await fs.readFile(file, "utf8")).includes(text))
      return true;
  }
  return false;
}
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("JDeffner.px-toolkit");
  assert.ok(extension);
  assert.equal(
    path.resolve(extension.extensionPath).toLowerCase(),
    path.resolve(process.env.PX_TEST_PACKED_EXTENSION!).toLowerCase(),
    "The VSIX payload is active."
  );
  const machine = {
    version: 1,
    defaults: {
      ck3: {
        gamePath: process.env.PX_TEST_GAME!,
        tigerPath: process.env.PX_TEST_TIGER!,
        logsPath: process.env.PX_TEST_SCRIPT_DOCS ?? "",
      },
    },
  };
  await vscode.workspace
    .getConfiguration("px")
    .update("machinePaths", machine, vscode.ConfigurationTarget.Global);
  await extension.activate();
  const uri = vscode.Uri.joinPath(
    vscode.workspace.workspaceFolders![0].uri,
    "common/scripted_effects/probe.txt"
  );
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
  const diagnostics = () =>
    vscode.languages.getDiagnostics(uri).filter((item) => item.source === "ck3-tiger");
  await vscode.commands.executeCommand("px.runTiger");
  await until(
    () =>
      diagnostics().some(
        (item) =>
          item.severity === vscode.DiagnosticSeverity.Error &&
          item.message.includes("pxtk_intentionally_invalid_effect")
      ),
    "Tiger diagnostic through px.runTiger"
  );
  assert.ok(diagnostics().some((item) => item.code === "unknown-field"));
  await vscode.commands.executeCommand("workbench.actions.view.problems");
  const ui = await connect("Boolean(document.querySelector('.monaco-workbench'))");
  try {
    await ui.screenshot(path.join(path.dirname(process.env.PX_TEST_LOGS!), "tiger-diagnostics.png"));
  } finally {
    ui.close();
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    uri,
    new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
    "pxtk_editor_probe = { add_gold = 1 }\n"
  );
  assert.ok(await vscode.workspace.applyEdit(edit));
  assert.ok(await doc.save());
  await vscode.commands.executeCommand("px.runTiger");
  await until(() => diagnostics().length === 0, "Tiger findings clear after the saved fix");
  await vscode.workspace.getConfiguration("px").update(
    "machinePaths",
    {
      ...machine,
      defaults: { ck3: { ...machine.defaults.ck3, tigerPath: process.env.PX_TEST_NODE! } },
    },
    vscode.ConfigurationTarget.Global
  );
  await pause(300);
  await vscode.commands.executeCommand("px.runTiger");
  await until(
    () => logsContain(process.env.PX_TEST_LOGS!, "validation failed:"),
    "Failed process reported by the packaged runner"
  );
  assert.ok(doc.getText().includes("add_gold = 1"), "Validation preserves edited content.");
  console.log(
    "Packaged Tiger: error diagnostic, saved fix, clean rerun and failed process reporting passed."
  );
}
