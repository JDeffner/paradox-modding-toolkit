/**
 * error.log watcher (rework plan Phase 5): tail the game's logs/error.log
 * while the game runs and surface entries as diagnostics pointing at the mod
 * files — the edit→test loop without alt-tabbing into a log file.
 *
 * The offset/truncation half lives in `logTail.ts` (no vscode, unit-tested):
 * this file only turns the lines it hands back into diagnostics, and drops the
 * collection whenever the tail reports the log was cleared or replaced.
 *
 * Plus `Paradox: Launch Game (debug mode)` via the Steam run URL of the active
 * game (meta.steamAppId).
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { PxConfig } from "./config";
import { ErrorLogParser } from "@px-lsp/protocol/errorLogParser";
import { LogTail } from "./logTail";
import { metaFor } from "./meta";

const POLL_MS = 1000;

export class ErrorLogWatcher implements vscode.Disposable {
  private readonly diagnostics: vscode.DiagnosticCollection;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tail: LogTail | null = null;
  private readonly parser = new ErrorLogParser();
  private seen = false;
  private entries = 0;
  private byUri = new Map<string, vscode.Diagnostic[]>();
  private readonly statusItem: vscode.StatusBarItem;
  private readonly stateEmitter = new vscode.EventEmitter<boolean>();
  /**
   * Fires with the current `watching` value whenever the watch starts or stops
   * OR the published problem count changes — the Project view mirrors both (its
   * switch and its "Clear Game Problems (N)" row).
   */
  readonly onDidChangeState = this.stateEmitter.event;

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

  /** Diagnostics currently published from the log (survives `stop`). */
  get problemCount(): number {
    return this.entries;
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
      void vscode.window.showWarningMessage(
        "Paradox Modding Toolkit: logs folder not found (set px.logsPath)."
      );
      return;
    }
    this.byUri.clear();
    this.diagnostics.clear();
    this.entries = 0;
    // Start from the current end: only NEW entries of this play session matter.
    this.parser.reset();
    this.tail?.close();
    this.tail = new LogTail(file);
    this.seen = this.tail.seekToEnd();
    this.timer = setInterval(() => this.poll(), POLL_MS);
    this.showStatus();
    this.stateEmitter.fire(true);
    this.log(`watching ${file}`);
    void vscode.window.showInformationMessage(
      "Paradox Modding Toolkit: watching error.log — new game errors appear in Problems. Run the game with debug mode for live script reloads."
    );
  }

  /**
   * Drop every diagnostic published from the log, leaving the watch as it is.
   * `stop` deliberately keeps them (you fix the entries with the game closed),
   * so without this the only way out is clearing the log in-game or reloading
   * the window.
   */
  clear(): void {
    const had = this.entries;
    this.byUri.clear();
    this.diagnostics.clear();
    this.entries = 0;
    if (this.watching) this.showStatus();
    this.stateEmitter.fire(this.watching);
    if (had > 0) this.log(`cleared ${had} game diagnostic${had === 1 ? "" : "s"}`);
  }

  stop(): void {
    const wasWatching = this.watching;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // On POSIX the tail holds the log's inode open between polls so a relaunch's
    // new error.log cannot pass for an append (see logTail.ts). Dropping the
    // reference without closing would leak the descriptor and keep a deleted
    // log's blocks alive for as long as the window stays open.
    this.tail?.close();
    this.tail = null;
    this.statusItem.hide();
    if (wasWatching) {
      this.stateEmitter.fire(false);
      this.log("error.log watch stopped");
      void vscode.window.showInformationMessage("Paradox Modding Toolkit: stopped watching error.log.");
    }
  }

  /**
   * Watching a file the game has not written yet is indistinguishable from a
   * broken watcher, so the item distinguishes the two states and carries the
   * running entry count (which drops back to zero when the log is cleared).
   */
  private showStatus(): void {
    const name = metaFor(this.getConfig().gameId).shortName;
    const file = this.tail?.file ?? "error.log";
    this.statusItem.text = this.seen ? `$(eye) ${name} error.log` : `$(eye) ${name} error.log (waiting)`;
    this.statusItem.tooltip = this.seen
      ? `Watching ${file} (${this.entries} ${this.entries === 1 ? "entry" : "entries"}). Click to stop.` +
        // The Problems outlive the watch on purpose, so say how to get rid of
        // them where the count is read.
        (this.entries > 0 ? `\nRun 'Paradox: Clear Game Problems' to remove them.` : "")
      : `Waiting for ${file}, which the game writes once it runs. Click to stop.`;
    this.statusItem.show();
  }

  private poll(): void {
    const tail = this.tail;
    if (!tail) return;
    const { lines, reset, missing } = tail.read();
    if (missing) {
      // Log deleted or momentarily locked; the tail keeps its offset and picks
      // up again on the next round.
      return;
    }
    if (!this.seen) {
      this.seen = true;
      this.showStatus();
    }
    if (reset) {
      // The in-game error tracker's "clear log" truncates the file and a game
      // relaunch replaces it. Either way every diagnostic published so far
      // describes an entry the user can no longer see, so it has to go.
      this.byUri.clear();
      this.diagnostics.clear();
      this.entries = 0;
      this.parser.reset();
      this.log("error.log was cleared or replaced; game diagnostics reset");
    }
    let published = 0;
    for (const rawLine of lines) {
      const parsed = this.parser.push(rawLine);
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
      diag.source = `${this.getConfig().gameId}-game`;
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
    if (published > 0 || reset) {
      this.entries += published;
      this.showStatus();
      this.stateEmitter.fire(true);
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
    this.stateEmitter.dispose();
  }
}

export async function launchGameDebugCommand(cfg: PxConfig, errorLog: ErrorLogWatcher): Promise<void> {
  const meta = metaFor(cfg.gameId);
  const url = `steam://run/${meta.steamAppId}//-debug_mode%20-develop/`;
  await vscode.env.openExternal(vscode.Uri.parse(url));
  // One click instead of a command name to retype; hidden once already watching.
  const watch = errorLog.watching ? [] : ["Watch error.log"];
  void vscode.window
    .showInformationMessage(
      `Paradox Modding Toolkit: launching ${meta.name} via Steam with -debug_mode -develop (scripts reload live).`,
      ...watch
    )
    .then((choice) => {
      if (choice) errorLog.toggle();
    });
}
