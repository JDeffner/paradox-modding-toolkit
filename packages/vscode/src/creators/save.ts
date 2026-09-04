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
import { readModName } from "@px-lsp/protocol/modName";
import { writeLocSmart, type LocLookup } from "../locCommands";
import { scaffoldPrefix } from "../scaffold/command";
import {
  BOM,
  defaultDefinitionFileName,
  defaultTargetFileName,
  isPlainScriptFileName,
  vanillaNameClash,
} from "./saveTargets";

export interface SaveTargetOptions {
  /** Definition kind, for the default file name (`mymod_traits.txt`). */
  kind: string;
  /** The file the definition was loaded from; offered first when it is in the mod. */
  sourceFile?: string;
}

/**
 * Where a save will go, before anything is opened or created: a creator SHOWS
 * this in its top bar from the moment the form loads, so the modder can change
 * it before saving rather than being asked afterwards.
 */
export interface SaveTargetChoice {
  modPath: string;
  /** The mod's own name, as its descriptor gives it. */
  modLabel: string;
  /** Bare file name inside the kind's folder. */
  file: string;
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

/** Whether an absolute file lives under a mod root. */
function isInside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Whether two absolute paths name the same file. `path.relative` compares the
 * way the platform does, so a Windows path that differs only in case or in
 * separators still matches.
 */
export function samePath(a: string, b: string): boolean {
  return path.relative(a, b) === "";
}

/**
 * Where a definition goes when nobody picks anything, resolved WITHOUT a
 * prompt, so a creator can show its target from the moment its form loads.
 *
 * The rules are the picker's own: a mod definition being edited writes back to
 * the file it came from, in that file's own mod; everything else goes to the
 * mod of record under `<prefix>_<kind>s.txt`. The vanilla-name refusal is not
 * applied here but at save (`openSaveTarget`): a default name never hits it,
 * and a refusal for something the modder has not chosen yet is only noise.
 */
export function defaultSaveTarget(
  cfg: PxConfig,
  opts: SaveTargetOptions & { sourcePath?: string }
): SaveTargetChoice | null {
  const mods = writableMods(cfg);
  if (mods.length === 0) return null;
  const owner = opts.sourcePath ? mods.find((m) => isInside(m, opts.sourcePath!)) : undefined;
  const modPath = owner ?? mods[0];
  return {
    modPath,
    modLabel: readModName(modPath),
    file: defaultTargetFileName({
      ...(owner ? { sourceFile: path.basename(opts.sourcePath!) } : {}),
      prefix: scaffoldPrefix(cfg),
      kind: opts.kind,
    }),
  };
}

/**
 * Ask where a definition goes. Nothing is created or opened, so a modder who
 * changes a creator's target and then does not save leaves no empty file.
 *
 * `folder` is the schema path the form request answered with, root-relative and
 * already carrying a game's load-stage prefix where it has one (EU5's
 * `in_game/`), so nothing is prepended to it here.
 */
export async function pickSaveTargetChoice(
  cfg: PxConfig,
  folder: string,
  opts: SaveTargetOptions
): Promise<SaveTargetChoice | null> {
  const mods = writableMods(cfg);
  if (mods.length === 0) {
    warnNoMod();
    return null;
  }
  let modPath = mods[0];
  if (mods.length > 1) {
    const picked = await vscode.window.showQuickPick(
      mods.map((m) => ({ label: readModName(m), description: m })),
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
  return { modPath, modLabel: readModName(modPath), file };
}

/**
 * Open a chosen target for editing, creating the file when it is new.
 *
 * A file name that already exists in the GAME's copy of the same folder is
 * refused here, at the last step before anything is written: script databases
 * are last-in-wins per file name, so it would replace the whole vanilla file
 * instead of adding one entry. The name is checked again too, because a choice
 * shown in a webview comes back as text from one.
 */
export async function openSaveTarget(
  cfg: PxConfig,
  folder: string,
  choice: SaveTargetChoice
): Promise<SaveTarget | null> {
  if (!isPlainScriptFileName(choice.file)) return null;
  const gameFiles = cfg.gamePath ? listTxt(path.join(cfg.gamePath, ...folder.split("/"))) : [];
  const clash = vanillaNameClash(choice.file, gameFiles, folder);
  if (clash) {
    void vscode.window.showWarningMessage(`Paradox Modding Toolkit: ${clash}`);
    return null;
  }

  const dir = path.join(choice.modPath, ...folder.split("/"));
  const abs = path.join(dir, choice.file);
  if (!fs.existsSync(abs)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(abs, BOM, "utf8");
  }
  const doc = await vscode.workspace.openTextDocument(abs);
  return { modPath: choice.modPath, file: choice.file, abs, text: doc.getText() };
}

/** Ask where a definition goes and open the file for editing. */
export async function pickSaveTarget(
  cfg: PxConfig,
  folder: string,
  opts: SaveTargetOptions
): Promise<SaveTarget | null> {
  const choice = await pickSaveTargetChoice(cfg, folder, opts);
  return choice ? openSaveTarget(cfg, folder, choice) : null;
}

/**
 * Apply the server's edits as ONE `WorkspaceEdit`, save, and (unless
 * `reveal: false`) show the file beside without stealing focus. `text` is the
 * text the edits were computed against; a document that has moved on since is
 * left alone rather than written at stale offsets.
 */
export async function applyDefinitionEdits(
  abs: string,
  text: string,
  edits: readonly GuiTextEdit[],
  opts: { reveal?: boolean } = {}
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
  if (opts.reveal !== false) {
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
    });
  }
  return true;
}

/**
 * The loc file a creator's NEW keys go to: named after the script file the
 * definition was written to, in the same mod (`common/traits/mymod_traits.txt`
 * -> `localization/<lang>/mymod_traits_l_<lang>.yml`). It used to be "the
 * mod's largest loc file", which put a trait's name into a calendar file
 * where nobody looked for it. From the second save on the keys are found in
 * place, so the file is only ever created by the first.
 */
export function creatorLocFile(cfg: PxConfig, target: { modPath: string; file: string }): string {
  const stem = target.file.replace(/\.txt$/i, "");
  return path.join(target.modPath, "localization", cfg.locLanguage, `${stem}_l_${cfg.locLanguage}.yml`);
}

/**
 * Write a creator's loc values through the normal loc writer: a key the mod
 * already has is rewritten in place, a vanilla-only key goes to
 * `localization/replace/`, a brand-new key goes to `creatorLocFile(target)`
 * (or, with no target, the mod file holding its siblings). Returns the files
 * written, in order.
 */
export async function writeLocValues(
  cfg: PxConfig,
  lookup: LocLookup,
  pairs: readonly { key: string; value: string }[],
  target?: { modPath: string; file: string }
): Promise<string[]> {
  const files: string[] = [];
  const newKeyFile = target ? creatorLocFile(cfg, target) : undefined;
  for (const { key, value } of pairs) {
    if (key.trim() === "") continue;
    files.push(await writeLocSmart(cfg, lookup, key, value, newKeyFile));
  }
  return files;
}

/**
 * Open a definition's file in the editor beside the creator, with the cursor
 * on its `name = {` line when the file has one. The way out of every script
 * area: a webview has no completion or hover, the editor has both.
 */
export async function revealDefinition(abs: string, name: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(abs);
  // A definition name is `\w+` (the creators refuse anything else), so it
  // needs no escaping to become a pattern.
  const match = /^\w+$/.test(name)
    ? new RegExp(`^[ \\t]*${name}\\s*=\\s*\\{`, "m").exec(doc.getText())
    : null;
  const at = match ? doc.positionAt(match.index + match[0].length - 1) : new vscode.Position(0, 0);
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    selection: new vscode.Range(at, at),
  });
}
