import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { PxConfig } from "../config";
import { metaFor } from "../meta";
import { hasMetadataDescriptor } from "@px-lsp/protocol/descriptorMetadata";
import type { TigerReport } from "@px-lsp/protocol/tigerParser";
import { renderLoadModBlocks } from "../tiger/loadMods";
import { runTargetValidator, targetInstallRoot } from "../tiger/target";

export interface CompatchValidationTarget {
  gameId: string;
  modPath: string;
  gamePath: string;
}

export interface CompatchValidationSummary extends CompatchValidationTarget {
  checkedAt: string;
  validator: string;
  errors: number;
  warnings: number;
  other: number;
  total: number;
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function publish(collection: vscode.DiagnosticCollection, reports: TigerReport[], modRoot: string): void {
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const report of reports) {
    const location = report.locations[0];
    if (!location) continue;
    const file = location.fullpath ?? path.resolve(modRoot, location.path);
    if (!inside(modRoot, file)) continue;
    const line = Math.max(0, (location.linenr ?? 1) - 1);
    const column = Math.max(0, (location.column ?? 1) - 1);
    const severity = /^(fatal|error)$/i.test(report.severity)
      ? vscode.DiagnosticSeverity.Error
      : /^warning$/i.test(report.severity)
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(line, column, line, column + Math.max(1, location.length ?? 1)),
      [report.message, report.info].filter(Boolean).join("\n"),
      severity
    );
    diagnostic.source = "Compatch target";
    diagnostic.code = report.key;
    const key = vscode.Uri.file(file).toString();
    const list = byFile.get(key) ?? [];
    list.push(diagnostic);
    byFile.set(key, list);
  }
  collection.clear();
  for (const [uri, diagnostics] of byFile) collection.set(vscode.Uri.parse(uri), diagnostics);
}

/** Runs independently of the normal validator and does not change workspace settings. */
export function registerCompatchValidation(context: vscode.ExtensionContext, getCfg: () => PxConfig): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("px-compatch-target");
  const output = vscode.window.createOutputChannel("Paradox Compatch Validation");
  let active: AbortController | undefined;
  context.subscriptions.push(
    diagnostics,
    output,
    { dispose: () => active?.abort() },
    vscode.commands.registerCommand("px.validateCompatchTarget", async (target: CompatchValidationTarget) => {
      const cfg = getCfg();
      if (
        !target ||
        target.gameId !== cfg.gameId ||
        typeof target.modPath !== "string" ||
        typeof target.gamePath !== "string"
      )
        throw new Error("Choose a compatch target for the active game before validating.");
      const meta = metaFor(target.gameId);
      if (!meta.tiger) throw new Error(`No target validator is available for ${meta.name}.`);
      if (!cfg.tigerPath) throw new Error(`Set up ${meta.tiger.binaryName} before validating the target.`);
      if (active) throw new Error("Target validation is already running.");
      const [modRoot, installRoot] = await Promise.all([
        fs.realpath(target.modPath),
        targetInstallRoot(target.gamePath),
      ]);
      if (inside(installRoot, modRoot) || inside(modRoot, installRoot))
        throw new Error("The mod and new game installation must be separate folders.");
      const descriptor =
        meta.descriptor === "metadata"
          ? hasMetadataDescriptor(modRoot)
          : await fs.stat(path.join(modRoot, "descriptor.mod")).then(
              (stat) => stat.isFile(),
              () => false
            );
      if (!descriptor) throw new Error("The selected mod needs its descriptor before target validation.");
      if (
        vscode.workspace.textDocuments.some(
          (doc) => doc.isDirty && doc.uri.scheme === "file" && inside(modRoot, doc.uri.fsPath)
        )
      )
        throw new Error("Save the mod's edited files before validating against the new game.");
      const controller = new AbortController();
      active = controller;
      let scratch: string | undefined;
      try {
        scratch = await fs.mkdtemp(path.join(os.tmpdir(), "px-target-validation-"));
        const configFile = path.join(scratch, meta.tiger.confName);
        const dependencies = renderLoadModBlocks(meta.descriptor, cfg.parentPaths, modRoot);
        await fs.writeFile(configFile, dependencies.conf || "# No dependency mods configured.\n", "utf8");
        output.clear();
        output.appendLine(`Mod: ${modRoot}\nNew game: ${installRoot}\nValidator: ${cfg.tigerPath}`);
        output.appendLine(
          "Uses an isolated config with configured dependencies; no saved baseline or diagnostic suppression filters."
        );
        for (const missing of dependencies.skipped) output.appendLine(`Dependency not found: ${missing}`);
        const result = await vscode.window.withProgress(
          {
            location: { viewId: "px.compatch" },
            title: "Validating against new game data",
            cancellable: true,
          },
          async (_progress, token) => {
            const cancel = token.onCancellationRequested(() => controller.abort());
            try {
              return await runTargetValidator(
                cfg.tigerPath!,
                cfg.gameId,
                installRoot,
                modRoot,
                configFile,
                controller.signal
              );
            } finally {
              cancel.dispose();
            }
          }
        );
        if (controller.signal.aborted) return;
        publish(diagnostics, result.reports, modRoot);
        output.appendLine(
          `${result.errors} errors, ${result.warnings} warnings, ${result.other} other reports.`
        );
        for (const report of result.reports) {
          const loc = report.locations[0];
          output.appendLine(
            `${report.severity}: ${report.key}: ${report.message}${loc ? ` (${loc.fullpath ?? loc.path}:${loc.linenr ?? 1})` : ""}`
          );
        }
        output.show(true);
        return {
          ...target,
          checkedAt: new Date().toISOString(),
          validator: meta.tiger.binaryName,
          errors: result.errors,
          warnings: result.warnings,
          other: result.other,
          total: result.total,
        } satisfies CompatchValidationSummary;
      } catch (error) {
        if (controller.signal.aborted) return;
        output.appendLine(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        if (active === controller) active = undefined;
        if (
          scratch &&
          path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) &&
          path.basename(scratch).startsWith("px-target-validation-")
        ) {
          await fs.rm(scratch, { recursive: true, force: true });
        }
      }
    })
  );
}
