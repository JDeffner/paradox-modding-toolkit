# Chapter 1: Setup and how CK3 loads mods

Before writing a single line of script, you need to understand how CK3 finds, loads and merges mod files. Most beginner frustration ("my mod does nothing") comes from this chapter's material, not from script syntax.

## The two folders that matter

CK3 lives in two places on your machine:

1. **The game install** (read-only for you), typically:
   `C:\Program Files (x86)\Steam\steamapps\common\Crusader Kings III\game`
   This contains `common/`, `events/`, `gui/`, `localization/` and everything else the game is made of. You will read these files constantly but never edit them.
2. **The user directory** (where your mods live):
   `Documents\Paradox Interactive\Crusader Kings III\mod`
   Also home to `logs/` (error logs, debug dumps) and `save games/`.

The extension needs to know about both. **Paradox: Run Setup & Health Check** auto-detects the game install through Steam and the logs folder through your Documents path; you can override either in Settings (`px.gamePath`, `px.logsPath`).

## What a mod is

A mod is a folder that mirrors the game folder's structure, plus two small metadata files:

```
Documents\Paradox Interactive\Crusader Kings III\mod\
├── chronicle_mod.mod          <- outer metadata file
└── chronicle_mod\             <- the mod folder itself
    ├── descriptor.mod         <- inner copy of the metadata
    ├── common\
    │   └── decisions\
    │       └── chron_decisions.txt
    ├── events\
    │   └── chron_events.txt
    └── localization\
        └── english\
            └── chron_l_english.yml
```

The outer `.mod` file tells the launcher the mod exists:

```
# chronicle_mod.mod
version="0.1"
tags={ "Events" "Gameplay" }
name="Chronicle Mod"
supported_version="1.16.*"
path="mod/chronicle_mod"
```

`descriptor.mod` inside the folder is identical except it **omits the `path=` line**. Wildcards in `supported_version` are allowed; the launcher warns players when it falls behind the game version.

The easiest way to create all of this is the launcher itself: **Mods → Upload Mod → Create a Mod**. It generates both files and the folder for you. You can also write them by hand; there is no magic beyond the two files.

Two optional keys worth knowing: `remote_file_id` (the Steam Workshop ID, set automatically on upload) and `replace_path="history/characters"`, which suppresses an entire vanilla folder so the game loads only your version of that path. `replace_path` is a total-conversion tool; leave it alone for now.

## Rule zero: the folder structure IS the API

Inside your mod folder, file paths must mirror the game folder **exactly**. A decision goes in `common/decisions/`, an event file in `events/`, English localization in `localization/english/`. The game discovers content purely by path.

This has a brutal consequence: **a typo in a folder name means your file is silently ignored.** No error, no warning, nothing in any log. The classic trap is `common/on_action` (singular), which many people write as `on_actions` and then spend an evening confused.

## Rule one: failures are silent

CK3's default failure mode is silence. All of these produce zero error messages:

- Wrong folder name (file never loaded)
- Wrong file encoding (file loaded as garbage or skipped)
- Localization filename not ending in `_l_english.yml` (skipped)
- A typo in a coat of arms or texture name (empty graphic, no log entry)

Some failures do get logged (unbalanced braces, unknown effect names, missing loc keys show up in `error.log` when you launch with `-debug_mode`), but you must go looking. Chapter 9 covers the full debugging workflow; for now, internalize this: **when your mod does nothing, suspect the boring things first.** Folder name, filename, encoding.

## Rule two: encoding

- Script files (`.txt` under `common/`, `events/`, etc.): **UTF-8**.
- Localization files (`.yml`): **UTF-8 with BOM**, mandatory. Without the byte-order mark the file silently fails to load.

VS Code shows the encoding in the status bar (bottom right). Click it and choose "Save with encoding" to fix a file. The extension flags localization files missing the BOM as a diagnostic (`missing-bom`), so you will usually see a squiggle before the game sees the file.

## Rule three: how overrides work (LIOS vs FIOS)

Mods load top to bottom in the launcher playset. On a conflict, **the mod lower in the list wins**. Within the files themselves there are two override mechanisms:

1. **Full-file override.** A file with the same path and filename as a vanilla file replaces the entire vanilla file. Avoid this whenever possible: you fork thousands of lines, break on every patch and hard-conflict with any other mod touching that file.
2. **Single-object override.** Put just the object you want to change (a single decision, a single trait) in a **new** file at the same vanilla path. The game merges databases by object key.

For script databases, load order within a folder is **ASCIIbetical, Last-In-Only-Served (LIOS)**: the last file to define an object wins. So `zz_chron_overrides.txt` beats vanilla's `00_traits.txt`. You can change an object this way but not remove it.

Not everything follows LIOS. The per-system behavior:

| System | Override behavior |
|---|---|
| Most `common/` script (traits, decisions, scripted effects/triggers, script values, defines...) | Single-object override, LIOS (last file ASCIIbetically wins) |
| `common/on_action/` | `events`, `random_events` and `on_actions` sub-blocks **merge across all mods**; `trigger` and `effect` **overwrite** (see [Chapter 4](04-events.md) for why this matters enormously) |
| Events | **Whole-file only.** You cannot override a single vanilla event |
| Faiths, `common/holdings/holdings.txt` | Whole-file only |
| History characters | Do not single-object override: you get a **duplicate** character, not an edit |
| Localization | Single keys overridable only inside a `replace` folder: `localization/replace/english/` |
| GUI types and templates | **FIOS (First-In-Only-Served)**: the *first*-loaded definition wins. The exact opposite of script. Name GUI override files to sort first (`00_...gui`) |

Practical habits that follow from this table:

- **Never copy a whole vanilla file into your mod to change three lines.** Use a single-object override in a new file.
- **Put your mod's tag in every filename** (`chron_decisions.txt`, not `decisions.txt`). Conflicts then show up clearly in `database_conflicts.log`, which the game writes at every launch listing which file won each contested override.
- Overriding a define needs its category block: `NCharacter = { BASE_HEALTH = 5.0 }` in a new file under `common/defines/`.

The extension's **Overrides & Conflicts** view (CK3 icon in the Activity Bar) shows you which of your files override vanilla objects and where load-order conflicts exist.

## Launch options

Set these in Steam (right-click CK3 → Properties → Launch Options):

- `-debug_mode` : enables the console and debug tooltips. Essential for modding. Since patch 1.9, running mods or debug mode no longer disables achievements (using console commands does, for that session).
- `-develop` : hot-reloads most script files when you save them, no restart needed.
- `-continuelastsave`, `-random_seed=42`, `-nographics` : occasionally useful for faster iteration and reproducible tests.

The extension's **Paradox: Launch CK3 (debug mode)** command starts the game with the right flags directly from VS Code.

## Set up the extension

1. **Paradox: Run Setup & Health Check** from the Command Palette. Point it at your game install if auto-detect fails.
2. Open your mod folder as the workspace (File → Open Folder). The extension indexes `common/`, `events/` and `localization/` and watches for changes.
3. Optionally run the walkthrough (Help → Welcome → "Get started with the Paradox Toolkit") which steps through script_docs generation and ck3-tiger download. Both are covered in [Chapter 9](09-debugging.md).

With a game path configured you immediately get: go-to-definition into vanilla files (F12 on any vanilla scripted effect, trait or event id), hover documentation, and completion aware of every vanilla object.

## Try it

1. Create a mod called "Chronicle Mod" through the launcher (Mods → Upload Mod → Create a Mod), or write the two metadata files by hand as shown above.
2. Inside the mod folder, create the empty directory tree: `common/decisions/`, `events/`, `localization/english/`.
3. Open the mod folder in VS Code and run **Paradox: Run Setup & Health Check**. Confirm the status bar item (bottom right, "PX") reports a healthy setup.
4. Add the mod to a playset in the launcher and start the game once with `-debug_mode`. Press `` ` `` (backtick) in-game; if the console opens, you are ready for Chapter 2.

Next: [Chapter 2: Your first mod](02-first-mod.md) · [Back to index](index.md)
