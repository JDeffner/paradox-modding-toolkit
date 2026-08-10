# Creating Lifestyles — Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
A custom lifestyle requires three interconnected pieces: a **lifestyle** (XP container), **focuses** (active bonuses that feed XP into the lifestyle), and **perks** (unlockable nodes arranged in trees). Each focus belongs to exactly one lifestyle, and each perk belongs to exactly one lifestyle and one tree.

Files involved:
- `common/lifestyles/` — lifestyle definitions (XP thresholds, validity)
- `common/focuses/` — focus definitions (modifiers, AI weight)
- `common/lifestyle_perks/` — perk trees (position, parents, effects)
- `localization/english/` — names and descriptions for all three

> Reference docs: `common/lifestyles/_lifestyles.info`, `common/lifestyle_perks/_lifestyle_perks.info`, `common/focuses/_focuses.info`

## Minimal Template

### common/lifestyles/my_lifestyles.txt
```
my_lifestyle = {
	# Highlight this lifestyle in the UI when condition is met (character scope)
	is_highlighted = {
		has_trait = education_diplomacy
	}

	# Optional validity gate — hides/locks if false
	# is_valid = { has_dlc_feature = my_dlc }

	xp_per_level = 1000    # XP needed per perk point
	base_xp_gain = 25      # Monthly XP before modifiers
}
```

### common/focuses/my_focuses.txt
```
my_focus_alpha = {
	lifestyle = my_lifestyle      # Required: links to the lifestyle

	modifier = {
		diplomacy = 3
	}

	desc = {
		desc = my_focus_alpha_desc
		desc = line_break
	}

	auto_selection_weight = {
		value = 100
	}
}

my_focus_beta = {
	lifestyle = my_lifestyle

	modifier = {
		diplomacy = 1
		monthly_prestige = 1
	}

	desc = {
		desc = my_focus_beta_desc
		desc = line_break
	}

	auto_selection_weight = {
		value = 100
	}
}
```

### common/lifestyle_perks/my_tree_perks.txt
```
# Tree: my_tree (3 perks + finisher)

my_root_perk = {
	lifestyle = my_lifestyle
	tree = my_tree
	position = { 2 0 }           # Column Row — multiplied by PERK_X_OFFSET/PERK_Y_OFFSET
	icon = node_diplomacy         # Reuse vanilla icons or provide custom

	auto_selection_weight = {
		value = 11
		if = {
			limit = { has_focus = my_focus_alpha }
			multiply = 5
		}
		if = {
			limit = { can_start_new_lifestyle_tree_trigger = no }
			multiply = 0
		}
	}

	character_modifier = {
		diplomacy = 1
	}
}

my_left_perk = {
	lifestyle = my_lifestyle
	tree = my_tree
	position = { 0 1.25 }
	icon = node_diplomacy

	parent = my_root_perk

	character_modifier = {
		monthly_prestige = 0.5
	}
}

my_right_perk = {
	lifestyle = my_lifestyle
	tree = my_tree
	position = { 4 1.25 }
	icon = node_diplomacy

	parent = my_root_perk

	character_modifier = {
		general_opinion = 5
	}
}

# Finisher perk — converges from both branches
my_finisher_perk = {
	lifestyle = my_lifestyle
	tree = my_tree
	position = { 2 2.5 }
	icon = trait_whole_of_body     # Finishers often use a trait icon

	parent = my_left_perk
	parent = my_right_perk

	# If the finisher grants a trait:
	trait = my_lifestyle_trait
	effect = {
		add_trait_force_tooltip = my_lifestyle_trait
	}
}
```

### localization/english/my_lifestyle_l_english.yml
```
l_english:
 # Lifestyle
 my_lifestyle_name: "My Lifestyle"
 my_lifestyle_desc: "Pursue the path of custom greatness."
 my_lifestyle_highlight_desc: "Your education suggests this lifestyle."

 # Focuses
 my_focus_alpha_name: "Alpha Focus"
 my_focus_alpha_desc: "Concentrate on pure skill."
 my_focus_beta_name: "Beta Focus"
 my_focus_beta_desc: "A balanced approach."

 # Perk tree name (shown as header)
 my_tree: "My Tree"

 # Perks
 my_root_perk_name: "Root Perk"
 my_left_perk_name: "Left Perk"
 my_right_perk_name: "Right Perk"
 my_finisher_perk_name: "Finisher Perk"
```

## Common Variants

### Perk with on-unlock effect (no persistent modifier)
Some perks only fire an effect once, described via `custom_description_no_bullet`. The text key is resolved in loc, not in code.
```
my_effect_perk = {
	lifestyle = my_lifestyle
	tree = my_tree
	position = { 2 1.25 }
	icon = node_diplomacy

	parent = my_root_perk

	effect = {
		custom_description_no_bullet = {
			text = my_effect_perk_effect    # Loc key describing what it does
		}
	}
}
```
The actual mechanical effect is typically implemented in scripted triggers/effects that check `has_perk = my_effect_perk`.

### Perk with government-conditional modifier
Applies extra modifiers only when the character's government has (or lacks) a flag.
```
my_gov_perk = {
	lifestyle = my_lifestyle
	tree = my_tree
	position = { 0 1.25 }
	icon = node_diplomacy

	parent = my_root_perk

	character_modifier = {
		diplomacy = 1
	}

	government_character_modifier = {
		flag = government_is_landless_adventurer
		invert_check = yes               # Applies when government does NOT have this flag
		monthly_prestige = 0.5
	}
}
```

### Perk with doctrine-conditional or culture-conditional modifier
```
my_doctrine_perk = {
	lifestyle = my_lifestyle
	tree = my_tree
	position = { 2 1.25 }
	icon = node_diplomacy
	parent = my_root_perk

	doctrine_character_modifier = {
		doctrine = tenet_monasticism
		monthly_piety = 1
	}

	culture_character_modifier = {
		parameter = has_warrior_culture
		prowess = 2
	}
}
```

### Perk with dynamic name
When a perk should display differently for different governments or contexts.
```
my_dynamic_perk = {
	lifestyle = my_lifestyle
	tree = my_tree
	position = { 0 1.25 }
	icon = node_diplomacy
	parent = my_root_perk

	name = {
		first_valid = {
			triggered_desc = {
				trigger = { government_allows = administrative }
				desc = my_dynamic_perk_admin_name
			}
			desc = my_dynamic_perk_name
		}
	}

	character_modifier = {
		diplomacy = 2
	}
}
```

### Focus with validity restrictions
Restrict a focus to specific government types (common pattern: separate landed vs adventurer focuses).
```
my_landed_focus = {
	lifestyle = my_lifestyle

	is_shown = {
		NOT = { government_has_flag = government_is_landless_adventurer }
	}
	is_valid = {
		NOT = { government_has_flag = government_is_landless_adventurer }
	}

	modifier = {
		diplomacy = 3
	}

	desc = {
		desc = my_landed_focus_desc
		desc = line_break
	}

	auto_selection_weight = {
		value = 100
		if = {
			limit = { government_has_flag = government_is_landless_adventurer }
			multiply = 0
		}
	}
}
```

### Focus with on_change_to / on_change_from effects
```
my_special_focus = {
	lifestyle = my_lifestyle

	modifier = {
		diplomacy = 2
	}

	on_change_to = {
		add_character_flag = has_my_special_focus
	}
	on_change_from = {
		remove_character_flag = has_my_special_focus
	}

	desc = {
		desc = my_special_focus_desc
		desc = line_break
	}

	auto_selection_weight = { value = 100 }
}
```

### Lifestyle with DLC gating
```
my_dlc_lifestyle = {
	is_valid = {
		has_dlc_feature = my_dlc_feature
	}

	is_highlighted = {
		always = yes
	}

	xp_per_level = 1000
	base_xp_gain = 20
}
```

## XP Gain and Thresholds

- `base_xp_gain` is monthly XP **before** modifiers. Vanilla uses 25 for the five core lifestyles, 20 for wanderer.
- `xp_per_level` is how much XP equals one perk point. Vanilla uses 1000 across the board.
- XP gain is modified by the `monthly_lifestyle_xp_gain_mult` modifier and relevant skill-based multipliers.
- A character with matching education trait gets their lifestyle highlighted (cosmetic only, no XP bonus from `is_highlighted`).
- With `base_xp_gain = 25` and `xp_per_level = 1000`, one perk point takes ~40 months (~3.3 years) before modifiers.

## AI Logic

### Focus auto_selection_weight
The AI picks focuses based on `auto_selection_weight` (script value, character scope). Vanilla pattern:
- Base value of 11 for standard focuses.
- `add = 1989` if the character has a matching education trait (making education-matched focuses ~180x more likely).
- `multiply = 5` for personality-aligned focuses (e.g., brave characters prefer chivalry).
- `multiply = 0` to completely exclude a focus (e.g., exclude adventurer focuses for landed rulers).

### Perk auto_selection_weight
The AI also auto-selects perks. Vanilla pattern:
- Base value of 11.
- Large add for matching education.
- `multiply = 5` if the character has the focus matching the tree.
- `multiply = 0` if `can_start_new_lifestyle_tree_trigger = no` (prevents AI from starting trees they cannot finish).
- Defaults to 1000 if omitted.

### Initial selection
When a character first becomes landed or at campaign start, both focus and perks use auto_selection_weight to pick initial values.

## Perk Tree Layout

### Position grid
- `position = { x y }` where x is column, y is row.
- Values are multiplied by `PERK_X_OFFSET` and `PERK_Y_OFFSET` from defines.
- Vanilla uses x values of 0, 2, 4 (three columns) and y increments of 1.25.
- Row 0: root perk (single entry point, usually at x=2).
- Rows 1.25, 2.5: branch perks in left (x=0), center (x=2), right (x=4) columns.
- Row 3.75: convergence perk (multiple parents).
- Row 5: finisher perk (single parent from convergence).

### Parent chain
- Root perks have no `parent`.
- Branch perks list `parent = root_perk`.
- Convergence perks list multiple `parent` entries (one per branch).
- The game draws lines between parent and child automatically.

### Standard vanilla tree shape (medicine example)
```
Row 0:       [Root]          (x=2)
            /  |  \
Row 1.25: [L] [C]  [R]      (x=0, 2, 4)
           |   |    |
Row 2.5:  [L] [C]  [R]      (x=0, 2, 4)
            \  |  /
Row 3.75:  [Converge]       (x=2, parents = L + C + R)
              |
Row 5:    [Finisher]         (x=2, grants trait)
```

## Checklist
- [ ] Lifestyle file in `common/lifestyles/` with `.txt` extension
- [ ] At least one focus in `common/focuses/` pointing to the lifestyle via `lifestyle = my_lifestyle`
- [ ] At least one perk tree in `common/lifestyle_perks/` with perks pointing to the lifestyle
- [ ] Every perk has `lifestyle`, `tree`, and `position` set
- [ ] Root perk has no `parent`; all others have at least one `parent`
- [ ] Finisher perk (if granting a trait) has both `trait = X` and `effect = { add_trait_force_tooltip = X }`
- [ ] The trait granted by a finisher perk actually exists in `common/traits/`
- [ ] Localization keys: `<lifestyle>_name`, `<lifestyle>_desc`, `<lifestyle>_highlight_desc`
- [ ] Localization keys: `<focus>_name`, `<focus>_desc` for each focus
- [ ] Localization keys: `<tree>` for tree header, `<perk>_name` for each perk
- [ ] `auto_selection_weight` on every focus (otherwise AI may never pick it)
- [ ] Test in-game: open lifestyle window, verify tree layout, pick a focus, verify XP ticks monthly

## Common Pitfalls
- **Perk without `lifestyle`**: The perk will not appear in any lifestyle tree. It silently vanishes.
- **Mismatched tree name**: If a perk's `tree` value does not match any other perk's `tree` in the same lifestyle, it creates a new tree with a single perk. This is usually a typo.
- **Missing parent perk**: If `parent = X` references a perk key that does not exist, the game may error or the perk becomes unreachable.
- **Overlapping positions**: Two perks in the same tree with identical `position` will stack on top of each other in the UI.
- **No root perk (no perk at y=0)**: The tree will have no entry point. Players cannot start unlocking perks.
- **Focus without `lifestyle`**: The focus will not grant XP to any lifestyle. It becomes a standalone focus with no progression.
- **`is_highlighted` trigger restrictions**: Lifestyle triggers cannot use scripted triggers, scripted effects, or content-generated triggers (like `has_relation_rival`). Stick to simple built-in triggers like `has_trait`.
- **Forgetting `desc = line_break`**: Vanilla focuses always end their desc block with `desc = line_break` for spacing. Not strictly required, but omitting it may cause UI text to run together.
- **AI ignoring your lifestyle**: If all focuses have `auto_selection_weight = 0` or very low values, AI will never pick them. Always provide a meaningful baseline weight.
- **Finisher perk without trait definition**: If `trait = X` references a trait that does not exist in `common/traits/`, the tooltip will show a broken reference and the effect will fail silently.
