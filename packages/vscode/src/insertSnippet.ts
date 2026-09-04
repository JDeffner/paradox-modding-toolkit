/**
 * `Paradox: Insert Snippet` — a quick pick over everything the server can offer
 * to insert at the cursor (paradox/snippets), inserted as a VS Code snippet so
 * its tabstops are live.
 *
 * The list is not a table in this file: the server measures the definition
 * skeletons over the game's own files and renders the engine block templates
 * from the game's own usage examples. This command only draws them and hands
 * the chosen one to the editor.
 */
import * as vscode from "vscode";
import { snippetsRequest, type SnippetItem, type SnippetsResult } from "@px-lsp/protocol/protocol";

/** The picker's group headers, in the order the server returns the forms. */
const FORM_LABEL: Record<SnippetItem["form"], string> = {
  definition: "Definition",
  block: "Blocks",
  token: "Engine blocks",
};

interface SnippetPick extends vscode.QuickPickItem {
  item?: SnippetItem;
}

export async function insertSnippetCommand(
  send: <R>(method: string, params: unknown) => Promise<R>
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("Insert Snippet: open a Paradox script file first.");
    return;
  }
  const result = await send<SnippetsResult>(snippetsRequest, {
    uri: editor.document.uri.toString(),
    position: {
      line: editor.selection.active.line,
      character: editor.selection.active.character,
    },
  });
  if (result.snippets.length === 0) {
    void vscode.window.showInformationMessage(
      "Insert Snippet: no snippet applies here. Skeletons come from the game's own files, " +
        "so this needs a script file in a folder the schema knows."
    );
    return;
  }

  const picks: SnippetPick[] = [];
  let group: string | null = null;
  for (const item of result.snippets) {
    if (FORM_LABEL[item.form] !== group) {
      group = FORM_LABEL[item.form];
      picks.push({ label: group, kind: vscode.QuickPickItemKind.Separator });
    }
    picks.push({ label: item.label, detail: item.detail, item });
  }
  const chosen = await vscode.window.showQuickPick(picks, {
    title: "Insert Snippet",
    placeHolder: "What do you want to insert here?",
    matchOnDetail: true,
  });
  if (!chosen?.item) return;
  await editor.insertSnippet(new vscode.SnippetString(chosen.item.snippet));
}
