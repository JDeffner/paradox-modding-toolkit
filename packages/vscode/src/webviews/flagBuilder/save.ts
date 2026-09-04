/**
 * Writing a coat of arms into a mod, shared by the Flag Builder and the Coat
 * of Arms Designer: both panels end in the same QuickPick over the mod's
 * `common/coat_of_arms/coat_of_arms` folder and the same file rules, so the
 * flow lives here rather than twice.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { upsertFlagInFile } from "@px-lsp/server/coa/coaParse";

const BOM = "﻿";

export interface SaveFlagOptions {
  name: string;
  script: string;
  /** Must be one of the mod paths the host offered; the caller checks that. */
  modPath: string;
  /** EU5-style stage folder, from the game meta. */
  stageRoot?: string;
  /** The coa file the flag was opened from, offered first so an override is one click. */
  sourceFile?: string;
}

/**
 * Ask which file of the mod's coa folder to write into, then write. Returns
 * the file name written, or null when the user backed out or the source file
 * name was not a bare `.txt` name. The file keeps its BOM and a new one gets
 * one, like every script file the games read.
 */
export async function saveFlagToMod(o: SaveFlagOptions): Promise<string | null> {
  // Same rule the typed name gets below: sourceFile can become the write
  // target, so it must be a bare .txt name, not a path.
  if (o.sourceFile !== undefined && !/^[\w.-]+\.txt$/.test(o.sourceFile)) return null;
  const dir = path.join(o.modPath, o.stageRoot ?? "", "common", "coat_of_arms", "coat_of_arms");
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".txt"))
      .sort();
  } catch {
    /* folder does not exist yet */
  }
  const NEW = "$(new-file) New file…";
  // The file the flag came from first: same name in the mod overrides it in the game.
  const SAME = o.sourceFile ? `$(replace) ${o.sourceFile}` : null;
  const items = [
    ...(SAME ? [{ label: SAME, description: "same file name as the opened flag (overrides it)" }] : []),
    ...files.filter((f) => f !== o.sourceFile).map((f) => ({ label: f })),
    { label: NEW },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Save ${o.name} into ${path.relative(o.modPath, dir)}/…`,
  });
  if (!picked) return null;
  const pick = picked.label;
  let file = pick === SAME ? o.sourceFile! : pick;
  if (pick === NEW) {
    const typed = await vscode.window.showInputBox({
      prompt: "File name",
      value: `${o.name.toLowerCase()}_coa.txt`,
      validateInput: (v) => (/^[\w.-]+\.txt$/.test(v) ? null : "A .txt file name without folders"),
    });
    if (!typed) return null;
    file = typed;
  }
  return writeFlagFile({ ...o, file });
}

/**
 * Write the definition into one named file of the mod's coa folder, asking
 * nothing: the Coat of Arms Designer shows its target in the top bar from the
 * moment it opens, so by save time the question has already been answered.
 * The file keeps its BOM and a new one gets one, like every script file the
 * games read.
 */
export async function writeFlagFile(o: SaveFlagOptions & { file: string }): Promise<string | null> {
  if (!/^[\w.-]+\.txt$/.test(o.file)) return null;
  const dir = path.join(o.modPath, o.stageRoot ?? "", "common", "coat_of_arms", "coat_of_arms");
  const abs = path.join(dir, o.file);
  let text = "";
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    /* new file */
  }
  const hadBom = text.startsWith(BOM);
  const body = upsertFlagInFile(hadBom ? text.slice(1) : text, o.name, o.script);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, BOM + body, "utf8");
  const doc = await vscode.workspace.openTextDocument(abs);
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
  return o.file;
}
