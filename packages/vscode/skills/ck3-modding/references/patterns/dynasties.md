# Creating Dynasty Legacies, Perks, and Houses — Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
Dynasty content spans several folders:
- **Dynasty legacies** (`common/dynasty_legacies/`) — the legacy *tracks* (containers shown as rows in the UI).
- **Dynasty perks** (`common/dynasty_perks/`) — the individual unlockable perks within a legacy track. Costs dynasty prestige.
- **House mottos** (`common/dynasty_house_mottos/`) — procedurally assembled mottos from templates and inserts.
- **House motto inserts** (`common/dynasty_house_motto_inserts/`) — word groups mottos pull from.
- **House unity** (`common/house_unities/`) — staged unity system for clan governments (DLC-dependent).
- **House aspirations** (`common/house_aspirations/`) — admin-realm house powers with tiered levels (DLC-dependent).

Perks use the **dynast as root scope**. Modifiers from perks apply to every dynasty member.

## Minimal Template

### Legacy Track — common/dynasty_legacies/my_legacies.txt
```
my_custom_legacy_track = {
    # Optional: hide the track unless a condition is met (e.g., DLC check)
    # is_shown = { has_dlc_feature = some_feature }
}
```
The track is just a named container. Perks reference it by key.

### Dynasty Perks — common/dynasty_perks/my_dynasty_perks.txt
```
my_legacy_1 = {
    legacy = my_custom_legacy_track    # Which track this perk belongs to

    character_modifier = {
        martial = 2
        knight_effectiveness_mult = 0.15
    }

    ai_chance = {
        value = 11
        if = {
            limit = {
                can_start_new_legacy_track_trigger = no
            }
            multiply = 0
        }
    }
}

my_legacy_2 = {
    legacy = my_custom_legacy_track

    character_modifier = {
        prowess = 2
    }
}

my_legacy_3 = {
    legacy = my_custom_legacy_track

    character_modifier = {
        monthly_martial_lifestyle_xp_gain_mult = 0.1
    }

    # One-time effect on unlock (character scope)
    effect = {
        custom_description_no_bullet = {
            text = my_legacy_3_effect    # loc key describing what happens
        }
    }
}
```

Perks are unlocked **in order of definition** within the file. The first perk in a track is the cheapest; each subsequent perk costs more. You do NOT set the cost — it is automatic based on position.

### Localization — localization/english/my_dynasty_l_english.yml
```
l_english:
 my_custom_legacy_track_name: "Legacy of Steel"
 my_legacy_1_name: "Forged in Battle"
 my_legacy_2_name: "Iron Discipline"
 my_legacy_3_name: "Tempered Veterans"
 my_legacy_3_effect: "Unlocks special military advisor interaction"
```
Generated loc keys:
- Legacy track: `<legacy_track_key>_name`
- Perk: `<perk_key>_name`
- Named modifier (if using `name = X` inside `character_modifier`): the `name` value itself is the loc key

## Common Variants

### Perk with doctrine-conditional modifier
Applies different bonuses depending on the dynasty member's faith doctrines.
```
my_faith_perk = {
    legacy = my_custom_legacy_track

    character_modifier = {
        monthly_piety_gain_mult = 0.1
    }

    doctrine_character_modifier = {
        name = my_faith_perk_modifier     # Shared loc key for tooltip grouping
        doctrine = doctrine_theocracy_lay_clergy
        zealot_opinion = 5
    }
    doctrine_character_modifier = {
        name = my_faith_perk_modifier
        doctrine = doctrine_theocracy_temporal
        clergy_opinion = 5
    }
}
```

### Perk with selectable traits (Architected Ancestry pattern)
When unlocked, the player picks a trait. Stored as `var:<perk_key>_<trait_key>` on the dynasty.
```
my_bloodline_perk = {
    legacy = my_custom_legacy_track

    effect = {
        custom_description_no_bullet = {
            text = my_bloodline_perk_effect
        }
    }

    traits = {
        beauty_good_1 = 100      # trait_key = AI_weight
        intellect_good_1 = 100
        physique_good_1 = 100
        fecund = 50
        giant = 10
    }
}
```

### Perk with named modifier
Use `name` inside `character_modifier` when you want a custom tooltip name instead of listing raw modifiers.
```
my_named_perk = {
    legacy = my_custom_legacy_track

    character_modifier = {
        name = my_named_perk_modifier    # Loc key for the modifier tooltip
        domain_limit = 1
        controlled_province_advantage = 5
    }
}
```

### DLC-gated legacy track
```
my_dlc_legacy_track = {
    is_shown = { has_dlc_feature = hybridize_culture }
}
```

### Perk with can_be_picked trigger
Restrict who can unlock the perk (character scope, evaluated on the dynast).
```
my_restricted_perk = {
    legacy = my_custom_legacy_track

    can_be_picked = {
        has_realm_size >= 20
    }

    character_modifier = {
        monthly_prestige = 1
    }
}
```

## House Mottos

House mottos are procedural: a **motto template** pulls words from **insert groups**.

### Motto template — common/dynasty_house_mottos/my_mottos.txt
```
my_motto_template = {
    insert = noun_immaterial       # Fills $1$ in the loc string
    insert = noun_immaterial       # Fills $2$ in the loc string

    weight = {
        value = 1000
    }

    # Optional: restrict to specific founders
    trigger = {
        culture = { has_cultural_pillar = heritage_north_germanic }
    }
}
```

### Motto insert group — common/dynasty_house_motto_inserts/my_inserts.txt
```
my_insert_group = {
    glory = {
        weight = { value = 1000 }
    }
    honor = {
        trigger = {
            faith = { has_doctrine = tenet_communal_identity }
        }
        weight = { value = 500 }
    }
}
```

### Motto localization
The motto template key is a loc key. Insert values become `$1$`, `$2$`, etc.:
```
l_english:
 my_motto_template: "By $1$ and $2$"
 glory: "Glory"
 honor: "Honor"
```

To set a specific motto for a dynasty/house in history files, add `motto = loc_key` inside the dynasty or house definition.

## House Unity (Clan Government)

House unity defines staged bonuses for clan-government houses. Stages are defined in order from lowest to highest.

### common/house_unities/my_house_unities.txt
```
my_house_unity = {
    default_value = 100
    min_value = 0

    stage_low = {
        points = 40                 # Points this stage spans

        parameters = {
            my_custom_parameter = yes
        }

        modifiers = {
            ai_war_chance = 5
        }

        decisions = {
            my_unity_decision_1
        }

        on_start = { }              # Effect when entering this stage (root = house_unity)
        on_end = { }                # Effect when leaving this stage
    }

    stage_mid = {
        points = 40

        modifiers = {
            monthly_lifestyle_xp_gain_mult = 0.05
        }
    }

    stage_high = {
        points = 20

        modifiers = {
            dynasty_opinion = 10
        }
    }
}
```

## House Aspirations (Administrative Government)

House aspirations give tiered bonuses in admin realms. Each aspiration has multiple upgrade levels.

### common/house_aspirations/my_aspirations.txt
```
my_aspiration = {
    show_in_main_hud = no
    is_default = no

    is_shown = {
        # root: dynasty house
        has_government = administrative_government
    }

    level = {
        cost = { prestige = 500 }

        any_house_member_modifier = {
            martial = 1
        }

        house_head_modifier = {
            knight_effectiveness_mult = 0.1
        }

        ai_score = { value = 10 }
    }

    level = {
        cost = { prestige = 1000 }

        any_house_member_modifier = {
            martial = 2
        }

        powerful_family_top_liege_modifier = {
            levy_size = 0.05
        }

        house_head_modifier = {
            knight_effectiveness_mult = 0.2
        }

        can_upgrade = {
            has_realm_size >= 10
        }

        ai_score = { value = 20 }
    }

    illustration = "gfx/interface/illustrations/my_aspiration.dds"

    cooldown = { years = 5 }

    on_changed = { }
    on_upgraded = { }
}
```

## AI Preference

AI picks perks using `ai_chance` (script value, defaults to 1000 if omitted). The standard vanilla pattern for the **first perk** in a track gates starting new tracks:
```
ai_chance = {
    value = 11
    if = {
        limit = {
            can_start_new_legacy_track_trigger = no
        }
        multiply = 0    # Don't start this track if can't afford to
    }
}
```
Only the first perk in each track needs this — subsequent perks are auto-selected once the track is started.

For house aspirations, each `level` has an `ai_score` block. AI uses this to decide whether to pick/upgrade the aspiration.

## Checklist
- [ ] Legacy track file in `common/dynasty_legacies/` (`.txt`)
- [ ] Perk file in `common/dynasty_perks/` (`.txt`)
- [ ] Each perk has `legacy = <track_key>` pointing to the correct track
- [ ] Perks in the file are ordered from first (cheapest) to last (most expensive)
- [ ] Localization: `<track_key>_name` for the legacy track
- [ ] Localization: `<perk_key>_name` for each perk
- [ ] Localization for any `custom_description_no_bullet` text keys
- [ ] Localization for any named modifiers (`name = X` inside `character_modifier`)
- [ ] First perk in each track has `ai_chance` with the `can_start_new_legacy_track_trigger` guard
- [ ] If using `doctrine_character_modifier`, verify doctrine keys exist
- [ ] If using `traits = { }` block, at least one trait has non-zero AI weight
- [ ] If adding mottos: loc key for the motto template with `$1$`/`$2$` placeholders
- [ ] If adding house unity: stages sum to a sensible total and are ordered low-to-high
- [ ] Test: open dynasty view in-game, verify track appears and perks can be unlocked

## Common Pitfalls
- **Perk order matters**: Perks are unlocked sequentially in definition order. You cannot skip perks in a track. Put the weakest/cheapest perk first.
- **Missing legacy reference**: If a perk's `legacy = X` points to a nonexistent track key, the perk silently disappears from the UI.
- **Forgetting `_name` suffix**: Legacy track loc uses `<key>_name`, not just `<key>`. Same for perks.
- **Named modifier without loc**: If you use `name = my_modifier_name` in `character_modifier`, that string is a loc key. Missing it shows raw key text in tooltips.
- **`ai_chance` defaults to 1000**: Without explicit `ai_chance`, AI heavily favors the perk. Always set `ai_chance` on the first perk of a track with the `can_start_new_legacy_track_trigger` guard.
- **`effect` runs once on unlock**: The `effect` block fires when the perk is purchased, not continuously. For ongoing effects, use `character_modifier`. For effects that need to fire on events (like births), implement them in on_actions and check `dynasty.dynast has perk`.
- **`doctrine_character_modifier` scope**: These modifiers only apply to dynasty members whose faith has the specified doctrine. If the doctrine key is wrong, the modifier silently does nothing.
- **Trait selection variable**: When using the `traits = { }` block, the selected trait is stored as `var:<perk_key>_<trait_key>` on the dynasty — you must check this variable in on_actions yourself.
- **House unity is government-specific**: House unity definitions are tied to a government type (e.g., clan). They will not appear for feudal/tribal characters.
- **Motto insert scope**: Motto triggers and weights run in the **house founder's** character scope, not the current house head.
