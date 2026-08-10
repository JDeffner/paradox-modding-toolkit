# AI Behavior -- Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
AI behavior in CK3 is not a separate system -- it is woven into every scriptable system (decisions, events, interactions, schemes, wars). The AI uses **weight-based scoring** to decide what to do. Every AI field ultimately produces a number; the highest-scoring option wins (or, for percent-chance fields, the number is treated as a probability).

Key principle: **the AI only evaluates things you let it evaluate**. If you set `ai_check_interval = 0` or omit `ai_potential`, the AI will never see your content. If you set `base = 0` and add no modifiers, the AI will never pick it.

> Core references: `common/ai_war_stances/_ai_war_stances.info`, `common/scripted_modifiers/_scripted_modifiers.info`, vanilla `common/decisions/_decisions.info`, vanilla `common/character_interactions/_character_interactions.info`, vanilla `events/_events.info`

---

## The Weight/Score System (Used Everywhere)

Almost all AI fields use the same modifier block syntax:

```
ai_will_do = {
    base = 50                   # Starting value

    modifier = {                # Conditional additive modifier
        add = 30
        has_trait = ambitious
    }

    modifier = {                # Conditional multiplicative modifier (legacy keyword)
        factor = 0.5            # Multiplies the CURRENT accumulated value
        has_trait = content
    }

    modifier = {                # Conditional multiplicative modifier (preferred keyword)
        multiply = 2
        is_powerful_vassal = yes
    }
}
```

### Evaluation Order
1. Start with `base` value.
2. Each `modifier` block is evaluated top-to-bottom.
3. If the trigger conditions in the block are true, the operation applies.
4. `add = X` adds X to the current value.
5. `factor = X` and `multiply = X` both multiply the current value by X. (`factor` is the older keyword; both work identically.)
6. The final value is used as a weight, score, or percent depending on context.

### Script Values as an Alternative
Any AI weight field can also take a **script value** instead of the modifier block syntax:
```
ai_will_do = my_custom_script_value
```
Script values use `if/else_if/else` with `add`/`multiply` instead of `modifier` blocks. The `ai_will_select` field in events (see below) requires this syntax.

---

## AI in Decisions

### Check Interval (When the AI Looks)
Every decision needs exactly one of these (unless `ai_goal = yes`):

```
# Fixed interval -- all AI characters check every N months
ai_check_interval = 120

# Per-tier interval -- higher-rank characters check more often
ai_check_interval_by_tier = {
    barony = 0          # 0 = never check
    county = 120
    duchy = 60
    kingdom = 36
    empire = 12
    hegemony = 12
}
```

Setting `ai_check_interval = 0` means the AI **never** considers the decision. Use this for player-only decisions.

### ai_potential (Whether the AI Looks)
A trigger block. If false, the AI skips this decision entirely for this character. Use for cheap early-out filtering:
```
ai_potential = {
    is_adult = yes
    highest_held_title_tier > tier_barony
}
```

### ai_will_do (How Likely the AI Takes It)
Returns a **percent chance** (0-100) of executing the decision when checked. Clamped to 0-100.
```
ai_will_do = {
    base = 30
    modifier = {
        add = 70
        primary_title.tier > tier_county   # Dukes+ almost always do it
    }
    modifier = {
        add = -50                          # Reluctant if liege is same dynasty
        any_liege_or_above = {
            dynasty = root.dynasty
        }
    }
}
```

### ai_goal (Budget-Aware Decisions)
For expensive decisions (major costs like title creation), set `ai_goal = yes`. The AI will budget gold/prestige/piety for it alongside other major expenditures. This replaces `ai_check_interval` (the AI checks continuously). Use sparingly -- it is less performant.
```
form_the_kingdom_decision = {
    ai_goal = yes
    # ai_check_interval is ignored when ai_goal = yes
    ...
}
```

---

## AI in Events

### ai_chance (Modifier Block Syntax)
Each event option gets an `ai_chance` block. The AI picks the option with the highest resulting value (weighted random among all options):
```
option = {
    name = my_event.001.a
    ai_chance = {
        base = 100              # Strong preference for this option
    }
}
option = {
    name = my_event.001.b
    ai_chance = {
        base = 10               # Rarely picked
        modifier = {
            add = 90
            has_trait = greedy   # Unless greedy
        }
    }
}
```

### ai_will_select (Script Value Syntax)
An alternative to `ai_chance`. Uses script value syntax (if/else_if) instead of modifier blocks. **Mutually exclusive with `ai_chance`** -- use one or the other per option, not both.
```
option = {
    name = my_event.002.a
    ai_will_select = {
        base = 10
        if = {
            limit = { has_trait = brave }
            add = 50
        }
        else_if = {
            limit = { has_trait = craven }
            multiply = 0.1
        }
    }
}
```

Both `ai_chance` and `ai_will_select` produce a weight. The AI does a weighted random pick across all options (options with weight 0 or below are never picked).

---

## AI in Character Interactions

Character interactions have the richest AI configuration:

### ai_potential (Trigger -- Should AI Even Consider This?)
Quick filter. If false, the AI never tries this interaction.
```
ai_potential = {
    has_any_artifact = yes
}
```
Note: `ai_potential` is deprecated in favor of `is_available`, but still widely used in vanilla.

### ai_targets (Who the AI Considers)
Defines which characters the AI evaluates as recipients. You can specify multiple `ai_targets` blocks -- they combine into one pool.
```
ai_targets = {
    ai_recipients = scripted_relations    # Friends, rivals, lovers, etc.
    ai_recipients = liege
    max = 10                              # Only consider up to 10
}
ai_targets = {
    ai_recipients = neighboring_rulers
    ai_recipients = peer_vassals
    max = 10
    chance = 0.5                          # Randomly skip 50% for performance
}
```

Common `ai_recipients` types: `scripted_relations`, `liege`, `vassals`, `neighboring_rulers`, `peer_vassals`, `family`, `children`, `spouses`, `courtiers`, `guests`.

### ai_target_quick_trigger (Fast Pre-Filter)
Quick boolean checks applied before full trigger evaluation:
```
ai_target_quick_trigger = {
    adult = yes
    attracted_to_owner = yes
    prison = yes
}
```

### ai_frequency / ai_frequency_by_tier (How Often AI Tries)
```
ai_frequency = 60               # Check every 60 months

ai_frequency_by_tier = {        # Or vary by rank
    barony = 180
    county = 90
    duchy = 36
    kingdom = 24
    empire = 12
    hegemony = 12
}
```

### ai_accept (Will the AI Recipient Say Yes?)
A weight block. The AI accepts if the final value is >= 0. Shown to the player as the acceptance tooltip.
```
ai_accept = {
    base = 0
    modifier = {
        add = 50
        opinion = { target = scope:actor value >= 50 }
    }
    modifier = {
        add = -100
        has_trait = greedy
        scope:actor = { has_gold < 100 }
    }
}
```

### ai_will_do (How Eager the AI Actor Is)
Returns 0-100 percent chance. Evaluated after targets are selected.
```
ai_will_do = {
    base = 0
    modifier = {
        add = 50
        opinion = { target = scope:recipient value >= 20 }
    }
}
```
For title interactions, each target title is evaluated separately and the one giving the highest `ai_will_do` wins. Same for interaction options.

---

## AI in Schemes

### Scheme Type ai_will_do
In scheme countermeasures, `ai_will_do` is a script value. The AI picks the countermeasure with the highest value:
```
my_countermeasure = {
    ai_will_do = { add = ai_will_do_bounties_for_whispers_value }
}
```

For scheme types themselves, the AI uses the scheme's `ai_will_do` to decide whether to start the scheme against a target.

---

## AI in Wars (War Stances)

War stances control AI army behavior during wars. Defined in `common/ai_war_stances/`.

```
my_aggressive_stance = {
    side = attacker                    # attacker or defender

    behaviour_attributes = {
        stronger = yes                 # Use when our side is stronger
        weaker = no
        desperate = no                 # defender-only, about to lose
    }

    can_be_picked = {
        # Trigger, scoped to the War
    }

    ai_will_do = {
        # Script value, scoped to the War
        # Highest-scoring valid stance is selected
        base = 100
    }

    enemy_unit_priority = 200          # How much to chase enemy armies

    # Objectives: priority list (1-1000) of where to send armies
    objectives = {
        wargoal_province = 500
        enemy_unit_province = {
            priority = 250
            area = wargoal
            area = primary_defender
        }
    }

    # Fallback objectives (checked if no targets in above)
    objectives = {
        defend_wargoal_province = 5
    }
}
```

Valid objectives: `wargoal_province`, `enemy_unit_province`, `enemy_capital_province`, `capital_province`, `enemy_province`, `enemy_ally_province`, `province`, `defend_wargoal_province`.

Note: `enemy_unit_province` areas must not overlap across objective blocks.

---

## Scripted Modifiers (Reusable Weight Components)

Scripted modifiers (in `common/scripted_modifiers/`) are reusable modifier blocks you can invoke inside any weight field. They support parameterization:

```
# Definition in common/scripted_modifiers/my_modifiers.txt
personality_weight_modifier = {
    modifier = {
        add = { value = 10 multiply = $SCALE$ }
        $CHARACTER$ = { has_trait = ambitious }
    }
    opinion_modifier = {
        target = $TARGET$
        who = $CHARACTER$
        multiplier = { value = 0.25 multiply = $SCALE$ }
    }
}

# Usage in a decision
ai_will_do = {
    base = 50
    personality_weight_modifier = {
        CHARACTER = root
        TARGET = scope:recipient
        SCALE = 0.5
    }
}
```

Special modifier types:
- `modifier` -- standard add/factor/multiply with trigger
- `opinion_modifier` -- adds weight based on opinion between two characters
- `compare_modifier` -- adds weight proportional to a value (e.g., stress level)

---

## Common Patterns

### Make AI Strongly Prefer Something
```
ai_will_do = {
    base = 100
}
```

### Make AI Avoid Something (Player-Only)
```
ai_check_interval = 0      # Decision: AI never checks
# OR
ai_will_do = { base = 0 }  # Always evaluates to 0
```

### Personality-Based Weighting
```
ai_will_do = {
    base = 50
    modifier = {
        add = 30
        has_trait = ambitious
    }
    modifier = {
        factor = 0              # Never do it if content
        has_trait = content
    }
    modifier = {
        add = 20
        ai_compassion >= 50     # AI personality values
    }
    modifier = {
        add = -20
        ai_greed >= 50
    }
}
```

AI personality values: `ai_boldness`, `ai_compassion`, `ai_energy`, `ai_greed`, `ai_honor`, `ai_rationality`, `ai_sociability`, `ai_vengefulness`, `ai_zeal`. Range: -100 to 100 (driven by traits).

### Scale by Realm Size / Rank
```
ai_will_do = {
    base = 10
    modifier = {
        multiply = 3
        highest_held_title_tier >= tier_kingdom
    }
}
```

### Conditional Elimination (factor = 0)
A common pattern to completely block AI from choosing an option under certain conditions:
```
modifier = {
    factor = 0          # Zeroes out entire accumulated weight
    is_at_war = yes     # Never do this while at war
}
```
Place `factor = 0` blocks early -- once the weight is zero, subsequent adds still result in zero being multiplied.

---

## Common Pitfalls

### AI Never Takes My Decision
1. **`ai_check_interval = 0`** -- The AI never evaluates it. Set a positive interval or use `ai_check_interval_by_tier`.
2. **`base = 0` with no additive modifiers** -- The weight stays at zero. Multiplicative modifiers on zero are still zero.
3. **Missing `ai_potential`** -- If `ai_potential` evaluates to false for every AI character, nobody checks it. But also: if `ai_potential` is missing entirely, it defaults to true, so this is only a problem if you have one that is too restrictive.
4. **`is_shown` blocks AI** -- `is_shown` applies to AI too. If it fails, the AI cannot see the decision.

### AI Never Uses My Interaction
1. **No `ai_targets` defined** -- The AI has no recipients to consider.
2. **`ai_frequency = 0`** -- Never checked.
3. **`ai_potential` too restrictive** -- Filters out all AI characters.
4. **`ai_will_do` returns 0** -- The AI finds targets but never sends the interaction.

### AI Always Picks the Same Event Option
- All other options have `base = 0` or extremely low weights.
- A `factor = 0` modifier fires on all other options for common AI characters.
- Solution: give every option a nonzero base, use `add` for personality differentiation.

### Performance Considerations
- **Low check intervals are expensive.** `ai_check_interval = 1` means every AI character evaluates every month. Use the highest interval that still feels responsive (36-120 months for non-urgent decisions).
- **Use `ai_check_interval_by_tier`** to limit barons/counts (who are numerous) from checking expensive decisions. Set `barony = 0` unless barons genuinely need the decision.
- **`ai_goal = yes` is more expensive** than high check intervals. Only use for decisions where the AI needs to budget resources.
- **Use `ai_potential`** aggressively to filter out characters who can never take the decision, before the expensive `is_valid`/`ai_will_do` evaluation runs.
- **`ai_targets` with `max` and `chance`** -- In interactions, limit how many targets the AI evaluates. Use `max = 10` and `chance = 0.5` to cut evaluation in half.
- **`ai_target_quick_trigger`** -- Use boolean quick-triggers (adult, prison, etc.) before full trigger evaluation for interactions.

### Weight Goes Negative
- Negative weights are generally treated as zero (the AI will not pick the option). But `ai_accept` in interactions uses negative values to show "reasons against" in the tooltip.
- For decisions, `ai_will_do` is clamped to 0-100. Values above 100 are treated as 100%.

### factor vs multiply
- Both multiply the current weight. They are functionally identical.
- Convention: use `factor` for 0 (elimination) and `multiply` for scaling. But this is just style -- the engine treats them the same.
