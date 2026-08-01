/**
 * Code actions on loc-key references in script. For the VSCode client
 * (initializationOptions.clientCommands) they carry client-side commands —
 * the file writes happen in the client, which owns the editor UX. For plain
 * LSP clients the create-key quick fix carries a real WorkspaceEdit instead,
 * and the two editor-command actions are omitted rather than shipped dead.
 */
import {
  CodeActionKind,
  CreateFile,
  TextDocumentEdit,
  type CodeAction,
  type Diagnostic,
  type Range,
  type WorkspaceEdit,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import * as fs from "fs";
import * as path from "path";
import { URI } from "vscode-uri";
import type { ServerData } from "../serverData";
import { findLocKeyRefs, type LocKeyRef } from "@px-lsp/protocol/locRefs";
import { clientCommands } from "@px-lsp/protocol/protocol";
import { getLineText } from "../documents";
import { activeProfile } from "../games/active";
import { commandCapableClient } from "../clientMode";

export function locKeyRefAt(lineText: string, character: number): LocKeyRef | null {
  const refs = findLocKeyRefs(lineText);
  return refs.find((r) => character >= r.start - 1 && character <= r.end + 1) ?? refs[0] ?? null;
}

/** Context for the plain-client WorkspaceEdit fallback. */
export interface LocEditContext {
  locLanguage: string;
  /** Workspace-mod root of a file, or null (vanilla/parent files get no edit). */
  modRootOf: (fsPath: string) => string | null;
  /** Mod-relative localization root(s) from the loc_key schema entries. */
  locRoots: string[];
}

/**
 * A WorkspaceEdit that appends `key: ""` to the server-managed loc file
 * (creating it, BOM included, when absent). Only one writer is ever active
 * per session: the VSCode client owns its own zzz_*_edits file (via the
 * px.editLocalization command) and never sees this fallback, so the two
 * files can coexist without fighting.
 */
export function locCreateEdit(key: string, docFsPath: string, ctx: LocEditContext): WorkspaceEdit | null {
  const modRoot = ctx.modRootOf(docFsPath);
  if (!modRoot) return null;
  const lang = ctx.locLanguage;
  const locRoot = ctx.locRoots[0] ?? "localization";
  const target = path.join(modRoot, locRoot, lang, `zzz_px_lsp_edits_l_${lang}.yml`);
  const uri = URI.file(target).toString();
  const entryLine = ` ${key}: ""`;
  let content: string | null = null;
  try {
    content = fs.readFileSync(target, "utf8");
  } catch {
    content = null;
  }
  if (content === null) {
    return {
      documentChanges: [
        CreateFile.create(uri, { ignoreIfExists: true }),
        TextDocumentEdit.create({ uri, version: null }, [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            newText: "﻿" + `l_${lang}:\n${entryLine}\n`,
          },
        ]),
      ],
    };
  }
  const endLine = content.split("\n").length;
  const needsNewline = content.length > 0 && !content.endsWith("\n");
  return {
    documentChanges: [
      TextDocumentEdit.create({ uri, version: null }, [
        {
          range: { start: { line: endLine, character: 0 }, end: { line: endLine, character: 0 } },
          newText: `${needsNewline ? "\n" : ""}${entryLine}\n`,
        },
      ]),
    ],
  };
}

export function provideCodeActions(
  data: ServerData,
  document: TextDocument,
  range: Range,
  diagnostics: Diagnostic[],
  locEditContext?: LocEditContext
): CodeAction[] {
  const actions: CodeAction[] = [];
  const rich = commandCapableClient();

  // Quick fix on missing-required-loc diagnostics: create the key in place.
  for (const d of diagnostics) {
    if (d.code !== "missing-required-loc") continue;
    const key = (d.data as { key?: string } | undefined)?.key;
    if (!key) continue;
    const title = `${activeProfile().shortName}: Create localization key "${key}"`;
    if (rich) {
      actions.push({
        title,
        kind: CodeActionKind.QuickFix,
        diagnostics: [d],
        command: { command: clientCommands.editLocalization, title: "Create localization", arguments: [key] },
      });
    } else if (locEditContext) {
      const edit = locCreateEdit(key, URI.parse(document.uri).fsPath, locEditContext);
      if (edit) actions.push({ title, kind: CodeActionKind.QuickFix, diagnostics: [d], edit });
    }
  }

  // The two editor-command actions exist only for clients that register the
  // px.* commands; elsewhere they would render and silently do nothing.
  if (!rich) return actions;

  const ref = locKeyRefAt(getLineText(document, range.start.line), range.start.character);
  if (!ref) return actions;

  actions.push({
    title: `${activeProfile().shortName}: Edit localization for "${ref.key}"`,
    kind: CodeActionKind.QuickFix,
    command: { command: clientCommands.editLocalization, title: "Edit localization", arguments: [ref.key] },
  });

  if (data.index.lookup(ref.key).some((d) => d.kind === "loc_key")) {
    actions.push({
      title: `${activeProfile().shortName}: Open localization side by side`,
      kind: CodeActionKind.Empty,
      command: {
        command: clientCommands.openLocalizationSideBySide,
        title: "Open localization side by side",
        arguments: [ref.key],
      },
    });
  }
  return actions;
}
