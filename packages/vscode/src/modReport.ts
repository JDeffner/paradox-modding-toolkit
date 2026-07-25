/**
 * `Paradox: Show Mod Report` — a one-page markdown dashboard: content inventory,
 * diagnostics by severity/source, localization coverage, override map.
 * Rendered through VS Code's native markdown preview.
 */
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import {
  indexStatsRequest,
  locCoverageRequest,
  modOverviewRequest,
  overridesRequest,
  type LocCoverage,
  type ModOverview,
  type ModScopedParams,
  type OverrideInfo,
} from "@px-lsp/protocol/protocol";
import type { IndexStats } from "@px-lsp/protocol/types";

function diagnosticsSummary(): string[] {
  const counts = new Map<string, number>();
  for (const [, diags] of vscode.languages.getDiagnostics()) {
    for (const d of diags) {
      const sev = vscode.DiagnosticSeverity[d.severity];
      const key = `${d.source ?? "other"} · ${sev}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return ["No problems reported. Clean."];
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, n]) => `| ${key} | ${n} |`);
}

export async function modReportCommand(lc: LanguageClient, modRoot: string | null = null): Promise<void> {
  const params: ModScopedParams = { modRoot };
  const [stats, overview, coverage, overrides] = await Promise.all([
    lc.sendRequest<IndexStats>(indexStatsRequest),
    lc.sendRequest<ModOverview>(modOverviewRequest, params),
    lc.sendRequest<LocCoverage[]>(locCoverageRequest, params),
    lc.sendRequest<OverrideInfo[]>(overridesRequest, params),
  ]);

  const lines: string[] = [];
  lines.push(`# CK3 Mod Report`, "", `*Generated ${new Date().toLocaleString()}*`, "");
  if (modRoot) lines.push(`*Mod: ${modRoot}*`, "");

  lines.push(`## Content`, "");
  lines.push(`${overview.totalDefs} definitions, ${overview.totalRefs} reference sites in the mod.`, "");
  if (overview.kinds.length > 0) {
    lines.push(`| Kind | Count |`, `|---|---|`);
    for (const k of overview.kinds) lines.push(`| ${k.kind.replace(/_/g, " ")} | ${k.count} |`);
    lines.push("");
  }

  lines.push(`## Problems`, "");
  const diag = diagnosticsSummary();
  if (diag[0].startsWith("|")) lines.push(`| Source · Severity | Count |`, `|---|---|`);
  lines.push(...diag, "");

  lines.push(`## Localization coverage`, "");
  if (coverage.length === 0) {
    lines.push("No localization files found.", "");
  } else {
    lines.push(`| Language | Keys | Missing | Orphaned | Untranslated |`, `|---|---|---|---|---|`);
    for (const l of coverage) {
      lines.push(
        `| ${l.language} | ${l.defined} | ${l.missing.length} | ${l.orphaned.length} | ${l.untranslated.length} |`
      );
    }
    lines.push("");
  }

  lines.push(`## Overrides`, "");
  if (overrides.length === 0) {
    lines.push("No vanilla or parent-mod definitions are overridden.", "");
  } else {
    const losing = overrides.filter((o) => o.winner !== "mod");
    lines.push(
      `${overrides.length} overridden definition(s)${losing.length > 0 ? ` — **${losing.length} where the mod does NOT win** (FIOS folders)` : ""}.`,
      ""
    );
    lines.push(`| Name | Kind | Rule | Winner |`, `|---|---|---|---|`);
    for (const o of overrides.slice(0, 100)) {
      lines.push(`| ${o.name} | ${o.kind} | ${o.rule} | ${o.winner === "mod" ? "mod" : "**vanilla**"} |`);
    }
    if (overrides.length > 100)
      lines.push("", `… and ${overrides.length - 100} more (see the Overrides view).`);
    lines.push("");
  }

  lines.push(`## Index`, "");
  lines.push(`Total indexed (all sources): ${stats.total} definitions in ${stats.files} files.`, "");

  const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: lines.join("\n") });
  await vscode.window.showTextDocument(doc, { preview: true });
  await vscode.commands.executeCommand("markdown.showPreview", doc.uri);
}
