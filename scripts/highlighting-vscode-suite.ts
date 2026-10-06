import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { connect } from "./webview-cdp";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type PaintedSpan = { text: string; color: string; weight: string };

export async function run() {
  const scratch = process.env.PX_HIGHLIGHTING_TEST_SCRATCH!;
  assert.ok(scratch);
  await vscode.extensions.getExtension("JDeffner.px-toolkit")!.activate();
  const ui = await connect("Boolean(document.querySelector('.monaco-workbench'))");
  const results: Record<string, unknown> = {};
  const config = vscode.workspace.getConfiguration();
  const update = (key: string, value: unknown) =>
    config.update(key, value, vscode.ConfigurationTarget.Global);
  const waitFor = async <T>(read: () => Promise<T>, accepts: (value: T) => boolean, label: string) => {
    let value: T;
    for (let i = 0; i < 120; i++) {
      value = await read();
      if (accepts(value)) return value;
      await pause(100);
    }
    throw new Error(`Timed out: ${label}. Last result: ${JSON.stringify(value!)}`);
  };
  const open = async (relative: string) => {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(scratch, "Mod", relative))
    );
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand("workbench.action.closePanel");
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    return document;
  };
  const painting = async () =>
    (await ui.evalWorkbench(`
    [...document.querySelectorAll('.part.editor .view-lines .view-line')].map(line =>
      [...line.querySelectorAll('[class*="mtk"]')].map(span => ({
        text: span.textContent.replace(/\u00a0/g, ' '),
        color: getComputedStyle(span).color,
        weight: getComputedStyle(span).fontWeight
      }))
    )
  `)) as PaintedSpan[][];
  const styleAt = (lines: PaintedSpan[][], marker: string, word: string) => {
    const spans = lines.find((line) =>
      line
        .map((span) => span.text)
        .join("")
        .includes(marker)
    );
    if (!spans) return undefined;
    const offset = spans
      .map((span) => span.text)
      .join("")
      .indexOf(word);
    let start = 0;
    return spans.find((span) => {
      const match = offset >= start && offset < start + span.text.length;
      start += span.text.length;
      return match;
    });
  };
  const semantic = async (document: vscode.TextDocument) => {
    const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
      "vscode.provideDocumentSemanticTokensLegend",
      document.uri
    );
    const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
      "vscode.provideDocumentSemanticTokens",
      document.uri
    );
    if (!legend || !tokens) return [];
    const decoded: { text: string; type: string; modifiers: string[] }[] = [];
    let line = 0,
      character = 0;
    for (let i = 0; i < tokens.data.length; i += 5) {
      line += tokens.data[i];
      character = tokens.data[i] === 0 ? character + tokens.data[i + 1] : tokens.data[i + 1];
      decoded.push({
        text: document.lineAt(line).text.slice(character, character + tokens.data[i + 2]),
        type: legend.tokenTypes[tokens.data[i + 3]],
        modifiers: legend.tokenModifiers.filter((_, bit) => tokens.data[i + 4] & (1 << bit)),
      });
    }
    return decoded;
  };
  try {
    await update("editor.fontSize", 17);
    await update("editor.minimap.enabled", false);
    await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    const script = await open("common/scripted_effects/fixture.txt");
    const tokens = await waitFor(
      () => semantic(script),
      (items) => items.some((t) => t.text === "add_gold"),
      "script semantic tokens"
    );
    assert.ok(tokens.some((t) => t.text === "highlight_effect" && t.modifiers.includes("declaration")));
    assert.ok(tokens.some((t) => t.text === "highlight_counter" && t.type === "variable"));
    assert.ok(tokens.some((t) => t.text === "highlight_trait" && t.type === "type"));
    results.tokens = tokens;
    for (const [theme, name, effectColor] of [
      ["Default Dark Modern", "dark", "rgb(238, 157, 40)"],
      ["Default Light Modern", "light", "rgb(147, 89, 0)"],
    ]) {
      await update("workbench.colorTheme", theme);
      await update("editor.semanticHighlighting.enabled", true);
      const on = await waitFor(
        painting,
        (lines) => {
          const effect = styleAt(lines, "add_gold", "add_gold");
          const trigger = styleAt(lines, "is_alive", "is_alive");
          const decl = styleAt(lines, "highlight_effect", "highlight_effect");
          return (
            effect?.color === effectColor &&
            !!trigger &&
            effect.color !== trigger.color &&
            decl?.weight === "700"
          );
        },
        `${name} effects, triggers and declarations`
      );
      assert.notEqual(
        styleAt(on, "scope:replacement_county", "scope:")?.color,
        styleAt(on, "scope:replacement_county", "replacement_county")?.color
      );
      results[`${name}Semantic`] = on;
      await ui.screenshot(path.join(scratch, `${name}-semantic.png`));
      await update("editor.semanticHighlighting.enabled", false);
      const off = await waitFor(
        painting,
        (lines) => styleAt(lines, "highlight_effect", "highlight_effect")?.weight === "400",
        `${name} grammar fallback`
      );
      assert.notEqual(
        styleAt(off, "scope:replacement_county", "scope:")?.color,
        styleAt(off, "scope:replacement_county", "replacement_county")?.color
      );
      for (const marker of ["# scope:comment", '"scope:quoted"']) {
        assert.equal(styleAt(off, marker, marker)?.color, styleAt(on, marker, marker)?.color);
      }
      results[`${name}Grammar`] = off;
      await ui.screenshot(path.join(scratch, `${name}-grammar.png`));
    }
    await update("editor.semanticHighlighting.enabled", true);
    await update("editor.semanticTokenColorCustomizations", { rules: { "variable.px": "#D02090" } });
    await waitFor(
      painting,
      (lines) => styleAt(lines, "save_scope_as", "highlight_actor")?.color === "rgb(208, 32, 144)",
      "user color override wins"
    );
    await update("editor.semanticTokenColorCustomizations", undefined);
    results.userColorOverride = true;
    const editor = await vscode.window.showTextDocument(script, { preview: false });
    assert.equal(editor.document.uri.toString(), script.uri.toString());
    assert.equal(
      await editor.edit((edit) =>
        edit.insert(
          script.positionAt(script.getText().length),
          '\nscripted_effect "" = {}\nhighlight_after_edit = { add_gold = 1 }\n'
        )
      ),
      true
    );
    const edited = await waitFor(
      () => semantic(script),
      (items) => items.some((t) => t.text === "highlight_after_edit" && t.modifiers.includes("declaration")),
      "unsaved malformed declaration does not block other highlighting"
    );
    assert.ok(edited.some((t) => t.text === "add_gold" && t.modifiers.includes("pxEffect")));
    results.unsavedMalformedDeclaration = true;
    for (const file of ["gui/fixture.gui", "localization/english/fixture_l_english.yml"]) {
      const document = await open(file);
      const values = await waitFor(
        () => semantic(document),
        (items) => items.some((t) => t.text === "GetName"),
        `${file} binding tokens`
      );
      assert.ok(values.some((t) => t.text === "Character" && t.type === "type"));
      assert.ok(values.some((t) => t.text === "GetName" && t.type === "function"));
      const rendered = await waitFor(
        painting,
        (lines) => {
          const type = styleAt(lines, "[Character.GetName]", "Character");
          const fn = styleAt(lines, "[Character.GetName]", "GetName");
          return !!type && !!fn && type.color !== fn.color;
        },
        `${file} visible type/function distinction`
      );
      results[file] = { tokens: values, rendered };
      await ui.screenshot(path.join(scratch, file.endsWith(".gui") ? "gui.png" : "localization.png"));
    }
    await fs.writeFile(path.join(scratch, "results.json"), JSON.stringify(results, null, 2));
  } catch (error) {
    await fs.writeFile(
      path.join(scratch, "failure.json"),
      JSON.stringify({ error: String(error), results, painted: await painting() }, null, 2)
    );
    await ui.screenshot(path.join(scratch, "failure.png"));
    throw error;
  } finally {
    ui.close();
  }
}
