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
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import * as fs from "fs";
import type { Definition } from "@px-lsp/protocol/types";
import { wholeNamePattern } from "@px-lsp/protocol/regex";
import type { ServerData } from "../serverData";
import { activeProfile } from "../games/active";
import { wordRangeAt } from "../wordAt";
import { getLineText } from "../documents";
import { stripPrefix } from "./references";
import { definitionsAt } from "./symbolResolution";
import { loadSchema, schemaEntryForPath, type SchemaData } from "../schema/loader";
import { clientCapabilities } from "../clientMode";
import { extractDefinitions } from "../index/extract";
import { extractReferences } from "../index/references";
import { evictParse } from "../parseCache";

const VALID_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

interface RenameTarget {
  name: string;
  defs: Definition[];
  /** Range of the name under the cursor. */
  range: LspRange;
}

function targetAt(
  data: ServerData,
  document: TextDocument,
  position: Position,
  schema: SchemaData
): RenameTarget {
  const lineText = getLineText(document, position.line);
  const range = wordRangeAt(lineText, position.character);
  if (!range) throw new ResponseError(0, "No renameable name at the cursor.");
  const name = stripPrefix(range.word);
  const prefixLen = range.word.length - name.length;

  const defs = definitionsAt(data, document, position, schema, true);
  if (defs.length === 0) {
    throw new ResponseError(
      0,
      `No indexed definition of "${name}" — only indexed names can be renamed safely.`
    );
  }
  const foreign = defs.find((d) => d.source !== "mod");
  if (new Set(defs.map((d) => d.kind)).size !== 1) {
    throw new ResponseError(
      0,
      "This name has several possible symbol types here. Rename from its declaration."
    );
  }
  if (defs.some((d) => schema.entries.some((entry) => entry.nestedDefinitions?.kind === d.kind))) {
    throw new ResponseError(
      0,
      "Rename is unavailable for nested definitions because not all indirect reference forms are indexed."
    );
  }
  if (
    defs.some(
      (d) =>
        activeProfile().schema.some((e) => e.extraction === "named-block" && e.kind === d.kind) ||
        d.kind === "scripted_gui" ||
        d.kind === "gui_type"
    )
  ) {
    throw new ResponseError(
      0,
      "Rename is unavailable for this symbol type because not all graphics/GUI reference forms are indexed."
    );
  }
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

export function prepareRename(
  data: ServerData,
  document: TextDocument,
  position: Position,
  schema = loadSchema(null)
): LspRange {
  return targetAt(data, document, position, schema).range;
}

export function provideRename(
  data: ServerData,
  document: TextDocument,
  position: Position,
  newName: string,
  readOpenDocument: (uri: string) => TextDocument | undefined,
  schema = loadSchema(null),
  isWritable?: (file: string) => boolean
): WorkspaceEdit {
  const target = targetAt(data, document, position, schema);
  if (!VALID_NAME.test(newName)) {
    throw new ResponseError(0, `"${newName}" is not a valid ${activeProfile().shortName} identifier.`);
  }

  if (newName !== target.name && data.index.lookupAll(newName).some((d) => d.kind === target.defs[0].kind)) {
    throw new ResponseError(
      0,
      `A ${target.defs[0].kind.replace(/_/g, " ")} named "${newName}" already exists.`
    );
  }
  const editsByUri = new Map<string, TextEdit[]>();
  const documents = new Map<string, { document: TextDocument; version: number | null }>();
  const read = (file: string) => {
    const uri = URI.file(file).toString();
    if (isWritable && !isWritable(file)) throw new ResponseError(0, "Rename would modify read-only content.");
    let snapshot = documents.get(uri);
    if (!snapshot) {
      const open = readOpenDocument(uri);
      let text: string;
      try {
        text = open?.getText() ?? fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
      } catch {
        throw new ResponseError(0, `Cannot read ${file}; rename was not applied.`);
      }
      if (open && !clientCapabilities().documentChanges) {
        let disk: string;
        try {
          disk = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
        } catch {
          throw new ResponseError(0, "This client cannot version-check unsaved rename edits. Save first.");
        }
        if (disk !== text)
          throw new ResponseError(0, "This client cannot version-check unsaved rename edits. Save first.");
      }
      if (!open) evictParse(uri);
      snapshot = {
        document: open ?? TextDocument.create(uri, "paradox", 1, text),
        version: open?.version ?? null,
      };
      documents.set(uri, snapshot);
    }
    return snapshot.document;
  };
  const seen = new Set<string>();
  const addEdit = (file: string, line: number, startChar: number, endChar: number) => {
    const current = read(file);
    const text = getLineText(current, line);
    if (text.slice(startChar, endChar) !== target.name) {
      throw new ResponseError(0, "A rename source changed. Request rename again after the index refreshes.");
    }
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

  const currentRefs = new Map<string, ReturnType<typeof extractReferences>>();
  const referencesIn = (file: string, doc: TextDocument) => {
    let refs = currentRefs.get(doc.uri);
    if (!refs) {
      refs = extractReferences(doc.getText(), file, "mod", schema);
      currentRefs.set(doc.uri, refs);
    }
    return refs;
  };

  // Reference sites carry precise ranges.
  for (const ref of data.refIndex.lookup(target.name)) {
    if (!ref.kinds.includes(target.defs[0].kind)) continue;
    const current = read(ref.file);
    const valid = referencesIn(ref.file, current).references.some(
      (r) =>
        r.name === target.name &&
        r.line === ref.line &&
        r.startChar === ref.startChar &&
        r.endChar === ref.endChar &&
        r.kinds.includes(target.defs[0].kind)
    );
    if (!valid) throw new ResponseError(0, "A rename reference changed. Request rename again.");
    const meanings = definitionsAt(data, current, { line: ref.line, character: ref.startChar }, schema, true);
    if (meanings.some((d) => d.kind !== target.defs[0].kind)) {
      throw new ResponseError(
        0,
        "A reference has several possible symbol types; rename cannot safely change it."
      );
    }
    addEdit(ref.file, ref.line, ref.startChar, ref.endChar);
  }

  // Definition sites: locate the name on its recorded line.
  const declarations = new Map<string, Definition[]>();
  for (const def of target.defs) {
    const current = read(def.file);
    let defs = declarations.get(current.uri);
    if (!defs) {
      const entry = schemaEntryForPath(def.file, schema);
      if (!entry)
        throw new ResponseError(0, "Cannot verify the declaration's schema; rename was not applied.");
      const text = current.getText();
      defs = extractDefinitions(text, entry, def.file, def.source);
      if (entry.kind !== "loc_key") defs.push(...referencesIn(def.file, current).implicitDefs);
      declarations.set(current.uri, defs);
    }
    if (!defs.some((d) => d.name === target.name && d.kind === def.kind && d.line === def.line)) {
      throw new ResponseError(0, "A rename declaration changed. Request rename again.");
    }
    const lineText = getLineText(current, def.line);
    const col = findNameOnLine(lineText, target.name);
    if (col < 0) throw new ResponseError(0, "A rename declaration changed. Request rename again.");
    addEdit(def.file, def.line, col, col + target.name.length);
  }

  const changes: Record<string, TextEdit[]> = {};
  for (const [uri, edits] of editsByUri) changes[uri] = edits;
  if (clientCapabilities().documentChanges) {
    return {
      documentChanges: [...editsByUri].map(([uri, edits]) => ({
        textDocument: { uri, version: documents.get(uri)!.version },
        edits,
      })),
    };
  }
  return { changes };
}

/** An unambiguous declaration token; never guess among same-line occurrences. */
function findNameOnLine(lineText: string, name: string): number {
  const re = new RegExp(wholeNamePattern(name), "g");
  const m = re.exec(lineText);
  if (re.exec(lineText))
    throw new ResponseError(
      0,
      "Several occurrences share the declaration line. Put the declaration on its own line before renaming."
    );
  return m ? m.index : -1;
}
