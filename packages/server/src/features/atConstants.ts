/**
 * `@name` constants: `@name = value` near the top of a script or gui file,
 * then `@name` (or a bare `name` inside `@[ ... ]` inline math) anywhere in the
 * SAME file. The reader substitutes the text while it loads the file, so a
 * constant is not a database entry: no other file sees it, the index never
 * lists it, and hover and go-to-definition answer from the open document
 * alone. Engine-wide: measured in every supported game's events/, common/ and
 * gui/ trees, declared the same way in each, so there is no GameProfile gate.
 */
import {
  CompletionItemKind,
  MarkupKind,
  type CompletionList,
  type Hover,
  type InlayHint,
  type Location,
  type Position,
  type Range,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { ServerData } from "../serverData";
import { getLineText, isScriptLanguage } from "../documents";
import { wordRangeAt } from "../wordAt";
import { definitionCards } from "./hover";
import { renderHoverMarkdown, type CardInput } from "./hoverRender";

export interface ConstantRef {
  name: string;
  /** Character offsets on the line; `@name` includes the `@`, a math operand does not. */
  start: number;
  end: number;
}

export interface ConstantDecl {
  line: number;
  /** Where the `@` sits. */
  character: number;
  value: string;
}

const NAME = /^[A-Za-z0-9_]+$/;

/** The constant the cursor is on: a `@name` use or declaration, or an operand of `@[ ... ]`. */
export function constantRefAt(lineText: string, character: number): ConstantRef | null {
  const range = wordRangeAt(lineText, character);
  if (!range || !NAME.test(range.word)) return null;
  if (lineText[range.start - 1] === "@") {
    // `@icon!` in a quoted string is a loc icon, not a constant.
    if (lineText[range.end] === "!") return null;
    return { name: range.word, start: range.start - 1, end: range.end };
  }
  // Inside an unclosed `@[` before the word: a numeric literal is not a name.
  const open = lineText.lastIndexOf("@[", range.start);
  if (open === -1 || lineText.slice(open + 2, range.start).includes("]")) return null;
  if (/^\d/.test(range.word)) return null;
  return { name: range.word, start: range.start, end: range.end };
}

/** Every `@name = value` declaration in the document, first one wins. */
export function constantDeclarations(text: string): Map<string, ConstantDecl> {
  const out = new Map<string, ConstantDecl>();
  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line++) {
    const m = /^([ \t]*)@([A-Za-z0-9_]+)[ \t]*=[ \t]*([^#\r\n]*)/.exec(lines[line]);
    if (!m || out.has(m[2])) continue;
    out.set(m[2], { line, character: m[1].length, value: m[3].trim() });
  }
  return out;
}

/** Uses of `@name` in the document, the declaration not counted. */
function useCount(text: string, name: string, declared: boolean): number {
  const all = text.match(new RegExp(`@${name}(?![A-Za-z0-9_])`, "g"))?.length ?? 0;
  return declared ? all - 1 : all;
}

/**
 * The number a constant's value comes to, following `@[ ... ]` inline math and
 * `@other` references through the file's own declarations; null when a value
 * is not numeric (`= major_gold_value`, a path), an operand is undeclared, or
 * the math divides by zero. Depth-capped so `@a = @b` / `@b = @a` ends.
 */
export function evaluateConstant(value: string, decls: Map<string, ConstantDecl>, depth = 0): number | null {
  if (depth > 16) return null;
  const v = value.trim();
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(v)) return Number(v);
  if (/^@[A-Za-z0-9_]+$/.test(v)) {
    const d = decls.get(v.slice(1));
    return d ? evaluateConstant(d.value, decls, depth + 1) : null;
  }
  const math = /^@\[(.*)\]$/.exec(v);
  if (!math) return null;
  // Recursive descent over + - * / and parentheses; operands are numbers or
  // names declared in this file.
  const src = math[1];
  let i = 0;
  const skip = () => {
    while (i < src.length && src[i] === " ") i++;
  };
  const atom = (): number | null => {
    skip();
    if (src[i] === "(") {
      i++;
      const inner = sum();
      skip();
      if (src[i] !== ")") return null;
      i++;
      return inner;
    }
    if (src[i] === "-") {
      i++;
      const n = atom();
      return n === null ? null : -n;
    }
    const m = /^(\d+\.?\d*|\.\d+|[A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    if (/^[\d.]/.test(m[0])) return Number(m[0]);
    const d = decls.get(m[0]);
    return d ? evaluateConstant(d.value, decls, depth + 1) : null;
  };
  const product = (): number | null => {
    let left = atom();
    for (;;) {
      skip();
      const op = src[i];
      if (op !== "*" && op !== "/") return left;
      i++;
      const right = atom();
      if (left === null || right === null) return null;
      if (op === "/" && right === 0) return null;
      left = op === "*" ? left * right : left / right;
    }
  };
  const sum = (): number | null => {
    let left = product();
    for (;;) {
      skip();
      const op = src[i];
      if (op !== "+" && op !== "-") return left;
      i++;
      const right = product();
      if (left === null || right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
  };
  const result = sum();
  skip();
  return i === src.length && result !== null && Number.isFinite(result) ? result : null;
}

/** At most four decimals, no trailing zeros: what a modder would type. */
function formatNumber(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

/** True for the languages that declare `@name` constants: script and gui, not loc. */
export function declaresConstants(languageId: string): boolean {
  return isScriptLanguage(languageId) || languageId === "paradox-gui";
}

/** `= 1825`, or `= @[base / 20] → 1` when the value is math or another constant. */
function valueTail(decl: ConstantDecl, decls: Map<string, ConstantDecl>): string {
  const n = evaluateConstant(decl.value, decls);
  return n !== null && String(n) !== decl.value ? `= ${decl.value} → ${formatNumber(n)}` : `= ${decl.value}`;
}

/**
 * Completion after `@`, and for a bare operand inside `@[ ... ]`: the file's
 * own constants and nothing else, since nothing else can stand there. null
 * when the cursor is in neither place, so the usual provider runs.
 */
export function provideConstantCompletion(document: TextDocument, position: Position): CompletionList | null {
  const before = getLineText(document, position.line).slice(0, position.character);
  const at = /@([A-Za-z0-9_]*)$/.exec(before);
  let bare = false;
  let partialLength: number;
  if (at) {
    partialLength = at[0].length;
  } else {
    const open = before.lastIndexOf("@[");
    if (open === -1 || before.slice(open + 2).includes("]")) return null;
    bare = true;
    partialLength = /[A-Za-z0-9_]*$/.exec(before)![0].length;
  }
  const decls = constantDeclarations(document.getText());
  // The replaced range starts at the `@` (or the operand's first letter) so the
  // client filters `@sch` against the `@`-prefixed labels.
  const range: Range = {
    start: { line: position.line, character: position.character - partialLength },
    end: position,
  };
  let order = 0;
  const items = [...decls].map(([name, decl]) => {
    const label = bare ? name : `@${name}`;
    return {
      label,
      kind: CompletionItemKind.Constant,
      detail: valueTail(decl, decls),
      // Declaration order, the order the file's author chose.
      sortText: String(order++).padStart(4, "0"),
      textEdit: { range, newText: label },
    };
  });
  return { isIncomplete: false, items };
}

const HINT_MAX = 40;

/**
 * The value beside every `@name` use in `range`, as an inlay hint: `= 1825`,
 * or the computed number for math and chained constants. Declarations and
 * undeclared names get none; the comment part of a line is skipped.
 */
export function constantHints(document: TextDocument, range: Range): InlayHint[] {
  if (!declaresConstants(document.languageId)) return [];
  const decls = constantDeclarations(document.getText());
  if (decls.size === 0) return [];
  const hints: InlayHint[] = [];
  const lastLine = Math.min(range.end.line, document.lineCount - 1);
  for (let line = range.start.line; line <= lastLine; line++) {
    const text = getLineText(document, line).split("#")[0];
    const re = /@([A-Za-z0-9_]+)(?![A-Za-z0-9_![])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const decl = decls.get(m[1]);
      if (!decl || (decl.line === line && decl.character === m.index)) continue;
      const n = evaluateConstant(decl.value, decls);
      const shown = n !== null ? formatNumber(n) : decl.value;
      hints.push({
        position: { line, character: m.index + m[0].length },
        label: `= ${shown.length > HINT_MAX ? shown.slice(0, HINT_MAX - 1) + "…" : shown}`,
        paddingLeft: true,
      });
    }
  }
  return hints;
}

/** null when the cursor is not on a constant; the caller then goes on to its usual hover. */
export function provideConstantHover(
  data: ServerData,
  document: TextDocument,
  position: Position
): Hover | null {
  const lineText = getLineText(document, position.line);
  const ref = constantRefAt(lineText, position.character);
  if (!ref) return null;
  const text = document.getText();
  const decls = constantDeclarations(text);
  const decl = decls.get(ref.name);
  const uses = useCount(text, ref.name, decl !== undefined);
  const usesText = `used ${uses} ${uses === 1 ? "time" : "times"} in this file`;
  // The value, and what it comes to when it is inline math or another constant.
  const headTail = decl ? valueTail(decl, decls) : undefined;
  // What a constant IS is said where it is declared, and where it is missing:
  // a resolved use only needs the value, the line and the count.
  const what = "Text the game substitutes while reading this file, so the name only works in this file.";
  const doc = !decl
    ? `Not declared in this file · ${usesText}.\n\n${what}`
    : decl.line === position.line
      ? `${what}\n\nDeclared here · ${usesText}.`
      : `Declared on line ${decl.line + 1} · ${usesText}.`;
  const card: CardInput = {
    kind: "local_constant",
    badgeLabel: "constant",
    name: `@${ref.name}`,
    headTail,
    doc,
  };
  const cards = [card];
  // A constant standing for a script value (`= major_gold_value`) leads on to it.
  if (decl && NAME.test(decl.value) && !/^\d/.test(decl.value)) {
    cards.push(...definitionCards(data, data.index.lookup(decl.value)));
  }
  return {
    contents: { kind: MarkupKind.Markdown, value: renderHoverMarkdown(cards) },
    range: {
      start: { line: position.line, character: ref.start },
      end: { line: position.line, character: ref.end },
    },
  };
}

/**
 * null when the cursor is not on a constant. A `@name` with no declaration
 * yields [] (nothing else can resolve it); a bare math operand without one
 * yields null so the usual lookup still runs.
 */
export function provideConstantDefinition(document: TextDocument, position: Position): Location[] | null {
  const lineText = getLineText(document, position.line);
  const ref = constantRefAt(lineText, position.character);
  if (!ref) return null;
  const decl = constantDeclarations(document.getText()).get(ref.name);
  if (!decl) return lineText[ref.start] === "@" ? [] : null;
  if (decl.line === position.line) return [];
  return [
    {
      uri: document.uri,
      range: {
        start: { line: decl.line, character: decl.character },
        end: { line: decl.line, character: decl.character + ref.name.length + 1 },
      },
    },
  ];
}
