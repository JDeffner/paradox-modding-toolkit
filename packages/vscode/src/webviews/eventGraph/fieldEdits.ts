import { LineIndex, parseScript, type BlockNode, type Statement } from "@px-lsp/server/parser";
import type { PendingEdit } from "./history";

export type FieldEdit = Extract<PendingEdit, { kind: "setField" }>;

/** Plan against one source snapshot, so repeated edits and insertions share coordinates. */
export function planFieldEdits(
  text: string,
  edits: FieldEdit[]
): Array<{ start: number; end: number; text: string }> {
  const parsed = parseScript(text);
  const lines = new LineIndex(text);
  const replacements = new Map<number, { start: number; end: number; text: string }>();
  const insertions = new Map<number, string[]>();
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  for (const edit of edits) {
    const event = parsed.root.statements.find((s) => s.kind === "assignment" && s.key.text === edit.id);
    if (!event || event.kind !== "assignment" || event.value?.kind !== "block")
      throw new Error("event no longer exists; refresh its detail");
    const statements: Statement[] = [];
    const blocks: Array<{ block: BlockNode; depth: number }> = [];
    const visit = (block: BlockNode, depth: number): void => {
      blocks.push({ block, depth });
      for (const statement of block.statements) {
        statements.push(statement);
        const value = statement.value;
        if (value?.kind === "block") visit(value, depth + 1);
        else if (value?.kind === "tagged-block") visit(value.block, depth + 1);
      }
    };
    visit(event.value, 1);
    let value = edit.value;
    if (edit.line !== null) {
      const matches = statements.filter(
        (s) =>
          s.kind === "assignment" &&
          s.key.text === edit.key &&
          lines.positionAt(s.key.range.start).line === edit.line
      );
      const statement = matches[0];
      if (matches.length !== 1 || statement.kind !== "assignment" || statement.value?.kind !== "scalar")
        throw new Error("field is missing or ambiguous; refresh its detail");
      if (statement.value.quoted && !value.startsWith('"')) value = `"${value}"`;
      validate(edit.key, value);
      replacements.set(statement.value.range.start, {
        start: statement.value.range.start,
        end: statement.value.range.end,
        text: value,
      });
    } else {
      validate(edit.key, value);
      if (!Number.isInteger(edit.indent) || edit.indent < 0 || edit.indent > 32)
        throw new Error("invalid indentation");
      const matches = blocks.filter(
        ({ block, depth }) =>
          depth === edit.indent &&
          lines.positionAt(block.openBrace).line + 1 === edit.insertLine &&
          block.closeBrace !== null
      );
      if (matches.length !== 1)
        throw new Error("insertion point is missing or ambiguous; refresh its detail");
      const block = matches[0].block;
      const atLine = lines.lineStart(edit.insertLine);
      const inline = atLine > block.closeBrace!;
      const at = inline ? block.openBrace + 1 : atLine;
      const chunk = `${inline ? eol : ""}${"\t".repeat(edit.indent)}${edit.key} = ${value}${eol}`;
      const chunks = insertions.get(at) ?? [];
      chunks.push(chunk);
      insertions.set(at, chunks);
    }
  }
  return [
    ...replacements.values(),
    ...[...insertions].map(([start, chunks]) => ({ start, end: start, text: chunks.join("") })),
  ];
}

function validate(key: string, value: string): void {
  if (/[\r\n]/.test(value)) throw new Error("a field value must stay on one line");
  const parsed = parseScript(`${key} = ${value}`);
  const statement = parsed.root.statements[0];
  if (
    parsed.errors.length ||
    parsed.comments.length ||
    parsed.root.statements.length !== 1 ||
    statement.kind !== "assignment" ||
    statement.key.text !== key ||
    !statement.value
  )
    throw new Error("invalid field value");
}
