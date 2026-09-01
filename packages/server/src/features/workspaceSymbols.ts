/**
 * Fuzzy workspace symbols (Ctrl+T): jump to any indexed definition in the mod
 * or vanilla. Subsequence matching, mod content and better matches first.
 */
import { type WorkspaceSymbol } from "vscode-languageserver/node";
import { URI } from "vscode-uri";
import type { Definition } from "@px-lsp/protocol/types";
import type { ServerData } from "../serverData";
import { lspSymbolKind } from "./symbolKind";

const MAX_RESULTS = 512;

/** Case-insensitive subsequence match with a crude quality score (lower = better). */
function fuzzyScore(query: string, candidate: string): number | null {
  if (query.length === 0) return 1000;
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  if (c === q) return 0;
  if (c.startsWith(q)) return 1;
  const sub = c.indexOf(q);
  if (sub >= 0) return 2 + Math.min(sub, 50);
  let qi = 0;
  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] === q[qi]) qi++;
  }
  if (qi < q.length) return null;
  return 100 + (c.length - q.length);
}

export function provideWorkspaceSymbols(data: ServerData, query: string): WorkspaceSymbol[] {
  const scored: Array<{ score: number; def: Definition }> = [];
  for (const def of data.index.entries()) {
    // Vanilla loc keys are too many to be useful in symbol search.
    if (def.kind === "loc_key" && def.source === "vanilla") continue;
    const score = fuzzyScore(query, def.name);
    if (score === null) continue;
    scored.push({ score: score + (def.source === "mod" ? 0 : 5), def });
  }
  scored.sort((a, b) => a.score - b.score || a.def.name.localeCompare(b.def.name));
  return scored.slice(0, MAX_RESULTS).map(({ def }) => ({
    name: def.name,
    kind: lspSymbolKind(def.kind),
    containerName: `${def.kind.replace(/_/g, " ")} (${def.source})`,
    location: {
      uri: URI.file(def.file).toString(),
      range: { start: { line: def.line, character: 0 }, end: { line: def.line, character: 0 } },
    },
  }));
}
