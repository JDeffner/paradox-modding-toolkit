import { z } from "zod";
import type { PxtkRequest, PxtkOperation } from "@px-lsp/protocol/agentTools";
import { ToolError } from "./errors";

const limit = z.number().int().min(1).max(200).optional();
const text = z.string().min(1);
const files = z.array(text).min(1).max(200);
const write = {
  write: z.boolean().optional(),
  expect: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
};
export const definitions: Array<{
  operation: PxtkOperation;
  description: string;
  schema: z.ZodRawShape;
  writes?: boolean;
}> = [
  {
    operation: "status",
    description: "Report selected game, mod, loaded documentation and validator availability.",
    schema: {},
  },
  {
    operation: "search",
    description:
      "Search documented identifiers and indexed definitions with bounded matches and source provenance.",
    schema: { query: text, kind: text.optional(), limit },
  },
  {
    operation: "inspect",
    description:
      "Read exact identifier documentation and source. Optionally return sourced examples and measured templates.",
    schema: {
      name: text,
      kind: text.optional(),
      limit,
      examples: z.boolean().optional(),
      templates: z.boolean().optional(),
    },
  },
  {
    operation: "impact",
    description:
      "Find callers, dependencies and override candidates. Reports winner rules and reference coverage limits.",
    schema: { name: text, kind: text.optional(), limit },
  },
  {
    operation: "validate",
    description:
      "Validate saved files. Optional files focus structural checks; Tiger still checks the whole mod. Missing validation is explicit.",
    schema: { files: files.optional(), baseline: text.optional(), limit },
  },
  {
    operation: "init",
    description:
      "Preview toolkit configuration for an existing mod. Explicit write creates it without replacing existing configuration.",
    schema: { ...write },
    writes: true,
  },
  {
    operation: "create",
    description:
      "List supported content kinds or preview a game-derived scaffold and localization. Explicit write applies the preview; expect rejects stale inputs.",
    schema: {
      kind: text.optional(),
      name: text.optional(),
      prefix: text.optional(),
      language: z
        .string()
        .regex(/^[a-z_]+$/)
        .optional(),
      stage: text.optional(),
      ...write,
    },
    writes: true,
  },
  {
    operation: "loc",
    description:
      "Get localization with sources, check language coverage, or preview a key update. Explicit write updates mod files and preserves unrelated content.",
    schema: {
      action: z.enum(["get", "set", "check"]).optional(),
      name: text.optional(),
      value: z.string().optional(),
      language: z
        .string()
        .regex(/^[a-z_]+$/)
        .optional(),
      file: text.optional(),
      stage: text.optional(),
      limit,
      ...write,
    },
    writes: true,
  },
  {
    operation: "logs",
    description:
      "Read and group game error records, retaining unparsed text. Checkpoint optionally creates a new JSON file; since detects log rotation.",
    schema: {
      action: z.enum(["read", "checkpoint"]).optional(),
      file: text.optional(),
      since: text.optional(),
      output: text.optional(),
      limit,
      ...write,
    },
    writes: true,
  },
  {
    operation: "format",
    description:
      "Preview conservative script/GUI indentation. Check reports changes; explicit write applies them. Saved files only.",
    schema: { files, check: z.boolean().optional(), ...write },
    writes: true,
  },
  {
    operation: "image",
    description:
      "Inspect or convert DDS/TGA/PNG/JPEG/WebP files or folders. Preview by default; write creates new mod outputs. Optional resize; DDS output has no mipmaps.",
    schema: {
      action: z.enum(["inspect", "convert"]).optional(),
      files,
      output: text.optional(),
      format: z.enum(["png", "jpeg", "webp", "dds"]).optional(),
      dds: z.enum(["auto", "bc1", "bc3", "bgra8"]).optional(),
      width: z.number().int().min(1).max(16384).optional(),
      height: z.number().int().min(1).max(16384).optional(),
      fit: z.enum(["contain", "cover", "inside", "fill"]).optional(),
      background: text.optional(),
      limit,
      ...write,
    },
    writes: true,
  },
];
export function validateRequest(request: PxtkRequest): void {
  const definition = definitions.find((entry) => entry.operation === request.operation);
  if (!definition) throw new ToolError("unknown_command", "Unknown operation.");
  const args = Object.fromEntries(
    Object.entries(request).filter(([key, value]) => key !== "operation" && value !== undefined)
  );
  const parsed = z.object(definition.schema).strict().safeParse(args);
  if (!parsed.success) throw new ToolError("invalid_arguments", parsed.error.message);
  const readOnly =
    (request.operation === "loc" && request.action !== "set") ||
    (request.operation === "image" && request.action !== "convert") ||
    (request.operation === "logs" && request.action !== "checkpoint") ||
    (request.operation === "create" && !request.kind);
  if (readOnly && (request.write || request.expect))
    throw new ToolError("invalid_arguments", "This action does not write files.");
}
