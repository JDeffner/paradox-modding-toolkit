# Creating Story Cycles — Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
Story cycles are long-running narrative engines that periodically fire events on a character over time. They drive multi-event arcs (pet ownership, murder mysteries, invasions) by checking conditions on a timer and triggering events when conditions are met. A story cycle has an owner (a character), stores variables on itself, and ticks effect groups at configurable intervals until explicitly ended.

Story cycles are defined in `common/story_cycles/` and started from events or scripted effects via `create_story = story_cycle_key`. The root scope inside a story cycle is the story itself; access the owning character with `story_owner`.

> Reference docs: common/story_cycles/_story_cycles.info

## Minimal Template

### common/story_cycles/my_story_cycle.txt
```
my_story_cycle = {

	on_setup = {
		# Runs once when the story is created via create_story
		# root = the story cycle, story_owner = the character
		story_owner = {
			add_character_flag = has_my_story
		}
		set_variable = {
			name = story_stage
			value = 0
		}
	}

	on_end = {
		# Runs when end_story = yes is called
		story_owner = {
			remove_character_flag = has_my_story
		}
	}

	on_owner_death = {
		# Runs when the story owner dies
		# Either transfer to heir or end the story
		scope:story = { end_story = yes }
	}

	# Periodic event firing
	effect_group = {
		days = { 180 365 }    # Random interval between 180-365 days
		chance = 50            # 50% chance each tick

		trigger = {
			story_owner = { is_alive = yes }
		}

		first_valid = {
			triggered_effect = {
				trigger = { always = yes }
				effect = {
					story_owner = {
						trigger_event = my_story_events.0001
					}
				}
			}
		}
	}
}
```

### Starting the story (from an event or scripted effect)
```
# In an event option or effect block:
create_story = my_story_cycle
```
The character executing `create_story` becomes the `story_owner`. The `on_setup` block runs immediately.

### Ending the story (from an event)
```
# From within the story owner's scope:
story_owner = {
	any_owned_story = {
		limit = { story_type = my_story_cycle }
		end_story = yes    # Triggers on_end, then destroys the story
	}
}
```

### Localization (localization/english/my_story_cycle_l_english.yml)
Story cycles themselves do not require localization keys. All player-facing text lives in the events they fire. Localize your events, modifiers, and character flags as needed.

## Common Variants

### Timed death / expiration (like pet dog dying)
An effect group that fires once after a long delay to end the arc.
```
	# The story concludes after some time
	effect_group = {
		days = { 3000 5000 }    # Fires once, 8-14 years in
		chance = 100

		triggered_effect = {
			trigger = {
				exists = story_owner
				story_owner = { is_alive = yes }
			}
			effect = {
				story_owner = {
					trigger_event = my_story_events.9999    # Conclusion event
				}
			}
		}
	}
```

### Maintenance / state-checking group (like murders_at_court)
A fast-ticking group that monitors conditions and reacts to world changes.
```
	# Maintenance: check if key character is still alive/present
	effect_group = {
		days = { 15 30 }

		first_valid = {
			triggered_effect = {
				trigger = {
					var:target_character = { is_alive = no }
				}
				effect = {
					story_owner = {
						trigger_event = my_story_events.8000    # Target died
					}
				}
			}
			triggered_effect = {
				trigger = {
					var:target_character = {
						NOT = { is_courtier_of = scope:story.story_owner }
					}
				}
				effect = {
					story_owner = {
						trigger_event = my_story_events.8001    # Target left court
					}
				}
			}
		}
	}
```

### Transfer story to heir on owner death
```
	on_owner_death = {
		if = {
			limit = {
				exists = story_owner.player_heir
				story_owner.player_heir = {
					is_alive = yes
				}
			}
			# Transfer ownership
			make_story_owner = story_owner.player_heir
			# Optionally notify the new owner
			story_owner = {
				trigger_event = {
					id = my_story_events.5000
					days = { 5 15 }
				}
			}
		}
		else = {
			scope:story = { end_story = yes }
		}
	}
```

### Escalation / branching with story variables
Use variables on the story to track state and branch effect groups accordingly.
```
	on_setup = {
		set_variable = {
			name = escalation
			value = 0
		}
		set_variable = {
			name = story_state
			value = flag:phase_one
		}
	}

	# Phase-dependent events
	effect_group = {
		days = { 60 120 }

		first_valid = {
			triggered_effect = {
				trigger = {
					var:story_state = flag:phase_one
					var:escalation >= 3
				}
				effect = {
					set_variable = {
						name = story_state
						value = flag:phase_two
					}
					story_owner = {
						trigger_event = my_story_events.2000
					}
				}
			}
			triggered_effect = {
				trigger = {
					var:story_state = flag:phase_one
				}
				effect = {
					change_variable = {
						name = escalation
						add = 1
					}
					story_owner = {
						trigger_event = {
							on_action = my_story_ongoing_events
						}
					}
				}
			}
		}
	}
```

### Firing random events via on_action
Instead of picking events directly, delegate to an on_action for cleaner organization.
```
		triggered_effect = {
			trigger = { always = yes }
			effect = {
				story_owner = {
					trigger_event = {
						on_action = ongoing_my_story_events
					}
				}
			}
		}
```
Then in `common/on_action/my_story_on_actions.txt`:
```
ongoing_my_story_events = {
	random_events = {
		100 = my_story_events.1001
		100 = my_story_events.1002
		100 = my_story_events.1003
		200 = 0    # 0 = nothing happens
	}
}
```

## Effect Group Selection Logic

Each `effect_group` can contain one of three selection blocks (or a standalone `triggered_effect`):

| Block | Behavior |
|---|---|
| `triggered_effect` (standalone) | Fires if its trigger passes. Only one allowed per group outside a selection block. |
| `first_valid { }` | Evaluates triggered_effects top to bottom; fires the FIRST one whose trigger passes. |
| `random_valid { }` | Collects all triggered_effects whose triggers pass; fires ONE at random. |
| `fallback { }` | Runs only if NO triggered_effect in the group fired. |

## Scoping Reference

| Scope | What it is |
|---|---|
| `root` | The story cycle itself |
| `scope:story` | Same as root (the story cycle) |
| `story_owner` | The character who owns the story |
| `var:my_var` | A variable stored on the story |
| `story_owner.var:my_var` | A variable stored on the owner character |

## AI Behavior
Story cycles fire identically for AI and player characters. There is no built-in AI weight system in story cycles themselves. If you want AI-only or player-only behavior:
- Gate `create_story` behind `is_ai = no` / `is_ai = yes` triggers in the event or decision that starts the cycle
- Use `is_ai` triggers inside effect_group triggers to skip expensive event chains for AI characters
- AI characters will pick event options based on the `ai_chance` weights defined in those events, not in the story cycle

## Checklist
- [ ] Story cycle file in `common/story_cycles/` with `.txt` extension
- [ ] `on_setup` block initializes variables and applies modifiers/flags
- [ ] `on_end` block cleans up modifiers, flags, and variables
- [ ] `on_owner_death` either transfers via `make_story_owner` or calls `end_story = yes`
- [ ] At least one `effect_group` with a `days` interval to drive the narrative
- [ ] Events referenced in `trigger_event` exist and are defined
- [ ] Story is started somewhere: an event, decision, or on_action calls `create_story = my_story_cycle`
- [ ] If using on_actions for random events, the on_action file exists
- [ ] Localization covers all events fired by the story (story cycles themselves need no loc)
- [ ] Test: start the story via console `effect = { create_story = my_story_cycle }` on a character

## Common Pitfalls
- **Story never fires events**: Every `effect_group` needs a `days` (or `weeks`/`months`/`years`) value. Without it, the group never ticks. Also check that `chance` is not 0 and the `trigger` block passes.
- **Story never ends**: You must explicitly call `end_story = yes` somewhere (in an event, in `on_owner_death`, or in an effect group). Stories do not auto-expire.
- **Orphaned story on death**: If `on_owner_death` does not call `end_story = yes` or `make_story_owner`, the story persists on a dead character and keeps ticking with a dead `story_owner`. Always handle this case.
- **Duplicate stories**: There is no built-in uniqueness check. Guard `create_story` with a character flag (e.g., `has_character_flag = has_my_story`) and set it in `on_setup` to prevent stacking.
- **Variables on story vs. character**: `set_variable` inside a story cycle sets it on the story (`root`). To set on the character, scope to `story_owner = { set_variable = { ... } }`. Mixing these up causes "variable does not exist" errors.
- **Trigger scope confusion**: Inside effect_group triggers, `root` is the story, not the character. Always use `story_owner` to check character conditions.
- **Random interval of 0**: Using `days = { 0 1 }` can cause the group to fire every single day, which is extremely expensive. Use reasonable minimums (15+ days for maintenance, 60+ for narrative events).
- **Cleaning up modifiers**: If `on_setup` adds a character_modifier, `on_end` must remove it. If the story ends without cleanup (e.g., via a bug or save corruption), the modifier persists forever.
- **first_valid order matters**: In a `first_valid` block, put the most specific triggers first. A broad `always = yes` trigger at the top will prevent anything below it from ever firing.
