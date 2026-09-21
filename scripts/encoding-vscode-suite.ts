import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

const command = "px.saveWithUtf8Bom";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => T | undefined, description: string): Promise<T> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await pause(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function bomDiagnostic(uri: vscode.Uri): vscode.Diagnostic | undefined {
  return vscode.languages
    .getDiagnostics(uri)
    .find(
      (diagnostic) =>
        (typeof diagnostic.code === "object" ? diagnostic.code.value : diagnostic.code) === "missing-bom"
    );
}

async function fixAction(
  document: vscode.TextDocument,
  severity: vscode.DiagnosticSeverity
): Promise<vscode.CodeAction> {
  const diagnostic = await waitFor(() => bomDiagnostic(document.uri), "LSP missing-bom diagnostic");
  assert.equal(diagnostic.severity, severity);
  const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
    "vscode.executeCodeActionProvider",
    document.uri,
    diagnostic.range,
    vscode.CodeActionKind.QuickFix.value
  );
  const action = actions?.find((item) => item.command?.command === command);
  assert.ok(action?.command, "native code action carries the encoding command");
  assert.equal(action.command.arguments?.[0].toString(), document.uri.toString());
  return action;
}

async function executeAction(action: vscode.CodeAction): Promise<void> {
  assert.ok(action.command);
  await vscode.commands.executeCommand(action.command.command, ...(action.command.arguments ?? []));
}

async function replace(document: vscode.TextDocument, text: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
    text
  );
  assert.ok(await vscode.workspace.applyEdit(edit));
}

async function assertSaved(uri: vscode.Uri, text: string): Promise<void> {
  assert.deepEqual(
    await fs.readFile(uri.fsPath),
    Buffer.from(`\uFEFF${text}`, "utf8"),
    "exact UTF-8 bytes, one BOM, and original line endings"
  );
  const document = await vscode.workspace.openTextDocument(uri);
  assert.equal(document.getText(), text, "encoder consumes the BOM instead of exposing it in the buffer");
  assert.equal(document.isDirty, false);
  await waitFor(
    () => (!bomDiagnostic(uri) ? true : undefined),
    "warning to clear after save without another text edit"
  );
}

async function cancelPicker(
  document: vscode.TextDocument,
  invoke: () => PromiseLike<unknown>
): Promise<void> {
  const bytes = await fs.readFile(document.uri.fsPath);
  const text = document.getText();
  const dirty = document.isDirty;
  const pending = invoke();
  // The native command waits for its quick picker. Close it through VS Code's command API.
  await pause(300);
  await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
  await pending;
  assert.equal(document.getText(), text, "cancel leaves the source text untouched");
  assert.equal(document.isDirty, dirty, "cancel preserves unsaved edits");
  assert.deepEqual(await fs.readFile(document.uri.fsPath), bytes, "cancel never changes disk bytes");
}

async function saveThroughPicker(invoke: () => PromiseLike<unknown>, alreadyBom = false): Promise<void> {
  const pending = invoke();
  await pause(400);
  // VS Code 1.91 and current editorStatus.ts list Reopen first, Save second.
  // https://github.com/microsoft/vscode/blob/1.91.0/src/vs/workbench/browser/parts/editor/editorStatus.ts
  await vscode.commands.executeCommand("workbench.action.quickOpenSelectNext");
  await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
  await pause(500);
  // files.encoding is utf8 in this isolated profile. UTF-8 with BOM follows
  // the active UTF-8 item (SUPPORTED_ENCODINGS in textfile/common/encoding.ts).
  // An existing BOM is guessed from disk and moved before the configured UTF-8
  // row, which remains active through its utf8bom alias.
  await vscode.commands.executeCommand(
    alreadyBom ? "workbench.action.quickOpenSelectPrevious" : "workbench.action.quickOpenSelectNext"
  );
  await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
  await pending;
}

async function checkEncoding(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  const mod = folder.uri.fsPath;
  const scratch = path.dirname(mod);
  assert.equal(
    await fs.readFile(path.join(mod, ".px-encoding-fixture"), "utf8"),
    "isolated encoding smoke\n"
  );
  const extension = vscode.extensions.getExtension("JDeffner.px-toolkit");
  assert.ok(extension);
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const id of [
    "workbench.action.quickOpenSelectNext",
    "workbench.action.quickOpenSelectPrevious",
    "workbench.action.acceptSelectedQuickOpenItem",
  ]) {
    assert.ok(commands.includes(id), `native picker command registered: ${id}`);
  }
  const fixture = async (relative: string, contents: string | Buffer): Promise<vscode.TextDocument> => {
    const file = path.resolve(mod, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, contents);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(document, { preview: false });
    return document;
  };

  const script = await fixture("events/dirty.txt", "# Saved Unicode: café 日本語\r\n");
  const dirty = "# Unsaved Unicode: café 日本語 😀\r\n# Second line\r\n";
  await replace(script, dirty);
  const action = await fixAction(script, vscode.DiagnosticSeverity.Warning);
  const unrelated = await fixture("encoding-unrelated.txt", "# Unrelated saved text\n");
  const unrelatedDirty = "# Unrelated unsaved text\n";
  await replace(unrelated, unrelatedDirty);
  await cancelPicker(script, () => executeAction(action));
  assert.equal(
    vscode.window.activeTextEditor?.document.uri.toString(),
    script.uri.toString(),
    "native picker targets the diagnostic file"
  );
  await vscode.window.showTextDocument(unrelated, { preview: false });
  await saveThroughPicker(() => executeAction(action));
  await assertSaved(script.uri, dirty);
  await saveThroughPicker(() => vscode.commands.executeCommand(command, script.uri), true);
  await assertSaved(script.uri, dirty);
  const current = await vscode.workspace.openTextDocument(script.uri);
  const next = `${dirty}# A later normal save\r\n`;
  await replace(current, next);
  assert.ok(await current.save());
  await assertSaved(script.uri, next);
  assert.equal(unrelated.getText(), unrelatedDirty);
  assert.ok(unrelated.isDirty, "unrelated active editor stays dirty");
  assert.equal(await fs.readFile(unrelated.uri.fsPath, "utf8"), "# Unrelated saved text\n");

  const locText = 'l_english:\n encoding_test:0 "Café 日本語"\n';
  const loc = await fixture("localization/english/encoding_l_english.yml", locText);
  const locAction = await fixAction(loc, vscode.DiagnosticSeverity.Error);
  await saveThroughPicker(() => executeAction(locAction));
  await assertSaved(loc.uri, locText);
  const undoText = "# Undo preserves café 日本語\n";
  const undo = await fixture("events/undo.txt", undoText);
  const undoAction = await fixAction(undo, vscode.DiagnosticSeverity.Warning);
  await saveThroughPicker(() => executeAction(undoAction));
  await assertSaved(undo.uri, undoText);
  await vscode.window.showTextDocument(undo.uri, { preview: false });
  await vscode.commands.executeCommand("undo");
  const undone = await vscode.workspace.openTextDocument(undo.uri);
  assert.ok(await undone.save());
  await assertSaved(undo.uri, undoText);
  const utf16 = await fixture("events/utf16.txt", Buffer.from("\uFEFF# UTF-16 café\r\n", "utf16le"));
  await replace(utf16, "# UTF-16 unsaved café\r\n");
  await cancelPicker(utf16, () => vscode.commands.executeCommand(command, utf16.uri));
  const invalid = await fixture("events/invalid.txt", Buffer.from([35, 32, 0xff, 10]));
  await replace(invalid, `${invalid.getText()}# Unsaved\n`);
  await cancelPicker(invalid, () => vscode.commands.executeCommand(command, invalid.uri));

  for (const relative of [
    "../Vanilla/events/read-only.txt",
    "../Dependency/events/read-only.txt",
    "../Outside/events/read-only.txt",
    "gui/not-a-script.gui",
  ]) {
    const document = await fixture(relative, "# Must remain unchanged\n");
    await vscode.commands.executeCommand(command, document.uri);
    assert.equal(document.getText(), "# Must remain unchanged\n");
    assert.equal(document.isDirty, false);
    assert.equal(await fs.readFile(document.uri.fsPath, "utf8"), "# Must remain unchanged\n");
  }
  await fs.writeFile(
    path.join(scratch, "encoding-results.json"),
    JSON.stringify(
      {
        passed: true,
        vscode: vscode.version,
        checks: [
          "real LSP diagnostic and code action",
          "explicit URI and unrelated dirty editor",
          "native encoding choice saves Unicode, CRLF/LF, exact BOM bytes and clears warning",
          "repeat fix, undo and subsequent save preserve one BOM",
          "cancel preserves dirty UTF-8, UTF-16 and invalid UTF-8 source and disk",
          "localization quick fix",
          "read-only roots and non-TXT rejected",
        ],
      },
      null,
      2
    ) + "\n"
  );
  console.log(`Encoding editor smoke passed on VS Code ${vscode.version} (native encoding picker).`);
}

export async function run(): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      checkEncoding(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Encoding editor smoke exceeded 120 seconds")), 120_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
    // All dirty documents are disposable fixtures. Revert them without saving or prompting on exit.
    for (const document of vscode.workspace.textDocuments.filter((item) => item.isDirty)) {
      await vscode.window.showTextDocument(document, { preview: false });
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  }
}
