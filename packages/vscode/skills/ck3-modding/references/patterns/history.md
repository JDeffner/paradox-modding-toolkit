# History Files — Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
History files define the starting state of the game world: which characters exist, who holds what titles, and what buildings/culture/religion each province has. All history files share a common pattern: top-level key-value pairs set the initial state, and dated blocks override values at specific dates. Files live under `history/characters/`, `history/titles/`, and `history/provinces/`.

History is read chronologically. The game applies the base values first, then applies each dated block in order up to the selected start date. Later dates overwrite earlier ones.

## Minimal Templates

### Character History — history/characters/my_characters.txt
```
# Character IDs must be globally unique across ALL character history files.
# Files are typically organized by culture group.

my_char_1001 = {
	name = "Godric"
	dynasty = 500          # dynasty ID from common/dynasties/
	culture = anglo_saxon
	religion = catholic    # can also use faith = insular_christianity
	female = no            # omit for male (default)

	# Optional stats (if omitted, generated randomly)
	diplomacy = 8
	martial = 12
	stewardship = 6
	intrigue = 4
	learning = 5
	prowess = 10

	# Family links (by character ID)
	father = my_char_900
	mother = my_char_901

	trait = brave
	trait = education_martial_3
	disallow_random_traits = yes   # prevents the game from adding random traits

	# Dated blocks
	845.3.15 = {
		birth = yes
	}
	870.6.1 = {
		add_spouse = my_char_1050   # regular (patrilineal) marriage
	}
	910.11.20 = {
		death = yes
	}
}

my_char_1050 = {
	name = "Aelfgifu"
	female = yes
	dynasty = 501
	culture = anglo_saxon
	religion = catholic
	trait = education_stewardship_2

	850.1.1 = {
		birth = yes
	}
	920.1.1 = {
		death = yes
	}
}
```

### Title History — history/titles/k_my_kingdom.txt
```
# File is named after the top-level title but can contain any titles.
# Title keys must match titles defined in common/landed_titles/.

k_my_kingdom = {
	867.1.1 = {
		holder = my_char_1001           # character ID
		change_development_level = 5    # adds to county development
		succession_laws = { saxon_elective_succession_law }
	}
	910.11.20 = {
		holder = my_char_1002           # new holder on the old one's death
	}
	1066.1.1 = {
		change_development_level = 10
	}
}

d_my_duchy = {
	867.1.1 = {
		holder = my_char_1001
	}
}

c_my_county = {
	867.1.1 = {
		holder = my_char_1001
	}
}

# Baronies (b_) are not assigned holders in title history.
# The game auto-generates barons for non-capital holdings.
```

### Province History — history/provinces/k_my_kingdom.txt
```
# Province files are named by the kingdom they belong to.
# Each entry is keyed by the province ID (a number from the map).
# The first province listed in a county sets culture/religion for the county.

# County: c_my_county
1234 = {                          # province ID (from the map definition)
	culture = anglo_saxon
	religion = catholic
	holding = castle_holding      # castle_holding, city_holding, church_holding, tribal_holding, none, auto
	867.1.1 = {
		buildings = {
			farm_estates_01
			curtain_walls_01
		}
	}
	1066.1.1 = {
		buildings = {
			castle_02
			farm_estates_02
			curtain_walls_01
		}
	}
}
1235 = {                          # second barony in the county
	holding = city_holding
}
1236 = {
	holding = church_holding
}
1237 = {
	holding = none                # empty slot
	1000.1.1 = {
		holding = castle_holding  # holding appears at this date
	}
}
```

### Localization — localization/english/my_history_l_english.yml
```
l_english:
 # Character names use the "name" field directly — no loc key needed
 # unless you want to override display. Dynasty names need loc:
 dynasty_500: "Godricson"
 dynasty_501: "Aelfing"

 # Titles need loc (defined with the landed_titles, not here).
 # Nicknames used via give_nickname need loc:
 nick_the_bold: "the Bold"
```

## Common Variants

### Character — Marriage Types
```
870.6.1 = {
	add_spouse = 1050                   # standard (patrilineal) marriage
}
870.6.1 = {
	add_matrilineal_spouse = 1050       # children get mother's dynasty
}
870.6.1 = {
	add_same_sex_spouse = 1050          # same-sex marriage
}
```

### Character — Effects in Dated Blocks
```
880.1.1 = {
	effect = {
		set_relation_rival = {
			target = character:1099
			reason = rival_historical
		}
	}
}
885.1.1 = {
	effect = {
		set_relation_friend = {
			target = character:1098
			reason = friend_generic_history
		}
	}
}
```

### Character — Optional Fields
```
my_char_2000 = {
	name = "Harald"
	dynasty_house = house_id       # assign to a specific house (branch of dynasty)
	sexuality = homosexual          # heterosexual (default), homosexual, bisexual, asexual
	give_nickname = nick_the_bold
	health = 3                     # override base health
	fertility = 0.5                # override base fertility
	dna = my_char_2000_dna         # reference a DNA string for appearance

	# Change culture/faith mid-life
	900.1.1 = {
		set_culture = norse
		set_character_faith_no_effect = catholic   # changes faith without event effects
	}

	portrait_override = {
		portrait_modifier_overrides = {
			clothes = western_low_nobles
		}
		hair = { 0.592 0.314 0.176 }
	}
}
```

### Title — Succession and Laws
```
k_england = {
	927.7.12 = {
		holder = 33350
		succession_laws = { saxon_elective_succession_law }
	}
	1066.10.14 = {
		holder = 140
		remove_succession_laws = yes       # clears all existing succession laws
	}
}
```

### Title — Set Capital via Effect
```
k_england = {
	700.1.1 = {
		effect = {
			set_capital_county = title:c_hampton
		}
	}
}
```

### Province — Special Buildings
```
2333 = {
	culture = french
	religion = catholic
	holding = castle_holding
	769.1.1 = {
		special_building_slot = notre_dame_01         # enables the slot
	}
}

# Or build it immediately:
5555 = {
	holding = castle_holding
	special_building = hagia_sophia_01                # enables slot AND builds it
	duchy_capital_building = duchy_capital_building_01 # only for duchy capitals
}
```

### Province — Changing Culture/Religion Over Time
```
4000 = {
	culture = norse
	religion = norse_pagan
	holding = tribal_holding
	1000.1.1 = {
		culture = danish        # culture shifts
		religion = catholic     # conversion
		holding = castle_holding
	}
}
```

## Checklist

### Character History
- [ ] Character ID is globally unique (check all files in history/characters/)
- [ ] `birth = yes` date block exists (character will not spawn without it)
- [ ] `death = yes` date block exists for characters who die before the latest start date
- [ ] Birth date is before any title history that references this character as holder
- [ ] `culture` and `religion` (or `faith`) are set and reference valid IDs
- [ ] `dynasty` references a valid dynasty ID from common/dynasties/
- [ ] `father`/`mother` IDs reference characters defined elsewhere with valid birth/death dates
- [ ] At least one `education_*` trait is assigned
- [ ] Spouse is added via a dated block AFTER both characters' birth dates

### Title History
- [ ] Title key matches a title defined in common/landed_titles/
- [ ] Every `holder` references a character ID that exists and is alive at that date
- [ ] A character holds at most one title of each tier at a time (game handles this but check logic)
- [ ] `change_development_level` values are reasonable (vanilla uses 5-30 range)
- [ ] Succession law keys are valid (check common/succession_election/)

### Province History
- [ ] Province ID matches the map definition (provinces in the map folder)
- [ ] `culture` and `religion` are set for the first province in each county
- [ ] `holding` type is valid: `castle_holding`, `city_holding`, `church_holding`, `tribal_holding`, `none`, `auto`
- [ ] Buildings listed in `buildings = { }` are valid building IDs from common/buildings/
- [ ] Buildings in `buildings = { }` at a later date REPLACE all previous buildings (not additive)
- [ ] `special_building_slot` and `special_building` reference valid building types
- [ ] Province file is named after the kingdom it belongs to

### General
- [ ] All dates use format YYYY.MM.DD (e.g., 867.1.1)
- [ ] Dated blocks are in chronological order (not required but strongly recommended)
- [ ] No overlapping/contradictory entries at the same date
- [ ] Localization exists for any dynasties, nicknames, or custom names

## Pitfalls

**Missing birth block kills the character.**
Every character MUST have a dated `birth = yes` block. Without it, the character simply does not exist in the game. This is the single most common history mistake.

**Character IDs collide silently.**
If two characters share the same ID across different files, one overwrites the other with no error. Always check existing vanilla files before picking IDs. Use high ID ranges (e.g., 900000+) for mod characters to avoid conflicts.

**`buildings = { }` in a later date replaces ALL previous buildings.**
A 1066 buildings block does NOT add to the 867 buildings. It completely replaces them. If you want a province to keep its 867 buildings in 1066, you must re-list them all in the 1066 block.

**Province culture/religion only needs to be set once per county.**
Set `culture` and `religion` on the FIRST province entry for each county. Other provinces in the same county inherit it. Setting it on secondary provinces is harmless but redundant.

**`holding = none` means the slot is empty, not nonexistent.**
Use `none` for baronies that should not have a holding at game start but may gain one later via a dated block. Use `auto` to let the game pick a holding type automatically.

**Title holders must be alive.**
If a title history references a character as holder at a date before their birth or after their death, the title becomes unlanded. The game does not always warn about this.

**`faith` vs `religion` in character history.**
`religion` sets the character's faith to the default faith of that religion. Use `faith` to set a specific faith (e.g., `faith = insular_christianity` instead of `religion = christianity`). Using the wrong one gives the wrong faith silently.

**Spouse additions must be in dated blocks.**
`add_spouse`, `add_matrilineal_spouse`, and `add_same_sex_spouse` must be inside a dated block, not at the top level of the character definition. Placing them at the top level may cause errors or be ignored.

**`effect = { }` blocks run script commands.**
Use `effect = { }` inside dated blocks when you need to run scripted effects like `set_relation_rival`, `set_relation_friend`, or `set_capital_county`. Regular history commands (birth, death, add_spouse) do NOT go inside effect blocks.

**Province files are named by kingdom, not county.**
All provinces belonging to counties under a kingdom go in one file named after that kingdom (e.g., `k_france.txt`). Putting them in a differently-named file works but breaks convention and makes maintenance harder.

**Date format is YYYY.MM.DD — not YYYY-MM-DD.**
Dots, not dashes. Using dashes will silently fail to parse the date block.
