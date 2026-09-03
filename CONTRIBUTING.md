# Contributing

Thanks for looking under the hood. This file gets you from a fresh clone to
a running extension and a mergeable PR. The deeper reference material lives
in [AGENTS.md](AGENTS.md) (architecture, conventions, the full repo map); it
is written for AI coding agents, but everything in it about the code applies
to humans too.

## What helps most

- **Concrete examples from real mods.** A script snippet the toolkit handles
  wrongly, with the file it came from, beats any abstract report.
- **Schema gaps.** The per-game folder tables
  (`packages/server/src/games/<game>/schema.ts`) are deliberately small and
  community-editable. A missing or wrong folder mapping, especially for EU5,
  is a good first PR, and there is an issue form for reporting one.
- **Bug reports and false diagnostics**, through the
  [issue forms](https://github.com/JDeffner/paradox-modding-toolkit/issues).
- Questions and modding help: [Discord](https://discord.gg/ESstwqycug).

## Setup

You need Node 22 or newer and [pnpm](https://pnpm.io) 11 or newer. A game
install is not required for most work; the test suite skips what it cannot
reach.

```bash
git clone https://github.com/JDeffner/paradox-modding-toolkit.git
cd paradox-modding-toolkit
pnpm install
pnpm run compile
```

`compile` bundles the language server, the extension, and every webview app.
It takes under a minute.

## Run your build

Open the repo in VS Code and press **F5**. The tracked launch configuration
rebuilds everything and opens an Extension Development Host with the toolkit
loaded. Open a mod folder in that window to try your change;
`Developer: Reload Window` there picks up a rebuild.

When you want to test the real packaged artifact, `pnpm run package:test`
builds a .vsix and installs it into your own VS Code. Never commit a .vsix.

Working on a webview panel? The dev loops section of
[docs/webviews.md](docs/webviews.md) has two faster ones: a browser dev
server with a component gallery (`pnpm run preview:webviews`) and live
panel reload (`pnpm run watch:webviews`).

## Verify

```bash
pnpm run typecheck
pnpm run lint
pnpm test
```

Scope test runs to what you changed; the full suite is for cross-cutting
work. Some suites are corpus-gated: they need paths to a game install or a
mod collection, read from `dev-paths.json` (copy `dev-paths.example.json`,
it stays out of git). Without it they skip, loudly, and that is fine.

Two more gates for specific areas:

- Touching `packages/server/src`? Run
  `node scripts/check-game-boundary.mjs`. All game-specific knowledge lives
  behind the `GameProfile` boundary, and this script enforces it.
- Touching completion ranking? Changes must come with before and after
  numbers from `scripts/rank-eval.ts` and `scripts/fuzzy-diag.ts`, not vibes.

## Finding your way

| You want to | Start at |
|---|---|
| Understand the layout | The repo map in [AGENTS.md](AGENTS.md) |
| Add or change a visual tool (webview panel) | [docs/webviews.md](docs/webviews.md) |
| Add a wire request or embed the server | [docs/PROTOCOL.md](docs/PROTOCOL.md), [docs/EMBEDDING.md](docs/EMBEDDING.md) |
| Add a diagnostic explanation | [docs/diagnostics/](docs/diagnostics/) |
| Understand the GUI editor | [packages/vscode/src/webviews/guiEditor/README.md](packages/vscode/src/webviews/guiEditor/README.md) |

## The rules that get PRs merged

A few principles are load-bearing here. PRs that follow them merge fast;
PRs that fight them stall.

1. **Game knowledge is derived, never hand-written.** A trigger name, a
   folder rule, or a loc convention comes from the game files, the `_*.info`
   docs, a `script_docs` dump, or a harvest. If you cannot point at where the
   game says it, do not add it. Hand-maintained rule files are what killed
   the tools this project replaced.
2. **Game-specific code goes behind `GameProfile`**
   (`packages/server/src/games/<id>/`), gated on profile data rather than
   `if (gameId === ...)` checks.
3. **Files we write must be correct by construction.** The games fail
   silently, so every writer produces the exact encoding and layout the
   engine needs (localization is UTF-8 with BOM, correct header, correct
   filename; script files start with their `namespace =` line).
4. **No `vscode` imports** in `packages/server` or `packages/protocol`.
   Server and protocol code must run and test in plain Node.
5. **Naming: `px` is the product, `ck3` is the game.** Settings, commands
   and packages we invent are `px.*`; things that belong to a game keep its
   id.

## Sending a PR

Branch from `main` (`feat/`, `fix/`, `docs/`, `chore/`), commit with
messages that explain why, and include one changelog bullet under
"Unreleased" in `packages/vscode/CHANGELOG.md` (plus the server or protocol
changelog if you touched those packages). CI runs typecheck, lint, tests and
the boundary check; Sourcery reviews alongside it. The maintainer
squash-merges, so `main` stays one commit per landed change.

Plans and design notes belong in the PR description, not in the repo.

## License

GPL-3.0-or-later. Keep derivatives open, do not add code translated from
non-GPL projects, and never commit game assets.
