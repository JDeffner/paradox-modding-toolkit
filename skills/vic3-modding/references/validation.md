# Validating and debugging a Victoria 3 mod

- [Two validation loops](#two-validation-loops)
- [vic3-tiger](#vic3-tiger)
- [Suppression baseline](#suppression-baseline)
- [The logs](#the-logs)
- [Console commands](#console-commands)
- [Regenerating the script_docs dumps](#regenerating-the-script_docs-dumps)

## Two validation loops

Use both, in this order. They fail differently.

| Loop | Speed | Authority | Catches |
|---|---|---|---|
| `vic3-tiger` on the mod directory | Seconds, offline | Lags the game by a patch or two | Syntax, unknown references, missing localization, scope mismatches |
| Launching the game and reading `error.log` | Minutes, needs the user | The installed build itself, zero lag | Everything the engine actually rejects |

Run tiger first and fix what it finds. Then ask the user to launch, and read the logs yourself.
Never ask the user to interpret a log or paste its contents: read the file.

## vic3-tiger

From https://github.com/amtep/tiger, the same project as ck3-tiger. Victoria 3 is a first-class
target there, released in lockstep with CK3, with per-OS archives named
`vic3-tiger-windows-<version>.zip`.

**Invocation takes the mod directory**, not a descriptor file:

```bash
vic3-tiger "<mods>/my_mod"
```

Add paths when auto-detection fails, which it will whenever Steam or Documents sits on a
non-default drive:

```bash
vic3-tiger --game "<steam library>/steamapps/common/Victoria 3" --paradox "<user documents>/Paradox Interactive/Victoria 3" "<mods>/my_mod"
```

Useful flags:

| Flag | Use |
|---|---|
| `--json` | Machine-readable reports. Use this when you intend to filter or diff. |
| `--suppress <file.json>` | Drop reports listed in a baseline file. |
| `-c`, `--consolidate` | Collapse repeated errors. |
| `--unused` | Warn about defined-but-unused items. |
| `--show-vanilla`, `--show-mods` | Include base game or other mods in the report. Off by default. |

**Version lag is real.** Tiger tracks Victoria 3 a patch or two behind the live build, and its
README states plainly that it still warns about some things that are correct. Treat Fatal and
Error as must-fix, Warning as worth reading, and do not treat a clean tiger run as proof. Confirm
the installed build with `vic3_docs.py stats` and compare it against tiger's release notes before
trusting a surprising complaint.

A `vic3-tiger.conf` placed **in the mod's directory** configures it, in Paradox script format.
Blocks worth knowing:

- `languages`: which localization languages to check.
- `filter`: `show_vanilla`, `show_loaded_mods`, and a `trigger` block filtering reports by
  `severity`, `confidence`, `key`, `file`, or `text`. This is the real severity gate.
- `load_mod`: declare dependency mods to load first, by label plus path or workshop id. Needed if
  the mod builds on Community Mod Framework, or tiger reports its references as unknown.
- `scope_override`: pin scope types for scripted triggers, effects, or variables tiger cannot
  infer.

## Suppression baseline

On an existing mod with pre-existing noise, snapshot the current reports once and gate on new
ones:

```bash
vic3-tiger --json "<mods>/my_mod" > tiger-baseline.json
vic3-tiger --json --suppress tiger-baseline.json "<mods>/my_mod"
```

The second command then reports only what the current work introduced. Refresh the baseline
deliberately, not automatically, or it silently absorbs real regressions.

## The logs

All under `<logs>` (`<user documents>\Paradox Interactive\Victoria 3\logs`).

| File | Tells you |
|---|---|
| `error.log` | What the engine rejected. The first thing to read after any in-game test. |
| `database_conflicts.log` | Which file won each contested override. Rewritten every launch. |
| `gui.log` | GUI load problems. |
| `debug.log`, `warning.log` | Broader engine chatter, useful when `error.log` is silent. |

**Check the file's modification time before drawing conclusions.** If it predates the change
being debugged, the user has not relaunched and the log is stale.

`<logs>\data_types\` holds the output of `dump_data_types`: the GUI and data-binding surface.
`data_types_script.txt` is the small, useful slice for script authors; the uncategorized file is
the full engine surface and is only worth opening for GUI work.

## Console commands

Ask the user to launch with the `-debug_mode` argument, which enables the console and debug
output. Then, in the in-game console:

| Command | Produces |
|---|---|
| `script_docs` | The six dumps in `<docs>`: effects, triggers, event targets, modifiers, on_actions, custom localization |
| `dump_data_types` | `<logs>\data_types\` |

## Regenerating the script_docs dumps

The dumps are version-exact for the build that produced them, which is what makes them
trustworthy. They are also the thing most likely to be silently out of date.

```bash
python scripts/vic3_docs.py stats
```

reports each dump's age and warns past 30 days. When a dump is older than the last game patch,
its identifier list is stale: ask the user to relaunch with `-debug_mode` and rerun `script_docs`
before trusting a "not found" result.
