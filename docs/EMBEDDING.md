# Embedding px-lsp in an application

How to run the px-lsp language server (`@px-lsp/server`) inside a desktop
application that already knows where the game, the logs and the mod live.

The audience is the person wiring the server into a host application, not an
editor user. If you are configuring neovim or another editor, read
`packages/server/README.md` instead: it covers filetypes, root markers and the
setup failure modes. This document covers the process contract, the
initialization options an application should send, the wire surface beyond
standard LSP, and what deliberately does not exist for a non-VS Code client.

The wire types are the contract. TypeScript hosts should import them from
`@px-lsp/protocol/protocol`; everyone else reads `docs/PROTOCOL.md`, which
mirrors that file method by method.

## The process contract

### Spawning

The server is one Node process speaking JSON-RPC 2.0 with LSP framing. It picks
its transport from `process.argv`, so the transport is a command-line argument,
not an API call:

| Argument | Transport |
|---|---|
| `--stdio` | stdin/stdout. What an embedding application uses. |
| `--node-ipc` | Node's parent/child IPC channel. Requires `child_process.fork`. |
| `--socket=<port>` (or `--socket <port>`) | TCP: the server connects out to `127.0.0.1:<port>`, so the host listens. |
| `--pipe=<name>` (or `--pipe <name>`) | Named pipe / unix domain socket, same direction. |

With none of them, the server defaults to `--stdio` (unless it was forked over
node IPC, which it detects from `process.send`), so a bare `px-lsp` behaves
like `px-lsp --stdio`. `px-lsp --version` prints the server version and exits
without a handshake, for install scripts and health checks.

```
node /path/to/px-lsp-server-0.3.0/dist/server.js --stdio
```

The Windows zip ships `px-lsp.cmd`, which is exactly that line against the
bundled `node.exe` with every path resolved from `%~dp0`, and forwards any
extra arguments. Point your host at the `.cmd` and pass nothing.

**Heap ceiling.** The definition index is the dominant allocation and it is
large by design: measured at roughly 924 bytes per definition, about 408 MB for
a full vanilla scan, with peak during the scan around 1.5x that, plus the whole
definition set of every extra root (workspace mods and the `parentPaths` submod
chain). Node sizes its default old space from system RAM, which lands near 2 GB
on an 8 GB machine, inside crash range for a total conversion on top of a
framework parent. The VS Code client therefore forks the server with
`--max-old-space-size`: 4 GB, cut toward half of physical RAM on a small
machine but never below 2 GB (`packages/vscode/src/serverHeap.ts`). Do the
same:

- spawning `node` yourself: pass `--max-old-space-size=4096` before the script
  path;
- launching `px-lsp.cmd`: set `NODE_OPTIONS=--max-old-space-size=4096` in the
  child environment, since the launcher's forwarded arguments reach the script,
  not the runtime.

### The orphan watchdog

`vscode-languageserver` installs a watchdog for you, but only if you tell it
which process to watch. Send your own pid as `processId` in the `initialize`
params (or pass `--clientProcessId <pid>` on the command line). The server then
polls that pid every 3 seconds with a null signal and exits as soon as it
disappears, with code 0 if `shutdown` had been received and 1 otherwise.

Send it. A host that crashes without it leaves an orphaned server holding its
index, and the next launch adds another one.

Over `--stdio` there is a second safety net: an `end` or `close` on stdin exits
the process the same way. It fires when the pipe is actually torn down, which a
hard-killed parent on Windows does not always do, so it is a backstop and not a
replacement for `processId`.

### The clean-stdout guarantee

Over `--stdio`, stdout carries protocol frames and nothing else. The server
source writes to neither `console.log` nor `process.stdout`; its own logging
goes through `connection.console.log`, which is a `window/logMessage`
notification. On top of that, `vscode-languageserver` replaces the whole
`console.*` family with connection-routed logging when the transport is stdio,
so even a stray `console.log` from a dependency arrives as a log notification
rather than as corruption in the middle of a JSON-RPC frame.

stderr is not part of the contract. Node's own warnings and an unhandled
exception trace land there. Capture it into your host's log, do not parse it.

Everything the server knows about its own health is mirrored to
`window/logMessage`: a startup line naming the resolved bundled-data folder (or
its absence) and `status:` lines with token and definition counts on indexing
transitions. Surface that channel somewhere reachable. "Completion is empty" is
answered by those lines and by almost nothing else.

### Shutdown

The standard LSP sequence, and it is worth following exactly:

1. `shutdown` request, await the response;
2. `exit` notification;
3. the process exits 0.

Skipping the `shutdown` request and sending only `exit` also terminates the
server, but with exit code 1, because an exit that was never announced is
indistinguishable from a crash. If your host treats a non-zero exit as an error
worth reporting, that is where the spurious report comes from.

## Initialization

### The minimal options for an application that knows its paths

An editor plugin has to discover the mod root from the workspace. An
application usually knows it already, and can say so:

```jsonc
{
  "processId": 12345,
  "rootUri": null,
  "capabilities": { /* your LSP client capabilities */ },
  "initializationOptions": {
    "storageDir": "C:/Users/you/AppData/Local/YourApp/px-lsp",
    "settings": {
      "gameId": "ck3",
      "gamePath": "D:/Steam/steamapps/common/Crusader Kings III/game",
      "logsPath": "C:/Users/you/Documents/Paradox Interactive/Crusader Kings III/logs",
      "modPath": "D:/mods/my_mod",
      "workspaceMods": ["D:/mods/my_mod"],
      "locLanguage": "english"
    }
  }
}
```

That is the whole useful minimum. Every field is optional and the server has
fail-soft fallbacks for all of them, but each one you omit costs something
concrete:

- **`gameId`** picks the game profile (`"ck3"` default, `"vic3"`, `"eu5"`).
  There is no auto-detection outside VS Code, so set it explicitly for anything
  but CK3. One server instance serves one game; changing it later through
  `paradox/configChanged` triggers a full reload.
- **`gamePath`** is the game's `game/` folder, the source of vanilla
  definitions, asset paths and override detection. Without it the index knows
  only the mod.
- **`logsPath`** is the folder holding the user's `script_docs` dumps. CK3 and
  Vic3 ship bundled fallbacks (wiki tables, dump snapshots), so there it is an
  exact-version upgrade; EU5 ships only a data-type snapshot so far, so for
  engine tokens it is the
  difference between working completion and a thin index of the user's own
  definitions. Vic3/EU5 write script_docs to `Documents/.../docs`; the
  data-type dump lands under `logs/` and the server probes the sibling
  `logs/` folder of a docs-style `logsPath` automatically.
- **`modPath`** is the mod root. Absent, the server falls back to the first
  workspace folder, then to nothing, and features that need a known mod
  (reference diagnostics, required-localization checks, the localization quick
  fix) stay silent because the open file belongs to no mod it knows.
- **`workspaceMods`** are the roots being *edited*. Listing a root here is what
  upgrades it from a plain definition scan to reference indexing plus reference
  diagnostics. `modPath` itself always gets that treatment, so a single-mod
  host can send `modPath` alone (setting `workspaceMods` to `[modPath]` is
  equivalent) — which is also why a bare editor client whose workspace root
  becomes the fallback `modPath` still gets reference diagnostics. Read-only
  dependency mods go in `parentPaths` instead, base first, in load order.
- **`locLanguage`** selects the localization language for inlay previews and
  coverage.

The remaining settings (`parentPaths`, `scopeInlayHints`, `diagnosticsIgnore`,
`diagnosticsIgnorePatterns`, `diagnosticsVanilla`) are documented in
`docs/PROTOCOL.md`. Push the whole settings object again as
`paradox/configChanged` whenever the user changes any of it; the server
re-resolves without a restart.

### storageDir: put it somewhere persistent

`storageDir` is where the server caches parsed `script_docs` and the harvested
data-function usage tables, per game (the filenames carry a per-profile
suffix, so several games can share one directory).

Unset, it defaults to `<os tmpdir>/px-lsp`. That works and it is what a bare
editor client gets, but it is the wrong choice for an application: temp
directories get swept, so the first launch after a cleanup pays the full parse
again for no reason. Point it at your host's own per-user data directory (the
VS Code client uses the extension's global storage path).

Create that directory yourself. The server only creates the tmpdir default, and
every cache write swallows its own failure, so a path that does not exist costs
you the cache silently instead of raising anything.

### serverInfo

The `initialize` result carries standard LSP `serverInfo`:

```json
{ "name": "px-lsp", "version": "0.3.0" }
```

`version` is the `@px-lsp/server` package version, read from the manifest that
ships with the bundle, so it cannot drift from the artifact you unpacked. Log
it, and gate any feature you added against a version check on it rather than
against the presence of a method.

### The client capability object

What the server emits is tailored per capability, and a client declares exactly
what it implements:

```ts
interface ParadoxClientCapabilities {
  hoverHtml?: boolean;      // renders the sanitized <span style="color:var(--vscode-*)"> hover markup
  commands?: string[];      // the px.* command ids this client actually registers
  ownFileWatcher?: boolean; // client watches the mod tree and pushes paradox/modFileChanged
  fileLinks?: boolean;      // hover renderer navigates file: links
  hoverIcons?: boolean;     // client sets supportThemeIcons, so hover badges may use $(codicon) glyphs
}
```

Every field is independent and defaults to **off**, which is the honest default
for an embedder: send only what you have built. The combinations are real, not
theoretical. A host with a custom hover renderer can take `hoverHtml` and list
zero commands. A host that registers `px.showReferences` but not the
localization commands lists just that one, and the localization quick fix
arrives as a real `WorkspaceEdit` instead of a command it could not run.

`clientCommands: boolean` is the **deprecated** predecessor and should not be
used in new code. It conflated three unrelated questions behind one "is this VS
Code" switch. It still works: `true` means
`{ hoverHtml: true, commands: <every id>, ownFileWatcher: true, fileLinks:
true }` plus snippet support, `false` or absent means all-off, and `client`
wins when both are sent.

One more capability matters here and is NOT part of this object, because
standard LSP already carries it: snippet support. Declare
`textDocument.completion.completionItem.snippetSupport: true` in the
`initialize` capabilities if your editor expands `${1:…}` tabstops.

The full set an embedder should consider, and what each one buys:

| Declare | If your client | Without it |
|---|---|---|
| `snippetSupport` (standard LSP) | expands `${1:…}` tabstops in completion inserts | completion inserts are plain-text skeletons: same block shape, no tabstops, never a literal `${` |
| `client.hoverHtml` | renders the sanitized `<span style="color:var(--vscode-*)">` hover markup | hover cards are plain markdown; the span content is self-sufficient text, so nothing is lost but color |
| `client.commands` | registers some/all `px.*` commands | command-link affordances degrade per id: the localization quick fix becomes a plain `WorkspaceEdit`, the hover reference-count line is dropped |
| `client.fileLinks` | navigates `file:` links from hover markdown | every hover location line (provenance, set sites, define/gui/format sources, datafunction examples, texture paths) renders as plain text instead of a dead link |
| `client.ownFileWatcher` | watches the mod tree and pushes `paradox/modFileChanged` | the server registers its own `didChangeWatchedFiles` watcher (needs dynamic registration) |

The concrete per-capability behavior (what the hover looks like without
`hoverHtml`, which quick fix replaces which) is the "Degraded modes" section of
`docs/PROTOCOL.md`.

### dataDir

Two bundled assets are read from disk at runtime rather than compiled into the
bundle: the wiki token mirror (`wikidocs/`, CK3 only) and the completion
frequency table (`freqs.json`). By default the server looks for them in
`data/<gameId>/` next to its own `dist/server.js`, which is the layout both
release artifacts ship.

If your installer puts the data somewhere else, send `dataDir`: the directory
that **contains** the per-game folders, not one of them.

```jsonc
"initializationOptions": {
  "dataDir": "C:/Program Files/YourApp/resources/px-lsp-data"
  // the server reads <dataDir>/ck3/wikidocs/ and <dataDir>/ck3/freqs.json
}
```

Both files resolve independently under `<dataDir>/<gameId>/`, and the whole
path is re-derived when `paradox/configChanged` switches the game, so the
override stays profile-correct. A `<gameId>/` folder holding only one of the
two assets, or missing entirely, is a supported state and not an error: only
CK3 ships a wiki mirror, so Vic3 and EU5 report `tokens: 0` in `paradox/status`
until the user dumps `script_docs`.

`wikidocsDir` is the **deprecated** predecessor. It overrides the `wikidocs/`
folder alone, leaves `freqs.json` on the bundle root, and does not follow a
`gameId` change. Send `dataDir`.

## Documents

### URIs

Send `file:` URIs. The server converts them with
[`vscode-uri`](https://github.com/microsoft/vscode-uri), and on Windows that
**lowercases the drive letter**: `file:///F:/mods/my_mod/events/a.txt` becomes
`f:\mods\my_mod\events\a.txt`.

Two consequences worth building in from the start:

- compare paths case-insensitively on Windows whenever you match a server
  answer against a path of your own (the server does this internally for its
  own root matching);
- treat the URI string, not the derived path, as the document identity. Echo
  back exactly the URI the server sent you in a location or diagnostic, and
  exactly the URI you opened the document with in every subsequent request. A
  URI that differs only in drive-letter case is a different open document, and
  the request will find nothing.

### Sync, and why full-document didChange is fine

The server declares `TextDocumentSyncKind.Incremental`, but that is the maximum
it accepts, not a requirement. A `textDocument/didChange` whose content change
carries no `range` is a full-document replacement, and it is legal under
Incremental sync. The document store applies both forms.

An embedder is often better off sending the full text. The host's editor buffer
rarely produces LSP-shaped incremental deltas for free, and hand-computing
ranges is the classic source of client/server desync, which shows up much later
as offsets that drift by a few characters. The server re-parses the whole
document per version either way: every position feature shares one cached parse
per document version rather than re-scanning per request, so the saving from an
incremental delta is the text splice alone.

**Bump `version` on every change, monotonically.** The parse cache is keyed by
URI plus version. Reusing a version with different text serves the previous
parse, and the symptom is completion and diagnostics answering for text the
user no longer has.

Also send `textDocument/didSave`. The server declares `save: true` and uses it
for more than re-validation (see below).

### BOM state comes from disk

The game ignores a localization file that has no UTF-8 BOM, silently, so the
server diagnoses a missing one. It does **not** look for the BOM in your buffer
text: editors routinely strip `U+FEFF` when they read a file, so the buffer is
the wrong place to ask. The server opens the file on disk and reads its first
three bytes, on `didOpen` and again on `didSave`.

A host whose buffers have the BOM stripped therefore needs to do nothing
special, which is the point. Two things follow:

- an unsaved or unreadable file yields "unknown", and the check is skipped
  rather than guessed at, so a brand new buffer never gets a false BOM error;
- if your host writes files itself, send `didSave` after the write. Otherwise
  the server keeps the BOM state it read at open time and the diagnostic
  disagrees with what is now on disk.

## The paradox/* methods, by audience

Beyond standard LSP the server answers a set of custom requests. A plain client
can ignore all of them. Full payload shapes are in `docs/PROTOCOL.md` and
`packages/protocol/src/protocol.ts`.

| If you are building | Wire these |
|---|---|
| Anything at all | `paradox/configChanged` (push settings without a restart), `paradox/status` and `paradox/indexChanged` (server to client; index health and a re-query signal) |
| A status bar or an index panel | `paradox/status`, `paradox/indexStats`, `paradox/reloadDocs` (re-parse `script_docs` after the user dumps them) |
| A scope indicator | `paradox/scopeAt` (see below) |
| Localization tooling | `paradox/lookupLoc`, `paradox/locCoverage` |
| Mod-wide reports | `paradox/modOverview` (content inventory), `paradox/overrides` (what shadows vanilla, with the LIOS/FIOS winner) |
| An impact view for one definition | `paradox/dependencies` (dependents and dependencies, by cursor or by name) |
| An event browser or graph | `paradox/eventGraph`, `paradox/eventDetail` |
| A `.gui` designer | `paradox/guiTree`, `paradox/guiLayout`, `paradox/guiSourceEdit` (`paradox/guiWidgetEdit` is the deprecated position/size half of the last one) |
| Your own file watcher | declare `client.ownFileWatcher` and push `paradox/modFileChanged` per changed file |

The mod-scoped requests (`modOverview`, `locCoverage`, `overrides`) take
`{ modRoot?: string | null }`: one workspace mod by absolute root path, or
absent for all of them.

### paradox/guiSourceEdit

The server never writes a file. A designer gesture goes out as an op and comes
back as offsets into the text you sent, which YOU apply: your editor keeps
undo, dirty state and the live preview loop. Send the buffer's current text
with every request and apply the edits to that same text, end-first.

```jsonc
// -> paradox/guiSourceEdit
{ "uri": "file:///d%3A/mods/my_mod/gui/window_my.gui",
  "text": "window = {\n\tname = \"my_window\"\n}\n",
  "op": { "kind": "setProperties", "line": 0,
          "properties": [{ "key": "size", "value": "{ 320 200 }" }] } }
// <- { "edits": [{ "start": 31, "end": 31, "newText": "\tsize = { 320 200 }\n" }] }
```

The other ops are `reorder`, `insert`, `insertRaw` (paste), `delete`,
`duplicate`, `wrap` and `blockText` (read-only, for a clipboard); a widget is
addressed by the 0-based line of its own statement, the `line` that
`paradox/guiLayout` reports for it.

Expect `{ "refused": "…" }` instead of edits and show the string: it is the
server saying the gesture would not do what it looks like it does (a box owns
its children's slots, a content-sized container ignores an explicit size, a
type definition is used by other files). A write that lands but is only half
honoured returns `edits` plus a `warning`.

### paradox/scopeAt

The scope inference that ranks completion and annotates hovers, exposed
structurally so a host can render it. Request a position in an open script
document:

```jsonc
// -> paradox/scopeAt
{ "uri": "file:///d%3A/mods/my_mod/events/my_events.txt",
  "position": { "line": 6, "character": 4 } }
```

```jsonc
// <- result, for a cursor inside  liege = { capital_province = { … } }
{
  "scopes": ["province"],
  "chain": [
    { "scopes": ["character"] },
    { "entryKeyword": "liege", "scopes": ["character"] },
    { "entryKeyword": "capital_province", "scopes": ["province"] }
  ],
  "savedScopes": [{ "name": "the_actor", "scopes": ["character"] }]
}
```

Rendering notes that will save you a redesign:

- **`scopes` is an array, never one name.** A link or iterator with several
  documented output scopes stays ambiguous instead of guessing. Render several
  as `a|b`.
- **An empty array means unknown, and it is a first-class answer**, not an
  error. Render it as "unknown". The server annotates and ranks, it never
  diagnoses on scope grounds and never asserts more than the derived link
  tables actually say.
- **`chain` is outermost first**, one entry per scope-changing step. The first
  step carries no `entryKeyword`: it is the enclosing definition's root scope
  and comes from no key.
- **`savedScopes` is file-wide, not flow-sensitive.** Every `save_scope_as` /
  `save_scope_value_as` site in the document, plus the engine-provided ambient
  scopes of its definition kind, including saves below the cursor. That is what
  completion and hover already offer, so a panel built on it cannot disagree
  with the popup.
- **`null`** means the document is not an open script document. Render nothing.

## What is deliberately absent

Three things the VS Code extension has do not exist for an embedder, and none
of them is a gap waiting to be filled server side.

- **No tiger diagnostics.** Deep validation (unknown effects, unknown traits,
  wrong argument types) is [ck3-tiger / vic3-tiger](https://github.com/amtep/tiger)'s
  job by design, not this server's, and the download-and-run integration lives
  in the client. The server's own diagnostics stay in the class it can decide
  with certainty: structural damage, encoding and file-layout traps, missing
  required localization, and references to events no declared namespace
  contains. Run tiger from your host and map its output into your own
  diagnostics if you want it, exactly as the extension does. There is no EU5
  tiger build at all.
- **No overview UIs.** The event graph, GUI preview, mod report and coverage
  views are VS Code webviews. The *data* behind every one of them is on the
  wire (`paradox/eventGraph`, `paradox/guiLayout`, `paradox/modOverview`,
  `paradox/locCoverage`), which is the split on purpose: the server computes,
  the client draws.
- **No `.dds` rendering.** Hovering a texture path still produces a hover, but
  the image is a `data:` URI in the markdown. A client that does not render
  images in hover markdown shows the link text instead. The DDS decoder itself
  is vscode-free (`packages/server/src/dds/`) if you need to build your own
  viewer.

## Reference clients in this repository

Three of them, all runnable, all kept honest by CI or by the release checklist.

- **`packages/server/test/lspSmoke.test.ts`** is the closest thing to a worked
  example of a rich embedder. It forks the packaged bundle over node IPC and
  drives the real protocol end to end: `initialize` with `processId` and full
  `ParadoxInitOptions`, the `serverInfo` assertion, `didOpen`, completion and
  resolve, hover, definition, semantic tokens, `paradox/scopeAt`,
  `paradox/guiTree`, then `shutdown`. It also forks a second server declaring
  `hoverHtml` with zero commands, which is the capability combination the old
  boolean could not express.
- **`packages/server/test/stdioSmoke.test.ts`** is the same flow over
  `--stdio` with **no** `initializationOptions` at all, so it is the executable
  statement of what the fallbacks do on their own. `PX_LSP_SERVER` points it at
  another bundle, which is how CI smokes the extracted release tarball.
- **`scripts/nvim-parity/`** drives headless neovim through the plain-client
  setup against a real mod. Beyond feature presence it checks that hovers carry
  no VS Code markup or dead `command:` links, that external edits are picked up
  without a restart, and that the status mirror reaches the log. It needs
  neovim, a game install and a real mod, so it is run by hand before a release
  rather than in CI. Its README has the invocation.

## Release artifacts

Both are attached to every [GitHub release](https://github.com/JDeffner/paradox-modding-toolkit/releases)
and stage the identical server payload, defined once in
`scripts/server-package.mjs` so the two cannot drift apart.

**`px-lsp-server-<version>.tar.gz`**, the portable one. Needs Node 18+ on the
target machine.

```
px-lsp-server-<version>/
  dist/server.js
  data/ck3/  data/vic3/          # bundled fallback data, found automatically
  README.md LICENSE THIRD-PARTY-NOTICES.md
```

**`px-lsp-win-x64-<version>.zip`**, the one to embed on Windows. Same payload
plus an unmodified official nodejs.org build, so nothing has to be installed
first.

```
px-lsp-win-x64-<version>/
  px-lsp.cmd         # runs the bundled node against dist/server.js --stdio
  node.exe           # official win-x64 build, unmodified
  NODE-LICENSE       # Node's own license (the GPL LICENSE keeps the plain name)
  dist/ data/ README.md LICENSE THIRD-PARTY-NOTICES.md
```

The Node build is pinned to an Active LTS release, downloaded from nodejs.org
and verified against that release's own `SHASUMS256.txt` at build time.

**Do not flatten either archive.** The server finds its bundled data at
`../data/<gameId>/` relative to `dist/server.js`, so `dist/` and `data/` must
stay siblings, or `dataDir` must name the new root. Flattened, the server still
starts and still answers requests, it just silently loses the bundled wiki
tokens and the frequency tables. The startup `window/logMessage` line names the
directory it resolved, which is how you tell the two apart.

Redistribution: the server is GPL-3.0-or-later, `node.exe` keeps its own
license as `NODE-LICENSE`, the bundled CK3 wiki token lists are CC BY-SA 3.0
(`data/ck3/wikidocs/ATTRIBUTION.md`) and the EU5 schema table derives from
MIT-licensed community CWT rules. `THIRD-PARTY-NOTICES.md` ships in both
archives with the full texts.
