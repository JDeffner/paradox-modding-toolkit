# Creating Governments -- Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
Governments define how a ruler's realm operates: which holdings they use, how vassals contribute taxes/levies, what succession rules apply, what AI behaviors are enabled, and what modifiers the ruler gets. They are defined in `common/governments/` and need localization plus a map color.

Key concepts:
- **government_rules**: A bitmask of boolean flags that toggle hardcoded mechanics (councils, dynasties, legitimacy, raiding, administrative features, etc.).
- **mechanic_type**: Links the government to a hardcoded "family" (feudal, clan, theocracy, administrative, nomad, etc.). Only one government per mechanic_type should be `is_mechanic_type_default = yes`.
- **fallback**: At least one government must be a fallback (priority 1 = highest). Used when no other government is valid for a character.
- **Holdings**: `primary_holding` is the main type; `valid_holdings` lists additional types the ruler can directly hold; `required_county_holdings` lists what must exist in a county before extras can be built.
- **vassal_contract_group**: Points to a vassal contract defined in `common/subject_contracts/`. Determines tax/levy obligations.
- **flags**: Custom string flags testable via `government_has_flag`. Preferred over `has_government` checks for moddability.
- **character_modifier / top_liege_character_modifier**: Static modifiers applied to all rulers (or only independent top lieges) with this government.

> Reference: `common/governments/_governments.info`

## Minimal Template

### common/governments/my_government_types.txt
```
my_custom_government = {
	# --- Government rules (all default to no/yes per the info file) ---
	government_rules = {
		create_cadet_branches = yes
		rulers_should_have_dynasty = yes
		legitimacy = yes
	}

	# --- Mechanic type (links to hardcoded family) ---
	# Supported: feudal, clan, theocracy, administrative,
	#            mercenary, holy_order, landless_adventurer,
	#            herder, nomad, mandala
	# Omit if truly unique; set is_mechanic_type_default = yes
	# only if this is THE default for that family.

	# --- Holdings ---
	primary_holding = castle_holding
	valid_holdings = { city_holding }
	required_county_holdings = { castle_holding city_holding church_holding }

	# --- Vassal contracts ---
	vassal_contract_group = feudal_vassal

	# --- Eligibility trigger (character scope, checked when landed) ---
	can_get_government = {
		# e.g. culture/faith/DLC checks
		always = yes
	}

	# --- AI behavior ---
	ai = {
		use_lifestyle = yes
		arrange_marriage = yes
		use_goals = yes
		use_decisions = yes
		use_scripted_guis = yes
		use_legends = yes
		perform_religious_reformation = yes
		use_great_projects = no
	}

	# --- Modifier applied to every ruler with this government ---
	character_modifier = {
		monthly_prestige = 0.5
	}

	# --- Flags (use these for scripted checks) ---
	flags = {
		government_is_my_custom
		government_is_settled
		government_uses_domain_limit
	}

	# --- Fallback priority (0 = not a fallback, 1 = highest priority) ---
	fallback = 0

	# --- Royal court access ---
	# none / any / top_liege
	royal_court = any

	# --- Map color ---
	color = hsv{ 0.50 0.80 0.70 }
	realm_mask_offset = { 0.0 0.01 }
	realm_mask_scale = { 1 1 }
}
```

### Localization (localization/english/my_government_l_english.yml)
```
l_english:
 my_custom_government: "My Custom Government"
 my_custom_government_desc: "Rulers of this government type hold castles and manage feudal-style contracts."
```

The localization key is the government's database key. The `_desc` variant is shown in tooltips.

## Common Variants

### Feudal-style (landed dynasty, crown authority)
```
my_feudal_variant = {
	government_rules = {
		create_cadet_branches = yes
		rulers_should_have_dynasty = yes
		dynasty_named_realms = yes
		legitimacy = yes
	}

	primary_holding = castle_holding
	valid_holdings = { temple_citadel_holding }
	required_county_holdings = { castle_holding city_holding church_holding }

	vassal_contract_group = feudal_vassal
	royal_court = any
	fallback = 0

	flags = {
		government_is_my_feudal_variant
		government_is_settled
		government_uses_crown_authority
		government_uses_domain_limit
	}

	color = hsv{ 0.60 0.90 0.75 }
	realm_mask_offset = { 0.0 0.01 }
	realm_mask_scale = { 1 1 }
}
```

### Clan-style (house unity, alliance opinion)
```
my_clan_variant = {
	government_rules = {
		create_cadet_branches = yes
		rulers_should_have_dynasty = yes
		legitimacy = yes
		dynasty_named_realms = yes
		always_use_patronym = yes
	}

	primary_holding = castle_holding
	valid_holdings = { temple_citadel_holding }
	required_county_holdings = { castle_holding city_holding church_holding }

	# Clan house unity (defined in common/house_unities/)
	house_unity = clan_house_unity

	vassal_contract_group = clan_vassal

	# Clan-style opinion: powerful vassals want alliances
	opinion_of_liege = {
		scope:vassal = {
			if = {
				limit = {
					is_powerful_vassal = yes
					NOT = { is_allied_to = scope:liege }
				}
				value = -30
			}
		}
	}
	opinion_of_liege_desc = {
		first_valid = {
			triggered_desc = {
				trigger = {
					scope:vassal = {
						NOT = { is_allied_to = scope:liege }
						is_powerful_vassal = yes
					}
				}
				desc = "MY_CLAN_NOT_ALLIED_POWERFUL"
			}
		}
	}

	flags = {
		government_is_my_clan_variant
		government_is_settled
		government_uses_crown_authority
		government_uses_domain_limit
	}

	color = hsv{ 0.39 0.93 0.54 }
	realm_mask_offset = { 0.0 0.03 }
	realm_mask_scale = { 1 1 }
}
```

### Tribal-style (prestige economy, raiding)
```
my_tribal_variant = {
	government_rules = {
		rulers_should_have_dynasty = yes
		regiments_prestige_as_gold = yes   # MaA bought with prestige
		legitimacy = yes
		affected_by_development = no
	}

	primary_holding = tribal_holding
	required_county_holdings = { tribal_holding }
	valid_holdings = { castle_holding }

	supply_limit_mult_for_others = -0.5
	prestige_opinion_override = { -10 0 3 5 10 20 }

	vassal_contract_group = tribal_vassal

	character_modifier = {
		title_creation_cost_mult = -0.5
		army_maintenance_mult = -0.5
		ai_war_chance = 0.25
		monthly_prestige = 0.2
	}

	flags = {
		government_is_my_tribal_variant
		government_is_settled
		government_can_raid_rule
		use_prestige_to_buy_maa
	}

	color = hsv{ 0.02 0.75 0.36 }
	realm_mask_offset = { 0.0 0.0 }
	realm_mask_scale = { 0.96 0.96 }
}
```

### Theocracy-style (religious ruler, no dynasty)
```
my_theocracy_variant = {
	government_rules = {
		religious = yes
		inherit_from_dynastic_government = no
	}

	primary_holding = church_holding
	valid_holdings = { castle_holding }
	required_county_holdings = { church_holding castle_holding city_holding }

	can_get_government = {
		NOT = {
			faith = { has_doctrine = doctrine_theocracy_lay_clergy }
		}
	}

	vassal_contract_group = theocracy_vassal

	flags = {
		government_is_my_theocracy_variant
		government_is_settled
		government_uses_domain_limit
	}

	mechanic_type = theocracy

	color = hsv{ 0.00 0.00 0.78 }
	realm_mask_offset = { 0.0 0.02 }
	realm_mask_scale = { 0.95 0.95 }
}
```

### Administrative-style (DLC required, domicile, treasury)
```
my_admin_variant = {
	government_rules = {
		create_cadet_branches = yes
		rulers_should_have_dynasty = yes
		administrative = yes          # Enables admin mechanics (requires dlc_flag admin_gov)
		landless_playable = yes        # Vassals playable without counties
		legitimacy = yes
		state_faith = yes
		sticky_government = yes
		house_aspirations = yes
		noble_families = yes
		treasury = yes
		replace_gold_cost_by_treasury = yes
		inherit_from_dynastic_government = no
	}

	domicile_type = estate              # Defined in common/domiciles/
	main_administrative_tier = duchy
	min_appointment_tier = duchy
	minimum_provincial_maa_tier = duchy

	royal_court = any
	blocked_subject_courts = { my_admin_variant }

	primary_holding = castle_holding
	valid_holdings = { city_holding temple_citadel_holding }
	required_county_holdings = { castle_holding city_holding church_holding }

	vassal_contract_group = admin_vassal

	character_modifier = {
		levy_size = -0.5
		men_at_arms_cap = -2
		men_at_arms_limit = -2
		knight_limit = -5
		vassal_limit = 100
		title_creation_cost_mult = -0.5
		monthly_treasury_from_liege_mult = -0.15
	}

	top_liege_character_modifier = {
		monthly_treasury_from_vassals = 0.85
		men_at_arms_maintenance = 1.5
	}

	flags = {
		government_is_my_admin_variant
		government_has_influence
		government_has_treasury
		government_has_title_men_at_arms
		government_has_powerful_families
		government_is_settled
		government_uses_domicile_but_not_adventurer
		government_uses_domain_limit
	}

	mechanic_type = administrative

	color = { 72 6 92 }
	realm_mask_offset = { 0.0 0.01 }
	realm_mask_scale = { 1 1 }
}
```

## Checklist

1. **File created**: `common/governments/my_government_types.txt` with your government definition.
2. **Localization**: `localization/english/my_government_l_english.yml` with `my_government_key` and `my_government_key_desc`.
3. **primary_holding** set and the holding type exists in `common/holdings/`.
4. **valid_holdings** includes any extra holding types the ruler can hold directly.
5. **required_county_holdings** lists what must be present before duplicates/extras can be built.
6. **vassal_contract_group** points to a valid group in `common/subject_contracts/`. If creating a new group, define it there.
7. **can_get_government** trigger returns true for intended characters (check culture, faith, DLC flags as needed).
8. **flags** defined -- use `government_has_flag = my_flag` in scripts instead of `has_government` where possible.
9. **character_modifier** reviewed -- modifiers must be generic (hardcoded) or from schemes/holdings/lifestyles/regions databases only.
10. **color** set -- uses `hsv{ h s v }` or `rgb{ r g b }` or `{ r g b }` (0-255 integers).
11. **No duplicate mechanic_type defaults** -- only one government per mechanic_type should have `is_mechanic_type_default = yes`.
12. **AI block** reviewed -- disable features (arrange_marriage, use_goals, etc.) only for non-playable governments like mercenaries/holy orders.

## Pitfalls

### "My government doesn't appear / characters revert to feudal"
- **can_get_government** trigger is failing. Check DLC flags, culture/heritage requirements, and faith conditions. A character who fails this trigger gets assigned the fallback government instead.
- If you set `mechanic_type` to one that requires a DLC (e.g., `administrative` needs Roads to Power), characters without the DLC will fail silently.

### "Vassals give no taxes or levies"
- The **vassal_contract_group** must point to an existing contract in `common/subject_contracts/`. If you create a custom group, it needs its own file with obligation definitions and localization.
- Administrative governments use treasury-based economics (`treasury = yes`, `replace_gold_cost_by_treasury = yes`). Without these, admin vassals may produce no gold income.

### "Character modifier not working"
- Government `character_modifier` only supports **generic hardcoded modifiers** and modifiers generated from schemes, holdings, lifestyles, and regions. Modifiers from other governments, men_at_arms_types, cultures, or terrain are NOT allowed here.

### "Map color not showing / wrong color"
- `color` must be defined. Accepts `hsv{ h s v }`, `rgb{ r g b }`, or bare `{ r g b }` (integers 0-255). Missing color causes invisible map mode.
- `realm_mask_offset` and `realm_mask_scale` control the realm map pattern -- set them or inherit visual glitches.

### "AI rulers do nothing / act weird"
- Unplayable governments (mercenaries, holy orders, herders) should disable most AI features: `arrange_marriage = no`, `use_goals = no`, `use_scripted_guis = no`, `perform_religious_reformation = no`, `use_legends = no`.
- Playable governments should leave AI defaults as `yes` unless you have a specific reason to disable something.

### "Inheritance breaks across government types"
- `inherit_from_dynastic_government = no` prevents dynastic-government characters from inheriting titles held by this government. Administrative and theocratic governments use this to stop feudal rulers from absorbing their land.
- `compatible_government_type_succession` can whitelist specific other government types as valid succession candidates (used by Japan's Ritsuryo/Soryo pair).

### "Ruler can hold multiple primary-tier titles unexpectedly"
- `admin_allows_holding_multiple_primary_tier_titles = yes` enables this for administrative governments. Only affects appointment/succession transfers. Set to `no` to restrict.

### "Government flags vs has_government"
- Prefer `government_has_flag` checks in triggers and effects. Flags are moddable (other mods can add/remove them); `has_government` is a hard reference to a specific government key.
- Vanilla uses flags like `government_is_settled`, `government_uses_crown_authority`, `government_uses_domain_limit`, `government_can_raid_rule` for cross-government behavior.

### "opinion_of_liege shows raw loc key"
- If you define `opinion_of_liege`, you must also define `opinion_of_liege_desc` with the matching localization key. The `desc` string must exist in your loc files or it displays raw.

### "DLC-gated features silently fail"
- `administrative = yes` requires `dlc_flag admin_gov` (Roads to Power DLC).
- `landless_playable = yes` requires `dlc_flag landless_playable`.
- `uses_county_fertility = yes` / `obedience = yes` are nomad/herder features from Wandering Nobles DLC.
- Always gate `can_get_government` with the relevant DLC trigger (e.g., `has_tgp_dlc_trigger = yes`).

### "prestige_opinion_override has wrong number of values"
- The array length must match the define `NCharacterOpinion::PRESTIGIOUS`. Vanilla tribal uses 6 values: `{ -10 0 3 5 10 20 }`. Too few or too many values cause errors.
