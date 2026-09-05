# Creating Events — Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
Events are the core of CK3 modding. Every event needs a namespace, an ID, and must be fired by something (on_action, decision, another event, etc.). Events do NOT fire automatically — they must be triggered.

## Minimal Template

```
namespace = my_mod

# A basic character event
my_mod.0001 = {
	type = character_event
	title = my_mod.0001.t
	desc = my_mod.0001.desc

	theme = diplomacy
	cooldown = { years = 5 }   # Prevents re-firing on same character

	left_portrait = {
		character = root
		animation = personality_rational
	}

	trigger = {
		is_available_adult = yes
	}

	immediate = {
		# Effects that happen when the event fires (before player sees it)
	}

	option = {
		name = my_mod.0001.a
		add_gold = 100
	}
}
```

### Required Localization (localization/english/my_mod_events_l_english.yml)
```
l_english:
 my_mod.0001.t: "Event Title"
 my_mod.0001.desc: "This is what happened to [ROOT.Char.GetName]."
 my_mod.0001.a: "Interesting!"
```

## Animations List

Common portrait animations used in `left_portrait` / `right_portrait`:

**Personality animations:**
personality_bold, personality_callous, personality_compassionate, personality_content, personality_cynical, personality_dishonorable, personality_forgiving, personality_greedy, personality_honorable, personality_irrational, personality_rational, personality_zealous, personality_brave, personality_craven

**War animations:**
war_over_win, war_over_loss, war_standing_army

**Emotion/state animations:**
pain, fear, anger, worry, sadness, schadenfreude, happiness, boredom, flirtation, shock, disgust, admiration, prison, sick, dismissal, paranoia, shame, grief, rage, stress, ecstasy, mad

### Portrait Features

**Portrait positions:** Events support multiple portrait positions beyond `left_portrait` and `right_portrait`:
- `center_portrait` — large centered portrait
- `lower_left_portrait` — small portrait, bottom-left
- `lower_center_portrait` — small portrait, bottom-center
- `lower_right_portrait` — small portrait, bottom-right

**Triggered animations** — select animation dynamically based on character state:
```
left_portrait = {
    character = root
    animation = idle
    triggered_animation = {
        trigger = { has_trait = brave }
        animation = personality_bold
    }
    triggered_animation = {
        trigger = { is_at_war = yes }
        animation = war_standing_army
    }
}
```
Multiple `triggered_animation` blocks are evaluated in order; the first matching trigger wins. The base `animation` is the fallback if none match.

**Hiding character identity** — use `hide_info = yes` in a portrait block to hide all identifying UI (name, traits, etc.) for "mysterious stranger" events:
```
right_portrait = {
    character = scope:mystery_person
    animation = idle
    hide_info = yes
}
```

**Artifact display** — show an artifact in an event window:
```
artifact = {
    target = scope:the_artifact
    position = lower_center_portrait
}
```

## Event Types

The most common type is `character_event`. Other types exist for specialized presentation:

### Letter Events
```
my_letter = {
    type = letter_event
    sender = scope:letter_sender    # Required for letter_event
    opening = { ... }
    desc = { ... }

    option = {
        name = my_letter.a
    }
}
```
The `sender` field is required for `letter_event` — it determines who the letter appears to come from. The `opening` block is the salutation line (e.g., "Dear liege,").

Other specialized types: `type = court_event`, `type = activity_event`.

## Themes

Common event themes:

- **General:** default, realm, diplomacy, intrigue, martial, stewardship, learning
- **Conflict/dark:** war, battle, siege, death, dread, dungeon, healthcare, faith, culture
- **Social/activity:** seduce, romance, feast, hunt, murder, friend, rival, pet

### Theme Overrides

You can conditionally override the background or sound of a theme using `override_background` and `override_sound`:
```
override_background = {
    trigger = { is_at_war = yes }
    reference = "gfx/interface/illustrations/event_scenes/ep2_feast.dds"
}

override_sound = {
    trigger = { has_trait = lunatic }
    reference = "event:/SFX/Events/Misc/mad_laughter"
}
```
These go inside the event body alongside `theme`. Multiple overrides can be defined; the first matching trigger wins.

## Event Backgrounds

Common backgrounds used in events (set via `background = { ... }`):

default, corridor, alley_day, alley_night, armory, battlefield, bedchamber, council_chamber, courtyard, dungeon, feast, feast_garden, forest, gallows, garden, market, market_east, market_tribal, physicians_room, prison, ship, sitting_room, study, tavern, terrain, throne_room, throne_room_east, tournament_grounds, village_center, wilderness

## Dynamic Descriptions

Events can use `first_valid` or `random_valid` to show different descriptions based on conditions:

```
desc = {
    first_valid = {
        triggered_desc = {
            trigger = { has_trait = brave }
            desc = event_name.desc_brave
        }
        triggered_desc = {
            trigger = { has_trait = craven }
            desc = event_name.desc_craven
        }
        desc = event_name.desc_default
    }
}
```

Each `triggered_desc` is checked in order; the first one whose `trigger` passes is used. The final bare `desc` acts as the fallback. Remember to add localization keys for every desc variant.

## Common Variants

### Event with multiple options
```
my_mod.0002 = {
	type = character_event
	title = my_mod.0002.t
	desc = my_mod.0002.desc
	theme = intrigue

	left_portrait = {
		character = root
		animation = worry
	}

	option = {
		name = my_mod.0002.a
		add_gold = 100
		stress_impact = {
			greedy = medium_stress_loss
		}
	}

	option = {
		name = my_mod.0002.b
		add_piety = 50
		stress_impact = {
			generous = medium_stress_loss
		}
	}
}
```

### Event Options — Advanced

**Showing unavailable options (grayed-out)** — instead of hiding options the player can't pick, show them disabled with `show_as_unavailable`:
```
option = {
    name = event.expensive_option
    trigger = { gold >= 100 }
    show_as_unavailable = { gold < 100 }   # Shows grayed-out instead of hidden
    effect = { remove_short_term_gold = 100 }
}
```
The `trigger` controls whether the option is actually pickable. The `show_as_unavailable` block shows the option grayed-out with a tooltip explaining why, so the player knows it exists.

**AI behavior on options:**
```
option = {
    name = event.a
    ai_chance = { base = 10 modifier = { add = 20 has_trait = greedy } }
    # OR use ai_will_select (script value syntax, mutually exclusive with ai_chance):
    # ai_will_select = { base = 10 if = { limit = { has_trait = greedy } add = 20 } }
}
```
Use `ai_chance` for weighted random selection among options. Use `ai_will_select` for deterministic selection (highest value wins). They are mutually exclusive — do not use both on the same option.

**Dynamic option names** — option names support the same `triggered_desc` / `first_valid` pattern as `desc`:
```
option = {
    name = {
        first_valid = {
            triggered_desc = {
                trigger = { has_trait = greedy }
                desc = event.option_greedy
            }
            desc = event.option_default
        }
    }
}
```

**Flavor text inside options** — use `flavor` to add narrative text before the mechanical effects:
```
option = {
    name = event.a
    flavor = event.a.flavor    # Loc key for italic flavor text
    add_gold = 100
}
```

### Firing an event from an on_action
Create `common/on_action/my_mod_on_actions.txt`:
```
on_yearly_pulse = {
	on_actions = {
		my_mod_yearly_events
	}
}

my_mod_yearly_events = {
	random_events = {
		chance_of_no_event = {
			value = 75
		}
		100 = my_mod.0001
		50 = my_mod.0002
	}
}
```

### Event chain (one event fires another)
```
my_mod.0010 = {
	type = character_event
	title = my_mod.0010.t
	desc = my_mod.0010.desc
	theme = diplomacy

	left_portrait = {
		character = root
		animation = happiness
	}

	option = {
		name = my_mod.0010.a
		# Save a scope for use in the next event
		random_child = {
			limit = { is_adult = yes }
			save_scope_as = chosen_child
		}
		trigger_event = {
			id = my_mod.0011
			days = 3
		}
	}
}

my_mod.0011 = {
	type = character_event
	title = my_mod.0011.t
	desc = my_mod.0011.desc
	theme = diplomacy

	left_portrait = {
		character = scope:chosen_child
		animation = personality_bold
	}

	option = {
		name = my_mod.0011.a
		scope:chosen_child = {
			add_gold = 50
		}
	}
}
```

### Event with `after` block
```
my_mod.0015 = {
	type = character_event
	title = my_mod.0015.t
	desc = my_mod.0015.desc
	theme = realm

	immediate = {
		add_character_flag = had_merchant_event
	}

	option = {
		name = my_mod.0015.a
		add_gold = 100
	}

	option = {
		name = my_mod.0015.b
		add_prestige = 50
	}

	after = {
		# Runs after ANY option, useful for cleanup
		remove_character_flag = had_merchant_event
	}
}
```

The `after = { }` block runs AFTER whichever option the player picks. This is useful for cleanup (removing flags, clearing variables) that should happen regardless of choice, so you don't have to duplicate cleanup code in every option.

### Event with `on_trigger_fail`
```
my_mod.0025 = {
	type = character_event
	title = my_mod.0025.t
	desc = my_mod.0025.desc
	theme = intrigue

	trigger = { exists = scope:target_char }

	on_trigger_fail = {
		# Runs if a queued/delayed event fails its trigger
		# Use for cleanup when delayed events become invalid
		scope:quest_giver = { remove_character_flag = waiting_for_result }
	}

	option = {
		name = my_mod.0025.a
	}
}
```
`on_trigger_fail` is critical for delayed events (`trigger_event` with `days`). If the trigger is no longer valid when the event tries to fire (e.g., the target character died), the `on_trigger_fail` block runs instead, letting you clean up flags, variables, or other state.

### Scripted effects defined locally in event file
```
namespace = my_mod

scripted_effect my_reward_effect = {
	add_gold = 100
	add_prestige = 50
}

my_mod.0020 = {
	type = character_event
	# ...
	option = {
		name = my_mod.0020.a
		my_reward_effect = yes
	}
}
```

### Event Widgets

Widgets allow player interaction beyond simple option buttons (naming characters, entering text, viewing progress):
```
my_mod.0030 = {
    type = character_event
    title = my_mod.0030.t
    desc = my_mod.0030.desc
    theme = diplomacy

    widgets = {
        widget = {
            gui = "event_window_widget_name_character"
            container = "custom_widget_container"
            controller = name_character    # Player names a character
            setup_scope = { saved_scope = scope:child }
        }
    }

    option = {
        name = my_mod.0030.a
    }
}
```

**Available widget controllers:**
- `name_character` — lets the player name a character (e.g., newborn naming events)
- `text` — free text input from the player
- `event_chain_progress` — displays a progress bar for event chains
- `default` — generic widget with no special controller behavior

The `gui` field references a widget GUI definition, `container` is the UI container in the event window, and `setup_scope` passes the relevant scope to the widget.

### Scope = none (Global Events)

Events can use `scope = none` for global events that have no character root:
```
my_mod.9999 = {
    type = character_event
    scope = none    # No root character — for global/system events
    title = my_mod.9999.t
    desc = my_mod.9999.desc
    theme = default

    option = {
        name = my_mod.9999.a
    }
}
```
This is useful for events fired from `on_game_start` or other on_actions that don't have a character scope.

## On_actions Reference

Common on_actions and their ROOT scope:

| on_action | ROOT scope |
|---|---|
| `on_birth` | child |
| `on_death` | dying character |
| `on_war_started` | primary attacker |
| `on_war_ended` | primary attacker |
| `on_title_gain` | new holder |
| `on_title_lost` | old holder |
| `on_marriage` | spouse who married |
| `on_divorce` | spouse who divorced |
| `on_faith_change` | character |
| `on_culture_change` | character |
| `on_game_start` | (no character scope) |
| `on_game_start_after_lobby` | (no character scope) |

**Yearly/pulse on_actions:** ROOT = a random character matching the on_action's criteria.
- `yearly_global_pulse` — fires once per year, no character scope
- `on_yearly_playable` — fires for each playable character once per year
- `three_year_playable_pulse` — every 3 years for playable characters
- `five_year_playable_pulse` — every 5 years for playable characters
- `quarterly_playable_pulse` — every 3 months for playable characters
- `random_yearly_playable_pulse` — once per year for a random playable character
- `random_yearly_everyone_pulse` — once per year for a random character (including non-playable)

### On_action Structure — Advanced

On_actions support more than just event lists. Full structure:

**Direct effect block** — runs effects directly, concurrently with events. Note: scopes set in `effect` do NOT carry into fired events.
```
my_on_action = {
    effect = {
        every_player = { add_prestige = 10 }
    }
    events = {
        my_mod.0001
    }
}
```

**first_valid** — fires the first event whose trigger passes:
```
my_on_action = {
    first_valid = {
        my_mod.0001    # Tried first
        my_mod.0002    # Tried if .0001's trigger fails
        my_mod.0099    # Fallback
    }
}
```

**random_on_actions** — weighted random selection among sub-on_actions:
```
my_on_action = {
    random_on_actions = {
        100 = on_action_a
        200 = on_action_b
    }
}
```

**first_valid_on_action** — fires the first sub-on_action whose trigger passes:
```
my_on_action = {
    first_valid_on_action = {
        on_action_a
        on_action_b
    }
}
```

**delay** — adds a delay between events in a list:
```
my_on_action = {
    events = {
        my_mod.0001
        delay = { days = 365 }
        my_mod.0002    # Fires 365 days after .0001
    }
}
```

**chance_to_happen** — percentage gate evaluated before the on_action's events:
```
my_on_action = {
    chance_to_happen = 25    # 25% chance this on_action does anything at all
    events = {
        my_mod.0001
    }
}
```

**fallback** — fires another on_action if nothing in this one fired:
```
my_on_action = {
    fallback = another_on_action
    events = {
        my_mod.0001
    }
}
```

**Firing an on_action from script** — use `trigger_event` with `on_action`:
```
trigger_event = { on_action = my_on_action }
```

**Zero-weight entry trick** — in `random_events`, use `100 = 0` to create a weighted chance of nothing firing (alternative to `chance_of_no_event`):
```
random_events = {
    100 = 0              # 50% chance nothing fires
    50 = my_mod.0001
    50 = my_mod.0002
}
```

### Appending to Vanilla On_actions (Safe Pattern)

To add your events to a vanilla on_action without overriding it, nest your own on_action inside:
```
# In your mod's common/on_action/my_mod_on_actions.txt
# This is SAFE — it appends, does NOT override vanilla:
some_vanilla_on_action = {
    on_actions = { my_mod_on_action }
}

my_mod_on_action = {
    events = { my_mod.0001 }
}
```
This works because CK3 merges on_action files additively. Your `on_actions = { ... }` list gets appended to the vanilla definition rather than replacing it.

## Checklist
- [ ] Event file in `events/` folder with `.txt` extension
- [ ] `namespace = X` on the first line of the file
- [ ] Event ID matches namespace: `X.0001`
- [ ] Localization keys for title (`.t`), description (`.desc`), and each option (`.a`, `.b`, etc.)
- [ ] Localization `.yml` UTF-8 **with BOM** (mandatory); event `.txt` UTF-8 (BOM optional, vanilla ships with it)
- [ ] Event is fired from somewhere (on_action, decision, another event, `trigger_event`)
- [ ] Test with `event my_mod.0001` in console

## Common Pitfalls
- **Event never fires**: Events must be triggered by something — they don't fire on their own. Use on_actions, decisions, or `trigger_event`
- **Namespace mismatch**: Event ID `my_mod.0001` requires `namespace = my_mod` at the top of the file
- **Effects in trigger block**: `trigger = {}` only accepts triggers, not effects. Put effects in `immediate = {}` or inside `option = {}`
- **Scope confusion**: `root` in an event is the character who received the event, not necessarily the player
- **Using scope: with root/prev**: Never write `scope:root` — just write `root`. The `scope:` prefix is only for saved scopes
- **Localization error spam**: If using dynamic loc like `[ROOT.Char.GetName]`, make sure the scope exists. Use `ROOT.Char` not just `ROOT`
- **Missing portraits**: If `character = scope:someone` is used in a portrait block, that scope must be saved in `immediate = {}` before the player sees the event
- **File encoding**: Localization `.yml` MUST be UTF-8 with BOM or it fails silently. Script `.txt` works as plain UTF-8; BOM is harmless and matches vanilla
- **Removing gold**: Use `remove_short_term_gold = 50`, not `add_gold = -50`. Negative add_gold causes a "missing perspective" error
- **Loc scope prefix**: In localization, do NOT use `scope:` prefix for saved scopes. Write `[the_merchant.GetName]`, not `[scope:the_merchant.GetName]`
- **Delayed events and loc**: When using `trigger_event = { id = X days = Y }`, saved scopes are available to script but NOT to localization in the target event. If you need to reference a saved scope in loc, fire the event immediately (`trigger_event = X`) or re-save the scope in the target event's `immediate` block
- **Delayed scope pitfall**: When using `trigger_event` with `days = X`, saved scopes may become invalid if the target character dies or titles change hands during the delay. Always guard with `exists = scope:saved_char` in the triggered event's `trigger` block to prevent errors from referencing a scope that no longer exists
