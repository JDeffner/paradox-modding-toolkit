/**
 * The host half of every visual creator: where a definition is written, how the
 * server's edits reach the document, and how its loc lands.
 *
 * The division of labour is the GUI editor's (EMBEDDING.md, host-owns-text):
 * the server computes offsets into the text it was handed, the host applies
 * them as ONE `WorkspaceEdit` so a save is one undo step, and the app never
 * touches a file. The flow itself is the Flag Builder's, which already writes
 * one top-level block into a mod file; the Flag Builder is not changed.
 *
 * Every path and setting comes from `PxConfig`: the creators add no setting of
 * their own and never ask for a path. A missing mod or game folder is reported
 * with the wording and the fix path the setup flow uses.
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { GuiTextEdit } from "@px-lsp/protocol/protocol";
import type { PxConfig } from "../config";
import { writeLocSmart, type LocLookup } from "../locCommands";
import { scaffoldPrefix } from "../scaffold/command";
import { BOM, defaultDefinitionFileName, isPlainScriptFileName, vanillaNameClash } from "./saveTargets";

export interface SaveTargetOptions {
  /** Definition kind, for the default file name (`mymod_traits.txt`). */
  kind: string;
  /** The file the definition was loaded from; offered first when it is in the mod. */
  sourceFile?: string;
}

export interface SaveTarget {
  /** The mod root the file lives under. */
  modPath: string;
  /** Bare file name inside the folder. */
  file: string;
  /** Absolute path; the file exists by the time this is returned. */
  abs: string;
  /**
   * The document's current text, with no BOM (VS Code keeps it out of the
   * text and back on the disk). The offsets a `paradox/definitionEdit` answers
   * are into exactly this string.
   */
  text: string;
}

/** The mods a creator may write into: the mod of record first, then the rest. */
function writableMods(cfg: PxConfig): string[] {
  const roots = cfg.modPath ? [cfg.modPath] : [];
  for (const root of cfg.workspaceMods) {
    if (!roots.includes(root)) roots.push(root);
  }
  return roots;
}

function listTxt(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".txt"))
      .sort();
  } catch {
    return []; // folder does not exist yet, or is unreadable
  }
}

function warnNoMod(): void {
  void vscode.window.showWarningMessage(
    "Paradox Modding Toolkit: no mod folder found. Open your mod folder (the one with the mod's descriptor) as a workspace folder."
  );
}

/** Every panel already banners the missing game folder; the notification is
 *  the same sentence, so it is said once per session and not once per save. */
let warnedNoGame = false;

function warnNoGame(): void {
  if (warnedNoGame) return;
  warnedNoGame = true;
  void vscode.window
    .showWarningMessage(
      "Paradox Modding Toolkit: the game folder is not set, so a file name that would replace a game file cannot be caught.",
      "Run Setup & Health Check"
    )
    .then((choice) => {
      if (choice === "Run Setup & Health Check") void vscode.commands.executeCommand("px.setup");
    });
}

/**
 * Ask where a definition goes and open the file for editing.
 *
 * `folder` is the schema path the form request answered with, root-relative and
 * already carrying a game's load-stage prefix where it has one (EU5's
 * `in_game/`), so nothing is prepended to it here.
 *
 * A file name that already exists in the GAME's copy of the same folder is
 * refused: script databases are last-in-wins per file name, so it would replace
 * the whole vanilla file instead of adding one entry.
 */
export async function pickSaveTarget(
  cfg: PxConfig,
  folder: string,
  opts: SaveTargetOptions
): Promise<SaveTarget | null> {
  const mods = writableMods(cfg);
  if (mods.length === 0) {
    warnNoMod();
    return null;
  }
  let modPath = mods[0];
  if (mods.length > 1) {
    const picked = await vscode.window.showQuickPick(
      mods.map((m) => ({ label: path.basename(m), description: m })),
      { placeHolder: "Which mod does this go into?" }
    );
    if (!picked) return null;
    modPath = picked.description;
  }

  const dir = path.join(modPath, ...folder.split("/"));
  const gameFiles = cfg.gamePath ? listTxt(path.join(cfg.gamePath, ...folder.split("/"))) : [];
  if (!cfg.gamePath) warnNoGame();

  const NEW = "$(new-file) New file…";
  const existing = listTxt(dir);
  const same = opts.sourceFile && existing.includes(opts.sourceFile) ? opts.sourceFile : null;
  const picked = await vscode.window.showQuickPick(
    [
      ...(same ? [{ label: same, description: "the file this definition came from" }] : []),
      ...existing.filter((f) => f !== same).map((f) => ({ label: f, description: "" })),
      { label: NEW, description: "" },
    ],
    { placeHolder: `Save into ${folder}/…` }
  );
  if (!picked) return null;

  let file = picked.label;
  if (file === NEW) {
    const typed = await vscode.window.showInputBox({
      prompt: `File name in ${folder}`,
      value: defaultDefinitionFileName(scaffoldPrefix(cfg), opts.kind),
      validateInput: (v) => {
        const name = v.trim();
        if (!isPlainScriptFileName(name)) return "A .txt file name without folders";
        return vanillaNameClash(name, gameFiles, folder);
      },
    });
    if (!typed) return null;
    file = typed.trim();
  }
  // The list itself can only offer mod files, but a typed name gets the same
  // guard the input box applied, so no path can slip through either route.
  if (!isPlainScriptFileName(file)) return null;
  const clash = vanillaNameClash(file, gameFiles, folder);
  if (clash) {
    void vscode.window.showWarningMessage(`Paradox Modding Toolkit: ${clash}`);
    return null;
  }

  const abs = path.join(dir, file);
  if (!fs.existsSync(abs)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(abs, BOM, "utf8");
  }
  const doc = await vscode.workspace.openTextDocument(abs);
  return { modPath, file, abs, text: doc.getText() };
}

/**
 * Apply the server's edits as ONE `WorkspaceEdit`, save, and show the file
 * beside without stealing focus. `text` is the text the edits were computed
 * against; a document that has moved on since is left alone rather than
 * written at stale offsets.
 */
export async function applyDefinitionEdits(
  abs: string,
  text: string,
  edits: readonly GuiTextEdit[]
): Promise<boolean> {
  const doc = await vscode.workspace.openTextDocument(abs);
  if (doc.getText() !== text) {
    void vscode.window.showWarningMessage(
      `Paradox Modding Toolkit: ${path.basename(abs)} changed while the editor was open, so nothing was written. Try again.`
    );
    return false;
  }
  if (edits.length > 0) {
    const edit = new vscode.WorkspaceEdit();
    for (const e of edits) {
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.newText);
    }
    if (!(await vscode.workspace.applyEdit(edit))) return false;
    await doc.save();
  }
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: true,
  });
  return true;
}

/**
 * Write a creator's loc values through the normal loc writer: a key the mod
 * already has is rewritten in place, a vanilla-only key goes to
 * `localization/replace/`, a brand-new key joins the mod file holding its
 * siblings. Returns the files written, in order.
 */
export async function writeLocValues(
  cfg: PxConfig,
  lookup: LocLookup,
  pairs: readonly { key: string; value: string }[]
): Promise<string[]> {
  const files: string[] = [];
  for (const { key, value } of pairs) {
    if (key.trim() === "") continue;
    files.push(await writeLocSmart(cfg, lookup, key, value));
  }
  return files;
}
