/** Symbol identity at a use site. Type selection uses grammar, never inferred scope. */
import type { Position } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import type { Definition } from "@px-lsp/protocol/types";
import { isLocProperty } from "@px-lsp/protocol/locProperties";
import type { ServerData } from "../serverData";
import { loadSchema, schemaEntryForPath, type SchemaData } from "../schema/loader";
import type { SchemaEntry } from "../schema/types";
import { getParse } from "../parseCache";
import { nodeAtOffset } from "../parser";
import { detectContextFromParse, inlineKind } from "../context";
import { activeProfile } from "../games/active";
import { dynamicRefKinds, VAR_PREFIX_KINDS } from "../games/jomini/variables";
import { wordRangeAt } from "../wordAt";
import { getLineText } from "../documents";
import { datafunctionExprAt, openCallAt } from "./datafunction";
import { EVENT_ID } from "../index/extract";
import { implicitKindsForField } from "../index/references";

/** null means unresolved; [] means a known non-reference position. */
export function expectedKindsAt(
  document: TextDocument,
  position: Position,
  schema: SchemaData,
  entry: SchemaEntry | null = schemaEntryForPath(URI.parse(document.uri).fsPath, schema)
): string[] | null {
  const line = getLineText(document, position.line);
  const range = wordRangeAt(line, position.character);
  if (!range) return [];
  const offset = document.offsetAt(position);
  const scriptParse = document.languageId === "paradox-loc" ? null : getParse(document).result;
  if (
    /^\s*#/.test(line) ||
    scriptParse?.comments.some((c) => offset >= c.range.start && offset <= c.range.end)
  )
    return [];
  const expression = datafunctionExprAt(line.slice(0, position.character));
  if (expression !== null) {
    const call = openCallAt(expression);
    if (call && call.literalPrefix !== null && call.argIndex === 0) {
      const kind = activeProfile().dataFunctionRefs?.[call.chain[call.chain.length - 1]];
      if (kind) return [kind];
    }
  }
  if (document.languageId === "paradox-loc") {
    return /^\s*[A-Za-z0-9_.-]+\s*:\d*\s*"/.test(line) && range.start < line.indexOf(":")
      ? ["loc_key"]
      : null;
  }
  const result = scriptParse!;
  const prefix = /(?:^|[^A-Za-z0-9_.-])([a-z_]+):$/.exec(line.slice(0, range.start))?.[1];
  if (prefix)
    return prefix === "scope"
      ? ["saved_scope"]
      : (VAR_PREFIX_KINDS[prefix] ?? schema.prefixRefs[prefix] ?? null);
  const path = nodeAtOffset(result.root, offset)?.path;
  const last = path?.at(-1);
  if (!path || !last) return null;
  if (last.kind === "assignment" && offset >= last.key.range.start && offset <= last.key.range.end) {
    const declarationKind = inlineKind(result.root, last);
    if (declarationKind) return [declarationKind];
    if (
      entry &&
      ((path.length === 1 && (entry.extraction !== "event-id" || EVENT_ID.test(last.key.text))) ||
        entry.extraction === "nested-title")
    )
      return [entry.kind];
    const context = detectContextFromParse(result, offset, entry?.kind).context;
    return context === "trigger"
      ? ["scripted_trigger"]
      : context === "effect"
        ? ["scripted_effect"]
        : ["scripted_trigger", "scripted_effect", "scripted_modifier"];
  }
  if (last.kind === "assignment" && last.value?.kind === "scalar") {
    const parent = path.at(-2);
    const implicit = implicitKindsForField(
      last.key.text,
      parent?.kind === "assignment" ? parent.key.text : undefined
    );
    if (implicit) return implicit;
    if (entry?.extraction === "named-block") {
      if (last.key.text === "name" && path.length === 2) return [entry.kind];
      const context = path
        .slice(0, -1)
        .filter((s) => s.kind === "assignment")
        .map((s) => s.key.text)
        .join("/");
      const rule = entry.assetFields?.[`${context}/${last.key.text}`] ?? entry.assetFields?.[`${context}/*`];
      return rule?.target && !rule.target.owner ? [rule.target.kind ?? entry.kind] : [];
    }
    const field = schema.refFields.get(last.key.text);
    if (field) return field.form !== "list" ? field.kinds : [];
    if (parent?.kind === "assignment") {
      const kinds = activeProfile().blockRefFields[parent.key.text.toLowerCase()]?.[last.key.text];
      if (kinds) return kinds;
    }
    const kinds = dynamicRefKinds(last.key.text);
    if (kinds) return kinds;
    if (isLocProperty(last.key.text)) return ["loc_key"];
  }
  if (last.kind === "value" && last.value.kind === "scalar") {
    const parent = path.at(-2);
    if (parent?.kind === "assignment") {
      const field = schema.refFields.get(parent.key.text);
      if (field && field.form !== "scalar") return field.kinds;
    }
  }
  return null;
}

export function definitionsAt(
  data: ServerData,
  document: TextDocument,
  position: Position,
  schema = loadSchema(null),
  allSources = false,
  docDefs?: (word: string) => Definition[]
): Definition[] {
  const word = wordRangeAt(getLineText(document, position.line), position.character)?.word;
  if (!word) return [];
  let kinds = expectedKindsAt(document, position, schema);
  if (kinds === null) {
    const file = URI.parse(document.uri).fsPath;
    const own = data.index.inFile(file).filter((d) => d.name === word && d.line === position.line);
    if (own.length) kinds = own.map((d) => d.kind);
  }
  const allowed = kinds;
  const filter = (defs: Definition[]) =>
    allowed === null ? defs : defs.filter((d) => allowed.includes(d.kind));
  const defs = filter(allSources ? data.index.lookupAll(word) : data.index.lookup(word));
  return defs.length || !docDefs ? defs : filter(docDefs(word));
}
