# What a workspace costs

Paradox Modding Toolkit indexes every definition and every reference in the game plus
every mod your workspace points at, and it keeps that index in memory for as
long as the window is open. On an ordinary mod nobody notices. On a workspace
holding a total conversion or a dozen mods, the index is the whole performance
story, so this page says what it costs and which settings make it smaller.

All numbers below were measured on 2026-08-07 (Ryzen 7 5800X, 32 GB, NVMe,
warm file cache, CK3 1.19) with the bench in
`packages/server/test/perf/benchHarness.ts`. Your wall clock will differ; the
shape will not.

## The one thing to know

**Every VS Code window forks its own language server, and each one builds its
own full index.** Ten windows on the same workspace cost ten times the memory,
not one tenth each. The per-server heap ceiling is 4096 MB on any machine with
8 GB of RAM or more, and half of RAM below that, never under 2048 MB. So the
multiplication is bounded per window and unbounded across windows.

## What costs what

| workspace | definitions | server heap | RSS | time to indexed |
|---|---|---|---|---|
| the vanilla game alone | 462,886 | 193 MB | | ~4 s |
| game mounted 3x + 20 small mods (24 roots) | 1,858,912 | 383 MB | 1151 MB | 21 s |
| game + a total conversion twice (4 roots) | 1,358,756 | 1461 MB | 2193 MB | 547 s |

A definition costs about 435 B and a reference about 149 B, so what drives the
cost is how many files a root holds, not how big any one file is. The two rows
above look inverted for that reason: the 24-root workspace has more definitions
but mounts the same game four times, and identical identifiers are stored once
per window, while the two total-conversion copies contribute 8.3M distinct
reference sites between them.

Interactive work costs, on the same two workspaces:

| operation | cost |
|---|---|
| Ctrl+S round trip (edit visible to the index) | 13 ms / 42 ms |
| semantic highlighting of a document | 0.5 - 3 ms |
| completion on an ordinary workspace | under 100 ms |
| completion **while the index is still building** | up to 1.2 s / 79 s |

That last row is the one honest bad number, and it belongs to the second
workspace: while the index is building there, a single completion request can
take over a minute, and everything queued behind it (semantic tokens, hover)
waits with it. It is also most of why that workspace's "time to indexed" reads
547 s: the scanning is a minority of that and the interactive requests served
in between are the rest. On the same workspace the first completion after the
build finished cost 78 s once, after which saves and highlighting were back to
milliseconds. This is the remaining known cost, it is not fixed, and it is why
a big workspace feels dead for its first minutes.

## Configuring a big workspace

In rough order of effect:

- **`px.excludedMods`** drops workspace mod folders from indexing entirely (no
  completion, hover or diagnostics for them, and no memory either). The single
  biggest lever: excluding one total conversion you are not editing gives back
  roughly a gigabyte per window. The sidebar's *Workspace Mods* group has an
  **Exclude Mods from Indexing** picker for it.
- **Read-only context** is the middle ground the picker offers after you
  exclude: listing an excluded mod in `px.parentMods` indexes it like a
  dependency parent — definitions only, so completion, hover and
  go-to-definition still see its content, but none of the reference index,
  which is the expensive half (a reference costs ~149 B and big mods hold
  millions). A mod you load but never edit — an unofficial patch, a framework
  mod, anything that carries copies of vanilla files — belongs here, not in
  the full index.
- **Fewer windows.** Windows multiply everything above. One window per mod you
  are actually editing, not one per folder you might look at.
- **`px.parentMods`** should list only the dependencies your mod really builds
  on. Each parent is a full root with a full index.
- **`px.tigerRunOn`** ships as `"manual"`. On `"save"` every save also spawns a
  ck3-tiger process over the whole mod, which competes for CPU with everything
  else while you type.
- **`px.scopeInlayHints`** is off by default; on, every index change re-requests
  hints for every visible editor.
- **`px.enableForWorkspace: false`** is the hard off switch for one workspace:
  files stay in plain text mode and no server starts.

The extension warns once on activation when a workspace passes 6 indexed mod
roots or 10,000 script files. That warning names `px.excludedMods` and offers
the picker as a button, and it names `px.tigerRunOn` only when you have set it
to `"save"`.

## What VS Code itself indexes

The toolkit's index never reads binary files: the definition scan walks the
schema folders with an extension filter (`.txt`, `.yml`, `.gui`), and the file
watchers glob the same extensions. A `.dds` never enters it.

VS Code's own machinery is a different story. The built-in file watcher and
search walk every workspace folder whole, and a game install is ~100k files
of mostly textures, meshes and audio; a workspace with the game plus dozens
of mods multiplies that. **`Paradox: Reduce VS Code Indexing Load`** (also a
button on the big-workspace warning) writes workspace-scoped
`files.watcherExclude` and `search.exclude` patterns for the asset trees
(`gfx/`, `map_data/`, `music/`, `sound/`, `soundtrack/`, `dlc/`, `binaries/`,
plus loose `.dds`/`.tga`/`.mesh`/`.anim` for the watcher). The write is
additive — your existing patterns survive, and a pattern you set to `false`
stays `false` — and the confirmation offers one-click Undo. The visible
trade: search and Quick Open stop listing files under those folders.

## Reporting a slow session

Set **`px.trace.perf`** to `true` and reproduce. Every request, file rescan,
index change and indexing phase is then logged with its wall clock to the
*Paradox Modding Toolkit* output channel, and a Ctrl+S turns into a millisecond
timeline. That output channel plus the window's memory reading is what a useful
report is made of. `px.trace.server` logs the raw LSP traffic if the timeline is
not enough.

An index build that dies now logs a `FATAL` line with its stack there rather
than leaving a session in which only syntax colouring still works, so the
output channel is also the first place to look when features stop responding.

## What this is not

The real fix for someone running ten or thirty windows is one shared server
process for all of them instead of one per window. That is an architecture
change (index ownership, per-window settings, lifetime, crash isolation) out of
proportion to the rest of this work, and it is deliberately **not** done. It
remains the obvious future work if the per-window multiplication keeps hurting
people.

Also deliberately absent: a partial or lazy index. Completion ranking, override
detection and the reference views all read the whole index, and a half-built
index answers wrongly rather than slowly.
