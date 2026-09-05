# Events, on_actions, journal entries, decisions

- [Journal entries are the primary unit](#journal-entries-are-the-primary-unit)
- [Events](#events)
- [on_actions](#on_actions)
- [Decisions](#decisions)
- [Pitfalls](#pitfalls)

## Journal entries are the primary unit

This is the biggest structural difference from Crusader Kings III. In CK3 the event is the
narrative unit. In Victoria 3 the **journal entry** is: a persistent, tracked objective with its
own lifecycle, modifiers, progress bar, buttons, and optional custom UI widget. Events are
usually fired *by* a journal entry pulse or an on_action rather than standing alone.

The evidence is in the file counts: `common/journal_entries/` holds 173 files, the largest
content folder in the game, against 34 for `decisions`.

`common/journal_entries/journal_entries.md` is 444 lines and the best schema doc Victoria 3
ships. Read it before writing a journal entry. It annotates the root scope of every callback.

Lifecycle fields: `possible`, `immediate`, `complete`, `fail`, `invalid`, `timeout`, with
`on_complete`, `on_fail`, `on_invalid`, `on_timeout` effects, plus `_all_involved` variants for
multi-country entries. Presentation: `status_desc`, the
`event_outcome_{activated,invalidated,completed,failed,timeout}_desc` family, and custom headers.
Ongoing behaviour: `modifiers_while_active`, `on_weekly_pulse`, `on_monthly_pulse`,
`on_yearly_pulse`, `current_value`, `goal_add_value`, `progressbar`, `scripted_progress_bar`,
`scripted_button`, `widget`.

Scope contract, quoted from the doc: `scope:journal_entry` is the entry itself, and
`scope:target` is the target value the entry was added with via the `add_journal_entry` effect.

**An empty `complete = { }` means the entry can never complete.** The doc says so plainly ("if
left blank, cannot be completed"), and the same holds for `fail`. The entry then sits in the
journal forever with no error anywhere.

## Events

`events/` holds 328 `.txt` files in 12 subfolders. There is **no schema doc for events**, so
vanilla is the reference.

Only two event types exist: `country_event` (2,349 uses) and `state_event` (14). There is no
character event, no letter event, and none of CK3's `theme` or portrait system.

```
namespace = 1848

1848.1 = {
    type = country_event
    placement = root

    title = 1848.1.t
    desc = 1848.1.d
    flavor = 1848.1.f

    duration = 3

    event_image = { video = "europenorthamerica_springtime_of_nations" }
    on_created_soundeffect = "event:/SFX/UI/Alerts/event_appear"
    icon = "gfx/interface/icons/event_icons/waving_flag.dds"

    trigger = { ... }

    option = {
        name = 1848.1.a
        ai_chance = { base = 25  modifier = { trigger = { ... } add = -15 } }
    }
}
```

What a CK3 modder will not expect:

- **Three text keys, not two**: `title`, `desc`, and `flavor` (`.t`, `.d`, `.f`). Localization
  keys use **dots**, not underscores.
- The file needs a `namespace = <name>` header, and event ids are `<namespace>.<number>`.
- **Event art is a looping video**, `event_image = { video = "..." }`, not a static picture.
- `duration` controls how long the popup stays relevant; `cooldown` throttles refiring.
- `placement = root` aims the camera and map notification.
- `gui_window = event_window_1char_tabloid` swaps the whole window layout, with `left_icon`
  supplying a portrait.
- `cancellation_trigger` kills a delayed event before it fires.
- `option` carries `name`, an optional `trigger`, `default_option = yes`, `ai_chance`, and its
  effects inline.

Field usage across vanilla, useful for judging what is normal: `duration` 2,219, `title` 2,215,
`flavor` 2,215, `icon` 2,192, `event_image` 2,156, `immediate` 2,169, `placement` 2,061,
`cooldown` 1,462, `cancellation_trigger` 1,076, `gui_window` 166, `hidden` 63.

## on_actions

The folder is `common/on_actions/`, **plural**, holding 7 files. `_on_actions.md` documents the
engine pulse set grouped by root scope:

| Root | Pulses |
|---|---|
| none | `on_monthly_pulse`, `on_yearly_pulse` |
| country | `on_{monthly,yearly,half_yearly,five_year,decade}_pulse_country`, plus `_country_elections` variants |
| character | `on_{monthly,yearly,half_yearly,five_year,decade}_pulse_character` |
| state | `on_{monthly,half_yearly,yearly,five_year,decade}_pulse_state` |

The full list of 260 on_actions, each with its expected scope and whether the engine or vanilla
script defines it, is in the dumps:

```bash
python scripts/vic3_docs.py find on_monthly_pulse_country
python scripts/vic3_docs.py find -s pulse
```

`From Code: Yes` means an engine hook. `From Code: No` means vanilla script defines it, so it is
content you can also be overriding.

Blocks inside an on_action: `trigger`, `weight_multiplier`, `events` (with `delay`),
`random_events`, `first_valid`, `on_actions`, `random_on_actions`, `first_valid_on_action`,
`effect`, `fallback`.

**The append pattern is mandatory.** Quoted from the doc: "you cannot have multiple triggers or
effect blocks for a given named on-action. In particular, you cannot append an effect block
directly to an on_action which already has an effect block, as this creates a conflict." So hook
vanilla by chaining, never by redefining:

```
some_vanilla_on_action = {
    on_actions = { my_mod_on_action }
}

my_mod_on_action = {
    effect = {
        my_mod_effect = yes
    }
}
```

Three warnings quoted from the same doc:

1. "an event will only successfully fire if it is valid both when the on_action is executed AND
   once the delay is complete". A trigger true at schedule time and false at fire time produces
   nothing, silently.
2. "Scopes or local variables set in the effect here will not carry over to any event fired by
   the on_action." The effect and the fired events are separate chains.
3. "Avoid creating infinite fallback loops, or the game may be prevented from advancing time."

Fire an on_action from script with
`trigger_event = { on_action = <name>  days = X }`.

## Decisions

`common/decisions/` (34 files) ships no `.md`, but it does ship a plain-text doc:
`common/decisions/000_decisions_help.txt`. Read that.

Quoted from it: "A decision is evaluated in country scope." The required parts are the key, an
`is_shown` trigger (country scope), a `possible` trigger (country scope), a `when_taken` effect,
and an `ai_chance` script value. The file also states the naming convention: keys generally end
with `_decision`.

Decisions are a much smaller system in Victoria 3 than in CK3. Before adding one, check whether a
journal entry with a scripted button is the better fit, since that is the pattern vanilla reaches
for.

## Pitfalls

| Symptom | Cause |
|---|---|
| A journal entry never completes | Empty `complete = { }` |
| An event never fires from an on_action | Its trigger was true at schedule time and false after the delay |
| `scope:` is null inside an event fired by an on_action | Scopes set in the on_action's `effect` do not carry into fired events |
| Another mod's on_action hook stopped working | A vanilla on_action was redefined instead of chained |
| The game stops advancing time | An infinite `fallback` loop |
| Event text shows raw keys | Localization keys written with underscores instead of dots, or the `namespace` header is missing |
| An event has no art | `event_image` expects a video name, not a texture path |
