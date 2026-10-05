import { parseArgs } from "node:util";
import type { PxtkOperation, PxtkResult, PxtkRequest } from "@px-lsp/protocol/agentTools";
import { resolveConfig, type ConfigInput } from "./config";
import { execute, exitCode } from "./operations";
import { errorMessage, ToolError } from "./errors";
import { serveMcp } from "./mcp";
import { version } from "../package.json";

const HELP = `pxtk ${version} - Paradox Modding Toolkit

Usage:
  pxtk status [options]
  pxtk search <text> [--kind <kind>] [--limit <1..200>] [options]
  pxtk inspect <name> [--kind <kind>] [options]
  pxtk impact <name> [--kind <kind>] [options]
  pxtk validate [--baseline <file>] [--write-baseline <new-file>] [options]
  pxtk mcp [options]
  pxtk init [--write]
  pxtk create [kind] [name] [--prefix <prefix>] [--stage <stage>] [--write]
  pxtk loc get|set|check [key] [--value <text>] [--file <file>] [--write]
  pxtk logs [read|checkpoint] [--file <log>] [--since <checkpoint>] [--output <new-file>] [--write]
  pxtk format <files...> [--check | --write]
  pxtk image inspect <files-or-folders...>
  pxtk image convert <files-or-folders...> --to png|jpeg|webp|dds --output <file-or-folder> [--write]

Preparation options:
  --expect <token>     Reject a stale preview when applying --write
  --width <pixels>     Resize image width (height is optional)
  --height <pixels>    Resize image height (width is optional)
  --fit <mode>         contain (default), cover, inside or fill
  --background <color> Required for JPEG when pixels are transparent
  --dds <format>      auto (default), bc1, bc3 or bgra8; no mipmaps
  --examples          Include a separate sourced example list in inspect
  --templates         Include measured script templates in inspect

Options:
  --game <id>          Required game selection (or PX_GAME_ID / config)
  --mod <folder>       Editable mod folder; defaults to the project folder
  --game-path <path>   Game install or data folder; Steam detection if omitted
  --logs-path <path>   Folder containing generated script_docs
  --tiger <path>       Tiger executable
  --tiger-config <file> Existing Tiger configuration
  --parent <folder>   Dependency mod; repeat in load order, base first
  --config <file>     JSON config; default: nearest .px-toolkit/pxtk.json
  --language <name>   Localization language (default: english)
  --timeout <seconds> Operation timeout (default: 300)
  --json              Versioned JSON output; errors are JSON too
  --help              Show this help
  --version           Show the installed version

Commands read saved files. Utility writes need --write; the default is a preview.
Vanilla and dependencies are read-only. Image outputs never replace existing files.
Baselines use exclusive creation and never replace an existing file.
Exit codes: 0 = success/no new errors, 1 = findings/no match/ambiguity,
2 = invalid input, incomplete validation, or execution failure.
`;
function human(result: PxtkResult): string {
  const lines = [
    `pxtk ${result.operation}: ${result.status}`,
    `Game: ${result.sources.game} ${result.sources.gameVersion} | Docs: ${result.sources.documentation}`,
    `Mod: ${result.sources.mod}`,
  ];
  if (result.operation === "validate") {
    const data = result.data;
    lines.push(`New errors: ${data.newErrors}; existing findings: ${data.existingFindings}`);
  }
  lines.push(JSON.stringify(result.data, null, 2));
  if (result.warnings.length) lines.push(...result.warnings.map((warning) => `Note: ${warning}`));
  return lines.join("\n") + "\n";
}
async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  try {
    const parsed = parseArgs({
      allowPositionals: true,
      options: {
        game: { type: "string" },
        mod: { type: "string" },
        "game-path": { type: "string" },
        "logs-path": { type: "string" },
        tiger: { type: "string" },
        "tiger-config": { type: "string" },
        parent: { type: "string", multiple: true },
        config: { type: "string" },
        language: { type: "string" },
        timeout: { type: "string" },
        kind: { type: "string" },
        limit: { type: "string" },
        baseline: { type: "string" },
        "write-baseline": { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean" },
        version: { type: "boolean" },
        write: { type: "boolean" },
        check: { type: "boolean" },
        expect: { type: "string" },
        file: { type: "string" },
        output: { type: "string" },
        value: { type: "string" },
        prefix: { type: "string" },
        stage: { type: "string" },
        since: { type: "string" },
        to: { type: "string" },
        dds: { type: "string" },
        width: { type: "string" },
        height: { type: "string" },
        fit: { type: "string" },
        background: { type: "string" },
        examples: { type: "boolean" },
        templates: { type: "boolean" },
      },
    });
    if (parsed.values.version) {
      process.stdout.write(version + "\n");
      return;
    }
    if (parsed.values.help || !parsed.positionals.length) {
      process.stdout.write(HELP);
      return;
    }
    const [operation, term, ...extra] = parsed.positionals;
    if (
      ![
        "status",
        "search",
        "inspect",
        "impact",
        "validate",
        "mcp",
        "init",
        "create",
        "loc",
        "logs",
        "format",
        "image",
      ].includes(operation)
    )
      throw new ToolError("unknown_command", `Unknown command: ${operation}. Run pxtk --help.`);
    const maxTerms = ["create", "loc"].includes(operation)
      ? 2
      : ["image", "format", "validate"].includes(operation)
        ? Infinity
        : ["search", "inspect", "impact", "logs"].includes(operation)
          ? 1
          : 0;
    if (parsed.positionals.length - 1 > maxTerms)
      throw new ToolError(
        "invalid_arguments",
        "Unexpected positional argument. Quote search text containing spaces."
      );
    const v = parsed.values;
    if ((v.baseline || v["write-baseline"]) && operation !== "validate")
      throw new ToolError("invalid_arguments", "Baseline options belong to validate.");
    if (v.baseline && v["write-baseline"])
      throw new ToolError("invalid_arguments", "Choose baseline comparison or baseline creation.");
    const overrides: ConfigInput = {
      ...(v.game !== undefined ? { game: v.game } : {}),
      ...(v.mod !== undefined ? { mod: v.mod } : {}),
      ...(v["game-path"] !== undefined ? { gamePath: v["game-path"] } : {}),
      ...(v["logs-path"] !== undefined ? { logsPath: v["logs-path"] } : {}),
      ...(v.tiger !== undefined ? { tigerPath: v.tiger } : {}),
      ...(v["tiger-config"] !== undefined ? { tigerConfig: v["tiger-config"] } : {}),
      ...(v.parent !== undefined ? { parents: v.parent } : {}),
      ...(v.language !== undefined ? { language: v.language } : {}),
      ...(v.timeout !== undefined ? { timeout: Number(v.timeout) } : {}),
    };
    const configOptions = { config: v.config, overrides };
    if (operation === "mcp") {
      await serveMcp(configOptions, controller.signal);
      return;
    }
    const result = await execute(
      await resolveConfig(configOptions),
      {
        operation: operation as PxtkOperation,
        query: operation === "search" ? term : undefined,
        name:
          operation === "create" || operation === "loc"
            ? extra[0]
            : ["inspect", "impact"].includes(operation)
              ? term
              : undefined,
        kind: operation === "create" ? term : v.kind,
        limit: v.limit === undefined ? undefined : Number(v.limit),
        baseline: v.baseline,
        action: ["loc", "logs", "image"].includes(operation) ? term : undefined,
        files:
          operation === "image"
            ? extra
            : ["format", "validate"].includes(operation) && term
              ? [term, ...extra]
              : undefined,
        write: v.write,
        check: v.check,
        expect: v.expect,
        file: v.file,
        output: v.output,
        value: v.value,
        prefix: v.prefix,
        stage: v.stage,
        since: v.since,
        format: v.to as PxtkRequest["format"],
        dds: v.dds as PxtkRequest["dds"],
        width: v.width === undefined ? undefined : Number(v.width),
        height: v.height === undefined ? undefined : Number(v.height),
        fit: v.fit as PxtkRequest["fit"],
        background: v.background,
        examples: v.examples,
        templates: v.templates,
      },
      { signal: controller.signal, writeBaseline: v["write-baseline"] }
    );
    process.stdout.write(json ? JSON.stringify(result) + "\n" : human(result));
    process.exitCode = exitCode(result);
  } catch (error) {
    const output = {
      schemaVersion: 1,
      status: "error",
      error: {
        code: error instanceof ToolError ? error.code : "operation_failed",
        message: errorMessage(error),
      },
    };
    if (json) process.stdout.write(JSON.stringify(output) + "\n");
    else process.stderr.write(`pxtk: ${output.error.message}\n`);
    process.exitCode = 2;
  }
}
void main();
