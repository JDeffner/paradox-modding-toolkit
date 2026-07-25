/**
 * paradox/modOverview: the mod's content inventory by kind, for the Mod Overview
 * tree. Definition lists are capped per kind; counts stay exact.
 */
import type { ModOverview, OverviewKind } from "@px-lsp/protocol/protocol";
import type { ServerData } from "../serverData";

const DEFS_CAP = 500;

export function computeModOverview(
  data: ServerData,
  inFocus: (file: string) => boolean = () => true
): ModOverview {
  const byKind = new Map<string, OverviewKind>();
  let total = 0;
  for (const def of data.index.allDefinitions()) {
    if (def.source !== "mod" || !inFocus(def.file)) continue;
    total++;
    let bucket = byKind.get(def.kind);
    if (!bucket) byKind.set(def.kind, (bucket = { kind: def.kind, count: 0, defs: [] }));
    bucket.count++;
    if (bucket.defs.length < DEFS_CAP) {
      bucket.defs.push({ name: def.name, file: def.file, line: def.line });
    }
  }
  const kinds = [...byKind.values()].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  for (const k of kinds) k.defs.sort((a, b) => a.name.localeCompare(b.name));
  return { kinds, totalDefs: total, totalRefs: data.refIndex.size };
}
