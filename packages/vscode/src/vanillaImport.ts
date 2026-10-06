import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { PxConfig } from "./config";
import { containsPath, samePath, targetUri } from "./commandTargets";
import { metaFor } from "./meta";

export interface ImportResult {
  status: "created" | "exists";
  target: vscode.Uri;
  relativePath: string;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function stat(file: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (!missing(error)) throw error;
    return undefined;
  }
}

/** Resolve the nearest existing ancestor so missing paths cannot conceal a junction escape. */
function checkedPath(root: string, rootReal: string, file: string): void {
  if (!containsPath(root, file)) throw new Error("The selected path is outside its root folder");
  let existing = file;
  while (!stat(existing)) existing = path.dirname(existing);
  if (!containsPath(rootReal, fs.realpathSync(existing))) {
    throw new Error("A symbolic link or junction points outside its root folder");
  }
}

function createParents(root: string, rootReal: string, folder: string): void {
  let current = root;
  for (const segment of path.relative(root, folder).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    checkedPath(root, rootReal, current);
    if (!stat(current)) {
      try {
        fs.mkdirSync(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    checkedPath(root, rootReal, current);
    if (!fs.statSync(current).isDirectory()) throw new Error(`${current} is not a folder`);
  }
}

function sourceDocument(file: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find(
    (document) => document.uri.scheme === "file" && samePath(document.uri.fsPath, file)
  );
}

function editedBytes(document: vscode.TextDocument, relativePath: string, cfg: PxConfig): Buffer {
  if (document.encoding && document.encoding !== "utf8" && document.encoding !== "utf8bom") {
    throw new Error("Change the source editor encoding to UTF-8 before importing unsaved text");
  }
  const text = document.getText().replace(/^\uFEFF/, "");
  const parts = relativePath.split(path.sep);
  const stage = (metaFor(cfg.gameId).stageRoots ?? []).find((root) => root === parts[0]);
  const content = stage ? parts.slice(1) : parts;
  const localization = content[0] === "localization" && /\.yml$/i.test(relativePath);
  if (localization) {
    const language = /_l_([a-z_]+)\.yml$/i.exec(relativePath)?.[1];
    if (!language) throw new Error("Localization files must end in _l_<language>.yml");
    const header = text.split(/\r?\n/).find((line) => line.trim() && !line.trimStart().startsWith("#"));
    if (!header || !new RegExp(`^[ \\t]*l_${language}:[ \\t]*(?:#.*)?$`).test(header)) {
      throw new Error(`Localization file needs an l_${language}: header`);
    }
  }
  const script = /\.txt$/i.test(relativePath);
  if (script && content[0] === "events" && !/^namespace\s*=/.test(text)) {
    throw new Error("Event files must start with their namespace = line");
  }
  const bom =
    script || localization || document.encoding === "utf8bom" || document.getText().startsWith("\uFEFF");
  return Buffer.from((bom ? "\uFEFF" : "") + text, "utf8");
}

/** Import one resource. No directory enumeration, source writes, or descriptor edits. */
export function importVanillaResource(
  cfg: PxConfig,
  source: vscode.Uri,
  kind: "file" | "folder"
): ImportResult {
  if (source.scheme !== "file") throw new Error("Choose a local vanilla file or folder");
  if (!cfg.gamePath) throw new Error("Configure a game folder before importing vanilla content");
  if (!cfg.modPath) throw new Error("Focus a mod before importing vanilla content");
  const game = path.resolve(cfg.gamePath);
  const mod = path.resolve(cfg.modPath);
  const sourcePath = path.resolve(source.fsPath);
  if (!containsPath(game, sourcePath)) throw new Error("The selected source is outside the game folder");
  const gameReal = fs.realpathSync(game);
  const modReal = fs.realpathSync(mod);
  if (!fs.statSync(game).isDirectory() || !fs.statSync(mod).isDirectory()) {
    throw new Error("The game and focused mod paths must be folders");
  }
  if (containsPath(gameReal, modReal) || containsPath(modReal, gameReal)) {
    throw new Error("The game and focused mod folders must not overlap");
  }
  checkedPath(game, gameReal, sourcePath);
  const sourceStat = fs.statSync(sourcePath);
  if (kind === "folder" ? !sourceStat.isDirectory() : !sourceStat.isFile()) {
    throw new Error(`Choose a vanilla ${kind}`);
  }
  const relativePath = path.relative(game, sourcePath);
  const destination = path.join(mod, relativePath);
  checkedPath(mod, modReal, destination);
  if (containsPath(gameReal, path.join(modReal, relativePath))) {
    throw new Error("The destination would change game files");
  }
  const target = vscode.Uri.file(destination);
  const result = (status: ImportResult["status"]): ImportResult => ({ status, target, relativePath });
  const existing = stat(destination);
  if (existing) {
    const targetStat = fs.statSync(destination);
    if (kind === "folder" ? !targetStat.isDirectory() : !targetStat.isFile()) {
      throw new Error(`A different resource already occupies ${relativePath}`);
    }
    return result("exists");
  }
  if (kind === "file" && sourceDocument(destination)) return result("exists");
  if (kind === "folder") {
    createParents(mod, modReal, destination);
    return result("created");
  }
  const disk = fs.readFileSync(sourcePath);
  const document = sourceDocument(sourcePath);
  const version = document?.version;
  const text = document?.getText();
  const bytes = document?.isDirty ? editedBytes(document, relativePath, cfg) : disk;
  createParents(mod, modReal, path.dirname(destination));
  checkedPath(game, gameReal, sourcePath);
  checkedPath(mod, modReal, destination);
  if (
    !fs.readFileSync(sourcePath).equals(disk) ||
    sourceDocument(sourcePath) !== document ||
    (document && (document.isClosed || document.version !== version || document.getText() !== text))
  ) {
    throw new Error("The source changed during the import. Try again.");
  }
  if (sourceDocument(destination)) return result("exists");
  let fd: number;
  try {
    fd = fs.openSync(destination, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // A resource created since the preflight remains the user's resource.
    checkedPath(mod, modReal, destination);
    if (!fs.statSync(destination).isFile())
      throw new Error(`A different resource already occupies ${relativePath}`);
    return result("exists");
  }
  const created = fs.fstatSync(fd);
  try {
    fs.writeFileSync(fd, bytes);
  } catch (error) {
    fs.closeSync(fd);
    const current = stat(destination);
    if (current?.ino === created.ino && current.dev === created.dev) fs.unlinkSync(destination);
    throw error;
  }
  fs.closeSync(fd);
  return result("created");
}

async function importCommand(cfg: PxConfig, arg: unknown, kind: "file" | "folder"): Promise<void> {
  try {
    const source = targetUri(arg);
    if (!source) throw new Error(`Choose a vanilla ${kind}`);
    const result = importVanillaResource(cfg, source, kind);
    if (kind === "folder") {
      await vscode.window.showInformationMessage(
        result.status === "created"
          ? `Created ${result.relativePath || "the selected folder"} in the focused mod.`
          : `${result.relativePath || "The selected folder"} already exists in the focused mod.`
      );
      return;
    }
    if (result.status === "exists") {
      const action = await vscode.window.showInformationMessage(
        `${result.relativePath} already exists in the focused mod. Its contents were preserved.`,
        "Open Mod File",
        "Compare with Vanilla"
      );
      if (action === "Compare with Vanilla") {
        await vscode.commands.executeCommand("vscode.diff", source, result.target, result.relativePath);
      } else if (action === "Open Mod File") {
        await vscode.commands.executeCommand("vscode.open", result.target);
      }
      return;
    }
    await vscode.commands.executeCommand("vscode.open", result.target);
    await vscode.window.showInformationMessage(`Copied ${result.relativePath} to the focused mod.`);
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Vanilla import failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function importVanillaFile(cfg: PxConfig, arg?: unknown): Promise<void> {
  await importCommand(cfg, arg, "file");
}

export async function importVanillaFolder(cfg: PxConfig, arg?: unknown): Promise<void> {
  await importCommand(cfg, arg, "folder");
}
