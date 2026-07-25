/**
 * Find-all-references over the reference index (workspace-mod usage sites)
 * merged with the on-demand vanilla/parent scan (#3 — without it, a name used
 * only by vanilla files listed nothing but its definitions), optionally
 * including the definition sites.
 */
import * as path from "path";
import type { Location, Position } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import type { Reference } from "@px-lsp/protocol/types";
import type { ServerData } from "../serverData";
import { wordRangeAt } from "../wordAt";
import { getLineText } from "../documents";

/** file+line key with the DefinitionIndex's path normalization (win32 is
 * case-insensitive), so lazy-scan paths compare equal to indexed ones. */
function siteKey(file: string, line: number): string {
  const n = path.normalize(file);
  return `${process.platform === "win32" ? n.toLowerCase() : n}|${line}`;
}

export async function provideReferences(
  data: ServerData,
  document: TextDocument,
  position: Position,
  includeDeclaration: boolean,
  lazyRefs?: (name: string) => Promise<Reference[]>
): Promise<Location[]> {
  const range = wordRangeAt(getLineText(document, position.line), position.character);
  if (!range) return [];
  const name = stripPrefix(range.word);

  const refs: Reference[] = data.refIndex.lookup(name).slice();
  if (lazyRefs) {
    // The textual scan cannot tell a non-top-level definition site (inline
    // scripted_trigger, nested title) from a use: drop hits the definition
    // index already knows, they are appended under includeDeclaration below.
    const defSites = new Set(data.index.lookupAll(name).map((d) => siteKey(d.file, d.line)));
    refs.push(...(await lazyRefs(name)).filter((r) => !defSites.has(siteKey(r.file, r.line))));
  }

  const locations: Location[] = refs.map((r) => ({
    uri: URI.file(r.file).toString(),
    range: {
      start: { line: r.line, character: r.startChar },
      end: { line: r.line, character: r.endChar },
    },
  }));

  if (includeDeclaration) {
    for (const d of data.index.lookupAll(name)) {
      locations.push({
        uri: URI.file(d.file).toString(),
        range: { start: { line: d.line, character: 0 }, end: { line: d.line, character: 0 } },
      });
    }
  }
  return locations;
}

/** `scope:x` / `culture:x` under the cursor → the name part. */
export function stripPrefix(word: string): string {
  const colon = word.lastIndexOf(":");
  return colon >= 0 ? word.slice(colon + 1) : word;
}
