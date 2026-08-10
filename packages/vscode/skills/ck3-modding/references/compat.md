# Mod-vs-mod compatibility

(Override mechanics between a mod and vanilla are in `setup.md`. This file is about conflicts
**between two mods** and how to detect/resolve them.)

## The six conflict types

| # | Conflict | Mechanism | Symptom |
|---|---|---|---|
| 1 | File-level override | Same relative path in both mods; last-loaded file wins entirely | The earlier mod's changes to that file vanish |
| 2 | Key-level collision | Same top-level key (trait, decision, scripted effect) defined by both, even in differently named files; LIOS: last asciibetical wins | One mod's version silently replaces the other's |
| 3 | Localization stomping | Same loc key in both mods; last loaded wins | Wrong text, no error |
| 4 | `replace_path` nuking | One mod's descriptor wipes a vanilla folder; other mods' *additions* to that folder survive, but their overrides of vanilla files in it point at nothing | Content missing wholesale |
| 5 | Scripted effect/trigger shadowing | Same `scripted_effect`/`scripted_trigger` name in both | Silent override, **no error.log entry** |
| 6 | on_action interaction | `events`/`random_events`/`on_actions` blocks merge across mods (this *works*), but merged lists can interact unexpectedly; `trigger`/`effect` blocks overwrite | Both mods' events fire, possibly double-firing effects; or one mod's `effect` block erases the other's |

## Total conversions

TCs (AGOT, PoD, EK2, ...) use `replace_path` extensively and are generally incompatible with
vanilla-targeting content mods. A submod for a TC must target the **TC's** file structure and
key names, not vanilla's. (When working on AGOT/PoD submods, grep the TC folder, not the game
folder, for the objects you're overriding.)

## Prevention (when writing a mod)

- Unique filenames with the mod's name in them; never reuse a vanilla filename unless a
  full-file override is intended.
- Prefix every new key, event namespace, and loc key with the mod name.
- Never redefine a vanilla on_action's `trigger`/`effect` (golden rule 3 in SKILL.md).
- Avoid `replace_path` unless building a total conversion.

## Detection

1. `scripts/check_compat.sh /path/to/mod_a /path/to/mod_b` — reports same-path files,
   shared top-level keys in `common/`, duplicate loc keys (same-file and cross-file), and
   `replace_path` directives. Exit 0 = clean, 1 = conflicts. Runs in Git Bash.
2. `database_conflicts.log` (written at every launch) — ground truth for which file actually
   won each contested override in the running playset.
3. For key collisions across *differently named* files (which the script's same-path check
   misses), grep both mods for the same top-level keys:
   `grep -rhoE '^[a-z_0-9]+ =' modA/common/<folder> modB/common/<folder> | sort | uniq -d`.

## Resolution

1. **Load order** — put the mod whose version should win lower in the playset.
2. **Compatch** — a third mod loading after both that merges the conflicting objects
   (see `setup.md` "Compatibility, distribution" for runtime mod-detection idioms).
3. **Rename/refactor** — if it's your mod, make the colliding keys unique.
