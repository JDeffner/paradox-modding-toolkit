/**
 * `paradox/guiPreview`: one laid-out instance per palette entry, for a
 * library tile. The synthetic document keeps the requested document's own
 * declarations (template / local_template / types / type) and adds a single
 * root instance:
 *
 *   type or builtin  ->  `<name> = { }`
 *   template         ->  `widget = { using = <name> }`
 *   raw              ->  the fragment verbatim (a saved component)
 *
 * Layout goes through computeGuiLayout with the same store the canvas uses,
 * so a tile shows what inserting the entry would show. No vscode, no fs.
 */
import type { GuiLayoutNode, GuiPreview, GuiPreviewEntry } from "@px-lsp/protocol/protocol";
import { parseScript } from "../parser";
import { computeGuiLayout, type LayoutEnv, type LayoutNode } from "./layoutEngine";
import type { GuiDefs } from "./guiDefs";
import { DECL_MARKERS } from "./declMarkers";
import { VIEWPORT } from "./layoutService";

/** The document's declarations, verbatim, so local templates and types resolve in the synthetic doc. */
export function declarationsOf(text: string): string {
  const { root } = parseScript(text);
  const parts: string[] = [];
  // `template name { }` parses as a bare `template` word followed by the
  // `name { }` assignment; keep both, verbatim, the way the engine reads them.
  let marker: { start: number } | null = null;
  for (const s of root.statements) {
    if (s.kind === "value") {
      marker =
        s.value.kind === "scalar" && DECL_MARKERS.has(s.value.text.toLowerCase())
          ? { start: s.range.start }
          : null;
      continue;
    }
    if (marker) parts.push(text.slice(marker.start, s.range.end));
    marker = null;
  }
  return parts.join("\n");
}

function instanceFor(entry: GuiPreviewEntry): string | null {
  switch (entry.kind) {
    case "type":
    case "builtin":
      return /^[A-Za-z_][\w.]*$/.test(entry.name) ? `${entry.name} = {\n}` : null;
    case "template":
      return /^[A-Za-z_][\w.]*$/.test(entry.name) ? `widget = {\n\tusing = ${entry.name}\n}` : null;
    case "raw":
      return entry.fragment?.trim() ? entry.fragment : null;
  }
}

export function previewEntries(
  text: string,
  entries: GuiPreviewEntry[],
  defs: GuiDefs,
  measurer: LayoutEnv | undefined
): GuiPreview[] {
  const decls = declarationsOf(text);
  return entries.map((entry) => {
    const instance = instanceFor(entry);
    if (!instance) return { name: entry.name, node: null, textures: [], reason: "nothing to lay out" };
    let nodes: LayoutNode[];
    try {
      nodes = computeGuiLayout(`${decls}\n${instance}\n`, { defs, viewport: VIEWPORT, measurer });
    } catch (err) {
      return {
        name: entry.name,
        node: null,
        textures: [],
        reason: err instanceof Error ? err.message : String(err),
      };
    }
    const node = nodes[0];
    if (!node) return { name: entry.name, node: null, textures: [], reason: "the store has no such widget" };
    if (node.rect.w <= 0 || node.rect.h <= 0) {
      return { name: entry.name, node: null, textures: [], reason: "zero size without a parent" };
    }
    const textures = new Set<string>();
    const visit = (n: LayoutNode): void => {
      if (n.bg?.texture) textures.add(n.bg.texture);
      if (n.fill?.texture) textures.add(n.fill.texture);
      for (const c of n.children) visit(c);
    };
    visit(node);
    return { name: entry.name, node: node as unknown as GuiLayoutNode, textures: [...textures].sort() };
  });
}
