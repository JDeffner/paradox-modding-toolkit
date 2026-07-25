/**
 * Go-to-definition for script identifiers: every source is listed (a mod
 * override AND the vanilla/parent originals), mod definitions first. Showing
 * the shadowed sites too is deliberate — an unintended override of a vanilla
 * or parent-mod name is exactly what a modder wants to notice (#4, #5).
 */
import type { Location, Position } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import type { DefSource } from "@px-lsp/protocol/types";
import type { ServerData } from "../serverData";
import { wordRangeAt } from "../wordAt";
import { getLineText } from "../documents";
import { datafunctionExprAt } from "./datafunction";

export function provideDefinition(data: ServerData, document: TextDocument, position: Position): Location[] {
  const range = wordRangeAt(getLineText(document, position.line), position.character);
  if (!range) return [];
  return lookupLocations(data, range.word);
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
  position: Position
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
  const locations = lookupLocations(data, word);
  // Quoted arguments ('RelationToMe') are most often custom loc names: when
  // both meanings exist, prefer the customizable_localization definitions.
  if (lineText[start - 1] === "'" && locations.length > 1) {
    const custom = orderedDefs(data, word).filter((d) => d.kind === "customizable_localization");
    if (custom.length > 0) {
      return custom.map((d) => toLocation(d.file, d.line));
    }
  }
  return locations;
}

/** Mod first, then parent, then vanilla; insertion order within a source. */
const SOURCE_ORDER: Record<DefSource, number> = { mod: 0, parent: 1, vanilla: 2 };

function orderedDefs(data: ServerData, word: string) {
  return [...data.index.lookupAll(word)].sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source]);
}

function lookupLocations(data: ServerData, word: string): Location[] {
  return orderedDefs(data, word).map((d) => toLocation(d.file, d.line));
}

function toLocation(file: string, line: number): Location {
  return {
    uri: URI.file(file).toString(),
    range: { start: { line, character: 0 }, end: { line, character: 0 } },
  };
}
