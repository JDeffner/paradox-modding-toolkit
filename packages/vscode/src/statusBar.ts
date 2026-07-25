/**
 * Status bar item summarizing the extension's data health at a glance:
 * engine tokens, index size, tiger availability. Click runs Paradox: Run Setup
 * & Health Check.
 */
import * as vscode from "vscode";

export interface PxStatus {
  tokens: number;
  indexing: boolean;
  tokensFromScriptDocs: boolean;
  definitions: number;
  gameOk: boolean;
  modOk: boolean;
  tigerOk: boolean;
}

export class PxStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    this.item.name = "Paradox Toolkit";
    this.item.command = "px.setup";
    this.item.text = "$(loading~spin) PX";
  }

  /** Shown only in CK3 workspaces; hidden (not disposed) elsewhere so it can
   * reappear when a mod folder is added to the workspace. */
  setVisible(visible: boolean): void {
    if (visible) this.item.show();
    else this.item.hide();
  }

  update(s: PxStatus): void {
    const healthy = s.gameOk && s.modOk && s.tigerOk && s.tokens > 0;
    this.item.text = s.indexing ? "$(loading~spin) PX" : healthy ? "$(check) PX" : "$(warning) PX";
    const lines = [
      `**Paradox Toolkit** — click to run setup & health check`,
      "",
      `${s.tokens > 0 ? "✓" : "✗"} engine tokens: ${s.tokens}${s.tokens > 0 ? (s.tokensFromScriptDocs ? " (script_docs + wiki)" : " (bundled wiki only)") : ""}`,
      `${s.definitions > 0 ? "✓" : "✗"} indexed definitions: ${s.definitions}`,
      `${s.gameOk ? "✓" : "✗"} game path ${s.gameOk ? "configured" : "missing"}`,
      `${s.modOk ? "✓" : "✗"} mod folder ${s.modOk ? "found" : "missing"}`,
      `${s.tigerOk ? "✓" : "✗"} ck3-tiger ${s.tigerOk ? "available" : "not set up"}`,
    ];
    const md = new vscode.MarkdownString(lines.join("\n\n"));
    this.item.tooltip = md;
  }

  dispose(): void {
    this.item.dispose();
  }
}
