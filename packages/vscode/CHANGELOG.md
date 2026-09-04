# Changelog

## Unreleased

- **Code snippets, measured from the game.** Typing at the top of a script
  file offers a skeleton of that folder's definition kind (`new event`, `new
  decision`, 119 kinds for Crusader Kings III, 93 for Victoria 3), and an
  empty line inside a definition offers its common child blocks (`option
  block`). Each skeleton is the shape the game's own files write most: keys
  present in at least half of the vanilla definitions, in their usual order,
  with the most written value or number pre-filled as a tabstop. `Insert
  Snippet…` (Ctrl+Alt+I, palette, Project panel) lists the skeletons and the
  engine's own block examples that fit the cursor. Bare LSP clients get the
  same items as plain text.
- **Every creator says where it saves, and numbers drag on their label.** The
  top bar of each creator reads `Saves to <mod> › <folder>/<file>` from the
  moment the form loads, and clicking it changes the target before the save.
  The generated script is an ordinary section, open by default, copied by a
  click on it or by the copy button beside Save. A number field drags on its
  label, so the input is only for typing. The Open menu lists the game's own
  definitions next to the mod's, marked by source.
- **Coat of Arms Designer: one door, six tiers, no freeze, many emblems at
  once.** The dashboard offers the designer once, under Create. House and
  dynasty frames are sprite sheets of six tiers; the preview draws one cell
  (tier 2 by default) with a tier picker beside the frame picker. Textures
  decode on worker threads: opening the designer on a large mod used to stall
  the extension host for 1.7 s, now the longest stall is 9 ms. Shift-click
  and Ctrl+A select several emblems, a layer can be locked, a selection moves,
  scales and rotates as one box, aligns and distributes, mirrors, duplicates
  and nudges with the arrow keys; a grid with centre lines snaps positions,
  and X and Y scale stay matched by default.
- **Trait Creator: the preview prints what the game prints.** The category
  frame sits under the picture (the frame textures are opaque in the centre),
  the picture is the tooltip's 52 px, every opinion key prints through the
  game's own sentences, modifiers the game hides from players (`hidden = yes`
  in the format files, the `ai_*` family) sit in their own group, and every
  key `_traits.info` documents has a control, so a loaded vanilla trait round
  trips with nothing left as raw script. Every field, dropdown and script area
  shows a real vanilla value as its placeholder.
- **Culture Creator: pillars, ethos and traditions as the culture window
  draws them.** Pillar icons are tinted the way `icon_flat_standard` tints
  them (an additive pass of the game's colour sheet), the ethos is the wide
  banner behind the rough-edge mask, tradition tiles keep the window's 276:138
  shape, and the preview panel starts wider. A tradition chip opens the
  Tradition Creator on that tradition, and New tradition opens it blank.
- **Tradition Creator.** A creator for `common/culture/traditions`: name and
  description, category, an icon composed from the game's own layer folders
  with a picker per layer and a live preview, cost, parameters as switches
  with their tooltip sentences, modifier blocks with the player's lines,
  conditions as script with real examples. Keys are written in the order the
  game writes them; the output passes ck3-tiger clean. The icon section shows
  the composed tile at the game's 220x120 from full-size decodes of the chosen
  layers (picker thumbnails stay small), an empty layer reads as an empty slot,
  the cost prints as the game's `<CURRENCY>_COST` line with its icon, and the
  tooltip tones `#P`, `#N` and `#V` text the way the game does.
- **Dynasty Legacy Creator without script.** `is_shown` and a perk's
  `can_be_picked` are rows over the DLC features, game rules and scripted
  triggers the game files use; `ai_chance` is a number; a perk's `effect` is
  built from tooltip lines, modifiers and flags, or copied from a game perk as
  a starting point, with raw script kept as the advanced fallback that round
  trips unchanged. The game's own tracks open for Duplicate or Override, both
  save targets are visible, and Escape closes the perk panel.
- **Dynasty Tree: dates in the mod's calendar, traits with faces.** Born and
  Died are era, year, month and day controls driven by `px.calendar` (custom
  months and eras included; "31 Third Moon 1000 BC" writes `1000.3.31`), and
  the cards show the display year. The trait picker is wide, shows the
  player's name with the id as hint, carries the trait's picture, and hovering
  a trait shows the game's tooltip. A character's DNA has copy and paste, the
  six skills are editable, and the panel says which history file it writes.
- **The content creators are rebuilt for people who do not script.** Every
  value the toolkit's index knows is a picker (traits, pillars, traditions,
  name lists, modifiers, doctrines, houses, parents), every empty input shows
  the value the game itself writes most as its placeholder, labels no longer
  run into their inputs, and each creator shows the result the way the game
  draws it, from the game's own art and text through the indexed game and
  mod folders: the Trait Creator previews the trait's tooltip (framed icon,
  skill and modifier lines printed by the game's own format rules, opposites,
  flags); the Dynasty Legacy Creator shows the track as the game's legacy row
  with its five perk tiles, a perk's tooltip on hover and a perk editor beside
  it; the Culture Creator previews the culture window header with the pillar
  icons and the layered tradition icons; the Dynasty Tree lays a dynasty out
  as a family tree (couples side by side under a marriage bar, children
  centered under their own marriage, orthogonal lines) with an editor of
  pickers and Add child / Add spouse on every card.
- **A Coat of Arms Designer for Crusader Kings III that works like the game's
  own.** Background, Layout and Emblems tabs; the game's pattern list, color
  palette, emblem catalog by category and preset layouts, read from the
  designer's own data files; a detail edit with position, scale, rotation,
  flip and depth; the dynasty, house and title frames drawn around the arms
  the way the game insets them; Start From Scratch, Adjust Existing Design
  (any game or mod definition), Randomize, copy and paste as script. The
  Flag Builder stays as it was for the other games. Instance `depth` is read
  and written back.
- **Modifiers print as the player reads them.** A new `paradox/modifierFormats`
  request carries the game's own format rules (decimals, percent, prefix and
  suffix text and icons, color) and loc names, so a creator's preview prints
  `+2 Martial` with the skill icon rather than `martial = 2`.
- **GUI editor texture cache evicts the right file.** A decoded texture
  from an earlier session could carry a write time a fraction ahead of the
  clock the cache starts from, so it was never the oldest and the budget
  overshot. The clock now starts past every file on disk.
- **Paradox: Move Mod is back, as a command.** It converts a mod between
  the game folder layout and the mod projects layout in either direction
  and carries the Workshop listing with it: `.px-toolkit/workshop` inside
  the mod becomes the project's sibling `workshop` folder and back, so the
  panel finds it with no setting change. Copy, verify, swap the workspace
  folder, then retire the source; a folder Windows will not release is
  renamed `.moved-<time>` or named in a toast, never lost.
- **Required DLC comes from the game files.** The Requirements card shows
  the DLC the install ships (`game/dlc/*/*.dlc`) as a grid of their own
  icons; hover names one, click requires it. Chapters and the Subscription
  never appear because the game does not ship them as DLC. Steam is only
  asked when the game path gives nothing. Required Workshop items that are
  not installed show their title and id after a Steam lookup.
- **A changelog system.** The changenote menu finds an existing changelog
  (a `changelog` folder, `CHANGELOG.md` or `.txt`, in the listing folder or
  the mod root) and takes it with one click, tells you when there is no
  entry for the current version, and creates `changelog/<version>.md` for
  you, seeded from the last commit. Nothing is written on a plain open.
- **Publish parts are switches.** Mod files, Details, Translations (all,
  and one per language) and Changenote each have their own toggle; a part
  that is off is dimmed and marked Not uploaded. Enable all asks first.
- **Workshop panel polish.** Item stats stay on one row. Upload and
  download progress sits in the toolbar and never moves the cards. Preview
  reordering is pointer driven, with the tile lifting and the others
  sliding aside, no browser ghost image. The Installed picker is wider and
  leads with titles. The Previews card has help on formats, the 1 MB limit
  and ordering. Preview images load again when the listing folder sits
  outside the mod.
- **The Workshop panel fits a sidebar-open window.** One column until both
  columns get real room, two columns from about 1160px, and a centered cap
  on very wide panes. Labels sit above their fields. The folder-change
  control is gone; an info tip on Files names the folder and the
  `px.workshop.dir` setting that moves it.
- **The Wiki is a hub.** Its front page is a set of cards that lead to the
  Examples Wiki, Format Docs, Image Guidelines, Credits, and two new wiki
  subpages: Diagnostics (every code with its severity) and Mod Report. The
  Mod Report row leaves the Project panel's Info group; the report itself
  is unchanged.
- **Tree views get actions.** Dependencies: Show for Cursor, Clear, an info
  note, and per row Show Dependencies of This, Find All References and Copy
  Name. Problems by Type: Open Problems Panel, Clear Game Problems, and per
  code row Explain Code (opens its wiki page) and Suppress Code (adds it to
  the ignore setting after a confirm), plus Reveal in Explorer and Next
  Problem on file rows.
- **Credits link people too.** An author with a public profile is a link,
  and long license chips wrap inside their card instead of overflowing it.
- **Smaller fixes.** The Examples Wiki search tooltip is one short sentence
  (the full provenance stays below the box, with its stray double period
  gone), and the Flag Builder's footer padding sits on the text, not the
  box, so text and icons share one inset.
- **Visual content creators (CK3).** The Project panel's Create group lists the
  creators the active game has, and each row opens a form over the game's own
  documented keys instead of a blank file. They share one host side: you pick
  the mod and the file, a file name that would replace a whole game file is
  refused, the whole save lands as one undo step, and the display names go
  through the normal localization writer. Opening something you already have
  loads it and writes back only the lines you changed, so the comments, the
  formatting and everything no field can stand for survive. None of them
  validates your script; ck3-tiger stays the validator.
- **Trait Creator.** The 60 keys the game documents for a trait, each with the
  game's own one-line explanation, laid out in sections, plus the two loc
  values and a grid of the trait icons your game and your mods actually have.
  A new trait saves with only a name typed. Custom image converts a PNG into
  the mod under the trait's name.
- **Dynasty Legacy Creator.** A legacy track and its perks designed together
  and written as the track's block, one perk block per card with
  `legacy = <track>` filled in for you, and the localization. Type the track's
  key and everything else follows it, into five perk slots because that is what
  every vanilla track has. Perk cards carry the seven keys the game documents:
  modifier rows for `character_modifier`, `doctrine_character_modifier` and the
  trait chances in `traits`, text areas for `effect`, `can_be_picked` and
  `ai_chance`. A perk you drop off a track is reported, never deleted behind
  your back.
- **Culture Creator.** A culture composed out of the game's own parts: the five
  pillars as one picker each (the pillars all live in one folder, so the server
  labels each with the family its own block declares), the traditions as
  searchable chips with the game's description on every entry, a name list, the
  art sets and ethnicities with the values the game itself writes for them, a
  color as a named color or a picked one, and parents plus a creation date for a
  hybrid or divergent culture. Every other key the game documents is still
  there, as raw script. Your own culture is rewritten in place; a game culture
  is duplicated into your mod by default, or overridden with a warning.
  Round-trips two vanilla cultures byte for byte, and ck3-tiger finds no problem
  in what it writes.
- **Dynasty Tree.** Any dynasty of the game or your mod as a family tree:
  generations top down, spouses side by side, siblings oldest first, houses as a
  badge, and vanilla characters drawn apart from your own. Clicking a node opens
  an inspector that edits your characters and adds a child or a spouse to
  anyone, vanilla included; the new character is written into your mod pointing
  at the one it descends from. New dynasty, New house and a Design coat of arms
  button that hands the id to the Flag Builder round it out.
- **The Flag Builder opens for Crusader Kings III.** `Paradox: Open Flag
  Builder` and `Paradox: New Coat of Arms…` now work in a CK3 workspace, which
  is where the dynasty, house, landed-title and character targets belong.
  Measured against 1.19.0.6: the parser reads all 2992 vanilla coat-of-arms
  definitions with no parse errors, and every one of the 7800 texture
  references and 15327 colors resolves. Instance `depth`, which only CK3
  writes (387 instances in 234 flags), is not read, so a preview of one of
  those flags can stack its emblems in file order instead.
- **New Coat of Arms…** A Create row and a `Paradox: New Coat of Arms…`
  command ask what the arms are for (a dynasty, a house, a landed title, a
  character, or a key you type), list the mod's own definitions of that kind,
  and open the Flag Builder on the key the game reads the arms under. A
  character has no coa key of their own, so the pick resolves to their house
  and falls back to their dynasty. `px.openFlagBuilder` now takes an optional
  `{ name, label }` argument, so any panel can hand the builder its target.

- **The Workshop panel uses the width it has.** Two columns of cards: Item and
  Publish first, then Previews and Requirements; the description and the
  translations follow at full width. A step strip under the toolbar
  names each stage of an upload or download and shows the percent of the one
  in flight.
- **Download picks its parts.** The toolbar's download button now asks which
  parts to write, the same list as Publish plus the preview image: details
  into item.json (title, tags, visibility), the description, translations,
  the gallery images and videos, the requirements, the main preview image.
- **Previews reorder by drag and drop.** The order is saved to
  `previews/order.txt`; files not listed follow by name.
- **Translations moved into `translations/`.** The listing folder keeps
  `description.bbcode`, `item.json` and `dependencies.json` at
  its root; each language lives in `translations/<language>/`. Old root
  language folders are still read and move on the next save.
- **Required DLC and required items in the Workshop panel.** A Requirements
  section lists the game's DLC as Steam reports it (unowned ones marked) and
  the required Workshop items, with installed mods and declared dependencies
  offered first. Choices are saved to `dependencies.json` next to the listing
  and applied to the item after each details upload; pulling the listing
  writes Steam's current requirements down.
- **Extra preview images and videos.** A `previews/` folder next to the
  listing holds the gallery: images in file-name order plus `videos.txt` with
  YouTube ids. While the folder exists a details upload replaces the item's
  gallery with it; without it Steam's gallery is left alone. Add images from
  the panel or drop files into the folder.
- **Pre-upload checks.** The Publish section lists what would go wrong before
  anything reaches Steam: a missing or overlong title, a description over
  8000 bytes, a preview of 1 MB or more (these block the upload), and a
  missing preview, empty description, no tags or a supported game version
  that does not cover the installed game (these only warn).
- **Version stamps on the item.** Every details upload sets the mod version,
  supported game version and game as key/value tags and metadata on the
  Workshop item. Not visible on the page; tools can compare listings without
  downloading them.
- **One config folder per mod: `.px-toolkit/`.** It replaces the per-game
  `.ck3modding/`, `.vic3modding/` and `.eu5modding/` folders for the schema and
  playset overlays, the tiger baseline, the GUI preview values and the
  Workshop record. Existing folders keep working and are renamed the first time
  the toolkit writes to them.
- **The Workshop listing lives inside the mod by default.** `px.workshop.dir`
  now defaults to `.px-toolkit/workshop`; a `workshop` folder next to the mod
  (the mod-projects layout) is still picked up when it exists. Description and
  translation drafts always go to that folder; `workshop.json` keeps only ids.
- **`.pxignore` decides what a toolkit upload leaves out.** gitignore syntax
  at the mod root, created with defaults (`.git/`, `.vscode/`, `.claude/`,
  `node_modules/`, image sources, OS noise) on the first upload through the
  toolkit, then yours to edit. `.pxignore` and `.px-toolkit/` never upload;
  `descriptor.mod` and `.metadata/` always do. A one-time message says why the
  exclusions only hold for toolkit uploads: the Paradox launcher ships the
  whole folder.
- **New Content uses the toolkit's kind glyphs.** The picker draws each kind
  with the same icon hovers, completion and the tree use for it.
- **Workshop errors and the upload result open as dialogs**, so the full Steam
  advice is readable instead of folded into a toast. The upload dialog links
  the item page, in the Steam client (`steam://`) or the browser.
- **Move Workshop Listing** (command palette) moves the listing folder between
  the two layouts, `<project>/workshop` and `<mod>/.px-toolkit/workshop`, in
  either direction. A mod that only has `workshop.json` drafts gets its
  listing files created at the target. An explicit `px.workshop.dir` is
  cleared, since both places are what the empty default resolves to.
- **New Mod offers the in-mod layout first.** The game's mod folder with
  `.px-toolkit/workshop/` and `.pxignore` inside is the default; the mod
  projects layout stays available.
- **Credits panel.** A new Credits view lists every upstream project the
  toolkit builds on, what each one is used for, its license and a link to
  its home. Open it from the Project panel's Info group or from the command
  palette ("Paradox: Credits").
- **The Flag Builder credits its origin.** The stage's bottom-right corner
  reads "Ported from PDX Flag Editor by Chris Kaiser" and opens the original
  project on GitHub; the file origin moved to the left, next to the zoom.
- **Event graph: Connected only, on by default.** A rail tool leaves out every
  event nothing fires and that fires nothing. The server drops them before it
  reads their cards, so a mod with hundreds of standalone events opens faster.
  Turn it off to see the whole namespace; the queried event always stays.
- **Coat of Arms Designer: two panels, a finer grid and a library of your own
  designs.** What a design is (pattern, layout, emblems) stays on the right;
  what you do to it (the library, the preview frame, the grid and the whole
  placement section) moved to a new left panel, so the numbers stay on screen
  whichever tab is up and neither column can squeeze the arms under 320 px.
  The grid is on at 16 x 16 out of the box and goes to 64; an arrow key now
  moves one grid cell and Shift four, or 1/256 and 1/32 of the arms with the
  grid off, instead of a quarter of the arms. Export stores the design as a
  script file in a library folder outside any mod (`px.coaLibraryDir`,
  `Documents/Paradox Interactive/<game>/px-toolkit/coat_of_arms` by default)
  holding exactly what Copy puts on the clipboard; Import shows what is stored
  as pictures and loads the one you pick. Randomize is gone.

## 0.3.6 (beta, pre-release) - Workshop safety fix

- **"Link existing item" is gone from the Workshop panel.** The button let a
  mod that was not on the Workshop yet be pointed at any of your published
  items, and the next upload then overwrote that item's files and details.
  One wrong pick in the list, or a pick made on the wrong mod, replaced a
  published mod with content that was never meant for it, and a Workshop
  update reaches subscribers in minutes with no rollback. An upload from the
  panel now only ever creates a new item or updates the item the mod is
  already tied to. Mods first published through the launcher are still
  adoptable by hand, by writing the item id where the game's own tooling
  keeps it: `remote_file_id` in `descriptor.mod` for CK3, `publishedFileId`
  in `workshop.json` for the newer games.
## 0.4.0 (beta) - the Steam Workshop release

Everything below ships early in the 0.3.5 pre-release; 0.4.0 is the
release these notes belong to.

- **One hover card design, with a wiki link on every card.** All hover types
  (script tokens, keywords, scope words, datafunctions, GUI, localization
  formats, textures) now render through one card anatomy with a shared
  footer, and every card whose subject has an Examples Wiki article carries
  an "Examples Wiki" link there. Keywords like `NOT` and scope words like
  `root` got wiki articles of their own (sourced from the same doc table the
  hovers read, with a Keywords filter chip), so their hovers link too. The
  useless "Scope here: unknown" line is gone.

- **The Examples Wiki navigates like a browser.** Back AND forward, sitting
  right of the search box, with Alt+Left/Alt+Right and the mouse's own
  back/forward side buttons. Navigating from a mid-history point truncates
  the forward trail, exactly like a browser tab. Example-site rows also got
  a short tooltip ("Click to open in side panel") instead of the full file
  path, and the catalog rows are vertically centered.

- **An Info group in the Project panel.** Join the Discord, Wiki and
  Examples Wiki now live in their own group below Create (moved out of the
  View group and the footer).

- **Toolkit settings open in the main window.** On VS Code builds where the
  new modal editor experiment is on, opening the toolkit settings from the
  Project panel landed in a modal; it now moves itself to a normal editor
  tab, keeping the settings filter.

- **Short tooltips, and a "?" that explains everything.** Every webview
  tooltip was rewritten to one short line (two at most, with a hard width
  cap), and every webview now has a question-mark button at the top right
  opening a structured help dialog: what the view is, its features in
  scannable rows, and its keyboard shortcuts in a grid. The Project panel,
  both wikis, the Workshop panel, Simulate Event and the GUI Widget Tree got
  their first help dialogs; the event graph, GUI editor and flag builder
  ones were restructured and caught up with their newer features.

- **Tooltips stay readable.** Custom tooltips in every toolkit webview
  (Project panel, wikis, event graph, GUI editor, Workshop and the rest) now
  measure themselves and flip or shift to stay inside the panel instead of
  running off the edge.

- **Your variables joined the Examples Wiki.** Every variable and list the
  index knows (`set_variable`, `add_to_list`, the local and global forms) now
  has its own wiki article: inferred value type, where it is set and read,
  and the containing definitions - with a Variables filter chip in the
  catalog. Hovering `var:x` (and friends) shows an "Examples Wiki" link next
  to the references count that opens the wiki right at that article.

- **The Examples Wiki draws the real kind glyphs.** Catalog rows and article
  badges show the same codicon pictures as hovers, completion and
  breadcrumbs (generated from VS Code's own codicon set at build time), so
  the newly split list icons are visible in the wiki too. A "Code" toggle at
  the top right collapses example sites to one clickable line when you want
  density over context; the choice persists, default is show.

- **Scope browsing in the Examples Wiki.** An article that produces a scope
  (the `faith` event target and friends) now lists every trigger, effect and
  event target the game's own docs declare usable from that scope, ordered
  by vanilla usage, as clickable chips. Community-requested: "what can I do
  from faith?" is now one click from the faith article.

- **The Examples Wiki reads like a wiki now.** Example sites show real code:
  a few surrounding lines inline, with the matched line highlighted, still
  one click from the actual file. Member, producer, return-type, owner and
  scope chips navigate to their own articles, with a back button for the
  trail. The divider between the list and the reading pane drags, and the
  width you choose survives closing the panel.

- **The Wiki.** A new "Wiki" row in the Project panel's View group opens a
  hub for reference knowledge: the Image Guidelines as their own page, every
  diagnostic code's explanation page, and launchers for the Examples Wiki and
  the Format Docs - all searchable by title and body text. The Format Docs
  and Image Guidelines footer buttons moved into it; the commands still exist
  in the palette, and "Paradox: Image Guidelines" now opens the hub at that
  page.

- **Breadcrumbs draw the same glyphs as everything else.** The breadcrumb
  bar, outline and Ctrl+T symbol search now take their icons from the same
  kind map as hover badges and completion rows, so an event shows the class
  glyph everywhere instead of a lightning bolt only in the breadcrumb. The
  four list kinds also stopped sharing one icon: ad-hoc `add_to_list` lists
  show an array, `variable_list` keeps the enum-member glyph,
  `local_variable_list` a plain list and `global_variable_list` a globe.

- **Workshop drafts stop landing inside the mod.** In the mod projects layout
  (`<project>/mod`), saving the listing now creates and uses the
  `<project>/workshop` folder from the first save, instead of writing
  `workshop.json` into the mod's config folder until the workshop folder
  happened to exist. (The file was never uploaded either way.)

- **px.calendar declared in the wrong settings file now says so.** The
  setting is window-scoped, so a calendar in a mod subfolder's own
  `.vscode/settings.json` is ignored by VS Code and the date preview
  silently stayed off. The toolkit now warns once per workspace when it finds
  such a stray calendar, with a button that adopts it into the opened
  folder's settings. The setting's description spells out where it must
  live.

- **Toolkit development: webview live reload.** The new `px.dev.webviewSource`
  setting (empty by default, off for everyone else) points an installed test
  build at a toolkit checkout's webview bundles; panels then reload themselves
  when `pnpm run watch:webviews` rebuilds one. The F5 dev host does the same
  with no setting.

- **The Examples Wiki.** "Paradox: Show Examples Wiki" (also a Project-panel
  row) opens a searchable browser over everything the toolkit knows from your
  game: triggers, effects, event targets, modifiers, datafunctions and data
  types, ranked by how often vanilla actually uses them. Type to filter, pick
  a kind, and the reading pane shows the full description, the engine's own
  usage block, observed arguments and clickable vanilla example sites that
  open the real file. Hover hints explain the kind and scope words, so new
  modders learn what a "promote" or "scope: character" means as they browse.

- **`[ ... ]` datafunction hovers joined the card design.** `GetPlayer` and
  friends now open with the same colored kind badge as script and GUI hovers
  (blue for stored values, purple for functions, orange for data types), the
  return type on the head line, and the description, observed arguments and
  vanilla examples in the same card layout as everywhere else. Long example
  bodies no longer fold out inside the hover: the accordion never read well in
  a widget that closes when the pointer leaves, so hovers now say how many
  more lines exist and the full text lives in the Examples Wiki.

- **The Workshop listing as files.** The panel now reads and writes the
  listing from a `workshop` folder next to the mod's content folder (the
  `<project>/mod` + `<project>/workshop` layout; `px.workshop.dir` moves it,
  relative to the mod or absolute): `description.bbcode`, one
  `<language>/title.txt` + `description.bbcode` pair per translation, and
  `item.json` - the same layout the shared Workshop CI expects, so the
  listing diffs and versions like code. While the folder exists it is the
  canonical store; without it drafts stay in `workshop.json` as before. A new
  toolbar button downloads the live listing from Steam into those files (every
  translated language detected in one query); its tooltip and its
  confirmation dialog both spell out exactly which files are overwritten and
  that unuploaded local text is lost. The upload never ships the folder, even
  when it sits inside the mod.

- **New Mod, and the mod projects layout.** "Paradox: New Mod" (also a
  Project-panel row) creates a mod with its descriptor - recommended into a
  mod projects folder (`px.modProjectsDir`, asked for on first use): the mod
  content lives in `<project>/mod`, so git history, notes and the Workshop
  listing files sit next to the mod instead of inside the upload. The game
  still finds the mod through a link in its own mod folder - a `<name>.mod`
  path file for the `.mod`-descriptor games, a folder link for the metadata
  games. Setup & Health Check now recommends picking a projects folder, and
  the mod walkthrough page mentions the layout.

- **The Mod Report is a page, not a markdown preview.** It opens in its own
  panel styled like the rest of the toolkit, from a new button in the Mod
  Overview view's title bar (next to Show Event Graph) as well as the
  command palette and the Project panel. The image guidelines
  ("Paradox: Show Image Guidelines") open the same way.

- **The Project panel shows the paths in use.** A Paths section (at the
  bottom of the panel) lists the effective game folder, script_docs logs, mod
  folder, mod projects folder, Workshop listing folder and tiger binary, each with its origin (set,
  detected, downloaded, not found) - the answer the settings UI cannot give,
  since an auto-detected value just looks like an empty setting there.
  Clicking a row opens a file browser and writes the picked folder (or tiger
  binary) straight into the setting.

- **The Project panel reorganized.** The Tools wrapper is gone; its groups
  are top-level collapsible sections of their own: Create, View, Test &
  Troubleshoot, Share - followed by Toggles and Paths. The reference links
  became quiet footer buttons under Join the Discord, and the translation
  launchers moved to the Localization Coverage view's title bar, next to the
  numbers they act on. The game header opens the same Workspace-scoped
  extension settings view as the overflow menu.

- **Warning before a workshop folder lands among the game's mods.** Creating
  the listing folder (the panel's download button) now warns first when it
  would land inside the game's Documents mod folder: every mod living there
  resolves the default `px.workshop.dir` to the same `mod/workshop`, so
  listings would overwrite each other. The dialog recommends the mod projects
  layout or pointing `px.workshop.dir` elsewhere.

- **Extension Settings in the Project panel menu.** The panel's overflow menu
  opens the extension's settings as a normal editor tab with the Workspace
  scope selected (the px paths and toggles are per-project taste), listed
  above Customize Project Panel Rows. Also `Paradox: Extension Settings` in
  the palette.

- **Descriptions preview like the Workshop page.** An Edit | Preview toggle
  on the description (and on every translation) renders the draft's BBCode -
  headings, lists, links, quotes, code, tables, spoilers, images - styled
  after the Workshop. Everything is escaped and only http(s) links render, so
  the preview is safe against whatever the text holds.

- **BBCode is a language now.** `.bbcode` files get syntax highlighting
  (tags, parameters, headings, bold/italic/underline/strike content, code and
  noparse blocks, bare links) plus bracket matching and auto-closing - the
  listing files edit like source.

- **The whole listing is editable in the panel.** The title, the mod's
  version and the supported game version write straight into the descriptor
  (or metadata.json); tags are chips with add/remove; the preview image has a
  Change button that copies the picked file into the mod as
  `thumbnail.<ext>`. Translated titles were already editable per language.

- **Changenotes come from the changelog.** The changenote box prefers the
  entry that matches the descriptor's version: a `1.2.md`/`v1.2.bbcode` file
  in the workshop folder's `changelog` directory, or the `## 1.2` section of
  one big changelog file (`px.workshop.changelog` points anywhere else, a
  folder or a single file). Markdown converts to Steam BBCode on the way; a
  button re-inserts the resolved entry, and the git-subject suggestion stays
  as the fallback.

- **Workshop feedback moved out of the panel.** Every result - upload done,
  upload failed, listing pulled, preview skipped - arrives as a normal
  VS Code notification and a line in the output channel, so it reaches you
  even after you switch away from the Workshop tab, and errors stay
  readable instead of fading like the old in-panel toasts (which are gone).
  Steam's raw codes are rewritten as advice: `k_EResultLimitExceeded` points
  at the preview image or the Steam Cloud quota,
  `k_EResultAccessDenied` at the logged-in account not owning the game or
  the item, and about thirty codes in all say what to do next. The
  Steamworks operation and code stay in parentheses, so a support thread
  still has the exact failure. A value Steam refuses outright is named
  ("Steam rejected the preview image") instead of surfacing as a bare
  "returned false". An oversized preview image is announced when the upload
  keeps the current one, instead of being dropped in silence.

- **The changenote box explains itself.** A source dropdown under it shows
  where the text came from - "From changelog: 1.2.md", "From last git
  commit", or "Manual" once you type - and switches between them; the
  changelog entry that could not be found says which path and version it
  looked for. A ? beside the box documents the whole system (folder of
  per-version files or one big file cut at the version headline,
  `px.workshop.changelog`, Markdown-to-BBCode).

- **Translation uploads work for real: the bridge switched to
  steamwand.js.** The native binding under the Steam child process is now
  steamwand.js (koffi FFI) instead of steamworks.js. It carries both
  per-language *queries* - the "on Steam" hints under each translation show
  genuinely translated text - and per-language *updates*
  (`SetItemUpdateLanguage`), so uploading a translation needs no capability
  gate any more; the old gate that probed the bundled build's type
  declarations is gone. A missing symbol fails the job loudly instead of
  silently overwriting the default-language text.

- **Panel polish from the first field round**: the download button's tooltip
  wraps instead of spanning the screen; "Mod version" and "Game version" say
  what they are, the game version sits flush right, and lowering either one
  asks first (a downgrade is usually a typo). Tags are added from the
  launcher's tag list (custom stays possible); a subtle mark on the thumbnail
  states the recommended format (square, 512x512+, under 1 MB); translations
  start collapsed. The Files row grew a settings shortcut to
  `px.workshop.dir` / `px.workshop.changelog`, the description and every
  translation have an "open file" button (plus a Reload that re-reads the
  local files), and editing item fields no longer re-queries Steam - one
  query per mod, plus the refresh button.

- **`.bbcode` editing got real**: tag completion with snippets (`[`, and
  closers after `[/`), word-suggestion noise off, a blue `BB` file icon, and
  a live preview exactly like markdown's - two editor-title buttons open it
  to the side (Ctrl+K V) or in place (Ctrl+Shift+V), the preview tab carries
  its own eye icon, and its title button jumps back to the source. All of it
  shares the Workshop panel's renderer.

- **Uploading confirms first.** The Upload button opens a dialog that
  re-offers the three parts (mod files, details, translations) - so dropping
  the mod files while keeping a description fix is one uncheck away - shows
  the changenote and visibility that ride along, and says plainly that a
  Workshop update reaches subscribers in minutes, has no rollback, and
  nothing overwritten can be recovered. The wider mod dropdown in the toolbar
  no longer squeezes long mod names into two cramped lines.

- **A way to reach the people behind the toolkit.** A quiet "Join the
  Discord" link sits at the bottom of the Project panel, and
  `Paradox: Join the Discord` does the same from the command palette. The
  server carries release notes, bug reports and modding help.

- **A Steam Workshop panel** (`Paradox: Open Steam Workshop Panel`, also in
  the Project panel's Share group): the mod's Workshop item on one page,
  through the running Steam client. It shows the live item next to what the
  mod says - title from the descriptor, preview image, tags, created/updated
  dates - plus the item's statistics (subscribers, favorites, page visits,
  votes, comments). From the panel you can:
  - **edit the description** in Steam's BBCode, saved locally to
    `<configDir>/workshop.json` as you type and uploaded on demand, with
    "Fetch from Steam" to pull the live text down;
  - **set the visibility** (private, friends only, unlisted, public) without
    visiting the Workshop page;
  - **draft translations** of the item's title and description per Steam
    language (the mod's own localization folders are suggested first) and
    upload them all in one go - one Steam submit per language, no changenote
    spam;
  - **upload selectively**: mod files, details and translations are separate
    toggles, so a description fix does not re-upload gigabytes of content;
  - **link an existing Workshop item**: pick from your published items (for
    mods first uploaded through the launcher) and the id lands in
    `remote_file_id` / `workshop.json` without a new item being created.
  The panel is the ONLY place uploads happen - every publish goes through
  its confirmation, so nothing reaches Steam from a stray button press.

- **Publish to the Steam Workshop from the editor.** The panel's Upload
  creates or updates the focused mod's Workshop item through the running
  Steam client's own UGC API - no Paradox launcher, no credentials, live
  upload progress. New items start **private**; the descriptor's name and
  tags become the item's title and tags, `thumbnail.png` (or the
  descriptor's `picture=`) becomes the preview image, and the changenote is
  prefilled from the changelog or the mod's last git commit. On first
  publish the Workshop id is written back where the game's tooling expects
  it: `remote_file_id` in `descriptor.mod` (CK3), `<configDir>/workshop.json`
  for `.metadata` games. `Paradox: Open Steam Workshop Page` jumps to the item;
  both live in the Project panel's new Share group. The native Steamworks
  binding runs in a separate child process, so Steam trouble can never take
  the extension down. Steam shows you in-game for the seconds an upload takes;
  that is how the API authorizes without credentials.

- **Custom calendar display (`px.calendar`).** Total-conversion mods (AGoT,
  LotR, Hegemonia...) keep script dates on the engine's year axis but show
  their own eras in game. Declare the mapping once in the workspace settings
  (`{ "epoch": 4000, "after": "AD", "before": "BC" }`, optional custom
  `months` with their own names and day counts) and the toolkit shows the
  in-game form everywhere: inlay hints after every date in script files
  (`3000.1.1` reads `1000 BC`), a hover card with the full converted date,
  and a `Paradox: Insert Date` command that takes the date as displayed
  ("1000 BC March 15") and inserts the script date the game logic needs
  (`3000.3.15`), with a live preview before anything is committed. Display
  only: no existing date is ever rewritten.
- **`Paradox: Generate Calendar Localization`.** Writes the GAME side of the
  `px.calendar` declaration into the mod: the era-math datafunction keys plus
  the `localization/replace/` overrides of the engine's date-format keys (and,
  with custom `months`, the `CW_DATE_*` month names), so in-game dates display
  on the mod's calendar. Key names verified against the game files and binary;
  CK3 for now. Deterministic filenames: rerun after changing `px.calendar` to
  regenerate in place.
- **Run configurations for the game (issue #26).** Launching now lives in
  ONE place: the Run button on script and gui files, whose dropdown offers
  Launch Game (debug mode), Launch Map Editor and Launch with Options (a
  quick pick of every preset plus a free-form option box); the panel's
  launch row is gone. Behind it sits a `paradox-game` run type: F5 starts
  the workspace's game via Steam, the Run and Debug panel lists the per-game
  presets - debug mode, Map Editor, Continue Last Save, CK3's Skip to 1066
  Lobby and Benchmark, vanilla - and launch.json snippets (`-play=<title>`,
  `-random_seed=<n>`, custom option sets) make your own sets permanent.
  Every preset flag is verified in the game's own binary.
- **Server 0.2.0: block templates in completion, capability-honest output
  for embedders.** Engine tokens with a qualifying `script_docs` `usage:`
  example (679 in CK3, 265 in Vic3) and block-opening schema keys (~700 in
  CK3) now complete as filled-in block snippets, in VS Code and everywhere
  else. For bare LSP clients the server stops sending what they cannot use:
  `${…}` snippets are gated on the standard `snippetSupport` capability, and
  hovers drop unclickable reference counts and unnavigable `file:` links.
  Details in `packages/server/CHANGELOG.md` and
  `packages/protocol/CHANGELOG.md` (0.1.1).

- **Security: third-party mod content can no longer point file operations
  outside the mod.** A downloaded mod's files used to be able to steer paths
  with `../` or absolute segments; every such spot now refuses anything that
  escapes its root: the descriptor's `picture=` (which the Workshop upload
  ships as the preview image) must be a bare file name, GUI/event-graph
  texture references resolve strictly inside the mod/game roots (and
  non-image files are never read at all), the tiger download refuses release
  tags and asset names that are not plain file names, event-graph saves only
  write inside the mod or workspace, the Flag Builder validates the webview's
  file and texture-kind fields like it already validated typed names, and
  schema overlay paths that climb out of the mod are ignored (server 0.3.0).
  CI/release workflows now pin third-party actions to commit SHAs, and a
  `brace-expansion` DoS advisory (GHSA in the vsce toolchain) is patched in
  the lockfile.

## 0.3.4 (beta, pre-release) - the large-workspace round

### Fixed

- **A large workspace opens in half the time and holds 229 MB less.** Measured
  on a real field report: a `.code-workspace` with the CK3 install and 5
  Workshop mods, all indexed, nothing excluded. 87,250 files, 29,641 of them
  script, 1,304,861 definitions and 7,553,947 references.

  The scan reads file batches with 16 reads in flight, but every read runs on
  libuv's thread pool, which defaults to four. Four outstanding disk requests
  is not enough to keep a drive busy, and a cold index build waits on latency
  rather than bandwidth. The forked server now gets a pool of 16. With the
  page cache evicted between runs, time to indexed went **142.9 s to 71.8 s**.
  A warm build is a second or two slower, because those reads come from RAM
  and the extra threads only add contention.

  Memory came from three allocation fixes. V8 grows an empty array's backing
  store to 16 slots on the first push, so every name in the definition and
  reference indexes carried 16 slots even though most hold one; both indexes
  are now compacted once when the scan finishes. The schema root-scope `Set`
  was rebuilt per file instead of per schema entry. Five sites built a fresh
  `kinds` array for every reference, and nothing ever mutates one. Post-GC
  heap after the build went **1735 MB to 1506 MB**. That matters more than it
  sounds: this workspace peaked at 4081 MB against the server's 4096 MB
  ceiling, so it was running out of headroom, not out of speed.

  The last of it was plain duplicated work. A mod's script files were read and
  parsed twice, once for definitions over the schema folders and once for
  references over the whole mod, because the two extractors each parsed the
  file themselves. A mod is now walked once and each file parsed once, feeding
  both. Together with the thread pool: **time to indexed 142.9 s to 61.5 s
  cold, and 52.9 s to 44.5 s warm.**

- **A window that has nothing to do with modding no longer indexes the game.**
  The extension activates in every VS Code window, and the game path was
  auto-detected from the Steam library whether or not the workspace held a
  mod. A Rust or web project window therefore forked a server that read the
  36.3 MB vanilla index cache and held 253 MB for it, to answer questions
  nobody could ask: without a mod in the workspace, no file is ever given a
  Paradox language id. Auto-detection now needs a workspace that holds a mod
  or a game install. An explicit `px.gamePath` still works everywhere.

- **The variable-type cache could answer from the previous index.** It was
  keyed on the definition index's revision counter, but a rebuild installs a
  fresh index whose counter restarts at zero. Once the new index counted back
  up to the cached number, one stale map was served. Found while profiling
  the heap, not from a report.

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

### Added

- **Hovers have icons, and the icons mean something.** Kind badges are real
  codicons instead of a coloured square, and the same glyph now appears in the
  completion list and the tree for the same concept. Colour comes with the
  kind, because VS Code paints a completion row from the `CompletionItemKind`
  the server sends and an extension cannot override it, so the four groups are
  the ones the editor already draws: purple asks a question (triggers), orange
  makes it happen (effects, events, decisions, on_actions, traits), blue is
  something you stored (variables, saved scopes, event targets, lists), grey is
  syntax and everything else. This fixed a live defect:
  `trigger` mapped to `CompletionItemKind.Function` and `effect` to `Method`,
  which share one codepoint in the codicon font and take the same colour, so a
  condition and an action, the one distinction in Paradox script that causes
  silent bugs, were drawn identically in the suggest widget.
- **Hovering a scripted trigger or effect shows what it is.** The card now
  carries the definition's own source block, so you do not have to jump to the
  file to see what a mod's `is_human` actually tests. Long bodies open in place
  through a disclosure: only 11% of vanilla scripted triggers are three lines or
  shorter, median 10, longest 232.
- **Hovering a data type says how to obtain one.** The datafunction hover for
  `Story` or `Character` already listed what the type gives you; it now also
  lists what gives you the type, ranked by vanilla usage. `Story` has exactly
  two producers, `Character` has 320.
- **`px.hover.detail`** (`compact` | `standard` | `full`, default `standard`)
  controls how much a hover shows. Nothing is hidden permanently: longer
  examples stay one click away inside the hover.

### Changed

- **Hovers are quieter.** Seven chart colours become the three VS Code uses for
  its own symbols plus plain default, which is what 17 of the 38 mapped kinds
  now render as, so most badges emit no colour markup at all. Scopes, the value
  shape and the traits line merge into one muted facts line. A single-card hover
  writes no footer block: its provenance and reference links ride the scope line
  that has to exist anyway, which is worth three lines on the most common hover
  there is.
- GUI widget types and GUI properties had never been added to the badge colour
  switch, so they fell through to the "definition kinds read green" default and
  a widget type read the same green as a scripted trigger. They now have their
  own entries, as do datafunction data types, promotes and functions, GUI
  templates and enum values, and text format tags. GUI completions read their
  kind from the same map, so a widget type is one picture in the hover and one
  in the suggest widget.
- A texture path shows the picture-frame glyph (`file-media`) in the hover and
  the tree. Its completion row keeps the plain file glyph: no
  `CompletionItemKind` draws `file-media`, and only those 25 values reach the
  suggest widget.
- An `on_action` shows the interface glyph, in the orange of the group it
  belongs to. Its completion row is blue, because the row's colour belongs to
  the kind and `Interface` is blue.

### Fixed

- **Completion no longer offers effects the game removed.** The bundled wiki
  lists were merged into the engine tokens even when your own `script_docs`
  dump was loaded, and that added names your patch does not have. Measured on a
  real install: of 2,336 wiki tokens, 2,262 were already in the dump and 74 were
  not, and the ones sampled from that 74 (`every_activity_invited`,
  `every_participant`, `accept_invitation_for_character`) appear in **zero**
  vanilla files. They are pre-Tours-and-Tournaments activity API. The bundled
  `Effects_list.md` warns about this itself. With your own dump loaded those 74
  are now dropped, since `script_docs` is what the engine actually registered.
  The wiki's real contribution is untouched: all 127 usage examples for tokens
  the dump already had still merge in. Nothing changes when you have no dump of
  your own, because then the bundled snapshot may be older than your game and
  "absent" proves nothing.
- **A `var:` hover showed the same variable twice**: once as a typed card
  listing "set in file:line", then again as the indexed-definition card whose
  provenance links were the same sites. One card now, the definition card,
  which also carries the owning mod, the site count and the references link;
  the value type moves onto its head. The standalone card remains only for a
  variable the index has never seen set.
- **The status bar tooltip listed each load twice and kept saying "…" after it
  finished.** "harvesting engine tokens…" and "engine tokens: 4,624" were the
  same fact on two lines, and the phase row kept its ellipsis once done, so a
  finished load still read as ongoing. Each phase now reports into its own
  value row: `○ harvesting engine tokens…` while it runs, then
  `✓ engine tokens: 4,624 (your script_docs, plus the wiki)`. Loading rows come
  first, configuration after, counts are thousands-separated, and the token
  source says what to do about it when it is the bundled fallback.

- A datafunction promote was drawn as a blue variable when global and a grey
  wrench when it was a member, decided by nothing but which branch of the
  completion builder produced it. Both are blue now: blue is a thing you have,
  purple is a call you make.

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
