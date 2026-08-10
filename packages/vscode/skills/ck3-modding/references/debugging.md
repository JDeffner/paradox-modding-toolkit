# Debugging, graphics, tooling

(For GUI-specific debugging including the test-window feedback loop, see `gui.md`.
For static validation with ck3-tiger, see `validation.md`.)

## Debugging workflow (do this every time)

Division of labor: the **user** launches the game and runs console commands; **you** read and
analyze the resulting logs directly from `<logs>` (see SKILL.md Step 0). Full table in SKILL.md
"Game logs". **Check LastWriteTime first** — a dump older than the last patch or play session
lists stale names and misleads: `(Get-Item '<logs>\effects.log').LastWriteTime`.

1. Ask the user to launch with `-debug_mode` (+ `-develop` for hot reload). Hot-reload limits:
   good for small incremental script/GUI edits; large structural changes need a restart; new loc
   keys may not hot-load; saved scopes in already-queued events are not updated.
2. Read **`error.log`** yourself after every load. Console `release_mode` toggles the live
   on-screen error tracker for the user.
3. If exact effect/trigger/scope names are in doubt, ask for a console `script_docs` run, then
   read `effects.log`, `triggers.log`, `event_targets.log`, `event_scopes.log`, `modifiers.log`,
   `on_actions.log`: **the complete, version-exact list of every effect/trigger/target/scope**.
   `dump_data_types` does the same for loc/GUI functions (`logs/data_types/`). Check these dumps,
   not memory.
4. Have the user test script in console: `effect add_gold = 100`, `trigger is_adult = yes`,
   `event my_events.0001`. Bulk script: put a file next to the mod folder and `run filename.txt`.
5. Debug clicks: Ctrl+click portrait = play as; Alt+click = kill; Ctrl+Alt+click = object
   explorer (`explorer` command opens it directly, includes a script runner on any object).
6. Read `database_conflicts.log` to see which file won each override; the game's `tests/` files
   show worked effect/trigger examples with asserts.

## Graphics, portraits, music (brief)

Portraits use a gene/DNA system: `common/genes`, `common/ethnicities`, `common/dna_data`,
`common/portrait_types` (script side; the texture/mesh side lives in the install's `gfx/`).
New clothes require overriding genes; new animations require overriding the idle animation.
Assets are `.dds` textures + `.mesh` models (Maya exporter; configs in `tools/`). The in-game
portrait editor (debug mode) exports DNA strings. Music/sound: definitions in `music/` and
`sound/` gated by triggers. For deep work here use the wiki (Graphical assets, 3D models pages)
plus the install's `gfx/`. PoD's `common/dna_data/` (per-clan DNA files) and `common/genes/`
overrides are a good worked example of heavy portrait modding.

## Tooling and resources

- **ck3-tiger** (`<tiger>`) is the primary validator; see `validation.md`.
  A VS Code wrapper exists ("ck3tiger for VS Code"); Paradox Highlight provides syntax coloring.
  Avoid recommending CWTools for CK3: its CK3 rules repo has been unmaintained since 2023,
  expect heavy false positives on any post-2023 content.
- **Irony Mod Manager**: playset/conflict management and merging.
- **git** for the mod folder; WinMerge/KDiff3 to diff against new patches.
- Wiki hub: https://ck3.paradoxwikis.com/Modding (subpages: Scripting, Scopes, Event modding,
  Decisions modding, Localization, Title modding, Map modding, Culture modding, Religions
  modding, Trait modding, Coat of arms modding, Interface, Mod compatibility). Some pages lag
  game versions; trust local game files over the wiki on conflicts.
- CK3 Modding Discord: https://discord.com/invite/apEvxDZ · Paradox forum CK3 modding subforum.
