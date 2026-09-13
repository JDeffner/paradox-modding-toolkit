import type { SnippetCatalogueEntry } from "@px-lsp/protocol/protocol";
import type { Definition, TokenData } from "@px-lsp/protocol/types";
import type { KindSkeleton } from "../schema/skeletons";
import { renderDefinitionSkeleton, renderBlockSkeleton } from "../schema/skeletons";
import { blockTemplateFor, type BlockTemplate } from "./blockSnippets";
import { minimalTokenInsert, scriptedCallTemplate } from "./completionInsert";
import { withCompletionPreview } from "./completionPreview";
import { MarkupKind } from "vscode-languageserver/node";

export function buildSnippetCatalogue(
  tokens: TokenData[],
  skeletons: Record<string, KindSkeleton> | undefined,
  definitions: Definition[]
): SnippetCatalogueEntry[] {
  const entries: SnippetCatalogueEntry[] = [];
  const variant = (
    label: SnippetCatalogueEntry["variants"][number]["label"],
    name: string,
    template: BlockTemplate,
    token?: TokenData,
    definition?: Definition
  ) => {
    const item = withCompletionPreview(
      { label: name, insertText: template.snippet, insertTextFormat: 2 },
      token,
      definition,
      MarkupKind.Markdown
    );
    const preview =
      typeof item.documentation === "string" ? item.documentation : (item.documentation?.value ?? "");
    return { label, snippet: template.snippet, plain: template.plain, preview };
  };
  const seen = new Set<string>();
  for (const token of tokens) {
    const id = `engine:${token.kind}:${token.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const variants: SnippetCatalogueEntry["variants"] = [];
    const minimal = minimalTokenInsert(token);
    const example = blockTemplateFor(token);
    if (minimal) variants.push(variant("Minimal", token.name, minimal, token));
    if (example) variants.push(variant("Examples", token.name, example, token));
    if (example?.full) variants.push(variant("All fields", token.name, example.full, token));
    if (variants.length)
      entries.push({
        id,
        label: token.name,
        category: "Engine",
        detail: `${token.kind}; loaded game documentation`,
        variants,
      });
  }
  for (const [kind, skeleton] of Object.entries(skeletons ?? {})) {
    const template = renderDefinitionSkeleton(kind, skeleton, {
      withHeader: skeleton.nameFromHeader !== undefined,
    });
    entries.push({
      id: `definition:${kind}`,
      label: `new ${kind}`,
      category: "Definitions",
      detail: `${skeleton.sampled} sampled vanilla definitions`,
      variants: [variant("Template", `new ${kind}`, template)],
    });
    for (const [name, block] of Object.entries(skeleton.blocks ?? {})) {
      entries.push({
        id: `block:${kind}:${name}`,
        label: `${kind} / ${name}`,
        category: "Child blocks",
        detail: `${block.sampled} sampled vanilla blocks`,
        variants: [variant("Template", name, renderBlockSkeleton(name, block))],
      });
    }
  }
  // Definitions are effective definitions supplied in the index's lookup order.
  for (const def of definitions) {
    const id = `scripted:${def.kind}:${def.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const minimal = scriptedCallTemplate(def, "minimal");
    if (!minimal) continue;
    entries.push({
      id,
      label: def.name,
      category: "Scripted calls",
      detail: `${def.kind}; ${def.source}`,
      variants: [
        variant("Minimal", def.name, minimal, undefined, def),
        variant("Examples", def.name, scriptedCallTemplate(def, "examples")!, undefined, def),
      ],
    });
  }
  return entries.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
