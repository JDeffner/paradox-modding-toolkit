import type { SemanticTokens, SemanticTokensLegend } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";

// Append only: the first nine type slots and defaultLibrary bit are public.
const TOKEN_TYPES = [
  "method",
  "function",
  "variable",
  "property",
  "macro",
  "event",
  "enumMember",
  "string",
  "keyword",
  "type",
  "parameter",
  "namespace",
] as const;

const TOKEN_MODIFIERS = [
  "defaultLibrary",
  "declaration",
  "readonly",
  "modification",
  "px",
  "pxEffect",
  "pxTrigger",
  "pxScope",
] as const;

export type TokenType = (typeof TOKEN_TYPES)[number];
export type TokenModifier = (typeof TOKEN_MODIFIERS)[number];

export const SEMANTIC_LEGEND: SemanticTokensLegend = {
  tokenTypes: [...TOKEN_TYPES],
  tokenModifiers: [...TOKEN_MODIFIERS],
};

export interface SemanticSpan {
  offset: number;
  length: number;
  type: TokenType;
  modifiers?: TokenModifier[];
}

/** Database identities use type; script values and runtime names have separate roles. */
export function definitionTokenType(kind: string): TokenType {
  if (kind === "scripted_effect" || kind === "scripted_trigger") return "macro";
  if (kind === "event" || kind === "on_action") return "event";
  if (kind === "script_value") return "enumMember";
  if (kind === "scripted_modifier") return "property";
  if (kind === "loc_key") return "string";
  if (
    kind === "saved_scope" ||
    kind === "variable" ||
    kind === "local_variable" ||
    kind === "global_variable" ||
    kind === "variable_list" ||
    kind === "local_variable_list" ||
    kind === "global_variable_list" ||
    kind === "flag" ||
    kind === "list"
  )
    return "variable";
  return "type";
}

/** Collectors must supply valid, disjoint, single-line spans. */
export function encodeSemanticSpans(document: TextDocument, spans: readonly SemanticSpan[]): SemanticTokens {
  const text = document.getText();
  const sorted = spans
    .map((span, order) => ({ ...span, order }))
    .sort((a, b) => a.offset - b.offset || a.order - b.order);
  const data: number[] = [];
  let end = 0;
  let line = 0;
  let character = 0;
  for (const span of sorted) {
    if (
      !Number.isInteger(span.offset) ||
      !Number.isInteger(span.length) ||
      span.offset < end ||
      span.length <= 0 ||
      span.offset + span.length > text.length
    )
      throw new Error(`Invalid or overlapping semantic span at ${span.offset} (${span.length})`);
    const content = text.slice(span.offset, span.offset + span.length);
    if (/[\r\n]/.test(content)) throw new Error(`Multiline semantic span at ${span.offset}`);
    const position = document.positionAt(span.offset);
    let modifiers = 1 << TOKEN_MODIFIERS.indexOf("px");
    for (const modifier of span.modifiers ?? []) modifiers |= 1 << TOKEN_MODIFIERS.indexOf(modifier);
    const deltaLine = position.line - line;
    data.push(
      deltaLine,
      deltaLine === 0 ? position.character - character : position.character,
      span.length,
      TOKEN_TYPES.indexOf(span.type),
      modifiers
    );
    end = span.offset + span.length;
    line = position.line;
    character = position.character;
  }
  return { data };
}
