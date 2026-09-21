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
import { targetPosition, targetUri, containsPath, samePath } from "./commandTargets";
import { findLocKeyRefs, locKeyOnLine, type LocKeyRef } from "@px-lsp/protocol/locRefs";
import { escapeRegExp } from "@px-lsp/protocol/regex";
import { isScriptLang } from "./langIds";
import { isCk3 } from "./meta";

const BOM = "﻿";

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

export function registerLocalizationContext(context: vscode.ExtensionContext, lookup: LocLookup): void {
  let revision = 0;
  const update = async () => {
    const current = ++revision;
    const editor = vscode.window.activeTextEditor;
    const supported =
      editor && (editor.document.languageId === "paradox-loc" || isScriptLang(editor.document.languageId));
    const key = supported ? await resolveKeyFromEditor(lookup) : null;
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
  };
  const refresh = () => {
    void update().catch(() => undefined);
  };
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(refresh),
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.commands.registerCommand("px.copyLocalizationKey", async (arg?: unknown) => {
      const key = await resolveKeyFromEditor(lookup, arg);
      if (key) await vscode.env.clipboard.writeText(key);
    })
  );
  refresh();
}

/** Read the full value by key, including changes not yet saved in the editor. */
async function readLocValueFromFile(def: LocEntryInfo, key: string): Promise<string | null> {
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(def.file));
    const match = locEntry(
      doc
        .getText()
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/),
      key,
      def.line
    );
    return match?.parts[2] ?? null;
  } catch {
    return null;
  }
}

function locEntry(lines: string[], key: string, hint?: number) {
  const pattern = new RegExp(`^(\\s*${escapeRegExp(key)}:\\d*\\s*")(.*)("[^"]*)$`);
  const line =
    hint !== undefined && pattern.test(lines[hint] ?? "") ? hint : lines.findIndex((l) => pattern.test(l));
  const parts = pattern.exec(lines[line] ?? "");
  return parts ? { line, parts } : null;
}

/** Indexed positions are hints: only the requested key may be replaced. */
export async function replaceLocLineValue(
  file: string,
  line: number,
  key: string,
  newValue: string
): Promise<boolean> {
  return editLocDocument(file, key, (lines) => {
    const entry = locEntry(lines, key, line);
    if (!entry) return false;
    lines[entry.line] = entry.parts[1] + escapeLocValue(newValue) + entry.parts[3];
    return true;
  });
}

/** All loc writes use the editor's current text and save as UTF-8 with BOM. */
async function editLocDocument(
  file: string,
  key: string,
  update: (lines: string[]) => boolean
): Promise<boolean> {
  // Same key alphabet as the localization parser, including apostrophes.
  if (!/^[A-Za-z0-9_.\-']+$/.test(key)) throw new Error("Invalid localization key");
  const language = /_l_([a-z_]+)\.yml$/i.exec(file)?.[1];
  if (!language) throw new Error("Localization files must end in _l_<language>.yml");
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const original = doc.getText();
  const lines = original.replace(/^\uFEFF/, "").split(/\r?\n/);
  const header = lines.find((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  if (!header || !new RegExp(`^[ \\t]*l_${language}:[ \\t]*(?:#.*)?$`).test(header)) {
    throw new Error(`Localization file needs an l_${language}: header`);
  }
  if (!update(lines)) return false;
  // VS Code 1.91 does not expose TextDocument.encoding. On those hosts the
  // existing UTF-8 BOM tells us whether the encoder adds it outside getText().
  const encoding =
    doc.encoding ??
    (original.startsWith(BOM) ? "utf8" : fs.readFileSync(file, "utf8").startsWith(BOM) ? "utf8bom" : "utf8");
  if (encoding !== "utf8" && encoding !== "utf8bom")
    throw new Error("Save localization as UTF-8 before editing it");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const text = (encoding === "utf8bom" ? "" : BOM) + lines.join(eol);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(original.length)), text);
  if (!(await vscode.workspace.applyEdit(edit))) throw new Error("Localization edit was rejected");
  if (!(await doc.save())) throw new Error("Localization file could not be saved");
  return true;
}

function escapeLocValue(value: string): string {
  // Preserve already-escaped quotes; escape bare ones.
  // Vanilla localization (for example ai_personality_l_english.yml) uses
  // literal \\n for displayed line breaks, never physical multiline values.
  return value
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/\\"/g, '"')
    .replace(/"/g, '\\"');
}

/**
 * The mod's replace file, reserved for OVERRIDING vanilla keys (game
 * semantics). The default profile keeps the file name it has always written, so
 * no existing mod grows a second edits file; other games get the neutral name,
 * and an existing legacy file still wins so a mod never ends up with both.
 */
function modReplaceFile(cfg: PxConfig, language?: string): string {
  const lang = language ?? cfg.locLanguage;
  const dir = path.join(cfg.modPath!, "localization", "replace", lang);
  const legacy = path.join(dir, `zzz_ck3_modding_edits_l_${lang}.yml`);
  if (isCk3(cfg.gameId) || fs.existsSync(legacy)) return legacy;
  return path.join(dir, `zzz_px_edits_l_${lang}.yml`);
}

export async function upsertInReplaceFile(
  cfg: PxConfig,
  key: string,
  value: string,
  language?: string
): Promise<string> {
  return upsertIntoYml(modReplaceFile(cfg, language), language ?? cfg.locLanguage, key, value);
}

/** Create-or-update `key` in a specific loc yml (BOM + `l_<lang>:` header kept). */
async function upsertIntoYml(file: string, language: string, key: string, value: string): Promise<string> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${BOM}l_${language}:\n`, "utf8");
  await editLocDocument(file, key, (lines) => {
    const existing = locEntry(lines, key);
    if (existing) lines[existing.line] = existing.parts[1] + escapeLocValue(value) + existing.parts[3];
    else {
      while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
      lines.push(` ${key}:0 "${escapeLocValue(value)}"`, "");
    }
    return true;
  });
  return file;
}

/** All non-replace loc files of `language` in the mod. */
function modLocFiles(cfg: PxConfig, language: string): string[] {
  const root = path.join(cfg.modPath!, "localization");
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.toLowerCase() !== "replace") walk(full);
      } else if (e.name.toLowerCase().endsWith(`_l_${language}.yml`)) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Where a BRAND-NEW key belongs: the mod loc file already holding the most
 * keys with the same prefix (`myns.1.t` → `myns.`, `my_decision_desc` →
 * `my_`), else the mod's largest loc file, else a fresh `<modname>_l_<lang>.yml`.
 * `localization/replace/` is reserved for overriding vanilla keys — new keys
 * there would only clutter the mod layout.
 */
export async function upsertNewModLoc(
  cfg: PxConfig,
  key: string,
  value: string,
  language?: string
): Promise<string> {
  const lang = language ?? cfg.locLanguage;
  return upsertIntoYml(newModLocFile(cfg, key, lang), lang, key, value);
}

/** The pick {@link upsertNewModLoc} writes into, resolved without writing. */
function newModLocFile(cfg: PxConfig, key: string, lang: string): string {
  const files = modLocFiles(cfg, lang);
  const prefix = key.includes(".") ? key.slice(0, key.indexOf(".") + 1) : key.split("_")[0] + "_";
  const prefixRe = new RegExp(`^\\s*${escapeRegExp(prefix)}[A-Za-z0-9_.\\-]*:\\d*\\s*"`);

  let best: string | null = null;
  let bestCount = 0;
  let largest: string | null = null;
  let largestSize = -1;
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const count = text.split(/\r?\n/).filter((l) => prefixRe.test(l)).length;
    if (count > bestCount) {
      bestCount = count;
      best = file;
    }
    if (text.length > largestSize) {
      largestSize = text.length;
      largest = file;
    }
  }
  return (
    best ??
    largest ??
    path.join(
      cfg.modPath!,
      "localization",
      lang,
      `${sanitizeName(path.basename(cfg.modPath!))}_l_${lang}.yml`
    )
  );
}

function sanitizeName(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "mod";
}

/**
 * The one entry point for writing a loc value: mod entry → rewrite in place;
 * vanilla-only key → the replace file (that IS the override mechanism);
 * brand-new key → the right mod loc file (upsertNewModLoc), or `newKeyFile`
 * when the caller knows where the key's siblings belong (a creator names the
 * loc file after the script file it just wrote, so a modder finds the trait's
 * name next to the trait and not in whichever file happened to be largest).
 */
export async function writeLocSmart(
  cfg: PxConfig,
  lookup: LocLookup,
  key: string,
  value: string,
  newKeyFile?: string
): Promise<string> {
  const defs = await lookup(key, cfg.locLanguage);
  const modDef = defs.find(
    (d) =>
      d.source === "mod" &&
      cfg.modPath &&
      containsPath(cfg.modPath, d.file) &&
      locLanguage(d.file) === cfg.locLanguage
  );
  if (modDef) {
    if (await replaceLocLineValue(modDef.file, modDef.line, key, value)) return modDef.file;
    return upsertIntoYml(modDef.file, cfg.locLanguage, key, value);
  }
  if (defs.some((d) => d.source === "vanilla")) return upsertInReplaceFile(cfg, key, value);
  if (newKeyFile) return upsertIntoYml(newKeyFile, cfg.locLanguage, key, value);
  return upsertNewModLoc(cfg, key, value);
}

/**
 * Which file {@link writeLocSmart} will write `key` into, resolved WITHOUT
 * writing: the same three branches, over the same pickers. A panel that offers
 * undo needs the file's pre-image, and only this can say which file that is
 * before the write happens.
 */
export async function locTargetFile(cfg: PxConfig, lookup: LocLookup, key: string): Promise<string | null> {
  if (!cfg.modPath) return null;
  const defs = await lookup(key, cfg.locLanguage);
  const modDef = defs.find(
    (d) =>
      d.source === "mod" &&
      cfg.modPath &&
      containsPath(cfg.modPath, d.file) &&
      locLanguage(d.file) === cfg.locLanguage
  );
  if (modDef) return modDef.file;
  if (defs.some((d) => d.source === "vanilla")) return modReplaceFile(cfg);
  return newModLocFile(cfg, key, cfg.locLanguage);
}

export async function editLocalizationCommand(
  lookup: LocLookup,
  cfg: PxConfig,
  onLocFileChanged: (file: string) => void,
  arg: unknown
): Promise<void> {
  const key = await resolveKeyFromEditor(lookup, arg);
  if (!key) {
    void vscode.window.showWarningMessage(
      "Paradox Modding Toolkit: place the cursor on a localization key first."
    );
    return;
  }
  if (!cfg.modPath) {
    void vscode.window.showWarningMessage(
      "Paradox Modding Toolkit: no mod folder found. Open your mod folder (the one with the mod's descriptor) as a workspace folder."
    );
    return;
  }

  const target = localizationTarget(arg, cfg.locLanguage);
  cfg = { ...cfg, locLanguage: target.language! };
  const selectedFile = target.file;
  if (
    selectedFile &&
    containsPath(cfg.modPath!, selectedFile) &&
    (await readLocValueFromFile({ file: selectedFile, line: target.line, source: "mod" }, key)) === null
  ) {
    void vscode.window.showWarningMessage(
      `Localization key "${key}" is no longer in ${path.basename(selectedFile)}. Refresh the view and select it again.`
    );
    return;
  }
  const scopedLookup: LocLookup = async (name, language) => {
    const entries = await lookup(name, language);
    if (!selectedFile || !containsPath(cfg.modPath!, selectedFile)) return entries;
    return [
      { file: selectedFile, line: target.line, source: "mod" },
      ...entries.filter((entry) => !samePath(entry.file, selectedFile)),
    ];
  };
  const defs = await scopedLookup(key, cfg.locLanguage);
  const modDef = defs.find(
    (d) =>
      d.source === "mod" &&
      cfg.modPath &&
      containsPath(cfg.modPath, d.file) &&
      locLanguage(d.file) === cfg.locLanguage
  );
  const currentValue = modDef ? ((await readLocValueFromFile(modDef, key)) ?? "") : (defs[0]?.value ?? "");

  const newValue = await vscode.window.showInputBox({
    title: `Localization: ${key} (${cfg.locLanguage}, save to ${path.basename(cfg.modPath!)})`,
    prompt: modDef
      ? `Edit ${path.basename(modDef.file)}`
      : defs.some((d) => d.source === "vanilla")
        ? "Vanilla key: your text will be written to the mod's localization/replace override file"
        : "New key: will be added to the mod loc file where its siblings live",
    value: currentValue,
  });
  if (newValue === undefined) return; // cancelled

  try {
    const file = await writeLocSmart(cfg, scopedLookup, key, newValue);
    onLocFileChanged(file);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Paradox Modding Toolkit: failed to write localization: ${String(err)}`
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
  const target = localizationTarget(arg, cfg?.locLanguage);
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
