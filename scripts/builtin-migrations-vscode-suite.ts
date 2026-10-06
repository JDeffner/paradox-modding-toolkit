import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { inspectDdsResource } from "../packages/server/src/dds/migrateMips";
import { connect } from "./webview-cdp";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function checks() {
  const scratch = process.env.PX_BUILTIN_MIGRATION_SCRATCH!;
  const source = process.env.PX_BUILTIN_MIGRATION_SOURCE!;
  const target = process.env.PX_BUILTIN_MIGRATION_TARGET!;
  const targetVersion = process.env.PX_BUILTIN_MIGRATION_TARGET_VERSION!;
  const faithOnly = process.env.PX_BUILTIN_MIGRATION_MODE === "faith-only";
  assert.ok(scratch && source && target);
  assert.ok(["1.20.0.2", "1.20.0.3"].includes(targetVersion));
  const suffix = targetVersion === "1.20.0.3" ? ".1.20.0.3" : "";
  const faithId = `ck3.faiths-to-rites.decisions${suffix}`;
  const maskId = `ck3.portrait-mask-mips${suffix}`;
  const mod = path.join(scratch, "Mod");
  const faithFile = path.join(mod, "common/religion/religion_types/custom.txt");
  const originalFaith = await fs.readFile(path.join(scratch, "original-faith.txt"));
  assert.doesNotMatch(originalFaith.toString("utf8"), /ReligiousHeadNameFemale\s*=/);
  const originalMask = await fs.readFile(path.join(scratch, "original-mask.dds"));
  const unrelated = await fs.readFile(path.join(mod, "unrelated.txt"));
  const fixture = JSON.parse(await fs.readFile(path.join(scratch, "fixture.json"), "utf8")) as {
    texture: string;
    source: string;
    before: { mipLevelCount: number };
    after: { mipLevelCount: number };
  };
  await vscode.workspace
    .getConfiguration("window")
    .update("dialogStyle", "custom", vscode.ConfigurationTarget.Global);
  assert.equal(vscode.workspace.getConfiguration("window").get("dialogStyle"), "custom");
  await vscode.workspace
    .getConfiguration("files")
    .update("simpleDialog.enable", true, vscode.ConfigurationTarget.Global);
  await vscode.extensions.getExtension("JDeffner.px-toolkit")!.activate();
  await vscode.commands.executeCommand("px.openMigrations");
  await vscode.commands.executeCommand("workbench.action.closeSidebar");
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  const ui = await connect(
    "Boolean(document.getElementById('versions') && document.querySelector('h1')?.textContent === 'Mod Compatibility')"
  );
  const wait = async (expression: string, label: string, workbench = false) => {
    for (let n = 0; n < 200; n++) {
      if (await (workbench ? ui.evalWorkbench(expression) : ui.eval(expression))) return;
      await pause(100);
    }
    throw new Error(
      `Timed out: ${label}. ${await (workbench ? ui.evalWorkbench("document.body.innerText") : ui.eval("document.body.innerText"))}`
    );
  };
  const idle = () =>
    wait("document.getElementById('app').getAttribute('aria-busy') === 'false'", "migration idle");
  const actionTimings: { label: string; elapsedMs: number }[] = [];
  const act = async (trigger: string, label: string) => {
    console.log(`${new Date().toISOString()} Built-in editor action: ${label}`);
    await idle();
    const started = Date.now();
    try {
      await ui.eval(`new Promise((resolve,reject)=>{
      const app=document.getElementById('app');let busy=false;
      const timer=setTimeout(()=>{observer.disconnect();reject(new Error(${JSON.stringify(label)}));},180000);
      const observer=new MutationObserver(()=>{if(app.getAttribute('aria-busy')==='true')busy=true;else if(busy){clearTimeout(timer);observer.disconnect();resolve(true);}});
      observer.observe(app,{attributes:true,attributeFilter:['aria-busy']});${trigger};
    })`);
    } finally {
      const elapsedMs = Date.now() - started;
      actionTimings.push({ label, elapsedMs });
      console.log(`Built-in editor action completed: ${label} (${elapsedMs} ms)`);
    }
  };
  const click = async (action: string) => {
    await wait(
      `Boolean(document.querySelector('[data-action="${action}"]:not(:disabled)'))`,
      `${action} enabled`
    );
    await act(`document.querySelector('[data-action="${action}"]').click()`, action);
    assert.equal(await ui.eval("Boolean(document.querySelector('.error'))"), false, `${action} succeeded`);
  };
  const select = (id: string) =>
    act(`document.querySelector('[data-entry="${id}"]').click()`, `select ${id}`);
  const choose = async (id: string, label?: string) => {
    await wait(
      `Boolean(document.getElementById(${JSON.stringify(`q-${id}`)})?.checkVisibility())`,
      `${id} rendered`
    );
    await ui.eval(
      `document.getElementById(${JSON.stringify(`q-${id}`)}).scrollIntoView({block:'center'});document.getElementById(${JSON.stringify(`q-${id}`)}).click()`
    );
    await wait("Boolean(document.querySelector('[role=listbox] [role=option]'))", "choice menu");
    const wanted = label
      ? `[...document.querySelectorAll('[role=listbox] [role=option]')].find(row=>row.textContent.trim()===${JSON.stringify(label)})`
      : "[...document.querySelectorAll('[role=listbox] [role=option]')].find(row=>!row.textContent.trim().startsWith('Choose'))";
    await wait(`Boolean(${wanted})`, `choice ${label ?? "first explicit option"}`);
    await act(`(${wanted}).click()`, `answer ${id}`);
  };
  const selectSource = async () => {
    await ui.eval("document.querySelector('[data-root=source]').click()");
    await wait(
      "Boolean(document.querySelector('.quick-input-widget')?.checkVisibility() && document.querySelector('.quick-input-widget input'))",
      "real source folder picker",
      true
    );
    await ui.evalWorkbench(
      "(()=>{const input=document.querySelector('.quick-input-widget input');input.focus();input.select();})()"
    );
    await ui.sendWorkbench("Input.insertText", { text: `${source}${path.sep}` });
    for (const type of ["keyDown", "keyUp"])
      await ui.sendWorkbench("Input.dispatchKeyEvent", {
        type,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
      });
    const accept =
      "[...document.querySelectorAll('.quick-input-widget button,.quick-input-widget .monaco-button')].find(button=>button.checkVisibility() && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && /^(Select Folder|Open|OK)$/.test(button.textContent.trim()))";
    for (let n = 0; n < 100; n++) {
      if (
        !(await ui.evalWorkbench("Boolean(document.querySelector('.quick-input-widget')?.checkVisibility())"))
      )
        break;
      if (await ui.evalWorkbench(`Boolean(${accept})`)) {
        await ui.evalWorkbench(`(${accept}).click()`);
      }
      await pause(200);
    }
    await wait(
      "!document.querySelector('.quick-input-widget')?.checkVisibility()",
      "source picker accepted",
      true
    );
    // An archive without launcher metadata requires an explicit, visible version choice.
    for (let n = 0; n < 100; n++) {
      const approved = await ui.evalWorkbench(
        "(()=>{const button=[...document.querySelectorAll('.notification-toast button,.notification-toast .monaco-button')].find(button=>button.textContent==='Use as selected version');if(!button)return false;button.click();return true;})()"
      );
      if (approved || (await ui.eval("document.getElementById('app').getAttribute('aria-busy') === 'false'")))
        break;
      await pause(100);
    }
    await idle();
    assert.equal(
      await ui.eval(`document.querySelector('#game-data').textContent.includes(${JSON.stringify(source)})`),
      true,
      "source selected through the displayed folder picker"
    );
  };
  const fillRequired = async () => {
    for (let n = 0; n < 20; n++) {
      if (await ui.eval("Boolean(document.querySelector('[data-action=prepare]:not(:disabled)'))")) return;
      const id = (await ui.eval(
        "[...document.querySelectorAll('button[data-question][aria-required=true]')].find(button=>button.value==='')?.dataset.question"
      )) as string | undefined;
      if (!id) throw new Error(`No selectable missing answer: ${await ui.eval("document.body.innerText")}`);
      await choose(id, id.includes(":holy-site:") ? "Eminent (global and local bonuses)" : undefined);
    }
    throw new Error("Required choices exceeded the bounded test fixture");
  };
  const restore = async () => {
    await click("restore");
    assert.deepEqual(await fs.readFile(path.join(mod, "unrelated.txt")), unrelated);
  };
  const modBytes = async () => {
    const entries = await fs.readdir(mod, { recursive: true, withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(mod, path.join(entry.parentPath, entry.name)))
      .sort();
    return Object.fromEntries(
      await Promise.all(files.map(async (file) => [file, await fs.readFile(path.join(mod, file))]))
    );
  };
  try {
    await idle();
    assert.equal(
      await ui.eval(
        `Boolean(document.querySelector('[data-entry="${faithId}"]') && document.querySelector('[data-entry="${maskId}"]'))`
      ),
      true,
      "packaged built-in catalog rendered"
    );
    await act(
      `document.getElementById('from-version').value='1.19.0.6';document.getElementById('to-version').value=${JSON.stringify(targetVersion)};document.getElementById('versions').requestSubmit()`,
      "exact version route"
    );
    const displayedRoute = String(await ui.eval("document.querySelector('.route-nav').textContent"));
    assert.ok(displayedRoute.includes("1.19.0.6") && displayedRoute.includes(targetVersion));
    await select(faithId);
    assert.equal(
      await ui.eval(`document.getElementById('game-data').textContent.includes(${JSON.stringify(target)})`),
      true,
      "exact target version autoassigned from gamePath"
    );
    assert.equal(
      await ui.eval("document.querySelector('[data-action=scan]').disabled"),
      true,
      "source reference required"
    );
    await selectSource();
    assert.equal(await ui.eval("document.querySelector('[data-action=scan]').textContent"), "Use migration");
    await click("scan");
    assert.equal(
      await ui.eval("document.querySelector('[data-action=prepare]').disabled"),
      true,
      "required author decisions block preparation"
    );
    await choose("faith:parent:representation", "Defer conversion");
    assert.match(String(await ui.eval("document.body.innerText")), /deferred/i);
    assert.equal(await ui.eval("document.querySelector('[data-action=prepare]').disabled"), true);
    await choose("faith:parent:representation", "Keep as an independent faith");
    await choose("faith:child:representation", "Make a rite under a selected faith");
    await choose("faith:child:parent", "parent");
    await fillRequired();
    await ui.screenshot(path.join(scratch, "builtin-faith-choices.png"));
    await click("prepare");
    await act(
      "document.querySelector('[data-diff=\"common/religion/religion_types/custom.txt\"]').click()",
      "faith native diff"
    );
    await wait("document.getElementById('app').getAttribute('aria-busy') === 'false'", "diff ready");
    const diff = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(diff instanceof vscode.TabInputTextDiff, "faith preview opens the native diff editor");
    assert.match((await vscode.workspace.openTextDocument(diff.original)).getText(), /faiths\s*=/);
    const reviewedReligion = (await vscode.workspace.openTextDocument(diff.modified)).getText();
    assert.doesNotMatch(reviewedReligion, /faiths\s*=/);
    assert.match(reviewedReligion, /ReligiousHeadNameFemale\s*=\s*buddhism_religious_head_title\b/);
    await ui.screenshot(path.join(scratch, "builtin-faith-native-diff.png"));
    await vscode.commands.executeCommand("px.openMigrations");
    await act(
      "document.querySelector('[data-diff=\"common/religion/faith_types/px_migrated_parent.txt\"]').click()",
      "faith female title native diff"
    );
    const parentDiff = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(parentDiff instanceof vscode.TabInputTextDiff, "new faith opens the native diff editor");
    const reviewedParent = (await vscode.workspace.openTextDocument(parentDiff.modified)).getText();
    assert.match(reviewedParent, /ReligiousHeadNameFemale\s*=\s*buddhism_religious_head_title\b/);
    await ui.screenshot(path.join(scratch, "builtin-faith-female-title-diff.png"));
    await vscode.commands.executeCommand("px.openMigrations");
    await ui.eval("document.querySelector('[data-action=apply]').scrollIntoView({block:'center'})");
    await ui.screenshot(path.join(scratch, "builtin-faith-review.png"));
    await click("apply");
    const writtenFaith = await fs.readFile(
      path.join(mod, "common/religion/faith_types/px_migrated_parent.txt")
    );
    const writtenRite = await fs.readFile(path.join(mod, "common/religion/rite_types/px_migrated_child.txt"));
    assert.ok(writtenFaith.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
    assert.ok(writtenRite.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
    assert.equal(
      writtenFaith.toString("utf8").replace(/\r\n/g, "\n"),
      `\uFEFF${reviewedParent.replace(/\r\n/g, "\n")}`,
      "Apply writes the reviewed faith content with BOM (native diff normalizes EOL)"
    );
    assert.match(writtenFaith.toString("utf8"), /faith_details/);
    assert.match(
      writtenFaith.toString("utf8"),
      /ReligiousHeadNameFemale\s*=\s*buddhism_religious_head_title\b/
    );
    assert.match(writtenFaith.toString("utf8"), /preserve parent title comment/);
    const writtenReligion = await fs.readFile(faithFile, "utf8");
    assert.equal(
      writtenReligion.replace(/\r\n/g, "\n"),
      `\uFEFF${reviewedReligion.replace(/\r\n/g, "\n")}`,
      "Apply writes the reviewed religion content with BOM (native diff normalizes EOL)"
    );
    assert.match(writtenReligion, /ReligiousHeadNameFemale\s*=\s*buddhism_religious_head_title\b/);
    assert.match(writtenReligion, /preserve religion title comment/);
    assert.match(writtenRite.toString("utf8"), /faith\s*=\s*parent/);
    assert.match(
      await fs.readFile(faithFile, "utf8"),
      /preserve this religion comment[\s\S]*preserve this unrelated tail/
    );
    await fs.writeFile(path.join(scratch, "faith-applied-religion.txt"), writtenReligion);
    await fs.writeFile(path.join(scratch, "faith-applied-parent.txt"), writtenFaith);
    await restore();
    assert.deepEqual(await fs.readFile(faithFile), originalFaith);
    await assert.rejects(fs.access(path.join(mod, "common/religion/faith_types/px_migrated_parent.txt")), {
      code: "ENOENT",
    });
    await assert.rejects(fs.access(path.join(mod, "common/religion/rite_types/px_migrated_child.txt")), {
      code: "ENOENT",
    });

    await fs.mkdir(path.join(mod, "events"), { recursive: true });
    const unsupportedConsumer = path.join(mod, "events/unsupported_fixture.txt");
    await fs.writeFile(
      unsupportedConsumer,
      "\uFEFFnamespace = px_fixture\npx_fixture.1 = { trigger = { faith = faith:child.religious_head } }\n"
    );
    await click("scan");
    assert.match(String(await ui.eval("document.body.innerText")), /unsupported_fixture\.txt/);
    assert.equal(
      await ui.eval("document.querySelector('[data-action=prepare]').disabled"),
      true,
      "unsupported faith consumer blocks preparation"
    );
    await fs.unlink(unsupportedConsumer);

    if (faithOnly) {
      const ambiguousFaith = originalFaith
        .toString("utf8")
        .replace(
          "ReligiousHeadName = buddhism_religious_head_title # preserve parent title comment",
          "ReligiousHeadName = px_unknown_head_title # preserve parent title comment"
        );
      assert.notEqual(ambiguousFaith, originalFaith.toString("utf8"));
      await fs.writeFile(faithFile, ambiguousFaith);
      await click("scan");
      await choose("faith:parent:representation", "Keep as an independent faith");
      const blockedText = String(await ui.eval("document.body.innerText"));
      assert.match(blockedText, /Add an explicit ReligiousHeadNameFemale/);
      assert.match(blockedText, /custom\.txt/);
      assert.equal(
        await ui.eval("document.querySelector('[data-action=prepare]').disabled"),
        true,
        "a head title without an exact target mapping blocks preparation"
      );
      assert.equal(await fs.readFile(faithFile, "utf8"), ambiguousFaith, "blocked mapping preserves source");
      assert.deepEqual(await fs.readFile(path.join(mod, "unrelated.txt")), unrelated);
      await fs.writeFile(path.join(scratch, "faith-blocked-mapping.txt"), blockedText);
      await ui.screenshot(path.join(scratch, "builtin-faith-blocked-mapping.png"));
      await fs.writeFile(faithFile, originalFaith);
      await fs.writeFile(
        path.join(scratch, "result.json"),
        JSON.stringify(
          {
            status: "passed",
            mode: "faith-only",
            targetVersion,
            verified: [
              "packaged catalog and exact route",
              "real source folder picker",
              "required choices and explicit defer block preparation",
              "native religion and independent-faith diffs include the target female title",
              "Apply saves the reviewed female title at both localization scopes",
              "script BOM, title comments, source tail and unrelated content preserved",
              "Restore recovers exact original bytes and removes generated files",
              "unsupported faith consumer blocks preparation",
              "missing target title mapping blocks preparation and preserves source",
            ],
            unverified: [
              "target-game runtime after restart",
              "Crozier validator (none available)",
              "DDS UI not rerun in faith-only mode",
            ],
          },
          null,
          2
        )
      );
      return;
    }

    await select(maskId);
    const beforeCancel = await modBytes();
    const cancelledScan = act(
      "document.querySelector('[data-action=scan]').click()",
      "DDS scan cancellation"
    );
    await wait(
      "document.getElementById('app').getAttribute('aria-busy') === 'true' && document.querySelector('.status').textContent.includes('Reading mod and game reference files') && Boolean(document.querySelector('[data-action=cancel]:not(:disabled)'))",
      "DDS capture and visible Cancel"
    );
    await ui.screenshot(path.join(scratch, "builtin-dds-capture-busy.png"));
    await ui.eval("document.querySelector('[data-action=cancel]').click()");
    await cancelledScan;
    assert.match(
      String(await ui.eval("document.querySelector('.error')?.textContent")),
      /Migration cancelled/
    );
    assert.deepEqual(await modBytes(), beforeCancel, "Cancel preserves every file in the scratch mod");
    assert.deepEqual(await fs.readFile(path.join(mod, fixture.texture)), originalMask);
    assert.deepEqual(await fs.readFile(faithFile), originalFaith);
    assert.deepEqual(await fs.readFile(path.join(mod, "unrelated.txt")), unrelated);
    await ui.screenshot(path.join(scratch, "builtin-dds-cancelled.png"));
    await click("scan");
    assert.match(String(await ui.eval("document.body.innerText")), /Exact target consumer and DDS/);
    await fillRequired();
    await click("prepare");
    await act(
      `document.querySelector('[data-diff=${JSON.stringify(fixture.texture)}]').click()`,
      "DDS metadata review"
    );
    const metadata = vscode.window.activeTextEditor?.document.getText();
    assert.ok(metadata);
    assert.match(
      metadata,
      new RegExp(`Stored mip levels: ${fixture.before.mipLevelCount} \\(includes the base image\\)`)
    );
    assert.match(
      metadata,
      new RegExp(`Stored mip levels: ${fixture.after.mipLevelCount} \\(includes the base image\\)`)
    );
    const originalResource = inspectDdsResource(originalMask);
    assert.ok(metadata.includes(`Dimensions: ${originalResource.width} x ${originalResource.height}`));
    assert.ok(metadata.includes(`Format: ${originalResource.format}`));
    assert.ok(metadata.includes("Resource: 2d"));
    await fs.writeFile(path.join(scratch, "dds-reviewed-metadata.txt"), metadata);
    await ui.screenshot(path.join(scratch, "builtin-dds-native-metadata.png"));
    await vscode.commands.executeCommand("px.openMigrations");
    await ui.eval("document.querySelector('[data-action=apply]').scrollIntoView({block:'center'})");
    await ui.screenshot(path.join(scratch, "builtin-dds-review.png"));
    await click("apply");
    const migratedMask = await fs.readFile(path.join(mod, fixture.texture));
    const migratedResource = inspectDdsResource(migratedMask);
    assert.equal(migratedResource.mipLevelCount, fixture.after.mipLevelCount);
    assert.deepEqual(
      migratedMask.subarray(migratedResource.dataOffset),
      originalMask.subarray(originalResource.dataOffset, migratedMask.length)
    );
    await restore();
    assert.deepEqual(await fs.readFile(path.join(mod, fixture.texture)), originalMask);

    const blocked = Buffer.from(originalMask);
    blocked.writeUInt32LE(blocked.readUInt32LE(112) | 0x200, 112);
    if (originalResource.dataOffset === 148) blocked.writeUInt32LE(blocked.readUInt32LE(136) | 4, 136);
    const unsupportedPath = "gfx/px_builtin_test/unsupported_cube.dds";
    await fs.mkdir(path.dirname(path.join(mod, unsupportedPath)), { recursive: true });
    await fs.writeFile(path.join(mod, unsupportedPath), blocked);
    await fs.writeFile(
      path.join(mod, "gfx/px_builtin_test/unsupported.asset"),
      `\uFEFFentity = { name = "px_builtin_unsupported" game_data = { portrait_entity_user_data = { portrait_accessory = { pattern_mask = "${unsupportedPath}" } } } }\n`
    );
    await click("scan");
    assert.match(String(await ui.eval("document.body.innerText")), /Unsupported cube DDS resource/);
    assert.equal(
      await ui.eval("document.querySelector('[data-action=prepare]').disabled"),
      true,
      "unsupported resource cannot prepare a replacement"
    );
    assert.deepEqual(await fs.readFile(path.join(mod, unsupportedPath)), blocked);
    assert.deepEqual(await fs.readFile(path.join(mod, "unrelated.txt")), unrelated);
    await ui.screenshot(path.join(scratch, "builtin-dds-blocked.png"));
    await fs.writeFile(
      path.join(scratch, "result.json"),
      JSON.stringify(
        {
          status: "passed",
          fixture,
          verified: [
            "packaged catalog and exact route",
            "real source folder picker",
            "faith choices and blocked consumer",
            "native text diff and apply",
            "script BOM and unrelated preservation",
            "faith restore",
            "target female head title in native review and saved religion/faith outputs",
            "visible Cancel aborts DDS capture without changing mod bytes",
            "DDS metadata review",
            "retained DDS pixels and exact count",
            "DDS restore",
            "unsupported cube blocked",
          ],
          unverified: ["target-game runtime and rendering", "Crozier validator (none available)"],
        },
        null,
        2
      )
    );
  } catch (error) {
    await Promise.allSettled([
      ui.screenshot(path.join(scratch, "builtin-migrations-failure.png")),
      ui
        .eval("document.body.innerText")
        .then((text) => fs.writeFile(path.join(scratch, "builtin-migrations-failure.txt"), String(text))),
    ]);
    await fs.writeFile(path.join(scratch, "failure.json"), JSON.stringify({ error: String(error) }, null, 2));
    throw error;
  } finally {
    await fs.writeFile(path.join(scratch, "action-timings.json"), JSON.stringify(actionTimings, null, 2));
    ui.close();
  }
}

export async function run() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      checks(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Built-in editor checks exceeded 600 seconds")), 600_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
