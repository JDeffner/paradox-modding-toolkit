# Creating Epidemics -- Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
Epidemics are province-level disease outbreaks that spread across the map. Each epidemic is linked to a disease trait, has tiered infection levels with modifiers, and comes in three intensity tiers (minor, major, apocalyptic). Epidemics are defined in `common/epidemics/` and require a corresponding trait in `common/traits/`, localization, and optionally custom events.
> Reference docs: common/epidemics/_epidemics.info
> Testing: use console command `spawn_epidemic <key> <province_id> <intensity>` (e.g., `spawn_epidemic smallpox 2595 apocalyptic`)

## Minimal Template

### common/epidemics/my_epidemics.txt
```
my_plague = {
	trait = my_plague_trait           # Must match a trait key defined in common/traits/
	color = { 120 30 50 }            # RGB color shown on the epidemic map mode
	priority = 3                     # Higher = more important for map display when overlapping

	shader_data = {
		strength = 0.7               # Visual intensity on map, 0-1
		edge_fade = 0.25             # How much the edges fade out, 0-1
		tile_multiplier = 0.005      # Tile wrapping multiplier
		texture_index = 0            # Which tile texture in the shader (0, 1, etc.)
		channel = red                # Color channel: red, green, blue, or alpha
	}

	# Dynamic name for the epidemic (root = the epidemic being created)
	name = {
		first_valid = {
			triggered_desc = {
				trigger = { outbreak_intensity = apocalyptic }
				desc = my_plague_apocalyptic_name
			}
			desc = my_plague_default_name
		}
	}

	# Who can catch this disease
	# root = potential character, scope:epidemic = the epidemic
	can_infect_character = {
		is_alive = yes
		NOT = { has_trait = my_plague_trait }
	}

	# Monthly chance (0-100%) per character in an infected province
	# root = potential character, scope:epidemic = the epidemic
	character_infection_chance = {
		value = 5
	}

	# Effect when a character catches it
	# root = infected character, scope:epidemic = the epidemic
	on_character_infected = {
		add_trait = my_plague_trait
	}

	# Tiered province modifiers based on infection level (0-100)
	# The highest threshold the province meets is applied
	infection_levels = {
		10 = {
			province_modifier = {
				county_opinion_add = -2
				epidemic_travel_danger = 10
				development_decline = -1
			}
		}
		50 = {
			province_modifier = {
				county_opinion_add = -5
				epidemic_travel_danger = 20
				development_decline = -2
			}
		}
		80 = {
			province_modifier = {
				monthly_county_control_decline_add = -0.1
				supply_limit_mult = -0.2
				county_opinion_add = -10
				epidemic_travel_danger = 30
				development_decline = -4
			}
		}
	}

	# Outbreak intensity tiers control spread behavior
	outbreak_intensities = {
		minor = {
			outbreak_chance = {
				value = 0.5        # Yearly chance (0-100%) per province
			}
			spread_chance = {
				value = 10         # Monthly chance (0-100%) to spread to adjacent province
			}
			max_provinces = { 30 55 }          # Random range for max infected provinces

			infection_duration = {
				months = { 6 8 }               # How long at max infection
			}
			infection_progress_duration = {
				days = { 80 120 }              # Days to reach max infection
			}
			infection_recovery_duration = {
				days = { 15 22 }               # Days to recover after duration ends
			}
		}

		major = {
			outbreak_chance = {
				value = 0.1
			}
			spread_chance = {
				value = 15
			}
			max_provinces = { 85 130 }

			infection_duration = {
				months = { 10 20 }
			}
			infection_progress_duration = {
				days = { 40 60 }
			}
			infection_recovery_duration = {
				days = 25
			}
		}

		apocalyptic = {
			global_notification = yes          # Notifies all players regardless of proximity

			outbreak_chance = {
				value = 0.01
			}
			spread_chance = {
				value = 20
			}
			max_provinces = { 220 325 }

			infection_duration = {
				months = { 22 40 }
			}
			infection_progress_duration = {
				days = { 15 20 }
			}
			infection_recovery_duration = {
				days = { 25 35 }
			}
		}
	}

	# Province-level effects
	on_province_infected = {
		# root = province, scope:epidemic = the epidemic
	}
	on_province_recovered = {
		# root = province, scope:epidemic = the epidemic
		add_to_variable_list = {
			name = epidemic_cooldown
			target = scope:epidemic.epidemic_type
			years = 50
		}
		set_variable = {
			name = epidemic_cooldown_general
			years = 15
		}
	}

	# Epidemic lifecycle effects
	on_start = {
		# root = the epidemic (fires when the outbreak spawns)
	}
	on_monthly = {
		# root = ruler of affected province, scope:epidemic = the epidemic
	}
	on_end = {
		# root = the epidemic (fires when epidemic fully ends)
	}
}
```

### common/traits/my_plague_traits.txt
```
my_plague_trait = {
	category = disease

	# Attribute penalties
	diplomacy = -1
	martial = -2
	prowess = -3
	health = -2

	# Flags
	is_disease = yes

	# How long the trait lasts (optional; if omitted, permanent until removed)
	# duration = { years = 1 }
}
```

### Localization (localization/english/my_epidemics_l_english.yml)
```
l_english:
 my_plague_default_name: "My Plague"
 my_plague_apocalyptic_name: "The Great Plague"
 epidemic_my_plague: "My Plague"
 trait_my_plague_trait: "My Plague"
 trait_my_plague_trait_desc: "This character is afflicted with the plague."
```

## Common Variants

### Using scripted values for spread (vanilla pattern)
Vanilla epidemics reference script values instead of hard-coded numbers, allowing global tuning:
```
outbreak_chance = {
	value = outbreak_chance_minor_default_value
	multiply = outbreak_chance_minor_mult_value
	multiply = recent_epidemics_outbreak_mult_value
	# Disable via game rule
	if = {
		limit = { has_game_rule = epidemic_frequency_disabled }
		multiply = 0
	}
}
spread_chance = {
	value = spread_chance_epidemics_default_value
	multiply = spread_chance_epidemics_mult_value
}
```

### County and realm modifiers in infection_levels
Beyond `province_modifier`, infection levels can also apply `county_modifier` (applied if the county capital is infected) and `realm_modifier` (stacks on the ruler for every infected province):
```
infection_levels = {
	50 = {
		province_modifier = {
			county_opinion_add = -5
			development_decline = -2
		}
		county_modifier = {
			tax_mult = -0.1
		}
		realm_modifier = {
			monthly_prestige = -0.05
		}
	}
}
```

### Conditional infection (immunity, traits, buildings)
Use `can_infect_character` to make certain characters immune based on traits, buildings in their capital, or other conditions:
```
can_infect_character = {
	is_alive = yes
	NOT = { has_trait = my_plague_trait }
	NOT = { has_trait = immune_trait }
	# Vanilla uses scripted triggers like:
	# can_contract_disease_trigger = { DISEASE = smallpox }
	# immune_to_epidemic = { EPIDEMIC = scope:epidemic }
}
```

### Dynamic naming with location/ruler/culture
Vanilla epidemics generate thematic names using `first_valid` and `random_valid` blocks referencing loc keys with scope data:
```
name = {
	first_valid = {
		triggered_desc = {
			trigger = {
				outbreak_intensity = apocalyptic
				outbreak_province = province:3045
			}
			desc = epidemic_special_plague_name    # A unique name for a specific origin
		}
		random_valid = {
			desc = epidemic_realm_plague            # "[outbreak_province.county.holder.primary_title.GetName] Plague"
			desc = epidemic_culture_plague          # "[outbreak_province.county.culture.GetName] Plague"
			desc = epidemic_location_plague         # "Plague of [outbreak_province.county.GetName]"
		}
		desc = trait_my_plague_trait                # Fallback to plain trait name
	}
}
```

### Using on_character_infected for army spread
Vanilla fires events when an infected character is commanding an army:
```
on_character_infected = {
	contract_disease_notify_effect = { DISEASE = my_plague_trait }
	if = {
		limit = { is_commanding_army = yes }
		trigger_event = epidemic_events.0001    # Infects the army
	}
}
```

### on_start / on_end for global state tracking
Use `on_start` and `on_end` to set/clear global variables, e.g., to track whether a major plague is active:
```
on_start = {
	if = {
		limit = { outbreak_intensity = apocalyptic }
		set_global_variable = my_great_plague_active
	}
}
on_end = {
	if = {
		limit = { outbreak_intensity = apocalyptic }
		remove_global_variable = my_great_plague_active
	}
}
```

### on_monthly for triggering events
Fires monthly for each ruler who has an infected province. Use to trigger ongoing epidemic event chains:
```
on_monthly = {
	trigger_event = {
		on_action = epidemic_ongoing_events
	}
}
```

### Development loss on province infection
Vanilla applies development loss when a province first becomes infected:
```
on_province_infected = {
	county = {
		apply_infection_development_loss = { BASE = 5 }    # Higher BASE = more dev loss
	}
}
```

### Cooldown on province recovery
Prevents the same epidemic from re-infecting a province too soon:
```
on_province_recovered = {
	add_to_variable_list = {
		name = epidemic_cooldown
		target = scope:epidemic.epidemic_type
		years = 50                                         # This specific disease won't return for 50 years
	}
	set_variable = {
		name = epidemic_cooldown_general
		years = 15                                         # No epidemics at all for 15 years
	}
}
```

## Interactions with Traits and Buildings

- **Trait link**: The `trait` field connects the epidemic to a disease trait. Characters in infected provinces get this trait based on `character_infection_chance` and `can_infect_character`.
- **Immunity via traits**: Use `can_infect_character` triggers to check for immunity traits (e.g., `has_trait = immune_to_plague`). Vanilla uses the scripted trigger `can_contract_disease_trigger`.
- **Buildings reducing spread**: Buildings can provide modifiers like `epidemic_resistance` or be checked in `can_infect_character` / `character_infection_chance` triggers. The `spread_chance` block can also check for building presence in the target province.
- **Recovery traits**: Use `on_province_recovered` or disease trait removal events to grant recovery/immunity traits.

## Checklist
1. **Epidemic definition** in `common/epidemics/xx_epidemics.txt` with all required fields
2. **Disease trait** in `common/traits/` with `is_disease = yes` and appropriate penalties
3. **Localization** for:
   - `epidemic_<key>:` -- the epidemic name shown in UI
   - `trait_<trait_key>:` and `trait_<trait_key>_desc:` -- the disease trait
   - Any dynamic name loc keys referenced in the `name` block
4. **Trait icon** at `gfx/interface/icons/traits/<trait_key>.dds` (60x60)
5. **All three intensity tiers** defined (minor, major, apocalyptic) -- each needs outbreak_chance, spread_chance, max_provinces, and the three duration blocks
6. **At least one infection_level** threshold with province_modifier
7. **on_province_recovered** should set cooldown variables to prevent rapid re-infection
8. **Test** with console: `spawn_epidemic <key> <province_id> <intensity>`

## Common Pitfalls
- **Missing trait**: The `trait` field must reference a valid trait key. If the trait does not exist, the epidemic will silently fail to infect characters.
- **No `is_disease = yes` on the trait**: Without this flag, the game will not treat the trait as a disease for UI and scripted trigger purposes.
- **Forgetting infection_levels**: Without at least one infection_level entry, the epidemic will spread but apply no province modifiers, making it invisible to the player beyond notifications.
- **character_infection_chance too high**: Vanilla bubonic plague multiplies by 0.02 on top of the default value to avoid killing every character. A value of 100 will infect everyone instantly.
- **No cooldown in on_province_recovered**: Without setting `epidemic_cooldown` and `epidemic_cooldown_general` variables, the same province can be re-infected immediately after recovery.
- **Outbreak_chance too high**: Even small values (0.5-1.0) produce frequent outbreaks. Vanilla apocalyptic plagues use values well below 0.1.
- **shader_data channel conflicts**: If two epidemics use the same `texture_index` and `channel`, their map visuals will overlap incorrectly. Use different channels (red, green, blue, alpha) or different texture indices.
- **Dynamic name loc keys not defined**: If loc keys referenced in the `name` block are missing, the epidemic name will show raw keys. Each `desc` in the name block must have a matching localization entry.
- **max_provinces as a single value vs range**: `max_provinces` accepts either a single value or a `{ min max }` range. Using a range gives natural variation between outbreaks.
