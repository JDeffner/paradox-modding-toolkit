# @px-lsp/server changelog

The server has its own version, separate from the extension: it starts at
0.1.0 for its first npm release and only gets a bump when the server itself
changes. Before the split it moved inside the extension's version (up to
0.3.2); that history is in the extension changelog
(`packages/vscode/CHANGELOG.md`).

## Unreleased

- Custom-calendar date display when `settings.calendar` is set: inlay hints
  after date tokens in script files and a hover card with the in-game form.
  The setting is sanitized on intake, so clients may pass raw JSON.

## 0.1.0

First npm release. The full language server (parser, index, scope engine,
features, per-game profiles, bundled data) with the `px-lsp` bin, usable over
`--stdio` from any LSP client or over node-ipc.
