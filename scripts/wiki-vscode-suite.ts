import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { connect } from "./webview-cdp";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function checks() {
  const scratch = process.env.PX_WIKI_TEST_SCRATCH!;
  const artifacts = process.env.PX_WIKI_TEST_ARTIFACTS!;
  assert.ok(scratch && artifacts);
  const completed: string[] = [];
  let ui: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    await vscode.extensions.getExtension("JDeffner.px-toolkit")!.activate();
    await vscode.commands.executeCommand("px.openWiki");
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    ui = await connect("Boolean(document.getElementById('wikiBack'))");
    const evaluate = (expression: string) => ui!.eval(expression);
    const waitFor = async (expression: string, label: string) => {
      for (let attempt = 0; attempt < 80; attempt++) {
        if (await evaluate(expression)) return;
        await pause(100);
      }
      throw new Error(`Timed out: ${label}. Page: ${await evaluate("document.body.innerText")}`);
    };
    const query = async (value: string) => {
      await evaluate(
        `document.getElementById('query').value=${JSON.stringify(value)};document.getElementById('query').dispatchEvent(new Event('input'))`
      );
    };
    const pickGame = async (name: string) => {
      await evaluate("document.getElementById('game').click()");
      await evaluate(
        `[...document.querySelectorAll('.px-menu [role=option]')].find(el=>el.textContent.includes(${JSON.stringify(name)})).click()`
      );
      await waitFor(`document.getElementById('game').textContent.includes(${JSON.stringify(name)})`, name);
    };
    const openResult = async (title: string) => {
      await waitFor(
        `[...document.querySelectorAll('.search-result .px-item-label')].some(el=>el.firstChild?.textContent===${JSON.stringify(title)})`,
        `search result ${title}`
      );
      await evaluate(
        `[...document.querySelectorAll('.search-result')].find(el=>el.querySelector('.px-item-label').firstChild?.textContent===${JSON.stringify(title)}).click()`
      );
      await waitFor("Boolean(document.querySelector('#content .search-target'))", "direct search target");
      assert.ok(
        await evaluate(
          `document.querySelector('.search-target').textContent.includes(${JSON.stringify(title)})`
        )
      );
      assert.ok(
        await evaluate(`(() => {
        const target=document.querySelector('.search-target').getBoundingClientRect();
        const pane=document.getElementById('doc').getBoundingClientRect();
        return target.top < pane.bottom && target.bottom > pane.top;
      })()`),
        "the search destination is visible in the reading pane"
      );
    };
    const location = () =>
      evaluate(`({
      query:document.getElementById('query').value,
      game:document.getElementById('game').textContent.trim(),
      title:document.querySelector('#content h1')?.textContent
    })`);
    await waitFor("document.querySelector('#content h1')?.textContent==='Wiki'", "Wiki home");
    const text = String(await evaluate("document.body.innerText"));
    for (const heading of ["Script reference", "Images & formats", "Troubleshooting", "Community", "More"])
      assert.ok(text.includes(heading), `home group ${heading}`);
    assert.ok(
      await evaluate("Boolean(document.querySelector('#content .secondary-links'))"),
      "More uses secondary links"
    );
    assert.match(text, /Suggest content/);
    assert.match(text, /Toolkit help/i);
    assert.ok(
      await evaluate(`(() => {
      const rows=[...document.querySelectorAll('#nav .px-item')];
      const examples=rows.find(row=>row.textContent.includes('Examples'));
      const report=rows.find(row=>row.textContent.includes('Mod Report'));
      return Boolean(examples && !examples.querySelector('.workspace')?.textContent.includes('Workspace') &&
        report?.querySelector('.workspace')?.textContent.includes('Workspace'));
    })()`)
    );
    await ui.screenshot(path.join(artifacts, "wiki-editor.png"));
    completed.push(
      "packaged Wiki command, grouped home, help and contribution links, reference Examples and workspace Mod Report labels"
    );

    await query("Mod structure");
    await openResult("Mod structure");
    assert.ok(await evaluate("document.querySelector('.search-target').classList.contains('card')"));
    completed.push("CK3 direct card result and visible reading destination");
    await query("Vicky-Mapgen");
    await waitFor("Boolean(document.getElementById('navEmpty'))", "CK3 excludes Victoria 3 tools");
    assert.equal(await evaluate("document.querySelectorAll('.search-result').length"), 0);
    const ck3 = await location();
    await pickGame("Victoria 3");
    await openResult("Vicky-Mapgen");
    const vic3 = await location();
    assert.equal(await evaluate("document.querySelector('#improvePage').hidden"), false);
    assert.equal(await evaluate("document.getElementById('suggestContent').disabled"), false);
    completed.push("game filtering, Victoria 3 direct result and rendered contribution actions");

    // The game switch creates a reading-history step before opening its result.
    await evaluate("document.getElementById('wikiBack').click()");
    await evaluate("document.getElementById('wikiBack').click()");
    await waitFor(
      "document.getElementById('game').textContent.includes('Crusader Kings III')",
      "back restores game"
    );
    assert.deepEqual(await location(), ck3);
    await evaluate("document.getElementById('wikiForward').click()");
    await evaluate("document.getElementById('wikiForward').click()");
    await waitFor(
      "document.getElementById('game').textContent.includes('Victoria 3')",
      "forward restores game"
    );
    assert.deepEqual(await location(), vic3);
    completed.push("Back and Forward preserve page, query and game");

    await pause(500);
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    ui.close();
    ui = undefined;
    await vscode.commands.executeCommand("px.openWiki");
    ui = await connect("Boolean(document.getElementById('wikiBack'))");
    await waitFor(
      "document.getElementById('query').value==='Vicky-Mapgen' && document.querySelector('#content .card')",
      "reopen saved reading state"
    );
    assert.deepEqual(await location(), vic3);
    await evaluate("document.getElementById('wikiBack').click()");
    await evaluate("document.getElementById('wikiBack').click()");
    await waitFor(
      "document.getElementById('game').textContent.includes('Crusader Kings III')",
      "reopened Back restores saved history"
    );
    assert.deepEqual(await location(), ck3);
    await evaluate("document.getElementById('wikiForward').click()");
    await evaluate("document.getElementById('wikiForward').click()");
    await waitFor(
      "document.getElementById('game').textContent.includes('Victoria 3')",
      "reopened Forward restores saved history"
    );
    assert.deepEqual(await location(), vic3);
    completed.push("closing and reopening restores reading state, Back and Forward history");

    await pickGame("Crusader Kings III");
    await query("Preview and inspect a DDS");
    await openResult("Preview and inspect a DDS");
    assert.match(String(await evaluate("document.querySelector('.search-target').tagName")), /^H[1-3]$/);
    assert.ok(
      await evaluate("Boolean(document.querySelector('#content .article-revision'))"),
      "packaged articles retain revision metadata"
    );
    completed.push("image guidelines search jumps to a visible section and retains revision dates");

    await pickGame("Victoria 3");
    await waitFor(
      "document.getElementById('content').textContent.includes('No asset requirements have been verified here')",
      "unavailable game-specific image reference is explained"
    );
    assert.ok(
      await evaluate("!document.getElementById('content').textContent.includes('Preview and inspect a DDS')"),
      "unavailable Victoria 3 reference does not present CK3 requirements as its own"
    );
    completed.push("unavailable reference explains the limitation for the selected game");
    await query("reference handoff check");
    assert.ok(
      await evaluate(
        "document.querySelector('#searchExamples .workspace').textContent.includes('Reference: Victoria 3')"
      ),
      "Examples action names the selected reference game"
    );
    await evaluate("document.getElementById('searchExamples').click()");
    ui.close();
    ui = await connect("Boolean(document.getElementById('sourceLines'))");
    await waitFor(
      "document.getElementById('referenceGame').textContent.includes('Victoria 3') && document.getElementById('query').value==='reference handoff check'",
      "Examples receives the selected reference game and query"
    );
    assert.ok(
      await evaluate("document.querySelector('#kinds [data-kind=all]').getAttribute('aria-pressed')==='true'")
    );
    completed.push("Examples handoff uses Victoria 3 while the workspace remains CK3");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    ui.close();
    ui = undefined;
    await vscode.commands.executeCommand("px.openWiki");
    ui = await connect("Boolean(document.getElementById('wikiBack'))");
    await waitFor(
      "document.getElementById('game').textContent.includes('Victoria 3')",
      "Wiki retains reference game after Examples"
    );
    await pickGame("Crusader Kings III");

    await query("is_alive");
    await evaluate("document.getElementById('searchExamples').click()");
    ui.close();
    ui = await connect("Boolean(document.getElementById('sourceLines'))");
    await waitFor("document.getElementById('query').value==='is_alive'", "Examples query handoff");
    assert.ok(
      await evaluate("document.querySelector('#kinds [data-kind=all]').getAttribute('aria-pressed')==='true'")
    );
    await waitFor(
      "document.getElementById('results').textContent.includes('is_alive')",
      "live Examples result"
    );
    completed.push("Wiki search action opens the live Examples catalog with its query and all kinds");
    await fs.writeFile(
      path.join(scratch, "results.json"),
      JSON.stringify(
        {
          passed: true,
          vscode: vscode.version,
          checks: completed,
          unverified: [
            "Contribution form external-opener dispatch is covered by host unit tests, not clicked in the packaged check.",
          ],
        },
        null,
        2
      )
    );
  } catch (error) {
    await fs.writeFile(
      path.join(scratch, "results.json"),
      JSON.stringify(
        { passed: false, vscode: vscode.version, checks: completed, error: String(error) },
        null,
        2
      )
    );
    throw error;
  } finally {
    ui?.close();
  }
}

export async function run() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      checks(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Wiki editor checks exceeded 120 seconds")), 120_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
