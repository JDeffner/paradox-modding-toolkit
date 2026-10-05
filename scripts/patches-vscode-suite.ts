import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createRequire } from "node:module";
import * as vscode from "vscode";
import { connect } from "./webview-cdp";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
interface Fixture {
  patchId: string;
  output: string;
  sources: Record<string, string>;
  scriptPath: string;
  locPath: string;
  outputLocalization: string;
  originalSources: Record<string, string>;
}
const marker =
  "document.querySelector('h1')?.textContent === 'Compatibility Patch' && Boolean(document.getElementById('app'))";

async function checks(): Promise<void> {
  const scratch = process.env.PX_PATCHES_TEST_SCRATCH;
  assert.ok(scratch);
  const fixture = JSON.parse(await fs.readFile(path.join(scratch, "fixture.json"), "utf8")) as Fixture;
  const outputFile = path.join(fixture.output, fixture.scriptPath);
  const configFile = path.join(fixture.output, ".px-toolkit/compatibility.json");
  const recorded: string[] = [];
  const record = (message: string) => {
    recorded.push(message);
    console.log(`PASS ${message}`);
  };
  await vscode.extensions.getExtension("JDeffner.px-toolkit")!.activate();
  await assert.rejects(
    async () => vscode.commands.executeCommand("px.openCompatibilityPatch", vscode.Uri.file(fixture.output)),
    /Experimental features/
  );
  record("command rejects use with experimental features disabled");
  await vscode.workspace
    .getConfiguration("px")
    .update("experimentalFeatures", true, vscode.ConfigurationTarget.Workspace);
  await vscode.commands.executeCommand("px.openCompatibilityPatch");
  await vscode.commands.executeCommand("workbench.action.closeSidebar");
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  let ui = await connect(marker);
  const waitFor = async (expression: string, label: string) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await ui.eval(expression)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${label}. Page: ${await ui.eval("document.body.innerText")}`);
  };
  const idle = () =>
    waitFor("document.getElementById('app').getAttribute('aria-busy') === 'false'", "workbench idle");
  const act = async (selector: string, label = selector) => {
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, `${label} available`);
    await ui.eval(`new Promise((resolve,reject)=>{
      const app=document.getElementById('app');const button=document.querySelector(${JSON.stringify(selector)});
      button.scrollIntoView({block:'center'});const rect=button.getBoundingClientRect();
      if(!rect.width||!rect.height||button.disabled){reject(new Error('Action is not rendered and enabled: '+${JSON.stringify(label)}));return;}
      let busy=false;const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Action did not finish: '+${JSON.stringify(label)}));},30000);
      const observer=new MutationObserver(()=>{
        if(app.getAttribute('aria-busy')==='true')busy=true;
        else if(busy){clearTimeout(timer);observer.disconnect();resolve(true);}
      });observer.observe(app,{attributes:true,attributeFilter:['aria-busy']});button.click();
    })`);
    await idle();
  };
  const click = (action: string, extra = "") =>
    act(`[data-action="${action}"]${extra}:not(:disabled)`, action);
  const noError = async () =>
    assert.equal(await ui.eval("document.querySelector('.error')?.textContent ?? ''"), "");
  const entry = async (name: string) => {
    const id = await ui.eval(
      `(() => [...document.querySelectorAll('[data-entry]')].find(button=>button.querySelector('.entry-name')?.textContent===${JSON.stringify(name)})?.dataset.entry)()`
    );
    assert.equal(typeof id, "string", `${name} is in the rendered review queue`);
    await act(`[data-entry=${JSON.stringify(id)}]`, `select ${name}`);
  };
  const filter = async (value: string) => {
    await ui.eval(`new Promise((resolve,reject)=>{
      const app=document.getElementById('app');let busy=false;
      const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Filter did not finish'));},15000);
      const observer=new MutationObserver(()=>{if(app.getAttribute('aria-busy')==='true')busy=true;else if(busy){clearTimeout(timer);observer.disconnect();resolve(true);}});
      observer.observe(app,{attributes:true,attributeFilter:['aria-busy']});
      const select=document.getElementById('entry-filter');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));
    })`);
  };
  const useSource = async (sourceName: string) => {
    const selector = await ui.eval(`(() => {
      const button=[...document.querySelectorAll('.contribution')].find(section=>section.querySelector('h3')?.textContent===${JSON.stringify(sourceName)})?.querySelector('[data-action="use-source"]');
      return button ? '[data-action="use-source"][data-contributor='+JSON.stringify(button.dataset.contributor)+']' : undefined;
    })()`);
    assert.equal(typeof selector, "string");
    await act(String(selector), `use ${sourceName}`);
    await noError();
  };
  const fields = async (setChoices: boolean) => {
    await ui.eval(`(() => {
      const summary=[...document.querySelectorAll('.decision summary')].find(item=>item.textContent==='Combine fields');
      if(!summary)throw new Error('Combine fields is missing');if(!summary.parentElement.open)summary.click();
      if(${setChoices})for(const [key,name] of Object.entries({desc:'Synthetic source A',major:'Synthetic source C',is_shown:'Synthetic source C',effect:'Synthetic source B'})) {
        const field=[...document.querySelectorAll('[data-field]')].find(select=>select.dataset.field===key);
        const option=[...field.options].find(option=>option.textContent===name);if(!option)throw new Error('Missing field source '+name);
        field.value=option.value;field.dispatchEvent(new Event('change',{bubbles:true}));
      }
    })()`);
    await click("fields");
    await noError();
  };
  const reveal = () => vscode.commands.executeCommand("px.openCompatibilityPatch");
  const replaceDocument = async (document: vscode.TextDocument, text: string) => {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      text
    );
    assert.ok(await vscode.workspace.applyEdit(edit));
  };
  const config = async () =>
    JSON.parse((await fs.readFile(configFile, "utf8")).replace(/^\uFEFF/, "")) as {
      inputs: { id: string }[];
      decisions: Record<string, { resolution: { mode: string; fields?: Record<string, string> } }>;
      generated: Record<string, { text: string }>;
      testExtensionField: { preserved: boolean };
    };
  try {
    await idle();
    await waitFor("Boolean(document.getElementById('new-name'))", "new patch form");
    const createdName = "Packaged creation fixture";
    const createdRoot = path.join(scratch, "Packaged_creation_fixture");
    await ui.eval(`(() => {
      const input=document.getElementById('new-name');input.value=${JSON.stringify(createdName)};
      input.dispatchEvent(new Event('input',{bubbles:true}));
      const button=document.querySelector('[data-action=create]');
      button.scrollIntoView({block:'center'});const rect=button.getBoundingClientRect();
      if(!rect.width||!rect.height||button.disabled)throw new Error('Create patch is not rendered and enabled');
      button.click();
    })()`);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await ui.evalWorkbench(
          "Boolean(document.querySelector('.quick-input-widget')?.checkVisibility() && document.querySelector('.quick-input-widget input'))"
        )
      )
        break;
      if (attempt === 99) throw new Error("Create patch folder picker did not appear");
      await pause(100);
    }
    await ui.evalWorkbench(
      "(()=>{const input=document.querySelector('.quick-input-widget input');input.focus();input.select();})()"
    );
    await ui.sendWorkbench("Input.insertText", { text: `${scratch}${path.sep}` });
    for (let attempt = 0; attempt < 100; attempt++) {
      const selectedParent = await ui.evalWorkbench(`(() => {
        const picker=document.querySelector('.quick-input-widget');
        const normalize=value=>value.replaceAll(String.fromCharCode(92),'/').replace(/[/]+$/,'').toLowerCase();
        const input=picker?.querySelector('input');
        const rows=[...picker?.querySelectorAll('.monaco-list-row')??[]];
        return input && normalize(input.value)===normalize(${JSON.stringify(scratch)}) &&
          ['Source-a','Source-b','Source-c'].every(name=>rows.some(row=>row.textContent.includes(name)));
      })()`);
      if (selectedParent) break;
      if (attempt === 99)
        throw new Error(
          `Create patch picker did not load the requested parent: ${await ui.evalWorkbench(
            "JSON.stringify({value:document.querySelector('.quick-input-widget input')?.value,text:document.querySelector('.quick-input-widget')?.innerText})"
          )}`
        );
      await pause(100);
    }
    for (const type of ["keyDown", "keyUp"])
      await ui.sendWorkbench("Input.dispatchKeyEvent", {
        type,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
      });
    const accept =
      "[...document.querySelectorAll('.quick-input-widget button,.quick-input-widget .monaco-button')].find(button=>button.checkVisibility() && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && /^(Select Folder|Open|OK)$/.test(button.textContent.trim()))";
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        !(await ui.evalWorkbench("Boolean(document.querySelector('.quick-input-widget')?.checkVisibility())"))
      )
        break;
      if (await ui.evalWorkbench(`Boolean(${accept})`)) await ui.evalWorkbench(`(${accept}).click()`);
      if (attempt === 99) throw new Error("Create patch folder picker was not accepted");
      await pause(200);
    }
    await idle();
    await noError();
    assert.equal(
      await ui.eval(
        "document.querySelector('.setup summary').textContent.includes('Packaged creation fixture')"
      ),
      true
    );
    const createdDescriptor = await fs.readFile(path.join(createdRoot, "descriptor.mod"), "utf8");
    assert.ok(createdDescriptor.startsWith("\uFEFF"));
    const createdProject = JSON.parse(
      await fs.readFile(path.join(createdRoot, ".px-toolkit/compatibility.json"), "utf8")
    );
    assert.equal(createdProject.name, createdName);
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(createdRoot, ".px-toolkit/project.json"), "utf8")),
      { version: 1, gameId: "ck3" }
    );
    assert.match(await fs.readFile(path.join(createdRoot, ".pxignore"), "utf8"), /\.git\//);
    const pointer = await fs.readFile(
      path.join(
        scratch,
        "Documents/Paradox Interactive/Crusader Kings III/mod/Packaged_creation_fixture.mod"
      ),
      "utf8"
    );
    const pointerPath = /^\s*path\s*=\s*(".*")\s*$/m.exec(pointer)?.[1];
    assert.ok(pointerPath, "created launcher pointer has an output path");
    assert.equal(await fs.realpath(JSON.parse(pointerPath)), await fs.realpath(createdRoot));
    const bindings = vscode.workspace
      .getConfiguration("px")
      .inspect<{ patches: Record<string, { output: string }> }>("machinePaths")?.globalValue;
    assert.equal(
      await fs.realpath(bindings!.patches[createdProject.id].output),
      await fs.realpath(createdRoot)
    );
    record("rendered Create patch form creates complete project files and a scratch launcher pointer");
    await vscode.commands.executeCommand("px.openCompatibilityPatch", vscode.Uri.file(fixture.output));
    await waitFor("document.querySelectorAll('.source-list li').length === 3", "existing patch rendered");
    await idle();
    await noError();
    assert.equal(await ui.eval("document.querySelectorAll('.source-list li').length"), 3);
    await click("up", '[data-id="c"]');
    assert.deepEqual(
      (await config()).inputs.map((input) => input.id),
      ["a", "c", "b"]
    );
    await click("down", '[data-id="c"]');
    assert.deepEqual(
      (await config()).inputs.map((input) => input.id),
      ["a", "b", "c"]
    );
    record("launcher order changes through rendered move buttons");
    await click("scan");
    await noError();
    assert.match(String(await ui.eval("document.body.innerText")), /Scanned 3 mods/);
    assert.equal(await ui.eval("document.querySelectorAll('[data-entry]').length"), 4);
    assert.equal(await ui.eval("document.querySelector('[data-action=prepare]').disabled"), true);
    assert.match(
      String(await ui.eval("document.querySelector('.coverage').textContent")),
      /Binary file requires external review/
    );
    record("three source scan exposes conflicts and binary coverage without blocking supported decisions");
    await entry("px_fields");
    await fields(true);
    await entry("px_source");
    await useSource("Synthetic source A");
    await entry("px_winner");
    await click("winner");
    await entry("PATCH_LABEL");
    await useSource("Synthetic source A");
    await noError();
    const saved = await config();
    assert.equal(Object.keys(saved.decisions).length, 4);
    assert.equal(saved.testExtensionField.preserved, true);
    assert.ok(!JSON.stringify(saved).includes(scratch), "portable project does not contain machine paths");
    record("field composition, complete source and expected winner decisions save portable intent");
    await click("prepare");
    await noError();
    await waitFor(
      "Boolean(document.querySelector('[data-action=apply]:not(:disabled)'))",
      "applicable patch preview"
    );
    await click("diff", `[data-path=${JSON.stringify(fixture.scriptPath)}]`);
    assert.ok(
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .some(
          (tab) =>
            tab.input instanceof vscode.TabInputTextDiff && tab.input.original.scheme.startsWith("px-patch-")
        ),
      "Review changes opens the real immutable diff editor"
    );
    await reveal();
    await idle();
    await ui.screenshot(path.join(scratch, "patch-preview.png"));
    record("Build patch exposes an immutable native diff through Review changes");

    // The output was absent in the reviewed preview. A new user file invalidates that preview.
    await fs.writeFile(outputFile, "\uFEFF# external file after preview\n");
    await waitFor(
      "!document.querySelector('[data-action=apply]:not(:disabled)')",
      "stale output disables Apply patch"
    );
    assert.equal(await fs.readFile(outputFile, "utf8"), "\uFEFF# external file after preview\n");
    await fs.unlink(outputFile);
    record("new output after preview prevents stale Apply and preserves the external file");
    await click("prepare");
    await noError();
    await click("apply");
    await noError();
    const firstOutput = await fs.readFile(outputFile);
    assert.deepEqual([...firstOutput.subarray(0, 3)], [239, 187, 191]);
    const firstText = firstOutput.toString("utf8");
    assert.match(firstText, /desc = DESC_A/);
    assert.match(firstText, /effect = \{ add_gold = 2 \}/);
    assert.match(firstText, /desc = SOURCE_A/);
    assert.match(firstText, /desc = WINNER_C/);
    assert.match(firstText, /px_sibling = \{/);
    assert.match(firstText, /KEEP_SIBLING/);
    const localization = await fs.readFile(path.join(fixture.output, fixture.outputLocalization));
    assert.deepEqual([...localization.subarray(0, 3)], [239, 187, 191]);
    assert.match(localization.toString("utf8"), /PATCH_LABEL:0 "Contribution A"/);
    assert.match(localization.toString("utf8"), /OUTPUT_LOC_SIBLING:0 "Keep output sibling"/);
    const descriptor = await fs.readFile(path.join(fixture.output, "descriptor.mod"), "utf8");
    for (const name of [
      "External author dependency",
      "Synthetic source A",
      "Synthetic source B",
      "Synthetic source C",
    ])
      assert.ok(descriptor.includes(`"${name}"`));
    assert.ok(!JSON.stringify(await config()).includes(scratch));
    record(
      "Apply saves BOM scripts, source siblings, routed replace localization siblings and launcher dependencies"
    );

    const document = await vscode.workspace.openTextDocument(outputFile);
    assert.equal(document.encoding, "utf8bom");
    await vscode.window.showTextDocument(document);
    const manualNote = "# independent unsaved output note\n";
    await replaceDocument(document, document.getText() + manualNote);
    assert.equal(document.isDirty, true);
    const upstream = path.join(fixture.sources.b, fixture.scriptPath);
    const updatedSource = Buffer.from(fixture.originalSources[`b:${fixture.scriptPath}`], "base64")
      .toString("utf8")
      .replace("effect = { add_gold = 2 }", "effect = { add_gold = 22 }");
    await fs.writeFile(upstream, updatedSource);
    fixture.originalSources[`b:${fixture.scriptPath}`] = Buffer.from(updatedSource).toString("base64");
    await waitFor(
      "document.body.textContent.includes('Source content changed. Refresh conflicts before building.')",
      "source watcher invalidates the scan before refresh"
    );
    await reveal();
    await click("scan");
    await noError();
    assert.deepEqual(
      await ui.eval(
        "[...document.querySelectorAll('[data-entry] .entry-name')].map(element=>element.textContent)"
      ),
      ["px_fields"]
    );
    assert.match(String(await ui.eval("document.querySelector('.detail').textContent")), /Inputs changed/);
    await fields(false);
    await click("prepare");
    await noError();
    await click("apply");
    await noError();
    const secondOutput = await fs.readFile(outputFile);
    assert.match(secondOutput.toString("utf8"), /effect = \{ add_gold = 22 \}/);
    assert.ok(secondOutput.toString("utf8").endsWith(manualNote));
    assert.equal(document.isDirty, false);
    assert.ok(document.getText().endsWith(manualNote));
    assert.ok(
      !(await config()).generated[fixture.scriptPath].text.includes(manualNote),
      "manual text is excluded from the pure generated baseline"
    );
    record(
      "upstream changes reopen only the affected decision; refresh preserves independent dirty output edits"
    );

    await vscode.window.showTextDocument(document);
    await replaceDocument(document, "# later user edit\n" + document.getText());
    const laterText = document.getText();
    await reveal();
    await click("restore");
    assert.match(String(await ui.eval("document.body.innerText")), /Recovery conflict/);
    assert.equal(document.getText(), laterText);
    assert.deepEqual(await fs.readFile(outputFile), secondOutput);
    record("Restore last update reports a conflict and preserves later user edits");
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("workbench.action.files.revert");
    assert.equal(document.isDirty, false);
    await reveal();
    await click("restore");
    await noError();
    assert.match(String(await ui.eval("document.body.innerText")), /Recovery restored/);
    assert.deepEqual(await fs.readFile(outputFile), firstOutput);
    assert.equal(document.isDirty, true);
    assert.ok(document.getText().endsWith(manualNote));
    record(
      "after explicitly discarding the later edit, restore recovers exact disk bytes and the prior dirty buffer"
    );

    await ui.screenshot(path.join(scratch, "patch-restored.png"));
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    ui.close();
    await vscode.commands.executeCommand("px.openCompatibilityPatch", vscode.Uri.file(fixture.output));
    ui = await connect(marker);
    await idle();
    await click("scan");
    await noError();
    assert.equal(await ui.eval("document.querySelectorAll('[data-entry]').length"), 0);
    await filter("ready");
    await entry("px_fields");
    assert.match(String(await ui.eval("document.querySelector('.detail').textContent")), /Decision saved/);
    assert.equal(
      Object.values((await config()).decisions).filter((decision) => decision.resolution.mode === "fields")
        .length,
      1
    );
    record("reopening the packaged workbench reuses saved decisions");

    await ui.sendWorkbench("Emulation.setDeviceMetricsOverride", {
      width: 640,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await pause(250);
    assert.equal(await ui.eval("document.documentElement.scrollWidth <= window.innerWidth"), true);
    await ui.screenshot(path.join(scratch, "patch-narrow.png"));
    record("rendered wide and narrow workbench layouts are inspectable");
    const sourceHashes: Record<string, string> = {};
    for (const [identity, original] of Object.entries(fixture.originalSources)) {
      const colon = identity.indexOf(":");
      const bytes = await fs.readFile(
        path.join(fixture.sources[identity.slice(0, colon)], identity.slice(colon + 1))
      );
      assert.deepEqual(bytes, Buffer.from(original, "base64"), `read-only source preserved: ${identity}`);
      sourceHashes[identity] = createHash("sha256").update(bytes).digest("hex");
    }
    record("source files and binary bytes stay unchanged except the intentional upstream fixture update");
    await fs.writeFile(
      path.join(scratch, "results.json"),
      JSON.stringify(
        {
          passed: true,
          vscode: vscode.version,
          checkCount: recorded.length,
          checks: recorded,
          outputBytes: firstOutput.length,
          updatedOutputBytes: secondOutput.length,
          sourceHashes,
          runtimeGameValidation: false,
        },
        null,
        2
      )
    );
  } catch (error) {
    const evidence = await Promise.allSettled([
      ui.screenshot(path.join(scratch, "patch-failure.png")),
      ui
        .eval("document.body.innerText")
        .then((text) => fs.writeFile(path.join(scratch, "patch-failure.txt"), String(text))),
    ]);
    await fs.writeFile(
      path.join(scratch, "failure.json"),
      JSON.stringify(
        {
          error: String(error),
          checksPassed: recorded,
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

export async function run(): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const scratch = process.env.PX_PATCHES_TEST_SCRATCH;
  assert.ok(scratch);
  assert.equal(process.platform, "win32", "the isolated Documents registry seam is Windows-specific");
  const documents = path.join(scratch, "Documents");
  await fs.mkdir(documents, { recursive: true });
  const childProcess = createRequire(__filename)("child_process") as typeof import("child_process");
  const originalExec = childProcess.execFileSync;
  const documentsQuery = [
    "query",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
    "/v",
    "Personal",
  ];
  let documentsQueries = 0;
  childProcess.execFileSync = ((file: string, args: string[], options: unknown) => {
    if (
      file === "reg" &&
      Array.isArray(args) &&
      args.length === documentsQuery.length &&
      args.every((arg, index) => arg === documentsQuery[index])
    ) {
      documentsQueries++;
      return `    Personal    REG_SZ    ${documents}\r\n`;
    }
    return Reflect.apply(originalExec, childProcess, [file, args, options]);
  }) as typeof originalExec;
  try {
    await Promise.race([
      checks(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Compatibility patch editor checks exceeded 240 seconds")),
          240_000
        );
      }),
    ]);
    assert.ok(documentsQueries > 0, "creation resolves its launcher folder through isolated Documents");
  } finally {
    clearTimeout(timeout);
    childProcess.execFileSync = originalExec;
  }
}
