import * as vscode from "vscode";
import { targetUri, writableRoot } from "./commandTargets";
import type { PxConfig } from "./config";
import { isScriptLang, PARADOX_SCRIPT_LANGS } from "./langIds";

const SAVE_WITH_BOM = "px.saveWithUtf8Bom";

function canFix(document: vscode.TextDocument, cfg: PxConfig): boolean {
  return (
    !!writableRoot(document.uri, cfg) &&
    ((isScriptLang(document.languageId) && document.uri.path.toLowerCase().endsWith(".txt")) ||
      document.languageId === "paradox-loc")
  );
}

async function chooseEncoding(document: vscode.TextDocument): Promise<void> {
  // VS Code exposes encoding changes through this picker, not a save-encoding
  // API. It keeps the encoder and undo history consistent for dirty files too.
  await vscode.window.showTextDocument(document, { preserveFocus: false, preview: false });
  void vscode.window.showInformationMessage('Choose "Save with Encoding", then "UTF-8 with BOM".');
  await vscode.commands.executeCommand("workbench.action.editor.changeEncoding");
}

export function registerEncodingFix(context: vscode.ExtensionContext, getCfg: () => PxConfig): void {
  const pending = new Set<string>();
  context.subscriptions.push(
    vscode.commands.registerCommand(SAVE_WITH_BOM, async (arg?: unknown) => {
      const uri = targetUri(arg);
      if (!uri || !writableRoot(uri, getCfg())) {
        void vscode.window.showInformationMessage("Open a mod script (.txt) or localization file.");
        return;
      }
      const key = uri.toString();
      if (pending.has(key)) return;
      pending.add(key);
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        if (!canFix(document, getCfg())) {
          void vscode.window.showInformationMessage("Open a mod script (.txt) or localization file.");
          return;
        }
        await chooseEncoding(document);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Could not change file encoding: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        pending.delete(key);
      }
    }),
    vscode.languages.registerCodeActionsProvider(
      [...PARADOX_SCRIPT_LANGS, "paradox-loc"].map((language) => ({ language, scheme: "file" })),
      {
        provideCodeActions(document, _range, context) {
          if (!canFix(document, getCfg())) return [];
          const diagnostics = context.diagnostics.filter(
            (d) => (typeof d.code === "object" ? d.code.value : d.code) === "missing-bom"
          );
          if (!diagnostics.length) return [];
          const action = new vscode.CodeAction("Save as UTF-8 with BOM...", vscode.CodeActionKind.QuickFix);
          action.diagnostics = diagnostics;
          action.isPreferred = true;
          action.command = { title: action.title, command: SAVE_WITH_BOM, arguments: [document.uri] };
          return [action];
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    )
  );
}
