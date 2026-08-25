/**
 * `Paradox: Open Format Docs (.info) for This File` - CK3 ships ~150 `_*.info` files inside
 * common/ documenting each folder's format (Paradox's own schema docs). This
 * command surfaces the one for the active file's folder, resolved against the
 * vanilla tree, so the ground truth is one keystroke away. The reverse command
 * (`px.openVanillaExamples`) goes from an open `_*.info` doc to the real vanilla
 * implementation files sitting next to it.
 *
 * The other games ship no `_*.info` docs, but Vic3 and EU5 put the same
 * information in per-folder `.md` files, so there the command leads with
 * those, then offers the modding wiki and the folder's vanilla files.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { PxConfig } from "./config";
import { hasFormatDocs, metaFor, wikiSearchUrl } from "./meta";

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

/** The real implementation files of a folder: its `.txt` files, sorted. */
function vanillaExamplesIn(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".txt"))
      .sort();
  } catch {
    return [];
  }
}

/** The newer games' format docs: the `.md` files Paradox ships per folder
 *  (`common/buildings/buildings.md`), their `_*.info` equivalent. */
function mdDocsIn(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".md"))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Content root `file` belongs to: the mod, workspace mods, parent mods, then the game. */
function contentRootFor(cfg: PxConfig, file: string): string | null {
  const roots = [cfg.modPath, ...cfg.workspaceMods, ...cfg.parentPaths, cfg.gamePath];
  return roots.find((r) => r && file.toLowerCase().startsWith(r.toLowerCase() + path.sep)) ?? null;
}

/**
 * The `_*.info` docs whose folder maps to `file`'s game folder, walking the
 * relative chain upward (events/foo.txt resolves to events/_events.info).
 * Empty when no game path is set or the file lies outside the known roots.
 */
export function infoDocsForFile(cfg: PxConfig, file: string): string[] {
  if (!cfg.gamePath) return [];
  const root = contentRootFor(cfg, file);
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

interface FolderReference {
  /** Leaf folder name ("buildings"), what the wiki search asks about. */
  folder: string;
  /** The folder inside the vanilla tree. */
  dir: string;
  /** The folder's own `.md` format docs (absolute paths), nearest first. */
  docs: string[];
  /** Vanilla file names in `dir`. */
  examples: string[];
  wiki: string | null;
}

/** What a game without `_*.info` docs can show for `file`'s folder. */
function folderReference(cfg: PxConfig, file: string): FolderReference | null {
  if (!cfg.gamePath) return null;
  const root = contentRootFor(cfg, file);
  if (!root) return null;
  const relDir = path.dirname(path.relative(root, file));
  if (relDir === "." || relDir === "") return null;
  const dir = path.join(cfg.gamePath, relDir);
  // The docs walk the folder chain upward, like the .info resolution does:
  // events/agitators/x.txt still finds the docs one level up.
  const docs: string[] = [];
  let at = relDir;
  while (at !== "." && at !== "") {
    docs.push(...mdDocsIn(path.join(cfg.gamePath, at)));
    const parent = path.dirname(at);
    if (parent === at) break;
    at = parent;
  }
  return {
    folder: path.basename(relDir),
    dir,
    docs,
    examples: vanillaExamplesIn(dir),
    wiki: wikiSearchUrl(cfg.gameId, path.basename(relDir)),
  };
}

/** Set `px.hasInfoDoc` for the active editor so the title button shows only
 * when there is something to open. Fail soft: no game path or no match means
 * the key is false and no button appears. */
export function updateInfoDocContext(cfg: PxConfig): void {
  const file = vscode.window.activeTextEditor?.document.uri.fsPath;
  let has = false;
  if (file) {
    if (hasFormatDocs(cfg.gameId)) {
      has = infoDocsForFile(cfg, file).length > 0;
    } else {
      const ref = folderReference(cfg, file);
      has = ref !== null && (ref.docs.length > 0 || ref.examples.length > 0 || ref.wiki !== null);
    }
  }
  void vscode.commands.executeCommand("setContext", "px.hasInfoDoc", has);
}

/**
 * The fallback for a game without `_*.info` docs. Vic3 and EU5 ship the same
 * information as per-folder `.md` files instead, so those DOCS lead the list —
 * the reader asked "how does this format work", not "show me raw files" —
 * followed by the wiki, then the vanilla implementation files.
 */
async function openFolderReference(cfg: PxConfig, file: string): Promise<void> {
  const ref = folderReference(cfg, file);
  if (!ref || (ref.docs.length === 0 && ref.examples.length === 0 && ref.wiki === null)) {
    void vscode.window.showInformationMessage(
      "Paradox Modding Toolkit: no docs or vanilla files found for this folder in the game files."
    );
    return;
  }
  const meta = metaFor(cfg.gameId);
  const items: Array<vscode.QuickPickItem & { file?: string; url?: string; md?: string }> = ref.docs.map(
    (doc) => ({
      label: `$(book) ${path.basename(doc)}`,
      description: "format documentation",
      md: doc,
    })
  );
  if (ref.wiki) {
    items.push({
      label: `$(link-external) Search the ${meta.name} modding wiki for ${ref.folder}`,
      url: ref.wiki,
    });
  }
  items.push(
    ...ref.examples.map((name) => ({
      label: name,
      description: path.relative(cfg.gamePath!, ref.dir),
      file: name,
    }))
  );
  // One .md and nothing else worth asking about: open it straight away.
  const only = ref.docs.length === 1 && ref.examples.length === 0 ? items[0] : null;
  const pick =
    only ?? (await vscode.window.showQuickPick(items, { title: `Docs & examples: ${ref.folder}` }));
  if (!pick) return;
  if (pick.url) {
    void vscode.env.openExternal(vscode.Uri.parse(pick.url));
    return;
  }
  if (pick.md) {
    // Rendered, beside the mod file: it is documentation, not source.
    await vscode.commands.executeCommand("markdown.showPreviewToSide", vscode.Uri.file(pick.md));
    return;
  }
  const doc = await vscode.workspace.openTextDocument(path.join(ref.dir, pick.file!));
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
}

export async function openInfoDocsCommand(cfg: PxConfig): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("Paradox Modding Toolkit: open a mod script file first.");
    return;
  }
  if (!cfg.gamePath) {
    void vscode.window.showWarningMessage(
      "Paradox Modding Toolkit: set px.gamePath to use the game's .info format docs."
    );
    return;
  }
  if (!hasFormatDocs(cfg.gameId)) {
    await openFolderReference(cfg, editor.document.uri.fsPath);
    return;
  }
  const candidates = infoDocsForFile(cfg, editor.document.uri.fsPath);
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage(
      "Paradox Modding Toolkit: no .info format docs found for this folder in the game files."
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
 * the schema describes). Other `_*.info` docs are excluded. It replaces the doc
 * in its own tab group: the doc and its example are the same reading, and a
 * third column would push the mod file off screen.
 */
export async function openVanillaExamplesCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const info = editor.document.uri.fsPath;
  if (!/^_.*\.info$/i.test(path.basename(info))) return;

  const dir = path.dirname(info);
  const examples = vanillaExamplesIn(dir);
  if (examples.length === 0) {
    void vscode.window.showInformationMessage(
      "Paradox Modding Toolkit: no vanilla example files next to this .info doc."
    );
    return;
  }

  const pick = await vscode.window.showQuickPick(examples, { title: "Vanilla examples" });
  if (!pick) return;
  const doc = await vscode.workspace.openTextDocument(path.join(dir, pick));
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Active, preview: true });
}
