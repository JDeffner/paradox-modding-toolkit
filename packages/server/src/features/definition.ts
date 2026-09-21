/**
 * Go-to-definition for script identifiers: every source is listed (a mod
 * override AND the vanilla/parent originals), mod definitions first. Showing
 * the shadowed sites too is deliberate — an unintended override of a vanilla
 * or parent-mod name is exactly what a modder wants to notice (#4, #5).
 */
import type { Location, Position } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import type { Definition, DefSource } from "@px-lsp/protocol/types";
import type { ServerData } from "../serverData";
import { wordRangeAt } from "../wordAt";
import { getLineText } from "../documents";
import { datafunctionExprAt } from "./datafunction";
import { definitionsAt } from "./symbolResolution";
import { loadSchema, type SchemaData } from "../schema/loader";

export function provideDefinition(
  data: ServerData,
  document: TextDocument,
  position: Position,
  /** Definitions extracted from the OPEN document itself: the index-free net
   * for same-file declarations (inline scripted_triggers in a vanilla file
   * whose index is stale, missing, or still building — #5). */
  docDefs?: (word: string) => Definition[],
  schema: SchemaData = loadSchema(null)
): Location[] {
  const range = wordRangeAt(getLineText(document, position.line), position.character);
  if (!range) return [];
  return definitionsAt(data, document, position, schema, true, docDefs)
    .sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source])
    .map((d) => toLocation(d.file, d.line));
}

/**
 * Go-to-definition inside localization values, for [ ... ] datafunction
 * expressions only: `Custom2('RelationToMe', …)` jumps to the customizable
 * localization, `scope_name.GetHerHis` chain segments to save sites, etc.
 * Plain loc-key navigation stays with the client-side provider.
 */
export function provideLocDefinition(
  data: ServerData,
  document: TextDocument,
  position: Position,
  schema: SchemaData = loadSchema(null)
): Location[] {
  const lineText = getLineText(document, position.line);
  // Only inside an unclosed [ before the cursor — i.e. within an expression.
  if (datafunctionExprAt(lineText.slice(0, position.character)) === null) return [];
  const isWord = (ch: string) => /[A-Za-z0-9_]/.test(ch);
  let start = position.character;
  while (start > 0 && isWord(lineText[start - 1])) start--;
  let end = position.character;
  while (end < lineText.length && isWord(lineText[end])) end++;
  const word = lineText.slice(start, end);
  if (word.length === 0) return [];
  return provideDefinition(data, document, position, undefined, schema);
}

/** Mod first, then parent, then vanilla; insertion order within a source. */
const SOURCE_ORDER: Record<DefSource, number> = { mod: 0, parent: 1, vanilla: 2 };

function toLocation(file: string, line: number): Location {
  return {
    uri: URI.file(file).toString(),
    range: { start: { line, character: 0 }, end: { line, character: 0 } },
  };
}
