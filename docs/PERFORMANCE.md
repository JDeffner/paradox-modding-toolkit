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
in between are the rest.

### Where that time actually went (2026-08-27)

The row above was measured, not explained. Profiling the server with
`--cpu-prof` on game + AGOT named three causes, all now fixed:

- **A completion cost seconds because of config resolution, not ranking.**
  Aggregating the scopes a scripted effect is called from asked "which schema
  folder is this file in?" once per REFERENCE — 4,124,139 times for 3,944
  distinct answers — and each miss rebuilt the content-root list (parent mods,
  playset probes) and walked every schema entry. It is memoized per file now.
- **That aggregation also scanned the whole reference index** to find the 4%
  of references that are call sites with a key chain. Those are tracked
  separately now, and each distinct (root scope, chain) pair is resolved once
  instead of once per site.
- **The scan read one file at a time.** A cold read costs about 10 ms per
  file no matter how big it is, because the cost is the round trip, not the
  bytes; 80% of a cold startup was spent inside `readFileUtf8` waiting. Batches
  are read with several reads in flight now.

| operation (game + AGOT) | before | after |
|---|---|---|
| completion, first after an index change | 4314 ms | 800 ms |
| completion, first after a **save** | 4180 ms | 606 ms |
| completion, cache warm | 20 ms | 18 ms |
| time to indexed, warm file cache | 32 s | 25 s |
| time to indexed, cold file cache | 82 s | 70 s |

The save row is the one that decided how the extension felt: the caches above
are keyed on the index revision, every save changes it, so the next completion
paid full price EVERY time. Semantic highlighting was never itself slow (1 ms
throughout) — it was queued behind that completion on the server's single
thread, which is what "the text stays white for a while" was.

The two cold-cache numbers come from an A/B under the same partial cache
eviction. A first-ever open on a machine where nothing is cached is colder than
that and was measured once at 185 s before the change; there is no way to
reproduce that state on demand, so the honest claim is the 82 → 70 s A/B, with
the per-file measurements suggesting a larger gap the colder the cache is.

### Round 3: the thread pool and the containers (2026-08-28)

Rounds 1 and 2 were measured on the game plus AGOT. Round 3 uses a bigger
workspace from a field report, and one that cannot be configured out of its
problem: a `.code-workspace` holding the CK3 install and 5 Steam Workshop
mods, with `px.excludedMods` and `px.parentMods` both empty, so all six roots
are full first-class roots. 87,250 files, 29,641 of them script, 1188 MB of
script text, 1,304,861 definitions, 7,553,947 references.

The driver is `packages/server/test/perf/profileWorkspace.ts`, which takes the
`.code-workspace` file itself and rebuilds the settings `config.ts` would
derive from it.

**The scan was never allowed to use the disk.** Round 2 replaced serial
`readFileSync` with batches of up to 16 reads in flight and noted that libuv's
thread pool was "an upper bound, not a promise". It was the binding
constraint. Every `fs.promises.readFile` runs on that pool, it defaults to
four, and a cold build waits on latency rather than bandwidth, so four
outstanding requests left the drive idle most of the time. The client now
forks the server with `UV_THREADPOOL_SIZE=16`.

| time to indexed, page cache evicted | |
|---|---|
| libuv pool 4 (the old default) | 142,933 ms |
| libuv pool 16 (shipped) | 71,776 ms |
| libuv pool 32 | 63,531 ms |

Each run was preceded by streaming 24 GB of game binaries through the page
cache to evict the script text, on a drive that reads about 0.2 GB/s. 32
measured better than 16 and is a one-character change, but 16 is what ships:
it takes 71 of the 79 seconds, and the default has to hold on hardware slower
than the machine these numbers come from. Warm, a larger pool is slightly
worse (53.8 s against 51.3 s), because the reads come from RAM and only the
contention is left.

Two synthetic benchmarks disagreed about this setting, one of them showing a
20% regression, which is why the table above is an A/B on the real workspace.

**The containers cost more than the objects in them.** Node x64 has no pointer
compression, so an object header is 24 B and every slot is 8 B. V8 also grows
an empty array's backing store to capacity 16 on the first push, and most
names in both indexes hold one entry, so each was carrying fifteen empty
slots. `DefinitionIndex.compact()` and `ReferenceIndex.compact()` slice every
bucket to its exact length once, when the scan finishes; a later save re-grows
only the names it touches.

| post-GC heap after the index build | |
|---|---|
| round 2 | 1735 MB |
| shared `kinds` arrays | 1693 MB |
| compacted buckets, shared root-scope Sets | 1506 MB |

Peak RSS is why this was worth doing before anything else: this workspace
peaked at 4081 MB against the server's 4096 MB ceiling. It was close to
failing, not close to being slow.

**Every mod file was read twice and parsed twice.** The definition scan walked
the ~156 schema folders; the reference scan then walked the whole root for
`.txt` and read it all again, because `extractDefinitions` and
`extractReferences` each called `parseScript` themselves. 154 of the 156 CK3
schema entries are `.txt`, so the two file sets overlapped on essentially all
script. A workspace mod root is now walked once: each file is read once,
parsed once, and that one CST feeds both extractors, with `classifyFile`
supplying the schema entry the folder walk would have found it under.
Localization (`.yml`) and `gui` (`.gui`) are not `.txt` and keep the
schema-folder listing. Dependency parents stay definition-only, and vanilla
references are still lazy.

| time to indexed, all round 3 changes | warm | cold |
|---|---|---|
| round 2 (libuv pool 4, two passes) | 52.4-53.3 s | 142.9 s |
| pool 16, two passes | 53.8 s | 71.8 s |
| pool 16, one fused pass | 44.4-44.7 s | 61.5 s |

`packages/server/test/fusedScan.test.ts` is the guard: it reimplements the two
passes and demands identical definitions, references, implicit definitions and
namespaces over a fixture root, in the style of the `buildCallSiteScopes`
equivalence test from round 2.

**What is still on the table.** A Steam update that rewrites 5,000 script
files becomes 5,000 separate rescans, each with its own 150 ms timer. That
needs a "root invalidated" verb in the protocol rather than an optimization.
The reference index is also still object-per-reference: a columnar layout
measured 121 B down to 27 B per reference on a model, about 710 MB here, and
would move those bytes into ArrayBuffers where the 4096 MB heap ceiling does
not bind. Both are larger changes than this round took on.

## Version history

The rounds above each measured one change on one workspace. This table is the
same instrument run over every release, so a regression shows up as a row, not
as a field report. The workspace is `cultivation.code-workspace`: the CK3
install plus five workspace mods (Cultivation Mod, Custom Name Lists, Gesta,
Hide Decisions, Mod Testing), a sixth excluded by `px.excludedMods`, 473,227
definitions. Warm file cache, two runs per version, medians shown; the raw rows
are in `packages/server/test/perf/history.json`. Recorded 2026-09-05 on the
machine named at the top of this page.

| version | time to indexed | completion, cold | completion, after save | completion, warm | heap after index | peak RSS |
|---|---|---|---|---|---|---|
| 0.3.0 | 8.5 s | 1618 ms | 1530 ms | 8 ms | 321 MB | 772 MB |
| 0.3.2 | 8.2 s | 1648 ms | 2010 ms | 9 ms | 323 MB | 806 MB |
| 0.3.4 | 9.3 s | 1638 ms | 1602 ms | 8 ms | 323 MB | 796 MB |
| 0.3.6 | 7.7 s | 199 ms | 186 ms | 8 ms | 266 MB | 856 MB |
| 0.4.0 | 8.1 s | 252 ms | 184 ms | 10 ms | 267 MB | 852 MB |
| 0.4.0 + realign-coa-editor | 7.8 s | 225 ms | 167 ms | 8 ms | 267 MB | 850 MB |

What the rows say:

- **Completion after an index change dropped from 1.6 s to 0.2 s between 0.3.4
  and 0.3.6.** That is round 2 (the per-file config memoization and the
  call-site tracking) reaching a release. It is the difference a modder feels
  on every save.
- **Heap fell from 323 MB to 266 MB in the same step**, round 3's compacted
  buckets. Peak RSS moved the other way by about 50 MB, which is the fused
  single-pass scan holding both extractors' output at once; on this workspace
  the heap ceiling is nowhere near.
- **Time to indexed is flat at about 8 s.** The 25 s figure a cold-cache run
  of the same build produced is not in the table: the first run after the game
  files leave the page cache pays for the disk, every run after it does not.
- **0.4.0 and the working branch are within noise of each other.** The branch
  changes webviews only; the server is byte-identical in what it does.

Warm completion, hover and semantic tokens sit at 1 to 11 ms on every version
and are not the numbers to watch.

### Adding a row

After `pnpm run compile`, from the repo root:

```bash
pnpm run perf:history -- "<path>/cultivation.code-workspace" <outDir> --label <version> --history packages/server/test/perf/history.json
```

Run it twice and let the doc carry the median. To measure a past release, build
its server in a worktree (`git worktree add --detach <dir> v<x>`, then
`pnpm install --no-frozen-lockfile --ignore-scripts` and `pnpm -C packages/server run compile`
inside it) and pass `--server <dir>/packages/server/dist/server.js`. Any
`.code-workspace` works; a row is only comparable with rows on the same one.

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
- **`px.enableForWorkspace: false`** is the off switch for one workspace:
  files stay in plain text mode, and since 2026-08-28 the server that still
  forks finds no game install to index, so it holds nothing. Before that date
  this line claimed no server started at all, which was never true: the
  process forked and indexed the whole vanilla tree regardless.

The extension warns once on activation when a workspace passes 6 indexed mod
roots or 10,000 script files. That warning names `px.excludedMods` and offers
the picker as a button, and it names `px.tigerRunOn` only when you have set it
to `"save"`.

## What VS Code itself indexes

The toolkit's index never reads binary files: the definition scan walks the
schema folders with an extension filter (`.txt`, `.yml`, `.gui`), and the file
watchers glob the same extensions. A `.dds` never enters it.

VS Code's own machinery is a different story. The built-in search and file
watcher walk every workspace folder whole, and 62% of a game install plus a
total conversion is textures, meshes and audio.
**`Paradox: Reduce VS Code Indexing Load`** (also a button on the
big-workspace warning) writes workspace-scoped `search.exclude` and
`files.watcherExclude` patterns for binary EXTENSIONS: `.dds`, `.tga`,
`.mesh`, `.anim`, `.png`, `.bk2`, `.bank`, `.wav`, `.ttf`, `.otf`. The write
is additive — your existing patterns survive, and a pattern you set to
`false` stays `false` — and the confirmation offers one-click Undo.

Measured 2026-08-27 on the CK3 install (48,481 files) plus AGOT (21,431
files), NVMe, VS Code 1.134 on Windows:

| Find in Files, whole workspace | without | with |
|---|---|---|
| binaries warm in the OS cache | 1.7 s | 0.65 s |
| binaries evicted (the normal case) | up to 106 s | 0.65 s |

The patterns skip 43,067 of 69,912 files, and search never opens them, so the
time is stable instead of depending on what the cache happens to hold.

**Extensions, never directories.** Excluding whole asset trees looks
equivalent and is not: `gfx/`, `music/`, `map_data/` and `dlc/` hold real
script. CK3 maps seven schema folders under `gfx/` alone (portrait modifiers,
court scene, scripted illustrations), and game + AGOT hold 584 script files
under `gfx/`, 47 under `music/` and 3,537 under `dlc/`. A directory exclude
would hide those from search and, because VS Code applies
`files.watcherExclude` to recursive watchers including the extension's own,
would stop a save in them from re-indexing. A test
(`editorExcludesSafety.test.ts`) fails the build if a directory pattern ever
comes back.

The watcher half is not a memory lever on Windows: the watcher process
measured 123 MB without the excludes and 124 MB with them, because Windows
watches a root with a single recursive handle. It earns its place by keeping
a Steam update that rewrites 27k textures from becoming 27k events, and on
Linux, where inotify costs one watch per directory.

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
