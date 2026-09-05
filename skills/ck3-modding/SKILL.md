---
name: ck3-modding
description: >-
  Comprehensive Crusader Kings III (CK3) modding assistant covering events, decisions, traits,
  cultures, faiths, character history, landed titles, on_actions, scripted effects/triggers,
  localization, GUI, mod setup, validation, and debugging. Use this skill whenever the user
  mentions CK3, Crusader Kings, Paradox modding, or any related task — writing or fixing an
  event, decision, trait, culture, religion, .mod file, error.log problem, on_action, .yml
  localization, or any file under common/, events/, history/, gui/, or localization/. Also
  trigger for questions like "why does my mod do nothing", "how do I override X", or "set up a
  new CK3 mod", even if the word "mod" never appears but the context is clearly CK3 game files.
allowed-tools: Bash(python ${CLAUDE_SKILL_DIR}/scripts/ck3_docs.py *)
---

# CK3 Modding

Help the user create, edit, and debug Crusader Kings III mods. CK3 modding is done in Paradox's
Jomini script (`.txt` databases under `common/` and `events/`), yml localization, and PdxGui files.
The default failure mode is **silent**: wrong encoding, a folder typo, or an unbalanced brace makes
the game ignore your file with no error. Follow the workflow below to avoid that.

## Step 0: Ground truth on this machine

The base game files are THE source of truth for everything. Never guess trigger/effect/scope
names from memory; find them in a vanilla file, an `_*.info` schema doc, or the script_docs logs.

**Resolve these locations once at the start of a session.** Run the helper that ships with this
skill (script paths are relative to the folder holding this SKILL.md; use its absolute path):

```bash
python scripts/ck3_docs.py paths
```

It reads Steam's library list and the user's Documents folder (redirects included), prints the
five locations below, the installed patch, the DLC folders, and how old each `script_docs` dump
is. Reuse the printed values wherever this skill writes `<game>`, `<logs>`, `<mods>`, `<workshop>`
or `<tiger>`. Only when the script reports NOT FOUND, look in the typical spots below and ask the
user as a last resort. If a path turns out to be unreadable in the session, ask the user to grant
folder access rather than working blind.

| Placeholder | What | Typical location |
|---|---|---|
| `<game>` | **Base game data (primary source of truth)** | `<steam library>\steamapps\common\Crusader Kings III\game`. Default library: `C:\Program Files (x86)\Steam`; other libraries are listed in `<steam>\steamapps\libraryfolders.vdf`. Linux: `~/.local/share/Steam/...` |
| `<logs>` | Game logs (`error.log`, `script_docs` dumps, `data_types/`) | Windows: `%USERPROFILE%\Documents\Paradox Interactive\Crusader Kings III\logs` (Documents may be redirected to another drive or OneDrive). Linux: `~/.local/share/Paradox Interactive/Crusader Kings III/logs`. macOS: `~/Documents/Paradox Interactive/...` |
| `<mods>` | User mod folder (where mods are developed) | Sibling of `<logs>`: `...\Crusader Kings III\mod` |
| `<workshop>` | Steam Workshop content for CK3 (only what the user subscribed to) | `<steam library>\steamapps\workshop\content\1158310` — Princes of Darkness = `2216659254`, A Game of Thrones = `2962333032` (the main AGOT mod; `2995674648` is only the *Crowns of Westeros* crown-art submod, not AGOT itself) |
| `<tiger>` | ck3-tiger validator executable (full path to `ck3-tiger.exe`) | Wherever the user installed it; releases at github.com/amtep/tiger (see `references/validation.md`) |

Inside the game folder, before scripting a system:

- ~150 `_<name>.info` files ship inside `common/` subfolders (e.g. `common/decisions/_decisions.info`,
  `common/on_action/_on_actions.info`, `events/_events.info`, `history/_history.info`).
  **Read the relevant `.info` first**; it is Paradox's own schema doc and more current than the wiki.
  `python scripts/ck3_docs.py info <folder>` lists the doc for a folder (`info` alone lists all 160).
- `tests/` contains engine self-tests: worked examples of effects and triggers with asserted outcomes.
- Console `script_docs` dumps `effects.log`, `triggers.log`, `event_targets.log`, `event_scopes.log`,
  `modifiers.log` and `on_actions.log` to the logs folder above: the complete, version-exact list of
  every effect/trigger/target/scope. Query them with `python scripts/ck3_docs.py find <name>`
  (prints the entry with its supported scopes, exits 1 when the name does not exist) or
  `find -s <text>` for a substring search. The six files use three different layouts, so the
  script beats a grep.

**How to read an `_*.info` schema doc** (excerpt from `common/decisions/_decisions.info`):

```
=== Notes ===                    # top-of-file prose: sorting, gotchas, cross-references
=== Structure ===                # section header; the annotated schema block follows it
my_decision = {                  # <key> = the name you give the object; loc keys derive from it
    title = <key> | { ... }              # override title, default: "<key>"; ...; scope: character
    decision_group_type = <key>          # ...; Default or not specified will select 'decisions'
    ### Brief: picture                   # ### Brief: <field> annotates the field defined below it
    picture = { trigger = { ... } reference = "..." }
}
```

- `field = <type>  # comment`: the comment carries the field's **type**, its **default**, and often
  the **scope** it runs in (`scope: character` above). `<key>`, `<scripted value>`, `int`, `yes/no`
  are type placeholders describing what to write, not literal text to paste.
- `=== Section ===` and `### Brief:` headers separate prose from schema and annotate single fields;
  read the Notes/Structure headers first for gotchas the wiki omits.
- A field with no stated `default:` is usually required; an empty trigger block (`{ }`) passes.
- These docs are version-exact for the installed patch — trust them over the wiki on any conflict.

**Version / DLC self-check.** Before trusting any version-specific claim, confirm the installed
patch and DLC rather than assuming. `ck3_docs.py paths` prints both. Without it: the patch is
`rawVersion` in `launcher\launcher-settings.json` next to `<game>`, and the DLC are the folders in
`<game>\dlc` (catalog of names in `<game>\dlc_metadata\00_dlc_metadata.txt`).

The two Workshop mods above are the second ground-truth layer: state-of-the-art idiom sources.
Grep them for real-world patterns vanilla lacks (custom UI, story cycles, ai_accept craft, secret
societies). Distilled findings live in `mods/pod.md` and `mods/agot.md`; read those first, then
open the mod files themselves when you need more detail than the summaries carry (only possible
when the user subscribed to them — the distilled notes work standalone).

## Game logs: ask for a dump, then analyze it yourself

You can read the logs folder directly, but only the user can generate its contents (launch the
game, run console commands). So when you need runtime truth, **ask the user to produce the dump,
then read the log yourself**. Never ask the user to paste log contents or interpret a log on
their own, and never guess when a dump would settle the question.

| You need | Ask the user to | Then read |
|---|---|---|
| Errors after a change | launch with `-debug_mode`, load a save | `error.log` (plus `game.log`, `debug.log`) |
| Exact effect/trigger/scope/target/modifier lists | run console `script_docs` | `effects.log`, `triggers.log`, `event_targets.log`, `event_scopes.log`, `modifiers.log`, `on_actions.log` |
| GUI promotes/functions (data binding API) | run console `dump_data_types` | `data_types/` subfolder |
| Which file won a contested override | nothing — written at every launch | `database_conflicts.log` |
| GUI breakage | open the broken screen in-game | `gui_warnings.log`, `error.log` |

**Check the log's LastWriteTime first.** If it predates the change being debugged, the dump is
stale — ask for a fresh launch/dump before drawing conclusions. (`script_docs` output in
particular survives from old sessions.) A `script_docs` dump older than the last game patch or the
last play session will list stale effect/trigger names and mislead you. `ck3_docs.py paths`
prints the age of every dump and warns past 30 days.

## Golden rules

1. Copy a working vanilla example and modify it; don't write script from scratch. Check every
   effect, trigger, target and on_action name with `python scripts/ck3_docs.py find <name>`
   before you write it; a plausible invented name is the most expensive mistake.
2. Add NEW files with your mod's name in the filename; never overwrite whole vanilla files
   when a single-object override works (see `references/setup.md` for the override rules).
3. Never redefine a vanilla on_action's `trigger`/`effect`; append a custom on_action
   (`on_birth_child = { on_actions = { my_mod_on_birth } }`). This is the #1 compatibility bug.
4. Localization: UTF-8 **with BOM**, filename ends `_l_english.yml`, first line `l_english:`.
   Script `.txt`: UTF-8. Wrong encoding fails silently.
5. Every new key needs localization or the raw key shows in-game.
6. Folder layout in a mod mirrors the game folder exactly; a folder-name typo = file silently
   ignored. Note it's `common/on_action` (singular).
7. Custom UI goes through `scripted_widgets` injection, never through overriding `hud.gui`
   or other vanilla `.gui` files (see `references/gui.md`).
8. Performance: no world scans in pulses. Iterate bounded lists, gate AI paths hard, and
   prefer per-actor story cycles over `every_living_character` (see `mods/agot.md`).
9. Validate with **ck3-tiger** after writing code, before asking the user to test in-game
   (see `references/validation.md`). Localization checks stay off unless asked for.
10. Then test in-game: ask the user to launch with `-debug_mode` and run the console tests
    (`event x.1`, `effect ...`, `trigger ...`), then read `error.log` yourself
    (see "Game logs" above) — don't ask the user what it says.

## Workflow for any modding task

1. Identify which system the task touches (event? decision? trait? GUI? loc? ...).
2. Read the matching reference file below, plus the system's `_*.info` and a vanilla example.
   For mechanic *design* questions (meters, hidden societies, AI-driven drama), also read the
   relevant `mods/*.md` pattern file.
3. Write the mod file: new file, mod-tagged name, correct folder, correct override order
   (script = LIOS/last wins; GUI = FIOS/first wins).
4. Add localization for every new key.
5. Run ck3-tiger on the mod (`references/validation.md`). Fix Fatal/Error, then Warning.
6. Verify in-game: give the user the exact test steps (`-debug_mode`, console command), ask them
   to run the game, then read the logs yourself and confirm or fix (see "Game logs"). For GUI
   work, use the test-window feedback loop in `references/gui.md`.

## Routing table

| Task involves... | Read | Best example |
|---|---|---|
| Mod setup, .mod files, load order, override/conflict rules, directory map | `references/setup.md` | — |
| Script syntax, scopes, triggers vs effects, variables, lists, scripted effects/triggers/values | `references/language.md` | `common/scripted_triggers/00_bastard_triggers.txt`, `common/script_values/00_basic_values.txt` |
| Events, on_actions, decisions, interactions, schemes, activities, story cycles | `references/events.md` | `events/tutorial_events.txt`, `common/on_action/death.txt` |
| Localization, history, landed titles, map, CoA, culture, religion, traits, dynasties | `references/content.md` | `history/characters/afar.txt`, `common/religion/doctrine_types/30_core_tenets.txt` |
| GUI: custom windows, HUD widgets, scripted_widgets, data binding, scripted_guis | `references/gui.md` | PoD `gui/POD_windows/`, vanilla `gui/preload/defaults.gui` |
| Validating mod code (ck3-tiger) | `references/validation.md` | — |
| Debugging, console, logs, graphics/portraits, tooling | `references/debugging.md` | game `tests/` |
| Design patterns: tiered meters, exposure/secrecy systems, hidden societies, supernatural (immortality), custom UI at scale | `mods/pod.md` | PoD mod folder |
| Design patterns: AI-initiated drama, story cycles, narrated ai_accept, duels, secrets, alerts, perf budgeting | `mods/agot.md` | AGOT mod folder |
| Mod-vs-mod conflicts, total-conversion submods, compatch strategy | `references/compat.md` + `scripts/check_compat.sh` | — |

Read multiple files when the task spans systems (most content tasks also need localization).

### Deep per-system recipes (`references/patterns/`)

Step-by-step recipes with full skeletons and pitfall lists, one file per system: `activities`,
`ai` (weighting/behavior), `buildings`, `casus-belli`, `characters` (interactions), `court-positions`,
`culture-religion`, `decisions`, `dynasties` (legacies/perks), `epidemics`, `events` (advanced:
widgets, animations, theme overrides, on_action structure), `factions`, `flags`, `gfx`,
`governments`, `great-projects`, `history`, `holdings`, `lifestyles`, `map-modding`, `map-objects`,
`men-at-arms`, `schemes`, `story-cycles`, `traits`.

Read the matching recipe **in addition to** the routed reference above when creating one of these
from scratch. Caveat: imported from a community skill (2026-07); folder paths were re-verified
against the local install but key names were not exhaustively checked — on any disagreement,
the `_*.info` schema, script_docs, and vanilla files win.

## Silent-failure checklist (user says "it does nothing")

Work through: loc file missing BOM or not ending `_l_english.yml` · folder name typo ·
`on_action` vs `on_actions` confusion · unbalanced braces (parse aborts rest of file) · effect in
a trigger block or vice versa · `limit` inside `any_X` (invalid) · variable read from the wrong
scope · missing loc key · GUI file loaded too late (FIOS) · script file loaded too early (LIOS) ·
CoA/title name typo (zero error output) · overwrote vanilla on_action `effect` ·
re-defined history character in a new file (duplicates instead of editing) ·
scripted_widget name mismatch with its registry entry · scripted_gui `saved_scopes` declared but
not passed via `AddScope` · an identifier that does not exist in this build (`ck3_docs.py find`
settles it). Then: run ck3-tiger, read `error.log`, and check
`database_conflicts.log` (shows which file won each override).
