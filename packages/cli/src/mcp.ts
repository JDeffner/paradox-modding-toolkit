import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { definitions } from "./requests";
import type { PxtkOperation, PxtkRequest } from "@px-lsp/protocol/agentTools";
import { resolveConfig, type ResolveOptions } from "./config";
import { execute } from "./operations";
import { errorMessage, ToolError } from "./errors";
import { version } from "../package.json";

export async function serveMcp(config: ResolveOptions, signal: AbortSignal): Promise<void> {
  const lifetime = new AbortController();
  const server = new McpServer({ name: "pxtk", version });
  let queue: Promise<unknown> = Promise.resolve();
  for (const definition of definitions) {
    server.registerTool(
      `pxtk_${definition.operation}`,
      {
        description: definition.description,
        inputSchema: definition.schema,
        annotations: {
          readOnlyHint: !definition.writes,
          destructiveHint: !!definition.writes,
          idempotentHint: !definition.writes,
          openWorldHint: false,
        },
      },
      async (args: Omit<PxtkRequest, "operation">, extra: { signal: AbortSignal }) => {
        const run = async () => {
          try {
            const request: PxtkRequest = { operation: definition.operation as PxtkOperation, ...args };
            const result = await execute(await resolveConfig(config), request, {
              signal: AbortSignal.any([signal, lifetime.signal, extra.signal]),
            });
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result) }],
              structuredContent: { ...result },
              ...(result.status === "incomplete" ? { isError: true } : {}),
            };
          } catch (error) {
            const result = {
              schemaVersion: 1,
              status: "error",
              error: {
                code: error instanceof ToolError ? error.code : "operation_failed",
                message: errorMessage(error),
              },
            };
            return {
              isError: true,
              content: [{ type: "text" as const, text: JSON.stringify(result) }],
              structuredContent: result,
            };
          }
        };
        const result = queue.then(run, run);
        queue = result;
        return result;
      }
    );
  }
  const transport = new StdioServerTransport();
  const stopped = new Promise<void>((resolve) => {
    server.server.onclose = () => {
      lifetime.abort();
      resolve();
    };
  });
  const abort = () => {
    lifetime.abort();
    void server.close().then(
      () => {},
      (error: unknown) => {
        process.stderr.write(errorMessage(error) + "\n");
      }
    );
  };
  signal.addEventListener("abort", abort, { once: true });
  process.stdin.once("end", abort);
  process.stdin.once("error", abort);
  await server.connect(transport);
  if (signal.aborted) abort();
  await stopped;
  await queue;
  signal.removeEventListener("abort", abort);
  process.stdin.removeListener("end", abort);
  process.stdin.removeListener("error", abort);
}
