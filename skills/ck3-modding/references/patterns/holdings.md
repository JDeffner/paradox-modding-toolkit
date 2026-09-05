# Holdings

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
- Holdings are defined in `common/holdings/` as `.txt` files
- A holding type determines which buildings can be constructed in a barony and what primary building it starts with
- Vanilla holding types: `castle_holding`, `city_holding`, `church_holding`, `tribal_holding`, `nomad_holding`, `herder_holding`, `temple_citadel_holding`
- Each holding has exactly one `primary_building` that is automatically built when the holding is created
- The `buildings` list defines which first-level buildings are constructible in that holding type (does NOT include the primary building)
- Holdings are closely tied to governments: feudal rulers use castles, republics use cities, theocracies use temples, tribal rulers use tribal holdings
- Auto-generated modifiers exist for each holding type (e.g., `castle_holding_build_speed`, `church_holding_build_gold_cost`) that work everywhere the generic `build_speed` / `build_gold_cost` modifiers do
- Localization keys follow the pattern: `<holding_key>` for name, `<holding_key>_desc` for description (e.g., `castle_holding` and `castle_holding_desc`)

## Minimal Template

### common/holdings/my_holdings.txt
```
my_custom_holding = {
	# The building auto-constructed when this holding is created
	primary_building = my_primary_building_01

	# First levels of all buildings constructible in this holding
	# (does NOT include the primary_building)
	buildings = {
		farm_estates_01
		barracks_01
		workshops_01
	}

	# Can baronies with this holding be inherited?
	# Default: yes
	can_be_inherited = yes
}
```

### Localization (localization/english/my_holdings_l_english.yml)
```
l_english:
 my_custom_holding: "Custom Holding"
 my_custom_holding_desc: "A custom holding type for your mod."
```

**IMPORTANT**: The primary building referenced here must exist in `common/buildings/`. If it does not, the holding will error on creation.

## Common Variants

### Standard Feudal-Style Holding (Castle Pattern)
Mirrors vanilla `castle_holding` with a full building list:
```
my_fortress_holding = {
	primary_building = my_fortress_01

	buildings = {
		curtain_walls_01
		barracks_01
		military_camps_01
		farm_estates_01
		workshops_01
		smiths_01
		stables_01
		common_tradeport_01
	}
}
```

### Minimal Holding with No Buildings (Nomad Pattern)
For holdings that should not allow any construction (like vanilla `nomad_holding`):
```
my_camp_holding = {
	primary_building = my_camp_01

	# Does not count toward domain limit when disabled
	counts_toward_domain_limit_if_disabled = no

	can_be_inherited = yes

	# Restrict inheritance to specific government types
	required_heir_government_types = {
		my_custom_government
	}

	# Custom parameters checkable via has_holding_parameter trigger
	parameters = {
		no_buildings    # Prevents any building construction
		no_levies       # Custom flag — meaning depends on your scripting
		county_fertility
	}
}
```

### Temple/Religious Holding (Church Pattern)
Based on vanilla `church_holding`:
```
my_temple_holding = {
	primary_building = temple_01

	buildings = {
		hospices_01
		scriptorium_01
		monastic_schools_01
		megalith_01
		farm_estates_01
		barracks_01
		workshops_01
		common_tradeport_01
	}

	can_be_inherited = yes
}
```

### Hybrid Holding with Unique Buildings (Temple Citadel Pattern)
Based on vanilla `temple_citadel_holding` — a holding with both unique and shared buildings:
```
my_special_holding = {
	primary_building = my_special_primary_01

	buildings = {
		# Unique buildings only available in this holding type
		my_unique_shrine_01
		my_unique_pool_01

		# Shared buildings also found in other holdings
		capital_bureau_01
		farm_estates_01
		barracks_01
		workshops_01
		common_tradeport_01
	}

	can_be_inherited = yes
}
```

## Key Fields Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `primary_building` | key (required) | none | Building auto-built on holding creation |
| `buildings` | list of keys | empty | First-level buildings constructible in this holding |
| `can_be_inherited` | bool | yes | Whether baronies with this holding can be inherited |
| `counts_toward_domain_limit_if_disabled` | bool | yes | Count toward domain limit when holding is disabled |
| `required_heir_government_types` | list of keys | none | Government types required to inherit the county title when this is the capital holding; first in list used for generated characters |
| `parameters` | list of keys | none | Arbitrary flags checkable with `has_holding_parameter` trigger |

## Auto-Generated Modifiers

For every holding type `<key>`, the game automatically creates these modifiers:
- `<key>_build_speed` / `<key>_holding_build_speed`
- `<key>_build_gold_cost` / `<key>_holding_build_gold_cost`
- `<key>_build_piety_cost` / `<key>_holding_build_piety_cost`
- `<key>_build_prestige_cost` / `<key>_holding_build_prestige_cost`

The `<key>_build_*` variants affect buildings constructed inside the holding. The `<key>_holding_build_*` variants affect the holding itself being built. Both work everywhere the generic `build_speed` / `build_gold_cost` modifiers work.

Example usage in a modifier block:
```
castle_holding_build_gold_cost = -0.1   # 10% cheaper to build buildings in castles
```

## Government Requirements

The `required_heir_government_types` field controls succession behavior:
- When a character dies and a county with this holding as its capital province is inherited, the heir **must** have one of the listed government types
- If generating a new character for the title (e.g., no valid heir), the **first** government in the list is used
- Government types are defined in `common/governments/`
- If omitted, no government restriction applies

## Graphical Appearance

Holdings themselves do not define graphical assets directly. The visual appearance on the 3D map comes from:
1. The **primary building** and its building chain (buildings define `asset` blocks for map meshes)
2. **Map object data** in `gfx/map/map_object_data/` for 3D models placed on the map
3. The holding type determines which **map icon** and **province highlight** is used in the UI

To change how a holding looks on the map, modify the primary building's `asset` definition or create map objects tied to the holding's province.

## Checklist
- [ ] Holding defined in `common/holdings/` as `.txt` file
- [ ] Localization files UTF-8 **with BOM**; script `.txt` files UTF-8 (BOM optional, vanilla ships with it)
- [ ] `primary_building` points to a valid building key in `common/buildings/`
- [ ] Every entry in `buildings` list is a valid first-level building key (the `_01` level)
- [ ] The primary building is NOT also listed in `buildings`
- [ ] Localization: `<holding_key>` and `<holding_key>_desc` in localization files
- [ ] If using `required_heir_government_types`, the government keys exist in `common/governments/`
- [ ] If using `parameters`, scripted checks reference them with `has_holding_parameter`
- [ ] Buildings listed in `buildings` have appropriate `is_enabled` / `can_construct` triggers
- [ ] Test in-game: verify the holding appears and buildings are constructible

## Common Pitfalls
- **Primary building does not exist**: If `primary_building` references a key not defined in `common/buildings/`, the holding will fail silently or error on creation. Always verify the building exists.
- **Listing primary building in buildings list**: The `primary_building` is automatically built and must NOT appear in the `buildings` block. Including it can cause duplication issues.
- **Building list references wrong level**: The `buildings` list must contain first-level buildings (e.g., `barracks_01`, not `barracks_02`). Higher levels are handled by the building's `next_building` chain.
- **Forgetting can_be_inherited**: Defaults to `yes`, but if you set it to `no`, baronies with this holding cannot be inherited through succession — they revert to the liege or generate a new holder. This is rarely desired for standard holdings.
- **parameters are just flags**: The `parameters` block (e.g., `no_buildings`, `no_levies`) are arbitrary string flags. They have no built-in behavior — their effect depends entirely on triggers and scripted checks elsewhere that call `has_holding_parameter`. Adding `no_buildings` does NOT automatically prevent construction unless something checks for it.
- **Government type mismatch**: If `required_heir_government_types` lists a government the player/AI never uses, counties with this holding as capital become uninhertable in practice. Make sure the listed governments are achievable.
- **Missing localization**: Without `<holding_key>` localization, the game displays the raw key string wherever the holding type name appears (tooltips, province view, etc.).
- **Confusing holding modifiers with building modifiers**: The auto-generated `<holding>_build_speed` modifier affects building speed *within* holdings of that type. It does NOT make the holding itself build faster — use `<holding>_holding_build_speed` for that.
- **Overriding vanilla holdings**: If your holding key matches a vanilla key (e.g., `castle_holding`), it completely replaces the vanilla definition including its entire building list. Use unique prefixed keys for new holdings.
