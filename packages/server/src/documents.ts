/**
 * Small helpers over `vscode-languageserver-textdocument` documents: the LSP
 * TextDocument API has no lineAt(), so line text is sliced via ranges (offsets
 * clamp to the line end).
 */
import type { TextDocument } from "vscode-languageserver-textdocument";

export function getLineText(document: TextDocument, line: number): string {
  if (line < 0 || line >= document.lineCount) return "";
  const text = document.getText({
    start: { line, character: 0 },
    end: { line, character: Number.MAX_SAFE_INTEGER },
  });
  // The range clamp keeps the trailing newline out, but guard against CR.
  return text.replace(/[\r\n]+$/, "");
}
