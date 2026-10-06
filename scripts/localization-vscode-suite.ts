import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { connect } from "./webview-cdp";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function checks() {
  const scratch = process.env.PX_LOCALIZATION_TEST_SCRATCH!;
  assert.ok(scratch);
  const mod = path.join(scratch, "Second");
  const vanilla = path.join(scratch, "Vanilla");
  const imported = "common/traits/import_traits.txt";
  const dirtySource = "common/traits/dirty_traits.txt";
  const originals = new Map<string, Buffer>();
  for (const file of [imported, dirtySource, "common/folder_only/child/keep.txt"]) {
    originals.set(file, await fs.readFile(path.join(vanilla, file)));
  }
  const extension = vscode.extensions.getExtension("JDeffner.px-toolkit")!;
  await extension.activate();
  await vscode.commands.executeCommand("px.focusThisMod", vscode.Uri.file(mod));
  const ui = await connect("Boolean(document.querySelector('.monaco-workbench'))");
  const waitFor = async (check: string | (() => Promise<boolean>), label: string) => {
    for (let i = 0; i < 150; i++) {
      if (typeof check === "string" ? await ui.evalWorkbench(check) : await check()) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${label}. ${await ui.evalWorkbench("document.body.innerText")}`);
  };
  const exists = async (file: string) => {
    try {
      await fs.stat(file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  };
  const press = async (key: string, code: number) => {
    for (const type of ["keyDown", "keyUp"])
      await ui.sendWorkbench("Input.dispatchKeyEvent", {
        type,
        key,
        code: key,
        windowsVirtualKeyCode: code,
      });
  };
  const screenshot = async (name: string) => {
    const shot = await ui.sendWorkbench("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(scratch, name), Buffer.from(shot.data as string, "base64"));
  };
  const queryAll = (selector: string) => `(() => {
    const roots=[document], elements=[];
    for (let i=0;i<roots.length;i++) {
      elements.push(...roots[i].querySelectorAll(${JSON.stringify(selector)}));
      for (const element of roots[i].querySelectorAll('*')) {
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    }
    return elements;
  })()`;
  const openMenu = async (file: string) => {
    await vscode.commands.executeCommand("workbench.view.explorer");
    await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(file));
    const name = path.basename(file);
    const selector = `[...document.querySelectorAll('.explorer-item .label-name')].find(el=>el.textContent===${JSON.stringify(name)})`;
    await waitFor(`Boolean(${selector})`, `Explorer item ${name}`);
    const position = (await ui.evalWorkbench(
      `(() => { const r=(${selector}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`
    )) as { x: number; y: number };
    for (const type of ["mousePressed", "mouseReleased"])
      await ui.sendWorkbench("Input.dispatchMouseEvent", {
        type,
        ...position,
        button: "right",
        clickCount: 1,
      });
    await waitFor(`${queryAll(".monaco-menu .action-label")}.length > 0`, `context menu ${name}`);
  };
  const menuItem = (title: string) =>
    `${queryAll(".monaco-menu .action-label")}.find(el=>el.textContent===${JSON.stringify(title)})`;
  const clickElement = async (expression: string, label: string) => {
    await waitFor(`Boolean(${expression})`, label);
    await ui.evalWorkbench(`(${expression}).scrollIntoView({block:'nearest'})`);
    await ui.evalWorkbench(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
    );
    const position = (await ui.evalWorkbench(`(() => {
      const element=${expression};
      const r=element.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height,disabled:element.closest('[aria-disabled="true"],.disabled')!==null};
    })()`)) as { x: number; y: number; width: number; height: number; disabled: boolean };
    assert.ok(position.width > 0 && position.height > 0, `${label} is rendered`);
    assert.equal(position.disabled, false, `${label} is enabled`);
    await ui.sendWorkbench("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: position.x,
      y: position.y,
      button: "none",
      buttons: 0,
    });
    await ui.evalWorkbench("new Promise(resolve => requestAnimationFrame(resolve))");
    const hit = await ui.evalWorkbench(`(() => {
      const element=${expression};
      let target=document.elementFromPoint(${position.x},${position.y});
      while (target?.shadowRoot) target=target.shadowRoot.elementFromPoint(${position.x},${position.y});
      return target===element || element.contains(target);
    })()`);
    assert.equal(hit, true, `${label} receives the mouse click`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await ui.sendWorkbench("Input.dispatchMouseEvent", {
        type,
        x: position.x,
        y: position.y,
        button: "left",
        buttons: type === "mousePressed" ? 1 : 0,
        clickCount: 1,
      });
    }
  };
  const clickMenu = async (title: string) => {
    await waitFor(`Boolean(${menuItem(title)})`, title);
    // VS Code arms menu mouse-up handlers after a 100 ms opening guard.
    await pause(150);
    await clickElement(menuItem(title), title);
  };
  const enterValue = async (value: string) => {
    await waitFor("Boolean(document.querySelector('.quick-input-widget input'))", "input box");
    await ui.evalWorkbench(
      "document.querySelector('.quick-input-widget input').focus(); document.querySelector('.quick-input-widget input').select()"
    );
    await ui.sendWorkbench("Input.insertText", { text: value });
    await press("Enter", 13);
  };
  const checks: string[] = [];
  try {
    await vscode.commands.executeCommand("notifications.clearAll");
    await openMenu(path.join(vanilla, imported));
    await waitFor(
      `Boolean(${menuItem("PX: Copy Vanilla File to Focus Mod")})`,
      "vanilla file action visible"
    );
    await screenshot("vanilla-file-menu.png");
    await clickMenu("PX: Copy Vanilla File to Focus Mod");
    await waitFor(() => exists(path.join(mod, imported)), "vanilla file copied");
    assert.deepEqual(await fs.readFile(path.join(mod, imported)), originals.get(imported));
    assert.equal(
      await exists(path.join(scratch, "Mod", imported)),
      false,
      "copy uses focused mod rather than configured primary mod"
    );
    await waitFor(
      "document.body.innerText.includes('Copied') && document.body.innerText.includes('import_traits.txt')",
      "file import success notice"
    );
    await vscode.commands.executeCommand("notifications.clearAll");
    await openMenu(path.join(vanilla, "common/folder_only"));
    await waitFor(
      `Boolean(${menuItem("PX: Create Vanilla Folder Path in Focus Mod")})`,
      "vanilla folder action visible"
    );
    await screenshot("vanilla-folder-menu.png");
    await clickMenu("PX: Create Vanilla Folder Path in Focus Mod");
    await waitFor(() => exists(path.join(mod, "common/folder_only")), "folder path created");
    assert.deepEqual(await fs.readdir(path.join(mod, "common/folder_only")), []);
    checks.push("visible Explorer actions, focused mod, byte-preserving file import and folder path only");

    await vscode.commands.executeCommand("notifications.clearAll");
    const source = await vscode.workspace.openTextDocument(path.join(vanilla, dirtySource));
    await vscode.window.showTextDocument(source);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      source.uri,
      new vscode.Range(source.positionAt(0), source.positionAt(source.getText().length)),
      "fixture_dirty = { unsaved = yes }\n"
    );
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    const dirtyImport = vscode.commands.executeCommand("px.addVanillaFile", source.uri);
    await waitFor(() => exists(path.join(mod, dirtySource)), "dirty source imported");
    await waitFor(
      "document.body.innerText.includes('Copied') && document.body.innerText.includes('dirty_traits.txt')",
      "dirty import success notice"
    );
    await vscode.commands.executeCommand("notifications.clearAll");
    await dirtyImport;
    assert.equal(
      await fs.readFile(path.join(mod, dirtySource), "utf8"),
      "\uFEFFfixture_dirty = { unsaved = yes }\n"
    );
    assert.ok(source.isDirty);
    const collision = vscode.commands.executeCommand("px.addVanillaFile", source.uri);
    await waitFor("document.body.innerText.includes('Its contents were preserved.')", "collision notice");
    await vscode.commands.executeCommand("notifications.showList");
    await screenshot("vanilla-collision.png");
    await clickElement(
      `${queryAll(".monaco-button")}.find(el=>el.textContent.trim()==='Open Mod File')`,
      "Open Mod File collision action"
    );
    await collision;
    await vscode.commands.executeCommand("notifications.hideList");
    assert.equal(
      await fs.readFile(path.join(mod, dirtySource), "utf8"),
      "\uFEFFfixture_dirty = { unsaved = yes }\n"
    );
    checks.push(
      "dirty source buffer copied without saving vanilla; collision preserved mod file and offered opening"
    );

    await vscode.commands.executeCommand("notifications.clearAll");
    const script = await vscode.workspace.openTextDocument(path.join(mod, "events/localization_script.txt"));
    const scriptEditor = await vscode.window.showTextDocument(script);
    const offset = script.getText().indexOf("fixture_new") + 2;
    scriptEditor.selection = new vscode.Selection(script.positionAt(offset), script.positionAt(offset));
    await pause(600);
    await vscode.commands.executeCommand("editor.action.showContextMenu");
    await waitFor(
      `Boolean(${menuItem("PX: Create Localization Key")})`,
      "create localization editor action visible"
    );
    await screenshot("localization-editor-menu.png");
    await clickMenu("PX: Create Localization Key");
    await waitFor(
      "document.querySelector('.quick-input-widget')?.innerText.includes('Save to localization/german/project_l_german.yml')",
      "localization route shown"
    );
    await screenshot("localization-route-input.png");
    await enterValue("Neuer Wert");
    const locFile = path.join(mod, "localization/german/project_l_german.yml");
    await waitFor(
      async () => (await fs.readFile(locFile, "utf8")).includes('fixture_new: "Neuer Wert"'),
      "localization menu action saved"
    );
    const loc = await fs.readFile(locFile, "utf8");
    assert.ok(loc.startsWith("\uFEFFl_german:"));
    assert.match(loc, /fixture_new: "Neuer Wert"/);
    assert.match(loc, /fixture_existing:7 "Keep this entry"/);
    checks.push(
      "actual create-localization command, visible destination prompt, per-mod German route and entry-version policy"
    );

    const stale = vscode.commands.executeCommand("px.createLocalization", "fixture_stale");
    await waitFor(
      "document.querySelector('.quick-input-widget')?.innerText.includes('fixture_stale')",
      "stale-operation prompt"
    );
    const locDocument = await vscode.workspace.openTextDocument(locFile);
    const changed = new vscode.WorkspaceEdit();
    changed.insert(
      locDocument.uri,
      locDocument.positionAt(locDocument.getText().length),
      ' fixture_external:9 "Unsaved external edit"\n'
    );
    assert.equal(await vscode.workspace.applyEdit(changed), true);
    await enterValue("Must not be written");
    await stale;
    await waitFor(
      "document.body.innerText.includes('changed during the operation')",
      "stale localization failure"
    );
    assert.match(locDocument.getText(), /Unsaved external edit/);
    assert.doesNotMatch(locDocument.getText(), /fixture_stale:/);
    assert.equal(await fs.readFile(locFile, "utf8"), loc);
    await screenshot("localization-stale-error.png");
    checks.push(
      "stale localization edit rejected with visible failure and unrelated unsaved content preserved"
    );

    await vscode.commands.executeCommand("notifications.clearAll");
    await openMenu(mod);
    await waitFor(
      `Boolean(${menuItem("PX: Configure Localization Defaults")})`,
      "per-mod defaults action visible"
    );
    await screenshot("localization-defaults-menu.png");
    await clickMenu("PX: Configure Localization Defaults");
    await waitFor(
      "document.querySelector('.quick-input-widget')?.innerText.includes('Save defaults')",
      "defaults picker"
    );
    await screenshot("localization-defaults-picker.png");
    const pick = (label: string) =>
      clickElement(
        `${queryAll(".quick-input-list .monaco-list-row")}.find(el=>el.querySelector('.label-name')?.textContent===${JSON.stringify(label)})`,
        `defaults choice ${label}`
      );
    await pick("Entry version");
    await waitFor(
      "document.querySelector('.quick-input-widget')?.innerText.includes('Zero')",
      "entry version choices"
    );
    await screenshot("localization-entry-version-picker.png");
    await pick("Zero");
    await waitFor(
      "document.querySelector('.quick-input-widget')?.innerText.includes('Save defaults')",
      "return to defaults draft"
    );
    await pick("Save defaults");
    const defaultsFile = path.join(mod, ".px-toolkit/localization.json");
    await waitFor(
      async () => JSON.parse(await fs.readFile(defaultsFile, "utf8")).entryVersion === "zero",
      "defaults saved"
    );
    assert.deepEqual(JSON.parse(await fs.readFile(defaultsFile, "utf8")), {
      language: "german",
      newKeyFile: "localization/german/project_l_{language}.yml",
      entryVersion: "zero",
    });
    const configured = vscode.commands.executeCommand("px.createLocalization", "fixture_configured");
    await waitFor(
      "document.querySelector('.quick-input-widget')?.innerText.includes('fixture_configured')",
      "configured localization prompt"
    );
    await enterValue("Configured value");
    await configured;
    const configuredText = await fs.readFile(locFile, "utf8");
    assert.match(configuredText, /fixture_configured:0 "Configured value"/);
    assert.match(configuredText, /fixture_existing:7 "Keep this entry"/);
    assert.match(configuredText, /fixture_external:9 "Unsaved external edit"/);
    checks.push(
      "per-mod defaults changed and saved through native pickers; existing language/path retained; subsequent creation uses :0 and preserves unrelated edits"
    );
    for (const [file, bytes] of originals)
      assert.deepEqual(
        await fs.readFile(path.join(vanilla, file)),
        bytes,
        `vanilla source unchanged: ${file}`
      );
    await fs.writeFile(
      path.join(scratch, "results.json"),
      JSON.stringify(
        { passed: true, vscode: vscode.version, extension: extension.packageJSON.version, checks },
        null,
        2
      )
    );
  } catch (error) {
    await fs.writeFile(
      path.join(scratch, "failure.json"),
      JSON.stringify(
        { error: String(error), checks, workbench: await ui.evalWorkbench("document.body.innerText") },
        null,
        2
      )
    );
    await screenshot("failure.png");
    throw error;
  } finally {
    ui.close();
  }
}

export async function run() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      checks(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Localization editor smoke exceeded 120 seconds")),
          120_000
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
