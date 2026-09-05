# Creating Court Positions — Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
Court positions are characters hired by a ruler to fill a role in their court. They are defined in `common/court_positions/types/` and require localization. Each position has an aptitude system (terrible through excellent) that scales modifiers applied to the employer. The holder gets a salary, opinion bonus toward their liege, and optional modifiers.

Key scopes: `scope:liege` (the employer/ruler), `scope:employee` (the courtier holding the position). In `aptitude`, root is the employee.

> Reference docs: common/court_positions/types/_court_positions.info

## Minimal Template

### common/court_positions/types/my_court_positions.txt
```
my_advisor_court_position = {
	max_available_positions = 1
	minimum_rank = duchy        # county/duchy/kingdom/empire — defaults to county
	skill = diplomacy           # Primary skill shown in UI: diplomacy/martial/stewardship/intrigue/learning/prowess

	opinion = {
		value = 20              # Opinion bonus employee gets toward liege
	}

	aptitude_level_breakpoints = { 20 40 60 80 }

	aptitude = {
		value = 1
		add = {
			value = diplomacy
			multiply = 2
			max = 50
			desc = court_position_skill_diplomacy
		}
	}

	# When is the position shown in the UI? (root = court owner)
	is_shown = { }

	# Can this ruler actually hire for this position? (root = court owner)
	valid_position = {
		highest_held_title_tier >= tier_duchy
	}

	# Is this character shown as a candidate? (scope:liege, scope:employee)
	is_shown_character = {
		scope:employee = {
			is_adult = yes
		}
	}

	# Is this character eligible? (scope:liege, scope:employee)
	valid_character = { }

	revoke_cost = {
		prestige = {
			value = minor_court_position_prestige_revoke_cost
		}
	}

	salary = {
		gold = {
			value = minor_court_position_salary
		}
		round = no
	}

	# Modifiers applied to the EMPLOYER, scaling with aptitude tier
	scaling_employer_modifiers = {
		terrible = {
			monthly_diplomacy_lifestyle_xp_gain_mult = 0.01
		}
		poor = {
			monthly_diplomacy_lifestyle_xp_gain_mult = 0.02
		}
		average = {
			monthly_diplomacy_lifestyle_xp_gain_mult = 0.03
		}
		good = {
			monthly_diplomacy_lifestyle_xp_gain_mult = 0.05
		}
		excellent = {
			monthly_diplomacy_lifestyle_xp_gain_mult = 0.08
		}
	}

	# Modifier applied to the HOLDER (employee)
	modifier = {
		monthly_prestige = 0.5
	}

	on_court_position_received = { }
	on_court_position_revoked = { }
	on_court_position_invalidated = { }
	on_court_position_vacated = { }

	# AI: should the liege hire this position at all? >0 = hire, <-50 = fire
	ai_position_score = {
		value = 50
	}

	# AI: score per candidate. Aim for ~100 baseline.
	ai_candidate_score = {
		value = 50
		add = court_position_candidate_score_base_value
		add = court_position_candidate_aptitude_value
	}
}
```

### Localization (localization/english/my_court_positions_l_english.yml)
```
l_english:
 my_advisor_court_position: "My Advisor"
 my_advisor_court_position_desc: "A trusted advisor who counsels the ruler on diplomatic matters."

 # Tooltip for employer scaling modifiers (optional but recommended)
 my_advisor_court_position_employer_effect: "Provides diplomatic insight to the court."
```

The naming convention for court position loc keys:
- `<position_key>` — display name
- `<position_key>_desc` — description shown in tooltip
- Overrides via `court_position_asset { localization_key = alt_key }` are possible for culture/government variants

## Common Variants

### Non-scaling flat employer modifier (base_employer_modifier)
```
my_guard_court_position = {
	# ... standard fields ...

	# Flat modifier on employer regardless of aptitude
	base_employer_modifier = {
		knight_limit = 1
	}

	# Plus aptitude-scaling modifiers on top
	scaling_employer_modifiers = {
		terrible = { prowess = 1 }
		poor = { prowess = 2 }
		average = { prowess = 3 }
		good = { prowess = 5 }
		excellent = { prowess = 8 }
	}
}
```

### Court-wide modifier (scaling_employer_court_modifiers)
Applies to all courtiers (not the liege). Used by e.g. the Court Physician for health.
```
	scaling_employer_court_modifiers = {
		terrible = { health = 0.01 }
		poor = { health = 0.03 }
		average = { health = 0.05 }
		good = { health = 0.07 }
		excellent = { health = 0.1 }
	}
```

### Multiple available positions
```
	max_available_positions = 3  # Up to 3 people can hold this position simultaneously
```

### Salary in multiple currencies
```
	salary = {
		gold = {
			value = minor_court_position_salary
		}
		prestige = {
			value = 0.2
		}
		round = no
	}
```

### Travel-related position
```
	is_travel_related = yes   # Shows travel speed/safety stats, enables sorting in appointment window
```

### Search for courtier button
Triggers an effect when the player clicks "Search for Courtier" in the UI.
```
	search_for_courtier = {
		trigger_event = {
			id = my_mod_events.001
			days = 14
		}
	}
```

### Custom employer modifier description
For effects that cannot be expressed as simple modifiers (e.g. event-driven behavior).
```
	custom_employer_modifier_description = my_position_employer_custom_effect_description
	# Then in loc: my_position_employer_custom_effect_description: "May perform special tasks for you."

	custom_employee_modifier_description = my_position_employee_custom_effect_description
```

### Culture/faith conditional modifiers
```
	culture_modifier = {
		parameter = has_court_advisors       # culture parameter name
		diplomacy = 2
	}

	faith_modifier = {
		parameter = has_divine_advisors      # religion parameter name
		learning = 2
	}
```

### GUI assets (court_position_asset)
```
	court_position_asset = {
		trigger = {
			government_has_flag = government_is_tribal
		}
		animation = personality_honorable
		background = "gfx/interface/illustrations/event_scenes/feast.dds"
		localization_key = my_position_tribal_variant  # optional: overrides name/desc for this variant
	}

	# Fallback (no trigger = always matches if nothing above matched)
	court_position_asset = {
		animation = personality_honorable
		background = "gfx/interface/illustrations/event_scenes/feast.dds"
	}
```

### Lifecycle effects
```
	on_court_position_received = {
		# scope:liege, scope:employee
		scope:employee = {
			add_opinion = {
				target = scope:liege
				modifier = grateful_opinion
				opinion = 10
			}
		}
	}
	on_court_position_revoked = {
		scope:employee = {
			add_opinion = {
				target = scope:liege
				modifier = angry_opinion
				opinion = -20
			}
		}
	}
	on_court_position_invalidated = { }
	on_court_position_vacated = {
		# Fired after invalidation OR character leaves court (including death).
		# NOT fired on revoke.
	}
```

## Aptitude Deep Dive

Aptitude determines the tier of scaling modifiers the employer receives. The aptitude value is a scripted value evaluated on the employee (root = employee).

Aptitude tiers and their breakpoints (default `{ 20 40 60 80 }`):
| Score     | Tier      |
|-----------|-----------|
| 0-19      | terrible  |
| 20-39     | poor      |
| 40-59     | average   |
| 60-79     | good      |
| 80+       | excellent |

Standard aptitude pattern from vanilla:
```
	aptitude = {
		value = 1

		# Primary skill contribution (cap at 50 to prevent runaway)
		add = {
			value = diplomacy
			multiply = 2
			max = 50
			desc = court_position_skill_diplomacy    # Shown in aptitude breakdown tooltip
		}

		# Trait bonuses
		if = {
			limit = { has_trait = gregarious }
			add = {
				value = 20
				desc = court_position_gregarious_trait
			}
		}

		# Education tier bonuses
		if = {
			limit = { has_trait = education_diplomacy }
			add = {
				value = 4
				if = {
					limit = { has_trait = education_diplomacy_2 }
					add = 4
				}
				else_if = {
					limit = { has_trait = education_diplomacy_3 }
					add = 8
				}
				else_if = {
					limit = { has_trait = education_diplomacy_4 }
					add = 12
				}
				desc = education_diplomacy
			}
		}

		# Penalty
		if = {
			limit = { has_trait = shy }
			add = {
				value = -15
				desc = court_position_shy_trait
			}
		}
	}
```

The `desc` keys show up in the aptitude tooltip breakdown. They need loc entries like:
```
 court_position_skill_diplomacy: "$diplomacy$ skill"
 court_position_gregarious_trait: "$trait_gregarious$ trait"
```

## AI Logic

### ai_position_score
Evaluated once per position for the liege. Determines whether the AI wants to fill this position at all.
- Values > 0 → AI will try to hire
- Values < -50 → AI will fire the current holder
- Typical base: 50-150 depending on importance

```
	ai_position_score = {
		value = 50                                      # Baseline desire
		add = court_position_debt_considerations_value  # Vanilla helper: reduces score when in debt
	}
```

### ai_candidate_score
Evaluated per eligible courtier/vassal. Determines WHO gets hired.
- Candidates scoring > MIN_SCORE_TO_HIRE_COURT_POSITION_CANDIDATE are considered
- Higher score = greater probability of selection
- Holders scoring < MAX_SCORE_TO_FIRE_COURT_POSITION get fired

**Critical warning**: Do NOT use factors that depend on whether the candidate is currently hired (e.g., current expenses). This causes hire/fire loops that kill performance.

```
	ai_candidate_score = {
		value = 50
		add = court_position_candidate_score_base_value     # Vanilla baseline (~100)
		add = court_position_candidate_aptitude_value        # Prefers high-aptitude candidates
		scope:employee = {
			# Prefer vassals less (they may have other duties)
			if = {
				limit = { is_ruler = yes }
				add = -50
			}
		}
	}
```

Available AI scopes:
- `scope:liege` — the employer
- `scope:employee` — candidate being evaluated
- `scope:firing_court_position` — set to true when evaluating whether to fire
- `scope:percent_of_monthly_gold_income` — salary as % of liege income
- `scope:percent_of_monthly_gold_income_all_positions` — total position costs as % of income

## Checklist
1. **Position file** in `common/court_positions/types/` — named `<key>_court_position`
2. **skill** set to match the aptitude's primary skill
3. **aptitude** block with `desc` keys for tooltip breakdown
4. **scaling_employer_modifiers** with all 5 tiers (terrible through excellent) — or fewer (highest defined tier is used for higher aptitude)
5. **salary** block — gold, prestige, and/or piety
6. **revoke_cost** block
7. **valid_position** — tier/government/DLC gates
8. **valid_character** — eligibility requirements
9. **ai_position_score** and **ai_candidate_score** — balance to avoid hire/fire loops
10. **Localization** — `<key>: "Name"` and `<key>_desc: "Description"`, plus aptitude `desc` keys
11. **At least one court_position_asset** (fallback with no trigger) for GUI background/animation
12. **on_court_position_received/revoked/invalidated/vacated** — at minimum empty blocks

## Common Pitfalls

- **Missing `_court_position` suffix**: The key MUST end in `_court_position` (e.g., `my_advisor_court_position`). Without it, the game will not recognize it.
- **Aptitude desc keys without loc**: Every `desc = some_key` inside the aptitude block needs a localization entry, or players see raw keys in the tooltip.
- **AI hire/fire loops**: If `ai_candidate_score` depends on whether the candidate is currently employed (e.g., checking current expenses), the AI will endlessly hire and fire. Use `court_position_candidate_score_base_value` and aptitude-based scoring instead.
- **Forgetting `round = no` in salary**: Without it, salary rounds to integers, which can produce unexpected costs for cheap positions.
- **valid_position vs is_shown**: `is_shown` controls UI visibility; `valid_position` controls whether the position can actually be filled. If `valid_position` fails but `is_shown` passes, the position appears grayed out. If `is_shown` fails, it is hidden entirely.
- **scaling_employer_modifiers with gaps**: You can define fewer than 5 tiers, but the game uses the highest defined tier for any aptitude above it. Define all 5 for clarity.
- **Scope confusion in aptitude**: Root in `aptitude` is the employee, NOT the liege. Use `employer` or `liege` to access the court owner from within aptitude.
- **Missing fallback court_position_asset**: Always include one asset block without a trigger as a fallback. Otherwise characters with no matching culture/government see broken UI.
- **Salary currency mismatch with revoke_cost**: If salary is in gold but revoke_cost is in prestige, the AI may not weigh costs correctly. Match the primary currency or use `court_position_debt_considerations_value` in ai_position_score.
- **max_available_positions not set**: Defaults to... not being settable. Always explicitly define it (usually 1).
