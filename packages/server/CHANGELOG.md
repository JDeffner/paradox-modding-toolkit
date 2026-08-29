# @px-lsp/server changelog

The server has its own version, separate from the extension: it starts at
0.1.0 for its first npm release and only gets a bump when the server itself
changes. Before the split it moved inside the extension's version (up to
0.3.2); that history is in the extension changelog
(`packages/vscode/CHANGELOG.md`).

## Unreleased

### Added

- `producersOf(data, typeName)` in `data/dataTypes.ts`: the reverse of
  `membersOf`, listing every global and member whose return type is `typeName`.
  Built lazily per `DataTypesData` and cached against it, so a reloaded
  `data_types.log` gets a fresh index with no explicit invalidation.
- `features/definitionBody.ts`: the source block of an indexed definition, for
  the hover. Brace-scans from the definition's own line (O(block), not O(file))
  and caches the file already split into lines plus every block it extracted,
  keyed on path and mtime. Benched against vanilla `common/scripted_triggers`
  (3,119 definitions, 127 files): 390 µs cold, **25 µs warm**, a 16x speedup.
  Caching the raw text instead measured 66 µs, because every hover re-split a
  multi-thousand-line file and re-ran the scan.
- `hoverIcons` client capability: the client renders `$(codicon)` in hover
  markdown. Default false, and the default matters, since a client without it
  prints the literal text `$(symbol-method)`.
- `ParadoxSettings.hoverDetail` (`compact` | `standard` | `full`).

### Changed

- **One kind map, in `@px-lsp/protocol/kinds`.** Glyph, completion-item kind and
  colour family per concept, read by the hover badge, the completion list and
  the client's tree views. It replaced two hand-maintained tables that disagreed
  with each other and with the trees.
- `features/hoverRender.ts` rewritten around four slots (head, doc, example,
  facts) plus one shared footer line per hover instead of a footer per card.
  Badges render in three tiers by capability: codicon, `■` square, or plain
  text. `CardInput.traits` becomes `facts`; `CardInput.footer: string[]` becomes
  `provenance: string`, used only by multi-card hovers.
- Long fenced blocks cap inline and disclose the rest with `<details>`, which is
  on VS Code's markdown sanitizer allowlist and does expand in place in a real
  hover. This is the workaround for `editorHoverVerbosityLevel` still being a
  proposed API that cannot ship to the Marketplace. The disclosure is capped
  too, because a hover cannot grow past the editor viewport.

### Removed

- `isShortExample()`, dead since it was written: exported and unit-tested but
  never called. The example cap it was meant for now lives in `fencedBlock`.

## 0.1.0

First npm release. The full language server (parser, index, scope engine,
features, per-game profiles, bundled data) with the `px-lsp` bin, usable over
`--stdio` from any LSP client or over node-ipc.
