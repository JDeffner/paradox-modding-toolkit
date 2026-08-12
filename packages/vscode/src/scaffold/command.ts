/**
 * `Paradox: New Content…` — a quick-pick + input-box flow that materializes a
 * ScaffoldResult onto disk. Each generated file lands in the correct folder with
 * the correct encoding (BOM per template flag), and existing files are APPENDED
 * to (never blindly overwritten) so the flow can't create the silent-failure
 * class it exists to prevent.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { PxConfig } from "../config";
import { escapeRegExp } from "@px-lsp/protocol/regex";
import type { ScaffoldTemplate } from "@px-lsp/server/games/profile";
import { renderScaffold, type ScaffoldFile, type ScaffoldResult } from "./templates";
import { metaFor } from "../meta";

const BOM = "﻿";

/** Remembers the last-used prefix within a session so repeat scaffolds are quick. */
let lastPrefix: string | null = null;

const PREFIX_RE = /^[a-z][a-z0-9_]*$/;

function sanitizePrefix(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "mymod";
}

interface KindItem extends vscode.QuickPickItem {
  template: ScaffoldTemplate;
}

async function pickKind(templates: ScaffoldTemplate[]): Promise<ScaffoldTemplate | undefined> {
  const items: KindItem[] = templates.map((template) => ({
    template,
    label: template.label,
    detail: template.detail,
  }));
  const pick = await vscode.window.showQuickPick<KindItem>(items, {
    title: "New Content",
    placeHolder: "What do you want to create?",
  });
  return pick?.template;
}

const IDENTIFIER_HINT = "Use lowercase letters, digits and _, starting with a letter (e.g. my_mod).";

async function askPrefix(cfg: PxConfig): Promise<string | undefined> {
  const fallback = cfg.modPath ? sanitizePrefix(path.basename(cfg.modPath)) : "mymod";
  const value = lastPrefix ?? fallback;
  const prefix = await vscode.window.showInputBox({
    title: "New Content — mod prefix",
    prompt: "Mod prefix for filenames and the event namespace (lowercase, letters/digits/_).",
    value,
    validateInput: (v) => (PREFIX_RE.test(v.trim()) ? null : IDENTIFIER_HINT),
  });
  if (prefix === undefined) return undefined;
  lastPrefix = prefix.trim();
  return lastPrefix;
}

async function askEventId(prefix: string): Promise<string | undefined> {
  const re = new RegExp(`^${escapeRegExp(prefix)}\\.\\d+$`);
  return vscode.window.showInputBox({
    title: "New Event — id",
    prompt: `Event id (must be ${prefix}.<number>).`,
    value: `${prefix}.1`,
    validateInput: (v) => (re.test(v.trim()) ? null : `Event id must be ${prefix}.<number>`),
  });
}

async function askName(prefix: string, label: string): Promise<string | undefined> {
  const re = /^[a-z][a-z0-9_]*$/;
  const display = label.charAt(0).toUpperCase() + label.slice(1);
  return vscode.window.showInputBox({
    title: `New ${display} — name`,
    prompt: `${display} key (lowercase, letters/digits/_).`,
    value: `${prefix}_${label.replace(/[^a-z]+/g, "_")}`,
    validateInput: (v) => (re.test(v.trim()) ? null : IDENTIFIER_HINT),
  });
}

/** The template's own choices (this game's vanilla on_actions), plus a way out. */
async function askFromPicks(template: ScaffoldTemplate): Promise<string | undefined> {
  const items: vscode.QuickPickItem[] = [
    ...(template.picks ?? []).map((a) => ({ label: a })),
    { label: "$(edit) Other…", detail: `Type another ${template.nameLabel} name` },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: "New Hook",
    placeHolder: `Pick the ${template.nameLabel} to hook into`,
  });
  if (!pick) return undefined;
  if (pick.label.startsWith("$(edit)")) {
    return vscode.window.showInputBox({
      title: `New Hook: ${template.nameLabel}`,
      prompt: `Name of the ${template.nameLabel} (e.g. ${template.picks?.[0] ?? "on_something"}).`,
      validateInput: (v) => (/^on_[a-z0-9_]+$/.test(v.trim()) ? null : "Expected an on_<name> identifier"),
    });
  }
  return pick.label;
}

/** What `$NAME$` becomes: a fixed choice, an event id, or a plain identifier. */
async function askTemplateName(template: ScaffoldTemplate, prefix: string): Promise<string | undefined> {
  if (template.picks && template.picks.length > 0) return askFromPicks(template);
  if (template.nameKind === "eventId") return askEventId(prefix);
  return askName(prefix, template.nameLabel);
}

/** Detect a UTF-8 BOM on the first three bytes of an existing file. */
function fileHasBom(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

interface WriteOutcome {
  absPath: string;
  action: "created" | "appended" | "skipped";
  /** Line offset added to a template-relative cursor line for appended files. */
  cursorLineOffset: number;
}

function materializeFile(modPath: string, file: ScaffoldFile): WriteOutcome {
  const absPath = path.join(modPath, ...file.relPath.split("/"));

  if (fs.existsSync(absPath)) {
    if (!file.appendIfExists) {
      return { absPath, action: "skipped", cursorLineOffset: 0 };
    }
    const buf = fs.readFileSync(absPath);
    const hadBom = fileHasBom(buf);
    let existing = buf.toString("utf8");
    if (hadBom) existing = existing.replace(/^﻿/, "");
    const eol = existing.includes("\r\n") ? "\r\n" : "\n";

    // The game requires event files to START with their namespace line; an
    // existing file without it would silently drop the appended event.
    if (file.requiredHeader) {
      const norm = (s: string) => s.trim().replace(/\s+/g, " ");
      const firstCode = existing.split(/\r?\n/).find((l) => l.trim() !== "" && !l.trim().startsWith("#"));
      if (norm(firstCode ?? "") !== norm(file.requiredHeader)) {
        existing = file.requiredHeader + eol + eol + existing;
      }
    }

    const block = (file.appendContent ?? file.content).replace(/\n/g, eol);
    // A leading blank line separates the appended block; count offset lines so the
    // caller can translate a template-relative cursor to the real line.
    const trimmedExisting = existing.replace(/\r?\n+$/, "");
    const prefixText = trimmedExisting + eol + eol;
    const cursorLineOffset = prefixText.split(eol).length - 1;
    const combined = prefixText + block;
    fs.writeFileSync(absPath, (hadBom || file.bom ? BOM : "") + combined, "utf8");
    return { absPath, action: "appended", cursorLineOffset };
  }

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const eol = process.platform === "win32" ? "\r\n" : "\n";
  const body = file.content.replace(/\n/g, eol);
  fs.writeFileSync(absPath, (file.bom ? BOM : "") + body, "utf8");
  return { absPath, action: "created", cursorLineOffset: 0 };
}

async function materialize(
  result: ScaffoldResult,
  cfg: PxConfig,
  onFileChanged: (fsPath: string) => void
): Promise<void> {
  const created: string[] = [];
  const appended: string[] = [];
  const skipped: string[] = [];
  let cursorTarget: { absPath: string; line: number; character: number } | null = null;

  for (const file of result.files) {
    const outcome = materializeFile(cfg.modPath!, file);
    onFileChanged(outcome.absPath);
    if (outcome.action === "created") created.push(file.relPath);
    else if (outcome.action === "appended") appended.push(file.relPath);
    else skipped.push(file.relPath);

    if (file.relPath === result.cursor.relPath && outcome.action !== "skipped") {
      cursorTarget = {
        absPath: outcome.absPath,
        line: result.cursor.line + outcome.cursorLineOffset,
        character: result.cursor.character,
      };
    }
  }

  if (cursorTarget) {
    const doc = await vscode.workspace.openTextDocument(cursorTarget.absPath);
    const line = Math.min(cursorTarget.line, Math.max(0, doc.lineCount - 1));
    const pos = new vscode.Position(line, cursorTarget.character);
    await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos) });
  }

  const parts: string[] = [];
  if (created.length) parts.push(`created ${created.join(", ")}`);
  if (appended.length) parts.push(`appended to ${appended.join(", ")}`);
  if (skipped.length) parts.push(`skipped existing ${skipped.join(", ")}`);
  if (skipped.length && !created.length && !appended.length) {
    void vscode.window.showWarningMessage(`Paradox Modding Toolkit: ${parts.join("; ")}.`);
  } else {
    void vscode.window.showInformationMessage(`Paradox Modding Toolkit: ${parts.join("; ")}.`);
  }
}

export async function newContentCommand(
  cfg: PxConfig,
  onFileChanged: (fsPath: string) => void
): Promise<void> {
  if (!cfg.modPath) {
    void vscode.window.showWarningMessage(
      "Paradox Modding Toolkit: no mod folder found. Open your mod folder (the one with the mod's descriptor) as a workspace folder."
    );
    return;
  }

  const meta = metaFor(cfg.gameId);
  const templates = meta.scaffolds ?? [];
  if (templates.length === 0) {
    void vscode.window.showWarningMessage(
      `Paradox Modding Toolkit: no content templates are verified for ${meta.name} yet, ` +
        `so this command would only guess at the game's own file shapes.`
    );
    return;
  }

  const template = await pickKind(templates);
  if (!template) return;

  const prefix = await askPrefix(cfg);
  if (!prefix) return;

  const name = await askTemplateName(template, prefix);
  if (!name) return;

  const result: ScaffoldResult = renderScaffold(template, {
    prefix,
    name: name.trim(),
    locLanguage: cfg.locLanguage,
    stageRoot: meta.stageRoots?.[0],
  });

  try {
    await materialize(result, cfg, onFileChanged);
  } catch (err) {
    void vscode.window.showErrorMessage(`Paradox Modding Toolkit: failed to create content: ${String(err)}`);
  }
}
