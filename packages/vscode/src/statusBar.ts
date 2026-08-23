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
  /** The script_docs tokens are the bundled snapshot, not the user's dump. */
  tokensFromBundledDumps: boolean;
  definitions: number;
  gameOk: boolean;
  modOk: boolean;
  tigerOk: boolean;
  /** The active game's tiger binary name, or null when it has none (EU5) —
   * then the tiger line is dropped and never counts against health. */
  tigerName: string | null;
}

export class PxStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  /** Server phases (`paradox/progress`), in the order the server started them. */
  private readonly phases = new Map<string, { label: string; done: boolean }>();
  private last: PxStatus | null = null;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    this.item.name = "Paradox Modding Toolkit";
    this.item.command = "px.setup";
    this.item.text = "$(loading~spin) PX Toolkit";
  }

  /** Shown only in mod/game workspaces; hidden (not disposed) elsewhere so it can
   * reappear when a mod folder is added to the workspace. */
  setVisible(visible: boolean): void {
    if (visible) this.item.show();
    else this.item.hide();
  }

  /** One server phase started or finished; the item re-renders so the tooltip
   * says what is still loading instead of only what finished. */
  setPhase(phase: string, state: "start" | "done", detail?: string): void {
    const label = detail ?? this.phases.get(phase)?.label ?? phase;
    this.phases.set(phase, { label, done: state === "done" });
    if (this.last) this.update(this.last);
  }

  update(s: PxStatus): void {
    this.last = s;
    const healthy = s.gameOk && s.modOk && (s.tigerName === null || s.tigerOk) && s.tokens > 0;
    const running = [...this.phases.values()].some((p) => !p.done);
    this.item.text =
      s.indexing || running
        ? "$(sync~spin) PX Toolkit"
        : healthy
          ? "$(check) PX Toolkit"
          : "$(warning) PX Toolkit";
    const lines = [
      `**Paradox Modding Toolkit** — click to run setup & health check`,
      "",
      `${s.tokens > 0 ? "✓" : "✗"} engine tokens: ${s.tokens}${
        s.tokens > 0
          ? s.tokensFromBundledDumps
            ? " (bundled script_docs snapshot — dump your own to match your patch)"
            : s.tokensFromScriptDocs
              ? " (script_docs + wiki)"
              : " (bundled wiki only)"
          : ""
      }`,
      `${s.definitions > 0 ? "✓" : "✗"} indexed definitions: ${s.definitions}`,
      `${s.gameOk ? "✓" : "✗"} game path ${s.gameOk ? "configured" : "missing"}`,
      `${s.modOk ? "✓" : "✗"} mod folder ${s.modOk ? "found" : "missing"}`,
    ];
    if (s.tigerName !== null) {
      lines.push(`${s.tigerOk ? "✓" : "✗"} ${s.tigerName} ${s.tigerOk ? "available" : "not set up"}`);
    }
    // What the server is still doing. A phase stays listed once done, with a
    // check, so the rows do not jump around while a cold workspace loads.
    for (const p of this.phases.values()) lines.push(`${p.done ? "✓" : "○"} ${p.label}`);
    const md = new vscode.MarkdownString(lines.join("\n\n"));
    this.item.tooltip = md;
  }

  dispose(): void {
    this.item.dispose();
  }
}
