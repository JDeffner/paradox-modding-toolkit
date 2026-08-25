# @px-lsp/protocol changelog

The protocol has its own version, separate from the extension: it starts at
0.1.0 for its first npm release and only gets a bump when the wire contract or
the shared helpers change. Before the split it moved inside the extension's
version (up to 0.3.2); that history is in the extension changelog
(`packages/vscode/CHANGELOG.md`).

## 0.1.0

First npm release. The wire contract (custom `paradox/*` requests and
notifications, settings types) and the shared helpers, compiled to CommonJS
with type declarations.
