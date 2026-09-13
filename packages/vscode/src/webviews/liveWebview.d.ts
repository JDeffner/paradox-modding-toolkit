/** Build-time adapter contract. The unpublished helper is resolved only by the live development build. */
declare module "@webview-dev/helper" {
  import type * as vscode from "vscode";

  export interface Integration extends vscode.Disposable {
    registerBuild(buildId: string, root: vscode.Uri, signalPath: string): vscode.Disposable;
    registerPanel(
      panel: vscode.WebviewPanel,
      options: {
        instanceId: string;
        viewType: string;
        label: string;
        buildId: string;
        reload(revision: string): void | Promise<void>;
      }
    ): vscode.Disposable;
  }

  export function connectDevtools(
    context: vscode.ExtensionContext,
    options: { enabled: boolean; report?: (message: string) => void }
  ): Promise<Integration>;
}
