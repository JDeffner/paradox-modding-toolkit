// Exercise the declared minimum editor in an isolated profile, without a game install.
import { runTests } from "@vscode/test-electron";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "packages/vscode/package.json"), "utf8"));
const scratch = mkdtempSync(join(tmpdir(), "px-minimum-vscode-"));
const mod = join(scratch, "mod");
mkdirSync(join(mod, "common/scripted_effects"), { recursive: true });
writeFileSync(join(mod, "descriptor.mod"), 'name="Compatibility smoke"\n');
writeFileSync(join(mod, "common/scripted_effects/test.txt"), "\uFEFFcompatibility_effect = { }\n");
const user = join(scratch, "user", "User");
mkdirSync(user, { recursive: true });
writeFileSync(
  join(user, "settings.json"),
  JSON.stringify({
    "security.workspace.trust.enabled": false,
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "update.mode": "none",
    "px.gameId": "ck3",
  })
);
const suite = join(scratch, "suite.cjs");
writeFileSync(
  suite,
  `
const assert = require("node:assert/strict");
const vscode = require("vscode");
exports.run = async () => {
  const extension = vscode.extensions.getExtension("JDeffner.px-toolkit");
  assert.ok(extension, "extension discovered");
  await extension.activate();
  const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, "common/scripted_effects/test.txt");
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
  await vscode.languages.setTextDocumentLanguage(doc, "paradox");
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const result = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", uri, new vscode.Position(0, 25));
    if (result && result.items.some(item => (typeof item.label === "string" ? item.label : item.label.label) === "save_scope_as")) {
      console.log("Minimum VS Code: activation and LSP completion passed");
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("LSP completion did not become available within 30 seconds");
};
`
);
// VS Code's integrated terminal can inherit this from its Electron parent.
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  version: manifest.engines.vscode.replace(/^\^/, ""),
  extensionDevelopmentPath: join(root, "packages/vscode"),
  extensionTestsPath: suite,
  launchArgs: [
    mod,
    "--user-data-dir",
    join(scratch, "user"),
    "--extensions-dir",
    join(scratch, "extensions"),
    "--disable-gpu",
    "--no-sandbox",
    "--skip-welcome",
    "--skip-release-notes",
  ],
});
