# Creating Men-at-Arms Types — Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
Men-at-Arms (MaA) are regiment types that rulers recruit for gold/prestige. Each type has combat stats (damage, toughness, pursuit, screen), terrain modifiers, counter relationships against other archetypes, and cost structures. They are defined in `common/men_at_arms_types/` and need localization. Illustrations are optional but recommended.

Valid base archetypes for `type`: `skirmishers`, `archers`, `heavy_infantry`, `pikemen`, `light_cavalry`, `heavy_cavalry`, `camel_cavalry`, `elephant_cavalry`, `archer_cavalry`, `siege_weapon`, `gunpowder`, `peasant_militia`.

> Reference docs: common/men_at_arms_types/_men_at_arms_types.info

## Minimal Template

### common/men_at_arms_types/my_maa_types.txt
```
my_elite_infantry = {
	type = heavy_infantry

	damage = 36
	toughness = 28
	pursuit = 0
	screen = 10

	terrain_bonus = {
		forest = { damage = 8 toughness = 6 }
		hills = { toughness = 6 }
	}

	counters = {
		pikemen = 1
	}

	buy_cost = { gold = 150 }
	low_maintenance_cost = { gold = 1.0 }
	high_maintenance_cost = { gold = 5.0 }

	stack = 100
	ai_quality = { value = 50 }
}
```

### Localization (localization/english/my_maa_l_english.yml)
```
l_english:
 my_elite_infantry: "Elite Infantry"
 my_elite_infantry_flavor: "#F These hardened warriors form the backbone of the army.#!"
```

The loc key is the MaA definition key itself (not prefixed). The `_flavor` key provides the italic description shown in the tooltip.

## Common Variants

### Culture-gated MaA (unlocked by cultural parameter)
This is the standard approach for cultural MaA. A tradition or innovation sets a cultural parameter, and the MaA checks for it.
```
my_cultural_warriors = {
	type = heavy_infantry

	damage = 40
	toughness = 26
	pursuit = 0
	screen = 24

	terrain_bonus = {
		taiga = { damage = 8 }
		forest = { damage = 8 }
	}

	counters = {
		pikemen = 1
		peasant_militia = 2
		archers = 1
	}

	# Cultural parameter set by a tradition or innovation
	can_recruit = {
		valid_for_maa_trigger = { PARAMETER = unlock_maa_my_cultural_warriors }
		NOT = {
			culture = { has_cultural_parameter = strength_in_numbers_heavy_maa_ban }
		}
	}

	buy_cost = { gold = 150 }
	low_maintenance_cost = { gold = 1.0 }
	high_maintenance_cost = { gold = 5.0 }

	stack = 100
	ai_quality = { value = 80 }
	icon = heavy_infantry  # Reuse existing icon if no custom one
}
```

### Innovation-gated MaA
```
my_advanced_unit = {
	type = archers

	damage = 42
	toughness = 18
	pursuit = 0
	screen = 0

	terrain_bonus = {
		hills = { damage = 10 }
	}

	counters = {
		heavy_infantry = 1
		heavy_cavalry = 1
	}

	can_recruit = {
		culture = {
			has_innovation = innovation_advanced_bowmaking
		}
	}

	# Controls when the unit appears in the recruitment UI even if locked
	should_show_when_unavailable = {
		government_allows = subject_men_at_arms
		culture = { has_cultural_era_or_later = culture_era_high_medieval }
	}

	buy_cost = { gold = 200 }
	low_maintenance_cost = { gold = 1.5 }
	high_maintenance_cost = { gold = 6.0 }

	stack = 100
	ai_quality = { value = 60 }
}
```

### Siege Weapon
```
my_siege_engine = {
	type = siege_weapon
	fights_in_main_phase = no   # Only contributes during sieges, not field battles

	damage = 0
	toughness = 12

	siege_tier = 2              # Higher tier = can breach higher fort level
	siege_value = 0.3           # Daily siege progress contribution

	can_recruit = {
		culture = {
			has_innovation = innovation_mangonel
		}
	}

	buy_cost = { gold = 250 }
	low_maintenance_cost = { gold = 2.0 }
	high_maintenance_cost = { gold = 8.0 }

	stack = 10                  # Siege weapons use small stacks
	allowed_in_hired_troops = no  # Mercs/holy orders cannot use this
}
```

### Cavalry with Winter Penalties
```
my_heavy_horse = {
	type = heavy_cavalry

	damage = 100
	toughness = 35
	pursuit = 20
	screen = 0

	terrain_bonus = {
		plains = { damage = 30 }
		drylands = { damage = 30 }
		hills = { damage = -20 }
		mountains = { damage = -75 }
		desert_mountains = { damage = -75 }
		wetlands = { damage = -75 toughness = -10 pursuit = -10 }
	}

	counters = {
		archers = 1
	}

	winter_bonus = {
		normal_winter = { damage = -10 toughness = -5 }
		harsh_winter = { damage = -20 toughness = -10 }
	}

	can_recruit = {
		culture = {
			has_innovation = innovation_arched_saddle
		}
	}

	buy_cost = { gold = 200 }
	low_maintenance_cost = { gold = 2.0 }
	high_maintenance_cost = { gold = 8.0 }

	stack = 50                  # Cavalry typically has smaller stacks
	ai_quality = { value = 60 }
}
```

### Limited-Regiment Special Unit
```
my_elite_guard = {
	type = heavy_infantry

	damage = 40
	toughness = 32
	pursuit = 0
	screen = 24

	counters = {
		pikemen = 2
		archers = 2
	}

	can_recruit = {
		dynasty ?= {
			has_dynasty_perk = warfare_legacy_5
		}
	}

	buy_cost = { gold = 50 }
	low_maintenance_cost = { gold = 0 }
	high_maintenance_cost = { gold = 1 }

	max_regiments = 1           # Only one regiment of this type can exist
	stack = 100
	ai_quality = { value = 100 }
}
```

### Non-Recruitable / Event-Only Unit
```
my_event_troops = {
	type = pikemen

	damage = 12
	toughness = 16
	pursuit = 10
	screen = 0

	special_recruit_only = yes  # Cannot be recruited via GUI or AI, only spawned via effects

	buy_cost = { gold = 0 }
	low_maintenance_cost = { gold = 0 }
	high_maintenance_cost = { gold = 0 }

	stack = 100
	ai_quality = { value = -100 }
	allowed_in_hired_troops = no
}
```

## Illustrations
MaA types support conditional illustrations for different graphical styles. The last `illustration` block without a trigger acts as the fallback.
```
my_unit = {
	# ... stats ...

	illustration = {
		trigger = {
			should_use_asian_maa_graphics = yes
		}
		reference = my_unit_asia     # gfx texture file name (without .dds)
	}

	illustration = {
		reference = my_unit          # Fallback illustration
	}
}
```
If no `illustration` blocks are provided, the game uses the object key as the texture filename. You can also set `icon = existing_icon_name` to reuse another type's icon.

## Terrain List
Valid terrain keys for `terrain_bonus`: `plains`, `farmlands`, `hills`, `mountains`, `desert_mountains`, `forest`, `taiga`, `jungle`, `wetlands`, `steppe`, `floodplains`, `drylands`, `desert`, `oasis`, `terraced_hills`.

Positive values are bonuses; negative values are penalties. Each terrain block can set: `damage`, `toughness`, `pursuit`, `screen`, `siege_value`.

## Counter Relationships
The `counters` block specifies which archetypes this unit counters. The number indicates how many sub-regiments of the enemy type are countered per sub-regiment of this type. Fractional values (e.g., `0.5`) are valid.

The rock-paper-scissors relationships in vanilla:
- Skirmishers counter Heavy Infantry
- Archers counter Skirmishers
- Pikemen counter Cavalry (light, heavy, camel, elephant)
- Light Cavalry counters Archers
- Heavy Cavalry counters Archers
- Heavy Infantry counters Pikemen
- Crossbowmen counter Heavy Infantry + Heavy Cavalry
- Gunpowder counters Heavy Infantry

## Cost Structure
Three cost tiers exist:
- `buy_cost` — one-time recruitment cost (supports `gold`, `prestige`, `piety`)
- `low_maintenance_cost` — paid when unraised and fully reinforced
- `high_maintenance_cost` — paid when raised or reinforcing

Vanilla uses script values for costs (e.g., `gold = heavy_infantry_recruitment_cost`), but mods can use literal numbers. Typical vanilla ranges:
- Infantry buy: ~150 gold
- Cavalry buy: ~200 gold
- Siege buy: ~150-250 gold
- Low maintenance: ~1-2 gold
- High maintenance: ~5-8 gold

## Auto-Generated Modifiers
Each MaA type key automatically generates character modifiers that can be used elsewhere. For a type with key `my_unit`:
- `my_unit_max_size_add` / `my_unit_max_size_mult`
- `my_unit_damage_add` / `my_unit_damage_mult`
- `my_unit_toughness_add` / `my_unit_toughness_mult`
- `my_unit_pursuit_add` / `my_unit_pursuit_mult`
- `my_unit_screen_add` / `my_unit_screen_mult`
- `my_unit_siege_value_add` / `my_unit_siege_value_mult`
- `my_unit_maintenance_mult`
- `my_unit_recruitment_cost_mult`

These modifiers can be applied in buildings, traits, modifiers, etc. to buff/nerf specific MaA types.

## Checklist
1. File placed in `common/men_at_arms_types/` (any `.txt` filename)
2. `type` is set to a valid archetype
3. At least `damage` and `toughness` are defined (pursuit/screen default to 0)
4. `buy_cost`, `low_maintenance_cost`, `high_maintenance_cost` are all present
5. `stack` is defined (100 for infantry/archers, 50 for heavy cavalry, 10 for siege weapons)
6. `counters` block references valid archetypes (the `type` values, not the unit keys)
7. `can_recruit` trigger is set if gated behind innovation/culture/dynasty
8. Localization file has both `key` and `key_flavor` entries
9. `ai_quality` is set so AI knows how to value the unit
10. If siege weapon: `fights_in_main_phase = no` and `siege_tier`/`siege_value` are set

## Pitfalls
- **Counters reference archetypes, not unit keys.** Write `counters = { heavy_infantry = 1 }`, not `counters = { armored_footmen = 1 }`. The archetype is the `type` value.
- **Missing `_flavor` loc key.** The game shows a blank tooltip description area if you only define the name key. Always add `my_unit_flavor`.
- **Forgetting `fights_in_main_phase = no` on siege weapons.** Without this, your siege engine deals 0 damage in field battles but still takes casualties in the main phase instead of being protected.
- **Using `can_recruit` and innovation unlock together.** These are mutually exclusive according to the info file. If you want innovation gating, put the innovation check inside `can_recruit`, do not use a separate innovation unlock field.
- **Stack size mismatch with unit role.** Heavy cavalry at `stack = 100` would be wildly overpowered. Match stack size to the unit's power level: 100 for standard infantry/archers, 50 for heavy cavalry, 10 for siege.
- **Negative terrain bonuses ignored.** Terrain penalties are just as important as bonuses for balance. Cavalry should have mountain/wetland penalties; omitting them makes the unit too strong.
- **`should_show_when_unavailable` missing.** Without this, players may not know your MaA exists until they meet the unlock condition. Add this to show the greyed-out unit in the recruitment panel so players know what to aim for.
- **`allowed_in_hired_troops = no` not set on siege.** Vanilla siege weapons always set this. Mercenaries with siege weapons can break balance.
- **Provision cost forgotten.** If you use the roads/domicile system (post-Roads to Power DLC), the `provision_cost` field matters for domicile movement costs. Omitting it defaults to 0.
- **Redefining cost variables.** If you define `@maa_buy_cost` in your file, it will conflict with vanilla's definition in another file. Use unique variable names or literal values.
