import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { ErrorLogParser } from "@px-lsp/protocol/errorLogParser";
import type { PxtkRequest } from "@px-lsp/protocol/agentTools";
import { digest, type Configuration } from "./config";
import { ToolError } from "./errors";
import { changeFor, finishChanges, utf8 } from "./writes";

const checkpointSchema = z
  .object({
    type: z.literal("pxtk-log-checkpoint"),
    version: z.literal(1),
    file: z.string(),
    offset: z.number().int().nonnegative(),
    prefix: z.string().regex(/^[a-f0-9]{64}$/),
    identity: z.string(),
  })
  .strict();
export async function logs(
  config: Configuration,
  request: PxtkRequest,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const action = request.action ?? "read";
  if (!["read", "checkpoint"].includes(action))
    throw new ToolError("invalid_action", "Use logs read or checkpoint.");
  if (!request.file && !config.logsPath)
    throw new ToolError("logs_required", "Supply --file for error.log, or configure logsPath.");
  const folder =
    config.logsPath && (config.meta.scriptDocsSubdir ?? "logs") !== (config.meta.errorLogSubdir ?? "logs")
      ? path.join(path.dirname(config.logsPath), config.meta.errorLogSubdir ?? "logs")
      : config.logsPath;
  const file = await fs.realpath(
    request.file ? path.resolve(config.mod, request.file) : path.join(folder!, "error.log")
  );
  const stat = await fs.stat(file);
  if (stat.size > 32 * 1024 * 1024)
    throw new ToolError("log_too_large", "Log exceeds 32 MiB. Select a smaller saved log.");
  const bytes = await fs.readFile(file);
  const end = bytes.lastIndexOf(10) + 1;
  const identity = [stat.dev, stat.ino, stat.birthtimeMs].join(":");
  const checkpoint = {
    type: "pxtk-log-checkpoint",
    version: 1,
    file,
    offset: end,
    prefix: digest(bytes.subarray(0, end)),
    identity,
  };
  if (action === "checkpoint") {
    if (!request.output) {
      if (request.write) throw new ToolError("output_required", "Supply --output for a saved checkpoint.");
      return { checkpoint, pendingBytes: bytes.length - end };
    }
    const change = await changeFor(config, request.output, JSON.stringify(checkpoint, null, 2) + "\n");
    if (change.before) throw new ToolError("output_exists", "Choose a new checkpoint filename.");
    return { checkpoint, ...(await finishChanges(config, request, [change], [{ file, bytes }], signal)) };
  }
  let offset = 0;
  let resetReason: string | null = null;
  if (request.since) {
    const old = checkpointSchema.parse(
      JSON.parse(utf8(await fs.readFile(path.resolve(config.mod, request.since))))
    );
    if (old.file !== file)
      throw new ToolError("checkpoint_mismatch", "Checkpoint belongs to another log file.");
    if (old.identity !== identity || old.offset > end || digest(bytes.subarray(0, old.offset)) !== old.prefix)
      resetReason = "Log was replaced, truncated, or rewritten. Reading the current file from its start.";
    else offset = old.offset;
  }
  const groups = new Map<
    string,
    {
      message: string;
      textTruncated: boolean;
      file: string | null;
      line: number | null;
      severity: string;
      count: number;
      raw: string;
      parsed: boolean;
    }
  >();
  let position = 0;
  let block: string[] = [];
  let blockEnd = 0;
  const flush = () => {
    if (!block.length || blockEnd <= offset) {
      block = [];
      return;
    }
    const parser = new ErrorLogParser();
    let parsed: ReturnType<ErrorLogParser["push"]> = null;
    for (const line of block) parsed = parser.push(line) ?? parsed;
    const raw = block.join("\n");
    const message =
      parsed?.message ?? raw.replace(/^\[\d{2}:\d{2}:\d{2}\](?:\[[EW]\])?(?:\[[^\]]*\]:\s*)?/, "");
    const item = {
      message: message.slice(0, 4000),
      textTruncated: message.length > 4000 || raw.length > 4000,
      file: parsed?.relFile ?? null,
      line: parsed?.line == null ? null : parsed.line + 1,
      severity: parsed?.severity ?? (/^\[[^\]]+\]\[W\]/.test(raw) ? "warning" : "unknown"),
      count: 1,
      raw: raw.slice(0, 4000),
      parsed: parsed !== null,
    };
    const key = JSON.stringify([message, item.file, item.line, item.severity]);
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, item);
    block = [];
  };
  for (const line of utf8(bytes.subarray(0, end)).split(/(?<=\n)/)) {
    signal?.throwIfAborted();
    if (/^\[\d{2}:\d{2}:\d{2}\]/.test(line)) flush();
    position += Buffer.byteLength(line);
    if (line.trim()) block.push(line.replace(/\r?\n$/, ""));
    blockEnd = position;
  }
  flush();
  const all = [...groups.values()];
  const limit = request.limit ?? 20;
  return {
    file,
    checkpoint,
    resetReason,
    pendingBytes: bytes.length - end,
    entries: { items: all.slice(0, limit), total: all.length, truncated: all.length > limit },
    occurrences: all.reduce((n, item) => n + item.count, 0),
    coverage:
      "Complete lines only. A record continued after the checkpoint includes its preceding context. Unparsed records are retained.",
  };
}
