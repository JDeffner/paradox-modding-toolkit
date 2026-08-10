# Creating Activities — Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
Activities are large-scale social/travel events (feasts, hunts, pilgrimages, tournaments) that a character hosts. They involve guest invitations, travel, phases (the "stages" of the activity), options (customization choices), intents (what participants hope to achieve), and on_action hooks for scripting events throughout the lifecycle.

Activities are complex — the full .info reference is 1020 lines. This pattern covers the practical essentials for creating a custom activity. For every field, see `common/activities/activity_types/_activity_type.info`.

### Character States During an Activity
Characters cycle through three states per phase:
1. **Travel** — travelling to the phase location
2. **Passive** — arrived, waiting for the phase to begin
3. **Active** — phase is underway

### File Locations
- Activity type definition: `common/activities/activity_types/my_activity.txt`
- Events fired during the activity: `events/my_activity_events.txt`
- Guest invite rules (if custom): `common/activities/guest_invite_rules/`
- Activity intents (if custom): `common/activities/intents/`
- Localization: `localization/english/activity_my_activity_l_english.yml`

## Minimal Template

```
activity_my_celebration = {
	################
	# VISIBILITY
	################
	# root = character trying to host
	is_shown = {
		highest_held_title_tier > tier_barony
		is_landed_or_landless_administrative = yes
	}

	# Show pass/fail requirements
	can_start_showing_failures_only = {
		NOT = { is_activity_type_on_cooldown = activity_my_celebration }
		is_available_adult = yes
	}

	################
	# VALIDITY
	################
	# root = the activity (not the host!)
	is_valid = {
		scope:host = {
			is_alive = yes
			is_imprisoned = no
			is_landed_or_landless_administrative = yes
			NOT = { is_incapable = yes }
		}
		# Invalidate if no guests show up once active
		trigger_if = {
			limit = { is_current_phase_active = yes }
			has_attending_activity_guests = yes
		}
	}

	on_invalidated = {
		# Handle cleanup when activity becomes invalid
		# root = the activity, scope:host = host
		if = {
			limit = { scope:host = { is_imprisoned = yes } }
			every_attending_character = {
				limit = { this != scope:host }
				trigger_event = my_celebration.9001
			}
		}
	}

	on_host_death = {
		every_attending_character = {
			limit = { is_alive = yes }
			trigger_event = {
				id = my_celebration.9002
				days = 1
			}
		}
	}

	################
	# LOCATION
	################
	is_single_location = yes           # All phases in same province
	province_filter = domicile_domain  # Player picks from domain
	ai_province_filter = capital       # AI just uses capital

	is_location_valid = {
		has_holding = yes
	}

	province_score = {
		value = 0
		if = {
			limit = { has_building_or_higher = leisure_palace_01 }
			add = 100
		}
	}

	max_province_icons = 5

	################
	# COST & COOLDOWN
	################
	cost = {
		gold = {
			add = {
				value = medium_gold_value
				desc = celebration_base_cost
			}
		}
	}

	cooldown = { years = 5 }

	################
	# TIMING
	################
	wait_time_before_start = { days = 30 }
	max_guest_arrival_delay_time = { months = 8 }

	################
	# GUESTS
	################
	max_guests = 30

	guest_invite_rules = {
		rules = {
			3 = activity_invite_rule_extended_family
			4 = activity_invite_neighbouring_rulers
			6 = activity_invite_mp
		}
		defaults = {
			1 = activity_invite_rule_friends
			1 = activity_invite_rule_close_family
			1 = activity_invite_rule_vassals
			2 = activity_invite_rule_fellow_vassals
			3 = activity_invite_rule_courtiers
		}
	}

	can_be_activity_guest = {
		is_adult = yes
		is_healthy = yes
		in_diplomatic_range = scope:host
	}

	guest_join_chance = {
		base = 10
		base_activity_modifier = yes
		activity_guest_shared_ai_accept_modifier = yes
	}

	################
	# INTENTS
	################
	host_intents = {
		intents = { reduce_stress_intent befriend_attendee_intent }
		default = reduce_stress_intent
	}

	guest_intents = {
		intents = { reduce_stress_intent befriend_attendee_intent }
		default = reduce_stress_intent
	}

	################
	# OPTIONS
	################
	options = {
		celebration_food_quality = {
			celebration_food_basic = {
				default = yes
				ai_will_do = { value = 50 }
			}
			celebration_food_lavish = {
				is_valid = {
					short_term_gold >= major_gold_value
				}
				cost = {
					gold = { add = major_gold_value }
				}
				ai_will_do = {
					value = 20
					if = {
						limit = { ai_greed < 0 }
						add = 30
					}
				}
			}
		}
	}

	# If you want the player to pick an option BEFORE selecting location:
	# special_option_category = celebration_food_quality

	################
	# PHASES
	################
	phases = {
		celebration_main_phase = {
			is_predefined = yes
			order = 1

			is_shown = { always = yes }
			is_valid = { always = yes }

			on_phase_active = {
				if = {
					limit = { this = scope:host }
					# Set the phase duration
					scope:activity = {
						progress_activity_phase_after = { months = 1 }
					}
				}
			}

			on_end = {
				# Cleanup when phase ends
			}
		}
	}

	################
	# AI BEHAVIOR
	################
	ai_will_do = {
		value = 30
		add = {
			value = ai_sociability
			multiply = 0.5
		}
	}

	ai_check_interval = 36  # Check every 36 months

	################
	# LIFECYCLE HOOKS
	################
	on_start = {
		# Fires when activity is created
		# root = the activity, scope:host = host
	}

	on_complete = {
		# Fires after last phase ends
		# root = character, scope:activity = the activity, scope:host = host
		if = {
			limit = { this = scope:host }
			# Give rewards to host
			trigger_event = my_celebration.7001
		}
	}

	################
	# VISUALS
	################
	background = {
		texture = "gfx/interface/illustrations/event_scenes/ep2_feast.dds"
		environment = "environment_feast"
		ambience = "event:/SFX/Events/Feast/Feast"
	}
}
```

### Required Localization

```
l_english:
 activity_my_celebration: "My Celebration"
 activity_my_celebration_desc: "Host a grand celebration."
 activity_my_celebration_province_desc: "A celebration held at [activity_province.GetName]."
 activity_my_celebration_host_desc: "[HOST.Char.GetName] is hosting a celebration."
 activity_my_celebration_conclusion_desc: "The celebration has concluded."
 celebration_food_quality: "Food Quality"
 celebration_food_basic: "Simple Fare"
 celebration_food_basic_desc: "Basic food and drink."
 celebration_food_lavish: "Lavish Banquet"
 celebration_food_lavish_desc: "Spare no expense on the finest dishes."
 celebration_main_phase: "Celebration"
 celebration_base_cost: "Base cost"
```

## Common Variants

### Multi-Phase Activity (like a Tournament)
```
phases = {
	opening_ceremony = {
		is_predefined = yes
		order = 1
		on_phase_active = {
			if = {
				limit = { this = scope:host }
				scope:activity = { progress_activity_phase_after = { days = 14 } }
			}
		}
	}
	main_competition = {
		is_predefined = yes
		order = 2
		on_phase_active = {
			if = {
				limit = { this = scope:host }
				scope:activity = { progress_activity_phase_after = { months = 1 } }
			}
		}
	}
	closing_feast = {
		is_predefined = yes
		order = 3
		on_phase_active = {
			if = {
				limit = { this = scope:host }
				scope:activity = { progress_activity_phase_after = { days = 7 } }
			}
		}
	}
}
```

### Pickable Phases (player chooses which phases to include)
```
num_pickable_phases = 2  # Player picks 2 phases beyond predefined ones

phases = {
	required_phase = {
		is_predefined = yes  # Always present
		order = 1
	}
	optional_archery = {
		is_predefined = no   # Pickable
		order = 2
		ai_will_do = { value = 50 }
		can_pick = { always = yes }
		cost = { gold = { add = minor_gold_value } }
	}
	optional_jousting = {
		is_predefined = no
		order = 2
		ai_will_do = { value = 30 }
		can_pick = { always = yes }
		cost = { gold = { add = medium_gold_value } }
	}
}
```

### Special Guests (like a Wedding's Bride)
```
special_guests = {
	guest_of_honor = {
		is_shown = { always = yes }
		is_required = yes  # Activity invalidates if they decline
		can_pick = {
			is_adult = yes
			in_diplomatic_range = scope:host
		}
		ai_will_do = { value = 10 }
		on_invite = {
			# Runs when the invite is sent
		}
	}
}
```

### Special Option Category (chosen before location)
Use this when the option fundamentally changes the activity type (e.g., feast vs murder feast, hunt vs falconry). The player picks this FIRST, before choosing location.
```
options = {
	special_type = {
		my_activity_normal = {
			default = yes
			ai_will_do = { value = 50 }
		}
		my_activity_special = {
			is_valid = {
				# Some requirement
			}
			ai_will_do = { value = 20 }
			# Can block certain intents or phases
			blocked_intents = { befriend_attendee_intent }
			blocked_phases = { closing_feast }
		}
	}
}

special_option_category = special_type
```

### Options That Block Phases
```
options = {
	format_choice = {
		grand_format = {
			default = yes
			ai_will_do = { value = 50 }
		}
		quick_format = {
			# Removes optional phases, keeping only the core
			blocked_phases = { optional_archery optional_jousting }
			ai_will_do = { value = 30 }
		}
	}
}
```

### Open Invite Activity (anyone can join)
```
open_invite = yes                 # Anyone meeting requirements can attend
allow_zero_guest_invites = yes    # Can start with no specific invites
```

### Travel Entourage (who travels with participants)
```
travel_entourage_selection = {
	weight = {
		value = 10
		if = {
			limit = { has_trait = brave }
			add = 20
		}
	}
	max = 4        # Player entourage size
	ai_max = 2     # AI entourage size
	invite_rule_order = 3
}
```

### Pulse Events During Phases
```
phases = {
	main_phase = {
		is_predefined = yes
		order = 1

		# Fires monthly for each character in the phase
		on_monthly_pulse = {
			trigger_event = { id = my_celebration.1001 }
		}

		# Fires weekly (use sparingly — performance)
		on_weekly_pulse = {
			trigger_event = { id = my_celebration.1002 }
		}
	}
}
```

### State-Based Hooks (on the activity type, not the phase)
```
# These fire for ALL phases — use for cross-cutting concerns
on_enter_travel_state = { }    # Character starts travelling
on_enter_passive_state = { }   # Character arrived, waiting
on_enter_active_state = { }    # Phase becomes active
on_leave_travel_state = { }
on_leave_passive_state = { }
on_leave_active_state = { }

# Pulse events per state (fire on the activity's event pulse interval)
on_travel_state_pulse = { }
on_passive_state_pulse = { }
on_active_state_pulse = { }
```

## Key Differences Between Vanilla Activity Types

| Activity | Phases | Special Guests | Special Option | Key Feature |
|----------|--------|----------------|----------------|-------------|
| **Feast** | 1 (meal) | Honorary guest (murder feast) | Yes (generic/legendary/murder) | Simple single-phase, rich option system |
| **Hunt** | 1 | None | Yes (hunt/falconry) | Animal tracking variables, outdoor setting |
| **Tournament** | Multiple pickable | Champion | Yes | Multi-phase with archery/joust/melee |
| **Pilgrimage** | Multi-location | None | No | Travel-focused, multiple provinces |
| **Wedding** | 1 | Bride/groom | No | Required special guests |
| **Tour** | Multi-location | None | No | Province holder interaction |

## Checklist

### Files to Create/Modify
- [ ] `common/activities/activity_types/my_activity.txt` — the activity definition
- [ ] `events/my_activity_events.txt` — events fired during the activity
- [ ] `localization/english/activity_my_activity_l_english.yml` — all loc keys

### Localization Keys Needed
- [ ] `activity_<key>` — activity name
- [ ] `activity_<key>_desc` — activity description
- [ ] `activity_<key>_province_desc` — province description (or custom via `province_description`)
- [ ] `activity_<key>_host_desc` — host description (or custom via `host_description`)
- [ ] `activity_<key>_conclusion_desc` — conclusion description (or custom via `conclusion_description`)
- [ ] `<phase_key>` — name for each phase
- [ ] `<option_category_key>` — name for each option category
- [ ] `<option_key>` — name for each option
- [ ] `<option_key>_desc` — description for each option
- [ ] `<special_guest_key>` — name for each special guest slot
- [ ] `<special_guest_key>_for_host` — special guest name shown to the host
- [ ] Cost description keys (used in `desc =` inside cost blocks)

### Minimum Viable Activity
- [ ] `is_shown` with basic requirements (landed, tier check)
- [ ] `can_start_showing_failures_only` with cooldown check
- [ ] `is_valid` checking host is alive/capable
- [ ] At least one predefined phase with `on_phase_active` calling `progress_activity_phase_after`
- [ ] `cost` block with at least gold
- [ ] `cooldown` to prevent spam
- [ ] `guest_invite_rules` with at least defaults
- [ ] `max_guests` set to a reasonable number (20-40)
- [ ] `host_intents` and `guest_intents` with at least a default
- [ ] `guest_join_chance` with base value
- [ ] `ai_will_do` and `ai_check_interval` so AI will host it
- [ ] `on_complete` for rewards/conclusion events
- [ ] All localization keys

### Testing
- [ ] Activity appears in the activity list for an eligible character
- [ ] Can plan and start the activity
- [ ] Guests receive invitations and travel
- [ ] Phase activates and runs for expected duration
- [ ] Conclusion event fires on completion
- [ ] AI hosts the activity periodically
- [ ] Cooldown prevents re-hosting too quickly
- [ ] Invalidation handles edge cases (host death, imprisonment, no guests)

## Common Pitfalls

### Phase never progresses
Every phase MUST call `progress_activity_phase_after` in `on_phase_active` to set its duration. Without this, the activity stalls forever. Always gate it with `if = { limit = { this = scope:host } }` so it only fires once.

### Confusing scope: root varies by block
- In `is_shown`, `can_start`, `can_start_showing_failures_only`: root = the character trying to host
- In `is_valid`, `on_invalidated`, `on_host_death`: root = the activity
- In `on_start`: root = the activity
- In `on_complete`: root = the character (fires for each participant)
- In phase hooks (`on_phase_active`, `on_enter_phase`, `on_end`, pulse hooks): root = character in the phase
- In `cost`, `province_score`, `is_location_valid`: root = province or host (check .info)

### Activity invalidates immediately
If `is_valid` checks for attending guests without gating on `is_current_phase_active = yes`, the activity will invalidate during travel before anyone arrives. Always wrap the guest check:
```
trigger_if = {
	limit = { is_current_phase_active = yes }
	has_attending_activity_guests = yes
}
```

### Guests never arrive
Set `wait_time_before_start` and/or `max_guest_arrival_delay_time` to give guests time to travel. Without these, the activity may start before anyone gets there.

### AI never hosts the activity
- `ai_will_do` must exceed the define `ACTIVITY_SCORE_THRESHOLD` (check game defines)
- `ai_check_interval` controls how often AI evaluates — set it reasonably (12-48 months)
- `ai_province_filter` should be `capital` for AI (not `realm` or `all` — performance)
- Make sure `is_shown` does not have overly restrictive triggers for AI

### Missing localization keys
Activities need many loc keys. Missing keys show as raw keys like `activity_my_celebration` in the UI. Check all: activity name, description, province desc, host desc, conclusion desc, phase names, option names, option descs, cost descs, special guest names.

### Performance with too many guests
Keep `max_guests` reasonable (under 50). High guest counts cause performance issues because every guest needs travel pathfinding and intent evaluation. Use `reserved_guest_slots` if you add guests via effects/events mid-activity.

### Options not showing up
Options need both `is_shown` (defaults to always true if omitted) and `is_valid`. One option in each category must have `default = yes` or a `default = { <trigger> }` block, otherwise the game cannot select a default.

### Province filter performance
Never use `province_filter = all` for AI (`ai_province_filter`). Use `capital` or `domain` for AI. Even for players, prefer `domain` or `domicile_domain` over `realm` or `all`.
