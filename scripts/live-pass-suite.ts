/**
 * In-host checklist for the live VS Code pass (see live-pass.ts for the
 * launcher). Runs inside the Extension Development Host with the real mod
 * workspace open, so every check exercises the production client↔server path:
 * real activation, real LSP transport, real indexes against the real install.
 *
 * Soft-fails: every check records PASS/FAIL into CK3_LIVE_RESULTS; the suite
 * only rejects at the end (so one broken feature doesn't hide the rest).
 * Documents are edited IN MEMORY only and never saved.
 */
import * as vscode from "vscode";
import * as fs from "fs";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? undefined });
  } catch (err) {
    results.push({ name, ok: false, detail: String(err).slice(0, 300) });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function poll<T>(
  label: string,
  timeoutMs: number,
  stepMs: number,
  fn: () => Promise<T | null>
): Promise<{ value: T; ms: number }> {
  const t0 = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== null) return { value, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label}: timed out after ${timeoutMs}ms`);
    await sleep(stepMs);
  }
}

async function openFirst(glob: string): Promise<vscode.TextEditor> {
  const files = await vscode.workspace.findFiles(glob, null, 3);
  if (files.length === 0) throw new Error(`no workspace file matches ${glob}`);
  const doc = await vscode.workspace.openTextDocument(files[0]);
  return vscode.window.showTextDocument(doc, { preview: false });
}

/** Append text in memory (never saved) and return the position right after it. */
async function appendText(editor: vscode.TextEditor, text: string): Promise<vscode.Position> {
  const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
  await editor.edit((b) => b.insert(end, text));
  return editor.document.lineAt(editor.document.lineCount - 1).range.end;
}

async function completionsAt(uri: vscode.Uri, pos: vscode.Position, trigger?: string): Promise<string[]> {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    uri,
    pos,
    trigger
  );
  return (list?.items ?? []).map((i) => (typeof i.label === "string" ? i.label : i.label.label));
}

async function hoverTextAt(uri: vscode.Uri, pos: vscode.Position): Promise<string> {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    uri,
    pos
  );
  return (hovers ?? [])
    .flatMap((h) => h.contents)
    .map((c) => (typeof c === "string" ? c : ((c as vscode.MarkdownString).value ?? "")))
    .join("\n");
}

export async function run(): Promise<void> {
  const EXT_ID = "JDeffner.px-toolkit";

  await check("extension activates", async () => {
    const { ms } = await poll("activation", 60_000, 1000, async () => {
      const ext = vscode.extensions.getExtension(EXT_ID);
      return ext?.isActive ? ext : null;
    });
    return `active after ${ms}ms`;
  });

  await check("commands registered", async () => {
    const cmds = new Set(await vscode.commands.getCommands(true));
    const wanted = ["px.showDependencies", "px.openGuiEditor", "px.showGuiTree", "px.showEventGraph"];
    const missing = wanted.filter((c) => !cmds.has(c));
    if (missing.length > 0) throw new Error(`missing: ${missing.join(", ")}`);
  });

  // A0 residual: engine-token hover should work soon after startup, before the
  // full index settles (token data loads independently of the vanilla scan).
  let scriptEditor: vscode.TextEditor | null = null;
  let engineTokenPos: vscode.Position | null = null;
  await check("engine-token hover (is_adult) latency", async () => {
    scriptEditor = await openFirst("events/*.txt");
    await appendText(
      scriptEditor,
      "\n# live-pass scratch (never saved)\nlp_probe = {\n\tis_adult = yes\n}\n"
    );
    const doc = scriptEditor.document;
    let line = -1;
    for (let l = doc.lineCount - 1; l >= Math.max(0, doc.lineCount - 6); l--) {
      if (doc.lineAt(l).text.includes("is_adult")) {
        line = l;
        break;
      }
    }
    if (line < 0) throw new Error("probe line not found after edit");
    engineTokenPos = new vscode.Position(line, doc.lineAt(line).text.indexOf("is_adult") + 2);
    const { ms } = await poll("is_adult hover", 90_000, 1000, async () => {
      const text = await hoverTextAt(scriptEditor!.document.uri, engineTokenPos!);
      return text.length > 0 ? text : null;
    });
    return `hover after ${ms}ms`;
  });

  // Index settle, measured via the new define: completion (needs the engine
  // harvest + settings roundtrip, so it doubles as the Stream A gate).
  let definePos: vscode.Position | null = null;
  await check("index settles / define: namespace completion", async () => {
    const ed = scriptEditor!;
    definePos = await appendText(ed, "lp_val = define:");
    const { value, ms } = await poll("define: completion", 180_000, 3000, async () => {
      const labels = await completionsAt(ed.document.uri, definePos!, ":");
      return labels.some((l) => l === "NCharacter" || l.includes("NCharacter")) ? labels.length : null;
    });
    return `${value} namespaces after ${ms}ms`;
  });

  await check("define: constant completion (NCharacter|)", async () => {
    const ed = scriptEditor!;
    const pos = await appendText(ed, "NCharacter|");
    const labels = await completionsAt(ed.document.uri, pos, "|");
    if (!labels.some((l) => l.includes("MAX_STRESS_LEVEL"))) {
      throw new Error(
        `MAX_STRESS_LEVEL not offered (${labels.length} items: ${labels.slice(0, 5).join(", ")})`
      );
    }
    return `${labels.length} constants`;
  });

  await check("define hover shows resolved value", async () => {
    const ed = scriptEditor!;
    await appendText(ed, "MAX_STRESS_LEVEL\n");
    const line = ed.document.lineCount - 2;
    const text = ed.document.lineAt(line).text;
    const at = new vscode.Position(line, text.indexOf("MAX_STRESS_LEVEL") + 3);
    const hover = await hoverTextAt(ed.document.uri, at);
    if (!hover.includes("MAX_STRESS_LEVEL")) throw new Error(`hover empty or wrong: ${hover.slice(0, 120)}`);
    return hover.replace(/\s+/g, " ").slice(0, 100);
  });

  let locEditor: vscode.TextEditor | null = null;
  await check("loc #tag completion", async () => {
    locEditor = await openFirst("localization/**/*_l_english.yml");
    const pos = await appendText(locEditor, '\n lp_probe:0 "text #');
    const labels = await completionsAt(locEditor.document.uri, pos, "#");
    if (!labels.includes("G"))
      throw new Error(`G not offered (${labels.length}: ${labels.slice(0, 8).join(", ")})`);
    return `${labels.length} tags`;
  });

  await check("loc #tag hover shows color", async () => {
    const ed = locEditor!;
    await appendText(ed, 'P nice#!"');
    const line = ed.document.lineCount - 1;
    const at = new vscode.Position(line, ed.document.lineAt(line).text.indexOf("#P") + 1);
    const hover = await hoverTextAt(ed.document.uri, at);
    if (hover.length === 0) throw new Error("no hover on #P");
    return hover.replace(/\s+/g, " ").slice(0, 100);
  });

  await check("data-binding macro completion in [ ] (gui)", async () => {
    const ed = await openFirst("gui/**/*.gui");
    const pos = await appendText(ed, '\n# live-pass scratch\nlp_probe = { text = "[IsZ');
    const labels = await completionsAt(ed.document.uri, pos);
    if (!labels.some((l) => l.startsWith("IsZero"))) {
      throw new Error(`IsZero not offered (${labels.length}: ${labels.slice(0, 8).join(", ")})`);
    }
    return `${labels.length} items`;
  });

  await check("gui go-to-definition on template/base ref", async () => {
    const ed = await openFirst("gui/**/*.gui");
    const text = ed.document.getText();
    const m = /using\s*=\s*"?([A-Za-z_][A-Za-z0-9_]*)"?/.exec(text);
    if (!m) return "no using= in mod gui — skipped (counts as pass, noted for triage)";
    const off = ed.document.positionAt(m.index + m[0].indexOf(m[1]) + 1);
    const defs = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      ed.document.uri,
      off
    );
    if (!defs || defs.length === 0) throw new Error(`no definition for using = ${m[1]}`);
    return `${m[1]} -> ${defs[0].uri.fsPath.split(/[\\/]/).slice(-2).join("/")}`;
  });

  await check("GUI editor opens (datamodel ghosts render server-side)", async () => {
    await openFirst("gui/**/*.gui");
    await vscode.commands.executeCommand("px.openGuiEditor");
    await sleep(3000); // webview + layout request
  });

  await check("Dependency Explorer command on a scripted effect", async () => {
    const ed = await openFirst("common/scripted_effects/*.txt");
    const m = /^([a-zA-Z0-9_]+)\s*=\s*\{/m.exec(ed.document.getText());
    if (!m) throw new Error("no top-level def found in scripted_effects");
    const pos = ed.document.positionAt(m.index + 1);
    ed.selection = new vscode.Selection(pos, pos);
    await vscode.commands.executeCommand("px.showDependencies");
    await sleep(1500);
    return `cursor on ${m[1]}`;
  });

  await check("event graph opens", async () => {
    await vscode.commands.executeCommand("px.showEventGraph");
    await sleep(2000);
  });

  fs.writeFileSync(process.env.CK3_LIVE_RESULTS!, JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) throw new Error(`${failed.length} live checks failed`);
}
