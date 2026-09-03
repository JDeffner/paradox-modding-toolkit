/**
 * paradox/definitionEdit: the script sibling of paradox/guiSourceEdit.
 *
 * A visual creator must be able to change one key of a definition without
 * reformatting the file it lives in, and to add a whole definition without
 * disturbing the ones already there. Both are the writer the GUI editor
 * already has: `gui/sourceModel.ts`'s span model (read with the SCRIPT dialect,
 * which has no child-declaration rule) and `gui/sourceEdit.ts`'s surgical
 * replaces over the spans it recorded. Nothing is re-serialized, so a file's
 * comments, CRLF, indentation and other definitions stay byte-identical.
 *
 * `upsertBlock` is `coa/coaParse.ts`'s `upsertFlagInFile` behaviour expressed
 * as an edit instead of a whole new file text: replace the top-level block of
 * that name, or append it after one blank separator line in the file's own
 * newline style.
 *
 * The server never writes: it answers offsets into the text it was handed and
 * the host applies them as ONE WorkspaceEdit (host-owns-text, EMBEDDING.md).
 * A request it cannot honour comes back as a per-op REFUSAL with a reason,
 * never as a throw.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import type {
  DefinitionEditParams,
  DefinitionEditResult,
  DefinitionOp,
  GuiTextEdit,
} from "@px-lsp/protocol/protocol";
import {
  findEntry,
  parseGuiSource,
  SCRIPT_DIALECT,
  type GuiEntry,
  type GuiSourceFile,
} from "../gui/sourceModel";
import { insertProperties, removeProperty, setValue, type GuiEdit } from "../gui/sourceEdit";

/** The top-level `name = { ... }` entry, matched exactly: script names are case-sensitive. */
function topLevelBlock(file: GuiSourceFile, name: string): GuiEntry | null {
  for (const entry of file.root.entries) {
    if (entry.key === name && entry.valueKind === "block") return entry;
  }
  return null;
}

/** Retype a block written with `\n` into the file's own line ending. */
function toFileNewline(text: string, file: GuiSourceFile): string {
  return text.replace(/\r?\n/g, file.newline);
}

/**
 * Replace the block of `name`, or append it. Appending puts exactly one blank
 * line between the file's last content and the new block, and a file that is
 * empty (or holds nothing but its BOM) gets the block on its own with no
 * leading blank line to open it.
 */
function upsertBlock(file: GuiSourceFile, name: string, blockText: string): GuiEdit | string {
  const trimmed = blockText.trim();
  if (name.trim() === "" || trimmed === "") {
    return "an upsert needs both a definition name and the block text to write.";
  }
  const body = toFileNewline(trimmed, file);
  const existing = topLevelBlock(file, name);
  if (existing) return { start: existing.span.start, end: existing.span.end, newText: body };

  const text = file.text;
  const eol = file.newline;
  const at = text.length;
  if (text.trim() === "") return { start: at, end: at, newText: body + eol };
  const closeLastLine = text.endsWith("\n") ? "" : eol;
  return { start: at, end: at, newText: closeLastLine + eol + body + eol };
}

/**
 * Set or remove keys on one definition. Rewrites the LAST entry for a key (the
 * engine's own last-in-wins order) and adds the keys the block does not have in
 * one shared insert.
 */
function setProperties(
  file: GuiSourceFile,
  name: string,
  properties: readonly { key: string; value: string | null }[]
): GuiEdit[] | string {
  const target = topLevelBlock(file, name);
  if (!target) {
    return `this file has no top-level \`${name} = { … }\` to change: write the whole block instead.`;
  }
  const edits: GuiEdit[] = [];
  const missing: [string, string][] = [];
  for (const { key, value } of properties ?? []) {
    if (typeof key !== "string" || key.trim() === "") continue;
    const existing = target.body ? findEntry(target.body, key) : null;
    if (value === null) {
      const edit = existing ? removeProperty(file, existing) : null;
      if (edit) edits.push(edit);
      continue;
    }
    if (existing) {
      const edit = setValue(file, existing, value);
      if (edit) edits.push(edit);
    } else {
      missing.push([key, value]);
    }
  }
  const insert = missing.length > 0 ? insertProperties(file, target, missing) : null;
  if (insert) edits.push(insert);
  return edits;
}

/** Two edits over the same bytes cannot both be applied. */
function overlaps(a: readonly GuiTextEdit[], b: readonly GuiTextEdit[]): boolean {
  return a.some((x) => b.some((y) => x.start < y.end && y.start < x.end));
}

/**
 * Answers a batch against the one authoritative `text`. Every op is computed
 * against the SAME source model, so a creator's save is one document change
 * and one undo step; a refusal is that op's own answer and skips only it.
 */
export function computeDefinitionEdits(params: DefinitionEditParams | null): DefinitionEditResult {
  const text = params?.text ?? "";
  const ops: DefinitionOp[] = Array.isArray(params?.ops) ? params.ops : [];
  if (ops.length === 0) return { edits: [], ops: [] };

  const file = parseGuiSource(text, SCRIPT_DIALECT);
  if (file.errors.length > 0) {
    const refused = `this file has ${file.errors.length} parse error(s), so no offset in it can be trusted: fix the syntax first.`;
    return { edits: [], ops: ops.map(() => ({ refused })) };
  }

  const edits: GuiTextEdit[] = [];
  const verdicts: { refused?: string }[] = [];
  for (const op of ops) {
    const answer = runOp(file, op);
    if (typeof answer === "string") {
      verdicts.push({ refused: answer });
      continue;
    }
    if (answer.length === 0) {
      // Nothing to do is not a refusal: the file already says what was asked.
      verdicts.push({});
      continue;
    }
    if (overlaps(edits, answer)) {
      verdicts.push({
        refused:
          "another change in the same save already rewrites those bytes, so this one was left out: make it on its own.",
      });
      continue;
    }
    edits.push(...answer);
    verdicts.push({});
  }
  return { edits, ops: verdicts };
}

function runOp(file: GuiSourceFile, op: DefinitionOp): GuiEdit[] | string {
  if (!op || typeof op.op !== "string") return "the server has no such edit.";
  switch (op.op) {
    case "setProperties": {
      const answer = setProperties(file, op.name ?? "", op.properties ?? []);
      return typeof answer === "string" ? answer : answer;
    }
    case "upsertBlock": {
      const answer = upsertBlock(file, op.name ?? "", op.text ?? "");
      return typeof answer === "string" ? answer : [answer];
    }
    default:
      return "the server has no such edit.";
  }
}
