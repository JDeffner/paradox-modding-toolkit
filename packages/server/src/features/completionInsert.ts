import type { Definition, TokenData } from "@px-lsp/protocol/types";
import { blockTemplateFor, extractBlockTemplate, type BlockTemplate } from "./blockSnippets";
import { parseScript } from "../parser/parser";

interface RequiredField {
  name: string;
  block?: boolean;
}

/** Shared by keyword completion and the full catalogue export. */
export function scriptedCallTemplate(def: Definition, mode: "minimal" | "examples"): BlockTemplate | null {
  if (!["scripted_effect", "scripted_trigger", "scripted_modifier"].includes(def.kind)) return null;
  if (def.params?.length) {
    if (mode === "minimal")
      return syntaxInsert(
        def.name,
        true,
        "=",
        def.params.map((name) => ({ name }))
      );
    const snippet = def.params.map((p, i) => `\t${p} = \${${i + 1}:${p}}`).join("\n");
    const plain = def.params.map((p) => `\t${p} = ${p}`).join("\n");
    return { snippet: `${def.name} = {\n${snippet}\n}`, plain: `${def.name} = {\n${plain}\n}` };
  }
  if (def.kind === "scripted_modifier") return null;
  return mode === "minimal"
    ? syntaxInsert(def.name, false)
    : {
        snippet: `${def.name} = \${1|yes,no|}`,
        plain: `${def.name} = yes`,
      };
}

/** Punctuation only, with no example values inserted into the document. */
export function syntaxInsert(
  name: string,
  block: boolean,
  operator = "=",
  fields: RequiredField[] = []
): BlockTemplate {
  if (block && fields.length) {
    const render = (snippet: boolean) =>
      fields
        .map((field, i) => {
          const value = snippet ? `$${i + 1}` : "";
          return field.block ? `\t${field.name} = {\n\t\t${value}\n\t}` : `\t${field.name} = ${value}`;
        })
        .join("\n");
    return { snippet: `${name} = {\n${render(true)}\n}`, plain: `${name} = {\n${render(false)}\n}` };
  }
  return block
    ? { snippet: `${name} = {\n\t$0\n}`, plain: `${name} = {\n\t\n}` }
    : { snippet: `${name} ${operator} $0`, plain: `${name} ${operator} ` };
}

const memo = new WeakMap<TokenData, BlockTemplate | null>();

/** The example's outer syntax is usable even when its body contains prose. */
export function minimalTokenInsert(token: TokenData): BlockTemplate | null {
  const hit = memo.get(token);
  if (hit !== undefined) return hit;
  const built = buildMinimalTokenInsert(token);
  memo.set(token, built);
  return built;
}

function buildMinimalTokenInsert(token: TokenData): BlockTemplate | null {
  // Keep the documented fields, omitting optional fields named in prose as well
  // as those the example marks inline. Example values remain empty tabstops.
  const prose = `${token.doc}\n${token.usage ?? ""}`;
  const optionalFields = new Set<string>();
  for (const pattern of [
    /\boptional\s+['"`]?([a-z_][a-z0-9_]*)/gi,
    /\b['"`]?([a-z_][a-z0-9_]*)['"`]?\s+(?:field\s+)?is\s+optional\b/gi,
  ]) {
    for (const match of prose.matchAll(pattern)) optionalFields.add(match[1]);
  }
  // Only an explicit, unconditional field declaration establishes a requirement.
  // Example presence and corpus frequency do not. This wording occurs in script_docs.
  const required = new Set(
    [...token.doc.matchAll(/\bthe ([a-z_][a-z0-9_]*) field is (?:mandatory|required)(?=\.| and\b)/gi)].map(
      (m) => m[1]
    )
  );
  if (required.size && token.usage) {
    const root = parseScript(token.usage).root;
    const outer = root.statements[0];
    if (outer?.kind === "assignment" && outer.value?.kind === "block") {
      const inner = outer.key.text === token.name ? outer : outer.value.statements[0];
      if (inner?.kind === "assignment" && inner.key.text === token.name && inner.value?.kind === "block") {
        const fields = inner.value.statements.flatMap((s) =>
          s.kind === "assignment" && s.op === "=" && required.has(s.key.text) && s.value
            ? [{ name: s.key.text, block: s.value.kind === "block" }]
            : []
        );
        if (fields.length) return syntaxInsert(token.name, true, "=", fields);
      }
    }
  }
  const template = extractBlockTemplate(token.name, token.usage, { optionalFields });
  if (template) return template;

  const head = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|!=|=|>|<)\s*(\{)?/.exec(token.usage ?? "");
  if (head?.[1] === token.name) {
    if (head[3] && head[2] !== "=") return null;
    return syntaxInsert(token.name, Boolean(head[3]), head[2]);
  }
  // The full extractor also understands examples wrapped in a scope block.
  return blockTemplateFor(token) ? syntaxInsert(token.name, true) : null;
}
