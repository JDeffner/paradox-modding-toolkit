# Creating Factions -- Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
Factions are organized groups of vassals (or counties) working against a liege. When a faction's military power crosses a threshold, it sends an ultimatum; if the liege refuses, war begins using a specified casus belli.

There are two broad categories:
- **Character-based factions** -- vassals band together (independence, liberty, claimant). Members are characters.
- **County-based factions** -- counties revolt on their own (populist, peasant). Members are landed titles. A rebel leader may be spawned.

Files go in `common/factions/`. The faction key doubles as the base localization key.

Key scopes available inside faction blocks:
- `root` = the faction itself (in most blocks)
- `faction_target` = the liege being targeted
- `faction_leader` = the character leading the faction
- `special_character` = e.g. the claimant in a claimant faction
- `special_title` = e.g. the title being claimed
- `scope:target` = the target character (in `can_character_create` and `county_create_score`)
- `scope:faction` = the faction (in `ai_join_score`, `can_character_join`, `county_join_score`)

## Minimal Template

### common/factions/my_factions.txt
```
my_custom_faction = {
    casus_belli = my_custom_faction_war    # Must exist in common/casus_belli_types/

    sort_order = 5

    short_effect_desc = my_custom_faction_short_effect_desc

    # --- Power threshold (% of liege military strength needed to send ultimatum) ---
    power_threshold = {
        base = 80
        modifier = {
            add = 20
            faction_target = {
                has_perk = hard_rule_perk
            }
            desc = "FACTION_POWER_HARD_RULE"
        }
    }

    # --- Discontent progress (ticks up once power > threshold) ---
    discontent_progress = {
        base = 0
        common_discontent_progress_modifier = yes
    }

    # --- What happens when the faction sends its demand ---
    demand = {
        save_scope_as = faction
        faction_leader = { save_scope_as = faction_leader }
        faction_target = { save_scope_as = faction_target }

        # Notify human faction members
        every_faction_member = {
            limit = {
                is_ai = no
                this != scope:faction.faction_leader
            }
            trigger_event = my_faction_demand.0005
        }

        # Send demand event to liege (5 day delay for notifications)
        faction_target = {
            trigger_event = {
                id = my_faction_demand.0001
                days = 5
            }
        }
    }

    # --- Validity: is the faction still valid? ---
    is_character_valid = {
        common_character_validity_trigger = {
            FACTION_TARGET = scope:faction.faction_target
        }
    }

    # --- Who can create this faction? ---
    can_character_create = {
        common_can_character_create_trigger = {
            FACTION_TARGET = scope:target
        }
    }

    # --- Who can join this faction? ---
    can_character_join = {
        common_can_character_join_trigger = {
            FACTION_TARGET = scope:faction.faction_target
        }
    }

    # --- AI willingness to create ---
    ai_create_score = {
        base = -150

        common_create_faction_blockers = {
            FACTION_TARGET = scope:target
            FLAG = recent_my_custom_faction_war
        }

        common_faction_modifiers = {
            FACTION_TARGET = scope:target
            OPINION_MULTIPLIER = -0.4
            MAX_OPINION = 100
            POWER = 0
            THRESHOLD = 80
        }
    }

    # --- AI willingness to join ---
    ai_join_score = {
        base = -150

        common_join_faction_blockers = {
            FACTION_TARGET = scope:faction.faction_target
        }

        common_faction_modifiers = {
            FACTION_TARGET = scope:faction.faction_target
            OPINION_MULTIPLIER = -0.4
            MAX_OPINION = 100
            POWER = scope:faction.faction_power
            THRESHOLD = scope:faction.faction_power_threshold
        }
    }

    # --- AI chance to press demands once power is sufficient ---
    ai_demand_chance = {
        base = 0

        compare_modifier = {
            value = faction_power
            multiplier = 0.5
        }

        # More aggressive when clearly stronger
        compare_modifier = {
            trigger = { faction_power > 110 }
            value = faction_power
            multiplier = 1
        }
    }

    # --- No county members for character-based factions ---
    county_allow_join = no
    county_allow_create = no
}
```

### localization/english/my_factions_l_english.yml
```
l_english:
 my_custom_faction: "Custom Faction"
 my_custom_faction_desc: "Vassals organize to [describe goal]."
 my_custom_faction_short_effect_desc: "If successful, [describe outcome]."
 my_custom_faction_war: "Custom Faction War"
 my_custom_faction_war_desc: "War to [describe purpose]."
```

### common/casus_belli_types/my_faction_cb.txt
Each faction needs a casus belli. See the `casus-belli.md` pattern for full CB structure. At minimum:
```
my_custom_faction_war = {
    group = faction

    allowed_for_character = { ... }
    allowed_against_character = { ... }

    on_victory = { ... }
    on_white_peace = { ... }
    on_defeat = { ... }

    war_score_from_battles = 1
    max_defender_score_from_battles = 100
    max_attacker_score_from_battles = 100
}
```

## Common Variants

### Claimant Faction (character + title based)
The claimant faction requires both a special character (the claimant) and a special title.
```
my_claimant_faction = {
    casus_belli = claimant_faction_war

    claimant = yes                     # Marks this as a claimant-type faction
    show_special_title = yes           # Show the claimed title in UI
    character_interaction = create_claimant_faction_against_interaction  # Opens interaction instead of direct create

    name = FACTION_CLAMAINT_DYNAMIC_NAME   # Dynamic name using special_character/title

    # is_valid must check claimant is alive and title is held by target
    is_valid = {
        trigger_if = {
            limit = {
                OR = {
                    exists = special_character
                    exists = faction_war
                }
            }
            special_title.holder ?= faction_target
            OR = {
                special_character ?= {
                    is_alive = yes
                    NOR = {
                        has_trait = incapable
                        this = root.faction_target
                    }
                }
                exists = faction_war
            }
        }
    }

    # demand effect saves special_character and special_title as scopes
    demand = {
        save_scope_as = faction
        faction_leader = { save_scope_as = faction_leader }
        faction_target = { save_scope_as = faction_target }
        special_character = { save_scope_as = faction_claimant }
        special_title = { save_scope_as = faction_targeted_title }

        faction_target = {
            trigger_event = {
                id = faction_demand.2001
                days = 5
            }
        }
    }

    multiple_targeting = yes           # Multiple claimant factions can target same liege

    county_allow_join = no
    county_allow_create = no
}
```

### County-Based Faction (populist/peasant revolts)
Counties revolt based on culture/faith differences with the liege. No character members needed.
```
my_populist_faction = {
    casus_belli = populist_war

    leaders_allowed_to_leave = no
    player_can_join = no               # Populist factions are AI-only

    requires_county = yes              # Needs at least one county member
    requires_character = no            # Does not need character members

    name = FACTION_POPULIST_DYNAMIC_NAME

    # County validity -- typically requires different culture/faith from liege
    is_county_valid = {
        scope:faction.faction_target = holder.top_liege
        OR = {
            faith != scope:faction.faction_target.faith
            culture != scope:faction.faction_target.culture
        }
    }

    # Counties can create if opinion is bad and culture/faith differs
    can_county_create = {
        county_opinion < 0
        scope:target = holder.top_liege
        OR = {
            faith != scope:target.faith
            culture != scope:target.culture
        }
    }

    can_county_join = {
        # Must share this faction's faith
        scope:faction = {
            OR = {
                NOT = { has_variable = faction_faith }
                AND = {
                    has_variable = faction_faith
                    root.faith = var:faction_faith
                }
            }
        }
    }

    # County power = military strength contribution per county
    county_power = my_county_power_value   # Script value

    # County create/join scoring uses county_opinion
    county_create_score = {
        base = -160
        compare_modifier = {
            value = county_opinion
            multiplier = -3.0
        }
    }

    county_join_score = {
        base = -120
        compare_modifier = {
            value = county_opinion
            multiplier = -1.0
        }
    }

    # Track faction identity on creation
    on_creation = {
        random_faction_county_member = {
            save_scope_as = founding_county
        }
        set_variable = {
            name = faction_culture
            value = scope:founding_county.culture
        }
        set_variable = {
            name = faction_faith
            value = scope:founding_county.faith
        }
    }

    on_destroy = {
        # Clean up spawned leaders, variables, etc.
    }

    # on_war_start can spawn rebel armies
    on_war_start = {
        # Spawn peasant levies, set up rebel leader, etc.
    }

    # Rebel leader management
    can_character_become_leader = {
        has_variable = rebel_leader_peasants
        var:rebel_leader_peasants = scope:faction
    }

    leader_leaves = {
        # Handle leader dying/leaving mid-revolt
    }

    county_can_switch_to_other_faction = yes   # Counties move to a better faction if available
}
```

### Liberty Faction (reduce crown authority)
```
my_liberty_faction = {
    casus_belli = liberty_faction_war

    sort_order = 4

    can_character_create = {
        common_can_character_create_trigger = {
            FACTION_TARGET = scope:target
        }
        # Must have laws that can be reduced
        has_valid_realm_laws_for_liberty_faction_trigger = {
            TARGET = scope:target
        }
    }

    # on_war_start can spawn bonus armies for members who "gathered support"
    on_war_start = {
        every_faction_member = {
            limit = {
                has_variable = gathered_support_for_faction
                var:gathered_support_for_faction = root
            }
            spawn_army = {
                name = gathered_support_for_faction_army
                levies = { value = this.massive_influence_value multiply = 3 }
                location = this.location
                war = root.faction_war
                inheritable = yes
            }
        }
    }

    county_allow_join = no
    county_allow_create = no
}
```

## Checklist

### Files to create/modify
- [ ] `common/factions/XX_my_factions.txt` -- faction definition
- [ ] `common/casus_belli_types/XX_my_faction_cb.txt` -- casus belli for the faction war
- [ ] `events/my_faction_demand_events.txt` -- demand events (liege receives ultimatum, chooses accept/refuse)
- [ ] `localization/english/my_factions_l_english.yml` -- faction name, desc, short_effect_desc, CB name

### Required fields
- [ ] `casus_belli` -- every faction must declare its war type
- [ ] `power_threshold` -- when the faction can send demands (default 80)
- [ ] `demand` -- effect that fires the ultimatum event chain
- [ ] `ai_demand_chance` -- AI willingness to press demands
- [ ] At least one of: `ai_create_score`/`ai_join_score` (character factions) or `county_create_score`/`county_join_score` (county factions)
- [ ] `is_character_valid` or `is_county_valid` -- ongoing membership validity

### Recommended fields
- [ ] `discontent_progress` -- how fast discontent grows (drives the ultimatum)
- [ ] `can_character_create` / `can_character_join` -- eligibility triggers
- [ ] `can_character_create_ui` -- separate trigger for the UI button (falls back to `can_character_create` if absent)
- [ ] `sort_order` -- controls UI list ordering (lower = higher)
- [ ] `on_creation` / `on_destroy` -- setup and cleanup effects
- [ ] `on_war_start` -- effects when war begins (spawn armies, set variables)

### Common helper scripted triggers (vanilla)
- `common_create_faction_blockers` -- blocks faction creation during truces, etc.
- `common_join_faction_blockers` -- blocks joining during truces, etc.
- `common_faction_modifiers` -- standard opinion/power/threshold AI weight formula
- `common_can_character_create_trigger` -- standard eligibility checks
- `common_can_character_join_trigger` -- standard join eligibility
- `common_character_validity_trigger` -- standard ongoing validity
- `common_discontent_progress_modifier` -- standard discontent formula
- `dynamic_power_threshold_scripted_modifier` -- lowers threshold when other faction types are also active

### Localization keys
- [ ] `my_faction` -- faction name
- [ ] `my_faction_desc` -- faction description (shown in tooltip)
- [ ] `my_faction_short_effect_desc` -- one-line effect summary
- [ ] Dynamic names use `name = LOC_KEY` which can include `first_valid` / `triggered_desc` blocks

## Event Targets (Faction Scope)

| Target | Description |
|---|---|
| `faction_target` | The character being targeted (liege) |
| `faction_leader` | The character leading the faction |
| `faction_war` | The war, if faction is at war |
| `special_character` | Claimant or rebel leader |
| `special_title` | Title being claimed |

From character scope:
| Target | Description |
|---|---|
| `leading_faction` | Faction this character leads (null if none) |
| `joined_faction` | Faction this character belongs to (null if none) |

Lists: `targeting_faction` (factions targeting a character), `faction_member` (character members), `faction_county_member` (county members).

## Loc/UI Functions

| Function | Description |
|---|---|
| `[Faction.GetName]` | Faction type name |
| `[Faction.GetDescription]` | Faction description |
| `[Faction.GetDiscontent]` | Current discontent value |
| `[Faction.IsAtWar]` | Whether faction is at war |
| `[Faction.GetPower]` | Current military power % |
| `[Faction.GetTarget]` | Target character |
| `[Faction.GetLeader]` | Faction leader |
| `[Faction.GetSpecialCharacter]` | Claimant/rebel leader |
| `[Faction.GetSpecialTitle]` | Claimed title |

## Common Pitfalls

1. **Forgetting the casus belli.** Every faction needs a matching CB in `common/casus_belli_types/`. Without it the faction can never declare war and will just sit there indefinitely after sending demands.

2. **Confusing `on_declaration` vs `on_war_start`.** The info file documents `on_declaration` but vanilla factions use `on_war_start` for spawning armies and setting up war effects. Use `on_war_start` for war-time setup (spawning armies, etc.) and `demand` for the ultimatum event chain.

3. **Not disabling county membership on character factions.** Character-based factions (independence, liberty, claimant) must set `county_allow_join = no` and `county_allow_create = no` or counties will try to join them.

4. **Negative base scores are intentional.** The `ai_create_score` and `ai_join_score` use large negative base values (e.g., -150) that must be overcome by modifiers. This prevents AI from frivolously creating factions. Do not set base to 0 or positive -- factions will form constantly.

5. **Power threshold misunderstanding.** The `power_threshold` is a percentage of the liege's military strength. Default is 80 (meaning the faction needs 80% of the liege's army strength). The `hard_rule_perk` adds +20, making it 100%. Setting it too low causes constant ultimatums.

6. **County factions need `requires_county = yes` and `requires_character = no`.** Without these, county-based factions will be destroyed when they have no character members (which is always, since counties join, not characters).

7. **Populist factions track faith/culture via variables.** The `on_creation` block must set `faction_faith` and `faction_culture` variables from the founding county. The `can_county_join` trigger then checks incoming counties match this faith. Without this, mixed-faith counties join the same revolt.

8. **`can_character_create_ui` vs `can_character_create`.** The `_ui` variant controls the button visibility/enable state in the faction window. If omitted, it falls back to `can_character_create`. Use the `_ui` version for player-facing tooltip text and the non-UI version for the actual AI/logic check.

9. **Missing `is_valid` on claimant factions.** Claimant factions must verify the claimant is alive, not incapable, and the target still holds the claimed title. If `is_valid` is missing or wrong, the faction persists with a dead/invalid claimant.

10. **`multiple_targeting` defaults to no.** Only claimant factions typically set `multiple_targeting = yes` so multiple claimant factions can target the same liege for different titles. Independence and liberty factions are unique per liege by default.

11. **Demand events need a 5-day delay.** Vanilla uses `days = 5` when triggering the demand event on the faction target. This gives time for the notification event to reach human faction members first. Skipping the delay means players in the faction see the result before the notification.

12. **`leader_leaves` is not the same as `character_leaves`.** Use `leader_leaves` for special cleanup when the faction leader specifically leaves (important for populist factions with spawned rebel leaders). Use `character_leaves` for any member departing.
