/**
 * The one kind → `SymbolKind` mapping, derived from the shared kind map in
 * `@px-lsp/protocol/kinds`. Document symbols (breadcrumbs, outline, sticky
 * scroll) and workspace symbols (Ctrl+T) both resolve through here, so an event
 * draws the same picture in the breadcrumb bar as in its hover badge and its
 * suggest row. It replaced a hand-kept table that sent an event to
 * `SymbolKind.Event`, the lightning glyph, while the map drew it as a class.
 */
import { SymbolKind } from "vscode-languageserver/node";
import { kindStyle } from "@px-lsp/protocol/kinds";

/**
 * `SymbolKind` whose glyph is the map's picture for `kind`. Object is the
 * fallback for a kind the map does not name and for the few pictures no
 * `SymbolKind` draws; it is the neutral "a thing" the outline already used.
 */
export function lspSymbolKind(kind: string): SymbolKind {
  const name = kindStyle(kind).symbolKind;
  return (name ? SymbolKind[name as keyof typeof SymbolKind] : undefined) ?? SymbolKind.Object;
}
