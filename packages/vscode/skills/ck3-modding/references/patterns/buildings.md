# Buildings

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
- Buildings are defined in `common/buildings/`
- Buildings modify a county's stats (tax, levy, development, etc.)
- Each building has a type: regular (available everywhere), special (specific holding), duchy_capital (duchy capital buildings)
- Buildings can have multiple levels, each upgrading the previous
- Localization keys follow the pattern: `building_<key>` for the name, `building_<key>_desc` for description
- **IMPORTANT**: Building localization uses the prefix `building_` NOT `building_type_` — but some special buildings use `building_type_` prefix. Check vanilla examples for the specific building type you're creating.
- Cost uses `cost_gold` for gold and `cost_prestige` for prestige (flat keys). Legendary/special buildings may use `cost = { gold = X }` block syntax instead.
- Buildings need the `is_enabled` / `can_construct` triggers to control availability

## Trigger Scopes
The `is_enabled`, `can_construct`, `can_construct_potential`, and `can_construct_showing_failures_only` triggers all share these scopes:
- `root` = province (the province where the building is located)
- `scope:holder` = character (holder of the barony title)
- `scope:county` = title (the county title the province belongs to)

## Minimal Template — Regular Building

```
# common/buildings/my_buildings.txt

my_market = {
    construction_time = 365    # days

    cost_gold = 100

    levy = 100
    max_garrison = 50
    garrison_reinforcement_factor = 0.01

    # Modifiers applied to the county while this building exists
    county_modifier = {
        monthly_county_control_change_add = 0.1
        tax_mult = 0.05
    }

    # What's needed to build this
    is_enabled = {
        always = yes
    }
    can_construct = {
        always = yes
    }

    # AI logic
    ai_value = {
        base = 10
    }

    # Next level upgrade
    next_building = my_market_2

    type = regular  # regular, special, duchy_capital
}

my_market_2 = {
    construction_time = 730
    cost_gold = 200

    levy = 200
    max_garrison = 100
    garrison_reinforcement_factor = 0.01

    county_modifier = {
        monthly_county_control_change_add = 0.2
        tax_mult = 0.10
    }

    is_enabled = {
        always = yes
    }
    can_construct = {
        always = yes
    }

    ai_value = {
        base = 20
    }

    next_building = my_market_3

    type = regular
}
```

Localization:
```
# localization/english/my_buildings_l_english.yml
l_english:
 building_my_market: "Market Square"
 building_my_market_desc: "A bustling market that improves trade."
 building_my_market_2: "Grand Market"
 building_my_market_2_desc: "An expanded market with foreign traders."
```

## Construction Visibility Triggers

Buildings have three separate construction triggers that control visibility and availability:

```
can_construct_potential = {
    # Whether building appears in build menu AT ALL
    # If false, building is completely hidden
    # For upgrades, this is identical to can_construct_showing_failures_only
}

can_construct_showing_failures_only = {
    # Shows grayed-out with failure reasons
    # Use for temporary blockers the player can overcome
    scope:holder = { prestige >= 500 }
}

can_construct = {
    # Shows both filled and missing requirements
    # All 3 triggers must evaluate to true to allow construction
}

# Make disabled buildings visible but grayed out
show_disabled = yes
```

Note: `is_enabled` is always called together with `can_construct_potential`. To construct a building, all 3 triggers (`is_enabled`, `can_construct_potential`/`can_construct_showing_failures_only`, and `can_construct`) must evaluate to true.

## Modifier Types

Buildings support many different modifier scopes. Understanding the distinction is important:

### `province_modifier` vs `county_modifier`
```
province_modifier = {
    # Applied only to the specific province (barony) where the building is
    monthly_income = 1
    fort_level = 1
}

county_modifier = {
    # Applied to the entire county
    # All provinces in the county can stack the same county modifier together
    monthly_county_control_change_add = 0.1
    tax_mult = 0.05
}
```

### `character_modifier` vs `county_holder_character_modifier`
```
character_modifier = {
    # Applied to the owner of the HOLDING (barony holder)
    diplomacy = 2
    monthly_prestige = 0.5
}

county_holder_character_modifier = {
    # Applied to the owner of the COUNTY
    # Distinct from character_modifier when barony holder != county holder
    monthly_prestige = 0.3
}
```

### Terrain-Conditional Modifiers
```
province_terrain_modifier = {
    terrain = farmlands          # From terrain database (optional — if empty, any terrain)
    tax_mult = 0.15
}

province_terrain_modifier = {
    is_coastal = yes             # Apply only to coastal provinces (optional)
    tax_mult = 0.10
}

province_terrain_modifier = {
    is_riverside = yes           # Apply only to riverside provinces (optional)
    development_growth_factor = 0.05
}

province_terrain_modifier = {
    parameter = culture_param    # Optional culture parameter requirement
    terrain = farmlands
    tax_mult = 0.10
}
```

### Culture/Faith Conditional Modifiers
```
character_culture_modifier = {
    parameter = has_castle_culture
    knight_effectiveness_mult = 0.1
}

character_faith_modifier = {
    parameter = faith_param
    monthly_piety = 0.1
}

county_culture_modifier = {
    parameter = culture_param
    development_growth_factor = 0.1
}

county_faith_modifier = {
    parameter = tenet_monasticism
    development_growth_factor = 0.1
}

province_culture_modifier = {
    parameter = culture_param
    monthly_income = 0.5
}

province_faith_modifier = {
    parameter = faith_param
    monthly_income = 0.5
}
```

### County Holding Modifier
```
county_holding_modifier = {
    holding = castle_holding
    tax_mult = 0.1
    # Applied to every holding of the specified type in the county
}
```

### Duchy Capital County Modifier
```
duchy_capital_county_modifier = {
    # Applied to ALL de jure counties in the duchy, not just the capital
    # Can only be used for duchy_capital type buildings
    development_growth_factor = 0.1
}
```

## Fallback Modifiers

The `fallback` block defines alternative modifiers applied when `is_enabled` evaluates to FALSE:

```
fallback = {
    county_modifier = {
        # Applied when is_enabled evaluates to FALSE
        monthly_county_control_change_add = -0.05
    }
    # Supports all modifier types: character_modifier, province_modifier,
    # county_modifier, county_culture_modifier, county_faith_modifier,
    # province_terrain_modifier, county_holding_modifier,
    # county_holder_character_modifier, duchy_capital_county_modifier, etc.
}
```

## Flag System

Buildings can have flags that are checkable via the `has_building_with_flag` trigger:

```
flag = castle           # Checkable via has_building_with_flag trigger
flag = fortification    # Can have multiple flags
```

## Construction Events

Effects that fire during the building's construction lifecycle:

```
on_start = {
    # Effect when construction begins
    # Scopes: root = province, scope:character = builder, scope:holding = holding type
}
on_complete = {
    # Effect when construction finishes
}
on_cancelled = {
    # Effect when construction is cancelled
}
```

## Custom Effect Descriptions

Use `effect_desc` for custom descriptions of effects indirectly provided by the building:

```
effect_desc = {
    desc = my_building_effect_desc    # Localization key
    triggered_desc = {
        trigger = { ... }
        desc = my_conditional_effect_desc
    }
}
```

## Common Variants

### Duchy Capital Building
Buildings only available in duchy capitals:
```
my_duchy_building = {
    construction_time = 1095
    cost_gold = 500

    levy = 300
    max_garrison = 200
    garrison_reinforcement_factor = 0.02

    county_modifier = {
        levy_size = 0.1
        tax_mult = 0.1
    }

    duchy_capital_county_modifier = {
        # Applied to ALL counties in the duchy, not just the capital
        development_growth_factor = 0.1
    }

    is_enabled = {
        always = yes
    }
    can_construct = {
        always = yes
    }

    type = duchy_capital

    ai_value = {
        base = 50
    }
}
```

### Special / Unique Building
Buildings tied to a specific barony (like Hagia Sophia):
```
my_special_building = {
    construction_time = 3650
    cost_gold = 1000

    county_modifier = {
        monthly_county_control_change_add = 0.3
        development_growth_factor = 0.2
    }

    character_modifier = {
        # Applied to the holder directly
        diplomacy = 2
        monthly_prestige = 0.5
    }

    is_enabled = {
        # Typically restricted to specific holdings
        barony = title:b_constantinople
    }
    can_construct = {
        always = yes
    }

    flag = wonder

    type = special

    # Special buildings often have no next_building (unique, single level)

    ai_value = {
        base = 100
    }
}
```

### Building with Terrain/Holding Type Restriction
```
my_port = {
    construction_time = 365
    cost_gold = 150

    levy = 50
    max_garrison = 50

    county_modifier = {
        tax_mult = 0.1
    }

    province_terrain_modifier = {
        is_coastal = yes
        tax_mult = 0.10
    }

    is_enabled = {
        # Only in coastal counties
        is_coastal_county = yes
    }
    can_construct = {
        always = yes
    }

    type = regular

    ai_value = {
        base = 15
        modifier = {
            factor = 2
            is_coastal_county = yes
        }
    }
}
```

### Building with Culture/Innovation Requirement
```
my_advanced_building = {
    construction_time = 730
    cost_gold = 300

    county_modifier = {
        development_growth_factor = 0.15
    }

    character_culture_modifier = {
        parameter = has_castle_culture
        knight_effectiveness_mult = 0.1
    }

    is_enabled = {
        # Require a specific innovation
        culture = {
            has_innovation = innovation_battlements
        }
    }
    can_construct = {
        always = yes
    }

    type = regular

    ai_value = {
        base = 20
    }
}
```

### Graphical Background for Map
Buildings can define graphical assets for the 3D map:
```
my_castle_upgrade = {
    # ... normal building fields ...

    # Asset shown on the 3D map
    asset = {
        type = pdxmesh
        name = "building_western_castle_mesh"
        illustration = "gfx/interface/illustrations/building_types/my_castle.dds"
    }
}
```

## Map Objects
Map objects are separate from buildings but often paired with special buildings. They are defined in `gfx/map/map_object_data/`:
```
# gfx/map/map_object_data/my_building_objects.txt
# These define 3D models placed on the map

# Usually you reference existing meshes and locators
# Creating new map objects requires 3D modeling tools — out of scope for scripting
```

## Checklist
- [ ] Building defined in `common/buildings/` as `.txt` file
- [ ] Localization files UTF-8 **with BOM**; script `.txt` files UTF-8 (BOM optional, vanilla ships with it)
- [ ] `type` field set correctly (regular / special / duchy_capital)
- [ ] `cost_gold` (and optionally `cost_prestige`) set
- [ ] `construction_time` set
- [ ] `is_enabled` and `can_construct` triggers present
- [ ] `levy`, `max_garrison`, `garrison_reinforcement_factor` set if building provides troops
- [ ] `province_modifier` and/or `county_modifier` with valid modifiers
- [ ] `next_building` chain is consistent (level 1 points to level 2, etc.)
- [ ] Localization keys use `building_` prefix
- [ ] `ai_value` block present so AI will build it
- [ ] Icon at `gfx/interface/icons/buildings/<key>.dds` (if custom icon needed)

## Common Pitfalls
- **Wrong localization prefix**: Regular buildings use `building_<key>`, check vanilla for your specific type. Some special buildings use `building_type_<key>`.
- **Missing is_enabled**: Building won't appear in the construction list without this trigger.
- **Broken upgrade chain**: `next_building` in level 1 must match the key name of level 2. There is NO `previous_building` field — the chain is forward-only via `next_building`.
- **province_modifier vs county_modifier confusion**: `province_modifier` affects only the barony where the building is. `county_modifier` affects the whole county. Use the right one.
- **character_modifier vs county_holder_character_modifier**: `character_modifier` targets the barony holder. `county_holder_character_modifier` targets the county holder. These differ when a barony is held by someone other than the county holder.
- **Modifiers don't stack across types**: If you have both `county_modifier` and `duchy_capital_county_modifier`, they serve different purposes — county_modifier affects only the building's county, duchy_capital_county_modifier affects all counties in the duchy.
- **AI never builds**: Set `ai_value` with a reasonable base (10-100). Without it, AI ignores the building.
- **Cost too high/low for era**: Check vanilla buildings of the same era for reference costs. Early medieval buildings cost 50-200 gold, late medieval 200-600.
- **Building not showing in-game**: Check error.log for syntax errors. Verify the file is in the correct folder and has .txt extension.
- **Special building barony check**: For special buildings, make sure the barony title key exists in the game. Use `title:b_barony_name` format in is_enabled.
- **Forgetting fallback**: If `is_enabled` can be false for an existing building, consider using `fallback` to apply reduced/negative modifiers instead of nothing.
