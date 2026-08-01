# nvim parity harness

Headless acceptance test for the standalone/vim story: drives neovim (0.11+)
through the full standard-LSP surface against a real CK3 mod, following
`packages/server/README.md` verbatim. Run it manually before a release —
deliberately not in CI (needs nvim, a game install, and a real mod).

```
set PX_PARITY_MOD=D:\path\to\a\ck3\mod            (folder with descriptor.mod)
set PX_PARITY_GAME_PATH=...\Crusader Kings III\game   (optional)
set PX_PARITY_LOGS_PATH=...\Crusader Kings III\logs   (optional)
nvim --headless --clean -l scripts/nvim-parity/harness.lua
```

The server is `packages/server/dist/server.js` (override with
`PX_PARITY_SERVER`), so run `pnpm run compile` first. Results land in
`scripts/nvim-parity/results.json`; the run prints one OK/FAIL line per check.

What it proves beyond feature presence:

- hovers are plain markdown for a bare client (no `<span`, no `command:` links),
- diagnostics on a deliberately broken copy of a mod file,
- external edits (made outside the editor) are picked up without `:LspRestart`
  (dynamic `workspace/didChangeWatchedFiles`),
- `window/logMessage` carries the status mirror (token/definition counts).

The harness copies the mod to a temp dir first — the real mod is never touched.
