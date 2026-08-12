/**
 * Small helpers over `vscode-languageserver-textdocument` documents: the LSP
 * TextDocument API has no lineAt(), so line text is sliced via ranges (offsets
 * clamp to the line end).
 */
import type { TextDocument } from "vscode-languageserver-textdocument";

/**
 * The non-script languages we serve. Everything else whose id starts with
 * `paradox` is the script language.
 */
const NON_SCRIPT_LANGUAGES = new Set(["paradox-loc", "paradox-gui", "paradox-mod", "paradox-info"]);

/**
 * Whether a document is jomini script, whatever the client called it.
 *
 * Clients may append a suffix to get a per-language icon and label per game
 * (the VS Code extension sends `paradox-<game>`, neovim sends plain
 * `paradox`). They are one language to the server, and naming the suffixes
 * here would put game names in engine code, so the test is generic: it is
 * script unless it is one of the four other Paradox languages.
 */
export function isScriptLanguage(languageId: string): boolean {
  return languageId.startsWith("paradox") && !NON_SCRIPT_LANGUAGES.has(languageId);
}

export function getLineText(document: TextDocument, line: number): string {
  if (line < 0 || line >= document.lineCount) return "";
  const text = document.getText({
    start: { line, character: 0 },
    end: { line, character: Number.MAX_SAFE_INTEGER },
  });
  // The range clamp keeps the trailing newline out, but guard against CR.
  return text.replace(/[\r\n]+$/, "");
}
