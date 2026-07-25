# Chapter 9: Validation and debugging

You have met the enemy in every chapter: silence. This chapter assembles the full defensive toolkit, in the order you should deploy it: static validation before launching, logs and console during testing, and a checklist for the times something still does nothing.

## Layer 1: ck3-tiger (before you ever launch)

[ck3-tiger](https://github.com/amtep/tiger) is the standard CK3 validator. It loads vanilla plus your mod and checks cross-references, scope correctness, syntax and idioms: an unknown trait name, an effect used in a trigger block, a `limit` inside `any_X`, a missing loc key. Run it after writing code and before starting the game; it catches in seconds what would cost you a launch cycle to discover.

The extension integrates it fully:

- **Paradox Tiger: Download or Update Binary** fetches the binary matching your platform and sets `px.tigerPath`.
- With `px.tigerRunOn` set to `save` (the default), tiger runs on every save of a mod script file, debounced, and its reports appear as squiggles in the editor and entries in the Problems panel. Set it to `manual` and use **Paradox Tiger: Run Validation** when you prefer explicit runs.
- **Paradox Tiger: Generate ck3-tiger.conf** writes a sensible config into your mod root.

### Reading tiger output

Each report has a severity (`Tips < Untidy < Warning < Error < Fatal`) and a confidence (`Weak < Reasonable < Strong`). Triage order:

1. **Fatal / Error**: real bugs. Fatal usually means a crash or a fully broken object. Fix these first, always.
2. **Warning**: player-facing glitches. Fix or consciously suppress.
3. **Untidy / Tips**: style and performance advice. Ignore while iterating, revisit before release.

Tiger is mature but its own README admits it "will still warn about some things that are actually correct". `Weak`-confidence reports are the false-positive-prone ones. Manage them deliberately: a `ck3-tiger.conf` in the mod root filters by severity, confidence and key; `#tiger-ignore` comments suppress a single line, block or file; and `scope_override` config entries fix false wrong-scope reports. Do not respond to false positives by ignoring the tool.

A useful default config keeps localization checks off while you build (a run drowning in missing-loc warnings hides the one Error that matters) and re-enables them when polishing for release:

```
# ck3-tiger.conf
languages = { check = "english" }
filter = {
	trigger = {
		severity >= Warning
		confidence >= Reasonable
	}
}
```

### Baselines and housekeeping

Two extension commands matter for existing mods. **Paradox Tiger: Create Baseline** snapshots the current reports so that afterwards you only see *new* problems (toggle with **Paradox Tiger: Toggle New-Problems-Only Filter**); this is how you adopt tiger on a mod with 400 pre-existing warnings without despair. **Paradox Tiger: Find Unused Definitions (--unused)** lists scripted effects, triggers and values nothing references, ideal before a release.

One structural fact: tiger validates the whole mod, never a single file, because references resolve across game plus mod. And after a CK3 patch, expect transient false positives until the matching tiger release ships (it warns on version mismatch at startup).

## Layer 2: error.log (while the game runs)

Launch with `-debug_mode` and the game writes its complaints to `Documents\Paradox Interactive\Crusader Kings III\logs\error.log`: parse errors, unknown effects, missing loc keys, invalid database references. Read it after every load during development.

The extension's **Paradox: Toggle error.log Watcher** tails the file live into the Output panel, so errors appear the moment the game logs them, while you stay in the editor. In-game, the console command `release_mode` toggles an on-screen error counter, the fastest way to notice that a reload introduced breakage.

Other logs worth knowing in the same folder:

| Log | What it tells you |
|---|---|
| `error.log` | Script and data errors; your primary feed |
| `database_conflicts.log` | Written every launch: which file won each contested override. THE tool for load-order mysteries |
| `game.log`, `debug.log` | General engine chatter, occasionally the missing context |
| `gui_warnings.log` | GUI-specific breakage |

## Layer 3: the console (interactive testing)

With `-debug_mode`, the backtick key opens the console. The commands that pay rent:

```
event chron.0001                      # fire an event on your character
effect add_gold = 1000                # run any effect
effect add_trait = chron_famed_chronicler
trigger is_ruler = yes                # evaluate any trigger, prints the result
effect remove_decision_cooldown = chron_commission_chronicle_decision
observe                               # release control, watch the AI world run
run mytest.txt                        # execute a file of effects (next to the mod folder)
```

Mouse shortcuts on portraits: Ctrl+click plays as that character; Alt+click kills them; Ctrl+Alt+click opens the **object explorer** (also via the `explorer` command), a live browser of every scope, variable and list on any object, with a script runner attached. When a variable is mysteriously "not set", the explorer settles in seconds what guessing cannot.

### The two dumps that power your tooling

Two console commands generate reference data you (and the extension) will use constantly:

- **`script_docs`** writes `effects.log`, `triggers.log`, `event_targets.log`, `event_scopes.log`, `modifiers.log` and `on_actions.log` to the logs folder: the complete, version-exact list of every effect, trigger, target and scope in your game, including all DLC and patch changes.
- **`dump_data_types`** writes every GUI and localization function to `logs/data_types/`, the authoritative reference for Chapter 6's data functions and Chapter 7's bindings.

The extension ships with bundled reference data so completion works out of the box, but after running `script_docs`, **Paradox: Reload Game Data (script_docs)** upgrades completion and hover to your exact game version, including modifiers. Regenerate after every game patch. **Paradox: Show Index Statistics** shows what the extension currently knows.

## The silent-failure checklist

When something does nothing and no log complains, work through this list top to bottom. It is ordered by base rate; the boring entries at the top account for most incidents.

1. Localization file missing the BOM, or filename not ending `_l_english.yml`.
2. Folder name typo (file silently ignored). Check `common/on_action` (singular) specifically.
3. Mod not actually enabled in the launched playset.
4. Unbalanced braces: parsing aborts for the rest of the file, so objects below the typo vanish.
5. An effect in a trigger block or a trigger in an effect block.
6. `limit = { }` inside `any_X` (invalid; conditions go directly inside).
7. Variable read from the wrong scope (variables live on the scope that set them).
8. Missing loc key (content works, text shows as raw key).
9. GUI: registry name and widget name mismatch; or your type override file loads too late (FIOS: first wins).
10. Script override file loads too early (LIOS: last wins). Check `database_conflicts.log`.
11. Redefined a vanilla on_action's `trigger`/`effect` instead of appending (breaks vanilla AND your hook; see [Chapter 4](04-events.md)).
12. Coat of arms or texture name typo (empty graphic, zero errors).
13. History character re-defined in a new file (duplicates the character instead of editing).
14. scripted_gui `saved_scopes` declared but not passed via `AddScope`.

Then: run tiger, read `error.log`, and check `database_conflicts.log`. Between those three, almost nothing stays hidden.

## The extension's own diagnostics

Independently of tiger, the extension continuously checks structural rules it can verify from the index: missing BOM, unknown event ids in `trigger_event`, missing localization for referenced keys, and more. Suppress specific codes via `px.diagnostics.ignore` or whole paths via `px.diagnostics.ignorePatterns` if a check misfires for your project. **Paradox: Show Mod Report** summarizes the state of the whole mod (content counts, problem totals, loc coverage, overrides) in one document, a good pre-release ritual.

## A closing word on process

The professionals' loop, condensed: copy a working vanilla example, modify it, save (tiger runs), fix the squiggles, launch with `-debug_mode -develop`, test via console, read `error.log`, repeat. Every chapter of this tutorial has been rehearsing parts of that loop. The modders who ship are not the ones who never break things; they are the ones whose loop finds the breakage in seconds.

## Try it

1. Sabotage your own mod, deliberately, one fault at a time: remove the loc file's BOM; rename `common/decisions` to `common/decision`; delete a closing brace; put `add_gold = 50` inside `is_shown`. For each: predict which layer catches it (tiger squiggle? error.log? pure silence plus checklist?), then verify.
2. Run `script_docs` in-game, then **Paradox: Reload Game Data (script_docs)**, and hover an effect to confirm version-exact docs.
3. Open `database_conflicts.log` after a launch and find an override your mod won.

Next: [Chapter 10: Performance and design patterns](10-performance-patterns.md) · [Back to index](index.md)
