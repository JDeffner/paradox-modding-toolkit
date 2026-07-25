/**
 * GUI widget tree: turn a PdxGui document into the hierarchy a modder thinks
 * in — windows > containers > widgets, with template/type declarations and
 * animation states — for the Show GUI Widget Tree webview.
 *
 * PdxGui reuses the jomini syntax, so the tolerant script parser handles it.
 * Detection is INVERSE: every block child is a node unless its key is a known
 * attribute block (size, position…), because widget vocabularies are open
 * (mods derive custom types like icon_observer) while attribute blocks are a
 * small closed set.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import type { GuiTree, GuiTreeNode } from "@px-lsp/protocol/protocol";
import { LineIndex, parseScript, type BlockNode, type Statement } from "../parser";

/** Value-form headers that mark the NEXT assignment as a declaration. */
const DECL_MARKERS = new Set(["template", "types", "type", "blockoverride", "block", "local_template"]);

/** Attribute blocks — data, not children. Everything else is a node. */
const PROPERTY_BLOCKS = new Set([
  "size",
  "position",
  "framesize",
  "spriteborder",
  "color",
  "disabledcolor",
  "uv_scale",
  "margin",
  "padding",
  "mipmaplodbias",
  "modify_texture",
  "resizeparent",
  "soundeffect",
  "cursor_properties",
]);

/** Animation-ish blocks rendered as dimmed nodes rather than widgets. */
const STATE_BLOCKS = new Set(["state", "animation", "attachanimation", "onpressed", "onreleased"]);

export function buildGuiTree(text: string): GuiTree {
  const result = parseScript(text);
  const lineIndex = new LineIndex(text);
  let count = 0;

  const walk = (statements: Statement[]): GuiTreeNode[] => {
    const nodes: GuiTreeNode[] = [];
    let pendingDecl: string | null = null;
    for (const stmt of statements) {
      if (stmt.kind !== "assignment") {
        // A bare `template` / `types` word labels the following assignment.
        if (stmt.value.kind === "scalar" && DECL_MARKERS.has(stmt.value.text.toLowerCase())) {
          pendingDecl = stmt.value.text.toLowerCase();
        } else if (stmt.value.kind === "block" || stmt.value.kind === "tagged-block") {
          // Anonymous block: descend, keep any children it holds.
          const block = stmt.value.kind === "block" ? stmt.value : stmt.value.block;
          nodes.push(...walk(block.statements));
          pendingDecl = null;
        }
        continue;
      }
      const value = stmt.value;
      const block: BlockNode | null =
        value?.kind === "block" ? value : value?.kind === "tagged-block" ? value.block : null;
      if (!block) {
        pendingDecl = null;
        continue;
      }
      const rawKey = stmt.key.text;
      const lower = rawKey.toLowerCase();
      if (!pendingDecl && PROPERTY_BLOCKS.has(lower)) continue;

      const node: GuiTreeNode = {
        key: pendingDecl ? `${pendingDecl} ${rawKey}` : rawKey,
        kind: pendingDecl ? "decl" : STATE_BLOCKS.has(lower) ? "state" : "widget",
        line: lineIndex.positionAt(stmt.key.range.start).line,
        children: [],
      };
      if (value?.kind === "tagged-block") node.base = value.tag.text;
      for (const child of block.statements) {
        if (child.kind !== "assignment" || child.value?.kind !== "scalar") continue;
        const ck = child.key.text.toLowerCase();
        if (ck === "name" && node.name === undefined) node.name = child.value.text;
        else if (ck === "using") (node.using ??= []).push(child.value.text);
      }
      node.children = walk(block.statements);
      count++;
      nodes.push(node);
      pendingDecl = null;
    }
    return nodes;
  };

  const nodes = walk(result.root.statements);
  return { nodes, count };
}
