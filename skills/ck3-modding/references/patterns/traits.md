# Creating Traits — Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
Traits modify character attributes, opinions, personality, and other parameters. They're defined in `common/traits/` and need localization and an icon.

## Minimal Template

### common/traits/my_traits.txt
```
my_custom_trait = {
	# Attribute modifiers
	diplomacy = 2
	martial = -1
	intrigue = 1

	# Opinion modifier from this trait holder's perspective
	opposite = my_opposite_trait

	# Trait metadata
	category = personality

	# Icon: gfx/interface/icons/traits/my_custom_trait.dds
}

my_opposite_trait = {
	diplomacy = -2
	martial = 1
	intrigue = -1

	opposite = my_custom_trait
	category = personality
}
```

### Localization (localization/english/my_traits_l_english.yml)
```
l_english:
 trait_my_custom_trait: "My Custom Trait"
 trait_my_custom_trait_desc: "This character has a custom trait that boosts diplomacy."
 trait_my_opposite_trait: "My Opposite Trait"
 trait_my_opposite_trait_desc: "This character has the opposite of the custom trait."
```

### Icon
Place a .dds icon at: `gfx/interface/icons/traits/my_custom_trait.dds`

Default icon size is 60x60 pixels.

## Common Variants

### Genetic trait (inheritable)
```
my_genetic_trait = {
	health = 0.5
	fertility = 0.1
	diplomacy = 2

	genetic = yes
	inherit_chance = 50
	birth = 5
	good = yes

	category = health
}
```

### Trait with same-trait opinion bonus
```
my_social_trait = {
	diplomacy = 2

	# Characters who share this trait get +10 opinion of each other
	same_opinion = 10
	# Variant: same_opinion_if_same_faith = 15 (only if also same faith)

	compatibility = {
		gregarious = 10
		shy = -10
	}

	category = personality
}
```

### Trait with triggered opinion (faith-based virtues/sins)
`triggered_opinion` is for doctrine-linked traits (virtues/sins). It requires a `parameter` referencing a doctrine parameter. Without `parameter`, the tooltip breaks.
```
my_pious_trait = {
	learning = 3

	# Only use triggered_opinion with a doctrine parameter
	triggered_opinion = {
		parameter = some_doctrine_parameter
		opinion_modifier = my_opinion_modifier
		same_faith = yes
		ignore_opinion_value_if_same_trait = yes
	}

	category = personality
}
```

### Trait with level variants (like education traits)
```
my_skill_1 = {
	martial = 2
	category = lifestyle
	# Level 1
}

my_skill_2 = {
	martial = 4
	category = lifestyle
	# Level 2
}

my_skill_3 = {
	martial = 6
	category = lifestyle
	# Level 3
}
```

### Immortal trait
```
my_immortal_trait = {
	immortal = yes
	health = 5
	category = health
}
```
Use `set_immortal_age = 30` effect to keep them visually young.

## XP Tracks / Trait Progression

Traits can have XP-based progression using inline `track` or `tracks` blocks. XP thresholds are integers 0-100 in ascending order, each defining cumulative modifiers at that level.

### Single track (shorthand — track is named after the trait)
```
my_leveling_trait = {
    category = lifestyle
    martial = 2

    track = {
        50 = {
            martial = 2
            prowess = 1
        }
        100 = {
            martial = 4
            prowess = 3
            health = 0.25
        }
    }
}
```

### Multiple tracks
```
my_multi_trait = {
    category = lifestyle

    tracks = {
        combat = {
            30 = { prowess = 1 }
            65 = { prowess = 2 martial = 1 }
            100 = { prowess = 4 martial = 2 }
        }
        tactics = {
            30 = { martial = 1 }
            65 = { martial = 2 }
            100 = { martial = 4 }
        }
    }
}
```

### Degradation
`monthly_track_xp_degradation = { min = 20 change = 5 }` — loses 5 XP per month, never dropping below 20.

### Adding/Checking XP
- Add XP via effect: `add_trait_xp = { trait = X track = X value = 10 }`
- Check XP via trigger: `has_trait_xp = { trait = X track = X value >= 50 }`

### Track Localization
Each track needs its own loc keys: `trait_track_<name>` and `trait_track_<name>_desc`.

## Compatibility Block

Traits can define compatibility for matchmaking/marriage:
```
my_trait = {
    compatibility = {
        my_other_trait = medium_positive    # Values: very_negative, negative, medium_negative, low_negative, low_positive, medium_positive, positive, very_positive
    }
}
```

## same_opinion_if_same_faith

Like same_opinion but only applies if both characters share the same faith:
```
my_pious_trait = {
    same_opinion_if_same_faith = 15
    # Characters with this trait get +15 opinion of each other, but ONLY if they share the same faith
}
```

## Triggered Opinion Clarification

Full pattern with multiple parameter values:
```
my_trait = {
    triggered_opinion = {
        opinion_modifier = my_trait_opinion
        parameter = doctrine_parameter_key
        check_missing = no  # Set to yes to apply when doctrine is MISSING
    }
}
```
The opinion_modifier must be defined separately in common/opinion_modifiers/:
```
my_trait_opinion = {
    opinion = 20
}
```
And the parameter refers to a doctrine parameter. The opinion applies when the CHARACTER EVALUATING has a faith with that doctrine parameter active.

## Trait Flags and Restrictions

```
my_restricted_trait = {
    valid_sex = male              # all/male/female
    minimum_age = 16
    maximum_age = 65

    # Prevent title inheritance
    inheritance_blocker = all     # none/dynasty/all

    # Physical/incapacitating
    physical = yes
    incapacitating = yes          # Character needs a regent
    disables_combat_leadership = yes
    can_have_children = no        # Sterility

    # Encyclopedia/ruler designer visibility
    shown_in_encyclopedia = yes
    shown_in_ruler_designer = yes
    ruler_designer_cost = 50
}
```

`flag = <name>` — tags the trait with a named flag, checkable via triggers (e.g., `has_trait_flag = <name>`). Useful for grouping traits for scripted checks without requiring a full trait group.

## Culture and Faith Conditional Modifiers

```
my_cultural_trait = {
    # Modifiers that only apply if holder's culture has the parameter
    culture_modifier = {
        parameter = has_warrior_culture
        prowess = 2
        martial = 1
    }

    # Modifiers that only apply if holder's faith has the doctrine parameter
    faith_modifier = {
        parameter = tenet_warmonger
        monthly_piety = 0.5
    }
}
```

## Genetic Trait Advanced Options

```
my_genetic_trait = {
    genetic = yes
    inherit_chance = 25
    birth = 10                    # % chance at birth (no parent needed)

    # Which parent can pass it / which child can inherit
    parent_inheritance_sex = all  # male/female/all
    child_inheritance_sex = all   # male/female/all
    inherit_from_real_father = yes
    inherit_from_real_mother = yes
    both_parent_has_trait_inherit_chance = 50  # Higher if both parents have it

    # Random character generation
    random_creation = 5           # % chance on random char creation
    random_creation_weight = 2    # Weight multiplier

    # Portrait effects
    genetic_constraint_all = beauty     # Constrains gene morphing
    portrait_extremity_shift = 0.25     # Shifts morph genes toward extremes
}
```

## Trait Groups

```
my_trait = {
    group = my_trait_group          # Group for inheritance equivalence
    group_equivalence = alt_group   # Separate group for equivalence checks
    level = 2                       # Level within group (for tiered traits)
}
```

## Commander Trait Terrain Restriction

```
my_desert_commander = {
    category = commander
    # Only available if ruler's realm contains these terrains
    trait_exclusive_if_realm_contains = { desert drylands }
}
```

## Dynamic Names/Descriptions/Icons

```
my_dynamic_trait = {
    name = {
        first_valid = {
            triggered_desc = {
                trigger = { is_female = yes }
                desc = trait_my_dynamic_female
            }
            desc = trait_my_dynamic_male
        }
    }
    desc = {
        first_valid = {
            triggered_desc = {
                trigger = { has_trait_xp = { trait = my_dynamic_trait track = my_dynamic_trait value >= 50 } }
                desc = trait_my_dynamic_desc_high
            }
            desc = trait_my_dynamic_desc_default
        }
    }
    icon = {
        first_valid = {
            triggered_desc = {
                trigger = { is_female = yes }
                desc = my_dynamic_trait_female_icon    # maps to gfx path
            }
            desc = my_dynamic_trait_icon
        }
    }
}
```
The fallback `desc = X` MUST exist in each block. Without it, characters who don't match any trigger will have NO name/desc/icon.

## Checklist
- [ ] Trait file in `common/traits/` with `.txt` extension
- [ ] Localization: `trait_<key>` and `trait_<key>_desc`
- [ ] Icon at `gfx/interface/icons/traits/<key>.dds` (60x60 pixels)
- [ ] Category set (personality, education, health, etc.)
- [ ] Test: `effect add_trait = my_custom_trait` in console

## Common Pitfalls
- **Same-trait opinion**: Use `same_opinion = 10`, NOT `triggered_opinion`. `triggered_opinion` is for faith-based virtue/sin mechanics and requires a `parameter` referencing a doctrine. Without it, you get a broken `TRAIT_DESC_POSITIVE_FOR_THEM` tooltip
- **Trait name conflict**: If your trait key matches a vanilla trait, it will override it. Use a unique prefix
- **Missing icon**: The game will show a blank icon. Default path is `gfx/interface/icons/traits/<trait_key>.dds`
- **Localization keys**: Default is `trait_<key>`, not just `<key>`. This is different from decisions!
- **Opposite traits**: If you set `opposite = X`, a character can't have both traits simultaneously
- **Genetic traits**: Set `genetic = yes` for proper inheritance behavior. Without it, `inherit_chance` uses simpler logic
- **Dynamic names/icons**: If using `name = { first_valid = { ... } }`, include a fallback for `NOT = { exists = this }` to avoid errors when the trait is displayed without a character context
