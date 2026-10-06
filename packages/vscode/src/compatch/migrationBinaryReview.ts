import { inspectDdsResource } from "@px-lsp/server/dds/migrateMips";

/** Describe the captured bytes under review, without reopening a live input. */
export function migrationBinaryReview(
  relative: string,
  before: Uint8Array | undefined,
  after: Uint8Array | undefined,
  planHash: string
): string {
  const lines = [
    relative,
    `Before: ${before?.length ?? 0} bytes`,
    `After: ${after?.length ?? 0} bytes`,
    `Plan: ${planHash}`,
  ];
  if (/\.dds$/i.test(relative)) {
    for (const [label, bytes] of [
      ["Before", before],
      ["After", after],
    ] as const) {
      lines.push("", label);
      if (!bytes) {
        lines.push("File absent");
        continue;
      }
      try {
        const resource = inspectDdsResource(bytes);
        lines.push(
          `Dimensions: ${resource.width} x ${resource.height}`,
          `Format: ${resource.format}`,
          `Resource: ${resource.resourceKind}`,
          `Stored mip levels: ${resource.mipLevelCount} (includes the base image)`
        );
        lines.push(
          ...resource.levels.map(
            (level) => `  Level ${level.level}: ${level.width} x ${level.height}, ${level.byteLength} bytes`
          )
        );
      } catch (error) {
        lines.push(
          `DDS metadata could not be read: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
  lines.push(
    "",
    "Check the recipe's consumer evidence and validation results before applying. Header and byte checks do not establish that the target game renders the texture correctly."
  );
  return lines.join("\n");
}
