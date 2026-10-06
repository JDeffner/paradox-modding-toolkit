import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { connect } from "./webview-cdp";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run() {
  const scratch = process.env.PX_WRITER_TEST_SCRATCH!;
  assert.ok(scratch);
  const checks: string[] = [];
  const mod = path.join(scratch, "Mod");
  const second = path.join(scratch, "Second");
  await vscode.extensions.getExtension("JDeffner.px-toolkit")!.activate();
  for (let i = 0; i < 150; i++) {
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      "editor_trait"
    );
    if (symbols?.some((symbol) => symbol.name === "editor_trait")) break;
    await pause(100);
  }
  await vscode.commands.executeCommand("px.createTrait", "editor_trait");
  await vscode.commands.executeCommand("workbench.action.closeSidebar");
  let ui = await connect("Boolean(document.getElementById('sections') && document.getElementById('name'))");
  const waitFor = async (expression: string, workbench = false) => {
    for (let i = 0; i < 150; i++) {
      if (await (workbench ? ui.evalWorkbench(expression) : ui.eval(expression))) return;
      await pause(100);
    }
    throw new Error(
      `Timed out: ${expression}. ${await (workbench ? ui.evalWorkbench("document.body.innerText") : ui.eval("document.body.innerText"))}`
    );
  };
  const pick = async (label: string) => {
    await waitFor(
      "Boolean(document.querySelector('.quick-input-widget:not([style*=\"display: none\"]) .quick-input-box input'))",
      true
    );
    await ui.sendWorkbench("Page.bringToFront", {});
    await ui.evalWorkbench(
      `(() => {const input=document.querySelector('.quick-input-widget .quick-input-box input');input.focus();input.select();})()`
    );
    await ui.sendWorkbench("Input.insertText", { text: label });
    await pause(350);
    await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
    await pause(350);
  };
  const locFiles = async (root: string) => {
    try {
      const folder = path.join(root, "localization");
      const files = await fs.readdir(folder, { recursive: true });
      return Promise.all(
        files
          .filter((name) => name.endsWith(".yml"))
          .map(async (name) => ({ name, text: await fs.readFile(path.join(folder, name), "utf8") }))
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  };
  const captureNotice = async (name: string) => {
    await ui.sendWorkbench("Page.bringToFront", {});
    await pause(250);
    const screenshot = await ui.sendWorkbench("Page.captureScreenshot", {
      format: "png",
      fromSurface: false,
    });
    await fs.writeFile(path.join(scratch, name), Buffer.from(screenshot.data as string, "base64"));
  };
  try {
    await waitFor(
      "document.getElementById('name').value==='editor_trait' && Boolean(document.querySelector('#sections code'))"
    );
    const existing = path.join(mod, "common/traits/existing_fixture.txt");
    const before = await fs.readFile(existing, "utf8");
    await ui.eval("document.getElementById('save').click()");
    await waitFor("document.body.textContent.includes('Saved editor_trait into')");
    assert.equal(await fs.readFile(existing, "utf8"), "\uFEFF" + before);
    await ui.screenshot(path.join(scratch, "creator-bom.png"));
    checks.push("Trait Creator Save adds one BOM to an existing UTF-8 script and preserves all source bytes");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    ui.close();
    await vscode.commands.executeCommand("px.createTrait", "brave");
    ui = await connect("Boolean(document.getElementById('sections') && document.getElementById('name'))");
    await waitFor("!document.getElementById('mode').hidden");
    const reference = await fs.readFile(path.join(scratch, "Vanilla/common/traits/vanilla_fixture.txt"));
    await ui.eval("document.getElementById('mode').click()");
    await ui.eval(
      "[...document.querySelectorAll('.px-menu [role=option]')].find(item=>item.textContent.includes('Override')).click()"
    );
    await waitFor("document.getElementById('name').value==='brave'");
    await ui.eval(
      "(() => { const code=[...document.querySelectorAll('#sections code')].find(code=>code.textContent==='trait_brave');const input=code.parentElement.querySelector('input');input.value='Editor Brave';input.dispatchEvent(new Event('change')); })()"
    );
    await ui.eval("document.getElementById('save').click()");
    await waitFor("document.querySelector('.px-confirmation')?.textContent.includes('Override the game')");
    await ui.eval(
      "[...document.querySelectorAll('.px-confirmation button')].find(button=>button.textContent==='Override').click()"
    );
    await waitFor("document.body.textContent.includes('Saved brave into')");
    assert.deepEqual(
      await fs.readFile(path.join(scratch, "Vanilla/common/traits/vanilla_fixture.txt")),
      reference
    );
    const overrides = await locFiles(mod);
    assert.ok(
      overrides.some(
        (file) =>
          /(^|\/)replace\//.test(file.name.replaceAll("\\", "/")) &&
          file.text.includes('trait_brave: "Editor Brave"')
      )
    );
    await ui.screenshot(path.join(scratch, "creator-override.png"));
    checks.push("rendered Override saves vanilla-key localization under replace and preserves vanilla bytes");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    ui.close();
    await vscode.commands.executeCommand("px.openDynastyTree");
    ui = await connect("Boolean(document.getElementById('newDynasty') && document.getElementById('picker'))");
    await waitFor("!document.body.textContent.includes('Reading dynasties')");
    await ui.eval("document.getElementById('newDynasty').click()");
    await waitFor("Boolean(document.querySelector('.px-confirmation input[placeholder=Karling]'))");
    await ui.eval(
      "(() => { const dialog=document.querySelector('.px-confirmation');dialog.querySelector('input[placeholder=Karling]').value='Editor Dynasty';[...dialog.querySelectorAll('button')].find(button=>button.textContent==='Create').click(); })()"
    );
    await pick("Writer Second");
    await pick("New file");
    await pick("editor_dynasties.txt");
    const dynastyFile = path.join(second, "common/dynasties/editor_dynasties.txt");
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fs.readFile(dynastyFile, "utf8")).includes("dynn_editor_dynasty")) break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await pause(100);
    }
    // Saving reveals the source editor; reopen the actual panel before checking Undo.
    await vscode.commands.executeCommand("px.openDynastyTree");
    ui.close();
    ui = await connect("Boolean(document.getElementById('newDynasty') && document.getElementById('picker'))");
    await waitFor("!document.getElementById('undo').disabled");
    const dynasty = await fs.readFile(dynastyFile, "utf8");
    assert.ok(dynasty.startsWith("\uFEFF") && dynasty.includes("dynn_editor_dynasty"));
    const secondLoc = await locFiles(second);
    const nameFile = secondLoc.find((file) => file.text.includes('dynn_editor_dynasty: "Editor Dynasty"'));
    assert.ok(nameFile);
    const emptyNameFile = `\uFEFFl_english:${nameFile.text.includes("\r\n") ? "\r\n" : "\n"}`;
    assert.ok((await locFiles(mod)).every((file) => !file.text.includes("dynn_editor_dynasty")));
    await ui.screenshot(path.join(scratch, "dynasty-second-target.png"));
    checks.push("Dynasty Create native target picker writes the name into the selected second mod");
    await ui.eval("document.getElementById('undo').click()");
    for (let i = 0; i < 100; i++) {
      if ((await fs.readFile(path.join(second, "localization", nameFile.name), "utf8")) === emptyNameFile)
        break;
      await pause(100);
    }
    assert.equal(await fs.readFile(path.join(second, "localization", nameFile.name), "utf8"), emptyNameFile);
    await ui.screenshot(path.join(scratch, "dynasty-name-undo.png"));
    checks.push("Dynasty name Undo restores a newly created localization file with exactly one BOM");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    const referenceFile = path.join(scratch, "Reference/common/decisions/keep.txt");
    const referenceBefore = await fs.readFile(referenceFile);
    const content = vscode.commands.executeCommand(
      "px.newContent",
      vscode.Uri.file(path.join(mod, "common/decisions"))
    );
    await pick("writer");
    await pick("writer_linked_decision");
    await content;
    await waitFor("document.body.textContent.includes('failed to create content')", true);
    assert.deepEqual(await fs.readFile(referenceFile), referenceBefore);
    assert.deepEqual(await fs.readdir(path.dirname(referenceFile)), ["keep.txt"]);
    await captureNotice("linked-destination-refused.png");
    checks.push(
      "New Content rejects a reference junction destination through native prompts and preserves the reference"
    );
    await vscode.commands.executeCommand("notifications.clearAll");
    const german = path.join(mod, "localization/german/translate_l_german.yml");
    const badHeader = await fs.readFile(german);
    const addLanguage = vscode.commands.executeCommand("px.createTranslation", { modRoot: mod });
    await pick("english");
    await pick("other...");
    await pick("german");
    await addLanguage;
    await waitFor("document.body.textContent.includes('Could not add translation')", true);
    assert.deepEqual(await fs.readFile(german), badHeader);
    await captureNotice("add-language-header-refused.png");
    checks.push("Add Language rejects the wrong destination header and preserves exact bytes");
    await vscode.commands.executeCommand("notifications.clearAll");
    const germanBefore = '\uFEFFl_german:\n writer_translation:0 ""\n';
    await fs.writeFile(german, germanBefore);
    await pause(1000);
    const translate = vscode.commands.executeCommand("px.translateNext", vscode.Uri.file(german));
    await waitFor(
      "document.querySelector('.quick-input-widget')?.textContent.includes('Translate to German')",
      true
    );
    const manual = germanBefore + "# manual external edit during prompt\n";
    await fs.writeFile(german, manual);
    await pick("Editor translation");
    await translate;
    await waitFor("document.body.textContent.includes('failed to write writer_translation')", true);
    assert.equal(await fs.readFile(german, "utf8"), manual);
    await captureNotice("translation-stale-refused.png");
    checks.push("Translate Missing Keys rejects an external destination change during its native prompt");
    await vscode.commands.executeCommand("notifications.clearAll");
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(path.join(mod, "events/translation.txt"))
    );
    await vscode.commands.executeCommand("px.generateCalendarLoc");
    const generated = await locFiles(mod);
    assert.ok(generated.some((file) => file.text.includes("PX_CAL_YEAR")));
    const regenerate = vscode.commands.executeCommand("px.generateCalendarLoc");
    await waitFor("document.body.textContent.includes('Update the generated calendar entries')", true);
    await fs.mkdir(path.join(mod, ".px-toolkit"), { recursive: true });
    await fs.writeFile(
      path.join(mod, ".px-toolkit/calendar.json"),
      JSON.stringify({ epoch: 5000, after: "AD", before: "BC" })
    );
    await ui.evalWorkbench(
      "[...document.querySelectorAll('.notifications-toasts .monaco-button')].find(button=>button.textContent==='Regenerate').click()"
    );
    await regenerate;
    await waitFor("document.body.textContent.includes('Could not generate calendar localization')", true);
    assert.deepEqual(await locFiles(mod), generated);
    await captureNotice("calendar-new-config-refused.png");
    checks.push(
      "Calendar Regenerate rejects a declaration created while confirmation is open and preserves generated outputs"
    );
    await fs.writeFile(
      path.join(scratch, "results.json"),
      JSON.stringify({ passed: true, vscode: vscode.version, checks }, null, 2)
    );
    console.log(`Packaged writer boundary checks passed: ${checks.length} groups.`);
  } catch (error) {
    const evidence = await Promise.allSettled([ui.screenshot(path.join(scratch, "failure.png"))]);
    await fs.writeFile(
      path.join(scratch, "failure.json"),
      JSON.stringify(
        {
          checks,
          error: String(error),
          stack: error instanceof Error ? error.stack : undefined,
          evidence: evidence.map((item) => (item.status === "fulfilled" ? "saved" : String(item.reason))),
        },
        null,
        2
      )
    );
    throw error;
  } finally {
    ui.close();
  }
}
