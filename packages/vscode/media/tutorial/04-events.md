# Chapter 4: Events and on_actions

Events are the beating heart of CK3 content: the popup windows with portraits, flavor text and choices. This chapter covers their anatomy, how to chain them, and the single most important compatibility rule in all of CK3 modding: how to hook events into the game with on_actions without breaking other mods.

The authoritative schema is `events/_events.info` in the game folder (open any event file and run **Paradox: Open Format Docs (.info) for This File**). The best annotated examples are in `events/tutorial_events.txt`.

## Anatomy of an event

Events live in `.txt` files under `events/` (subfolders allowed). Every file starts with a namespace declaration, and every event id is `namespace.number`:

```
namespace = chron

chron.0001 = {
	type = character_event          # default; also letter_event, court_event, activity_event
	title = chron.0001.t
	desc = chron.0001.desc
	theme = stewardship             # background, lighting and sound as one package

	left_portrait = {
		character = root
		animation = happiness
	}
	right_portrait = {
		character = scope:scribe
		animation = worry
	}

	trigger = {
		# gate, checked BEFORE the event fires
		is_adult = yes
	}

	immediate = {
		# runs instantly when the event fires, before text and portraits render.
		# Save scopes HERE so desc, portraits and options can use them.
		random_courtier = {
			limit = { learning >= 8 }
			save_scope_as = scribe
		}
	}

	option = {
		name = chron.0001.a          # option button text
		add_prestige = 50
		ai_chance = { base = 100 }
	}
	option = {
		name = chron.0001.b
		scope:scribe = { add_gold = 20 }
		stress_impact = {
			greedy = medium_stress_impact_gain
		}
		ai_chance = { base = 50 }
	}

	after = {
		# runs after an option is chosen, whichever it was
	}
}
```

Key facts, in the order they will bite you:

- **`namespace` must be the first line** of the file, alphanumeric, no dots. Keep event numbers at 9999 or below.
- **`trigger` cannot see scopes saved in `immediate`** because it runs first. Gate on what exists before the event; set up the cast in `immediate`.
- **Save scopes in `immediate`, not in options.** The description and portraits render before any option runs.
- Loc keys are free-form but the convention is `<id>.t`, `<id>.desc`, `<id>.a` / `.b` / `.c` for options.
- `theme` picks a background, lighting and sound from `common/event_themes/` (vanilla core set includes `diplomacy`, `martial`, `stewardship`, `intrigue`, `learning`, `faith`, `friendly` and many more). Override just the background with `override_background = { reference = ... }`.
- Portrait slots: `left_portrait`, `right_portrait`, `lower_left_portrait`, `lower_center_portrait`, `lower_right_portrait`. Each takes `character`, `animation` (vanilla uses names like `disapproval`, `worry`, `shame`, `dismissal`, `toast`), plus `triggered_animation` and `triggered_outfit` for conditional variants.
- `hidden = yes` shows no window at all; the event just runs its `immediate`. This is the standard shape for background maintenance events (no options needed).
- Events with no character context need `scope = none` (the event root type; the default is character).
- `orphan = yes` suppresses the error log entry for an event nothing references yet, useful while developing.

## Dynamic text

`title` and `desc` accept blocks instead of a single key, choosing text at display time:

```
desc = {
	first_valid = {
		triggered_desc = {
			trigger = { scope:scribe = { has_trait = shy } }
			desc = chron.0001.desc.shy
		}
		desc = chron.0001.desc            # fallback, always valid
	}
}
```

`first_valid` picks the first matching entry; `random_valid` picks randomly among matching ones. These nest, so vanilla builds paragraph-by-paragraph descriptions out of stacked blocks.

## Options in full

An option is an effect block with presentation extras:

- `name = <key>`, plus an optional `trigger = { }` to hide the option conditionally.
- `ai_chance = { base = N modifier = { add = N <triggers> } }` weights AI choice. Omitting it means the AI weighs all options equally, which in practice is usually an oversight: give every option an `ai_chance`.
- `stress_impact = { trait = value }` adds or relieves stress per personality trait. Small touches like `stress_impact = { compassionate = minor_stress_impact_gain }` on a cruel choice are the difference between flat and alive.
- `custom_tooltip = key` and `hidden_effect = { }` control what the tooltip reveals.
- Extras you will meet in vanilla: `show_as_unavailable` (greyed out with reason), `trait = brave` (shows a trait icon on the button), `add_internal_flag = special` or `dangerous` (button styling), `highlight_portrait`, `flavor`, `fallback`, `exclusive`.

## Chaining events

`trigger_event` is both "fire now" and "fire later":

```
option = {
	name = chron.0001.a
	trigger_event = { id = chron.0002 days = { 7 14 } }   # random delay range
}
```

`days`, `months`, `years` all work. Saved scopes survive through an unbroken chain: the scribe saved in `chron.0001` is still `scope:scribe` when `chron.0002` fires from it. An `on_trigger_fail` block on the target event runs if its `trigger` fails at delivery time.

One override warning from Chapter 1 bears repeating: **you cannot override a single vanilla event.** Events merge per file, not per object. To change vanilla event behavior you either replace the whole file (fragile) or intercept the flow around it (usually better).

### The event graph

Once you have a few chained events, run **Paradox: Show Event Graph**. It renders your namespaces as an interactive graph: which event triggers which, from which on_action or decision, with dead ends and orphans visible at a glance. Click a node to open the inspector with the event's portraits, options and effects summarized. It is the fastest way to review a chain's structure before testing, and to find the event that nothing fires.

## on_actions: hooking into the game

Events do not fire themselves. Besides decisions and other events, the main entry point is the **on_action**: named hooks the engine calls when things happen. They live in `common/on_action/` (**singular `on_action`**, the classic folder typo). The full catalog with the scopes each hook provides is `common/on_action/_on_actions.info`; each vanilla on_action file also documents its saved scopes in header comments.

A sampling of useful hooks: `on_game_start` (no root; runs before character selection), `on_game_start_after_lobby`, `on_birth_child`, `on_16th_birthday`, `on_death` (fires just before the death is processed, your last chance to move variables to `primary_heir`), `on_war_transferred`, plus the timed pulses:

- `yearly_global_pulse` : every January 1st, no root scope.
- `on_yearly_playable` / `three_year_playable_pulse` / `five_year_playable_pulse` : per playable (count and above) character, spread across the year by birthday.
- `quarterly_playable_pulse` : same, quarterly, with `scope:quarter` (1 to 4).
- `random_yearly_playable_pulse`, `random_yearly_everyone_pulse`, `five_year_everyone_pulse`, `three_year_pool_pulse`.

There is **no monthly pulse**. If you need monthly cadence, chain delayed events or a self-retriggering on_action, or reconsider whether you need it at all (Chapter 10).

### The append pattern (the #1 compatibility rule)

An on_action block can contain `trigger`, `effect`, `events`, `random_events`, `first_valid`, `on_actions` and weights. When two mods (or your mod and vanilla) define the same on_action, **`events`, `random_events` and `on_actions` merge; `trigger` and `effect` overwrite.**

So if you redefine a vanilla on_action's `effect`, you just deleted vanilla's effect and every other mod's. This is the single most common compatibility bug in published mods. The safe pattern is always to append a custom on_action of your own:

```
# CORRECT: append your own on_action to the vanilla hook
on_birth_child = {
	on_actions = { chron_on_birth }
}
chron_on_birth = {
	trigger = {
		scope:child = { exists = mother }
	}
	effect = {
		# your logic, in a namespace nobody else touches
	}
}

# WRONG: clobbers vanilla's (and every other mod's) trigger/effect
on_birth_child = {
	trigger = { ... }
	effect = { ... }
}
```

Your custom on_action (`chron_on_birth`) is entirely yours, so `trigger` and `effect` are safe inside it. This costs one level of indirection and buys compatibility with the entire mod ecosystem.

### Firing events from on_actions

```
chron_yearly = {
	trigger = { is_landed = yes }
	random_events = {
		chance_to_happen = 25       # percent chance anything is even considered
		100 = chron.0010            # weighted pool
		50  = chron.0011
		100 = 0                     # a "0" entry is a chance of nothing
	}
}
```

`events = { id1 id2 delay = { days = 365 } id3 }` fires everything valid (entries after a `delay` wait; delayed events must be valid both at scheduling and delivery). `random_events` picks one by weight. `first_valid` fires the first whose trigger passes. On_actions can also be fired from script: `trigger_event = { on_action = chron_yearly }`.

## Story cycles: per-character clocks

When a mechanic needs its own recurring timer per character (an AI life arc, a slow-burning plot), the right tool is not a global pulse but a **story cycle** (`common/story_cycles/`, schema `_story_cycles.info`). A story attaches to one character (`story_owner`), holds its own variables, and runs `effect_group = { months = { 3 12 } trigger = { } ... }` blocks on randomized intervals, with `on_setup`, `on_end` and `on_owner_death` hooks.

The story IS the pulse, and it touches only its owner. Two habits from production mods: give every AI-driven story a kill switch effect group (`trigger = { story_owner ?= { is_ai = no } }` then `end_story = yes`) so the machinery stops when a player takes over the character, and write real `on_owner_death` cleanup. Chapter 10 develops this into a full design pattern.

## Wiring the chronicle mod

Let us connect Chapter 2's decision to an event. Change the decision's effect:

```
	effect = {
		chron_chronicle_reward_effect = { AMOUNT = chron_chronicle_prestige }
		trigger_event = { id = chron.0001 days = 3 }
	}
```

Three days after commissioning the chronicle, the scribe arrives with a draft (event `chron.0001` above): accept the flattering version for prestige, or pay extra for an honest one. Write loc keys for `chron.0001.t`, `.desc`, `.a`, `.b` in your `chron_l_english.yml`.

Test without waiting: the console command `event chron.0001` fires it instantly on your character. If the window shows raw loc keys, you know which chapter to reread.

## Try it

1. Add `chron.0002`: the finished chronicle is presented at court a season later. Fire it from `chron.0001`'s first option with `trigger_event = { id = chron.0002 months = 3 }`. Reuse `scope:scribe`.
2. Give `chron.0002` a `first_valid` desc that varies if the ruler has `arrogant`.
3. Add a yearly hook: append a `chron_yearly` on_action to `random_yearly_playable_pulse` with a 10 percent chance to fire a small "your chronicle is quoted at a feast" event for rulers who have taken the decision (track it with `set_variable` in the decision effect, check `has_variable` in the event trigger).
4. Open **Paradox: Show Event Graph** and admire your chain. Then check the graph shows the on_action edge into `chron.0010`.

Next: [Chapter 5: Decisions and character interactions](05-decisions-interactions.md) · [Back to index](index.md)
