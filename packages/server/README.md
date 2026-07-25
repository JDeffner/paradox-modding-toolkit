<img src="media/px-lsp.svg" alt="PX LSP" width="96" align="right" />

# px-lsp server

Language server for Crusader Kings III Paradox script, localization (`.yml`)
and `.gui` files. This is the engine behind the
[Paradox Toolkit](https://marketplace.visualstudio.com/items?itemName=JDeffner.px-toolkit)
VS Code extension, usable standalone from **any LSP-capable editor** over
`--stdio` (neovim, Zed, Helix, ...).

What you get outside VS Code: ranked completion, hover docs, go-to-definition,
find references, rename, document/workspace symbols, folding, formatting,
semantic tokens, inlay hints and the structural/localization diagnostics.
Game knowledge comes from your own game install and `script_docs` logs, with
bundled wiki data as the fallback.

## Requirements

- **Node.js 18+** on your PATH.
- A CK3 install (optional but strongly recommended: powers vanilla
  definitions, asset paths and exact-version tokens).

## Install

Download `px-lsp-server-<version>.tar.gz` from the
[GitHub releases](https://github.com/JDeffner/ck3-modding-toolkit/releases)
and extract it anywhere, e.g. `~/.local/share/px-lsp/`. Layout:

```
px-lsp-server-<version>/
  dist/server.js     # the bundled server
  data/ck3/          # bundled fallback data (found automatically)
  README.md LICENSE
```

Sanity check:

```bash
node path/to/px-lsp-server-<version>/dist/server.js --stdio
# it waits for LSP messages on stdin; Ctrl+C to quit
```

## Neovim setup (0.11+)

**1. Filetypes.** CK3 script is plain `.txt` and localization is `.yml`, so
teach neovim which files are which. Anchor the patterns to your mod folder(s)
if the generic ones are too broad:

```lua
vim.filetype.add({
  extension = {
    gui = "paradox-gui",
  },
  pattern = {
    [".*/common/.*%.txt"] = "paradox",
    [".*/events/.*%.txt"] = "paradox",
    [".*/history/.*%.txt"] = "paradox",
    [".*/localization/.*%.yml"] = "paradox-loc",
  },
})
```

(If a builtin pattern wins over one of these, move the rules to
`after/ftdetect/paradox.lua` — see neovim/neovim#29468.)

**2. The server.** Adjust the three paths:

```lua
vim.lsp.config("px_lsp", {
  cmd = {
    "node",
    vim.fn.expand("~/.local/share/px-lsp/px-lsp-server-<version>/dist/server.js"),
    "--stdio",
  },
  filetypes = { "paradox", "paradox-loc", "paradox-gui" },
  -- The mod root: the folder holding descriptor.mod (and common/, events/, ...).
  root_markers = { "descriptor.mod", ".git" },
  init_options = {
    settings = {
      -- CK3's game data folder ("<steam>/steamapps/common/Crusader Kings III/game").
      gamePath = "C:/Program Files (x86)/Steam/steamapps/common/Crusader Kings III/game",
      -- Folder with the script_docs logs (see below). Omit to use bundled data only.
      logsPath = vim.fn.expand("~/Documents/Paradox Interactive/Crusader Kings III/logs"),
      locLanguage = "english",
    },
  },
})
vim.lsp.enable("px_lsp")
```

You do NOT need to set a mod path: the server indexes the workspace root
(your `root_markers` match) automatically. Extra optional settings, same
shape as the VS Code extension: `gameId` (game profile, defaults to `"ck3"`),
`parentPaths` (dependency mods, load order, base first), `diagnosticsIgnore`
(codes to suppress), `diagnosticsIgnorePatterns` (globs), `scopeInlayHints`
(default false).

Beyond standard LSP the server also answers custom `paradox/*` requests
(overview data, GUI layout, …) — see `docs/PROTOCOL.md` in the repo; a plain
editor client can ignore them entirely.

On neovim 0.10, use `require("lspconfig.configs")` with the same `cmd`/
`init_options` and `root_dir = require("lspconfig.util").root_pattern("descriptor.mod")`.

**3. Game-exact data (recommended).** The bundled wiki data works out of the
box; your own `script_docs` logs upgrade it to your exact game version and add
modifiers:

1. Launch CK3 with `-debug_mode`.
2. Open the console (`` ` ``) and run `script_docs`, then `DumpDataTypes`.
3. Make sure `logsPath` points at the game's `logs` folder, then restart the
   server (`:edit` a file or `:LspRestart`).

## Known limitations outside VS Code

- **No ck3-tiger diagnostics**: the tiger download/run integration lives in
  the VS Code client today. Run [ck3-tiger](https://github.com/amtep/tiger)
  separately.
- **No overview UIs** (event graph, GUI preview, mod report, coverage views):
  VS Code webviews.
- **External file changes are not re-indexed**: the server sees files you
  open/edit/save in the editor; edits made outside neovim need a server
  restart to be picked up.

## Building from source

```bash
pnpm install
pnpm run compile
node packages/server/dist/server.js --stdio
```

## License

GPL-3.0-or-later. Bundled wiki token lists are CC BY-SA 3.0 — see
`data/ck3/wikidocs/ATTRIBUTION.md`.
