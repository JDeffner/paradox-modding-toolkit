import type { TextDocument } from "vscode-languageserver-textdocument";
import { membersOf, type DataTypeMember } from "../data/dataTypes";
import { activeProfile } from "../games/active";
import { datafunctionExpressionRanges, datafunctionLiteralEnd as literalEnd } from "./datafunctionContext";
import type { ServerData } from "../serverData";
import { definitionTokenType, type SemanticSpan, type TokenType } from "./semanticTokenTypes";

export { datafunctionExpressionRanges } from "./datafunctionContext";

interface ExpressionToken {
  text: string;
  offset: number;
  length: number;
  kind: "name" | "literal" | "punctuation";
}

function expressionTokens(text: string, start: number, end: number): ExpressionToken[] {
  const tokens: ExpressionToken[] = [];
  let i = start;
  while (i < end) {
    const offset = i;
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "|") {
      // Formatting belongs to the syntax grammar, not symbol resolution.
      break;
    } else if (ch === "#") {
      while (i < end && text[i] !== "\n" && text[i] !== "\r") i++;
    } else if (ch === "'") {
      const close = literalEnd(text, i, end);
      i = Math.min(close, end);
      if (close <= end) {
        tokens.push({
          text: text.slice(offset + 1, i - 1),
          offset: offset + 1,
          length: i - offset - 2,
          kind: "literal",
        });
      }
    } else if (/[A-Za-z_]/.test(ch)) {
      i++;
      while (i < end && /[A-Za-z0-9_]/.test(text[i])) i++;
      tokens.push({ text: text.slice(offset, i), offset, length: i - offset, kind: "name" });
    } else {
      i++;
      tokens.push({ text: ch, offset, length: 1, kind: "punctuation" });
    }
  }
  return tokens;
}

function collectExpression(
  data: ServerData,
  text: string,
  start: number,
  end: number,
  spans: SemanticSpan[]
): void {
  const tokens = expressionTokens(text, start, end);
  const refs = activeProfile().dataFunctionRefs;

  const push = (token: ExpressionToken, type: TokenType, engine = false) => {
    spans.push({
      offset: token.offset,
      length: token.length,
      type,
      ...(engine ? { modifiers: ["defaultLibrary" as const] } : {}),
    });
  };

  const pushMember = (token: ExpressionToken, member: DataTypeMember, chained: boolean) => {
    const type =
      member.src === "macro"
        ? "macro"
        : member.kind === "function"
          ? "function"
          : chained
            ? "property"
            : "variable";
    push(token, type, member.src !== "macro");
  };

  const pushReference = (token: ExpressionToken, kind: string) => {
    const name = token.text.replace(/\\(.)/g, "$1");
    const def = data.index.lookup(name).find((candidate) => candidate.kind === kind);
    if (def) push(token, definitionTokenType(kind), def.source !== "mod");
  };

  // Recursive calls keep the return type available for navigation after `)`.
  const chain = (from: number): number => {
    let i = from;
    let owner: string | null = null;
    let chained = false;
    while (tokens[i]?.kind === "name") {
      const token = tokens[i++];
      const called = tokens[i]?.text === "(";
      const typeMembers = !chained && !called ? membersOf(data.dataTypes, token.text) : null;
      const member: DataTypeMember | undefined = chained
        ? owner
          ? membersOf(data.dataTypes, owner)?.get(token.text)
          : undefined
        : data.dataTypes.globals.get(token.text);
      if (typeMembers) {
        push(token, "type", true);
        owner = data.dataTypes.typeNamesLower.get(token.text.toLowerCase()) ?? token.text;
      } else if (member) {
        pushMember(token, member, chained);
        owner = member.ret;
      } else {
        if (called) push(token, "function");
        owner = null;
      }

      if (called) {
        i++; // opening parenthesis
        let argument = 0;
        while (i < tokens.length && tokens[i].text !== ")") {
          const arg = tokens[i];
          if (arg.text === ",") {
            argument++;
            i++;
          } else if (arg.kind === "literal") {
            // Profile references describe the first argument only. A literal
            // inside another expression must resolve against that inner call.
            const kind = argument === 0 ? refs?.[token.text] : undefined;
            if (kind && (tokens[i + 1]?.text === "," || tokens[i + 1]?.text === ")")) {
              pushReference(arg, kind);
            }
            i++;
          } else if (arg.kind === "name") {
            i = chain(i);
          } else {
            i++;
          }
        }
        if (tokens[i]?.text === ")") i++;
      }
      if (tokens[i]?.text !== "." || tokens[i + 1]?.kind !== "name") break;
      i++;
      chained = true;
    }
    return i;
  };

  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].kind === "name") i = chain(i);
    else i++;
  }
}

/** Resolve only embedded expressions, leaving prose, punctuation and unknown names to TextMate. */
export function provideDatafunctionSemanticSpans(data: ServerData, document: TextDocument): SemanticSpan[] {
  const text = document.getText();
  const spans: SemanticSpan[] = [];
  for (const range of datafunctionExpressionRanges(document)) {
    const end = range.end - (text[range.end - 1] === "]" ? 1 : 0);
    collectExpression(data, text, range.start + 1, end, spans);
  }
  return spans;
}
