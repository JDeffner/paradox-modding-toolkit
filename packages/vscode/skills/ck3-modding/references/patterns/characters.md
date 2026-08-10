# Character Interactions and Character Modding — Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
Character interactions are actions one character performs on another. They're defined in `common/character_interactions/` and use `scope:actor` (initiator) and `scope:recipient` (target). For adding/editing historical characters, see `history/characters/`.

## Minimal Template — Character Interaction

### common/character_interactions/my_interactions.txt
```
my_custom_interaction = {
	category = interaction_category_diplomacy

	is_shown = {
		NOT = { scope:actor = scope:recipient }
	}

	on_accept = {
		scope:actor = {
			add_opinion = {
				target = scope:recipient
				modifier = grateful_opinion
				opinion = 20
			}
		}
	}

	auto_accept = yes

	ai_targets = {
		ai_recipients = liege
	}
	ai_frequency = 12
	ai_potential = {
		always = yes
	}
	ai_will_do = {
		base = 50
	}
}
```

### Localization
```
l_english:
 my_custom_interaction: "My Custom Interaction"
 my_custom_interaction_desc: "Do something with this character."
```

## Minimal Template — Historical Character

### history/characters/my_characters.txt
```
my_mod_001 = {
	name = "Custom Character"
	female = yes
	dynasty = 1
	martial = 12
	diplomacy = 15
	intrigue = 10
	stewardship = 8
	learning = 14
	religion = catholic
	culture = french
	trait = diligent
	trait = education_diplomacy_3
	disallow_random_traits = yes
	867.1.1 = {
		birth = yes
	}
	940.6.15 = {
		death = yes
	}
}
```

## Common Variants

### Interaction requiring acceptance
```
my_proposal_interaction = {
	category = interaction_category_diplomacy

	is_shown = {
		scope:actor = { is_ruler = yes }
	}

	on_accept = {
		# What happens if recipient accepts
		scope:actor = { add_gold = 100 }
	}

	on_decline = {
		# What happens if recipient declines
		scope:actor = {
			add_opinion = {
				target = scope:recipient
				modifier = insulted_opinion
				opinion = -10
			}
		}
	}

	# AI acceptance logic
	ai_accept = {
		base = -50
		modifier = {
			add = 100
			scope:recipient = {
				opinion = {
					target = scope:actor
					value >= 50
				}
			}
		}
	}
}
```

### Creating a character via script (in events)
```
create_character = {
	name = "Generated Character"
	age = 25
	female = no
	culture = root.culture
	faith = root.faith
	trait = brave
	trait = education_martial_3
	save_scope_as = new_character
}
```

## Checklist
- [ ] Interaction file in `common/character_interactions/` with `.txt` extension
- [ ] `category` set (determines where it appears in the menu)
- [ ] Localization for interaction name and description
- [ ] Either `auto_accept = yes` or `ai_accept` block for AI logic
- [ ] Scopes used correctly: `scope:actor` and `scope:recipient` (no `root` in interactions)
- [ ] For historical characters: unique ID, birth/death dates, culture, religion

## Common Pitfalls
- **No root scope**: Character interactions do NOT have a `root` scope. Use `scope:actor` and `scope:recipient` instead
- **Interaction in "Uncategorized"**: Set `category` to place it in the right menu section
- **auto_accept conflict**: If `auto_accept = yes`, the `on_decline` block and `ai_accept` are never used
- **Character IDs**: Historical character IDs must be unique. Use high numbers (900000+) to avoid conflicts with vanilla
- **Missing birth date**: Characters without a birth date block will cause errors
- **Effect block in interaction**: Use `on_accept` (not `effect`) for the main action. Also available: `on_send`, `on_decline`, `on_blocked_effect`
