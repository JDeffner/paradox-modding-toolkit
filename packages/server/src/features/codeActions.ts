/**
 * Code actions on loc-key references in script: edit the localization value
 * (quick fix) and open the yml side-by-side. The actions carry client-side
 * commands — the file writes happen in the client, which owns the editor UX.
 */
import { CodeActionKind, type CodeAction, type Diagnostic, type Range } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { ServerData } from "../serverData";
import { findLocKeyRefs, type LocKeyRef } from "@px-lsp/protocol/locRefs";
import { clientCommands } from "@px-lsp/protocol/protocol";
import { getLineText } from "../documents";
import { activeProfile } from "../games/active";

export function locKeyRefAt(lineText: string, character: number): LocKeyRef | null {
  const refs = findLocKeyRefs(lineText);
  return refs.find((r) => character >= r.start - 1 && character <= r.end + 1) ?? refs[0] ?? null;
}

export function provideCodeActions(
  data: ServerData,
  document: TextDocument,
  range: Range,
  diagnostics: Diagnostic[]
): CodeAction[] {
  const actions: CodeAction[] = [];

  // Quick fix on missing-required-loc diagnostics: create the key in place.
  for (const d of diagnostics) {
    if (d.code !== "missing-required-loc") continue;
    const key = (d.data as { key?: string } | undefined)?.key;
    if (!key) continue;
    actions.push({
      title: `${activeProfile().shortName}: Create localization key "${key}"`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [d],
      command: { command: clientCommands.editLocalization, title: "Create localization", arguments: [key] },
    });
  }

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
