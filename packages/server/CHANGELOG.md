# @px-lsp/server changelog

The server has its own version, separate from the extension: it starts at
0.1.0 for its first npm release and only gets a bump when the server itself
changes. Before the split it moved inside the extension's version (up to
0.3.2); that history is in the extension changelog
(`packages/vscode/CHANGELOG.md`).

## Unreleased

### Added

- `producersOf(data, typeName)` in `data/dataTypes.ts`: the reverse of
  `membersOf`, listing every global and member whose return type is
  `typeName`, as qualified names. Built lazily per `DataTypesData` and cached
  against it, so a reloaded `data_types.log` gets a fresh index with no
  explicit invalidation. The datafunction hover uses it for its new
  `Produced by:` line.

## 0.1.0

First npm release. The full language server (parser, index, scope engine,
features, per-game profiles, bundled data) with the `px-lsp` bin, usable over
`--stdio` from any LSP client or over node-ipc.
