import { InsertTextFormat, MarkupKind, type CompletionItem } from "vscode-languageserver/node";
import type { Definition, TokenData } from "@px-lsp/protocol/types";
import { parseScript } from "../parser/parser";
import type { Statement } from "../parser/cst";

/** Decode the numbered stops and choices emitted by our snippet renderers. */
function previewText(item: CompletionItem): string | undefined {
  if (!item.insertText) return undefined;
  const text =
    item.insertTextFormat === InsertTextFormat.Snippet
      ? item.insertText.replace(
          /\\([\\$}])|\$\{\d+\|((?:\\.|[^}])*?)\|\}|\$\{\d+:((?:\\.|[^}])*)\}|\$\{\d+\}|\$\d+/g,
          (_match, escaped: string, choices: string, value: string) =>
            escaped ?? (choices?.split(/(?<!\\),/)[0] ?? value ?? "").replace(/\\([\\$},|])/g, "$1")
        )
      : item.insertText;
  // These labels only appear in documentation, never in insertText.
  return text
    .replace(/^([ \t]+)$/gm, "$1<value>")
    .replace(
      /(\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:>=|<=|!=|=|>|<))[ \t]*$/gm,
      (_match, assignment: string, key: string) => `${assignment} <${key === item.label ? "value" : key}>`
    );
}

/** Scalar fields by their full path, so nested keys with the same name stay distinct. */
function fields(text: string, name?: string): Map<string, string> {
  const root = parseScript(
    text.replace(/"(?:\\.|[^"\\])*"|<[^<>\n]+>/g, (match) =>
      match.startsWith('"') ? match : JSON.stringify(match)
    )
  ).root;
  let statements = root.statements;
  if (name) {
    const outer = statements[0];
    if (outer?.kind !== "assignment") return new Map();
    if (outer.key.text !== name) {
      if (outer.value?.kind !== "block") return new Map();
      statements = outer.value.statements;
    }
    if (statements[0]?.kind !== "assignment" || statements[0].key.text !== name) return new Map();
    statements = [statements[0]];
  }
  const result = new Map<string, string>();
  const visit = (nodes: Statement[], prefix = "") => {
    for (const node of nodes) {
      if (node.kind === "value" && node.value.kind === "scalar") {
        result.set(`${prefix}[]`, node.value.text);
        continue;
      }
      if (node.kind !== "assignment" || !node.value) continue;
      const path = prefix ? `${prefix}.${node.key.text}` : node.key.text;
      if (node.value.kind === "block") visit(node.value.statements, path);
      else if (node.value.kind === "scalar") result.set(path, node.value.text);
    }
  };
  visit(statements);
  return result;
}

function cell(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_[\]])/g, "\\$1")
    .replace(/\|/g, "&#124;")
    .replace(/\r?\n/g, " ");
}

/** Resolve-time only: selecting an item builds its preview without inflating the completion list. */
export function withCompletionPreview(
  item: CompletionItem,
  token?: TokenData,
  definition?: Definition,
  format: MarkupKind = MarkupKind.Markdown
): CompletionItem {
  withCompletionDocumentation(item, format);
  const preview = previewText(item);
  if (!preview) return item;
  const existing = typeof item.documentation === "string" ? item.documentation : item.documentation?.value;
  if (existing?.startsWith("**Insertion preview**\n") || existing?.startsWith("Insertion preview\n"))
    return item;
  const markdown = format === MarkupKind.Markdown;
  const descriptions = new Map<string, string>();
  // script_docs describes example placeholders as "Where X is ..." / "Y can be ...".
  for (const match of (token?.doc ?? "").matchAll(
    /\b([A-Z][A-Z0-9_]*)\s+(?:is|can be)\s+([^\n]+?)(?=\.\s+[A-Z]\s+(?:is|can be)\b|\n|$)/g
  )) {
    descriptions.set(match[1], match[2]);
  }
  for (const tag of definition?.tags ?? []) {
    if (tag.tag !== "param") continue;
    const match = /^(\S+)\s+(.+)$/.exec(tag.text);
    if (match) descriptions.set(match[1], match[2]);
  }
  const source = token?.usage ? fields(token.usage, token.name) : new Map<string, string>();
  const rows: string[] = [];
  for (const path of token || definition ? fields(preview).keys() : []) {
    const field = path.includes(".") ? path.slice(path.indexOf(".") + 1) : path;
    const example = source.get(path);
    let hint = definition ? descriptions.get(field) : example ? descriptions.get(example) : undefined;
    if (!hint && token && path === token.name) hint = /^Traits:\s*(.+)$/im.exec(token.traits ?? "")?.[1];
    if (!hint && example?.startsWith("<") && example.endsWith(">")) hint = example.slice(1, -1);
    if (!hint) hint = example ? `Type not documented. Example: ${example}` : "Type not documented.";
    const label = field.replace(/\[\]$/, " (contents)");
    rows.push(markdown ? `| ${cell(label)} | ${cell(hint)} |` : `${label}: ${hint}`);
  }
  const fence = "`".repeat(Math.max(3, ...[...preview.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  const parts = [
    markdown
      ? `**Insertion preview**\n\n${fence}paradox\n${preview}\n${fence}`
      : `Insertion preview\n\n${preview}`,
  ];
  if (rows.length)
    parts.push(
      markdown
        ? `**Expected values**\n\n| Field | From documentation |\n| --- | --- |\n${rows.join("\n")}`
        : `Expected values\n\n${rows.join("\n")}`
    );
  if (existing) parts.push(existing);
  item.documentation = { kind: format, value: parts.join("\n\n") };
  return item;
}

/** Strip the Markdown constructs our documentation renderers add for bare clients. */
export function withCompletionDocumentation(item: CompletionItem, format: MarkupKind): CompletionItem {
  const doc = item.documentation;
  if (typeof doc === "object" && doc.kind === MarkupKind.Markdown && format === MarkupKind.PlainText) {
    item.documentation = {
      kind: format,
      value: doc.value
        .replace(/^`{3,}[^\n]*\n/gm, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/^#{1,6}\s+/gm, ""),
    };
  }
  return item;
}
