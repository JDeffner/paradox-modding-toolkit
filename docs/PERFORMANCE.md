# What a workspace costs

Paradox Modding Toolkit indexes every definition and every reference in the game plus
every mod your workspace points at, and it keeps that index in memory for as
long as the window is open. On an ordinary mod nobody notices. On a workspace
holding a total conversion or a dozen mods, the index is the whole performance
story, so this page says what it costs and which settings make it smaller.

The initial tables were measured on 2026-08-07 (Ryzen 7 5800X, 32 GB, NVMe,
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

## Localization coverage and intermittent stalls (2026-09-16)

The earlier index improvements did not cover `paradox/locCoverage`. That request still read and parsed every localization file synchronously on each refresh, including translations outside the configured completion language. A visible coverage view could therefore delay suggestions, hover and other server requests after an edit.

Coverage now loads files asynchronously in batches of eight and caches their parsed entries. Unchanged requests reuse the completed result. Script edits recompute coverage without rereading translations; localization changes relist files and read only changed or new files. An edit during a pending read retains the other files already loaded. The cache uses open editor text, observes every localization language, and is cleared on index rebuilds. At most two completed mod caches are retained. Large reference, definition and translation loops yield to other requests. The first read still parses each individual file synchronously.

### Coverage measurements

Baseline: `61362a5`, the fetched main revision on September 16. Its runtime source matches 0.4.4. Both builds ran on the machine above, Windows, Node 24.12.0, with a 4096 MB server heap and 16 filesystem worker threads. Each table contains one sequential before/after run. The OS file cache was not evicted, so startup and first-read comparisons are not controlled cold-cache measurements.

The driver forks the real bundled server over IPC and waits for indexing to finish. During each coverage request it attempts an `indexStats` request every 20 ms, with one probe in flight at a time. The maximum probe round trip measures how long another request waits while coverage runs. It is not a renderer frame-time measurement. A dash means coverage finished before the first probe could be sent.

The generated fixture contains 90 files, 180,000 entries across English, French and German, and one script reference. The French edit adds one entry. The AGOT run adds an unmodified real mod as a second workspace root and queries its coverage: 465,788 entries across three languages. The script edit remains in the generated root and invalidates the shared index revision. It tests cache invalidation under a large reference index without writing to the real mod. Normalized coverage response hashes were identical before and after for every case.

| Corpus and operation | Coverage before | Coverage after | Longest probe before | Longest probe after |
|---|---:|---:|---:|---:|
| Generated, first request | 229 ms | 224 ms | 212 ms | 13 ms |
| Generated, unchanged | 190 ms | 3 ms | 158 ms | - |
| Generated, after script save | 167 ms | 86 ms | 136 ms | 3 ms |
| Generated, after French save | 171 ms | 112 ms | 140 ms | 7 ms |
| Generated, unchanged after French save | 162 ms | 3 ms | 136 ms | - |
| AGOT, first request | 4165 ms | 2812 ms | 4132 ms | 187 ms |
| AGOT, unchanged | 2026 ms | 10 ms | 1998 ms | - |
| AGOT, after script save | 1915 ms | 2130 ms | 1885 ms | 6 ms |

The large post-save request takes 2.13 seconds to finish, slightly longer than before in this run. Other requests can now run during that work. The 187 ms first-load probe delay is also a remaining limit; this run does not isolate its cause. Retaining parsed translations trades memory for fewer reads and parses, and the two-mod limit bounds cache count, not bytes.

Reproduce from a compiled checkout. Keep a copy of the baseline server beside its bundled data before rebuilding. Replace the placeholders with local paths; the corpus is read-only and generated files are removed after the run.

```bash
node packages/server/test/perf/profileLocalization.mjs <before-output-dir> --server <baseline-server>
node packages/server/test/perf/profileLocalization.mjs <after-output-dir>
node packages/server/test/perf/profileLocalization.mjs <before-agot-output-dir> --server <baseline-server> --corpus <agot-mod-root>
node packages/server/test/perf/profileLocalization.mjs <after-agot-output-dir> --corpus <agot-mod-root>
```

Each output directory contains `results.json` and `server.log`. Unit tests verify all three game profiles, required and inherited keys, issue caps, duplicate precedence, shared concurrent requests, edits during a pending read, and create/delete/rename invalidation. Real stdio tests cover standard and custom watcher notifications, rapid unsaved edits, close, and language changes for CK3, Victoria 3 and EU5.

### Game error-log bursts

The optional game log watcher previously drained all available bytes synchronously and searched the accumulated diagnostics array for each duplicate. A burst of distinct errors therefore grew much more expensive as the list grew. It now reads at most 256 KiB per turn, schedules further reads after 10 ms, tracks duplicates in sets, and publishes only changed files.

The benchmark runs the actual watcher with real temporary files and timers. A stub VS Code API accepts diagnostics without IPC or rendering, so these measurements cover extension-host processing only. Each row adds distinct errors targeting one file after the watcher starts. All expected diagnostics were retained.

| New errors | Drain before | Drain after | Longest processing turn before | Longest processing turn after | Publications after |
|---|---:|---:|---:|---:|---:|
| 5,000 | 712 ms | 42 ms | 712 ms | 31 ms | 2 |
| 10,000 | 2162 ms | 89 ms | 2162 ms | 34 ms | 3 |
| 20,000 | 4893 ms | 153 ms | 4893 ms | 30 ms | 6 |

Drain time starts at the first poll, excluding the normal one-second polling wait. A 10 ms heartbeat recorded maximum delays of 702/37, 2152/32 and 4898/28 ms before/after. Timing noise can make a heartbeat delay exceed the measured processing turn. Repeated errors, log truncation, partial UTF-8 reads, stop during catch-up, and clearing diagnostics have regression tests.

```bash
node packages/vscode/test/perf/profileErrorLog.mjs <before.json> <baseline-checkout>
node packages/vscode/test/perf/profileErrorLog.mjs <after.json>
```

Large diagnostic collections still incur VS Code transport and rendering costs. Tiger validation also remains separate: running it on save can compete for CPU, and its result publication was not changed here. These findings identify reproducible stalls in the extension, but do not establish the cause of the original user's report without their settings, workspace or performance trace.

### Live editor and general regression checks

The live test uses the installed VS Code executable with isolated user data and extensions. It opens a real mod and the installed game, disables autosave, and changes documents only in memory. The checks cover activation, command registration, script and localization completion/hover, GUI completion/definition/editor, the dependency view, event graph and mod report. The localization loop makes 12 edits with tag completion requests, separated by 700 ms to exercise the debounce. It records editor-edit round trips, completion round trips, and a 20 ms extension-host heartbeat.

| Live workspace and phase | Longest edit round trip | Longest completion round trip | Longest host heartbeat delay |
|---|---:|---:|---:|
| Cultivation, near startup | 7 ms | 567 ms | 15 ms |
| AGOT, near startup (final traced run) | 5 ms | 2549 ms | 14 ms |
| AGOT, after indexing and the mod report | 44 ms | 39 ms | 15 ms |

All 14 checks in the first Cultivation run and all 16 checks in the expanded AGOT run passed. These are functional passes, not latency thresholds. The AGOT trace shows the startup edits overlapped the initial index build. Tag completion itself took about 0.3 ms on the server, but some requests waited seconds to run. The host heartbeat and edit round trips stayed responsive. This reproduces delayed suggestions during startup, not a whole-window freeze.

The first visible AGOT coverage request took 31.9 seconds while indexing and edits repeatedly invalidated its pending result. A concurrent mod-report request joined that work and waited 8.7 seconds; the following unchanged request was logged below 0.1 ms on the server. This is a different workload from the isolated post-index benchmark above. Coverage can still take a long time to produce its first stable result while the index and documents are changing.

The earlier real multi-root workspace check measured: 481,510 definitions and 271 MB post-GC heap both before and after. Cold/warm/after-save completion measured 154/7/133 ms before and 164/6/198 ms after. These single-run values do not show a general completion speedup. Startup was 28.0 seconds before and 6.7 seconds after, with uncontrolled disk cache state, so that difference is not attributed to this change.

Run the live pass after compiling; use `VSCODE_EXECUTABLE_PATH` for a local editor and `PX_CK3_MOD_PATH` to select a different test mod. Unset `ELECTRON_RUN_AS_NODE` in the test shell if it is inherited from another Electron application. The launcher prints the path to `results.json`; VS Code traces are beside it under `user-data/logs`.

```bash
pnpm exec esbuild scripts/live-pass.ts --bundle --platform=node --outfile=dist/live-pass.cjs
pnpm exec esbuild scripts/live-pass-suite.ts --bundle --platform=node --external:vscode --outfile=dist/live-pass-suite.cjs
node dist/live-pass.cjs
```

The broader regression command is `pnpm exec vitest run`, including the existing Tiger parser/runner, localization, indexing and completion suites. The full run passed 2,328 tests, skipped seven, and failed the existing large-root packaged-server test under parallel load (it observed zero definitions). A focused rerun passed all 28 tests across large-root scanning, coverage and configuration. Typechecking, lint and `node scripts/check-game-boundary.mjs` passed. `pnpm run package:test` built and installed the test extension. The new server behavior is tested through standard stdio LSP as well as the rich VS Code client; no protocol shape or client capability changed.

## Incremental localization parsing (2026-09-17)

The open-document localization cache reparses a changed line with the existing parser and shifts later UTF-16 ranges. Header edits, multiline changes and missing version history use a full parse. The server applies sequential LSP changes against the matching cached version, rebuilds the line index, and evicts all state on close. No worker threads, worker settings or experimental worker bundles ship.

The preceding experiment used baseline `bc59fa3` and six isolated VS Code sessions, two per strategy. It tested generated 2,000-entry and 50,000-entry files and a real CK3 English character-name file with 44,003 entries. All 360 timed edits, 18 diagnostic repair checks and outline/folding comparisons passed. These measurements describe the experiment, not a fresh measurement of the production integration.

| CK3 file, 44,003 entries | Full parse | Incremental parse |
|---|---:|---:|
| Parse preparation, median | 12.54 ms | 2.80 ms |
| Completion, median | 257.21 ms | 255.27 ms |
| Unrelated LSP requests, p95 | 281 ms | 276 ms |

Faster parsing did not produce a consistent editor speedup. The trace measured `rescanModFile` at 100 to 128 ms per edit for the real file and 117 to 166 ms for the generated stress file. It removes and rebuilds every localization definition in the edited file. Completion enters `indexRead`, which flushes pending rescans synchronously before answering. This work remains unchanged.

The next bounded experiment is to update only definitions affected by an edit, while preserving duplicate-key precedence, references, ranges and revision invalidation. Another candidate is to avoid flushing the index for requests that do not read it. Both need request-latency measurements and correctness tests before implementation; neither improvement is claimed here.

Workers remain deferred. In the parser benchmark, the largest CK3 sample spent a median 11.89 ms parsing inside the worker but 110 ms returning the full result. The live sessions showed mixed request latency and higher edit latency in some cases. Rapid overlapping edits, stale results, cancellation and worker failures were not exercised sufficiently. Keeping data inside a worker and returning small deltas would be a separate architecture experiment.

Production regression coverage is in `incrementalLoc.test.ts` and the ranged-edit LSP smoke test. It compares the full parser's values, errors, UTF-16 ranges, header and BOM through LF, CRLF, bare CR, Unicode, malformed entries, batched changes, header edits, multiline edits, full replacements, cache-version gaps, close/reopen and a 50,000-entry file. The worker experiment scripts remain outside this release.

A single sequential before/after run of the integrated changes on the Cultivation multi-root workspace retained 481,510 definitions and a 271 MB post-GC heap in both builds. Index time was 6,793/7,076 ms; cold, warm and after-save completion were 165/166, 7/8 and 139/208 ms. This run confirms neither a general completion speedup nor an improvement to the remaining localization definition rebuild. Disk caches were not controlled.

The paired CK3 ranking evaluation retained identical output apart from timing across 1,400 sampled positions, 915,909 definitions and 3,760,505 references. Frequency regeneration was byte-identical before and after, and matched the shipped table apart from its generation date.

## Version history

The rounds above each measured one change on one workspace. This table is the
same instrument run over every release, so a regression shows up as a row, not
as a field report. The workspace is `cultivation.code-workspace`: the CK3
install plus five workspace mods (Cultivation Mod, Custom Name Lists, Gesta,
Hide Decisions, Mod Testing), a sixth excluded by `px.excludedMods`, 473,227
definitions. Warm file cache, two runs per version, medians shown; the raw rows
are in `packages/server/test/perf/history.json`. Recorded 2026-09-05 (0.4.1 on
2026-09-06, after the workspace mods grew by 30 definitions) on the machine
named at the top of this page.

| version | time to indexed | completion, cold | completion, after save | completion, warm | heap after index | peak RSS |
|---|---|---|---|---|---|---|
| 0.3.0 | 8.5 s | 1618 ms | 1530 ms | 8 ms | 321 MB | 772 MB |
| 0.3.2 | 8.2 s | 1648 ms | 2010 ms | 9 ms | 323 MB | 806 MB |
| 0.3.4 | 9.3 s | 1638 ms | 1602 ms | 8 ms | 323 MB | 796 MB |
| 0.3.6 | 7.7 s | 199 ms | 186 ms | 8 ms | 266 MB | 856 MB |
| 0.4.0 | 8.1 s | 252 ms | 184 ms | 10 ms | 267 MB | 852 MB |
| 0.4.0 + realign-coa-editor | 7.8 s | 225 ms | 167 ms | 8 ms | 267 MB | 850 MB |
| 0.4.1 | 5.9 s | 150 ms | 138 ms | 7 ms | 268 MB | 813 MB |
| 0.5.0 | 12.3 s | 260 ms | 194 ms | 13 ms | 271 MB | 846 MB |

The 0.5.0 row was recorded on 2026-09-17 with 481,510 definitions. Its two runs took 14.4 and 10.2 seconds to index, with after-save completion at 216 and 172 ms. These release samples were slower than the earlier paired integration measurements above; the cache state and system load were not controlled across sessions. They do not establish a general speedup or isolate a regression. The localization changes address repeated parsing, coverage scans and log processing. Full-file definition rebuilding remains a separate cost.

What the rows say:

- **Completion after an index change dropped from 1.6 s to 0.2 s between 0.3.4
  and 0.3.6.** That is round 2 (the per-file config memoization and the
  call-site tracking) reaching a release. It is the difference a modder feels
  on every save.
- **Heap fell from 323 MB to 266 MB in the same step**, round 3's compacted
  buckets. Peak RSS moved the other way by about 50 MB, which is the fused
  single-pass scan holding both extractors' output at once; on this workspace
  the heap ceiling is nowhere near.
- **The initial releases indexed in about 8 s.** The 25 s figure a cold-cache run
  of the same build produced is not in the table: the first run after the game
  files leave the page cache pays for the disk, every run after it does not.
- **0.4.0 and the working branch are within noise of each other.** The branch
  changes webviews only; the server is byte-identical in what it does.

Warm completion, hover and semantic tokens remain much cheaper than the first completion after an index change.

### Adding a row

After `pnpm run compile`, from the repo root:

```bash
pnpm run perf:history "<path>/cultivation.code-workspace" <outDir> --label <version> --history packages/server/test/perf/history.json
```

Run it twice and let the doc carry the median. To measure a past release, build
its server in a worktree (`git worktree add --detach <dir> v<x>`, then
`pnpm install --no-frozen-lockfile --ignore-scripts` and `pnpm -C packages/server run compile`
inside it) and pass `--server <dir>/packages/server/dist/server.js`. Any
`.code-workspace` works; a row is only comparable with rows on the same one.
Replace any absolute path in a recorded `build` label with a portable label before committing the history.

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
