# @px-lsp/server changelog

The server has its own version, separate from the extension: it starts at
0.1.0 for its first npm release and only gets a bump when the server itself
changes. Before the split it moved inside the extension's version (up to
0.3.2); that history is in the extension changelog
(`packages/vscode/CHANGELOG.md`).

## 0.2.0

Capability-honest output for bare LSP clients. VSCode behavior is unchanged
(it declares everything); every other client now gets output it can actually
use instead of affordances it cannot.

### Added

- **Engine block templates in completion.** Completing an engine token whose
  `script_docs` `usage:` example qualifies inserts the block that example
  shows (`if = { limit = { … } … }`), as a `${n:…}` snippet or a plain
  skeleton depending on the client. The extractor
  (`features/blockSnippets.ts`) is guard-everything: the example must name
  the token itself, balance its braces, carry only plain identifier keys and
  no `#` comment, or it yields nothing. Measured over the shipped dumps: 679
  CK3 and 265 Vic3 effect/trigger tokens get a template.
- **Block skeletons for schema structure keys.** A structure key the schema
  marks `values: "block"` completes as `key = { }` with the cursor inside
  (~700 keys in the CK3 schema alone).
- **`client.fileLinks` capability** (`@px-lsp/protocol` 0.1.1): declare it if
  your hover renderer navigates `file:` links. Off (the default), provenance
  and set-site lines render as plain `file.txt:12` labels instead of links.

### Changed

- **Completion snippets are gated on the standard LSP
  `snippetSupport` capability.** A client that does not declare
  `textDocument.completion.completionItem.snippetSupport` now gets plain-text
  skeletons (parameter blocks included); `${` never reaches it. Previously
  scripted-effect parameter snippets were sent unconditionally.
- **The hover reference count is dropped for clients without
  `px.showReferences`.** It used to render as plain text; a count nobody can
  click answers no question.
- The deprecated `clientCommands: true` alias now also implies
  `fileLinks: true` plus snippet support, keeping old rich clients
  byte-identical.

## 0.1.0

First npm release. The full language server (parser, index, scope engine,
features, per-game profiles, bundled data) with the `px-lsp` bin, usable over
`--stdio` from any LSP client or over node-ipc.
