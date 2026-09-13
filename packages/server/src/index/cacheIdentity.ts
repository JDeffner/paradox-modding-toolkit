// Node-only cache hashing stays outside indexer.ts, which browser clients import.
import { createHash } from "crypto";
import * as path from "path";
import type { SchemaEntry } from "../schema/types";
import type { IndexCacheIdentity } from "./indexer";

export function createIndexCacheIdentity(
  gamePath: string,
  entries: readonly SchemaEntry[]
): IndexCacheIdentity {
  // resolve removes relative segments and trailing separators; Windows paths
  // are case-insensitive, but POSIX installations may differ only by case.
  const absoluteRoot = path.resolve(gamePath);
  const gameRoot = process.platform === "win32" ? absoluteRoot.toLowerCase() : absoluteRoot;
  // Only these fields affect scanRootChunked/extractDefinitions. Preserve entry
  // order because overlapping folders contribute definitions in scan order.
  const extraction = entries.map((entry) => [
    entry.path,
    entry.kind,
    entry.ext ?? ".txt",
    entry.extraction ?? "top-level-key",
  ]);
  const schemaHash = createHash("sha256").update(JSON.stringify(extraction)).digest("hex");
  return { gameRoot, schemaHash };
}

/** Keep separate installations and schema overlays reusable in shared storage. */
export function indexCacheKey(identity: IndexCacheIdentity): string {
  return createHash("sha256")
    .update(JSON.stringify([identity.gameRoot, identity.schemaHash]))
    .digest("hex");
}
