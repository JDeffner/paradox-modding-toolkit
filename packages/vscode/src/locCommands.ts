/**
 * Localization editing commands: an input-box flow that writes back to the yml
 * (preserving the UTF-8 BOM and the `:0` version suffix) and a side-by-side
 * view. Loc lookups go to the language server (paradox/lookupLoc); the file writes
 * stay client-side where the editor UX lives.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { PxConfig } from "./config";
import type { LocEntryInfo } from "@px-lsp/protocol/protocol";
import { targetPosition, targetUri, containsPath } from "./commandTargets";
import { findLocKeyRefs, locKeyOnLine, type LocKeyRef } from "@px-lsp/protocol/locRefs";
import { escapeRegExp } from "@px-lsp/protocol/regex";
import { isScriptLang } from "./langIds";
import {
  generatedLocalizationSource,
  suggestLocalizationTarget,
  upsertLocalizationText,
} from "@px-lsp/protocol/localizationPolicy";
import { readDocument, writeDocument, type DocumentSnapshot } from "./documentWrite";
import {
  assertLocalizationPath,
  effectiveLocConfig,
  localizationRoots,
  LocalizationProject,
} from "./localizationProject";

export type LocLookup = (key: string, language?: string) => Promise<LocEntryInfo[]>;

function locLanguage(file: string): string | undefined {
  return /_l_([a-z_]+)\.yml$/i.exec(file)?.[1].toLowerCase();
}

/** Preserve the row's language and exact localization file through lookup and writing. */
function localizationTarget(arg: unknown, fallbackLanguage?: string) {
  const row = arg as { pxLanguage?: unknown; pxLoc?: { line?: number } } | undefined;
  const uri = targetUri(typeof arg === "string" ? undefined : arg);
  const fileLanguage = uri?.scheme === "file" ? locLanguage(uri.fsPath) : undefined;
  const language =
    typeof row?.pxLanguage === "string" && /^[a-z_]+$/.test(row.pxLanguage)
      ? row.pxLanguage
      : (fileLanguage ?? fallbackLanguage);
  return {
    language,
    file: fileLanguage && fileLanguage === language ? uri!.fsPath : undefined,
    line: row?.pxLoc?.line ?? 0,
  };
}

export function locKeyRefAt(document: vscode.TextDocument, position: vscode.Position): LocKeyRef | null {
  const refs = findLocKeyRefs(document.lineAt(position.line).text);
  return refs.find((r) => position.character >= r.start - 1 && position.character <= r.end + 1) ?? null;
}

export async function resolveKeyFromEditor(lookup: LocLookup, arg?: unknown): Promise<string | null> {
  if (typeof arg === "string" && arg !== "") return arg;
  if (arg && typeof arg === "object" && typeof (arg as { pxKey?: unknown }).pxKey === "string")
    return (arg as { pxKey: string }).pxKey;
  const target = await targetPosition(arg);
  if (!target) return null;
  const { document, position } = target;
  if (document.languageId === "paradox-loc") return locKeyOnLine(document.lineAt(position.line).text);
  const ref = locKeyRefAt(document, position);
  if (ref) return ref.key;
  const range = document.getWordRangeAtPosition(position, /[A-Za-z0-9_.-]+/);
  if (range) {
    const word = document.getText(range);
    if ((await lookup(word)).length > 0) return word;
  }
  return null;
}

export function registerLocalizationContext(
  context: vscode.ExtensionContext,
  lookup: LocLookup,
  getCfg?: () => PxConfig
): () => void {
  let revision = 0;
  const update = async () => {
    const current = ++revision;
    const editor = vscode.window.activeTextEditor;
    const supported =
      editor &&
      (editor.document.languageId === "paradox-loc" ||
        editor.document.languageId === "paradox-gui" ||
        isScriptLang(editor.document.languageId));
    const key = supported ? await resolveKeyFromEditor(lookup) : null;
    const cfg = getCfg ? effectiveLocConfig(getCfg()) : undefined;
    const language = editor
      ? (locLanguage(editor.document.uri.fsPath) ?? cfg?.locLanguage)
      : cfg?.locLanguage;
    const defs = key
      ? (await lookup(key, language)).filter((def) => !language || locLanguage(def.file) === language)
      : [];
    if (current !== revision) return;
    await vscode.commands.executeCommand(
      "setContext",
      "px.localizationReference",
      !!key && editor?.document.languageId !== "paradox-loc"
    );
    await vscode.commands.executeCommand(
      "setContext",
      "px.localizationDefinition",
      !!key && editor?.document.languageId === "paradox-loc"
    );
    await vscode.commands.executeCommand("setContext", "px.localizationExists", defs.length > 0);
    await vscode.commands.executeCommand(
      "setContext",
      "px.localizationOwned",
      defs.some((def) => cfg?.modPath && containsPath(cfg.modPath, def.file))
    );
  };
  const refresh = () => {
    void update().catch(() => {
      for (const name of ["Reference", "Definition", "Exists", "Owned"])
        void vscode.commands.executeCommand("setContext", `px.localization${name}`, false);
    });
  };
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(refresh),
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.workspace.onDidChangeTextDocument(refresh),
    vscode.workspace.onDidChangeConfiguration(refresh),
    vscode.commands.registerCommand("px.copyLocalizationKey", async (arg?: unknown) => {
      const key = await resolveKeyFromEditor(lookup, arg);
      if (key) await vscode.env.clipboard.writeText(key);
    })
  );
  refresh();
  return refresh;
}

function locEntry(lines: string[], key: string, hint?: number) {
  const pattern = new RegExp(`^(\\s*${escapeRegExp(key)}:\\d*\\s*")(.*)("[^"]*)$`);
  const line =
    hint !== undefined && pattern.test(lines[hint] ?? "") ? hint : lines.findIndex((l) => pattern.test(l));
  const parts = pattern.exec(lines[line] ?? "");
  return parts ? { line, parts } : null;
}

export interface LocalizationWriteContext {
  sourcePath?: string;
  relatedKeys?: string[];
  fallbackPath?: string;
  /** Explicit user selection or a previously resolved preview destination. */
  targetFile?: string;
  language?: string;
  override?: boolean;
}

export interface LocalizationWritePlan {
  file: string;
  language: string;
  reason: string;
  currentValue: string;
  preview(value: string): string;
  apply(value: string): Promise<string>;
}

function relative(root: string, file: string): string {
  return path.relative(root, file).replace(/\\/g, "/");
}

/** Resolve once; the prompt, saved edit and undo destination use this same plan. */
export async function prepareLocalizationWrite(
  cfg: PxConfig,
  lookup: LocLookup,
  key: string,
  context: LocalizationWriteContext = {},
  interactive = false
): Promise<LocalizationWritePlan | undefined> {
  const project = new LocalizationProject(cfg);
  const language = context.language ?? project.defaults.language ?? cfg.locLanguage;
  const defs = (await lookup(key, language)).filter(
    (def) => locLanguage(def.file) === language || !locLanguage(def.file)
  );
  const root = cfg.modPath!;
  let sourcePath = context.sourcePath;
  if (sourcePath && path.isAbsolute(sourcePath)) {
    project.capture(sourcePath);
    sourcePath = containsPath(root, sourcePath)
      ? relative(root, sourcePath)
      : cfg.gamePath && containsPath(cfg.gamePath, sourcePath)
        ? relative(cfg.gamePath, sourcePath)
        : path.basename(sourcePath);
  }
  const roots = localizationRoots(cfg);
  const sourceStage = sourcePath?.split("/")[0];
  const matchingRoot = roots.find((folder) => folder.startsWith(`${sourceStage}/`));
  if (matchingRoot) roots.splice(0, 0, ...roots.splice(roots.indexOf(matchingRoot), 1));
  const subject = sourcePath?.split("/").slice(-2, -1)[0] ?? "mod";
  const fallback = context.fallbackPath
    ? path.isAbsolute(context.fallbackPath)
      ? relative(root, context.fallbackPath)
      : context.fallbackPath
    : undefined;
  const suggestion = suggestLocalizationTarget({
    key,
    language,
    documents: project.documents,
    locRoots: roots,
    defaults: project.defaults,
    sourcePath,
    relatedKeys: context.relatedKeys,
    subject,
    override:
      context.override ??
      defs.some(
        (def) =>
          def.source === "vanilla" || (cfg.parentPaths ?? []).some((parent) => containsPath(parent, def.file))
      ),
    fallbackPath: fallback,
  });
  let file = context.targetFile;
  if (!file && suggestion.candidates?.length) {
    if (!interactive)
      throw new Error(
        `Localization destination is ambiguous: ${suggestion.candidates.join(", ")}. Set a default or select a file.`
      );
    const selected = await vscode.window.showQuickPick(
      suggestion.candidates.map((candidate) => ({ label: candidate })),
      {
        title: `Choose localization file for ${key} (${language})`,
        placeHolder: suggestion.reason,
      }
    );
    if (!selected) return;
    file = path.join(root, selected.label);
  }
  file ??= path.join(root, suggestion.path);
  assertLocalizationPath(cfg, file, language);
  project.capture(file);
  let snapshot: DocumentSnapshot | undefined;
  if (fs.existsSync(file)) snapshot = await readDocument(file);
  const original = snapshot?.text ?? project.capture(file).text ?? "";
  const generated = generatedLocalizationSource(original);
  if (generated)
    throw new Error(`${path.basename(file)} is generated. Edit its source template instead. ${generated}`);
  // Validate before asking the user for text or creating any files.
  upsertLocalizationText(original, language, key, "", project.defaults.entryVersion);
  const current = locEntry(original.replace(/^\uFEFF/, "").split(/\r?\n/), key)?.parts[2];
  const targetFile = file;
  return {
    file: targetFile,
    language,
    reason: context.targetFile ? "selected file" : suggestion.reason,
    currentValue: current ?? defs[0]?.value ?? "",
    preview: (value) => upsertLocalizationText(original, language, key, value, project.defaults.entryVersion),
    async apply(value) {
      project.assertCurrent();
      assertLocalizationPath(cfg, targetFile, language);
      const destination = snapshot ?? (await readDocument(targetFile, true));
      project.assertCurrent(destination.created ? targetFile : undefined);
      assertLocalizationPath(cfg, targetFile, language);
      const text = upsertLocalizationText(
        destination.text,
        language,
        key,
        value,
        project.defaults.entryVersion
      );
      await writeDocument(destination, text, true);
      return targetFile;
    },
  };
}

/** Indexed line positions are hints. Only the requested key may be changed. */
export async function replaceLocLineValue(
  file: string,
  line: number,
  key: string,
  newValue: string
): Promise<boolean> {
  const language = locLanguage(file);
  if (!language) throw new Error("Localization files must end in _l_<language>.yml");
  const snapshot = await readDocument(file);
  if (!locEntry(snapshot.text.replace(/^\uFEFF/, "").split(/\r?\n/), key, line)) return false;
  const generated = generatedLocalizationSource(snapshot.text);
  if (generated)
    throw new Error(`This localization is generated. Edit its source template instead. ${generated}`);
  await writeDocument(snapshot, upsertLocalizationText(snapshot.text, language, key, newValue), true);
  return true;
}

export async function writeLocSmart(
  cfg: PxConfig,
  lookup: LocLookup,
  key: string,
  value: string,
  context?: string | LocalizationWriteContext
): Promise<string> {
  const plan = await prepareLocalizationWrite(
    cfg,
    lookup,
    key,
    typeof context === "string" ? { fallbackPath: context } : context
  );
  return plan!.apply(value);
}

export async function upsertNewModLoc(
  cfg: PxConfig,
  key: string,
  value: string,
  language?: string
): Promise<string> {
  return writeLocSmart(cfg, async () => [], key, value, { language });
}

export async function upsertInReplaceFile(
  cfg: PxConfig,
  key: string,
  value: string,
  language?: string
): Promise<string> {
  return writeLocSmart(cfg, async () => [], key, value, { language, override: true });
}

export async function locTargetFile(cfg: PxConfig, lookup: LocLookup, key: string): Promise<string | null> {
  if (!cfg.modPath) return null;
  return (await prepareLocalizationWrite(cfg, lookup, key))!.file;
}

export async function editLocalizationCommand(
  lookup: LocLookup,
  cfg: PxConfig,
  onLocFileChanged: (file: string) => void,
  arg: unknown
): Promise<void> {
  try {
    const key = await resolveKeyFromEditor(lookup, arg);
    if (!key) {
      void vscode.window.showWarningMessage(
        "Paradox Modding Toolkit: place the cursor on a localization key first."
      );
      return;
    }
    if (!cfg.modPath) {
      void vscode.window.showWarningMessage(
        "Paradox Modding Toolkit: choose a focused mod before writing localization."
      );
      return;
    }
    const target = localizationTarget(arg, effectiveLocConfig(cfg).locLanguage);
    const selected = target.file && containsPath(cfg.modPath, target.file) ? target.file : undefined;
    if (selected) {
      const snapshot = await readDocument(selected);
      if (!locEntry(snapshot.text.replace(/^\uFEFF/, "").split(/\r?\n/), key)) {
        void vscode.window.showWarningMessage(
          `Localization key "${key}" is no longer in ${path.basename(selected)}. Refresh the view and select it again.`
        );
        return;
      }
    }
    const source = targetUri(typeof arg === "string" ? undefined : arg);
    const context: LocalizationWriteContext = {
      language: target.language,
      targetFile: selected,
      sourcePath:
        source?.scheme === "file" && fs.existsSync(source.fsPath) && fs.statSync(source.fsPath).isFile()
          ? source.fsPath
          : undefined,
    };
    if (context.sourcePath && !locLanguage(context.sourcePath) && fs.existsSync(context.sourcePath)) {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(context.sourcePath));
      context.relatedKeys = document
        .getText()
        .split(/\r?\n/)
        .flatMap((line) => findLocKeyRefs(line).map((ref) => ref.key))
        .filter((ref) => ref !== key);
    }
    const plan = await prepareLocalizationWrite(cfg, lookup, key, context, true);
    if (!plan) return;
    const value = await vscode.window.showInputBox({
      title: `Localization: ${key} (${plan.language}, ${path.basename(cfg.modPath)})`,
      prompt: `Save to ${relative(cfg.modPath, plan.file)} (${plan.reason})`,
      value: plan.currentValue,
    });
    if (value === undefined) return;
    onLocFileChanged(await plan.apply(value));
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Paradox Modding Toolkit: failed to write localization: ${String(error)}`
    );
  }
}

export async function openLocalizationSideBySide(
  lookup: LocLookup,
  arg: unknown,
  cfg?: PxConfig
): Promise<void> {
  const key = await resolveKeyFromEditor(lookup, arg);
  if (!key) {
    void vscode.window.showWarningMessage(
      "Paradox Modding Toolkit: place the cursor on a localization key first."
    );
    return;
  }
  const target = localizationTarget(arg, cfg ? effectiveLocConfig(cfg).locLanguage : undefined);
  const defs = await lookup(key, target.language);
  const def = target.file
    ? { file: target.file, line: target.line }
    : (defs.find(
        (entry) =>
          cfg?.modPath &&
          containsPath(cfg.modPath, entry.file) &&
          (!target.language || locLanguage(entry.file) === target.language)
      ) ?? defs[0]);
  if (!def) {
    void vscode.window.showWarningMessage(
      `Paradox Modding Toolkit: no localization entry found for "${key}".`
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument(def.file);
  const line =
    locEntry(
      doc
        .getText()
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/),
      key,
      def.line
    )?.line ?? def.line;
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    selection: new vscode.Range(line, 0, line, doc.lineAt(Math.min(line, doc.lineCount - 1)).text.length),
  });
}
