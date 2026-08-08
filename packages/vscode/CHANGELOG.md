# Changelog

## Unreleased

### Added

- **Dependency mods reach tiger** (Discord report): validating a mod that
  depends on other mods (`px.parentMods`, or the other mods of a multi-mod
  workspace) now declares those dependencies to tiger as `load_mod` entries,
  so their scripted effects, variables and other definitions resolve instead
  of being reported unknown. When the mod has its own `<game>-tiger.conf`,
  that conf stays in charge (tiger reads it directly; regenerate or add
  `load_mod` blocks there); without one, the runner passes a generated conf
  via `--config` on every run, including baseline creation. **Generate
  ck3-tiger.conf** now writes the `load_mod` blocks into the conf it creates.
- **GUI editor** (**Open GUI Editor**, CK3): a `.gui` file, drawn by the
  measured layout engine and editable with a mouse. Click to select the widget
  you meant (the smallest rect under the cursor, not the anchored box filling
  the window behind it), Alt+click to step outward through the stack,
  Ctrl+Shift+click to jump to the declaration. The tree lists source children in
  source order and marks the ones a template or type spliced in. The inspector
  shows every property with the template or type it came from, and editing a row
  writes an override at the use site. Drag and the resize grips move and size the
  widget on the canvas, and a `window_character`-sized document opens with its
  tree collapsed rather than listing 13,702 rows.
  Three things it deliberately does that a preview cannot:
  - **It writes your file, not a copy of it.** Every gesture is ONE surgical
    edit through the same `paradox/guiSourceEdit` writer the API exposes, so
    comments, tabs, CRLF and single-line bodies come back byte for byte, and it
    is ONE Ctrl+Z in the text editor, because the editor keeps no undo history
    of its own.
  - **It writes the value, not the cursor.** A drag commits the widget's own
    effective position plus the drag delta, never the world coordinate under the
    pointer, so a widget positioned through anchors, margins or a parent's
    content box lands where you dropped it instead of jumping.
  - **It turns a gesture down before it moves.** The guards are asked when the
    mouse goes down, so dragging a child of an hbox or vbox is refused in the
    server's own words ("places its children itself") with nothing having moved
    and nothing to snap back, a child expanding on both axes refuses resize, and
    one expanding axis writes the other with a warning naming the axis the
    container owns. A drag that rounds to less than a pixel says so rather than
    silently doing nothing.
  A container whose content the engine cannot statically measure is drawn as a
  dashed estimate box and counted in the status line, because the engine invents
  no pixels and the canvas should not pretend it did. Creation, deletion,
  multi-select, layers and guides are not in this version.
- **`px.trace.perf`**: wall clock for every request, file rescan, index change
  and indexing phase in the *Paradox Toolkit* output channel, so a slow save or
  a slow completion can be reported as a millisecond timeline instead of a
  feeling. Off by default.
- **A dying language server now says so.** An unhandled error inside the server
  logs a `FATAL` line with its stack to the output channel before the process
  goes down, an index build that fails is logged with the phase that failed, and
  the client logs every server start, stop and restart with the restart decision
  it took. A scan that died used to leave a silent half-dead session in which
  only syntax highlighting still worked.
- **Simulate Event** (command palette, or right-click in a script file) opens a
  static walkthrough of an event: its blocks laid out in firing order (trigger,
  immediate, every option, after), the title, description and option names
  resolved through your localization, and each block printed back as readable
  script. Every onward `trigger_event` / on_action reference is a step-into
  link, so you can walk a whole event chain with a breadcrumb trail and a Back
  control without opening ten files. Clicking a block heading or any line jumps
  to it in the editor. Nothing is simulated that the files do not say: a
  reference to an event that is not indexed is labeled unresolvable rather than
  guessed at, and a block longer than 60 lines says how many lines it hid.
- **Simulate Event reads Victoria 3 events properly.** Verified against the
  vanilla install, not assumed: a Vic3 event's `flavor` line (its third string,
  on 2073 of 2261 vanilla events) is resolved through your localization and
  shown under the description, `cancellation_trigger` is walked as a step of
  its own right after the trigger it re-checks instead of being dropped, and
  `default_option` / `highlighted_option` no longer count as option effects
  (they still show in the option's script, like `custom_tooltip`). Everything
  else already worked: `trigger_event = { id = X days = N popup = yes }` steps
  in, and the plural `common/on_actions` folder resolves. The **Simulate
  Event** command was never CK3-gated and is now also listed in the sidebar's
  Tools view for every supported game.
- **`paradox/guiSourceEdit`: the `.gui` source writer a designer needs, and the
  honesty to turn a gesture down.** One request takes a gesture (set or remove
  properties, reorder, insert, paste, delete, duplicate, wrap, or copy a block
  out) and answers with surgical text edits the host applies, or with a refusal
  that says why. Every edit is a replace over the exact span the entry occupies,
  so a hand-authored file keeps its comments, its CRLF, its tabs-or-spaces and
  its single-line bodies byte for byte; blank separators and attached comments
  travel with the widget they belong to, so a reorder is a pure permutation and
  an insert and a delete are exact inverses. Verified by round trips over the
  373 vanilla `.gui` files, not just fixtures. A refusal is an answer rather than
  an error: an hbox/vbox places its children itself, so a drag inside one is
  refused instead of writing a `position` the game drops; a content-sized
  container ignores an explicit `size`; a child expanding on both axes inside a
  container has both taken from it, and one expanding axis writes with a warning
  naming the axis the container owns. `paradox/guiWidgetEdit` still works and is
  now a deprecated alias over the same core, with one behavior change: a
  property it has to insert lands on its own line before the closing brace,
  where the writer puts every new property, instead of first in the body.
- `paradox/eventDetail` now carries what that walkthrough needs, additively:
  every section and option gains `lines` / `totalLines` (the block rendered as
  pseudo-script, capped, with the honest total) and `targets` / `targetsTotal`
  (the events and on_actions the block hands control to, each with its
  definition site, and for an on_action what it in turn fires). Targets are
  collected from the active game profile's event/on_action reference fields,
  not a hard-coded key list.

### Changed (GUI preview fidelity)

- **The layout engine learned the rules a second measured engine had and this
  one did not.** Grid boxes lay out for real: `fixedgridbox` uses
  `addcolumn`/`addrow` as the cell size and stride, `dynamicgridbox` packs
  items at their own size, both fill down a column by default and transpose
  with `flipdirection`, `maxhorizontalslots` caps a row and
  `setitemsizefromcell` makes every cell the widest item's. A hidden child
  collapses out of an hbox/vbox and its siblings shift up (`ignoreinvisible`);
  a `resizeparent = yes` child resizes its parent to its own content; a
  `container` and a datamodel `item` size to their content, so an empty
  container collapses instead of holding its `size` open; `scrollbox` and
  `scissor = yes` clip like `scrollarea`; a flowcontainer honors a child's
  `parentanchor` on the cross axis; a `minimumsize` floors a shrinking child
  and the deficit redistributes over the rest. Sprite fills now say HOW they
  fill (nine-slice needs a `Cornered*` type AND a border, otherwise the border
  is ignored and the texture stretches or tiles), and the preview stopped
  nine-slicing on a border alone. Frame sheets (`framesize` + `frame`) resolve
  their cell, row-major and 1-based. Every rule cites the in-game measurement
  it comes from; the three where the two engines contradict each other are
  recorded as disputed and left alone rather than guessed at.
- Fixed: `minimumsize = { w h }` was being read as a child widget, so in an
  hbox or vbox it consumed a layout slot of its own and shifted the real
  children, and **Show GUI Widget Tree** listed it as a widget row (414
  vanilla widgets carry one).

### Changed (big workspaces)

Measured on the two workspaces the reports describe: the game mounted three
times plus 20 small mods (1.86M definitions), and the game plus a total
conversion twice (1.36M definitions, 8.3M references). Numbers are per window,
because every window still runs its own indexer.
[`docs/PERFORMANCE.md`](https://github.com/JDeffner/ck3-modding-toolkit/blob/main/docs/PERFORMANCE.md)
is the new page on what a workspace costs and which settings shrink it.

- **The index uses less than half the memory it did.** The parser hands out
  substrings, and V8 keeps a substring's whole parent string alive, so every
  indexed name was pinning the entire text of the file it came from: the index
  carried a second copy of every tree it had scanned. Names are copied and
  shared once now. The heavy workspace fell from 3161 MB to 1461 MB of retained
  heap (3804 MB to 2193 MB RSS), a definition from 924 B to 435 B, and mounting
  the same game several times now costs one set of identifiers instead of one
  per mount.
- **Saving is fast again on a large workspace.** Ctrl+S went from 731 ms to
  24 ms there (and 144 ms to 6 ms on the many-mod workspace). Three things were
  wrong: the index was walked end to end twice on every change (status counters
  and the scripted-list scan, both now incremental), dropping a file's
  references rebuilt a name's whole usage list once per mention instead of once,
  and one save parsed the same file three times (typing validation, save
  validation, then the file watcher) where it now parses once.
- **Semantic highlighting arrives during indexing instead of after it.** Every
  index change asked every visible editor to re-request its tokens and inlay
  hints, during the initial build too, so the requests queued behind the scan
  and editors sat on plain syntax colouring. The build now refreshes once, when
  it finishes. Trade-off: the sidebar views no longer fill in progressively
  while indexing.
- **A very large generated file no longer kills the index silently.** Passing a
  root's definitions as call arguments threw past ~125,000 of them, which killed
  the scan; the session then looked alive with an empty index, which is exactly
  the "only syntax highlighting works" report. A single file with 250,000
  definitions now indexes cleanly (regression test included).
- **One file watcher per distinct folder instead of one per mod.** A workspace
  folder containing 20 mods went from 21 recursive watchers to 1, and nothing
  under the game folder is watched at all.
- **A workspace big enough to hurt says so on activation.** Past 6 indexed mod
  roots or 10,000 script files, one notification names `px.excludedMods` (with
  a button to the picker) and, if you have switched it on, `px.tigerRunOn`. It
  is logged to the output channel every time and shown once per workspace.

### Added (embedding the server)

For applications that run px-lsp inside themselves rather than for editor
users. Every protocol addition below is backward-compatible: a client written
against 0.3.0 keeps working unchanged, and the VS Code extension behaves
exactly as before. The guide that ties them together is `docs/EMBEDDING.md`
(process contract, the initialization options an app should send, URI and
document-sync conventions, what is deliberately absent for a bare client, and
the in-tree reference clients).

- **The `initialize` result announces `serverInfo`** `{ name: "px-lsp",
  version }`, with the version read from the server package manifest so it
  cannot drift from the artifact you unpacked. Standard LSP clients read it to
  log which server they got and to gate features on its version; px-lsp used to
  answer anonymously.
- **`initializationOptions.client` replaces the `clientCommands` boolean.** One
  "is this VS Code" switch conflated three unrelated things (rich hover markup,
  the `px.*` command ids, who watches the mod tree), so any other client was
  all-or-nothing. It is now
  `{ hoverHtml?, commands?: string[], ownFileWatcher? }`, each independent and
  off by default, and every gate site asks a semantic question instead of
  testing the client's identity. `clientCommands` keeps working, deprecated,
  with both of its former states byte-identical.
- **`paradox/scopeAt`** reports the inferred scope chain and the visible saved
  scopes at a position, which is what a scope status bar needs. It is a
  read-only view of the same inference completion and hover already run, so a
  status bar can never disagree with what ranking saw. Scopes are string
  arrays, never one name: an ambiguous link stays ambiguous and an empty array
  means unknown.
- **`initializationOptions.dataDir`** names the root that contains the
  per-game data folders, so `wikidocs/` and `freqs.json` resolve independently
  under `<dataDir>/<gameId>/` and both re-derive when the game changes. The old
  `wikidocsDir` derived the freqs directory from its parent and stayed pinned to
  one game; it keeps working, deprecated and narrowed to the wiki mirror alone.
- **`px-lsp-win-x64-<version>.zip`**, a self-contained Windows server artifact:
  the tarball payload plus an unmodified official `node.exe` (pinned, fetched
  from nodejs.org and checksum-verified at build time), Node's own license as
  `NODE-LICENSE`, and a `px-lsp.cmd` launcher that resolves every path from its
  own folder. Installing the language server no longer means installing Node
  first on every machine you target.

## 0.3.0 - Paradox Toolkit (rebrand + three games)

The extension is now **Paradox Toolkit** (`JDeffner.px-toolkit`), a new
Marketplace entry, and it supports three games: Crusader Kings III (unchanged),
**Victoria 3** (new, first-class) and **Europa Universalis V** (new,
community-sourced schema). A CK3-only name and a `ck3.*` settings namespace no
longer described the product.

CK3 users: no CK3 behavior was traded away for the other two games. Same
schema, same bundled wiki data, same tiger integration, byte-identical
completion ranking. The breaking changes below are all rebrand fallout.

### Added (Victoria 3, shipped)

Victoria 3 is out of preview and has the same language core as CK3.

- **A 72-entry folder schema, verified folder by folder against a real
  install** (with the community CWT rules used only as a cross-check), 49
  required-localization claims that were each measured against vanilla before
  being asserted, and 32 reference fields. Vic3's plural `common/on_actions`
  and its `.metadata/metadata.json` descriptor are handled natively.
- **`script_docs` dumps in the new markdown format parse end to end**, proven
  against real dumps: 1,290 effects, 1,134 triggers, 302 event targets and
  6,588 modifiers become completion items and hover documentation.
- **Bundled `.gui` widget schema** harvested from vanilla (579 widget types)
  and **bundled completion frequency tables** from the vanilla corpus, so
  ranking is measured for Vic3 too rather than borrowed from CK3.
- **vic3-tiger** downloads and runs exactly like ck3-tiger, with the same
  baseline workflow and per-mod diagnostics.
- Deliberately NOT shipped for Vic3: a bundled wiki fallback (no licensed
  mirror exists), the `_*.info` structure layer (Vic3 ships no `.info` docs at
  all) and the pixel-accurate GUI layout preview (its engine was calibrated
  against CK3). The `.gui` language features and the Widget Tree do work.

### Added (Europa Universalis V, community-sourced)

- **A 518-entry EU5 schema imported from
  [cwtools-eu5-config](https://github.com/kaiser-chris/cwtools-eu5-config)**
  (MIT, pinned commit `7f2764a`, EU5 1.3.4-beta) by
  `scripts/import-cwt-types.ts`. It is **not verified against a live install**
  and the extension says so, in the setting description, in this changelog and
  in a one-time notice on first EU5 activation.
- **The blast radius is bounded by design**: only 8 reference fields, each
  confirmed by both the CWT rules and EU5's own `script_docs` dumps, and **zero**
  required-localization patterns. A wrong entry costs you navigation, never a
  false error squiggle. Fix gaps locally with a `<mod>/.eu5modding/schema.json`
  overlay, no release needed, and report them with the "Schema gap" issue form.
- **EU5's layout is understood**: content under the load-stage roots
  (`in_game/`, `main_menu/`, `loading_screen/`), and database **entry modes** on
  definition keys. `REPLACE:my_law = { … }`, `INJECT:`, `TRY_REPLACE:` and
  friends are indexed under their real name instead of being silently skipped.
- **`script_docs` dumps land in `Documents/Paradox Interactive/Europa
  Universalis V/docs`**, not `logs/`; the default path follows.
- **No tiger**: no EU5 build of the tiger validator exists, so the tiger
  commands are hidden and the ones you can still reach explain why.

### Added (multi-game plumbing)

- **`px.gameId`** (`auto` | `ck3` | `vic3` | `eu5`, default `auto`). The auto
  ladder reads the mod's descriptor shape: `descriptor.mod` → CK3;
  `.metadata/` plus stage folders → EU5; `.metadata/` alone → Victoria 3;
  otherwise CK3. Existing CK3 workspaces are unaffected.
- **`px.gamePath` / `px.logsPath` / `px.tigerPath` now describe the ACTIVE
  game and are honored for every game.** Unset paths are auto-detected per
  game (Steam library for the install, Documents for the dumps). Previously the
  Vic3 preview ignored them outright.
- **First-run guidance for games with no bundled data.** Vic3 and EU5 start
  thin until you dump `script_docs`, so **Run Setup & Health Check** now makes
  that the first action in its report, with the exact console steps and the
  right folder for the game.
- **`THIRD-PARTY-NOTICES.md`** at the repo root carries the MIT texts and the
  precise statement of what was derived from which CWT config. It ships in the
  .vsix and in the server tarball.

### Added (standalone / vim)

The server has always run over `--stdio` from any LSP client; this release
makes a plain client a first-class one instead of a degraded VS Code.

- **Hovers are clean markdown** for clients that do not declare
  `initializationOptions.clientCommands`: no VS Code `<span>` markup, no
  `command:` links that go nowhere. The VS Code client declares the flag and
  keeps its richer rendering.
- **The "create localization key" quick fix carries a real `WorkspaceEdit`**
  instead of a command the client cannot run: it appends the key to a
  server-managed `zzz_*` loc file in your mod, creating it with a UTF-8 BOM if
  needed. The two editor-command actions are omitted rather than shipped dead.
- **External file changes are picked up without a restart**: the server
  registers `workspace/didChangeWatchedFiles` itself when the client supports
  dynamic registration.
- **Status is visible in the LSP log.** `window/logMessage` now mirrors the
  index status (token and definition counts, whether tokens came from
  `script_docs` or from bundled data) and names the resolved bundled-data
  directory at startup, so an empty index is diagnosable from `:LspLog`.
- **The release tarball is smoke-tested by CI after extraction**, which is what
  actually catches a flattened layout or a missing `data/<game>/` folder.
- `packages/server/README.md` was rewritten around the questions a non-VS Code
  user actually has: a per-language-id capability table, a per-game support
  matrix, the path shapes per game, the two root/filetype failure modes, and
  how to read the log. `scripts/nvim-parity/` is the headless neovim harness
  that keeps those claims true.

### Breaking

- **New extension id.** This is a separate Marketplace listing; the old
  `JDeffner.ck3-modding-toolkit` does not update into it. Install the new one
  and uninstall the old one.
- **Every setting and command moved from `ck3.*` to `px.*`** with no fallback.
  Re-enter your settings (`px.gamePath`, `px.logsPath`, `px.tigerPath`, ...) and
  re-apply any custom keybindings.
- **Inline diagnostic suppression is now `# px:ignore`** (and
  `# px:ignore-next-line`). `# ck3m:ignore` comments already in your mod files
  stop suppressing anything. The **codes** themselves are unchanged, so a
  find-and-replace of the marker is the whole migration.
- **`.dds` files may fail to open** if you ever used "Reopen Editor With..." on
  one: VS Code remembers `workbench.editorAssociations` pointing at the old
  `ck3.ddsPreview` view type. Clear that entry, or set it to `px.ddsPreview`.
- **The index cache is rebuilt once** on first run: the cache location follows
  the extension id. Nothing is lost, the first scan just takes its usual minute.
- **npm packages renamed** to `@px-lsp/protocol` and `@px-lsp/server`; the
  standalone server binary and tarball are now `px-lsp`.
- **`px.vic3Preview` is gone.** Victoria 3 support is no longer behind a flag,
  so the setting has no replacement: set `px.gameId` to `vic3` if auto-detection
  guesses wrong, and delete the old entry from your settings. Anyone who had it
  on gets the shipped Vic3 profile, which is a much larger schema and now
  honors `px.gamePath`/`px.logsPath`/`px.tigerPath`.

### Unchanged on purpose

The `.ck3modding/` config folder in your CK3 mods (it holds your `schema.json`,
`playset.json` and tiger baseline, and is per-game by design; Vic3 and EU5 get
`.vic3modding/` and `.eu5modding/`), the `zzz_ck3_modding_edits_l_*.yml` loc
file the editor writes, `ck3-tiger` itself, the `ck3-script` diagnostic source
(`vic3-script` and `eu5-script` for the other games), the `paradox`/
`paradox-loc`/`paradox-gui` language ids, and the `paradox/*` LSP wire methods.

### Fixed

- **Symlinked mods are indexed.** Every directory walker skipped symlinks and
  Windows junctions outright, so a mod linked into the Paradox `mod/` folder,
  the standard Linux workflow, was silently invisible along with everything in
  it. Link cycles terminate and no file is indexed twice.
- **A suppression comment with a reason works.** `# px:ignore unclosed-brace
  -- the game tolerates it` parsed every word of the rationale as a diagnostic
  code, so it silently suppressed nothing. Text after `--` is now ignored.
- **The language server gets a heap ceiling sized for the index.** The
  definition index costs ~924 B per definition (~408 MB for a full vanilla
  scan), and Node's default old-space on an 8 GB machine is around 2 GB, which
  a total conversion plus a framework parent could exhaust.

### Changed

- Tiger and localization palette categories are `Paradox Tiger` and
  `Paradox Localization`; the status-bar badge reads `PX`; language display
  names are `Paradox Script`, `Paradox Localization`, `Paradox GUI`,
  `Paradox Format Docs` and `Paradox Mod Descriptor` (the underlying language
  ids never changed).
- Our own descriptor diagnostics report as `px-descriptor`, and the game
  error.log channel is named per profile.
- **User-facing strings name the active game.** Diagnostic messages, quick-fix
  titles, the setup report, the error.log status item and the Tools view read
  "Victoria 3" or "EU5" where they used to hardcode CK3, sourced from the game
  profile rather than written per site.

## 0.1.2 (alpha)

Fixes for the first GitHub issue reports (#1-#4), plus default hotkeys and a
quieter footprint outside CK3 workspaces.

### Fixed
- **Find references shows actual usage sites from vanilla and read-only
  parent mods** (#3). Those roots are not reference-indexed up front (memory
  guard), so a name used only by vanilla files previously listed nothing but
  its definition sites. References now run an on-demand scan over the
  un-indexed roots, memoized per name; workspace-mod references are unchanged.
- **Go to Definition lists every source, mod first** (#4). Definitions from
  the game folder and parent mods were hidden whenever a mod override existed;
  seeing both is exactly how an unintended override gets noticed, so the
  shadowed sites are now included after the mod's own.
- **Datatype chain completion works after a dot in `.gui` and `.yml` files**
  (#2). Completion items now carry an explicit replace range for the typed
  chain segment; before, the editor filtered `[GetPlayer.` member suggestions
  against the whole dotted word (and would have replaced it), so the popup
  came up empty.

### Added
- **GUI tree filter shows matches only, with a working ancestors toggle**
  (#1). Filtering the widget tree no longer interleaves every ancestor row
  with the matches; the "Hide ancestors" button restores the context. The
  first cut shipped this as a checkbox that silently did nothing unless
  filter text was present; the button is now also live in the idle tree:
  select a node and toggle it (`h` in the panel, `Ctrl+Alt+H` from anywhere)
  to focus on that node's subtree, Esc to clear. Single click previews the
  source line without stealing focus from the tree; double click jumps into
  the editor. The button disables itself when there is nothing it could do.
- **Default keybindings for the everyday commands** — GUI layout preview
  `Ctrl+Alt+P`, widget tree `Ctrl+Alt+W`, event graph `Ctrl+Alt+G`,
  dependencies `Ctrl+Alt+D`, run tiger `Ctrl+Alt+V`, localization
  side-by-side `Ctrl+Alt+L`, jump to script reference `Ctrl+Alt+J`, open
  `.info` docs `Ctrl+Alt+O`, GUI-tree ancestors toggle `Ctrl+Alt+H`. All are
  scoped to CK3 editors by when-clauses (nothing fires in other projects),
  and every `CK3:` command stays freely remappable in the Keyboard Shortcuts
  UI.

### Changed
- **Invisible outside CK3 workspaces.** The status bar item, the CK3
  activity-bar icon with its views, and the `CK3:` palette commands now only
  appear when the workspace actually contains a mod or a game install (or
  `ck3.modPath` points at one) — like language extensions that stay out of
  the way in unrelated projects. The one-time setup nudge follows the same
  rule. Bootstrap commands stay reachable everywhere: `CK3: Run Setup &
  Health Check`, tiger download, tutorial, image guidelines, DDS conversion
  and descriptor creation. Bare `.info` files outside the game's `_*.info`
  naming are no longer claimed either.

## 0.1.1 (alpha)

First batch of fixes and features driven by community feedback on the 0.1.0
alpha (Discord thread + first external testers).

### Changed (the "primary mod" concept is gone)
- **Every workspace mod is now a first-class mod.** Previously one mod (first
  workspace folder, or `ck3.modPath`) was silently "the mod": only it fed the
  sidebar views, missing-localization diagnostics, defines/text-format
  layering, the schema overlay, playset.json and completion's mod-first
  ranking; the other workspace mods were treated like read-only parents. All
  of that is per-mod now. `ck3.modPath` remains only for working on a mod
  folder that is not part of the workspace.
- **Sidebar views follow the file you are editing.** Mod Overview,
  Localization Coverage, Overrides & Conflicts, the event graph and the mod
  report show the mod that owns the active editor's file; the view header
  names it. `CK3: Pick Focus Mod` (button in the view headers) pins one mod
  instead. Switching is instant: all mods are indexed once at launch, the
  views only re-filter in-memory data.
- **Overrides view sees mod-vs-mod conflicts.** When two of your workspace
  mods define the same name, the view lists it with both mods' names and
  notes that launcher load order decides.
- **Tiger baselines are per mod.** `CK3 Tiger: Create Baseline` writes to the
  active editor's mod, and each validation run applies that mod's baseline.
- **Workspace mods can be excluded from indexing.** `CK3: Exclude Workspace
  Mods from Indexing` shows a checklist of the detected mods; checked ones are
  skipped entirely (no completion, navigation, diagnostics or views) until
  re-included. Persisted per workspace in `ck3.excludedMods`. A new "Workspace
  Mods" group at the top of the Tools view holds this picker, the focus-mod
  picker (with the current focus shown inline) and the list of excluded mods.

### Added (translation mods)
- **`CK3 Localization: New Translation Mod`** scaffolds a language
  compatibility mod for ANY indexed mod (workspace mod or read-only parent):
  a `descriptor.mod` with the source mod as dependency, every source loc file
  mirrored to `localization/<lang>/replace/` with blanked values (original
  text kept as `# english: …` comments, so nothing wrong-language ever ships),
  a playset.json so the new mod resolves the source's symbols when opened
  alone, and a generated `TRANSLATE.md` with the workflow, a per-file
  checklist and a ready-made AI translation prompt (verbatim rules for
  `$variables$`, `[script]`, icons, formatting tags, register/terminology).
  Progress is tracked by the Localization Coverage view (blank = untranslated).

### Added (multi-mod usability)
- **Hovers name the mod a definition comes from.** Origin labels in hover
  cards, completion details and the Overrides view now show the owning mod's
  launcher name from its `descriptor.mod` (`trait group revealed_realm ·
  Cultivation Expanded`) instead of a generic "mod"/"parent". With 20 mods in
  one workspace you can finally tell where a symbol lives at a glance. Mods
  without a descriptor fall back to their folder name; vanilla stays
  "vanilla". Labels refresh live when a descriptor changes.
- **Settings reworked for clarity.** The settings page is now grouped
  (Setup / Mods / Validation / Editor) with rewritten descriptions that lead
  with the common case: leave everything empty, open your mod folder(s), run
  Setup once. Machine paths (`ck3.gamePath`, `ck3.logsPath`, `ck3.tigerPath`,
  `ck3.modPath`, `ck3.parentMods`) are machine-scoped so Settings Sync no
  longer copies one computer's paths onto another. `ck3.tigerRunOn` got
  per-option descriptions.
- **Setup report reads like a playset.** `CK3: Run Setup & Health Check` now
  lists the primary mod and every workspace/parent mod by descriptor name and
  says what each group means (fully indexed and editable vs read-only
  context).

### Fixed (verified against real 1.19 dumps)
- **`DumpDataTypes` parsing works on real dumps now.** The parser predated any
  real dump and had three defects the first real one exposed: duplicate
  entries (a typed `Promote` plus a `Function` returning `[unregistered]`)
  let the worthless twin clobber the good one, breaking chain resolution for
  basics like `GetPlayer.` and `Character.GetFather.`; the literal
  `[unregistered]` leaked as a fake type name instead of falling back to the
  member pool; and `Description:` prefixes plus "Jomini Script System"
  boilerplate leaked into hovers. With the fixes a real dump lifts the data
  from the bundled wiki baseline (2,139 members, 24 types) to 19,710 members
  across 1,222 types.
- **modifiers.log parses again on 1.19.** The game switched the dump to
  blank-line-separated `Tag:` / `Use areas:` entries with no dashed
  separators; the old parser collapsed the whole file into one garbage token
  (silent since the format change). 590 concrete modifier tokens now load;
  templated tags (`$CULTURE$_opinion`) feed the new lazy expansion (see
  Added). Docs cache format bumped so existing caches reparse.

### Added (engine-layer batch)
- **Templated modifiers expand against your definitions.** modifiers.log dumps
  ~150 templated tags (`$CULTURE$_opinion`,
  `stationed_$MEN_AT_ARMS_TYPE$_damage_add`); concrete names like
  `french_opinion` or `heavy_infantry_recruitment_cost_mult` now get hover
  cards (template, source definition with file:line, use areas) and appear in
  completion where modifier tokens are offered. Expansion is lazy (matched on
  demand against the definition index), so AGOT-scale mods with thousands of
  cultures cost nothing. Each of the 13 placeholder-to-definition-kind
  mappings (plus the fixed men-at-arms base-type set) was verified against
  vanilla 1.19 `modifier_definition_formats/` and script usage; unverifiable
  placeholders (`$SUBJECT_SALARY$`, `$GEOGRAPHICAL_REGION$`, `$TRAIT_TRACK$`)
  are deliberately not expanded, since a wrong expansion is worse than a
  missing one.
- **Defines IntelliSense.** `define:` completes the 149 `NNamespace` blocks and
  `define:NNamespace|` completes that namespace's constants (2,100+ across
  jomini + game + mod, harvested from `common/defines` at index time, mod
  overrides game overrides engine). Hovering `define:NS|CONST` shows the
  resolved value, the defining file and layer, and what it overrides.
- **Localization format tags.** Typing `#` inside a loc value completes the
  text-formatting tags (`#G`, `#P`, `#bold`, ... — 111 harvested from the
  engine's `basetextformatting.gui`, the game layer, and the mod, with correct
  first-in-only-served override semantics). Hover shows the format chain,
  resolved color, and source file.
- **Data-binding macros.** The engine's `data_binding/*.txt` macro functions
  (`IsZero`, `Not`, ...) now appear in `[ ... ]` completion, signature help,
  and hover in `.gui` and loc files, with their expansion documented.
- **Engine layer indexed.** The `jomini` directory next to the game folder is
  scanned as a lowest-priority vanilla root: engine-only content (logic
  trigger localization, engine defines, base gui templates and text formats)
  now resolves in navigation, completion, and the GUI preview. `clausewitz`
  was audited and deliberately excluded (Paradox tooling only).
- **Dependency Explorer.** New activity-bar view plus "CK3: Show Dependencies
  of Definition at Cursor": for any definition (trait, scripted effect,
  building, event, ...) it lists what references it and what it references,
  grouped by kind, including bare-key scripted effect/trigger calls; click
  jumps to the site.
- **GUI preview phase 2.** Datamodel-driven lists render ghosted placeholder
  rows of their item template instead of nothing; `spriteborder` textures
  render as proper nine-slice (corners fixed, edges stretched one axis);
  widget `state` blocks are confirmed excluded from the base-state layout.
- **Live-pass harness.** `scripts/live-pass.ts` boots the locally installed
  VS Code with an isolated profile against the real mod workspace and runs a
  13-point checklist through the production client-server transport (first
  ever live pass; all checks green on 2026-07-14).

### Added (second feedback round)
- **Scope inference: call-site aggregation.** Scripted effects, triggers,
  values and modifiers without a CK3Doc `@scope` tag now root at the union of
  the scopes statically resolved at their call sites, closing the largest
  honest-unknown bucket from the 2026-07 audit. Measured with the audit
  harness: cultivation mod unknown-scope rate 53.2% to 34.4% (4,775 sites),
  AGOT 32.9% to 14.2% (807,284 sites). The `@scope` tag still wins;
  unresolved call sites contribute nothing (no poisoning: an unresolvable
  call site carries no scope information).
- **Scope inference: cross-file saved scopes.** `scope:x` names saved in
  another file now resolve: every save site is indexed with a static type
  hint (the enclosing key chain for `save_scope_as`, the value expression for
  `save_scope_value_as`, always `value` for `save_temporary_value_as`) and the
  merged type is the fallback when the current file has no save site. The
  hover card links up to three save sites instead of just saying "saved
  elsewhere in the mod".
- **Script-value math anywhere:** block-form math keys (`value`, `add`,
  `min`, ...) now put completion into the script-value context in any file,
  not just inside `ai_chance`/`ai_will_do`/weights, so math embedded in
  effect arguments completes correctly; `save_temporary_value_as` joined the
  math-key completion set and got hover documentation.
- **DDS preview pan and zoom**: mouse wheel zooms at the cursor, middle-mouse
  drag pans freely, pixels render crisply past 100%, and the toolbar buttons
  (fit, 1:1) recenter properly.
- **GUI preview free camera**: the layout preview is no longer pinned to the
  top-left scroll origin. Middle-mouse pan works in every direction including
  past the layout bounds, wheel zoom stays cursor-anchored, Fit centers the
  layout, and the first render opens centered. Widget dragging stays
  pixel-accurate under the new camera.
- **The game installation can live in the workspace.** A workspace folder that
  is a CK3 install (the `game` data dir or the install root) is detected via
  engine markers, never treated as a mod (no bogus missing-descriptor
  warning, no tiger runs against vanilla), and is adopted as the effective
  `ck3.gamePath` when the setting is unset.
- **.info reference navigation**: an editor-title button opens the game's
  `_*.info` format doc relevant to the current file (hidden when none
  applies), and inside an `.info` file a second button lists the vanilla
  implementation files of that folder for one-click comparison.

### Added
- **Multi-mod workspaces are now first-class.** Users with 20+ mods open at
  once (or one parent directory holding all their mod folders) get the full
  treatment for every mod being edited, not just the first workspace folder:
  - A workspace folder that merely *contains* mod folders expands to its child
    mods automatically (same for an explicitly set `ck3.modPath`).
  - References are indexed for every workspace mod, so find-references, usage
    counts, and the event graph span the whole workspace.
  - ck3-tiger validates the mod that owns the file you save (and the mod of
    the active editor on manual runs), publishing per-mod diagnostics without
    wiping other mods' results.
  - Mod-targeted commands (new content, loc editing, translations,
    tiger.conf) act on the mod of the active editor.
  - Reference diagnostics, folder-layout checks and namespace tracking apply
    per owning workspace mod.
- **Call-site references**: key-position calls (`my_effect = yes`,
  `my_trigger = { ... }`) are indexed as references — previously
  find-references on a scripted effect/trigger only found value-position
  mentions, i.e. usually nothing. Engine-token call sites (`add_gold`) stay
  out of the index as a memory guard for AGOT-sized mods. Completion ranking
  is unaffected: call sites are excluded from the usage-count signal (§C2).
- **Clickable reference counts**: the "N references" footer on hover cards is
  now a command link that opens the references peek at the hovered symbol
  (feedback request: "see a list of all usages of that trigger and navigate
  to them"). Find-references (Shift+F12) also works on loc-key lines inside
  localization yml now.
- **Navigate custom loc from localization strings**: F12 on
  `Custom2('RelationToMe', ...)` (or any name inside a `[ ... ]` datafunction
  expression) in a loc yml jumps to the `customizable_localization` (or other
  indexed) definition. Quoted arguments prefer the custom-loc meaning when
  names collide.
- **Ad-hoc list item scopes**: `every_in_list = { list = X }` (and
  any_/random_/ordered_) now infers the item scope from the mod-wide
  `add_to_list` / `add_to_temporary_list` set-sites, statically resolved
  through each site's enclosing key chain — including lists built in another
  event or file. List hover cards show the item type
  (`list X of character · mod`); conflicting set-sites stay unknown (AD-5,
  annotate never guess).

### Fixed
- **`save_temporary_value_as` is a saved scope now** (script-value math): the
  saved name types as a `value` scope, hover shows the in-file save site
  instead of "unknown · saved elsewhere in the mod", and the site is indexed
  for find-references/rename. Previously the entire family of
  `scope:my_saved_value >= 20` comparisons showed unknown even when saved four
  lines above.
- **Data-function hover resolves members by name when the chain does not**:
  `TaskContract.GetEmployer.GetPrimaryTitle` used to fall back to "member —
  deduced from vanilla usage" even with a loaded dump, because one link in the
  chain lacked a return type. The hover now scans the data-type tables for the
  member name and shows the real signature ("function on `Character` —
  matched by name"), listing other owning types when ambiguous.
- **The DumpDataTypes hover footer no longer reads like an error when the
  dump is already loaded.** Without a dump it now says the bundled wiki tables
  are in use and how to upgrade; with one loaded it says the specific name is
  not in the dump — previously the same static "Run `DumpDataTypes` …" line
  covered both, reading as "your logs were not found".

## 0.1.0 (public alpha)

First version to leave the dev machine, published as a Marketplace
**pre-release**. The public series restarts at 0.1.0; the entries below it
are the internal development history under the old 1.x numbering and describe
everything this alpha contains. Extension ID: `JDeffner.ck3-modding-toolkit`.
Licensed GPL-3.0-or-later (was MIT internally): distributed forks must stay
open source.

### Added
- **descriptor.mod language support** (new language `paradox-mod`, applied to
  `descriptor.mod` and `.mod` files): dedicated syntax highlighting, completion
  for every launcher key with an explanation of what the value means and a
  ready-to-fill example (`supported_version` offers the installed game version,
  `picture` lists image files in the mod root), the launcher's 21 category
  tags completed inside `tags={ }`, and hover docs on every key. Key set and
  tag list verified against the launcher docs and 86 real .mod files.
- **Missing-descriptor error**: a folder that contains CK3 content but no
  `descriptor.mod` gets an error (code `descriptor-missing`) plus a one-click
  **CK3: Create descriptor.mod** fix that scaffolds a launcher-correct file.
- **descriptor.mod diagnostics** (source `ck3-descriptor`): missing
  `name`/`version`/`supported_version`, unknown keys, duplicate keys, and
  `path=` accidentally shipped inside descriptor.mod (machine-path leak).
  All 88 real descriptors on the dev machine validate clean.

### Fixed
- **ck3-tiger no longer runs (or complains) in non-CK3 workspaces**: automatic
  runs (on save, on config change) are skipped silently when the mod folder has
  no `descriptor.mod`; only a manual *Run Validation* still explains what is
  missing.

## 1.10.0

### Added (2026-07 scope & variable audit)
- **Scope inference overhaul**, measured against the full AGOT mod (807k
  trigger/effect sites: unknown-scope rate 50.0% → 32.9%) and a private dev
  mod (audit harness: `scripts/audit-scope-inference.ts`):
  - `scope:x.link.link` dot-chains now resolve — the `scope:`/`var:` prefix
    check ran before the dot-split, so any chain starting with a saved scope
    lost the type (~85k sites in AGOT).
  - `random_list` / `random_valid` no longer masquerade as list iterators
    (~45k sites regained their scope).
  - Data links with arguments resolve: `culture:czech`, `title:k_x.holder`,
    `special_guest:officiant` (plus an output patch for `special_guest`,
    whose script_docs entry omits its output scope).
  - `prev` pops the scope stack, so `prev.prev` walks two levels.
  - Script-value math keys (`value`, `add`, `min`…) as block keys are
    scope-transparent instead of resolving as the same-named links.
  - **Scripted-list iterators**: `every_held_county` & co. (generated from
    `common/scripted_lists`, absent from script_docs) resolve their target
    scope through the list's `base`, transitively, and are offered in
    completion for vanilla and mod lists alike.
- **Per-definition root scopes**: events honor `scope = X` (default
  character), customizable localization honors `type = X`, scripted GUIs
  honor `scope = X`, and on_action files get their per-name Expected Scope
  from the user's `on_actions.log` (879 entries on the current patch).
  Scripted effects/triggers/values/modifiers honor a CK3Doc `@scope <type>`
  doc-comment tag as their declared calling scope.
- **Per-block root scopes** harvested from the game's own `_*.info` docs
  (`# root = the activity` → 206 keys across 50 kinds): `is_valid` in an
  activity infers activity scope, building blocks infer province, secret
  `on_expose` infers secret, and so on.
- **Ambient scope coverage** grew from 1 kind (interactions) to 40+:
  activities, schemes (+agents/pulse actions), secrets, casus belli, council
  tasks, situations, story cycles, legends, epidemics, inspirations, court
  positions, great projects, domiciles, tax slots, elections, and more —
  `scope:host`, `scope:scheme`, `scope:attacker` … now complete, hover and
  type correctly. Root scopes were added to ~45 schema kinds alongside.
- **Variable model rebuilt on the actual namespaces**: `var:` /
  `local_var:` / `global_var:` are separate storage classes; variable LISTS
  (`add_to_variable_list` & co.) are indexed at last (387 AGOT list names
  had no completion, now 12 edge cases), dual-indexed so `has_variable` /
  `var:` still see them; `variable = X` inside in-list iterators completes
  and references only list names of the right class; `has_variable = |` and
  the whole read family complete variables; reads (`clamp_variable`,
  `is_target_in_variable_list`…) are references, not phantom definitions.
- **Variable value types**: set-sites store the value expression; literals,
  flags and link chains anchored at `root` or a global link resolve
  statically, so `var:my_title.holder` chains keep scope awareness,
  `every_in_list = { variable = x }` infers the item type where knowable,
  and variable hovers show `→ character` plus namespace-correct set-site
  links.
- `save_scope_value_as` is indexed (completion/hover/references for the
  saved name, typed value/boolean/flag) — previously invisible.
- Saved scopes recorded inside `scope:ambient = { … }` blocks now type
  correctly (the ambient seed reaches the collector), and saves later in a
  file resolve through earlier ones.

### Fixed
- The indexer no longer walks dot-directories (`.git`, `.claude` worktrees):
  stale worktree copies of a mod no longer pollute completion/navigation.

## 1.9.0

### Added
- **Data-function IntelliSense got a ground-truth engine** for `[ ... ]`
  expressions in .gui and localization files. A cached background harvest of
  the user's own vanilla files (all `gui/*.gui` plus `localization/<lang>/`,
  ~200k expressions in under a second, then ~0.1s from cache per session)
  now feeds every feature, so names newer than the bundled wiki tables —
  `HouseAspiration`, `GetHouseAspiration`, window types, everything a future
  patch adds — are covered automatically:
  - Completion knows every chain start and member vanilla uses, ranked by
    real usage frequency, annotated with counts and deduced descriptions.
    Unresolvable chains fall back to the vanilla member pool instead of
    going silent (AD-5).
  - Hover cards show the signature, provenance (DumpDataTypes log / wiki
    tables / deduced from vanilla usage), a description (curated for ~30
    engine utilities, deduced from the name for the rest), observed literal
    arguments, and up to two real vanilla examples that link straight into
    the game files.
  - **Signature help** inside `Func( … )` — argument types from the user's
    DumpDataTypes log when present, else the observed vanilla arity — with
    the active parameter highlighted.
  - **Literal-argument completion**: typing `GetHouseAspiration('` offers
    `'no_aspect'`, `'strength'`, … — the values vanilla actually passes.
  - **Format-suffix completion** after `|`: `|E`, `|U`, `|V`, … with usage
    counts.
- Signature help now also works in .gui and localization files (previously
  script only); `(`, `,`, `'` and `|` trigger the matching features.
- `DumpDataTypes` output is now also read from a `logs/data_types/`
  subfolder, and dump entries carrying description prose show it in hovers.

### Fixed
- **4-part history dates highlight fully**: `7308.1.1.1 = { … }` (date with
  hour component, used in AGOT title history) now colors as one date instead
  of leaving a dangling `.1`. Applied to the script and .info grammars.
  (Found by auditing against PMT's lexer and the AGOT team's ckparser.)

### Added
- **Color-model tags highlight**: `rgb`, `hsv`, `hsv360` before a `{ … }`
  block (`color = hsv360 { 25 90 80 }`) now read as type tags instead of
  plain text.

## 1.8.0

Full syntax-coverage sweep of a real mod ("stop finding gaps one
screenshot at a time"): a new rerunnable audit
(`scripts/audit-mod-coverage.ts`) checks every scalar in a mod against the
grammar, semantic tokens, and hover, and everything it flagged was fixed.
Measured on that mod (18,212 scalars): words rendering with NO
color fell from 82 distinct (script) + 83 (gui) to 5 + 31 — the rest are
genuinely freeform custom names — and hover-less words fell from 178
distinct to 58.

### Added
- **Flags, lists, trait groups and game-concept aliases are indexed**:
  `add_character_flag = X` (any `add_*_flag`, scalar or `{ flag = X }`)
  and `add_to_list = X` declare names; `has_*_flag`, `is_in_list`,
  `list =` etc. reference them — coloring, hover, find-references.
  Trait `group = X` indexes a trait_group (accepted by `has_trait`);
  game-concept `alias = { … }` entries index as concepts.
- **Enum values color and document themselves**: `type = character_event`,
  `category = personal`, `valid_sex = female`, `province_filter = capital`,
  `ai_recipients = courtiers` — driven by structure-spec enums (several
  newly curated from the game's .info docs).
- **Hover fallback cards** for the glue vocabulary nothing documented:
  grammar/math keywords (`limit`, `NOT`, `base`, `add`, `days`… ~40
  curated docs), scope words (`ROOT`, `this`, `prevprev`…), macro
  parameters (`AMOUNT = 3` resolves against the called scripted effect's
  `$AMOUNT$`), engine-effect block arguments (`target_character` inside
  `start_scheme` shows the effect's own doc), generated relation triggers
  (`has_relation_dao_guide` → the scripted relation), event namespaces,
  and enum members. Dot chains (`root.location.county`) now resolve the
  segment under the cursor.
- **Asset values are visible**: unquoted values of icon/texture/animation/
  entity/camera/soundeffect/environment/… keys color as unquoted strings
  (`icon = spirit_root_2.dds`, `animation = happiness`).
- **Dedicated .gui grammar**: template/type/types/block/blockoverride
  keywords, `_show`/`_mouse_enter` state names, and the anchor / layout /
  blend-mode / sprite-type enum vocabulary (case-insensitive), on top of
  the script grammar.
- **New structure docs**: customizable_localization (text → trigger /
  localization_key / setup_scope / fallback), story_cycle (effect_group,
  triggered_effect, icon/background), interaction `ai_targets` block with
  the full ai_recipients list, `ai_frequency` (missing from the harvested
  .info data), modifier_definition_formats (new schema kind).
- `on_action` is a ref field: `trigger_event = { on_action = X }` and
  scheme/travel on_action keys complete, color, and hover as on_actions.
- `namespace = X` values color as events and hover as namespaces.

### Notes
- Known remaining hover gaps (by design of this release): activity-type
  sub-block keys, scripted character template keys, trait inheritance
  keys, story-cycle visualization keys — these need the .info harvester
  to learn sub-blocks, tracked separately along with the harvester bug
  that drops `ai_frequency`-style keys.

## 1.7.4

### Fixed
- **`reference` inside `override_background` had no hover and no
  completion** (user-reported): the event structure schema documented
  `override_background` itself but not its inner keys. All six
  `override_*` blocks from `_events.info` (`override_background`,
  `override_transition`, `override_effect_2d`, `override_icon`,
  `override_header_background`, `override_sound`) now offer and
  document their `trigger`/`reference` keys.
- **`reference = ` now completes real values** where the game expects a
  definition: event backgrounds (`wilderness_mountains`…) inside
  `override_background`, transitions inside `override_transition`, 2d
  effects inside `override_effect_2d`. (The `.info`'s "path to the
  texture" comment is stale — since backgrounds became definitions the
  value is a `common/event_backgrounds` key, which is what vanilla
  passes.) Implemented as a block-scoped ref-field table, generalizing
  the existing `trigger_event = { id = … }` special case; hover on
  unquoted values disambiguates through it too.

## 1.7.3

### Fixed
- **`ROOT` had no syntax highlighting** (user-reported): the grammar's
  scope-navigation rule only matched lowercase `root`/`this`/`prev`/`from`,
  but vanilla writes the uppercase forms all over portrait blocks
  (`character = ROOT` appears 120+ times in vanilla events alone).
  `ROOT`/`THIS`/`PREV`/`FROM` (and `PREVPREV`/`FROMFROM`) now color like
  their lowercase twins.
- **Hover no longer stacks unrelated meanings on ref-field values**
  (user-reported: hovering `faith` in `theme = faith` showed both the
  `faith` event target *and* the `faith` event theme). When the hovered
  word is the value of a schema ref field (`theme = X`, `add_trait = X`,
  `on_actions = { X }`), only definitions of the kind that field
  references are shown; every other position keeps the multi-meaning
  cards, since a name genuinely can be several things at once.
- Semantic highlighting applies the same rule: `faith` in `theme = faith`
  now colors as an event theme (definition), not as the event-target
  scope link.

### Added
- `theme` is a schema ref field (→ `event_theme`): event themes are now
  completed after `theme = `, and theme usages participate in
  find-references and reference counts.

### Fixed
- **Keys Paradox forgot to document are now completable** (user-reported:
  `success_desc` in a scheme type suggested nothing). The game's own
  `.info` docs are incomplete — scheme_types' `desc`/`success_desc` are
  used 654/75 times in vanilla but documented nowhere — so the structure
  harvest now also mines vanilla usage itself: any key used 3+ times as a
  direct child of a folder's definitions becomes a completion item,
  labeled "Used Nx in vanilla <folder> (not in the .info docs)".
- The harvest now counts key usage at **depth 1 only** (direct children
  of definitions, via the real parser) instead of any depth, which both
  fixes the frequencies used for ranking and removes ~300 false
  top-level keys (an event's option-level `name`/`modifier` etc. no
  longer appear as top-level suggestions). Rank-eval: all floors clear;
  "key not offered at all" dropped to 0% for event/decision tops and
  from 20% to 3.8% for interactions.

## 1.7.1

### Fixed
- **Dynamic-description completion**: typing inside a `desc = { … }` /
  `title` / `opening` / option `name` block of an event (or the
  title/desc/selection_tooltip/confirm_text of a decision, or
  interaction desc fields) now suggests the description-node grammar the
  game documents in `_events.info`: `desc`, `triggered_desc`,
  `first_valid`, `random_valid` (with `count`), and `trigger`/`desc`
  inside `triggered_desc` — at any nesting depth, with the game's own
  doc text on hover. Previously these keys were nowhere: the harvester
  stoplisted them as "grammar" but no layer actually served them.

## 1.7.0

Full-coverage audit of the game's schema docs, a completion-ranking
regression fix, and an event-graph interaction round.

### Added
- **Schema coverage for every remaining game folder**: a new audit script
  (scripts/audit-schema-coverage.ts, run it per patch) compared the
  extension's knowledge against all 164 `_*.info` docs and every common/
  folder in the game. 67 new definition kinds are now indexed and
  completable — game concepts, factions, epidemics, inspirations,
  scripted relations, trigger/effect localization, activity intents and
  pulse actions, scheme agent types and countermeasures, struggle and
  situation catalysts, domiciles, task contracts, succession election
  and appointment, bookmarks, achievements, messages, court-scene and
  portrait-modifier gfx surfaces, and more. structures.json grew from
  70 to 129 kinds (1836 documented keys); every remaining exclusion is
  documented with its reason. freqs.json regenerated.
- **Event graph**: an "All nodes" toolbar button shows the whole mod at
  once; the default node cap rose from 150 to 400. Double-click now
  opens the node's source file beside the graph (references from the
  inspector do the same); right-click re-centers the graph on a node.
  Opening the graph from an event file with no id under the cursor now
  seeds it with the file's namespace, and on_action/decision files seed
  from the word under the cursor; event-graph-applicable .txt files get
  an editor-title button.
- Tools view: "Create" group now leads, "Learn" moved next-to-last.

### Fixed
- **Completion mis-ranking in definition bodies** (caught by the
  rank-eval harness during the audit): harvested `.info` frequencies
  count key usage at ANY depth of a folder, so a raw frequency sort let
  option-level keys (name, modifier, character…) bury the real top-level
  event/decision/interaction vocabulary. Curated keys now keep their
  deliberate order ahead of harvested extras, and harvested copies of
  known sub-block keys are dropped from top level. Rank-eval MRR:
  event_top 0.113 -> 0.246, decision_top 0.155 -> 0.278, interaction_top
  0.079 -> 0.173, effect_block 0.104 -> 0.141; all acceptance floors
  clear again.

## 1.6.1

GUI preview interaction round, from first-use feedback.

### Added
- **Undo / Redo buttons** in the preview toolbar for the preview's own
  edits (guarded: if the document changed under them, they refuse instead
  of misapplying).
- **Reset button**: reverts the file to its last saved state (like closing
  without saving), with a confirmation dialog.
- **Middle-mouse drag pans the camera**; the **scroll wheel now zooms at
  the cursor** (no Ctrl needed).
- **Click-through selection**: clicking the same spot repeatedly drills
  down through the stack of overlapping widgets, topmost first, with a
  "layer 2/5" indicator.
- Saving the .gui file (or reverting it on disk) refreshes the preview.

### Fixed
- **Unpredictable drag results**: widgets spliced in from templates/types
  carry their *instance ancestor's* source line, so dragging them edited
  the wrong widget's position. They are now marked read-only in the
  preview (with an explanatory hint) instead of producing surprise edits;
  and when the selected widget is under the cursor, a drag always applies
  to it rather than to whatever is topmost.

## 1.6.0

### Added
- **Edit .gui files from the preview canvas**: clicking a widget in
  "CK3: Preview GUI layout" now selects it and opens a property panel
  (position, size, source line). Drag a selected widget on the canvas to
  move it — the drop writes a precise `position = { x y }` edit back into
  the source text (undo-able, live re-rendered). Widgets whose rects are
  managed by an hbox/vbox/flowcontainer refuse the drag with an
  explanation, since the game ignores manual positions there; the property
  panel edits or inserts the pair with correct indentation either way.
  Double-click jumps to the source line.
- The GUI preview's template/type store now includes parent mods'
  `gui/` trees (vanilla, then parents in load order, then the mod).
- **Multiple mods loaded at once** (submod / compatibility-patch workflow,
  CW Tools style): add parent mods as extra workspace folders (auto-detected),
  via the new `ck3.parentMods` setting, or via the existing
  `.ck3modding/playset.json`. Parent files get syntax highlighting and
  language features; parent definitions are indexed between the mod and
  vanilla so completion, hover, go-to-definition and the overrides view
  resolve across the whole playset; parent files re-index live on change.
- **`.info` files get syntax highlighting** (new `paradox-info` language):
  the game's `_*.info` format docs opened via "CK3: Open format docs" now
  render with the script color scheme — `== Section ==` headings,
  `<placeholder>` tokens, `yes/no`-style value alternatives, and
  `key = value` examples — while the surrounding prose stays plain.

## 1.5.0

GUI designer groundwork: a live, measured-accurate layout preview for .gui
files.

### Added
- **CK3: Preview GUI layout** (editor title button on any `.gui` file): a
  canvas webview that renders the file the way the game lays it out. Real
  DDS textures via the bundled decoder, the game's own Gitan font, template
  and type resolution across the vanilla + mod gui trees, scrollarea
  clipping, zoom/fit, wireframe outlines. Re-renders live while typing;
  hovering shows a widget's key, name and exact rectangle; clicking jumps
  to its source line (the reverse of the in-game `tweak gui.debug`).
- The rectangles come from a new layout engine whose every rule was
  measured in-game with a 4-batch screenshot calibration campaign
  (pixel-exact anchors, box fill/hug behavior, layout policies, text
  metrics; see `docs/gui-designer/calibration/spec.md`). 47 golden
  fixtures pin the engine to the measurements; all 373 vanilla `.gui`
  files lay out cleanly through it.

## 1.4.0

Feedback round: scaffolds that pass tiger, loc that lands in the right file,
GUI files as first-class citizens, a teaching graph view, and a full tutorial.

### Fixed
- **Event scaffold namespace bug**: appending an event into an existing
  events file that did not start with its `namespace = …` line now prepends
  it (this was tiger's "event file should start with namespace" error). All
  scaffolded `.txt` files now carry a UTF-8 BOM like every vanilla script
  file (tiger warned about the omission). Validated against real ck3-tiger.
- **Localization routing**: new keys no longer pile up in
  `localization/replace/` — they are inserted into the mod loc file that
  already holds their siblings (prefix match), falling back to the mod's
  main loc file. `replace/` is used only for what it actually means in the
  game: overriding vanilla keys. Applies to the edit command, the graph
  inspector, option scaffolds, the coverage-view action and the translate
  loop.
- **CK3: Create translation** no longer prefills values with English text:
  values are blanked and the source text stays visible as an inline
  `# english: …` comment; blank values count as untranslated everywhere;
  the translate-next loop shows the source in the prompt instead of
  prefilling it.

### GUI files, for real this time
- `.gui` files now get **completion, hover, go-to-definition, semantic
  highlighting and brace diagnostics** through the language server. The
  vocabulary comes from a build-time harvest of the entire vanilla gui tree
  (556 widget types with per-type property usage counts): property
  suggestions are ranked by how often vanilla actually uses them on the
  enclosing widget type, `using = ` completes your and vanilla's templates
  (mod first), hover shows usage stats and definition links.

### Structure keys everywhere
- The block-schema layer now covers **~70 kinds / ~1300 documented keys**,
  harvested from every `_*.info` schema doc the game ships and validated
  against real vanilla usage. Keys like the trait `shown_in_ruler_designer`
  now hover and complete with the game's own doc prose.

### Graph view v2
- Nodes show the event's **localized title**; edges are **labeled with their
  origin** — the option's text (`option: Take the gold`) or the section
  (immediate, on_actions…). Typing in the search box live-highlights nodes
  by id or title. A `?` overlay explains the whole view for new modders.

### New
- **CK3: Tutorial** — a bundled 10-chapter CK3 modding course (setup →
  first mod → script language → events → decisions/interactions → content →
  GUI → graphics → debugging → performance patterns), every snippet
  verified against the 1.19 game files, woven together with the extension's
  own workflow. Top of the Tools view.
- **Tiger feedback**: a status-bar spinner while ck3-tiger runs, flashing
  the report count when done.
- **Ctrl+Alt+T** edits the localization of the key under the cursor.
- **Tools view** moved to the top of the CK3 container (expanded by
  default); the other views start collapsed.
- First `.dds` open asks whether to keep the extension's preview as the
  default editor.

## 1.3.0

Textures, the event workbench, and a more capable activity bar.

### DDS
- **Click a `.dds` → see it.** A read-only custom editor decodes the texture
  in-place (DXT1/3/5, BC7, uncompressed — the same pure-TS decoder the hovers
  use) with zoom, 1:1/fit, alpha checkerboard and format/size info. No more
  "unsupported text encoding" dead end.
- **CK3: Convert image to DDS** — command palette, Tools view, or right-click
  a PNG/JPEG/WebP in the explorer. Decoding happens in a webview canvas (no
  codec dependencies); encoding is a built-in BC1/BC3 range-fit compressor or
  lossless uncompressed A8R8G8B8, auto-chosen by transparency. Round-trip
  tested against the decoder.
- **CK3: Image guidelines** — a bundled reference of the sizes and formats
  the game actually uses, measured from the vanilla 1.19 gfx tree (event
  scenes 1592×848 DXT1, trait icons 120×120 uncompressed, decision
  illustrations 1100×440 DXT1, emblems 256×256 DXT5, …).

### Event graph → event workbench
- Clicking a node now opens an **inspector pane**: type/theme/hidden badges,
  localized title & description, per-section logic summaries (trigger /
  immediate / after with their keys), options with resolved text, effect
  chips and trigger/ai_chance badges — and a **references panel** listing
  every saved scope, variable, scripted effect/trigger, script value and
  chained event the event touches, each one click from its definition or
  save site.
- **Edit localization inline**: title, description and option text save from
  the inspector through the BOM-correct loc writer; keys that don't exist
  yet are created in `localization/replace/`.
- **+ Add option** scaffolds a new option block (correct placement, loc key
  included).
- Ctrl+click a node to jump straight to source; double-click refocuses.

### Activity bar
- **Tools view**: one-click launchers grouped by workflow — create (new
  content, translations), images (DDS converter, guidelines), inspect
  (event graph, GUI tree, mod report, .info docs), validate (tiger, launch
  debug, error.log watcher, setup).
- **Localization Coverage**: missing keys carry an inline **Add
  localization…** action (writes the entry directly); the view title gains
  **Create translation**.

## 1.2.0

The "scrambled suggestions" release. Diagnosed by porting VS Code's own
suggest-widget scoring (fuzzyScore + completionModel semantics,
`test/vscodeFuzzy.ts`) and replaying it over the real provider output against
vanilla + a live mod (`scripts/fuzzy-diag.ts`).

### Completion v3
- **Key positions offer verbs only.** Script values, event ids, traits,
  on_actions and loc keys no longer pollute key completion (typing `tra` in an
  effect block used to surface ten vanilla script values above `add_trait`);
  they now complete where they are valid — value positions and prefixes.
- **Server-side filtering + cap + `isIncomplete`.** Responses went from
  11k–38k items / 1.9–6 MB JSON per request to ≤1000 items / ≤~240 KB,
  pre-filtered with the exact match predicate VS Code applies anyway. The
  client re-queries per keystroke, so nothing is ever out of reach.
- **Value positions always answer**: ref fields, structure-key enums/bools
  (yes/no), `trigger_event = { id = }`, list-form refs (`on_actions = { }`,
  `events = { }`), and a generic fallback (script values + event targets +
  yes/no) instead of the key soup.
- **Prefix refs**: `culture:`, `faith:`, `religion:`, `title:`, `character:`,
  `dynasty:`, `house:` complete from the index (extensible via the
  `.ck3modding/schema.json` overlay's `prefixRefs`).
- **New `value` block context**: `ai_chance`, `ai_will_do`, `weight` … bodies
  offer script-value math keys (`value`, `add`, `factor`, `modifier` …) and
  iterators instead of inheriting the effect list; script_value definition
  bodies too.
- **Docs resolve lazily** (`completionItem/resolve`), same-name tokens merge,
  and a name shared across kinds (vanilla `brave`: loc key + trait) no longer
  hides the kind you asked for — `has_trait = brav` finds `brave` again.
- **Word-based suggestions are off** for CK3 languages: no more random
  document words mixed in when a list is empty.
- Context detection heuristics from the game's own `.info` docs: `on_X`
  blocks are effect blocks (except `on_actions`), `X_trigger` blocks are
  trigger blocks.
- AGOT-corpus rank eval after all of this: trigger-block top-5 23.5% → 33.8%,
  "not offered at all" 7% → 1.3%; effect-block missing 21% → 16.3%.

### GUI
- **`.gui` files get syntax highlighting** (new `paradox-gui` language reusing
  the script grammar, applied to files under the mod/game paths).
- **GUI Widget Tree** (`CK3: Show GUI widget tree`, tree icon on `.gui`
  editors): collapsible PdxGui hierarchy — type badges, names, `using` refs,
  animation states, template/types declarations — with click-to-jump,
  filtering, and refresh-on-save.

### Highlighting
- New scopes for the biggest unhighlighted constructs: `@name` script
  constants, bare `$PARAM$` macro parameters, and `@[ … ]` inline math.

### Verification
- End-to-end LSP smoke suite forks the packaged `dist/server.js` over node
  IPC (the client's transport) and drives initialize → didOpen → completion →
  resolve → hover → definition → semantic tokens → `ck3/guiTree` against a
  fixture mod.

## 1.1.1

Hotfix for tiger auto-download (found in the first live 1.1.0 pass).

- The Windows/Linux tiger archive ships two binaries — `ck3-tiger` (explicit
  mod path) and `ck3-tiger-auto` (guesses the mod from the launcher). Binary
  selection returned the alphabetically-first match, i.e. `ck3-tiger-auto`,
  which needs the Paradox user directory and fails with "Cannot find the
  Paradox directory" (e.g. when Documents is redirected off `C:`), surfaced as
  a misleading "downloaded tiger does not run". Selection now prefers the plain
  `ck3-tiger` binary, which is also the one the diagnostics runner needs since
  it always passes an explicit mod path.

## 1.1.0

Grounded in a full-mod corpus analysis of the *A Game of Thrones* mod
(`docs/UPDATE_PLAN_v1.1.md` has the evidence and the A0 triage note).

### Structural keys & ambient scopes (P2)
- **Block-schema layer**: `is_shown`, `desc`, `send_option`, `option`-block
  keys and ~40 other structural keys now get completion and hover, with doc
  prose harvested from the game's own `_*.info` files (interactions, decisions,
  events, on_actions). Regenerate with `scripts/build-structure.ts`.
- **Ambient saved scopes**: `scope:actor`, `scope:recipient`,
  `scope:secondary_recipient`, `scope:intermediary` complete, hover and infer
  their type in interaction files even though no `save_scope_as` exists —
  they're engine-provided.
- Hover is now `scope:`/`var:` **prefix-aware**: a saved-scope card shows the
  name, inferred type, save site in the file, and the engine doc when ambient.

### Completion ranking (P1)
- sortText recomposed as **slot tier → frequency bucket → mod-first → label**:
  structural keys of the current block rank first (`name` is literally the
  first suggestion in an `option` block), then scope-valid tokens and
  definitions ordered by real-world frequency (bundled vanilla+corpus tables in
  `shared/data/freqs.json`, regenerable via `scripts/build-freqs.ts`, merged
  with live workspace usage counts — a mod's own idioms float up). Nothing is
  ever hidden (AD-5).
- Offline **ranking eval harness** (`scripts/rank-eval.ts` + corpus-gated
  vitest suite) with recorded baselines: 15–40× MRR lift in effect/trigger
  blocks; the hottest key now leads every measured context.

### Hover redesign (P3)
- Cards with colored kind badges and **scope pills** (theme-safe
  `--vscode-charts-*` variables; degrades to plain markdown in other clients),
  one compact provenance footer (file link, reference count), a single
  scope-context line per hover, 3-card cap.

### CK3Doc comments (P4)
- A contiguous `#` block right above a definition is its documentation:
  plain prose plus optional `@scope`, `@param`, `@saves`, `@returns`,
  `@example`, `@deprecated` tags. Rendered in hover, completion docs, and
  signature help (`@param` aligns with `$PARAM$`). Existing freeform comments
  in real mods render as-is — zero adoption cost.
- `CK3: New content` gains scripted-effect/trigger scaffolds that emit a
  doc-comment stub.

### Settings
- `ck3.diagnostics.ignore` (codes) and `ck3.diagnostics.ignorePatterns`
  (globs) filter both our diagnostics and tiger-forwarded reports.
- Inline suppression: `# ck3m:ignore <code…>` / `# ck3m:ignore-next-line`.
- `ck3.trace.server` for LSP tracing; `ck3.diagnostics.vanilla` makes the
  "never diagnose vanilla" behavior an explicit contract (default off).

### Notes
- Vanilla index cache format bumped to v4 (doc comments in rows); rebuilds
  once automatically.
- New corpus-gated test suites run when `CK3_GAME_PATH` /
  `CK3_MOD_CORPUS` point at a game install / large mod (319 tests total).

## 1.0.0

The rework lands (see `docs/rework-plan.md` for the design). Highlights over 0.3:

### Architecture
- Split into a **language server + thin client** (LSP). The heavy index and
  all analysis moved out of the extension host; indexing shows progress and
  never blocks typing.
- A real, error-tolerant **CST parser** for Paradox script (validated against
  the entire vanilla corpus: 0 exceptions, ~2s) and for the loc-yml dialect.
- **Schema-driven index**: ~90 folder entries (all verified against a live
  install) covering traits, decisions, interactions, cultures, religions,
  doctrines, landed titles, GUI types, history characters and more — plus a
  **references** table, parent-mod (playset) support, and per-workspace schema
  overlays.

### New features
- Structural diagnostics for the silent-failure class (unbalanced braces,
  BOM/encoding, loc header/filename mismatches, folder traps, unknown
  mod-namespace events, missing required loc). Docs per code under
  `docs/diagnostics/`.
- Scope-aware completion (rank, never hide), value-position completion from
  the schema, `scope:` completion, hover scope chains, opt-in scope inlay hints.
- Find-all-references, rename (script + loc), workspace symbols, outline,
  folding, signature help for `$PARAM$`, conservative formatter.
- **Texture previews on hover** (pure-TS DDS decoder incl. BC7).
- CK3 activity-bar suite: Mod Overview, Problems Summary, Localization
  Coverage, Overrides & Conflicts, interactive **Event Graph**, `CK3: Mod report`.
- Deep tiger integration: confidence, related locations, **baseline** workflow
  for adopting tiger on legacy mods, `--unused`, conf generation.
- Workflow: `CK3: New content` scaffolds, `CK3: Launch CK3 (debug mode)`,
  `CK3: Watch error.log` (live game errors as squiggles), translation loop,
  snippets, `.info` format-docs command.

### Notes
- The vanilla index cache format changed (v3); it rebuilds once automatically.
- v0.3's in-process providers are gone; features are identical or better.

## 0.3.0
- Tiger auto-download, setup command, walkthrough, status bar, translation
  scaffolding, semantic tokens, loc inlay hints and editing.

## 0.2.0
- Definition index (vanilla + mod), completion/hover/definition, tiger runner.

## 0.1.0
- Initial release: language modes, grammars, script_docs parsing.
