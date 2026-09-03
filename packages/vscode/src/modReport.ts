/**
 * `Paradox: Show Mod Report` — a one-page dashboard: content inventory,
 * diagnostics by severity/source, localization coverage, override map.
 * Built as markdown, rendered in the toolkit's document panel and as a page
 * of the Wiki.
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
import { showDocPanel } from "./webviews/docPanel";

/** Diagnostics scoped to the reported mod: the rest of the report describes
 * modRoot, so window-wide counts (other mods, other extensions) would lie
 * under the "Mod: …" header. Without a modRoot every diagnostic counts. */
function diagnosticsSummary(modRoot: string | null): string[] {
  const counts = new Map<string, number>();
  const prefix = modRoot ? modRoot.replace(/[\\/]+$/, "").toLowerCase() : null;
  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    if (prefix && !uri.fsPath.toLowerCase().startsWith(prefix)) continue;
    for (const d of diags) {
      const sev = vscode.DiagnosticSeverity[d.severity];
      const key = `${d.source ?? "other"} · ${sev}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return ["No problems reported. Clean."];
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, n]) => `| ${key} | ${n} |`);
}

/** The report as markdown: the doc panel and the Wiki's Mod Report page both render it. */
export async function buildModReport(lc: LanguageClient, modRoot: string | null): Promise<string> {
  const params: ModScopedParams = { modRoot };
  const [stats, overview, coverage, overrides] = await Promise.all([
    lc.sendRequest<IndexStats>(indexStatsRequest),
    lc.sendRequest<ModOverview>(modOverviewRequest, params),
    lc.sendRequest<LocCoverage[]>(locCoverageRequest, params),
    lc.sendRequest<OverrideInfo[]>(overridesRequest, params),
  ]);

  const lines: string[] = [];
  lines.push(`# Mod Report`, "", `*Generated ${new Date().toLocaleString()}*`, "");
  if (modRoot) lines.push(`*Mod: ${modRoot}*`, "");

  lines.push(`## Content`, "");
  lines.push(`${overview.totalDefs} definitions, ${overview.totalRefs} reference sites in the mod.`, "");
  if (overview.kinds.length > 0) {
    lines.push(`| Kind | Count |`, `|---|---|`);
    for (const k of overview.kinds) lines.push(`| ${k.kind.replace(/_/g, " ")} | ${k.count} |`);
    lines.push("");
  }

  lines.push(modRoot ? `## Problems in this mod` : `## Problems`, "");
  const diag = diagnosticsSummary(modRoot);
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

  return lines.join("\n");
}

export async function modReportCommand(lc: LanguageClient, modRoot: string | null = null): Promise<void> {
  showDocPanel("px.modReport", "Mod Report", await buildModReport(lc, modRoot));
}
