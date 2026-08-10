# Creating a Casus Belli — Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
Casus belli (CB) types define the rules for declaring and resolving wars: what can be targeted, who can use it, and what happens on victory/defeat/white peace. CBs are defined in `common/casus_belli_types/`.

## Minimal Template

### common/casus_belli_types/my_cb_types.txt
```
my_custom_cb = {
	group = conquest

	combine_into_one = yes
	should_show_war_goal_subview = yes
	mutually_exclusive_titles = { always = yes }

	allowed_for_character = {
		is_ruler = yes
	}

	allowed_against_character = {
		scope:attacker = {
			NOT = { this = scope:defender }
		}
	}

	valid_to_start = {
		# Additional conditions to start the war
	}

	target_titles = neighbor_land
	target_title_tier = duchy

	on_victory = {
		scope:attacker = {
			# Effects when attacker wins
		}
		create_title_and_vassal_change = {
			type = conquest
			save_scope_as = change
		}
		scope:target_title = {
			change_title_holder = {
				holder = scope:attacker
				change = scope:change
			}
		}
		resolve_title_and_vassal_change = scope:change
	}

	on_defeat = {
		scope:attacker = {
			pay_short_term_gold = {
				gold = 100
				target = scope:defender
			}
		}
	}

	on_white_peace = {
		# Effects on white peace
	}

	war_score_from_battles = 1.0
	war_score_from_occupation = 1.0
	max_attacker_score_from_battles = 100
	max_defender_score_from_battles = 100

	ai_score = {
		base = 100
	}
}
```

### Localization
```
l_english:
 my_custom_cb: "Custom War"
 my_custom_cb_desc: "A custom casus belli for conquering land."
```

## Common Variants

### Religious war CB
```
my_holy_war_cb = {
	group = religious
	# Add faith-based conditions
	allowed_for_character = {
		faith = {
			has_doctrine = doctrine_pluralism_fundamentalist
		}
	}
	allowed_against_character = {
		scope:defender.faith = {
			faith_hostility_level = {
				target = scope:attacker.faith
				value >= religious_hostility_level_hostile
			}
		}
	}
	# ...
}
```

### CB with war contribution tracking
Use the war score parameters:
```
war_score_from_battles = 0.5
war_score_from_occupation = 1.5
max_attacker_score_from_battles = 75
max_defender_score_from_battles = 100
```

## Checklist
- [ ] CB file in `common/casus_belli_types/` with `.txt` extension
- [ ] `group` defined (conquest, religious, etc.)
- [ ] `on_victory`, `on_defeat`, `on_white_peace` blocks defined
- [ ] `allowed_for_character` and `allowed_against_character` conditions
- [ ] Localization for CB name and description
- [ ] Title change logic uses `create_title_and_vassal_change` / `resolve_title_and_vassal_change` pair
- [ ] AI scoring configured if AI should use this CB

## Common Pitfalls
- **Title changes**: Always use the `create_title_and_vassal_change` + `resolve_title_and_vassal_change` pattern for transferring titles. Direct title transfers can cause issues
- **Missing group**: The `group` determines UI behavior and war mechanics. Check vanilla for valid group names
- **Scope naming**: Available scopes are `scope:attacker`, `scope:defender`, and `scope:target_title` — not `root`
- **No .info file available publicly**: Refer to vanilla CB files for the full list of available keys and parameters
