import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { snippetCatalogueRequest, type SnippetCatalogueResult } from "@px-lsp/protocol/protocol";
import { snippetCatalogueHtml } from "./snippetCatalogueHtml";

export async function exportSnippetsCommand(
  storage: vscode.Uri,
  send: <R>(method: string, params: unknown) => Promise<R>
): Promise<void> {
  try {
    const uri = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Exporting generated snippets" },
      async () => {
        const result = await send<SnippetCatalogueResult>(snippetCatalogueRequest, {});
        if (result.indexing) {
          void vscode.window.showInformationMessage(
            "The toolkit is still indexing. Run Export Generated Snippets when indexing finishes."
          );
          return undefined;
        }
        const folder = vscode.Uri.joinPath(storage, "snippet-exports");
        await vscode.workspace.fs.createDirectory(folder);
        const file = vscode.Uri.joinPath(
          folder,
          `generated-snippets-${result.gameId.replace(/[^a-z0-9-]/gi, "_")}-${Date.now()}-${randomUUID().slice(0, 8)}.html`
        );
        await vscode.workspace.fs.writeFile(file, Buffer.from(snippetCatalogueHtml(result), "utf8"));
        return file;
      }
    );
    if (!uri) return;
    const opened = await vscode.env.openExternal(uri);
    const action = await vscode.window.showInformationMessage(
      `${opened ? "Exported generated snippets." : "Exported generated snippets; the browser could not be opened."} Saved to ${uri.fsPath}`,
      "Show File"
    );
    if (action === "Show File") await vscode.commands.executeCommand("revealFileInOS", uri);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Could not export snippets: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
