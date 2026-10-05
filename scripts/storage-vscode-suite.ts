import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  getMachineSetting,
  normalizeMachineUri,
  setMachineSetting,
  type MachineSettings,
} from "@px-lsp/protocol/machineSettings";
import type { StorageUpgradeReport } from "../packages/vscode/src/storageUpgrade";
import { connect } from "./webview-cdp";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function checks() {
  const scratch = process.env.PX_STORAGE_TEST_SCRATCH!;
  assert.ok(scratch);
  const mod = path.join(scratch, "Mod");
  const second = path.join(scratch, "Second");
  const modUri = vscode.Uri.file(mod);
  const secondUri = vscode.Uri.file(second);
  const workspaceFile = vscode.workspace.workspaceFile!;
  const workspaceIdentity = normalizeMachineUri(workspaceFile.toString(), process.platform === "win32");
  const secondIdentity = normalizeMachineUri(secondUri.toString(), process.platform === "win32");
  const identity = { workspaceUri: workspaceIdentity, folderUri: secondIdentity };
  const registry = () =>
    vscode.workspace.getConfiguration("px").inspect<MachineSettings>("machinePaths")!.globalValue!;
  const project = async (root: string) =>
    JSON.parse(await fs.readFile(path.join(root, ".px-toolkit/project.json"), "utf8"));
  const legacyFiles = [
    "Mod/.ck3modding/project.json",
    "Mod/.ck3modding/calendar.json",
    "Mod/.ck3modding/nested/keep.txt",
    "Second/.ck3modding/localization.json",
    "Vanilla/reference.txt",
  ];
  const before = new Map<string, Buffer>();
  for (const filename of legacyFiles) before.set(filename, await fs.readFile(path.join(scratch, filename)));
  assert.ok(vscode.workspace.isTrusted, "isolated activation runs in a trusted test workspace");
  await vscode.extensions.getExtension("JDeffner.px-toolkit")!.activate();
  let ui = await connect("Boolean(document.querySelector('.monaco-workbench'))");
  const waitWorkbench = async (expression: string, label: string) => {
    for (let i = 0; i < 100; i++) {
      if (await ui.evalWorkbench(expression)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${label}. ${await ui.evalWorkbench("document.body.innerText")}`);
  };
  const waitFor = async (expression: string, label: string) => {
    for (let i = 0; i < 100; i++) {
      if (await ui.eval(expression)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${label}. ${await ui.eval("document.body.innerText")}`);
  };
  const capture = async (name: string) => {
    const shot = await ui.sendWorkbench("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(scratch, name), Buffer.from(shot.data as string, "base64"));
  };
  const upgrade = async (screenshot?: string, expectCurrentFormat = false) => {
    await vscode.commands.executeCommand("notifications.clearAll");
    const pending = vscode.commands.executeCommand<StorageUpgradeReport>("px.migrateToolkitStorage");
    await waitWorkbench(
      "[...document.querySelectorAll('.notification-toast')].some(toast=>/Settings upgrade finished|Toolkit settings already use|Toolkit settings upgraded/.test(toast.innerText))",
      "manual storage upgrade result toast"
    );
    if (expectCurrentFormat) {
      const notice = String(
        await ui.evalWorkbench(
          "[...document.querySelectorAll('.notification-toast')].find(toast=>/Settings upgrade finished|Toolkit settings already use|Toolkit settings upgraded/.test(toast.innerText))?.innerText"
        )
      );
      assert.match(notice, /Toolkit settings already use the current storage format/);
      assert.doesNotMatch(notice, /attention/i, "a completed repeat upgrade has no attention warning");
    }
    if (screenshot) await capture(screenshot);
    await vscode.commands.executeCommand("notifications.clearAll");
    return pending;
  };
  const query = async (key: string) => {
    await ui.eval(
      `(() => {const input=document.getElementById('query');input.value=${JSON.stringify(key)};input.dispatchEvent(new Event('input'));})()`
    );
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(`[data-key="${key}"]`)}))`, `${key} row`);
  };
  const choose = async (controlId: string, label: string, id: string) => {
    const option = `[...document.querySelectorAll('.px-menu [role=option]')].find(option=>option.querySelector('.px-grow')?.textContent===${JSON.stringify(label)})`;
    // A completed save can still have a filesystem refresh in flight, rebuilding the control.
    let selected = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      selected = Boolean(
        await ui.eval(`(() => {
        const option=${option};if(option){option.click();return true;}
        if(!document.querySelector('.px-menu'))document.getElementById(${JSON.stringify(controlId)}).click();
        return false;
      })()`)
      );
      if (selected) break;
      await pause(100);
    }
    assert.ok(selected, `${label} is available through the rendered ${controlId} dropdown`);
    // Dropdowns update optimistically. The row badge changes only after the host's new snapshot arrives.
    const renderedDestination = controlId.startsWith("destination-")
      ? ` && document.getElementById(${JSON.stringify(controlId)}).closest('.setting').querySelector('.setting-destination').textContent===${JSON.stringify(label)}`
      : "";
    await waitFor(
      `document.getElementById(${JSON.stringify(controlId)}).value===${JSON.stringify(id)} && !document.querySelector('.px-menu')${renderedDestination}`,
      `${label} selected`
    );
  };
  const value = async (key: string, text: string) => {
    await ui.eval(
      `(() => {const input=document.getElementById(${JSON.stringify(`setting-${key}`)});input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input'));})()`
    );
  };
  const click = async (key: string, label: string) => {
    const button = `[...document.querySelectorAll(${JSON.stringify(`[data-key="${key}"] button`)})].find(button=>button.textContent===${JSON.stringify(label)} && !button.hidden && !button.disabled)`;
    await waitFor(`Boolean(${button})`, `${key} ${label} available`);
    await ui.eval(`(${button}).click()`);
  };
  try {
    const modProject = await project(mod);
    const secondProject = await project(second);
    assert.equal(modProject.gameId, "ck3");
    assert.equal(secondProject.gameId, "ck3");
    assert.equal(modProject.authoring.characterHistory.quoteNames, false);
    assert.equal(secondProject.authoring.characterHistory.quoteNames, true);
    assert.equal(modProject.authoring.characterHistory.quoteCultures, false);
    assert.equal(secondProject.authoring.characterHistory.quoteCultures, false);
    assert.deepEqual(modProject.validation.ignore, ["fixture-diagnostic"]);
    assert.deepEqual(secondProject.validation.ignore, ["fixture-diagnostic"]);
    assert.equal(modProject.authoring.future, "keep");
    assert.deepEqual(modProject.unrelated, { keep: true });
    for (const relative of ["calendar.json", "nested/keep.txt"])
      assert.deepEqual(
        await fs.readFile(path.join(mod, ".px-toolkit", relative)),
        before.get(`Mod/.ck3modding/${relative}`)
      );
    assert.deepEqual(
      await fs.readFile(path.join(second, ".px-toolkit/localization.json")),
      before.get("Second/.ck3modding/localization.json")
    );
    for (const [filename, bytes] of before)
      assert.deepEqual(
        await fs.readFile(path.join(scratch, filename)),
        bytes,
        `${filename} remains unchanged`
      );
    const native = vscode.workspace.getConfiguration("px");
    for (const key of [
      "gameId",
      "characterHistory.quoteNames",
      "characterHistory.quoteCultures",
      "diagnostics.ignore",
      "gamePath",
      "logsPath",
      "modPath",
    ])
      assert.equal(
        native.inspect(key)?.workspaceValue,
        undefined,
        `${key} legacy Workspace value removed only after import`
      );
    const folderNative = vscode.workspace.getConfiguration("px", secondUri);
    assert.equal(folderNative.inspect("characterHistory.quoteNames")?.workspaceFolderValue, undefined);
    assert.equal(folderNative.inspect("logsPath")?.workspaceFolderValue, undefined);
    assert.equal(
      getMachineSetting(registry(), "gamePath", "ck3", "workspace", identity),
      path.join(scratch, "Vanilla")
    );
    assert.equal(
      getMachineSetting(registry(), "logsPath", "ck3", "workspace", identity),
      path.join(scratch, "logs")
    );
    assert.equal(
      getMachineSetting(registry(), "logsPath", "ck3", "folder", identity),
      path.join(scratch, "second-logs")
    );
    assert.equal(registry().future, "keep");
    assert.equal(getMachineSetting(registry(), "gamePath", "vic3", "default"), "another installation");
    assert.equal(native.inspect("machinePaths")?.workspaceValue, undefined);
    assert.equal(folderNative.inspect("machinePaths")?.workspaceFolderValue, undefined);
    assert.equal(native.inspect("indexAssets")?.workspaceValue, false);
    assert.equal(vscode.workspace.getConfiguration("editor").get("tabSize"), 3);
    assert.equal(vscode.workspace.getConfiguration("files", secondUri).get("trimTrailingWhitespace"), false);
    assert.match(await fs.readFile(workspaceFile.fsPath, "utf8"), /Keep this workspace editor note/);
    assert.match(
      await fs.readFile(path.join(second, ".vscode/settings.json"), "utf8"),
      /Keep this folder editor note/
    );
    assert.equal(vscode.workspace.getConfiguration("storage").get("fixture"), "keep");

    const unchanged = new Map<string, Buffer>();
    for (const filename of [
      workspaceFile.fsPath,
      path.join(second, ".vscode/settings.json"),
      path.join(mod, ".px-toolkit/project.json"),
      path.join(second, ".px-toolkit/project.json"),
    ])
      unchanged.set(filename, await fs.readFile(filename));
    const registryBefore = JSON.stringify(registry());
    const idempotent = await upgrade("storage-upgrade-idempotent.png", true);
    assert.equal(idempotent.noOp, true);
    assert.deepEqual(idempotent.copied, []);
    assert.deepEqual(idempotent.imported, []);
    assert.deepEqual(idempotent.removed, []);
    assert.deepEqual(idempotent.conflicts, []);
    assert.deepEqual(idempotent.errors, []);
    for (const [filename, bytes] of unchanged) assert.deepEqual(await fs.readFile(filename), bytes);
    assert.equal(JSON.stringify(registry()), registryBefore);

    await folderNative.update(
      "characterHistory.quoteCultures",
      true,
      vscode.ConfigurationTarget.WorkspaceFolder
    );
    const conflict = await upgrade("storage-upgrade-conflict.png");
    assert.ok(
      conflict.conflicts.some((item) => item.includes("characterHistory.quoteCultures")),
      "manual upgrade reports a native/project conflict"
    );
    assert.equal((await project(second)).authoring.characterHistory.quoteCultures, false);
    assert.equal(folderNative.inspect("characterHistory.quoteCultures")?.workspaceFolderValue, true);
    await folderNative.update(
      "characterHistory.quoteCultures",
      undefined,
      vscode.ConfigurationTarget.WorkspaceFolder
    );

    const dirtySource = path.join(mod, ".ck3modding/dirty-source.txt");
    const dirtyDisk = "Legacy source retained.\n";
    await fs.writeFile(dirtySource, dirtyDisk);
    const document = await vscode.workspace.openTextDocument(dirtySource);
    await vscode.window.showTextDocument(document);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, new vscode.Position(0, 0), "Unsaved source content.\n");
    assert.ok(await vscode.workspace.applyEdit(edit));
    const dirtyText = document.getText();
    const dirty = await upgrade("storage-upgrade-dirty-source.png");
    assert.ok(
      dirty.errors.some((item) => item.includes("dirty-source.txt") && item.includes("Save")),
      "manual upgrade reports a dirty source instead of copying stale disk text"
    );
    assert.equal(await fs.readFile(dirtySource, "utf8"), dirtyDisk);
    assert.equal(document.getText(), dirtyText);
    assert.equal(document.isDirty, true);
    await assert.rejects(fs.access(path.join(mod, ".px-toolkit/dirty-source.txt")), { code: "ENOENT" });
    await vscode.commands.executeCommand("workbench.action.files.revert");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

    const modIdentity = {
      workspaceUri: workspaceIdentity,
      folderUri: normalizeMachineUri(modUri.toString(), process.platform === "win32"),
    };
    const activeModLogs = path.join(scratch, "mod-logs");
    await native.update(
      "machinePaths",
      setMachineSetting(registry(), "logsPath", activeModLogs, "ck3", "folder", modIdentity),
      vscode.ConfigurationTarget.Global
    );
    await vscode.commands.executeCommand("px.openSettings");
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    ui.close();
    ui = await connect("Boolean(document.getElementById('scope') && document.getElementById('categories'))");
    await waitFor("document.querySelectorAll('.setting').length>0", "Toolkit Settings rendered");
    await choose("scope", "Storage Mod", `project:${modUri.toString()}`);
    await ui.eval(
      "document.getElementById('query').value='';document.getElementById('query').dispatchEvent(new Event('input'))"
    );
    await waitFor(
      "Boolean(document.getElementById('setting-characterHistory.quoteNames'))",
      "mod context catalogue loaded"
    );
    assert.equal(await ui.eval("Boolean(document.getElementById('setting-gamePath'))"), true);
    assert.equal(await ui.eval("Boolean(document.getElementById('setting-indexAssets'))"), true);
    assert.match(String(await ui.eval("document.body.innerText")), /Settings for/);
    assert.equal(
      await ui.eval("document.querySelectorAll('.setting.is-expanded').length"),
      0,
      "settings start in compact rows"
    );
    await capture("storage-mod-settings.png");
    await query("diagnostics.ignorePatterns");
    const helpBox = await ui.eval(`(() => {
      const help=document.querySelector('.setting-help');
      const box=help.getBoundingClientRect();
      return {x:box.x,y:box.y,width:box.width,height:box.height,label:help.getAttribute('aria-label')};
    })()`);
    assert.ok((helpBox as { width: number; height: number }).width > 0);
    assert.ok((helpBox as { width: number; height: number }).height > 0);
    assert.equal((helpBox as { label: string }).label, "Help for Ignored file patterns");
    await ui.eval("document.querySelector('.setting-help').click()");
    assert.equal(await ui.eval("document.getElementById('details-diagnostics.ignorePatterns').hidden"), true);
    assert.equal(await ui.eval("document.querySelector('.extra-help').open"), false);
    await ui.eval(`(() => {
      const help=document.querySelector('.setting-help'),box=help.getBoundingClientRect();
      help.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:box.x+box.width/2,clientY:box.y+box.height/2}));
    })()`);
    await waitFor("document.querySelector('.px-tip')?.hidden===false", "help tooltip on hover");
    assert.deepEqual(
      await ui.eval(
        `(() => {const help=document.querySelector('.setting-help'),box=help.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height,label:help.getAttribute('aria-label')}})()`
      ),
      helpBox,
      "help tooltip does not move the row"
    );
    assert.equal(await ui.eval("document.getElementById('details-diagnostics.ignorePatterns').hidden"), true);
    await ui.eval("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert.equal(await ui.eval("document.querySelector('.px-tip').hidden"), true);
    await ui.eval("window.focus();document.querySelector('.setting-help').focus()");
    // Browser focus-visible state requires real keyboard input, not a synthetic DOM event.
    for (const modifiers of [0, 8])
      for (const type of ["keyDown", "keyUp"])
        await ui.sendWorkbench("Input.dispatchKeyEvent", {
          type,
          key: "Tab",
          code: "Tab",
          windowsVirtualKeyCode: 9,
          modifiers,
        });
    assert.equal(await ui.eval("document.querySelector('.setting-help').matches(':focus-visible')"), true);
    await waitFor("document.querySelector('.px-tip')?.hidden===false", "help tooltip on keyboard focus");
    await ui.eval(
      "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.getElementById('expand-diagnostics.ignorePatterns').click()"
    );
    assert.equal(
      await ui.eval("document.getElementById('details-diagnostics.ignorePatterns').hidden"),
      false
    );
    const shortDescription = String(await ui.eval("document.querySelector('.description').innerText"));
    assert.match(shortDescription, /Glob patterns matched against workspace-relative file paths/);
    assert.equal(await ui.eval("document.querySelector('.extra-help').open"), false);
    await ui.eval("document.querySelector('.extra-help summary').click()");
    assert.equal(await ui.eval("document.querySelector('.extra-help').open"), true);
    assert.match(
      String(await ui.eval("document.querySelector('.extra-help').innerText")),
      /common\/\*\*\/vendor\/\*\.txt/
    );
    assert.equal(await ui.eval("document.querySelector('.description').innerText"), shortDescription);
    await capture("storage-ignore-patterns-help.png");
    await ui.eval("document.querySelector('.setting-help').click()");
    assert.equal(
      await ui.eval("document.getElementById('details-diagnostics.ignorePatterns').hidden"),
      false
    );
    await query("characterHistory.quoteNames");
    await ui.eval("document.getElementById('expand-characterHistory.quoteNames').click()");
    await choose(
      "destination-characterHistory.quoteNames",
      "This mod · Shared",
      `project:${modUri.toString()}`
    );
    assert.match(
      String(await ui.eval("document.querySelector('.setting-source').textContent")),
      /Active from/
    );
    assert.equal(
      await ui.eval("document.getElementById('setting-characterHistory.quoteNames').checked"),
      false
    );
    await ui.eval("document.getElementById('setting-characterHistory.quoteNames').click()");
    await waitFor(
      "document.getElementById('notice').textContent.includes('saved') && !document.querySelector('.setting.has-draft')",
      "Team authoring save"
    );
    const editedProject = await project(mod);
    assert.equal(editedProject.authoring.characterHistory.quoteNames, true);
    assert.equal(editedProject.authoring.future, "keep");
    assert.deepEqual(editedProject.unrelated, { keep: true });
    assert.deepEqual(editedProject.validation, modProject.validation);
    assert.equal(native.inspect("characterHistory.quoteNames")?.workspaceValue, undefined);
    assert.equal(
      vscode.workspace.getConfiguration("px", modUri).inspect("characterHistory.quoteNames")
        ?.workspaceFolderValue,
      undefined
    );
    await capture("storage-team-saved.png");

    const changelogKey = "workshop.changelog";
    await native.update(changelogKey, "legacy-note.md", vscode.ConfigurationTarget.Global);
    await native.update(
      "machinePaths",
      setMachineSetting(registry(), changelogKey, "personal-note.md", "ck3", "default"),
      vscode.ConfigurationTarget.Global
    );
    await query(changelogKey);
    await ui.eval("document.getElementById('expand-workshop.changelog').click()");
    await choose("destination-workshop.changelog", "This mod · Shared", `project:${modUri.toString()}`);
    await waitFor(
      "document.getElementById('setting-workshop.changelog').value==='personal-note.md'",
      "shared changelog inherits the personal registry default"
    );
    await value(changelogKey, "shared-note.md");
    await click(changelogKey, "Save");
    await waitFor(
      "document.getElementById('notice').textContent.includes('saved') && !document.querySelector('.setting.has-draft')",
      "shared changelog saved"
    );
    await choose("destination-workshop.changelog", "Personal defaults", "user");
    await waitFor(
      "document.getElementById('setting-workshop.changelog').value==='personal-note.md' && document.querySelector('.active-value')?.textContent.includes('shared-note.md')",
      "personal changelog remains editable while the shared rule is active"
    );
    await value(changelogKey, "next-note.md");
    await click(changelogKey, "Save");
    await waitFor(
      "document.getElementById('notice').textContent.includes('saved') && !document.querySelector('.setting.has-draft, .field-error')",
      "personal changelog saved through the registry"
    );
    assert.equal(getMachineSetting(registry(), changelogKey, "ck3", "default"), "next-note.md");
    assert.equal((await project(mod)).publishing.changelog, "shared-note.md");
    assert.ok(
      String(await ui.eval("document.querySelector('.active-value').textContent")).includes("shared-note.md")
    );
    await choose("destination-workshop.changelog", "This mod · Shared", `project:${modUri.toString()}`);
    await click(changelogKey, "Remove mod override");
    await waitFor(
      "document.getElementById('setting-workshop.changelog').value==='next-note.md' && !document.querySelector('.field-error')",
      "removing the shared changelog restores the personal default"
    );
    assert.equal((await project(mod)).publishing.changelog, undefined);
    await choose("destination-workshop.changelog", "Personal defaults", "user");
    await click(changelogKey, "Remove personal default");
    await waitFor(
      "document.getElementById('setting-workshop.changelog').value==='legacy-note.md' && !document.querySelector('.field-error')",
      "removing the personal changelog restores the legacy User fallback"
    );
    assert.equal(getMachineSetting(registry(), changelogKey, "ck3", "default"), undefined);
    assert.equal(native.inspect(changelogKey)?.globalValue, "legacy-note.md");
    await capture("storage-changelog-defaults.png");
    await native.update(changelogKey, undefined, vscode.ConfigurationTarget.Global);

    await query("logsPath");
    assert.equal(await ui.eval("document.getElementById('scope').value"), `project:${modUri.toString()}`);
    await ui.eval("document.getElementById('expand-logsPath').click()");
    await choose("destination-logsPath", "This workspace · Private", "machine:workspace");
    assert.equal(
      await ui.eval("document.getElementById('setting-logsPath').value"),
      path.join(scratch, "logs")
    );
    assert.match(String(await ui.eval("document.querySelector('.setting-source').textContent")), /folder/i);
    assert.ok(
      String(await ui.eval("document.querySelector('.active-value').textContent")).includes(activeModLogs)
    );
    const nextLogs = path.join(scratch, "logs-next");
    await value("logsPath", nextLogs);
    await click("logsPath", "Save");
    await waitFor(
      "document.getElementById('notice').textContent.includes('saved') && !document.querySelector('.setting.has-draft')",
      "personal workspace path save"
    );
    assert.equal(getMachineSetting(registry(), "logsPath", "ck3", "workspace", identity), nextLogs);
    assert.equal(getMachineSetting(registry(), "logsPath", "ck3", "folder", modIdentity), activeModLogs);
    assert.ok(
      String(await ui.eval("document.querySelector('.active-value').textContent")).includes(activeModLogs)
    );
    assert.equal(
      getMachineSetting(registry(), "logsPath", "ck3", "folder", identity),
      path.join(scratch, "second-logs")
    );
    assert.equal(native.inspect("logsPath")?.workspaceValue, undefined);
    assert.equal(native.inspect("machinePaths")?.workspaceValue, undefined);
    assert.equal(folderNative.inspect("logsPath")?.workspaceFolderValue, undefined);
    assert.equal(folderNative.inspect("machinePaths")?.workspaceFolderValue, undefined);
    await capture("storage-personal-paths-saved.png");

    const externalLogs = path.join(scratch, "logs-external");
    await value("logsPath", path.join(scratch, "logs-draft"));
    await native.update(
      "machinePaths",
      setMachineSetting(registry(), "logsPath", externalLogs, "ck3", "workspace", identity),
      vscode.ConfigurationTarget.Global
    );
    await waitFor(
      "document.body.innerText.includes('Changed elsewhere')",
      "personal path draft detects external edit"
    );
    await click("logsPath", "Save");
    await waitFor(
      "document.querySelector('.field-error')?.textContent.includes('Personal paths changed')",
      "stale personal path rejected visibly"
    );
    assert.equal(getMachineSetting(registry(), "logsPath", "ck3", "workspace", identity), externalLogs);
    await capture("storage-personal-paths-stale.png");
    await click("logsPath", "Discard draft");

    const batchGame = path.join(scratch, "Vanilla-batch");
    const batchLogs = path.join(scratch, "logs-batch");
    await fs.mkdir(path.join(batchGame, "common"), { recursive: true });
    await fs.mkdir(batchLogs, { recursive: true });
    await query("gamePath");
    await ui.eval(
      "(() => {const button=document.getElementById('expand-gamePath');if(button.getAttribute('aria-expanded')!=='true')button.click()})()"
    );
    await choose("destination-gamePath", "This workspace · Private", "machine:workspace");
    await value("gamePath", batchGame);
    await query("logsPath");
    await value("logsPath", batchLogs);
    assert.equal(await ui.eval("document.getElementById('draft-count').textContent"), "2 unsaved settings");
    await ui.eval("document.getElementById('save-drafts').click()");
    await waitFor(
      "document.getElementById('notice').textContent.includes('saved') && document.getElementById('draft-count').textContent==='' && !document.querySelector('.field-error')",
      "both private paths saved together without stale-write errors"
    );
    assert.equal(getMachineSetting(registry(), "gamePath", "ck3", "workspace", identity), batchGame);
    assert.equal(getMachineSetting(registry(), "logsPath", "ck3", "workspace", identity), batchLogs);
    assert.equal(getMachineSetting(registry(), "logsPath", "ck3", "folder", modIdentity), activeModLogs);
    await query("gamePath");
    assert.equal(await ui.eval("document.getElementById('setting-gamePath').value"), batchGame);
    assert.equal(await ui.eval("Boolean(document.querySelector('.setting.has-draft, .field-error'))"), false);
    await query("logsPath");
    assert.equal(await ui.eval("document.getElementById('setting-logsPath').value"), batchLogs);
    assert.equal(await ui.eval("Boolean(document.querySelector('.setting.has-draft, .field-error'))"), false);
    await capture("storage-private-paths-batch-saved.png");
    await vscode.commands.executeCommand("notifications.clearAll");
    await ui.sendWorkbench("Emulation.setDeviceMetricsOverride", {
      width: 640,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await pause(250);
    assert.equal(await ui.eval("document.documentElement.scrollWidth<=window.innerWidth"), true);
    await capture("storage-personal-paths-narrow.png");
    await ui.sendWorkbench("Emulation.clearDeviceMetricsOverride", {});
    const library = path.join(scratch, "mod-library");
    await fs.mkdir(library);
    await fs.writeFile(
      path.join(library, "folder_library_design.txt"),
      '\uFEFFfolder_library_design = { pattern = "pattern_solid.dds" color1 = red }\n'
    );
    await query("coaLibraryDir");
    await ui.eval("document.getElementById('expand-coaLibraryDir').click()");
    await choose(
      "destination-coaLibraryDir",
      `${vscode.workspace.getWorkspaceFolder(modUri)!.name} · Private`,
      `machine-folder:${modUri.toString()}`
    );
    await value("coaLibraryDir", library);
    await click("coaLibraryDir", "Save");
    await waitFor(
      "document.getElementById('notice').textContent.includes('saved') && !document.querySelector('.setting.has-draft')",
      "folder library path saved through Settings"
    );
    assert.equal(getMachineSetting(registry(), "coaLibraryDir", "ck3", "folder", modIdentity), library);
    const patterns = path.join(mod, "gfx/coat_of_arms/patterns");
    await fs.mkdir(patterns, { recursive: true });
    await fs.writeFile(path.join(patterns, "50_coa_designer_patterns.txt"), "# Synthetic empty catalogue\n");
    await vscode.commands.executeCommand("px.openCoaDesigner");
    ui.close();
    ui = await connect("Boolean(document.getElementById('libImport'))");
    await waitFor(
      "document.getElementById('libDir').dataset.tip?.includes('mod-library')",
      "designer uses the mod-specific library"
    );
    await ui.eval("document.getElementById('libImport').click()");
    await waitFor(
      "document.body.innerText.includes('folder_library_design')",
      "folder library design listed"
    );
    await capture("storage-coa-folder-library.png");
    for (const [filename, bytes] of before)
      assert.deepEqual(await fs.readFile(path.join(scratch, filename)), bytes);
    await fs.writeFile(
      path.join(scratch, "results.json"),
      JSON.stringify(
        {
          passed: true,
          vscode: vscode.version,
          checks: [
            "trusted activation upgrades legacy files plus Workspace and Folder authoring settings",
            "portable settings preserve unknown properties and legacy sources",
            "native editor settings and unrelated JSONC comments survive scoped cleanup",
            "machine paths are written to User registry only, with independent workspace/folder bindings",
            "manual repeat Upgrade Storage has no changes, conflicts, errors, or attention warning",
            "manual Upgrade Storage preserves and reports actual conflicting native/project values",
            "dirty legacy source is reported and retained without creating a stale canonical copy",
            "one mod catalogue includes shared rules, private paths and editor preferences",
            "global search finds settings across categories within the current mod context",
            "visible help works by click, hover and keyboard focus without expanding Details",
            "per-row shared destination saves authoring rules only to project.json",
            "Workshop changelog personal saves and resets preserve shared precedence and inherited defaults",
            "per-row private destination saves workspace bindings to User settings",
            "active folder value and source remain visible while editing a workspace destination",
            "stale personal path draft is rejected with visible error",
            "Save all drafts saves two private paths in one batch without stale-write errors",
            "compact and narrow settings render without horizontal overflow",
            "folder library path saved in Settings is used by the packaged coat-of-arms designer",
            "vanilla reference and legacy inputs remain byte-for-byte unchanged",
          ],
        },
        null,
        2
      )
    );
  } catch (error) {
    const evidence = await Promise.allSettled([
      capture("storage-failure.png"),
      ui
        .eval("document.body.innerText")
        .then((text) => fs.writeFile(path.join(scratch, "storage-failure.txt"), String(text))),
    ]);
    await fs.writeFile(
      path.join(scratch, "failure.json"),
      JSON.stringify(
        {
          error: String(error),
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

export async function run() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      checks(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Storage editor smoke exceeded 180 seconds")), 180_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
