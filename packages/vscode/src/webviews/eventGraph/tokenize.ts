/**
 * A one-line tokenizer for the pseudo-script the simulator prints, so a block
 * of event logic reads like the editor rather than like a log dump. Pure and
 * unit-tested; the app colors the tokens with the px-ui `--px-tok-*` variables,
 * which follow the user's theme.
 *
 * Deliberately NOT a parser. The server already parsed the file; these lines
 * are its own flattened output (`key = value`, `key = {`, `}`, or a bare list
 * entry), so a scanner that never looks past the end of the line is enough,
 * and it cannot disagree with the parse the lines came from.
 */

export type ScriptTokenKind =
  | "comment"
  | "key"
  | "op"
  | "string"
  | "number"
  | "bool"
  | "brace"
  | "text";

export interface ScriptToken {
  text: string;
  kind: ScriptTokenKind;
}

/** Characters that end a bare word. */
const BREAK = /[\s{}"#=<>!?]/;
const OPERATOR = "=<>!?";
const NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Split one line into colorable tokens. Every character of the input lands in
 * exactly one token, in order, so joining the texts returns the line unchanged
 * (whitespace included) and the renderer needs no separate spacing rules.
 */
export function tokenizeScriptLine(line: string): ScriptToken[] {
  const out: ScriptToken[] = [];
  const push = (text: string, kind: ScriptTokenKind): void => {
    if (text !== "") out.push({ text, kind });
  };
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "#") {
      push(line.slice(i), "comment");
      return out;
    }
    if (c === " " || c === "\t") {
      let j = i;
      while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
      push(line.slice(i, j), "text");
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') j++;
      // An unterminated quote runs to the end of the line, which is what the
      // game's own reader does with it.
      j = Math.min(j + 1, line.length);
      push(line.slice(i, j), "string");
      i = j;
      continue;
    }
    if (c === "{" || c === "}") {
      push(c, "brace");
      i++;
      continue;
    }
    if (OPERATOR.includes(c)) {
      let j = i;
      while (j < line.length && OPERATOR.includes(line[j])) j++;
      push(line.slice(i, j), "op");
      i = j;
      continue;
    }
    let j = i;
    while (j < line.length && !BREAK.test(line[j])) j++;
    const word = line.slice(i, j);
    // A word is a key only when an operator follows it. Without that test a
    // bare list entry (`events = { evt.1 evt.2 }`) would color as a key.
    let k = j;
    while (k < line.length && (line[k] === " " || line[k] === "\t")) k++;
    push(word, k < line.length && OPERATOR.includes(line[k]) ? "key" : valueKind(word));
    i = j;
  }
  return out;
}

function valueKind(word: string): ScriptTokenKind {
  if (NUMBER.test(word)) return "number";
  if (word === "yes" || word === "no") return "bool";
  return "text";
}
