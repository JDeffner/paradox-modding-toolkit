# px-lsp

Monorepo for the Paradox-script language tooling:

- [`packages/server`](packages/server) — `@px-lsp/server`, the language
  server (node-ipc and `--stdio`). Its [README](packages/server/README.md)
  covers standalone use from other editors (neovim setup, release tarball).
- [`packages/protocol`](packages/protocol) — `@px-lsp/protocol`, the wire
  contract (custom requests/notifications, settings types) plus helpers shared
  between server and clients.
- [`packages/vscode`](packages/vscode) — the **Paradox Modding Toolkit** VS Code
  extension ([marketplace](https://marketplace.visualstudio.com/items?itemName=JDeffner.px-toolkit)),
  the primary client. Its README is the user-facing one.

Development: `pnpm install`, then `pnpm run compile` (bundles server +
extension), `pnpm test` (vitest), `pnpm run typecheck`. Corpus-gated tests and
dev scripts read machine paths from `dev-paths.json` (copy
`dev-paths.example.json`).

License: GPL-3.0-or-later.
