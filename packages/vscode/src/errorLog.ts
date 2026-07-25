/**
 * error.log watcher (rework plan Phase 5): tail the game's logs/error.log
 * while CK3 runs and surface entries as diagnostics pointing at the mod files
 * — the edit→test loop without alt-tabbing into a log file.
 *
 * Plus `Paradox: Launch CK3 (debug mode)` via the Steam run URL.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { PxConfig } from "./config";
import { parseErrorLogLine } from "@px-lsp/protocol/errorLogParser";

const POLL_MS = 1000;
const CK3_APP_ID = "1158310";

export class ErrorLogWatcher implements vscode.Disposable {
  private readonly diagnostics: vscode.DiagnosticCollection;
  private timer: ReturnType<typeof setInterval> | null = null;
  private offset = 0;
  private byUri = new Map<string, vscode.Diagnostic[]>();
  private readonly statusItem: vscode.StatusBarItem;

  constructor(
    private readonly getConfig: () => PxConfig,
    private readonly log: (msg: string) => void
  ) {
    // Per-profile: this channel reports the GAME's error.log, so it is named
    // after the active game rather than after us.
    this.diagnostics = vscode.languages.createDiagnosticCollection(`${getConfig().gameId}-game`);
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 89);
    this.statusItem.name = "Game error.log";
    this.statusItem.command = "px.watchErrorLog";
  }

  get watching(): boolean {
    return this.timer !== null;
  }

  private errorLogFile(): string | null {
    const logs = this.getConfig().logsPath;
    return logs ? path.join(logs, "error.log") : null;
  }

  toggle(): void {
    if (this.watching) this.stop();
    else this.start();
  }

  start(): void {
    const file = this.errorLogFile();
    if (!file) {
      void vscode.window.showWarningMessage("Paradox Toolkit: logs folder not found (set px.logsPath).");
      return;
    }
    this.byUri.clear();
    this.diagnostics.clear();
    // Start from the current end: only NEW entries of this play session matter.
    try {
      this.offset = fs.statSync(file).size;
    } catch {
      this.offset = 0;
    }
    this.timer = setInterval(() => this.poll(file), POLL_MS);
    this.statusItem.text = "$(eye) CK3 error.log";
    this.statusItem.tooltip = "Watching the game's error.log — click to stop";
    this.statusItem.show();
    this.log(`watching ${file}`);
    void vscode.window.showInformationMessage(
      "Paradox Toolkit: watching error.log — new game errors appear in Problems. Run the game with debug mode for live script reloads."
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.statusItem.hide();
    this.log("error.log watch stopped");
  }

  private poll(file: string): void {
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      return; // file missing (log rotated / game not started yet)
    }
    if (size < this.offset) this.offset = 0; // game restarted, log truncated
    if (size === this.offset) return;
    let chunk: string;
    try {
      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.alloc(size - this.offset);
        fs.readSync(fd, buf, 0, buf.length, this.offset);
        chunk = buf.toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return;
    }
    this.offset = size;
    let published = 0;
    for (const rawLine of chunk.split("\n")) {
      const parsed = parseErrorLogLine(rawLine);
      if (!parsed) continue;
      const resolved = this.resolve(parsed.relFile);
      if (!resolved) continue;
      const uri = vscode.Uri.file(resolved).toString();
      const line = parsed.line ?? 0;
      const diag = new vscode.Diagnostic(
        new vscode.Range(line, 0, line, 200),
        parsed.message,
        parsed.severity === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error
      );
      diag.source = "ck3-game";
      let list = this.byUri.get(uri);
      if (!list) this.byUri.set(uri, (list = []));
      // The game repeats entries on reload; keep one per message+line.
      if (!list.some((d) => d.message === diag.message && d.range.start.line === line)) {
        list.push(diag);
        published++;
      }
    }
    if (published > 0) {
      for (const [uriStr, diags] of this.byUri) {
        this.diagnostics.set(vscode.Uri.parse(uriStr), diags);
      }
      this.log(`error.log: ${published} new entr${published === 1 ? "y" : "ies"}`);
    }
  }

  /** Resolve a log-relative path against the mod first, then parents, then the game. */
  private resolve(relFile: string): string | null {
    const cfg = this.getConfig();
    const candidates: string[] = [];
    for (const root of [cfg.modPath, ...cfg.parentPaths, cfg.gamePath]) {
      if (root) candidates.push(path.join(root, ...relFile.split("/")));
    }
    if (path.isAbsolute(relFile)) candidates.unshift(relFile);
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  dispose(): void {
    this.stop();
    this.diagnostics.dispose();
    this.statusItem.dispose();
  }
}

export async function launchGameDebugCommand(): Promise<void> {
  const url = `steam://run/${CK3_APP_ID}//-debug_mode%20-develop/`;
  await vscode.env.openExternal(vscode.Uri.parse(url));
  void vscode.window.showInformationMessage(
    "Paradox Toolkit: launching via Steam with -debug_mode -develop. Tip: run 'Paradox: Toggle error.log Watcher' to see script errors live."
  );
}
