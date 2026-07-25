/**
 * Navigation from localization yml back into script: remembers the most
 * recently visited script reference of each loc key, so a translator can jump
 * back and forth between a translation and its implementation.
 *
 * F12 (and the `Paradox Localization: Go to Script Usage` command) on a loc entry goes to
 * the remembered spot first; if the key was never visited this session, the
 * mod's script files are scanned for usages instead.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { wholeNamePattern } from "@px-lsp/protocol/regex";
import type { PxConfig } from "./config";
import { listFiles } from "@px-lsp/protocol/fsWalk";
import { findLocKeyRefs, locKeyOnLine } from "@px-lsp/protocol/locRefs";

export { locKeyOnLine };

interface ScriptRef {
  file: string;
  line: number;
}

export class LocReferenceTracker {
  private recent = new Map<string, ScriptRef>();

  record(key: string, file: string, line: number): void {
    this.recent.set(key, { file, line });
  }

  get(key: string): ScriptRef | undefined {
    return this.recent.get(key);
  }

  /**
   * Wire the tracker to the editor: whenever the cursor rests on a script line
   * that references loc keys, remember that spot for each key on the line.
   * This transparently covers every way of reaching the yml afterwards (F12,
   * side-by-side command, manual open).
   */
  wire(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        const doc = e.textEditor.document;
        if (doc.languageId !== "paradox") return;
        const line = e.selections[0]?.active.line;
        if (line === undefined || line >= doc.lineCount) return;
        for (const ref of findLocKeyRefs(doc.lineAt(line).text)) {
          this.record(ref.key, doc.uri.fsPath, line);
        }
      })
    );
  }
}

/** Scan the workspace mods' script files for lines mentioning `key`. Capped, word-boundary matched. */
export function findScriptReferences(modPaths: string[], key: string, cap = 20): vscode.Location[] {
  const results: vscode.Location[] = [];
  const needle = new RegExp(wholeNamePattern(key));
  const roots = modPaths
    .flatMap((mod) => ["events", "common", "gui", "gfx"].map((d) => path.join(mod, d)))
    .filter((d) => fs.existsSync(d));
  for (const root of roots) {
    for (const file of listFiles(root, ".txt")) {
      let content: string;
      try {
        content = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (!content.includes(key)) continue;
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const col = lines[i].search(needle);
        if (col >= 0) {
          results.push(new vscode.Location(vscode.Uri.file(file), new vscode.Position(i, col)));
          if (results.length >= cap) return results;
        }
      }
    }
  }
  return results;
}

/** F12 in a loc yml jumps to the most recent (or any) script usage of the key. */
export class LocFileDefinitionProvider implements vscode.DefinitionProvider {
  constructor(
    private readonly tracker: LocReferenceTracker,
    private readonly getConfig: () => PxConfig
  ) {}

  provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Location[] {
    const key = locKeyOnLine(document.lineAt(position.line).text);
    if (!key) return [];
    const recent = this.tracker.get(key);
    if (recent) {
      return [new vscode.Location(vscode.Uri.file(recent.file), new vscode.Position(recent.line, 0))];
    }
    const cfg = this.getConfig();
    const roots = [cfg.modPath, ...cfg.workspaceMods].filter((r): r is string => r !== null);
    return roots.length > 0 ? findScriptReferences(roots, key) : [];
  }
}

export async function jumpToScriptReference(tracker: LocReferenceTracker, cfg: PxConfig): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "paradox-loc") {
    void vscode.window.showWarningMessage(
      "Paradox Toolkit: open a localization yml and place the cursor on a key first."
    );
    return;
  }
  const key = locKeyOnLine(editor.document.lineAt(editor.selection.active.line).text);
  if (!key) {
    void vscode.window.showWarningMessage("Paradox Toolkit: no localization key on this line.");
    return;
  }

  const recent = tracker.get(key);
  let location: vscode.Location | undefined;
  if (recent) {
    location = new vscode.Location(vscode.Uri.file(recent.file), new vscode.Position(recent.line, 0));
  } else {
    const roots = [cfg.modPath, ...cfg.workspaceMods].filter((r): r is string => r !== null);
    if (roots.length > 0) location = findScriptReferences(roots, key, 1)[0];
  }

  if (!location) {
    void vscode.window.showInformationMessage(
      `Paradox Toolkit: no script reference of "${key}" found in the mod.`
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument(location.uri);
  await vscode.window.showTextDocument(doc, {
    selection: location.range,
    viewColumn: vscode.ViewColumn.Active,
  });
}
