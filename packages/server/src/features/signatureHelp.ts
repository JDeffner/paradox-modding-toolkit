/**
 * Signature help for scripted effects/triggers with $PARAM$ parameters,
 * harvested at index time: inside `my_effect = { PARAM = ... }` call blocks
 * the parameter list is shown with the active parameter highlighted.
 */
import type { Position, SignatureHelp } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { ServerData } from "../serverData";
import { getParse } from "../parseCache";
import { nodeAtOffset, type Statement } from "../parser";
import { getLineText } from "../documents";

export function provideSignatureHelp(
  data: ServerData,
  document: TextDocument,
  position: Position
): SignatureHelp | null {
  const { result, lineIndex } = getParse(document);
  const offset = lineIndex.offsetAt(position);
  const hit = nodeAtOffset(result.root, offset);
  if (!hit) return null;

  // Innermost enclosing assignment whose key is a parameterized definition.
  for (let i = hit.path.length - 1; i >= 0; i--) {
    const stmt: Statement = hit.path[i];
    if (stmt.kind !== "assignment" || stmt.key.quoted) continue;
    if (stmt.value?.kind !== "block") continue;
    if (offset <= stmt.value.openBrace) continue;
    const defs = data.index.lookup(stmt.key.text);
    const def = defs.find((d) => d.params && d.params.length > 0);
    if (!def || !def.params) continue;

    const params = def.params;
    const label = `${def.name} = { ${params.map((p) => `${p} = …`).join(" ")} }`;

    // Active parameter: the key being written on the current line, if it matches.
    const lineText = getLineText(document, position.line);
    const keyMatch = /([A-Za-z0-9_]+)\s*=?[^=]*$/.exec(lineText.slice(0, position.character));
    let active = 0;
    if (keyMatch) {
      const idx = params.indexOf(keyMatch[1]);
      if (idx >= 0) active = idx;
    }

    // Align PdxDoc `@param NAME desc` tags (§E3) to the $PARAM$ names by NAME, so
    // the active parameter shows its description. Fail-soft: no doc → no text.
    const paramDoc = new Map<string, string>();
    for (const t of def.tags ?? []) {
      if (t.tag !== "param") continue;
      const m = /^(\S+)\s*(.*)$/.exec(t.text);
      if (m && m[2].trim()) paramDoc.set(m[1], m[2].trim());
    }

    const prose = def.doc ? `${def.doc}\n\n` : "";

    return {
      signatures: [
        {
          label,
          documentation: `${prose}${def.kind.replace(/_/g, " ")} (${def.source}) with ${params.length} parameter(s)`,
          parameters: params.map((p) => {
            const desc = paramDoc.get(p);
            return desc ? { label: `${p} = …`, documentation: desc } : { label: `${p} = …` };
          }),
        },
      ],
      activeSignature: 0,
      activeParameter: active,
    };
  }
  return null;
}
