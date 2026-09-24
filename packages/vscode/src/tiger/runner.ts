/**
 * tiger integration: runs the external binary against the mod (on save,
 * debounced, or manually) and maps its JSON report to VS Code diagnostics.
 *
 * Which binary and whether one exists at all comes from the active game's meta
 * (`GameMeta.tiger`). A game without a tiger (EU5) never spawns a process,
 * never publishes diagnostics, and never shows the tiger status segment.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { ChildProcess } from "child_process";
import { startTiger } from "@px-lsp/protocol/tigerProcess";
import type { PxConfig } from "../config";
import { isUnder, modRootFor } from "../config";
import { metaFor } from "../meta";
import { prepareTigerConfig } from "@px-lsp/protocol/tigerConfig";
import { resolveConfigDir } from "@px-lsp/protocol/configDir";
import { hasMetadataDescriptor } from "@px-lsp/protocol/descriptorMetadata";
import type { TigerReport } from "@px-lsp/protocol/tigerParser";
import {
  isIgnoredByConfig,
  isSuppressedInline,
  scanInlineSuppressions,
  type InlineSuppressions,
} from "@px-lsp/protocol/suppression";

const SEVERITY_MAP: Record<string, vscode.DiagnosticSeverity> = {
  fatal: vscode.DiagnosticSeverity.Error,
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  untidy: vscode.DiagnosticSeverity.Information,
  tips: vscode.DiagnosticSeverity.Hint,
};

const DEBOUNCE_MS = 1500;

function hasDescriptor(root: string): boolean {
  try {
    return fs.existsSync(path.join(root, "descriptor.mod")) || hasMetadataDescriptor(root);
  } catch {
    return false;
  }
}

export class TigerRunner implements vscode.Disposable {
  private readonly diagnostics: vscode.DiagnosticCollection;
  /** Persistent footer presence: idle prompt, spinner while running, last result. */
  private readonly status: vscode.StatusBarItem;
  /** Report count of the last completed run, kept visible until the next one. */
  private lastCount: number | null = null;
  private lastFailure = false;
  private child: ChildProcess | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private errorNotified = false;
  private disposed = false;
  private rerunRequested = false;
  /** Mod root of the run queued behind a still-running instance. */
  private rerunRoot: string | undefined;

  constructor(
    private readonly getConfig: () => PxConfig,
    private readonly log: (msg: string) => void,
    /** Extra CLI args per run (per-mod baseline --suppress, one-shot --unused). */
    private readonly extraArgs: (modRoot: string) => string[] = () => []
  ) {
    // Diagnostic source/collection carry the active game's binary name, so
    // Problems entries read "vic3-tiger" in a Vic3 workspace.
    this.diagnostics = vscode.languages.createDiagnosticCollection(this.tigerName());
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.status.name = this.tigerName();
    this.status.command = "px.runTiger";
  }

  /**
   * Sync the footer item with the current state. The item is persistent, not a
   * transient flash: with tigerRunOn defaulting to manual, a run-scoped item
   * would simply never be seen, and the footer is where users look for the
   * validator. Hidden when the game has no tiger, none is configured, or the
   * workspace is not a mod workspace at all (same gate as the PX item, so an
   * unrelated project never grows a tiger segment).
   */
  refreshStatus(): void {
    if (this.disposed) return;
    const cfg = this.getConfig();
    if (!this.tigerExists() || !cfg.tigerPath || !cfg.isCk3Workspace) {
      this.status.hide();
      return;
    }
    if (this.child) {
      this.showRunning();
      return;
    }
    if (this.lastFailure) {
      this.status.text = "$(error) Tiger";
      this.status.tooltip =
        "Tiger validation failed. See the Paradox Modding Toolkit output. Click to retry.";
    } else if (this.lastCount === null) {
      this.status.text = "$(play) Tiger";
      this.status.tooltip = `${this.tigerName()}: click to validate the mod`;
    } else {
      this.status.text = this.lastCount === 0 ? "$(check) Tiger" : `$(warning) Tiger: ${this.lastCount}`;
      this.status.tooltip =
        this.lastCount === 0
          ? `${this.tigerName()}: no problems. Click to run again.`
          : `${this.tigerName()}: ${this.lastCount} ${this.lastCount === 1 ? "problem" : "problems"}. Click to run again.`;
    }
    this.status.show();
  }

  /** The active game's tiger binary name, or "tiger" when it has none. */
  private tigerName(): string {
    return metaFor(this.getConfig().gameId).tiger?.binaryName ?? "tiger";
  }

  /** False when the active game ships no tiger (EU5): every entry point bails. */
  private tigerExists(): boolean {
    return metaFor(this.getConfig().gameId).tiger !== undefined;
  }

  private showRunning(): void {
    this.status.text = "$(sync~spin) Tiger";
    this.status.tooltip = `${this.tigerName()} is validating the mod…`;
    this.status.show();
  }

  /** Record a finished run (null = no result, e.g. killed) and re-sync. */
  private showDone(problemCount: number | null): void {
    if (problemCount !== null) {
      this.lastCount = problemCount;
      this.lastFailure = false;
    }
    this.refreshStatus();
  }

  /** Call when configuration changed: allows the "binary broken" notice to fire again. */
  resetErrorNotice(): void {
    this.errorNotified = false;
  }

  /** The mod a run targets: an explicit root, else the mod owning the active
   * editor's file (multi-mod workspaces), else the primary mod folder. */
  private resolveRoot(cfg: PxConfig, explicit?: string): string | null {
    if (explicit) return explicit;
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (active) {
      const owner = modRootFor(active, cfg);
      if (owner) return owner;
    }
    return cfg.modPath;
  }

  private prepareConfig(cfg: PxConfig, modRoot: string) {
    const meta = metaFor(cfg.gameId);
    return prepareTigerConfig({
      modRoot,
      configDir: resolveConfigDir(modRoot, meta),
      confName: meta.tiger!.confName,
      descriptor: meta.descriptor,
      parentPaths: cfg.parentPaths,
    });
  }

  private disposeConfig(config?: ReturnType<typeof prepareTigerConfig>): void {
    try {
      config?.dispose();
    } catch (error) {
      this.notifyError(
        `Paradox Modding Toolkit: could not remove temporary Tiger configuration: ${String(error)}`
      );
    }
  }

  onDidSaveDocument(doc: vscode.TextDocument): void {
    const cfg = this.getConfig();
    if (!this.tigerExists()) return;
    if (cfg.tigerRunOn !== "save") return;
    if (!cfg.tigerPath) return;
    // Multi-mod workspaces: validate the mod the saved file belongs to.
    const root = modRootFor(doc.uri.fsPath, cfg);
    if (!root) return;
    // Don't even schedule a run for workspaces that are not mods.
    if (!hasDescriptor(root)) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.run(false, root), DEBOUNCE_MS);
  }

  run(manual: boolean, rootOverride?: string): void {
    const cfg = this.getConfig();
    const meta = metaFor(cfg.gameId);
    if (!meta.tiger) {
      // No tiger exists for this game: never spawn, never nag on save.
      if (manual) {
        void vscode.window.showInformationMessage(
          `Paradox Modding Toolkit: no tiger validator exists for ${meta.name} yet — the extension's own diagnostics still run.`
        );
      }
      return;
    }
    if (!cfg.tigerPath) {
      if (manual) {
        void vscode.window
          .showWarningMessage(
            `Paradox Modding Toolkit: ${meta.tiger.binaryName} is not set up yet — download it once, or point ` +
              `px.tigerPath at your own binary.`,
            `Download ${meta.tiger.binaryName}`
          )
          .then((choice) => {
            if (choice) void vscode.commands.executeCommand("px.downloadTiger");
          });
      }
      return;
    }
    const modRoot = this.resolveRoot(cfg, rootOverride);
    if (!modRoot) {
      if (manual)
        void vscode.window.showWarningMessage(
          "Paradox Modding Toolkit: no mod folder found. Open your mod folder (the one with the mod's descriptor) as a workspace folder."
        );
      return;
    }
    // tiger refuses folders without a mod descriptor (descriptor.mod for CK3,
    // .metadata/metadata.json for Vic3). A manual run gets a clear message;
    // automatic runs (save, config change) skip silently so opening a non-mod
    // workspace never spawns tiger or throws errors at the user.
    if (!hasDescriptor(modRoot)) {
      if (manual) {
        // The extension can create the missing descriptor itself; offer that
        // instead of describing the fix.
        void vscode.window
          .showErrorMessage(
            `Paradox Modding Toolkit: tiger needs a mod descriptor in the mod folder (${modRoot}). ` +
              "Mods created via the launcher have one.",
            "Create descriptor.mod"
          )
          .then((choice) => {
            if (choice) void vscode.commands.executeCommand("px.createDescriptor");
          });
      } else {
        this.log(`tiger: skipped, no mod descriptor in ${modRoot} (not a mod workspace?)`);
      }
      return;
    }

    // One run at a time: kill a still-running instance before starting anew.
    if (this.child) {
      this.rerunRequested = true;
      this.rerunRoot = modRoot;
      this.child.kill();
      return;
    }

    let config: ReturnType<typeof prepareTigerConfig>;
    try {
      config = this.prepareConfig(cfg, modRoot);
    } catch (error) {
      this.notifyError(`Paradox Modding Toolkit: could not configure validation: ${String(error)}`);
      return;
    }
    const args = ["--json", ...config.args, ...this.extraArgs(modRoot)];
    if (cfg.gamePath) {
      // tiger's game flag (--ck3 / --vic3, matching the profile id) wants the
      // install root (".../<game name>"), while the resolved gamePath points at
      // its game/ data subfolder.
      const gameDir =
        path.basename(cfg.gamePath).toLowerCase() === "game" ? path.dirname(cfg.gamePath) : cfg.gamePath;
      args.push(`--${cfg.gameId}`, gameDir);
    }
    args.push(modRoot);

    this.log(`tiger: ${cfg.tigerPath} ${args.join(" ")}`);
    let run: ReturnType<typeof startTiger>;
    try {
      run = startTiger(cfg.tigerPath, args, { cwd: modRoot });
    } catch (error) {
      this.disposeConfig(config);
      this.notifyError(`Paradox Modding Toolkit: validation failed: ${String(error)}`);
      return;
    }
    this.child = run.child;
    this.showRunning();
    void run.result
      .then(({ reports }) => {
        if (this.rerunRequested || this.disposed) return;
        this.publish(reports, modRoot);
        this.showDone(reports.length);
        this.log(`tiger: ${reports.length} report(s)`);
      })
      .catch((error: unknown) => {
        if (!this.rerunRequested && !this.disposed) {
          this.notifyError(`Paradox Modding Toolkit: validation failed: ${String(error)}`);
        }
      })
      .finally(() => {
        this.disposeConfig(config);
        this.child = null;
        if (this.disposed) return;
        this.showDone(null);
        if (this.rerunRequested) {
          this.rerunRequested = false;
          const queuedRoot = this.rerunRoot;
          this.rerunRoot = undefined;
          this.run(false, queuedRoot);
        }
      });
  }

  /**
   * Run tiger once and write the raw JSON report to `outFile` (the baseline
   * for --suppress). Independent of the debounced diagnostic runs.
   */
  async createBaseline(outFile: string): Promise<number | null> {
    const cfg = this.getConfig();
    const meta = metaFor(cfg.gameId);
    if (!meta.tiger || !cfg.tigerPath || !cfg.modPath) {
      void vscode.window.showWarningMessage(
        "Paradox Modding Toolkit: a supported validator and mod folder are required for a baseline."
      );
      return null;
    }
    let config: ReturnType<typeof prepareTigerConfig> | undefined;
    try {
      config = this.prepareConfig(cfg, cfg.modPath);
      const args = ["--json", ...config.args];
      if (cfg.gamePath) {
        const gameDir =
          path.basename(cfg.gamePath).toLowerCase() === "game" ? path.dirname(cfg.gamePath) : cfg.gamePath;
        args.push(`--${cfg.gameId}`, gameDir);
      }
      args.push(cfg.modPath);
      const { reports, stdout } = await startTiger(cfg.tigerPath, args, { cwd: cfg.modPath }).result;
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, stdout);
      return reports.length;
    } catch (error) {
      this.notifyError(`Paradox Modding Toolkit: could not create baseline: ${String(error)}`);
      return null;
    } finally {
      this.disposeConfig(config);
    }
  }

  private publish(reports: TigerReport[], modPath: string): void {
    const cfg = this.getConfig();
    const ignoreCfg = {
      ignore: cfg.diagnosticsIgnore,
      ignorePatterns: cfg.diagnosticsIgnorePatterns,
    };
    // Cache per-file inline suppressions so we read each source file at most once.
    const inlineCache = new Map<string, InlineSuppressions>();
    const inlineFor = (file: string): InlineSuppressions => {
      let m = inlineCache.get(file);
      if (m) return m;
      let text = "";
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        text = "";
      }
      m = scanInlineSuppressions(text);
      inlineCache.set(file, m);
      return m;
    };

    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const report of reports) {
      const loc = report.locations[0];
      if (!loc) continue;
      const file = loc.fullpath ?? (path.isAbsolute(loc.path) ? loc.path : path.join(modPath, loc.path));
      // Only surface diagnostics for the mod's own files.
      if (!isUnder(modPath, file) && path.resolve(file) !== path.resolve(modPath)) continue;
      const line = Math.max(0, (loc.linenr ?? 1) - 1);
      // F1/F2: suppress by tiger key, file glob, or inline comment (fail-soft).
      const rel = path.relative(modPath, file).replace(/\\/g, "/");
      if (isIgnoredByConfig(ignoreCfg, report.key, rel)) continue;
      if (isSuppressedInline(inlineFor(file), line, report.key)) continue;
      const colStart = Math.max(0, (loc.column ?? 1) - 1);
      const colEnd = loc.length !== undefined ? colStart + loc.length : colStart + 200;
      const severity = SEVERITY_MAP[report.severity.toLowerCase()] ?? vscode.DiagnosticSeverity.Warning;
      let message = report.info ? `${report.message}\n${report.info}` : report.message;
      if (report.confidence && report.confidence.toLowerCase() !== "reasonable") {
        message += ` (confidence: ${report.confidence})`;
      }
      const diag = new vscode.Diagnostic(new vscode.Range(line, colStart, line, colEnd), message, severity);
      diag.source = this.tigerName();
      diag.code = report.key;
      if (report.locations.length > 1) {
        diag.relatedInformation = report.locations.slice(1).map((rel) => {
          const relFile =
            rel.fullpath ?? (path.isAbsolute(rel.path) ? rel.path : path.join(modPath, rel.path));
          const relLine = Math.max(0, (rel.linenr ?? 1) - 1);
          const relCol = Math.max(0, (rel.column ?? 1) - 1);
          return new vscode.DiagnosticRelatedInformation(
            new vscode.Location(vscode.Uri.file(relFile), new vscode.Position(relLine, relCol)),
            rel.tag ?? "related location"
          );
        });
      }
      const key = vscode.Uri.file(file).toString();
      let list = byFile.get(key);
      if (!list) byFile.set(key, (list = []));
      list.push(diag);
    }
    // Replace only this mod's diagnostics: multi-mod workspaces run tiger per
    // mod, and a run for one mod must not wipe another's results.
    const stale: vscode.Uri[] = [];
    this.diagnostics.forEach((uri) => {
      if (isUnder(modPath, uri.fsPath)) stale.push(uri);
    });
    for (const uri of stale) this.diagnostics.delete(uri);
    for (const [uriStr, diags] of byFile) {
      this.diagnostics.set(vscode.Uri.parse(uriStr), diags);
    }
  }

  private notifyError(message: string): void {
    this.log(message);
    this.lastFailure = true;
    this.refreshStatus();
    if (this.errorNotified) return;
    this.errorNotified = true;
    void vscode.window.showErrorMessage(message);
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.child?.kill();
    this.diagnostics.dispose();
    this.status.dispose();
  }
}
