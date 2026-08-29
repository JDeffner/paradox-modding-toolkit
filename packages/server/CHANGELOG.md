# @px-lsp/server changelog

The server has its own version, separate from the extension: it starts at
0.1.0 for its first npm release and only gets a bump when the server itself
changes. Before the split it moved inside the extension's version (up to
0.3.2); that history is in the extension changelog
(`packages/vscode/CHANGELOG.md`).

## Unreleased

- **New `@px-lsp/server/browser` entry: the language service without node.**
  Completion, hover, diagnostics and scope inference against a single in-memory
  document, with no child process, no JSON-RPC, no workspace scan and no
  filesystem. Intended for web hosts that cannot spawn the server at all.
  `docs/EMBEDDING.md` has the API, the payload sizes and the list of what a
  browser build cannot know.
- `scripts/bake-browser-data.ts` (`pnpm run bake:browser`) runs the existing
  script_docs and wikidocs parsers at build time and emits
  `dist/browser-data/<gameId>/{tokens,docs,freqs}.json`. The prose is split from
  the token tables so a host answers completions after 225 KB brotli and can
  fetch the 72 KB of hover text later, or never.
- `loadFreqs` now delegates its validation to a new exported `coerceFreqs`, so
  the browser build validates a parsed freqs.json exactly as the node path does
  instead of duplicating the shape checks.

## 0.1.0

First npm release. The full language server (parser, index, scope engine,
features, per-game profiles, bundled data) with the `px-lsp` bin, usable over
`--stdio` from any LSP client or over node-ipc.
