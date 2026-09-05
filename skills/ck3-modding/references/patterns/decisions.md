# Creating Decisions — Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
Decisions are optional actions available to the player (and optionally AI) through the decision panel. They require a script file in `common/decisions/` and localization entries.

## Minimal Template

### common/decisions/my_decisions.txt
```
my_first_decision = {
	picture = {
		reference = "gfx/interface/illustrations/decisions/decision_misc.dds"
	}

	desc = my_first_decision_desc
	selection_tooltip = my_first_decision_tooltip

	is_shown = {
		is_ruler = yes
	}

	is_valid = {
		gold >= 100
	}

	cost = {
		gold = 100
	}

	effect = {
		add_prestige = 200
	}

	ai_check_interval = 0
}
```

### localization/english/my_decisions_l_english.yml
```
l_english:
 my_first_decision: "My First Decision"
 my_first_decision_desc: "Description shown when you open it."
 my_first_decision_tooltip: "Tooltip shown when hovering over it."
 my_first_decision_confirm: "Confirm"
```

## Common Variants

### Major decision (with confirmation event)
```
my_major_decision = {
	picture = {
		reference = "gfx/interface/illustrations/decisions/decision_realm.dds"
	}
	decision_group_type = major

	is_shown = {
		is_ruler = yes
		highest_held_title_tier >= tier_kingdom
	}

	is_valid_showing_failures_only = {
		is_available_adult = yes
		is_at_war = no
	}

	is_valid = {
		prestige_level >= 3
		gold >= 500
	}

	cost = {
		gold = 500
		prestige = 1000
	}

	effect = {
		trigger_event = my_mod.1000
		add_character_modifier = {
			modifier = my_decision_cooldown
			years = 10
		}
	}

	ai_check_interval = 120
	ai_potential = {
		highest_held_title_tier >= tier_kingdom
	}
	ai_will_do = {
		base = 50
		modifier = {
			factor = 2
			gold >= 1000
		}
	}
}
```

### Decision with cooldown
```
my_repeatable_decision = {
	# ...
	cooldown = { years = 5 }
	# ...
}
```

### Decision with AI logic (using weight modifiers)
```
ai_will_do = {
	base = 100
	modifier = {
		factor = 0
		is_ai = no
	}
	modifier = {
		factor = 2
		gold >= 500
	}
	modifier = {
		factor = 0.5
		is_at_war = yes
	}
}
```

## Title Override (Dynamic)

The `title` field supports dynamic text, just like `desc`:
```
my_decision = {
    title = {
        first_valid = {
            triggered_desc = {
                trigger = { is_ruler = yes }
                desc = my_decision_title_ruler
            }
            desc = my_decision_title_default
        }
    }
}
```

## Conditional Picture

Multiple `picture` blocks can be provided with triggers. The first matching trigger wins; the last entry without a trigger is the fallback:
```
picture = {
    trigger = { has_trait = brave }
    reference = "gfx/interface/illustrations/decisions/my_brave_pic.dds"
}
picture = {
    reference = "gfx/interface/illustrations/decisions/my_default_pic.dds"
}
# First matching trigger wins; last entry is the fallback
```

## Confirm Text Override

Override the default `<key>_confirm` localization key for the confirm button:
```
confirm_text = my_decision_custom_confirm   # Overrides default "<key>_confirm" loc key
```

## Cost vs Minimum Cost

```
# cost = { } — deducted when decision is taken
cost = { gold = 200 prestige = 100 }

# minimum_cost = { } — blocks taking if not affordable, but does NOT deduct
# Use when cost is applied later (via event or widget choice)
minimum_cost = { gold = 100 }
```

## should_create_alert

Additional trigger controlling whether the decision shows an alert/notification. Even if the decision is available, this can suppress the nag:
```
should_create_alert = {
    # Even if decision is available, don't nag the player unless:
    gold >= 500
}
```

## Checklist
- [ ] Decision file in `common/decisions/` with `.txt` extension
- [ ] 4 localization keys: `decision_name`, `_desc`, `_tooltip`, `_confirm`
- [ ] Localization file encoded as UTF-8 BOM
- [ ] `is_shown` block (when to display the decision)
- [ ] `effect` block (what happens when taken)
- [ ] `ai_check_interval` set (0 = AI never considers it)
- [ ] Test with console: `effect remove_decision_cooldown = my_decision` to reset cooldown

## Common Pitfalls
- **AI never takes the decision**: `ai_check_interval` is set to 0 (default). Set it to a positive number (in months). Also ensure `ai_potential` and `ai_will_do` are configured
- **Decision doesn't show up**: Check `is_shown` conditions. The decision only appears for characters who meet ALL conditions
- **Missing localization**: Need all 4 keys. Default keys use the decision name as the base
- **Cost not deducted**: If you handle cost in an event, use `minimum_cost` instead of `cost`. The `minimum_cost` block checks the character can afford it but doesn't deduct
- **`is_valid` vs `is_valid_showing_failures_only`**: Both must be true to take the decision. `is_valid_showing_failures_only` only shows failed conditions in the tooltip, good for obvious requirements like `is_available_adult`

## Widget Patterns

Decisions can have custom widget selection UIs:
```
my_decision = {
    # ... other fields ...

    widget = {
        gui = "decision_view_widget_generic_list"
        controller = decision_option_list_controller

        item = {
            value = flag:option_a
            localization = my_decision_option_a
            icon = "gfx/interface/icons/option_a.dds"
            ai_chance = { value = 10 }
            is_default = yes
        }
        item = {
            value = flag:option_b
            localization = my_decision_option_b
            ai_chance = { value = 5 }
        }
    }
    # Use scope:widget_value in the effect block to check which item was selected
}
```

## ai_goal

`ai_goal` is a **top-level boolean** on the decision (NOT a sub-block of `ai_will_do`). When set to `yes`, the AI budgets for this decision like it does for title creation or buildings, actively working toward meeting `is_valid` conditions. Note: when `ai_goal = yes`, `ai_check_interval` is ignored (less performant).
```
my_decision = {
    ai_goal = yes              # AI budgets for this like title creation/buildings
    # When ai_goal = yes, ai_check_interval is ignored (less performant)

    ai_will_do = {
        base = 0
        modifier = { add = 100 gold >= 500 }
    }
}
```

## ai_check_interval_by_tier

An alternative to `ai_check_interval` that lets you set different check intervals per title tier. All tiers must be defined:
```
ai_check_interval_by_tier = {
    barony = 0      # AI barons never check
    county = 10
    duchy = 5
    kingdom = 2
    empire = 1
    hegemony = 1
}
# All tiers must be defined. Alternative to ai_check_interval.
```

## Dynamic Descriptions for Decisions

Similar to events, decisions support dynamic desc using `first_valid` and `triggered_desc`:
```
my_decision = {
    desc = {
        first_valid = {
            triggered_desc = {
                trigger = { is_ruler = yes }
                desc = my_decision_desc_ruler
            }
            desc = my_decision_desc_default
        }
    }
}
```
