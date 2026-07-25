/**
 * Safe rename across script and localization: definition sites + every indexed
 * reference (scope:x, ref fields, loc-key usages). Only names whose every
 * definition lives in the mod are renameable — renaming a vanilla override
 * would silently un-override it.
 */
import {
  ResponseError,
  type Position,
  type Range as LspRange,
  type TextEdit,
  type WorkspaceEdit,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import * as fs from "fs";
import type { Definition } from "@paradox-lsp/protocol/types";
import { wholeNamePattern } from "@paradox-lsp/protocol/regex";
import type { ServerData } from "../serverData";
import { activeProfile } from "../games/active";
import { wordRangeAt } from "../wordAt";
import { getLineText } from "../documents";
import { stripPrefix } from "./references";

const VALID_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

interface RenameTarget {
  name: string;
  defs: Definition[];
  /** Range of the name under the cursor. */
  range: LspRange;
}

function targetAt(data: ServerData, document: TextDocument, position: Position): RenameTarget {
  const lineText = getLineText(document, position.line);
  const range = wordRangeAt(lineText, position.character);
  if (!range) throw new ResponseError(0, "No renameable name at the cursor.");
  const name = stripPrefix(range.word);
  const prefixLen = range.word.length - name.length;

  const defs = data.index.lookupAll(name);
  if (defs.length === 0) {
    throw new ResponseError(
      0,
      `No indexed definition of "${name}" — only indexed names can be renamed safely.`
    );
  }
  const foreign = defs.find((d) => d.source !== "mod");
  if (foreign) {
    throw new ResponseError(
      0,
      `"${name}" is defined in ${foreign.source} content; only names defined solely by the mod can be renamed.`
    );
  }
  return {
    name,
    defs,
    range: {
      start: { line: position.line, character: range.start + prefixLen },
      end: { line: position.line, character: range.end },
    },
  };
}

export function prepareRename(data: ServerData, document: TextDocument, position: Position): LspRange {
  return targetAt(data, document, position).range;
}

export function provideRename(
  data: ServerData,
  document: TextDocument,
  position: Position,
  newName: string,
  readOpenDocument: (uri: string) => TextDocument | undefined
): WorkspaceEdit {
  const target = targetAt(data, document, position);
  if (!VALID_NAME.test(newName)) {
    throw new ResponseError(0, `"${newName}" is not a valid ${activeProfile().shortName} identifier.`);
  }

  const editsByUri = new Map<string, TextEdit[]>();
  const seen = new Set<string>();
  const addEdit = (file: string, line: number, startChar: number, endChar: number) => {
    const uri = URI.file(file).toString();
    const key = `${uri}:${line}:${startChar}`;
    if (seen.has(key)) return;
    seen.add(key);
    let list = editsByUri.get(uri);
    if (!list) editsByUri.set(uri, (list = []));
    list.push({
      range: { start: { line, character: startChar }, end: { line, character: endChar } },
      newText: newName,
    });
  };

  // Reference sites carry precise ranges.
  for (const ref of data.refIndex.lookup(target.name)) {
    addEdit(ref.file, ref.line, ref.startChar, ref.endChar);
  }

  // Definition sites: locate the name on its recorded line.
  for (const def of target.defs) {
    const lineText = readLine(def, readOpenDocument);
    if (lineText === null) continue;
    const col = findNameOnLine(lineText, target.name);
    if (col < 0) continue;
    addEdit(def.file, def.line, col, col + target.name.length);
  }

  const changes: Record<string, TextEdit[]> = {};
  for (const [uri, edits] of editsByUri) changes[uri] = edits;
  return { changes };
}

function readLine(
  def: Definition,
  readOpenDocument: (uri: string) => TextDocument | undefined
): string | null {
  const uri = URI.file(def.file).toString();
  const open = readOpenDocument(uri);
  if (open) return getLineText(open, def.line);
  try {
    const lines = fs.readFileSync(def.file, "utf8").replace(/^﻿/, "").split(/\r?\n/);
    return lines[def.line] ?? null;
  } catch {
    return null;
  }
}

/** First word-boundary occurrence of `name` on the line. */
function findNameOnLine(lineText: string, name: string): number {
  const re = new RegExp(wholeNamePattern(name));
  const m = re.exec(lineText);
  return m ? m.index : -1;
}
