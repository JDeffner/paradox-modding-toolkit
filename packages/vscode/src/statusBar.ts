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
  /** Tokens the bundled wiki added on top of script_docs (mostly deprecated). */
  tokensWikiOnly?: number;
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

  /** A phase that has a value row of its own, so it never gets a second line. */
  private phaseState(phase: string): "running" | "done" | "absent" {
    const p = this.phases.get(phase);
    if (!p) return "absent";
    return p.done ? "done" : "running";
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

    const n = (v: number) => v.toLocaleString();
    /** `○` while the work is running, then `✓`/`✗` on the result. */
    const mark = (phase: string, ok: boolean) =>
      this.phaseState(phase) === "running" ? "○" : ok ? "✓" : "✗";

    // Say where the tokens came from, with the split, because "script_docs +
    // wiki" reads as though the wiki is doing half the work. It is not: with a
    // real dump loaded the wiki contributes a handful of extra NAMES (mostly
    // deprecated API the current patch no longer has) on top of usage examples
    // for tokens the dump already had.
    const wikiOnly = s.tokensWikiOnly ?? 0;
    const own = s.tokens - wikiOnly;
    const tokenSource = s.tokensFromBundledDumps
      ? "bundled snapshot — run script_docs in the game console to match your patch"
      : s.tokensFromScriptDocs
        ? `${n(own)} from your script_docs${wikiOnly > 0 ? `, ${n(wikiOnly)} wiki-only` : ""}`
        : "bundled wiki only — run script_docs in the game console";

    // Loading rows first, then configuration. Each phase reports INTO its own
    // value row rather than adding a second one: "harvesting engine tokens…"
    // and "engine tokens: 4,624" were the same fact on two lines, and the
    // phase row kept its "…" after it finished, so a finished load still read
    // as ongoing.
    const lines = [
      `**Paradox Modding Toolkit** — click to run setup & health check`,
      "",
      this.phaseState("engine") === "running"
        ? `○ harvesting engine tokens…`
        : `${mark("engine", s.tokens > 0)} engine tokens: ${n(s.tokens)}${s.tokens > 0 ? ` (${tokenSource})` : ""}`,
      s.indexing || this.phaseState("index") === "running"
        ? `○ indexing definitions… ${n(s.definitions)} so far`
        : `${mark("index", s.definitions > 0)} indexed definitions: ${n(s.definitions)}`,
    ];
    if (this.phaseState("guiStore") !== "absent") {
      lines.push(
        this.phaseState("guiStore") === "running"
          ? "○ building the GUI template store…"
          : "✓ GUI template store built"
      );
    }
    lines.push(
      "",
      `${s.gameOk ? "✓" : "✗"} game path ${s.gameOk ? "configured" : "not set"}`,
      `${s.modOk ? "✓" : "✗"} mod folder ${s.modOk ? "found" : "not found"}`
    );
    if (s.tigerName !== null) {
      lines.push(`${s.tigerOk ? "✓" : "✗"} ${s.tigerName} ${s.tigerOk ? "available" : "not set up"}`);
    }
    // Any phase the server adds later still gets a row, so a new one is never
    // silently dropped; the three above are the ones with a value row.
    for (const [name, p] of this.phases) {
      if (name === "engine" || name === "index" || name === "guiStore") continue;
      lines.push(`${p.done ? "✓" : "○"} ${p.label.replace(/…$/, "")}`);
    }
    this.item.tooltip = new vscode.MarkdownString(lines.join("\n\n"));
  }

  dispose(): void {
    this.item.dispose();
  }
}
