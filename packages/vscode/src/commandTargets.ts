import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { allWorkspaceModCandidates, type PxConfig } from "./config";
import { metaFor } from "./meta";
import type { ScaffoldTemplate } from "@px-lsp/server/games/profile";

export const CREATOR_COMMANDS: Record<string, string> = {
  trait: "px.createTrait",
  culture_tradition: "px.createTradition",
  culture: "px.createCulture",
  dynasty_legacy: "px.createDynastyLegacy",
};

export interface DefinitionTarget {
  destination?: string;
  pxKey?: string;
  pxKind?: string;
  pxLoc?: { file: string; line: number };
  modRoot?: string;
  pxSourceFile?: string;
  pxSourceLine?: number;
  pxDefinitionId?: string;
  pxDefinitionKind?: string;
}

export function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}
export function containsPath(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

/** Explicit input never falls back to an unrelated active editor. */
export function targetUri(arg?: unknown): vscode.Uri | undefined {
  if (arg === undefined) return vscode.window.activeTextEditor?.document.uri;
  if (arg instanceof vscode.Uri) return arg;
  if (!arg || typeof arg !== "object") return undefined;
  const target = arg as DefinitionTarget & { uri?: unknown };
  if (target.uri instanceof vscode.Uri) return target.uri;
  if (typeof target.uri === "string") return vscode.Uri.parse(target.uri);
  if (typeof target.pxLoc?.file === "string") return vscode.Uri.file(target.pxLoc.file);
  if (typeof target.pxSourceFile === "string") return vscode.Uri.file(target.pxSourceFile);
  if (typeof target.modRoot === "string") return vscode.Uri.file(target.modRoot);
  return undefined;
}

export function writableRoot(uri: vscode.Uri | undefined, cfg: PxConfig): string | null {
  if (!uri || uri.scheme !== "file") return null;
  const file = uri.fsPath;
  if (cfg.gamePath && containsPath(cfg.gamePath, file)) return null;
  const roots = [cfg.modPath, ...cfg.workspaceMods].filter((r): r is string => !!r);
  return roots.filter((root) => containsPath(root, file)).sort((a, b) => b.length - a.length)[0] ?? null;
}

export function configForTarget(cfg: PxConfig, arg?: unknown): PxConfig {
  const root = writableRoot(targetUri(arg), cfg);
  return { ...cfg, modPath: root ?? (arg === undefined ? cfg.modPath : null) };
}

export async function targetDocument(
  arg?: unknown,
  extension?: string
): Promise<vscode.TextDocument | undefined> {
  let uri = targetUri(arg);
  if (arg === undefined && extension && (!uri || !uri.path.toLowerCase().endsWith(extension))) {
    uri = (
      await vscode.window.showOpenDialog({
        title: `Choose a ${extension} file`,
        canSelectMany: false,
        filters: { "Paradox files": [extension.slice(1)] },
      })
    )?.[0];
  }
  if (!uri) return;
  if (uri.scheme !== "file" || (extension && !uri.path.toLowerCase().endsWith(extension))) {
    void vscode.window.showInformationMessage(`Choose a local ${extension ?? "Paradox"} file.`);
    return;
  }
  return vscode.workspace.openTextDocument(uri);
}

export async function targetPosition(
  arg?: unknown
): Promise<{ document: vscode.TextDocument; position: vscode.Position } | undefined> {
  const document = await targetDocument(arg);
  if (!document) return;
  const target = arg as (DefinitionTarget & { position?: { line: number; character: number } }) | undefined;
  const explicit = target?.position;
  let line = target?.pxLoc?.line ?? target?.pxSourceLine;
  const name = target?.pxKey ?? target?.pxDefinitionId;
  if (line === undefined && name) {
    const lines = document.getText().split(/\r?\n/);
    const found = lines.findIndex(
      (text) =>
        text.trimStart().startsWith(name) && text.trimStart().slice(name.length).trimStart().startsWith("=")
    );
    if (found >= 0) line = found;
  }
  const editor = vscode.window.activeTextEditor;
  const position = explicit
    ? new vscode.Position(explicit.line, explicit.character)
    : line !== undefined
      ? new vscode.Position(
          Math.max(0, Math.min(line, document.lineCount - 1)),
          document.lineAt(Math.max(0, Math.min(line, document.lineCount - 1)))
            .firstNonWhitespaceCharacterIndex
        )
      : editor?.document.uri.toString() === document.uri.toString()
        ? editor.selection.active
        : new vscode.Position(0, 0);
  return { document, position: document.validatePosition(position) };
}

/** Folder meaning comes from the shipped templates, including load-stage roots. */
export function templatesForFolder(cfg: PxConfig, folder: string): ScaffoldTemplate[] {
  const root = writableRoot(vscode.Uri.file(folder), cfg);
  if (!root) return [];
  const meta = metaFor(cfg.gameId);
  return (meta.scaffolds ?? []).filter((template) => {
    const dirs = (meta.stageRoots?.length ? meta.stageRoots : [""]).map((stage) =>
      path.join(root, stage, path.dirname(template.scriptPath))
    );
    return dirs.some((dir) => containsPath(dir, folder));
  });
}

/** Membership keys make Explorer menus depend on the clicked resource. */
export function registerTargetContexts(
  context: vscode.ExtensionContext,
  getCfg: () => PxConfig,
  creatorFolders: () => Promise<string[]>
): void {
  let revision = 0;
  const refresh = async () => {
    const current = ++revision;
    const cfg = getCfg();
    const roots = allWorkspaceModCandidates().filter((r) => !cfg.gamePath || !containsPath(cfg.gamePath, r));
    const indexed = roots.filter((r) => !cfg.excludedMods.some((x) => samePath(x, r)));
    const resources = (list: string[]) =>
      list
        .flatMap((r) => [r, path.join(r, "descriptor.mod"), path.join(r, ".metadata", "metadata.json")])
        .map((p) => vscode.Uri.file(p).fsPath);
    const folders = new Set<string>();
    const visit = (folder: string) => {
      const resource = vscode.Uri.file(folder).fsPath;
      if (folders.has(resource) || !fs.existsSync(folder)) return;
      folders.add(resource);
      for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
        if (item.isDirectory() && !item.isSymbolicLink()) visit(path.join(folder, item.name));
      }
    };
    const creatorDirs = await creatorFolders();
    if (current !== revision) return;
    for (const root of indexed) for (const folder of creatorDirs) visit(path.join(root, folder));
    for (const root of indexed)
      for (const template of metaFor(cfg.gameId).scaffolds ?? []) {
        for (const stage of metaFor(cfg.gameId).stageRoots ?? [""])
          visit(path.join(root, stage, path.dirname(template.scriptPath)));
      }
    await Promise.all([
      vscode.commands.executeCommand("setContext", "px.modResources", resources(roots)),
      vscode.commands.executeCommand("setContext", "px.indexedModResources", resources(indexed)),
      vscode.commands.executeCommand(
        "setContext",
        "px.excludedModResources",
        resources(roots.filter((r) => !indexed.includes(r)))
      ),
      vscode.commands.executeCommand("setContext", "px.contentFolders", [...folders]),
    ]);
  };
  const update = () => {
    void refresh().catch(() => undefined);
  };
  update();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(update),
    vscode.workspace.onDidChangeWorkspaceFolders(update),
    vscode.workspace.onDidCreateFiles(update),
    vscode.workspace.onDidDeleteFiles(update),
    vscode.workspace.onDidRenameFiles(update)
  );
}
