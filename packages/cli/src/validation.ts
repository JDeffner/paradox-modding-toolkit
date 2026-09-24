import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Diagnostic } from "vscode-languageserver";
import { startTiger } from "@px-lsp/protocol/tigerProcess";
import { prepareTigerConfig } from "@px-lsp/protocol/tigerConfig";
import { resolveConfigDir } from "@px-lsp/protocol/configDir";
import { decode } from "@px-lsp/server/parser";
import { detectGameVersion } from "@px-lsp/server/index/indexer";
import type { Configuration } from "./config";
import { digest, isWithin } from "./config";
import { contentFiles, languageFor } from "./files";
import { ToolError, errorMessage } from "./errors";
import { targetPath } from "./writes";
import type { LspSession } from "./lsp";
import { z } from "zod";

const exec = promisify(execFile);
export const findingSchema = z.object({
  source: z.enum(["structural", "tiger"]),
  code: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  message: z.string(),
  file: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  column: z.number().int().positive().nullable(),
});
export type Finding = z.infer<typeof findingSchema>;
export interface Validation {
  complete: boolean;
  scope: { structural: "selected_files" | "workspace"; tiger: "workspace"; selected: string[] };
  baselineApplied: boolean;
  structural: { status: "complete"; files: number };
  tiger: {
    status: "complete" | "unavailable" | "failed";
    version?: string;
    reason?: string;
    stderr?: string;
    config?: string | null;
  };
  context: Record<string, string>;
  findings: Finding[];
  newFindings: Finding[];
  existingFindings: number;
  resolvedFindings: Finding[];
}
export const baselineSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal("pxtk-baseline"),
    context: z.record(z.string(), z.string()),
    findings: z.array(findingSchema),
  })
  .strict();
export type Baseline = z.infer<typeof baselineSchema>;
function findingKey(finding: Finding): string {
  return JSON.stringify([finding.source, finding.code, finding.severity, finding.file, finding.message]);
}
export function compareBaseline(
  current: Finding[],
  baseline: Finding[]
): { newFindings: Finding[]; existingFindings: number; resolvedFindings: Finding[] } {
  const remaining = new Map<string, Finding[]>();
  for (const finding of baseline) {
    const key = findingKey(finding);
    const bucket = remaining.get(key) ?? [];
    bucket.push(finding);
    remaining.set(key, bucket);
  }
  const newFindings: Finding[] = [];
  let existingFindings = 0;
  for (const finding of current) {
    const bucket = remaining.get(findingKey(finding));
    if (bucket?.length) {
      bucket.pop();
      existingFindings++;
    } else newFindings.push(finding);
  }
  return { newFindings, existingFindings, resolvedFindings: [...remaining.values()].flat() };
}
function structuralFinding(config: Configuration, file: string, diagnostic: Diagnostic): Finding {
  return {
    source: "structural",
    code: String(diagnostic.code ?? "unknown"),
    severity: diagnostic.severity === 1 ? "error" : diagnostic.severity === 2 ? "warning" : "info",
    message: typeof diagnostic.message === "string" ? diagnostic.message : diagnostic.message.value,
    file: path.relative(config.mod, file).replace(/\\/g, "/"),
    line: diagnostic.range.start.line + 1,
    column: diagnostic.range.start.character + 1,
  };
}
async function tiger(
  config: Configuration,
  signal?: AbortSignal
): Promise<{ result: Validation["tiger"]; findings: Finding[]; identity: string }> {
  if (!config.meta.tiger)
    return {
      result: { status: "unavailable", reason: "This game profile has no configured Tiger integration." },
      findings: [],
      identity: "unsupported",
    };
  if (!config.tigerPath || !config.gamePath)
    return {
      result: { status: "unavailable", reason: "Set tigerPath and gamePath to run deep validation." },
      findings: [],
      identity: "unconfigured",
    };
  let prepared: ReturnType<typeof prepareTigerConfig> | undefined;
  try {
    const { stdout: versionText } = await exec(config.tigerPath, ["--version"], {
      timeout: Math.min(10_000, config.timeoutMs),
      windowsHide: true,
      signal,
    });
    const version = versionText.trim();
    prepared = prepareTigerConfig({
      modRoot: config.mod,
      configDir: resolveConfigDir(config.mod, config.meta),
      confName: config.meta.tiger.confName,
      descriptor: config.meta.descriptor,
      parentPaths: config.parents,
      explicitConfig: config.tigerConfig,
    });
    const gameRoot =
      path.basename(config.gamePath).toLowerCase() === "game"
        ? path.dirname(config.gamePath)
        : config.gamePath;
    const run = await startTiger(
      config.tigerPath,
      ["--json", ...prepared.args, `--${config.game}`, gameRoot, config.mod],
      { cwd: config.mod, signal, timeoutMs: config.timeoutMs }
    ).result;
    const findings: Finding[] = run.reports.map((report) => {
      const location = report.locations[0];
      const file = location ? path.resolve(config.mod, location.fullpath ?? location.path) : null;
      return {
        source: "tiger",
        code: report.key,
        severity: /^(fatal|error)$/i.test(report.severity)
          ? "error"
          : report.severity.toLowerCase() === "warning"
            ? "warning"
            : "info",
        message: report.info ? `${report.message}\n${report.info}` : report.message,
        file: file ? path.relative(config.mod, file).replace(/\\/g, "/") : null,
        line: location?.linenr && location.linenr > 0 ? location.linenr : null,
        column: location?.column && location.column > 0 ? location.column : null,
      };
    });
    return {
      result: {
        status: "complete",
        version,
        config: prepared.source,
        ...(run.stderr ? { stderr: run.stderr.slice(0, 4000) } : {}),
      },
      findings,
      identity: digest(version + "\n" + prepared.text),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { result: { status: "failed", reason: errorMessage(error) }, findings: [], identity: "failed" };
  } finally {
    prepared?.dispose();
  }
}
export async function validate(
  config: Configuration,
  session: LspSession,
  referenceIdentity: string,
  baselineFile?: string,
  signal?: AbortSignal,
  selected?: string[]
): Promise<Validation> {
  const findings: Finding[] = [];
  const files = selected?.length
    ? [...new Set(await Promise.all(selected.map((file) => targetPath(config, file))))].sort()
    : await contentFiles(config.mod);
  if (files.some((file) => !languageFor(file)))
    throw new ToolError("unsupported_file", "Validation selection contains an unsupported file.");
  for (const file of files) {
    signal?.throwIfAborted();
    const diagnostics = await session.diagnostics(
      file,
      languageFor(file)!,
      decode(await fs.readFile(file)).text
    );
    findings.push(...diagnostics.map((diagnostic) => structuralFinding(config, file, diagnostic)));
  }
  const deep = await tiger(config, signal);
  findings.push(...deep.findings);
  const context = {
    game: config.game,
    gamePath: config.gamePath ?? "",
    gameVersion: config.gamePath ? detectGameVersion(config.gamePath) : "unknown",
    mod: config.mod,
    parents: JSON.stringify(config.parents),
    language: config.language,
    serverVersion: session.serverVersion,
    tiger: deep.identity,
    referenceIdentity,
    selection: selected?.length
      ? JSON.stringify(files.map((file) => path.relative(config.mod, file)))
      : "workspace",
  };
  const result: Validation = {
    complete: deep.result.status === "complete",
    scope: {
      structural: selected?.length ? "selected_files" : "workspace",
      tiger: "workspace",
      selected: selected?.length ? files.map((file) => path.relative(config.mod, file)) : [],
    },
    baselineApplied: false,
    structural: { status: "complete", files: files.length },
    tiger: deep.result,
    context,
    findings,
    newFindings: findings,
    existingFindings: 0,
    resolvedFindings: [],
  };
  if (baselineFile && result.complete) {
    let baseline: Baseline;
    try {
      baseline = baselineSchema.parse(JSON.parse(await fs.readFile(baselineFile, "utf8")));
    } catch (error) {
      throw new ToolError("invalid_baseline", `Cannot read baseline: ${errorMessage(error)}`);
    }
    for (const [key, value] of Object.entries(context)) {
      if (baseline.context[key] !== value)
        throw new ToolError(
          "baseline_mismatch",
          `Baseline ${key} differs. Create a fresh baseline for these validation inputs.`
        );
    }
    Object.assign(result, compareBaseline(findings, baseline.findings));
    result.baselineApplied = true;
  }
  return result;
}
export async function writeBaseline(file: string, validation: Validation, mod: string): Promise<void> {
  if (!validation.complete)
    throw new ToolError(
      "incomplete_validation",
      "A baseline requires completed structural and Tiger validation."
    );
  const target = path.resolve(file);
  const realParent = await fs.realpath(path.dirname(target));
  if (path.extname(target).toLowerCase() !== ".json" || !isWithin(mod, realParent)) {
    throw new ToolError(
      "invalid_baseline_path",
      "Create the JSON baseline inside the editable mod, in an existing folder."
    );
  }
  const baseline: Baseline = {
    schemaVersion: 1,
    type: "pxtk-baseline",
    context: validation.context,
    findings: validation.findings,
  };
  // Exclusive creation preserves an existing baseline, even if another process creates it first.
  await fs.writeFile(path.join(realParent, path.basename(target)), JSON.stringify(baseline, null, 2) + "\n", {
    encoding: "utf8",
    flag: "wx",
  });
}
