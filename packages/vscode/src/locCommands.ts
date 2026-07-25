/**
 * Localization editing commands: an input-box flow that writes back to the yml
 * (preserving the UTF-8 BOM and the `:0` version suffix) and a side-by-side
 * view. Loc lookups go to the language server (ck3/lookupLoc); the file writes
 * stay client-side where the editor UX lives.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { Ck3Config } from "./config";
import type { LocEntryInfo } from "@paradox-lsp/protocol/protocol";
import { findLocKeyRefs, type LocKeyRef } from "@paradox-lsp/protocol/locRefs";

const BOM = "﻿";

export type LocLookup = (key: string) => Promise<LocEntryInfo[]>;

export function locKeyRefAt(document: vscode.TextDocument, position: vscode.Position): LocKeyRef | null {
  const refs = findLocKeyRefs(document.lineAt(position.line).text);
  return (
    refs.find((r) => position.character >= r.start - 1 && position.character <= r.end + 1) ?? refs[0] ?? null
  );
}

async function resolveKeyFromEditor(lookup: LocLookup, arg: unknown): Promise<string | null> {
  if (typeof arg === "string" && arg !== "") return arg;
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const ref = locKeyRefAt(editor.document, editor.selection.active);
  if (ref) return ref.key;
  // Fall back to the word under cursor if it is a known loc key.
  const range = editor.document.getWordRangeAtPosition(editor.selection.active);
  if (range) {
    const word = editor.document.getText(range);
    if ((await lookup(word)).length > 0) return word;
  }
  return null;
}

/** Read the full (untruncated) value of a loc entry straight from its file. */
function readLocValueFromFile(def: LocEntryInfo): string | null {
  try {
    const lines = fs.readFileSync(def.file, "utf8").split(/\r?\n/);
    const m = /^(\s*[^\s:#]+:\d*\s*")(.*)("[^"]*)$/.exec(lines[def.line] ?? "");
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

export function replaceLocLineValue(file: string, line: number, newValue: string): boolean {
  const buf = fs.readFileSync(file);
  const hadBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  let text = buf.toString("utf8");
  if (hadBom) text = text.replace(/^﻿/, "");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (line >= lines.length) return false;
  const m = /^(\s*[^\s:#]+:\d*\s*")(.*)("[^"]*)$/.exec(lines[line]);
  if (!m) return false;
  lines[line] = m[1] + escapeLocValue(newValue) + m[3];
  fs.writeFileSync(file, (hadBom ? BOM : "") + lines.join(eol), "utf8");
  return true;
}

function escapeLocValue(value: string): string {
  // Preserve already-escaped quotes; escape bare ones.
  return value.replace(/\\"/g, '"').replace(/"/g, '\\"');
}

/** The mod's replace file — reserved for OVERRIDING vanilla keys (game semantics). */
function modReplaceFile(cfg: Ck3Config, language?: string): string {
  const lang = language ?? cfg.locLanguage;
  return path.join(cfg.modPath!, "localization", "replace", lang, `zzz_ck3_modding_edits_l_${lang}.yml`);
}

export function upsertInReplaceFile(cfg: Ck3Config, key: string, value: string, language?: string): string {
  return upsertIntoYml(modReplaceFile(cfg, language), language ?? cfg.locLanguage, key, value);
}

/** Create-or-update `key` in a specific loc yml (BOM + `l_<lang>:` header kept). */
function upsertIntoYml(file: string, language: string, key: string, value: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let lines: string[];
  if (fs.existsSync(file)) {
    lines = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/);
  } else {
    lines = [`l_${language}:`, ""];
  }
  const entry = ` ${key}:0 "${escapeLocValue(value)}"`;
  const existing = lines.findIndex((l) =>
    new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\d*\\s*"`).test(l)
  );
  if (existing >= 0) lines[existing] = entry;
  else {
    while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push(entry, "");
  }
  fs.writeFileSync(file, BOM + lines.join("\n"), "utf8");
  return file;
}

/** All non-replace loc files of `language` in the mod. */
function modLocFiles(cfg: Ck3Config, language: string): string[] {
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
export function upsertNewModLoc(cfg: Ck3Config, key: string, value: string, language?: string): string {
  const lang = language ?? cfg.locLanguage;
  const files = modLocFiles(cfg, lang);
  const prefix = key.includes(".") ? key.slice(0, key.indexOf(".") + 1) : key.split("_")[0] + "_";
  const prefixRe = new RegExp(
    `^\\s*${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[A-Za-z0-9_.\\-]*:\\d*\\s*"`
  );

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
  const target =
    best ??
    largest ??
    path.join(
      cfg.modPath!,
      "localization",
      lang,
      `${sanitizeName(path.basename(cfg.modPath!))}_l_${lang}.yml`
    );
  return upsertIntoYml(target, lang, key, value);
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
 * brand-new key → the right mod loc file (upsertNewModLoc).
 */
export async function writeLocSmart(
  cfg: Ck3Config,
  lookup: LocLookup,
  key: string,
  value: string
): Promise<string> {
  const defs = await lookup(key);
  const modDef = defs.find((d) => d.source === "mod");
  if (modDef && replaceLocLineValue(modDef.file, modDef.line, value)) return modDef.file;
  if (defs.length > 0) return upsertInReplaceFile(cfg, key, value);
  return upsertNewModLoc(cfg, key, value);
}

export async function editLocalizationCommand(
  lookup: LocLookup,
  cfg: Ck3Config,
  onLocFileChanged: (file: string) => void,
  arg: unknown
): Promise<void> {
  const key = await resolveKeyFromEditor(lookup, arg);
  if (!key) {
    void vscode.window.showWarningMessage("CK3: place the cursor on a localization key first.");
    return;
  }
  if (!cfg.modPath) {
    void vscode.window.showWarningMessage("CK3: no mod folder (open one or set ck3.modPath).");
    return;
  }

  const defs = await lookup(key);
  const modDef = defs.find((d) => d.source === "mod");
  const currentValue = modDef ? (readLocValueFromFile(modDef) ?? modDef.value ?? "") : (defs[0]?.value ?? "");

  const newValue = await vscode.window.showInputBox({
    title: `Localization: ${key}`,
    prompt: modDef
      ? `Edit ${path.basename(modDef.file)}`
      : defs.length > 0
        ? "Vanilla key: your text will be written to the mod's localization/replace override file"
        : "New key: will be added to the mod loc file where its siblings live",
    value: currentValue,
  });
  if (newValue === undefined) return; // cancelled

  try {
    const file = await writeLocSmart(cfg, lookup, key, newValue);
    onLocFileChanged(file);
  } catch (err) {
    void vscode.window.showErrorMessage(`CK3: failed to write localization: ${String(err)}`);
  }
}

export async function openLocalizationSideBySide(lookup: LocLookup, arg: unknown): Promise<void> {
  const key = await resolveKeyFromEditor(lookup, arg);
  if (!key) {
    void vscode.window.showWarningMessage("CK3: place the cursor on a localization key first.");
    return;
  }
  const def = (await lookup(key))[0];
  if (!def) {
    void vscode.window.showWarningMessage(`CK3: no localization entry found for "${key}".`);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(def.file);
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    selection: new vscode.Range(
      def.line,
      0,
      def.line,
      doc.lineAt(Math.min(def.line, doc.lineCount - 1)).text.length
    ),
  });
}
