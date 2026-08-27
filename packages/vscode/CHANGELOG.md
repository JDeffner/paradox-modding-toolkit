# Changelog

## Unreleased

### Fixed

- **Typing and saving no longer stall on a large workspace.** Profiling the
  server on the game plus AGOT found that the first completion after any
  index change cost 4.3 s, and that a save invalidates exactly the caches
  involved — so every Ctrl+S made the next completion pay full price. Three
  causes, all fixed: the scope aggregation resolved "which schema folder is
  this file in" once per reference (4.1M times for 3,944 distinct answers,
  each rebuilding the parent-mod list), it scanned the entire reference
  index to find the 4% that are call sites, and the file scan read one file
  at a time. Measured on game + AGOT: completion after a save 4180 ms →
  606 ms, first completion after an index change 4314 ms → 800 ms, time to
  indexed 32 s → 25 s warm and 82 s → 70 s cold. Semantic highlighting was
  always 1 ms; it was queued behind the completion, which is why text sat
  colourless. Numbers and method in `docs/PERFORMANCE.md`.

- **Values no longer render colourless while the server catches up.** Bare
  identifiers in value position (`has_trait = brave`, entries of
  `traits = { … }`) had no TextMate scope, so they showed the theme's
  default foreground until the language server's semantic tokens arrived —
  on a big workspace or during the initial index build, that is the "text
  stays white for a while before it gets colour coded" report. A catch-all
  grammar rule now gives them a base string colour immediately, in all
  games and .gui files; semantic tokens refine it as before once the index
  answers.

### Added

- **`Paradox: Reduce VS Code Indexing Load`** for large workspaces (field
  report: game install + 40 mods). The toolkit's own index already skips
  binary files, but VS Code's built-in search and file watcher crawl every
  workspace folder whole, and 62% of a game install is textures, meshes and
  audio. The command writes workspace-scoped `search.exclude` and
  `files.watcherExclude` patterns for binary EXTENSIONS (`.dds`, `.tga`,
  `.mesh`, `.anim`, `.png`, `.bk2`, `.bank`, `.wav`, `.ttf`, `.otf`).
  Measured on game + AGOT (69,912 files, 43,067 skipped): whole-workspace
  Find in Files goes from 1.7 s warm (up to 106 s when the binaries are not
  in the OS cache) to a stable 0.65 s. Patterns match extensions only, never
  directories, so script under `gfx/`, `music/` or `dlc/` stays searchable
  and still re-indexes on save; a test enforces that. Additive and undoable:
  existing patterns survive, a pattern set to `false` stays `false`, and the
  confirmation offers one-click Undo. Also a button on the big-workspace
  warning. Numbers in `docs/PERFORMANCE.md`.

- **The exclude picker offers "Keep as Read-Only Context".** Excluding a mod
  removes it entirely; the new follow-up moves newly excluded mods into
  `px.parentMods` instead, indexing them like dependency parents: completion,
  hover and go-to-definition still see their content, without the reference
  index (the expensive half). The right tier for vanilla-copy packs (an
  unofficial patch) and framework mods you load but never edit. Un-excluding
  a mod pulls it back out of `px.parentMods`. `docs/PERFORMANCE.md` explains
  the tiers.

## 0.3.3 (beta) - tiger download fix

### Fixed

- **The tiger download works again.** GitHub now serves release assets from
  a new host (`release-assets.githubusercontent.com`), and the downloader's
  host allowlist refused the redirect with "refusing to follow the
  redirect". The new host is on the allowlist; the old one stays, since
  GitHub still uses both. Verified against a live download of
  ck3-tiger v1.19.0.

## 0.3.2 (beta) - Flag Builder, temporal event graph, GUI editor round

*(This entry was completed after the release: the version shipped with only
the Flag Builder paragraph written down.)*

### Added

- **Flag Builder for Victoria 3 and Europa Universalis V.** `Paradox: Open
  Flag Builder` (also a row in the Project panel) composes a coat of arms
  from the game's patterns, colored and textured emblems and sub flags,
  previews it with the game's recolor rule (color slots, shading, pattern
  masks, rotated instances), and writes the script: to the clipboard, into
  the mod's `common/coat_of_arms/coat_of_arms/` folder, or as a PNG. Every
  vanilla flag opens as a starting point. Approach ported from
  kaiser-chris/pdx-flag-builder (MIT). The canvas edits like the GUI editor:
  click selects, drag moves, corner handles resize with the aspect locked.
- `.tga` textures decode (the vanilla flag patterns are TGA), in the Flag
  Builder and the GUI editor alike.
- **Event graph rework: the x axis is time.** Left to right means "happens
  after": cards grow a row per execution phase, edges carry delays and random
  weights, chains focus to an adjustable depth, and a Cluster tool groups
  related cards. The graph launches from anywhere inside an event, a
  namespace lists its definitions even without edges, and chains through
  scripted effects appear as "A → B via effect" edges. The inspector edits
  the event as words rather than script and saves all pending edits in one
  go; events can be created from the graph with localization scaffolding.
- **GUI editor round**: Save with a session change log, a widget library
  overlay where every element previews as the game draws it, collapsible
  panel sections, a right-click context menu, and a Reference tab that lays
  an in-game screenshot under, over or as a difference against the scene.
- **DDS hover shows dimensions, exact encoding (DXT1/3/5, BC7, ...), file
  size and origin** under the image preview (closes #15), and the DDS viewer
  wears the shared px-ui chrome with floating zoom tools. Smooth (bilinear)
  view is the default, matching how the game samples textures.
- **One color picker everywhere**: the same picker style in script, `.gui`
  and the webviews, a format-native value field that accepts hex and
  `rgb { r g b }` input, and alpha shown but never silently edited.

### Fixed

- The 2026-08 adversarial audit round (#13): DDS decode budgets by pixel
  count so a hostile header cannot allocate gigabytes, the `gfx/` texture
  walk budget counts every entry visited, the GUI editor recovers from a
  `.gui` file vanishing mid-session, and the tiger download no longer blocks
  the extension host while tar runs.
- GUI editor engine fixes behind the "black bars": `blockoverride` applies
  inside `background = {}`, fills carry `alpha` and `fittype = centercrop`,
  and `using =` inside block content is spliced. Verified against in-game
  screenshots.
- Numeric map keys outside schema-marked weighted fields no longer create
  false event-graph edges.

## 0.3.1 (beta) - Victoria 3 feels right, and the panel learns some manners

0.3.0 made Victoria 3 and EU5 first-class on paper; this release makes the
daily loops actually work there. Everything below was found by auditing the
toolkit against a live Victoria 3 install and three real workshop mods,
including the Community Mod Framework.

### Fixed (Victoria 3 and EU5)

- **Victoria 3 completion offers the right key.** Measured on 1215 cursor
  positions across three real workshop mods, the correct key was never
  offered in 77.1 percent of positions before, 0.2 percent after. Three
  causes: Victoria 3 had no structures layer (its 91 `*.md` docs were
  dismissed as prose, 71 of them are `key = value # doc` listings and now
  feed `data/vic3/structures.json`, 116 kinds, 1179 keys); scope inference
  hardcoded CK3's "event root is a character" rule, so every country effect
  was demoted (`change_infamy` ranked 3963); and 12 reference prefixes
  (`unit_type`, `rank_value`, `ship_type`, nine more) were not wired,
  which left 446 reference sites dead. The CK3 rank-eval confirms no
  regression.
- **The GUI editor draws Victoria 3 files.** It laid out top-level
  instances only, and Vic3 writes 65 percent of vanilla gui (75 percent of
  the Community Mod Framework) as type declarations with no instance, so
  the canvas was empty. Declared types are previewed when a file
  instantiates nothing. The lexer also ended quoted strings at end of line,
  while Vic3 writes multi-line data functions: 202 parse errors in 23 of
  CMF's 52 gui files, editor read-only there. A newline now continues a
  string while a bracket is open, capped at 32 lines.
- **The error.log watcher works on Victoria 3 and EU5.** It watched a file
  that never exists: those games dump `script_docs` into `docs/` and the
  toolkit joined `error.log` onto that folder, while the engine writes it to
  `logs/`. On top of that, the parser only understood CK3's line format
  (`[12:00:00][E] ... file: x.txt line: 3`) and dropped every line Victoria 3
  writes (`[12:00:00][source.cpp:186]: gui/x.gui:110 - message`). Both ends
  are fixed; in-game script and GUI errors now land as squiggles while the
  game runs.
- **The GUI editor opens on Victoria 3.** It refused with "CK3 only" even
  though the Vic3 text metrics and layout quirks were measured in-game and
  ship in the profile. The gate now asks "is this game calibrated" instead of
  "is this CK3". EU5 still refuses, for the honest reason (no measurements
  yet), and says so.
- **Workshop mods show their real names.** A Victoria 3 mod appeared as its
  folder id ("3385002128") in the setup report, the sidebar, the pickers and
  the Project panel, because only `descriptor.mod` was read for names. One
  shared reader now falls back to `.metadata/metadata.json`, so it reads
  "[1.13] Community Mod Framework" everywhere.
- **New Content scaffolds per game.** It wrote CK3 events (`type =
  character_event`, portrait fields) and offered CK3 `on_action` names into
  Victoria 3 mods, creating silently dead hooks, the exact failure the
  command exists to prevent. Templates and on_action lists now live in the
  game profile: Victoria 3 gets `country_event` shapes and its real vanilla
  on_actions, EU5 gets its `in_game/` stage prefix on every scaffold path.
  Content types that have no verified template for a game are not offered for
  that game.
- **Create Mod Descriptor speaks both descriptor families.** It wrote a CK3
  `descriptor.mod` into any workspace; for Victoria 3 and EU5 it now writes
  `.metadata/metadata.json` (and mentions the `thumbnail.png` the launcher
  wants). The missing-descriptor warning fires for metadata games too, so a
  new Vic3 mod without metadata no longer loads silently as nothing.
- **Translation mods load on Victoria 3.** The translation-mod scaffold
  emitted `descriptor.mod` regardless of game, producing a mod Victoria 3
  refuses to load; it now emits the metadata descriptor with the source mod
  declared as a relationship.
- **Dependency mods feed every completion layer.** Mods listed in
  `px.parentMods` contributed definitions but not `data_binding` macros or
  text-formatting tags; the Community Mod Framework alone carries 40 macros
  that were invisible. Parent mods are now a full layer between game and mod.
- **129 Victoria 3 folders indexed** (up from 72, +2186 vanilla definitions): combat units, mobilization,
  ship types/modifications/names, AI strategies, buy packages, console
  command macros, plus `.gui` `type`/`template` names as definitions for both
  Victoria 3 and EU5 (2371 GUI types on a live install). Each new folder was
  shape-checked against vanilla before being added; folders whose layout
  would produce wrong definitions (defines, history) stay deliberately out.
- **A UTF-8 BOM no longer swallows the first block of a file.** The lexer
  treated U+FEFF as an identifier character, so a file starting with a BOM
  lost its first top-level block. Latent, found while indexing the framework
  corpus.
- Copy that said CK3 to everyone: the walkthrough claimed "nothing is
  bundled" for Victoria 3 (false, a full `script_docs` snapshot ships), tiger
  commands were offered on EU5 where no tiger exists (they now hide), the
  tiger conf command dropped its hardcoded `ck3-` prefix, and the loc
  quick-edit file is `zzz_px_edits_l_<lang>.yml` outside CK3 (the CK3 name
  stays for existing mods and old files are still honored).

### Added

- **Color swatches and a multi-format color picker** (issue #11). Every color
  in script and `.gui` gets a swatch; click it and the editor's native picker
  opens. Clicking the notation label cycles the formats, so one color can be
  written as `rgb { 174 169 166 }`, `hsv { 0.6 0.5 0.7 }`, `hsv360 { 216 50
  70 }`, `hex { 50779b }`, `{ 0.9 0.8 0.2 1 }` or `{ 180 75 80 }`. Your own
  notation is offered first, so a nudge never silently rewrites `hsv` as
  `rgb`. The forms are the ones measured in vanilla CK3 and Victoria 3, which
  differ from what HOI4/EU4 tools assume: Jomini `hsv` takes hue in 0..1, not
  0..360, and `hex` has no `0x` prefix. Untagged blocks count only under a
  `color` key (or inside a `named_colors` table); portrait genes like
  `hair_color = { 32 235 66 229 }` are palette coordinates and stay
  swatch-free. Ships on the standard LSP `documentColor` request, so every
  client gets it, not just VS Code. 20,817 sites in vanilla CK3 `common/` +
  `gui/`, 3,387 in Victoria 3, zero false positives in the audit.
- **`Paradox: Add Dependency Mod`** reads the dependencies your mod declares
  (`descriptor.mod` or metadata `relationships`), scans the Steam workshop
  folder of the active game, and writes `px.parentMods` for you. Declared but
  uninstalled dependencies are flagged instead of guessed at. Until now that
  setting was hand-edited JSON.
- **`.metadata/metadata.json` gets completion and validation** via a JSON
  schema: field names, types, and the `relationships` shape, checked against
  real workshop mods.

- **Crusader Kings III script files get the crown icon back**, and the other
  games keep the box, now with "PX" letters. Behind it: the script language is
  contributed once per game (`paradox-ck3`, `paradox-vic3`, `paradox-eu5`,
  plus the generic `paradox`), because a VS Code language carries exactly one
  icon and one name. They are the same language: same grammar, same
  completion, same validation, same server. What changes is the icon in the
  Explorer and the label in the status bar, which now reads e.g. "Paradox
  Script (Victoria 3)". A workspace set up by an earlier version has its
  `files.associations` entry for `*.txt` rewritten once; an association you
  wrote yourself is left alone.
- **Per-game snippets.** The CK3 effect snippets (`add_opinion`,
  `add_character_modifier`, …) no longer offer themselves in a Victoria 3 or
  EU5 file. Victoria 3 gets a small set of its own, checked against the game
  files: `event`, `te`, `mod` and the `..._scope_...` iterators. Snippets that
  are the script language itself (`if`, `else_if`, `else`, blocks, PdxDoc
  comments) stay available everywhere.

- **Every tool has a row in the Project panel.** The panel used to omit
  anything that had a button elsewhere, which meant the features with the
  best buttons were the hardest to find. A new **Open** group at the top
  launches the event graph, the GUI widget tree, the GUI editor, the format
  docs and the event simulator. Editor-title buttons, the status bar and the
  keyboard chords stay exactly as they are: they are the fast path in
  context, the panel is where you go when you do not already know where the
  button lives.
- **Five keyboard chords**, all rebindable like any VS Code shortcut and all
  inert outside a Paradox workspace: Ctrl+Alt+G (event graph), Ctrl+Alt+D
  (format docs for this file), Ctrl+Alt+W (GUI widget tree), Ctrl+Alt+S
  (simulate the event at the cursor) and Ctrl+Alt+R (mod report).
- **A keyboard button on the Project view title** (`Paradox: Keyboard
  Shortcuts (this extension)`) opens the Keyboard Shortcuts UI filtered to
  this extension, so rebinding a chord is two clicks.
- **The panel rows are customizable.** `Paradox: Customize Project Panel
  Rows` is a checklist of every row; unchecking one hides it, and a group
  whose rows are all hidden disappears with them. Stored in your user
  settings as `px.sidebar.hidden` (command ids), empty by default, so rows
  added by a later version always show up.

## 0.3.0 (beta) - Paradox Modding Toolkit: rebrand and three games

The extension is now **Paradox Modding Toolkit** (`JDeffner.px-toolkit`), a new
Marketplace entry, and it supports three games: Crusader Kings III (unchanged),
**Victoria 3** (new, first-class) and **Europa Universalis V** (new,
community-sourced schema). A CK3-only name and a `ck3.*` settings namespace no
longer described the product.

CK3 users: no CK3 behavior was traded away for the other two games. Same
schema, same bundled wiki data, same tiger integration, byte-identical
completion ranking. The breaking changes below are all rebrand fallout.

### Fixed (outline, folding, inline declarations)

- **Code folding works in `.gui` and localization files.** The folding
  provider only answered for script files and returned nothing for the
  other languages it was registered on — which actively disabled folding
  there (a registered provider suppresses VS Code's indentation fallback).
  `.gui` files now fold every multi-line `{}` block with the closing brace
  kept visible, plus comment banners; `.yml` loc files fold the
  `l_<language>:` body and comment banners.
- **Sticky scroll and breadcrumbs follow the whole block chain in script
  files.** The script outline stopped two levels down: a definition, plus a
  hand-picked handful of child blocks (`option`, `immediate`, `trigger`, a
  few more). Everything deeper was invisible, so scrolling inside a
  ten-level-deep event pinned `my_event > immediate` and nothing else.
  Every multi-line block is now an outline entry, at any depth. In
  `accolade_events.txt` the innermost line of `accolade.0002` reads
  `immediate > if > if > send_interface_message > desc > first_valid >
  triggered_desc > trigger > scope:acclaimed_knight`. Blocks that are data
  rather than structure emit nothing: one holding only bare values
  (`traits = { brave shy }`) and one that opens and closes on a single
  line, which could never be a sticky header anyway. A block's `name`
  shows as its detail, the way event options already did.
- **Descriptor and format-doc files fold and outline.** `descriptor.mod`,
  the outer `<mod>.mod` files and the bundled `_*.info` format docs are
  jomini script, but the client never routed them to the server, so they
  had neither folding nor an outline. They now reach the folding and
  outline providers only; every other feature stays off for them,
  diagnostics included.
- **Sticky scroll and breadcrumbs work in `.gui` files.** The outline used
  to run `.gui` files through the script-events shape, so `types X` /
  `template X` declarations and nested widget headers never reached it —
  and sticky scroll had no headers to pin. `.gui` outlines are now the full
  nested widget tree: declaration markers (`types`, `template`,
  `blockoverride` in both spellings) labeled as such, widgets carrying
  their `name = "..."` property as the detail, `type x = base` entries
  showing their base.

- **Inline `scripted_trigger`/`scripted_effect` declarations in event files
  are indexed** (#5): go-to-definition, hover (with doc comment and
  `$PARAM$`s) and find-references now work on triggers/effects declared
  inline in the same event file, at any nesting depth — even while the
  vanilla index is still building, stale, or absent (the open document
  answers on its own). Call sites of conventionally named scripted
  triggers/effects (`*_trigger`, `on_*`) are no longer mistaken for grammar
  keywords, so their references, rename and unused detection work too. The
  vanilla index cache format is bumped so existing installs pick this up on
  first restart.

### Added

- **Clear Game Problems.** The Problems the error.log watcher publishes
  deliberately survive stopping the watcher — you work through them with the
  game closed — but until now nothing removed them short of clearing the log
  in-game or reloading the window. The Project view grows a
  "Clear Game Problems (N)" row while there is something to clear, and the
  command palette has `Paradox: Clear Game Problems`.
- **Bundled script_docs and data-type dumps.** The extension (and the
  standalone server tarball) now ship dump snapshots per game under
  `data/<game>/script_docs` and `data/<game>/data_types`: CK3 (full), Vic3
  (full — completion works out of the box now, no dump required), EU5 (data
  types; script_docs pending). Your own dump always wins outright — it
  matches your exact game version; the status bar says which source is
  active ("bundled script_docs snapshot" vs "script_docs + wiki").
- **Victoria 3 dump paths fixed** (verified on a live install): Vic3's
  `script_docs` writes to `Documents/.../Victoria 3/docs`, not `logs/` —
  auto-detection now looks there — and its `dump_data_types` output in
  `logs/data_types` is found by probing the sibling `logs/` folder of a
  docs-style dump path. Setup names the right console command per game
  (`DumpDataTypes` vs `dump_data_types`).

### Changed (feedback round)

- **Event graph redesigned** after researching the best event/dialogue graph
  tools (articy, Arcweave, Yarn, React Flow, Foam): nodes are theme-native
  cards with a kind accent bar instead of full-color boxes; selecting a node
  dims everything outside its neighborhood, colors what it fires blue and
  what fires it orange, and reveals its edge labels (labels show everywhere
  only in sparse graphs, ending label soup); the legend is clickable to dim
  kinds; zoom controls (+/−/fit, also keyboard +/−/0), Esc deselects,
  clicking empty canvas deselects; the inspector gained "Center graph here".
- **GUI tree focus reworked**: "Focus subtree" pins the subtree and clicking
  around INSIDE it navigates without re-narrowing; `h` on a deeper node
  re-focuses there, Esc zooms back out; the button says what it does in
  each mode. Clicking any tree node now also flashes the widget's line in
  the source editor (range highlight + overview ruler mark).
- **File icons redrawn**: the "PS" script icon and the "PX TK" activity-bar
  mark are single continuous paths now (the old separate stroke segments
  read as a broken P at small sizes; the S was two >250° arcs), and the
  descriptor.mod puzzle icon is optically centered.
- **Project view**: Setup & Health Check row removed (the PX Toolkit status
  bar item is that button); tiger quick actions added under Test &
  Troubleshoot (Create Baseline, Find Unused, Generate conf, Update).
- **Hovers in huge multi-mod workspaces**: a word with many same-kind
  definitions (AGOT saves a scope named `type` in 33 places) now renders ONE
  grouped card ("33 sites") instead of a stack of identical cards; on an
  assignment KEY, the key's own structural meaning ranks first and
  value-side identities are dropped; the "N references" count renders once
  per hover instead of once per meaning.
- The tiger status item is capitalized ("Tiger"), the DDS guidelines gained
  the community sizing table (legacy tracks, lifestyle backgrounds,
  bookmarks, clothing textures, mipmap notes; thanks Sparc), and every
  GitHub link follows the repo rename to `paradox-modding-toolkit`.

- **The Project view names the active game.** A header row shows the game the
  workspace mods (with an "auto-detected" or "set manually" badge); click it
  to change `px.gameId` when detection guessed wrong. The empty state now
  offers **Create descriptor.mod** instead of a dead end.
- **Actionable notifications.** Running tiger without a binary offers the
  download in one click; a missing mod descriptor offers **Create
  descriptor.mod**; launching the game offers **Watch error.log**; a failed
  tiger download offers **Retry**; a setup report with a blocker offers
  **Open Settings**; and turning on the tiger baseline filter with no
  snapshot says so honestly and offers **Create Baseline** instead of
  claiming problems are filtered.

### Changed (UX round: fable + opus adversarial review)

- **The bundled 10-chapter tutorial moved out of the extension** — it is
  becoming a tutorial website. `px.tutorial`, the Project view's "Learn"
  group and `media/tutorial/` are gone; the AI modding skill stays.
- **Settings speak all three games.** `px.gamePath`, `px.logsPath`,
  `px.tigerPath`, `px.modPath` and the trace settings no longer hardcode CK3
  in their descriptions; `px.gameId` moved to the top of the Setup section
  (it shared an `order` with `px.trace.server` under Editor).
- **The walkthrough tells the truth about tiger**: it runs on demand by
  default (`px.tigerRunOn: "manual"`), with `save` as the opt-in — the old
  copy claimed the opposite. The overview step got its own page (it shared
  one with "Try it"), and the pages stopped calling the Paradox view "CK3".
- **Keybindings survive European keyboards.** `Ctrl+Alt+letter` is AltGr on
  many layouts (AltGr+L is `ł`, AltGr+O is `ó` — typing Polish loc text
  triggered commands). Only five defaults remain (T, P, V, J, and H in the
  GUI tree); Event Graph, GUI Tree, Dependencies, Side-by-Side and Format
  Docs keep their buttons and palette entries, rebindable as ever.
- **Honest per-mod problem counts**: the Mod Report now counts only the
  focused mod's diagnostics (it counted the whole window under a "Mod: …"
  header) and no longer leaves a dirty Untitled tab behind; error.log
  diagnostics are sourced `vic3-game` in a Vic3 workspace instead of always
  `ck3-game`; the tiger status item says "3 problems", not "3 report(s)".
- **Copy polish everywhere else**: "no mod folder" errors stopped pointing
  at `px.modPath` (the setting whose own description says leave it empty);
  scaffold validation errors explain instead of printing a regex
  (`Must match /^[a-z][a-z0-9_]*$/`); the translation loop documents
  skipping (leave empty) and reports written vs skipped; quick-pick titles
  dropped the redundant "Paradox:" prefix; `Find Unused Definitions`
  dropped its `(--unused)` flag; Setup on CK3 no longer scores the optional
  script_docs dump as a missing item; "Show details" opens the Paradox
  Toolkit output channel instead of toggling whatever panel was last open;
  Convert Image to DDS and Image Guidelines left the palette of non-mod
  workspaces; marketplace listing gained the Snippets/Formatters/
  Visualization categories and a description that says "GUI editor", not
  the retired "GUI preview".
- **The integration story is visible**: the README highlights that the
  server is standard LSP over `--stdio`, and Outside VS Code links
  `docs/EMBEDDING.md` (process contract, init options, `paradox/*` wire
  methods) next to the neovim guide. `EMBEDDING.md` now states that
  `modPath` always gets reference indexing (`workspaceMods` upgrades
  additional roots), resolving an apparent contradiction with the server
  README. Verified against neovim 0.12.4: the nvim-parity harness passes
  all 19 checks against a real mod.

- **The Tools view is now "Project" — a proper dashboard.** The command-list
  tree is replaced by a webview: every workspace mod as a row with a per-mod
  focus dot (pin the sidebar views to one mod, or follow the active editor)
  and an index on/off switch (backed by `px.excludedMods`); live toggles for
  the new-problems-only tiger filter (hidden for games without a tiger), the
  game error.log watcher, vanilla diagnostics and scope inlay hints; and the
  familiar tool launchers with per-game labels (minus tiger runs, which live
  in the status bar). Everything has an info tooltip on hover, and the view
  reflects state changes from anywhere (settings, commands, status bar)
  immediately.
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
  no pixels and the canvas should not pretend it did.
- **The GUI editor becomes a designer.** Everything above was the first
  version's select/drag/inspect loop; on top of it:
  - **Layers, guides and focus.** A layers panel over the selected widget's
    container: eye (preview-hide), lock (stops swallowing clicks), solo (dim
    the rest), hover flashes the outline, and dragging rows reorders source
    order through the writer, labeled as layout order inside an hbox/vbox
    because that is what source order means there. Smart guides snap a drag to
    sibling edges, centers and equal spacing, with an optional grid; a live
    x/y/w/h readout and live inspector values follow the gesture; dragging a
    widget inside a box shows a drop line and commits a reorder. Subtree focus
    (`f`) scopes the tree, the canvas and hit-testing to one branch, with a
    breadcrumb back out.
  - **Editing several widgets at once.** Shift+click and marquee selection;
    move, nudge, delete, duplicate, align and distribute commit as ONE undo
    step through a batched `paradox/guiSourceEdit` (ops computed against one
    source model; a refused member is skipped and its reason shown verbatim,
    the rest proceed). Copy puts the widget's verbatim block on the clipboard,
    paste re-inserts it; a palette inserts new widgets from the harvested
    widget vocabulary plus the document's own types (never from memory); an
    anchor picker offers exactly the anchor words the layout engine parses;
    wrap encloses a sibling run in a new container. Reorder indices count the
    declarations a preview cannot see (a `blockoverride` between two widget
    children used to shift every later index by one), so a layers drag moves
    exactly the block you dragged.
  - **An editor that explains itself.** A "why is it here" panel sums the
    engine's own placement terms to the widget's rect origin, names the layout
    container that dropped an authored position, the clipping ancestor and the
    template value each property overrides; a constraint overlay draws parent
    bounds, anchor crosshair and link line, clip rect and expanding-axis
    arrows; depth/clip/synthetic heatmaps; optional layout-change pulses; a
    stats line with the server's per-stage timings. Conditional visibility
    gets preview modes (show all, hide all, or evaluate with per-check answers
    the editor remembers per document). A dependency panel links the selected
    widget to its scripted_guis (file:line, used-by counts), the event chains
    that reach them, and its loc keys with missing ones flagged, every row a
    click-through. Texture and type browsers pick values from the mod and game
    trees; a selection can be saved as a named component and property bundles
    as presets, both stored in your workspace, none shipped bundled.
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

### Added (feedback round)

- **The inspector grows up.** An add-property row with completion from the
  harvested widget vocabulary (per-type property names plus the tree-wide
  ranking; type a name, pick a suggestion, values complete too where the
  engine has a vocabulary, like anchors). Block values such as
  `background = { using = X alpha = 0.7 }` open into a sub-editor with one
  row per entry, rows addable and removable, committed as one write. Property
  values get a display mode: full, abbreviated (ellipsis, full value on
  hover) or hidden, remembered per workspace. And the panel holds its place:
  committing a value no longer jumps the scroll to the top, and text typed
  into one field survives a commit in another.
- **Middle-mouse drag pans everywhere.** The event graph, the event
  simulator, the GUI widget tree and the GUI editor all pan (or grab-scroll)
  with the middle button, with pointer capture so a release outside the
  window never leaves a pan stuck.
- **The event graph query completes.** The root/namespace box suggests the
  mod's real event ids and namespaces as you type, from the same index that
  draws the graph; picking one asks for exactly that graph.
- **Simulate Event is reachable.** A "Simulate" CodeLens sits above every
  event declaration (the editor's global CodeLens toggle governs it), and a
  selected graph node offers Simulate next to Open source.
- **The Project view is three collapsible sections** (Workspace Mods,
  Toggles, Tools), each remembering its state. Tools now lists only commands
  with no button elsewhere; everything with an editor-title button or a
  status-bar entry lost its duplicate row. The view uses the editor's own
  background and follows theme changes.

### Fixed (error.log watcher)

- **The error.log watcher actually watches** ([#10](https://github.com/JDeffner/paradox-modding-toolkit/issues/10)):
  entries appended while the game holds the log open now appear (the old
  reader could silently skip regions on a short read and then never look at
  them again), and clearing the log from the in-game error tracker, or
  relaunching the game, drops the stale Problems instead of leaving them.
- **Multi-line `Script system error!` blocks show the error, not the
  location.** The game splits these entries across three lines: a header, an
  indented `Error: ...` line, and an indented `Script location: file: ...`
  line. The line-based parser used to publish the location line as the
  diagnostic message ("Script location: file: common/... line: 25") and drop
  the actual error text. The parser now stitches the block together: the
  `Error:` line becomes the message, the location line supplies file and line.
- **Relaunching the game drops the stale Problems on Linux and macOS too.**
  The fix above held on Windows, where a replaced file always gets a fresh file
  index, but not on POSIX, where the kernel hands back the inode it just freed.
  A new error.log that reused the inode and was longer than the old read offset
  passed for an append: the stale diagnostics stayed in Problems, and the next
  read continued into the middle of a file it had never seen the start of. The
  tail now holds the log's descriptor open between polls, which makes the inode
  unreusable and the identity check exact. Windows is unchanged, where a held
  handle would only get in the game's way.

### Changed (brand, icons, retired preview)

- **The GUI Layout preview is retired.** The GUI editor does everything it
  did and more, so the editor inherits its place: the $(preview) icon on
  .gui editor titles and the Ctrl+Alt+P keybinding now open the editor, and
  the editor's tab carries a proper icon. If you only ever wanted to look,
  the editor with the file read-only is that.
- **Brand and file icons.** Script files show a "PS" glyph drawn from the
  same geometry as the marketplace lockup; the mod-descriptor puzzle icon was
  being clipped at the viewBox edge (why it looked oversized) and now sits in
  the same box as every other glyph; the activity bar shows the full PX/TK
  lockup; the P's bowl moved to classic proportions. The footer item reads
  "PX Toolkit".
- **tiger lives in the footer for real.** The status item used to appear only
  while tiger ran and for five seconds after, which, with `px.tigerRunOn` now
  defaulting to manual, meant never. It is persistent whenever the active game
  has a tiger, one is configured, and the workspace is actually a mod
  workspace (an unrelated project never grows a tiger segment): a play prompt
  when idle, a spinner while validating, the last report count until the next
  run. Clicking it runs tiger.
- **The icon's letterforms widened** (24 to 28 units per cap), so the PX/TK
  lockup fills the tile instead of floating in it. Every brand asset
  regenerates from the same shared geometry.

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
[`docs/PERFORMANCE.md`](https://github.com/JDeffner/paradox-modding-toolkit/blob/main/docs/PERFORMANCE.md)
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
users. Every protocol addition below is additive: the existing requests and
notifications are unchanged, and the VS Code extension behaves exactly as
before. The guide that ties them together is `docs/EMBEDDING.md`
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

- **Localization values close at the LAST quote, the way the game reads them.**
  A value containing a quote (`hello:0 "He said "no" and left"`) was cut at the
  first inner quote, so the rest of the text vanished from hovers, inlay hints
  and the coverage view, and the translation tools wrote it back truncated. The
  parser now ends the value at the last quote on the line.
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

Earlier entries used an internal version numbering and remain in the git history.
