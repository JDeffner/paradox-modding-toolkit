# Creating Schemes -- Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
Schemes are long-running actions a character performs against a target (usually another character). They have progress phases, success/failure outcomes, optional agents, and secrecy mechanics. Defined in `common/schemes/scheme_types/`. Two major categories exist: **hostile** schemes (murder, abduct) use agents, secrecy, and resistance; **personal/basic** schemes (seduce, befriend, sway) are simpler, typically agentless, with milestone events instead of pulse actions.

Key concepts:
- **Progress** goes from 0 to `base_progress_goal`. Each month, progress has a chance to advance based on speed minus resistance.
- **Success chance** starts at `base_success_chance` and grows each completed phase by `success_chance_growth_per_skill_point` per owner skill point.
- **Secrecy** (hostile schemes): if the scheme is discovered, it can be exposed. `base_secrecy` controls the monthly expose check.
- **Agents** (hostile schemes): other characters who join and boost success chance via `agent_success_chance`.
- **Phases**: when progress reaches the goal, `on_phase_completed` fires. For agent-based schemes, this loops (success chance grows each phase). For basic schemes (`is_basic = yes`), this is typically the final outcome.

> Reference: `common/schemes/scheme_types/_schemes.info`

## Minimal Template

### Hostile Scheme (agent-based, like murder)

#### common/schemes/scheme_types/my_hostile_scheme.txt
```
my_hostile_scheme = {
    # --- Identity ---
    skill = intrigue                    # Skill that drives speed/success growth
    desc = my_hostile_scheme_desc       # Loc key for description
    success_desc = "MY_HOSTILE_SCHEME_SUCCESS_DESC"
    discovery_desc = "MY_HOSTILE_SCHEME_DISCOVERY_DESC"
    icon = icon_scheme_murder           # Reuse vanilla or provide custom
    illustration = "gfx/interface/illustrations/event_scenes/corridor.dds"
    category = hostile                  # hostile / personal / contract
    target_type = character             # character / title / culture / faith / nothing
    is_secret = yes

    # --- Progression ---
    speed_per_skill_point = 1           # Owner skill -> scheme speed
    speed_per_target_skill_point = 0    # Target skill -> scheme speed (usually negative effect via resistance)
    base_progress_goal = 20             # Progress needed per phase (lower = faster)
    success_chance_growth_per_skill_point = 0.5  # Success growth per skill per completed phase
    base_maximum_success = 85           # Cap on success chance
    maximum_secrecy = 95
    maximum_breaches = 5                # Secrecy breaches before forced end

    # --- Cooldown ---
    cooldown = { years = 5 }            # Time before same scheme type on same target

    # --- Who can start it ---
    allow = {
        is_adult = yes
        is_imprisoned = no
        scope:target = {
            is_adult = yes
        }
    }

    # --- Ongoing validity (checked daily, scheme ends if false) ---
    valid = {
        is_incapable = no
        scope:target = {
            OR = {
                exists = location
                in_diplomatic_range = scope:owner
            }
        }
    }

    # --- Agents ---
    agent_leave_threshold = -25
    agent_join_chance = {
        base = 0
        modifier = {
            add = 20
            desc = "MY_SCHEME_AGENT_REASON"
            scope:target = {
                is_rival_of = root    # root = the potential agent
            }
        }
    }
    agent_groups_owner_perspective = { courtiers }
    agent_groups_target_character_perspective = { courtiers vassals }
    valid_agent = {
        is_adult = yes
        NOT = { this = scope:target }
    }

    # --- Success Chance ---
    base_success_chance = {
        base = 0
        # Skill contribution (use scripted modifier or manual)
        modifier = {
            add = intrigue
            desc = "SCHEME_INTRIGUE_BONUS"
        }
        # Example: trait bonus
        modifier = {
            add = 15
            desc = "MY_SCHEME_TRAIT_BONUS"
            scope:owner = { has_trait = schemer }
        }
    }

    base_secrecy = {
        add = -20           # Negative = harder to stay secret
    }

    # --- On Actions ---
    on_phase_completed = {
        scheme_owner = {
            trigger_event = my_scheme_outcome.0001
        }
    }

    on_monthly = {
        # Discovery check for hostile schemes
        hostile_scheme_monthly_discovery_chance_effect = yes
        scheme_owner = {
            trigger_event = {
                on_action = my_scheme_ongoing
            }
        }
    }

    on_invalidated = {
        scheme_target_character = { save_scope_as = target }
        scheme_owner = { save_scope_as = owner }
        # Handle target death, out-of-range, etc.
    }

    # --- Pulse Actions (optional random events during scheme) ---
    pulse_actions = {
        entries = { my_scheme_pulse.0001 my_scheme_pulse.0002 }
        chance_of_no_event = 50    # 50% chance nothing fires
    }
}
```

### Personal/Basic Scheme (no agents, like befriend/sway)

#### common/schemes/scheme_types/my_personal_scheme.txt
```
my_personal_scheme = {
    skill = diplomacy
    desc = my_personal_scheme_desc
    success_desc = "MY_PERSONAL_SCHEME_SUCCESS_DESC"
    icon = icon_scheme_sway
    illustration = "gfx/interface/illustrations/event_scenes/corridor.dds"
    category = personal
    target_type = character
    is_secret = no
    is_basic = yes              # No agents, no success growth per phase, no pulse actions
    uses_resistance = no        # Target modifiers/skill/spymaster don't affect speed

    # --- Progression ---
    speed_per_skill_point = -2.5          # Negative = higher skill means SHORTER phase
    spymaster_speed_per_skill_point = 0   # No spymaster involvement
    base_progress_goal = 365              # ~1 year base phase
    base_maximum_success = 95
    minimum_success = 5

    # --- Cooldown ---
    cooldown = { years = 10 }

    # --- Triggers ---
    allow = {
        is_adult = yes
        is_imprisoned = no
        scope:target = {
            is_adult = yes
            is_imprisoned = no
        }
    }
    valid = {
        is_incapable = no
        scope:target = {
            OR = {
                exists = location
                in_diplomatic_range = scope:owner
            }
        }
    }

    # --- Success Chance ---
    base_success_chance = {
        base = 0
        # Skill-based modifier
        modifier = {
            add = diplomacy
            desc = "SCHEME_DIPLOMACY_BONUS"
        }
        # Opinion of owner by target
        opinion_modifier = {
            who = scope:target
            opinion_target = scope:owner
            min = -50
            max = 50
            multiplier = 1.0
            step = 5
        }
        # Trait compatibility
        compatibility_modifier = {
            who = scope:target
            compatibility_target = scope:owner
            min = -30
            max = 30
            multiplier = 2
        }
    }

    # --- On Actions ---
    on_phase_completed = {
        scheme_owner = {
            trigger_event = my_personal_outcome.0001
        }
    }

    on_monthly = {
        save_scope_as = scheme
        scheme_owner = { save_scope_as = owner }
        scheme_target_character = { save_scope_as = target }
        # Fire milestone events at progress thresholds
        if = {
            limit = {
                scheme_progress < scheme_progress_50
                NOT = { has_scheme_modifier = my_milestone_1_modifier }
            }
            scheme_owner = {
                trigger_event = { on_action = my_scheme_milestone_1 }
            }
        }
    }

    on_invalidated = {
        scheme_target_character = { save_scope_as = target }
        scheme_owner = { save_scope_as = owner }
        if = {
            limit = { scope:target = { is_alive = no } }
            scope:owner = {
                trigger_event = my_personal_outcome.0010
            }
        }
    }
}
```

### Localization (localization/english/my_scheme_l_english.yml)
```
l_english:
 my_hostile_scheme: "Hostile Scheme"
 my_hostile_scheme_action: "Plot Against"
 my_hostile_scheme_desc: "You are plotting against [TARGET_CHARACTER.GetName]."
 MY_HOSTILE_SCHEME_SUCCESS_DESC: "The scheme succeeded!"
 MY_HOSTILE_SCHEME_DISCOVERY_DESC: "Your scheme was discovered."
 MY_SCHEME_AGENT_REASON: "Rival of the target"
 MY_SCHEME_TRAIT_BONUS: "Schemer trait"
 MY_SCHEME_INTRIGUE_BONUS: "Intrigue skill"

 my_personal_scheme: "Personal Scheme"
 my_personal_scheme_action: "Reach Out To"
 my_personal_scheme_desc: "You are reaching out to [TARGET_CHARACTER.GetName]."
 MY_PERSONAL_SCHEME_SUCCESS_DESC: "Your efforts paid off!"
 SCHEME_DIPLOMACY_BONUS: "Diplomacy skill"
```

## Common Variants

### Non-Secret Hostile Scheme
Some hostile schemes don't use secrecy (everyone knows you're doing it):
```
my_open_hostile_scheme = {
    skill = martial
    category = hostile
    target_type = character
    is_secret = no          # No secrecy mechanics at all
    # ...
}
```

### Title-Targeting Scheme
```
my_title_scheme = {
    skill = diplomacy
    category = personal
    target_type = title
    # scope:target is the title, scope:target_title also available
    allow = {
        scope:target = {
            tier >= tier_county
        }
    }
    # ...
}
```

### Scheme with Travel Restrictions
```
my_local_scheme = {
    # ...
    freeze_scheme_when_traveling = yes               # Pauses when owner travels
    freeze_scheme_when_traveling_target = yes         # Pauses when target travels
    cancel_scheme_when_traveling = no                 # Use cancel instead of freeze if needed
    cancel_scheme_when_traveling_target = no
}
```

### Scheme with use_secrecy (Conditional Secrecy)
Seduce uses this: secret only when the relationship would be scandalous.
```
my_conditional_secret_scheme = {
    is_secret = yes
    use_secrecy = {
        # Return false to force secrecy to 100% (effectively not secret)
        # Return true to use normal secrecy mechanics
        scope:target = {
            is_spouse_of = scope:owner  # Only secret if targeting someone else's spouse
        }
    }
}
```

### Scheme with on_start (Setup Logic)
```
my_scheme = {
    on_start = {
        # Runs once when scheme begins
        # Good for: adding agent slots, setting variables, firing intro events
        add_agent_slot = agent_assassin
        add_agent_slot = agent_infiltrator
    }
}
```

### AI Behavior
Schemes don't have an `ai_will_do` block themselves. AI scheme usage is controlled by:
1. **Character interactions** -- the interaction that starts the scheme has `ai_will_do`
2. **`agent_join_chance`** -- controls whether AI characters join as agents
3. **`on_semiyearly`** -- used for AI agent management
4. **`allow` triggers** -- AI-specific conditions can be added with `trigger_if = { limit = { is_ai = yes } ... }`

```
# In the scheme definition, restrict AI behavior via allow:
allow = {
    trigger_if = {
        limit = { is_ai = yes }
        # AI-only restrictions
        scope:target = {
            NOT = {
                any_targeting_scheme = {
                    scheme_type = my_scheme
                }
            }
        }
    }
}

# AI agent management in on_semiyearly:
on_semiyearly = {
    if = {
        limit = { scheme_owner = { is_ai = yes } }
        # AI assigns agents, prunes slots, etc.
    }
}
```

## Event Scopes Available in Scheme Context
- `scope:scheme` -- the scheme itself
- `scope:owner` / `scheme_owner` -- character running the scheme
- `scope:target` / `scheme_target_character` -- the target character (if target_type = character)
- `scope:target_title` / `scheme_target_title` -- the target title (if target_type = title)
- `scope:agent` -- the specific agent (in agent-related effects like `on_agent_exposed`)
- `root` -- in `agent_join_chance`, root is the potential agent being evaluated

## Relevant Modifiers (applied to characters)
- `max_<scheme_name>_schemes_add` -- how many of this scheme type a character can run
- `max_hostile_schemes_add` / `max_personal_schemes_add` -- category-wide caps
- `<scheme_name>_speed_add` / `<scheme_name>_speed_mult` -- speed bonuses
- `<scheme_name>_resistance_add` / `<scheme_name>_resistance_mult` -- resistance bonuses
- `hostile_scheme_phase_duration_add` / `personal_scheme_phase_duration_add` -- phase duration modifiers
- `owned_hostile_scheme_success_chance_add` / `enemy_hostile_scheme_success_chance_add` -- success chance
- `enemy_scheme_secrecy_add` -- reduces secrecy of schemes targeting you (use negative values)

## Relevant Loc Functions
- `[SCHEME.GetName]` -- scheme type name
- `[SCHEME.GetAction]` -- action verb (e.g., "Murder")
- `[SCHEME.GetFullActionName]` -- action + target (e.g., "Murder Duke William")
- `[SCHEME.GetOwner]` -- scheme owner
- `[SCHEME.GetTarget]` -- scheme target
- `[SCHEME.GetSecrecy]` -- secrecy as number
- `[SCHEME.GetSpeed]` / `[SCHEME.GetResistance]` / `[SCHEME.GetSpeedDifference]`
- `[SCHEME.GetProgress]` -- current progress
- `[SCHEME.IsSecret]` / `[SCHEME.IsFrozen]` / `[SCHEME.IsOwnerExposed]`

## Checklist
- [ ] Scheme file in `common/schemes/scheme_types/` with `.txt` extension
- [ ] `skill` set (intrigue, diplomacy, martial, stewardship, learning, prowess)
- [ ] `category` set (hostile, personal, or contract)
- [ ] `target_type` set (character, title, culture, faith, or nothing)
- [ ] `allow` block -- who can start the scheme
- [ ] `valid` block -- ongoing validity (checked daily)
- [ ] `base_success_chance` block with at least a base value
- [ ] `on_phase_completed` -- what happens when a phase ends
- [ ] `cooldown` set to prevent spam
- [ ] If hostile: `agent_join_chance`, `agent_groups_*`, `base_secrecy`, `on_monthly` with discovery check
- [ ] If basic: `is_basic = yes`, milestone events in `on_monthly`
- [ ] Localization: `<scheme_key>`, `<scheme_key>_action`, `<scheme_key>_desc`, plus all `desc` strings used in modifiers
- [ ] Events for outcomes referenced in `on_phase_completed` and `on_invalidated` actually exist
- [ ] Pulse actions (if any) defined in `common/schemes/pulse_actions/` and referenced in `pulse_actions = { entries = { ... } }`
- [ ] Test: start the scheme via the character interaction or console

## Common Pitfalls
- **Missing `_action` loc key**: The game uses `<scheme_key>_action` for the button text (e.g., "Murder"). Without it, you get a raw key in the UI
- **Forgetting `on_invalidated`**: If your scheme has no invalidation handler, the player gets no feedback when the scheme ends unexpectedly (target dies, goes out of range, etc.)
- **`is_basic = yes` implications**: Basic schemes skip agents, success chance growth, and pulse actions entirely. Don't define `agent_join_chance` or `pulse_actions` for basic schemes -- they'll be ignored
- **`base_progress_goal` confusion**: For agent-based schemes, lower values (like 20) mean faster phases with multiple loops. For basic schemes, higher values (like 365) approximate real time in days. The actual duration depends on speed vs resistance
- **`speed_per_skill_point` sign**: For basic schemes, vanilla uses negative values (e.g., `-2.5`) because the system subtracts from `base_progress_goal`. For agent-based schemes, positive values add to monthly progress chance
- **`valid` vs `allow`**: `allow` is checked once when starting. `valid` is checked every day while the scheme runs. Put expensive triggers in `allow`, not `valid`
- **Agent scope in `agent_join_chance`**: `root` is the potential agent, NOT the scheme owner. Use `scope:owner` for the scheme owner and `scope:target` for the target
- **Missing discovery check**: Hostile secret schemes need `hostile_scheme_monthly_discovery_chance_effect = yes` in `on_monthly`, or they'll never be discovered
- **Modifier `desc` keys**: Every `modifier` block in `base_success_chance` should have a `desc` key. Missing it means the tooltip shows no explanation for that bonus/penalty
- **Cooldown scope**: Cooldown applies per owner-target pair for the same scheme type. A 10-year cooldown means that specific owner can't use that scheme type on that specific target for 10 years
- **Pulse actions file location**: Pulse actions go in `common/schemes/pulse_actions/`, NOT in `common/schemes/scheme_types/`. They use a different format (see vanilla `general_scheme_pulse_actions.txt`)
