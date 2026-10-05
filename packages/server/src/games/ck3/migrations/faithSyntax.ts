import type { AssignmentNode, BlockNode, Statement, ValueNode } from "../../../parser/cst";
import type { MigrationTextEdit } from "../../../migrations/sdk";
import { tokenize } from "../../../parser/lexer";

/** Inline only established file-local numeric bindings. Unresolved forms stay visible for blocking. */
export function resolveFileConstants(source: string, start = 0, end = source.length): string {
  const tokens = tokenize(source).filter((token) => token.kind !== "comment");
  const bindings = new Map<string, { value: string; offset: number } | undefined>();
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === "lbrace") depth++;
    else if (token.kind === "rbrace") depth--;
    else if (depth === 0 && token.kind === "word") {
      const name = source.slice(token.start, token.end);
      if (/^@[\w.]+$/.test(name) && tokens[i + 1]?.value === "=") {
        const value = tokens[i + 2];
        bindings.set(
          name,
          bindings.has(name) || value?.kind !== "word"
            ? undefined
            : { value: source.slice(value.start, value.end), offset: token.start }
        );
      }
    }
  }
  const resolve = (name: string, offset: number, seen = new Set<string>()): string | undefined => {
    const binding = bindings.get(name);
    if (!binding || binding.offset >= offset || seen.has(name)) return undefined;
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(binding.value)) return binding.value;
    if (!/^@[\w.]+$/.test(binding.value)) return undefined;
    seen.add(name);
    return resolve(binding.value, binding.offset, seen);
  };
  const edits: MigrationTextEdit[] = [];
  for (const token of tokens) {
    if (token.kind !== "word" || token.start < start || token.end > end) continue;
    const name = source.slice(token.start, token.end);
    if (!name.startsWith("@")) continue;
    const value = resolve(name, token.start);
    if (value !== undefined) edits.push({ start: token.start - start, end: token.end - start, text: value });
  }
  return editText(source.slice(start, end), edits);
}

export function unresolvedFileConstants(text: string): string[] {
  return [
    ...new Set(
      tokenize(text)
        .filter((token) => token.kind === "word")
        .map((token) => text.slice(token.start, token.end))
        .filter((value) => value.startsWith("@"))
    ),
  ];
}

export function assignments(statements: Statement[]): AssignmentNode[] {
  return statements.filter((s): s is AssignmentNode => s.kind === "assignment");
}
export function children(node: AssignmentNode | undefined): AssignmentNode[] {
  return node?.value?.kind === "block" ? assignments(node.value.statements) : [];
}
export function field(node: AssignmentNode | undefined, key: string): AssignmentNode | undefined {
  return children(node).find((s) => s.key.text === key);
}
export function scalar(node: AssignmentNode | undefined): string | undefined {
  return node?.value?.kind === "scalar" ? node.value.text : undefined;
}
export function editText(text: string, edits: MigrationTextEdit[]): string {
  for (const edit of [...edits].sort((a, b) => b.start - a.start))
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
}
export interface Piece {
  key: string;
  raw: string;
  leadingLength: number;
  node: AssignmentNode;
  text: string;
}
/** Leading trivia follows its field when moved; trailing block trivia remains with the block. */
export function pieces(node: AssignmentNode, text: string): { fields: Piece[]; tail: string } {
  const block = node.value as BlockNode;
  let end = block.openBrace + 1;
  const fields = children(node).map((child) => {
    const result = {
      key: child.key.text,
      raw: resolveFileConstants(text, end, child.range.end),
      leadingLength: child.key.range.start - end,
      node: child,
      text,
    };
    end = child.range.end;
    return result;
  });
  return { fields, tail: text.slice(end, block.closeBrace ?? block.range.end) };
}
export function semantic(value: ValueNode | null, text?: string): unknown {
  if (!value) return null;
  if (value.kind === "scalar")
    return [
      text && !value.quoted ? resolveFileConstants(text, value.range.start, value.range.end) : value.text,
      value.quoted,
    ];
  if (value.kind === "tagged-block") return [value.tag.text, semantic(value.block, text)];
  return value.statements.map((s) =>
    s.kind === "assignment" ? [s.key.text, s.op, semantic(s.value, text)] : semantic(s.value, text)
  );
}
export function equivalent(a: Piece[], b: Piece[]): boolean {
  return (
    JSON.stringify(a.map((p) => semantic(p.node.value, p.text))) ===
    JSON.stringify(b.map((p) => semantic(p.node.value, p.text)))
  );
}
export function renamePiece(piece: Piece, key: string): Piece {
  const at = piece.leadingLength;
  return {
    ...piece,
    key,
    raw:
      piece.raw.slice(0, at) +
      key +
      piece.raw.slice(at + piece.node.key.range.end - piece.node.key.range.start),
  };
}
