# Paradox Modding Toolkit 0.3.1 (beta)

0.3.0 said "three games"; 0.3.1 makes the second one feel like the first.
This release was driven by an audit of the toolkit against a live Victoria 3
install and three real workshop mods (including the Community Mod Framework),
plus the sidebar and hotkey work.

### Victoria 3, actually good now

- **Completion offers the right key.** On 1215 real cursor positions in
  three workshop mods, the correct key was never offered in 77.1% of them
  before, 0.2% after. Vic3 now has a structures layer, scope inference no
  longer assumes a CK3 character root, and 12 reference prefixes resolve 446
  previously dead sites.
- The **GUI editor draws Vic3 files**: declared types preview without an
  instance, and multi-line data functions no longer break the parser (202
  errors across 23 CMF files, gone).
- The **error.log watcher fires**: wrong folder and a CK3-only line parser
  meant it silently never reported anything on Vic3/EU5. In-game script and
  GUI errors are squiggles again.
- The **GUI editor opens** (the Vic3 calibration shipped in 0.3.0; a stale
  gate still refused it).
- **Real mod names** instead of workshop folder ids, everywhere.
- **New Content, Create Mod Descriptor and translation mods** produce content
  Victoria 3 actually loads: `country_event` templates, real vanilla
  on_actions, `.metadata/metadata.json` descriptors with completion and
  validation.
- **129 indexed folders** (naval, mobilization, AI, buy packages, console
  macros, +2186 vanilla definitions) and `.gui` type/template definitions.
- **`Paradox: Add Dependency Mod`** turns "hand-edit px.parentMods" into a
  quick-pick over your declared dependencies and the Steam workshop folder.
  Dependency mods (frameworks like CMF) now feed every completion layer,
  including `data_binding` macros.

### EU5

Everything buildable without owning the game: stage-root aware scaffolds,
metadata descriptors, honest copy, tiger commands hidden (no tiger exists).
The error.log path and launch flags follow the engine convention but are
**not yet verified on a live install**; a data-collection pack is out with a
volunteer and the results land in 0.3.2.

### Panel, hotkeys, icons

- Every tool now has a **row in the Project panel** (new "Open" group), and
  the rows are **customizable** (`Paradox: Customize Project Panel Rows`).
- **Five chords**: Ctrl+Alt+G graph, D format docs, W widget tree, S
  simulate, R mod report. Rebindable; a title-bar button opens the shortcuts
  UI pre-filtered.
- **CK3 script files wear the crown again**; Victoria 3 and EU5 get the PX
  box, and the status bar names the game ("Paradox Script (Victoria 3)").
  Same language, same server, per-game identity.

### Color picker

Every `rgb { }`, `hsv { }`, `hsv360 { }`, `hex { }` and `color = { }` in
script and `.gui` gets a swatch; click it for the native picker, click the
label to cycle formats. Measured against vanilla: Jomini `hsv` hue is 0..1,
not 0..360, which other tools get wrong. Ships over standard LSP, so every
editor gets it. (Closes #11.)

### Full changelog

Every change with its reasoning:
[CHANGELOG.md](https://github.com/JDeffner/paradox-modding-toolkit/blob/main/packages/vscode/CHANGELOG.md).

Beta means young, not unusable. Tell me what breaks:
[issues](https://github.com/JDeffner/paradox-modding-toolkit/issues).
