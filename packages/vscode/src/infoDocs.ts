/**
 * `CK3: Open Format Docs (.info) for This File` — the game ships ~150 `_*.info` files inside
 * common/ documenting each folder's format (Paradox's own schema docs). This
 * command surfaces the one for the active file's folder, resolved against the
 * vanilla tree, so the ground truth is one keystroke away. The reverse command
 * (`ck3.openVanillaExamples`) goes from an open `_*.info` doc to the real vanilla
 * implementation files sitting next to it.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { Ck3Config } from "./config";

function infoFilesIn(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".info"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * The `_*.info` docs whose folder maps to `file`'s game folder, walking the
 * relative chain upward (events/foo.txt resolves to events/_events.info).
 * Empty when no game path is set or the file lies outside the known roots.
 * Content roots: the mod, workspace mods, parent mods, then the game itself.
 */
export function infoDocsForFile(cfg: Ck3Config, file: string): string[] {
  if (!cfg.gamePath) return [];
  const roots = [cfg.modPath, ...cfg.workspaceMods, ...cfg.parentPaths, cfg.gamePath];
  const root = roots.find((r) => r && file.toLowerCase().startsWith(r.toLowerCase() + path.sep));
  if (!root) return [];

  let relDir = path.dirname(path.relative(root, file));
  const candidates: string[] = [];
  while (relDir !== "." && relDir !== "") {
    candidates.push(...infoFilesIn(path.join(cfg.gamePath, relDir)));
    const parent = path.dirname(relDir);
    if (parent === relDir) break;
    relDir = parent;
  }
  return candidates;
}

/** Set `ck3.hasInfoDoc` for the active editor so the title button shows only
 * when a relevant `_*.info` file actually exists. Fail soft: no game path or no
 * match means the key is false and no button appears. */
export function updateInfoDocContext(cfg: Ck3Config): void {
  const file = vscode.window.activeTextEditor?.document.uri.fsPath;
  const has = file ? infoDocsForFile(cfg, file).length > 0 : false;
  void vscode.commands.executeCommand("setContext", "ck3.hasInfoDoc", has);
}

export async function openInfoDocsCommand(cfg: Ck3Config): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("CK3: open a mod script file first.");
    return;
  }
  if (!cfg.gamePath) {
    void vscode.window.showWarningMessage("CK3: set ck3.gamePath to use the game's .info format docs.");
    return;
  }
  const candidates = infoDocsForFile(cfg, editor.document.uri.fsPath);
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage(
      "CK3: no .info format docs found for this folder in the game files."
    );
    return;
  }

  let chosen = candidates[0];
  if (candidates.length > 1) {
    const pick = await vscode.window.showQuickPick(
      candidates.map((c) => ({ label: path.basename(c), description: path.relative(cfg.gamePath!, c), c })),
      { title: "Format docs (.info)" }
    );
    if (!pick) return;
    chosen = pick.c;
  }
  const doc = await vscode.workspace.openTextDocument(chosen);
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
}

/**
 * Reverse direction: from an open `_*.info` doc, open one of the real vanilla
 * implementation `.txt` files in the same folder (the actual base-game content
 * the schema describes). Other `_*.info` docs are excluded.
 */
export async function openVanillaExamplesCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const info = editor.document.uri.fsPath;
  if (!/^_.*\.info$/i.test(path.basename(info))) return;

  const dir = path.dirname(info);
  let examples: string[];
  try {
    examples = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".txt"))
      .sort();
  } catch {
    examples = [];
  }
  if (examples.length === 0) {
    void vscode.window.showInformationMessage("CK3: no vanilla example files next to this .info doc.");
    return;
  }

  const pick = await vscode.window.showQuickPick(examples, { title: "Vanilla examples" });
  if (!pick) return;
  const doc = await vscode.workspace.openTextDocument(path.join(dir, pick));
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
}
