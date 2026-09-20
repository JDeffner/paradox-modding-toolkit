import * as vscode from "vscode";
import { isScriptLang } from "./langIds";
import { EVENT_ID } from "@px-lsp/server/index/indexer";

/** Context menus resolve the cursor without building a dependency graph on every selection. */
export function registerDefinitionContext(context: vscode.ExtensionContext): void {
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const set = async (definition: boolean, event: boolean) => {
    await vscode.commands.executeCommand("setContext", "px.definitionAtCursor", definition);
    await vscode.commands.executeCommand("setContext", "px.eventAtCursor", event);
  };
  const refresh = () => {
    const current = ++revision;
    clearTimeout(timer);
    void set(false, false);
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isScriptLang(editor.document.languageId)) return;
    const { document } = editor;
    const position = editor.selection.active;
    const range = document.getWordRangeAtPosition(position, /[A-Za-z0-9_.-]+/);
    if (!range) return;
    const word = document.getText(range);
    timer = setTimeout(() => {
      void vscode.commands
        .executeCommand<(vscode.Location | vscode.LocationLink)[]>(
          "vscode.executeDefinitionProvider",
          document.uri,
          position
        )
        .then(
          (locations) => {
            if (revision === current)
              void set(!!locations?.length, !!locations?.length && EVENT_ID.test(word));
          },
          (error: unknown) => {
            if (revision === current)
              console.warn("PX Toolkit: definition context could not be resolved", error);
          }
        );
    }, 200);
  };
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(refresh),
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === vscode.window.activeTextEditor?.document) refresh();
    }),
    {
      dispose: () => {
        ++revision;
        clearTimeout(timer);
      },
    }
  );
  refresh();
}
