<img src="media/px-lsp.svg" alt="PX LSP" width="96" align="right" />

# px-lsp server

Language server for Paradox script, localization (`.yml`) and `.gui` files,
covering **Crusader Kings III**, **Victoria 3** and **Europa Universalis V**.
This is the engine behind the
[Paradox Modding Toolkit](https://marketplace.visualstudio.com/items?itemName=JDeffner.px-toolkit)
VS Code extension, usable standalone from **any LSP-capable editor** over
`--stdio` (neovim, Zed, Helix, ...).

What you get outside VS Code: ranked completion, hover docs, go-to-definition,
find references, rename, document/workspace symbols, folding, formatting,
semantic tokens, inlay hints and the structural/localization diagnostics.
Game knowledge comes from your own game install and `script_docs` dumps; CK3
and Victoria 3 additionally ship bundled fallbacks (wiki tables and a
script_docs snapshot), EU5 does not yet (see
[Per-game support](#per-game-support)).

Hovers, code actions and logging adapt to the client automatically: a plain LSP
client gets clean markdown, real `WorkspaceEdit` quick fixes and a status
mirror in the log. Nothing has to be configured for that.

## Requirements

- **Node.js 18+** on your PATH (not needed for the Windows zip below, which
  brings its own).
- A game install (optional but strongly recommended: powers vanilla
  definitions, asset paths and exact-version tokens).

## Install

### From npm

```bash
npm install -g @px-lsp/server
px-lsp --version   # prints the server version
px-lsp             # runs over stdio (--stdio is the default transport)
```

The npm package carries the same payload as the release tarball: the bundled
`dist/server.js` (the `px-lsp` bin), the `data/` fallbacks, and the TypeScript
sources. The sources exist for bundler consumers (esbuild, Vite) that import
pieces like `@px-lsp/server/parser` directly; plain Node cannot import them,
use the bin or the wire protocol instead.

### The release tarball

Download `px-lsp-server-<version>.tar.gz` from the
[GitHub releases](https://github.com/JDeffner/paradox-modding-toolkit/releases)
and extract it anywhere, e.g. `~/.local/share/px-lsp/`. Layout:

```
px-lsp-server-<version>/
  dist/server.js     # the bundled server
  data/ck3/          # bundled fallback data, found automatically
  data/vic3/
  README.md LICENSE THIRD-PARTY-NOTICES.md
```

> **Do not flatten the tarball.** The server finds its bundled data at
> `../data/<gameId>/` relative to `dist/server.js`, so `dist/` and `data/`
> must stay siblings. If you copy `server.js` somewhere on its own it still
> starts and still answers requests, it just silently loses the bundled wiki
> tokens and the completion frequency tables. The startup log line under
> [Self-diagnosis](#self-diagnosis) tells you which of the two you have.

Sanity check:

```bash
node path/to/px-lsp-server-<version>/dist/server.js --stdio
# it waits for LSP messages on stdin; Ctrl+C to quit
```

### Windows: the self-contained zip

`px-lsp-win-x64-<version>.zip` from the same release is the tarball payload
plus an unmodified official Node build, so nothing has to be installed first.
It is the artifact to embed if you ship the server inside another application
(`docs/EMBEDDING.md` in the repo is the guide for doing that).

```
px-lsp-win-x64-<version>/
  px-lsp.cmd         # the launcher: runs the bundled node against dist/server.js --stdio
  node.exe           # official nodejs.org win-x64 build, unmodified
  NODE-LICENSE       # Node's own license (our GPL LICENSE keeps the plain name)
  dist/ data/ README.md LICENSE THIRD-PARTY-NOTICES.md
```

Point your client's command at `px-lsp.cmd` and pass no arguments: it already
adds `--stdio`, and everything it resolves is relative to its own folder, so
the unpacked directory can live anywhere. Extra arguments are forwarded.

## Which game

The server serves **one game per instance**, selected by the `gameId` setting
(`"ck3"` (default), `"vic3"`, `"eu5"`). There is no auto-detection outside VS
Code: set it explicitly for anything but CK3.

`gamePath` and `logsPath` always describe the **active** game:

| `gameId` | Mod is identified by | `gamePath` | `logsPath` (script_docs dumps) |
|---|---|---|---|
| `ck3` | `descriptor.mod` | `…/steamapps/common/Crusader Kings III/game` | `~/Documents/Paradox Interactive/Crusader Kings III/logs` |
| `vic3` | `.metadata/metadata.json` | `…/steamapps/common/Victoria 3/game` | `~/Documents/Paradox Interactive/Victoria 3/docs` (**not** `logs`) |
| `eu5` | `.metadata/metadata.json` + stage folders | `…/steamapps/common/Europa Universalis V/game` | `~/Documents/Paradox Interactive/Europa Universalis V/docs` (**not** `logs`) |

Path specifics worth knowing before you wire them:

- Victoria 3's and EU5's `script_docs` console command writes to
  `Documents/Paradox Interactive/<Game>/docs`, **not** to `logs/`. Pointing
  `logsPath` at `logs/` there finds nothing. (The data-type dump still lands
  under `logs/` — the server probes the sibling `logs/` folder automatically.)
- EU5 mods put their content under a **load-stage folder**: gameplay script
  lives in `<mod>/in_game/common/...`, `<mod>/in_game/events/...`, and so on
  (`main_menu/` and `loading_screen/` are the other two). The mod root itself
  is the folder holding `.metadata/`. Keep `root_markers`/`root_dir` on that
  root, not on `in_game/`, or nothing below it classifies.

## Neovim setup (0.11+)

**1. Filetypes.** Paradox script is plain `.txt` and localization is `.yml`, so
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
`after/ftdetect/paradox.lua` — see neovim/neovim#29468. The patterns above are
suffix matches, so they also catch EU5's `in_game/common/...` layout.)

The plain `paradox` filetype stays correct for every game: the VS Code
extension sends per-game ids (`paradox-ck3`, `paradox-vic3`, `paradox-eu5`)
only to get a per-game file icon and label, and the server treats every one of
them, and plain `paradox`, as the same script language.

**Failure mode to recognize:** if a file opens with no diagnostics, no
highlighting and an empty completion popup, check `:set filetype?` first. A
`.txt` that stayed `text` never reaches the server at all, and the server
cannot report a problem it never heard about.

**2. The server.** Adjust the paths and the game id (replace `<version>`
everywhere with the release you downloaded, e.g. `0.3.0`):

```lua
vim.lsp.config("px_lsp", {
  cmd = {
    "node",
    vim.fn.expand("~/.local/share/px-lsp/px-lsp-server-<version>/dist/server.js"),
    "--stdio",
  },
  filetypes = { "paradox", "paradox-loc", "paradox-gui" },
  -- The mod root: the folder holding descriptor.mod (CK3) or .metadata/ (Vic3, EU5).
  root_markers = { "descriptor.mod", ".metadata", ".git" },
  init_options = {
    settings = {
      -- "ck3" (default) | "vic3" | "eu5".
      gameId = "ck3",
      -- The game's data folder ("<steam>/steamapps/common/<Game>/game").
      gamePath = "C:/Program Files (x86)/Steam/steamapps/common/Crusader Kings III/game",
      -- Folder with the script_docs dumps (see below). Omit for bundled data only.
      logsPath = vim.fn.expand("~/Documents/Paradox Interactive/Crusader Kings III/logs"),
      locLanguage = "english",
    },
  },
})
vim.lsp.enable("px_lsp")
```

Do **not** set `client`: those capability flags are a client declaring that it
registers the `px.*` editor commands, renders the sanitized hover HTML, or runs
its own file watcher. Declaring none of them gives the plain-client behavior
described above, which is what you want here. (`clientCommands = true` is the
deprecated all-on alias; do not set it either.)

**Failure mode to recognize:** if `root_markers` never match, the server falls
back to the first workspace folder as the mod root. Open the mod folder itself
(or set `modPath`), otherwise workspace-mod-only features (reference
diagnostics, required-localization checks, the loc quick fix) stay silent
because the file belongs to no known mod.

You do NOT need to set a mod path when the root markers match: the server
indexes the workspace root automatically. Extra optional settings, same shape
as the VS Code extension: `parentPaths` (dependency mods, load order, base
first), `diagnosticsIgnore` (codes to suppress), `diagnosticsIgnorePatterns`
(globs), `scopeInlayHints` (default false).

Beyond standard LSP the server also answers custom `paradox/*` requests
(overview data, GUI layout, …) — see `docs/PROTOCOL.md` in the repo; a plain
editor client can ignore them entirely. Wiring the server into an application
instead of an editor is a different job: `docs/EMBEDDING.md` has the guide for
that (process contract, the initialization options an app should send, URI and
document-sync conventions, reference clients).

On neovim 0.10, use `require("lspconfig.configs")` with the same `cmd`/
`init_options` and `root_dir = require("lspconfig.util").root_pattern("descriptor.mod", ".metadata")`.

**3. Game-exact data (recommended, required for Vic3 and EU5).** Your own
`script_docs` dumps are what teach the server the engine's effects, triggers,
event targets and modifiers:

1. Launch the game with `-debug_mode`.
2. Open the console (`` ` ``) and run `script_docs`, then the data-type dump
   (`DumpDataTypes` on CK3, `dump_data_types` on Vic3) if the game offers it.
3. Point `logsPath` at the dump folder (`logs/` for CK3, `docs/` for Vic3 and
   EU5), then restart the server (`:edit` a file or `:LspRestart`).

CK3 and Vic3 ship bundled fallbacks (wiki tables for CK3, a script_docs
snapshot for Vic3), so this step is an exact-version upgrade there. For EU5
nothing is bundled yet, so it is the difference between working
completion/hover and a thin index of your own definitions only.

## What works where

Per language id, because the answer genuinely differs:

| | `paradox` (script `.txt`) | `paradox-loc` (`.yml`) | `paradox-gui` (`.gui`) |
|---|---|---|---|
| Completion | full | inside `[ … ]` expressions and `#format` tags | widget types, properties, `using` templates |
| Hover | full | `[ … ]` and `#format` tags | full |
| Go to definition | yes | `[ … ]` names (custom loc, saved scopes) | types, templates, `blockoverride` targets |
| Find references | yes | on loc-key lines | — |
| Rename | yes | — | — |
| Signature help | yes | `[ … ]` calls | `[ … ]` calls |
| Document symbols | yes | yes | yes |
| Workspace symbols | yes (index-wide, any file type) | | |
| Folding | yes | — | — |
| Formatting | yes | — | — |
| Semantic tokens | yes | — | yes |
| Code actions | yes | — | — |
| Inlay hints | loc value previews; scope hints with `scopeInlayHints = true` | translation overlay | loc value previews |
| Diagnostics | structural + references + required localization | loc header/filename/encoding checks | unbalanced braces only |

The dashes are deliberate, not stubs: the server declares the capability
globally (LSP has no per-language-id capability negotiation) and returns an
empty result for the language ids where the feature has no meaning.

## In a browser

`@px-lsp/server/browser` is a second entry point: the same parser, schema and
token tables as a plain library, for hosts that cannot spawn a process at all.

```ts
import { createBrowserLanguageService } from "@px-lsp/server/browser";

const service = createBrowserLanguageService({
  tokens: await (await fetch("/px/tokens.json")).json(),
});
const doc = service.openDocument("events/tutorial.txt", text);
doc.diagnostics();
doc.completions(offset);
```

The token tables ship as prebaked JSON under
`@px-lsp/server/browser-data/<gameId>/`, split so a page can answer completions
and diagnostics from 225 KB brotli and fetch the hover prose later.

It has one file: the one you opened. There is no workspace index, so
references to definitions in other files do not resolve and the
unknown-reference diagnostics are omitted rather than guessed. The service
reports this on `capabilities`. `docs/EMBEDDING.md` has the full contract.

## Per-game support

| | CK3 | Victoria 3 | EU5 |
|---|---|---|---|
| Schema (folder → definition kind) | 156 entries, verified against a live install | 72 entries, verified against a live install | 518 entries, imported from [cwtools-eu5-config](https://github.com/kaiser-chris/cwtools-eu5-config), **unverified against a live install** |
| Engine tokens with no `script_docs` dump | bundled wiki fallback + bundled dump snapshot | bundled dump snapshot | none (thin until you dump) |
| `script_docs` location / format | `logs/`, classic text | `docs/`, markdown | `docs/`, markdown |
| Completion frequency ranking | bundled (vanilla + corpus) | bundled (vanilla) | none |
| `.gui` widget schema | bundled (556 types) | bundled (579 types) | none |
| `[ … ]` data-type chains | bundled tables + dump snapshot + your own dump | bundled dump snapshot + your own dump | bundled dump snapshot + your own dump |
| Required-localization diagnostics | yes | yes (49 measured claims) | none, by design |
| Deep validation (tiger) | ck3-tiger | vic3-tiger | none exists |
| Mod descriptor | `descriptor.mod` | `.metadata/metadata.json` | `.metadata/metadata.json` |
| Layout quirks | — | plural `common/on_actions` | stage roots (`in_game/` …), `REPLACE:`/`INJECT:` entry keys |

The EU5 table is a lossy projection of community CWT rules and is only as
right as those rules are. Its blast radius is bounded on purpose: a minimal
hand-checked set of reference fields and **zero** required-localization
patterns, so a wrong entry costs you navigation, never a false diagnostic. Fix
gaps locally with a `<mod>/.px-toolkit/schema.json` overlay, and please report
them. Attribution and license texts: `THIRD-PARTY-NOTICES.md`, shipped in the
tarball next to this README.

## Known limitations outside VS Code

- **No tiger diagnostics.** The download/run integration lives in the VS Code
  client. Deep validation (unknown effects, unknown traits, wrong argument
  types) is deliberately tiger's job, not this server's. Run
  [ck3-tiger / vic3-tiger](https://github.com/amtep/tiger) yourself. The
  server's own diagnostics stay in the class it can decide with certainty:
  structural damage, encoding and file-layout traps, missing required
  localization, and references to events that do not exist in any namespace
  your mod declares (that last one works in every client).
- **No overview UIs** (event graph, GUI preview, mod report, coverage views):
  those are VS Code webviews.
- **No `.dds` viewer.** Hovering a texture path still produces a hover, but the
  preview is a data-URI image: clients that do not render images in hover
  markdown show the link text instead of the picture.

## Self-diagnosis

Everything the server knows about its own state goes to `window/logMessage`,
i.e. `:LspLog` in neovim. Three lines answer almost every "why is it empty"
question:

```
[10:02:11] bundled data for 'ck3': /home/you/.local/share/px-lsp/px-lsp-server-0.3.0/data/ck3/wikidocs
[10:02:11] parsed script_docs logs (4213 tokens, 180ms)
[10:02:14] status: 4213 tokens (script_docs), 128394 definitions
```

- The first line names the **resolved data directory** for the active game. If
  it instead reads `no bundled data found for '<id>' (looked next to the server
  bundle)`, either the tarball got flattened or the game ships no bundled data
  (only CK3 has a wiki mirror; EU5 ships a data-type snapshot but no
  script_docs snapshot yet).
- `script_docs logs path not found` or `missing log files in <path>` means
  `logsPath` is wrong or the dump was never made.
- The `status:` line is the mirror of the `paradox/status` notification, logged
  on transitions. `0 tokens` means no engine vocabulary, `0 definitions` means
  nothing indexed (usually a mod-root problem), and `(bundled)` vs
  `(script_docs)` tells you which source the tokens came from.

## Acceptance harness

`scripts/nvim-parity/` in the repo drives headless neovim through this exact
setup against a real mod and checks the standard-LSP surface end to end,
including that hovers contain no VS Code markup or dead `command:` links, that
external edits are picked up without a restart, and that the status mirror
shows up in the log. It is run by hand before a release (it needs neovim, a
game install and a real mod), not in CI. Its README has the invocation.

## Building from source

```bash
pnpm install
pnpm run compile
node packages/server/dist/server.js --stdio
```

## License

GPL-3.0-or-later. Bundled wiki token lists are CC BY-SA 3.0 — see
`data/ck3/wikidocs/ATTRIBUTION.md`. The EU5 schema table is derived from
MIT-licensed community CWT rules, see `THIRD-PARTY-NOTICES.md`.
