# Flags

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

Flags are markers used throughout CK3 to track state, tag objects, and gate logic. There are two fundamentally different kinds of flags in Paradox Script, and confusing them is a common source of bugs.

## Two Kinds of Flags

### 1. Runtime Flags (Dynamic)

Runtime flags are set and removed during gameplay via effects. They exist on **characters** and **relations** only. They can have an optional duration after which they auto-expire.

```pdx
# Set a flag (permanent)
add_character_flag = my_flag

# Set a flag with duration
add_character_flag = {
    flag = my_cooldown_flag
    years = 5
}

# Set with random duration
add_character_flag = {
    flag = my_flag
    days = { 30 90 }   # Random between 30-90 days
}

# Check
has_character_flag = my_flag

# Remove
remove_character_flag = my_flag
```

**Supported scopes for runtime flags:**

| Effect | Trigger | Scope |
|--------|---------|-------|
| `add_character_flag` | `has_character_flag` | character |
| `remove_character_flag` | — | character |
| `add_dead_character_flag` | `has_dead_character_flag` | character (dead) |
| `add_relation_flag` | `has_relation_flag` | character (on a scripted relation) |
| `remove_relation_flag` | — | character |

That's it. Only characters and relations get runtime flags. There are no `add_title_flag`, `add_province_flag`, or `add_county_flag` effects — those don't exist.

### 2. Definition Flags (Static)

Definition flags are declared in data files (`.txt`) as properties of game objects. They cannot be added or removed at runtime. They are checked with specialized triggers.

| Object | Declared with | Checked with |
|--------|--------------|-------------|
| **Government** | `flags = { flag_name }` | `government_has_flag = flag_name` |
| **Trait** | `flag = flag_name` | `has_trait_with_flag = flag_name` |
| **Building** | `flag = flag_name` | `has_building_with_flag = { flag = X count >= Y }` |
| **Law** | `flag = flag_name` | `has_realm_law_flag = flag_name` / `has_title_law_flag = flag_name` |
| **Innovation** | `flag = flag_name` | `has_innovation_flag = flag_name` |
| **Holy site** | `flag = flag_name` | `has_holy_site_flag = flag_name` |
| **Legitimacy level** | `flag = flag_name` | `has_legitimacy_flag = flag_name` |
| **Trait (on trait scope)** | `flag = flag_name` | `has_trait_flag = flag_name` |

## Runtime Flags in Detail

### Character Flags

The most commonly used flag type. Character flags are simple boolean markers attached to a living character.

**Common patterns:**

```pdx
# Event cooldown — prevent the same event from firing twice
immediate = {
    add_character_flag = {
        flag = had_my_event
        years = 10
    }
}
trigger = {
    NOT = { has_character_flag = had_my_event }
}

# One-time decision gate
effect = {
    add_character_flag = completed_my_quest
}
is_valid = {
    NOT = { has_character_flag = completed_my_quest }
}

# Temporary state tracking
add_character_flag = currently_in_ritual
# ... later ...
remove_character_flag = currently_in_ritual
```

**Duration syntax:**

```pdx
# Fixed duration
add_character_flag = { flag = X days = 30 }
add_character_flag = { flag = X weeks = 4 }
add_character_flag = { flag = X months = 6 }
add_character_flag = { flag = X years = 5 }

# Random duration (uniform between min and max)
add_character_flag = { flag = X years = { 3 7 } }

# Permanent (no duration — lasts until removed or character dies)
add_character_flag = X
```

### Dead Character Flags

Dead characters lose all their flags. If you need to check something on a dead character, use `add_dead_character_flag` (which **requires** a duration):

```pdx
# Must specify duration — dead character flags cannot be permanent
add_dead_character_flag = {
    flag = died_in_battle
    years = 100
}

# Check
has_dead_character_flag = died_in_battle
```

### Relation Flags

Flags on scripted relations (like `friend`, `rival`, `lover`, etc.). These must be declared in the relation's definition file before use.

```pdx
# In common/scripted_relations/my_relation.txt
my_custom_relation = {
    # ... relation definition ...
    flag = {
        my_relation_flag_a
        my_relation_flag_b
    }
}

# Set a flag on a relation
add_relation_flag = {
    relation = my_custom_relation
    target = scope:other_character
    flag = my_relation_flag_a
}

# Check
has_relation_flag = {
    relation = my_custom_relation
    target = scope:other_character
    flag = my_relation_flag_a
}

# Remove
remove_relation_flag = {
    relation = my_custom_relation
    target = scope:other_character
    flag = my_relation_flag_a
}
```

## Definition Flags in Detail

### Government Flags

Declared in the government definition, checked on any character with that government. This is the preferred way to gate logic by government type (more modular than `has_government`).

```pdx
# common/governments/my_governments.txt
my_republic_government = {
    # ...
    flags = {
        government_is_republic
        government_is_settled
        government_allows_trade
    }
}

# Usage in scripts
trigger = {
    government_has_flag = government_allows_trade
}
```

**Why use flags instead of `has_government`?** Multiple governments can share the same flag. If you check `government_has_flag = government_is_republic`, it matches any government with that flag — even custom ones added by other mods. If you check `has_government = republic_government`, it only matches one specific government.

### Trait Flags

Declared in the trait definition. Useful for checking categories of traits without listing each one.

```pdx
# common/traits/my_traits.txt
my_warrior_trait = {
    # ...
    flag = warrior_trait
    flag = martial_trait     # Can have multiple flags
}

# Check if character has ANY trait with this flag
has_trait_with_flag = warrior_trait

# Check on the trait scope itself
trigger = {
    has_trait_flag = martial_trait
}
```

Common vanilla trait flags: `education`, `lifestyle`, `commander`, `personality`, `health`, `genetic`, `fame`, `agent_acceptance_*`, `ruler_designer_*`.

### Building Flags

Declared in building definitions. Checked on provinces.

```pdx
# common/buildings/my_buildings.txt
my_castle_01 = {
    flag = castle
    flag = fortification
    flag = travel_point_of_interest_martial
    # ...
}

# Check if province has a building with this flag
has_building_with_flag = { flag = fortification count >= 1 }

# Check if province is constructing a building with this flag
has_construction_with_flag = fortification
```

### Law Flags

```pdx
# Check realm law flag
has_realm_law_flag = allows_slavery

# Check title-specific law flag
has_title_law_flag = elective_succession
```

### Innovation Flags

```pdx
# On a culture scope
has_innovation_flag = global_innovation
```

## Variables vs. Flags

Flags are boolean (exists or doesn't). For storing values, use **variables** instead:

| Need | Use |
|------|-----|
| "Has this happened?" | `add_character_flag` |
| "How many times?" | `set_variable` / `change_variable` |
| "Store a reference" | `set_variable = { name = X value = scope:target }` |
| "Temporary cooldown" | `add_character_flag = { flag = X years = 5 }` |
| "Permanent counter" | `change_variable = { name = X add = 1 }` |

## Pitfalls

1. **Character flags die with the character.** When a character dies, all their runtime flags are gone. If you need to persist state after death, use `add_dead_character_flag` (requires duration), save to a variable on a title, or use dynasty/house modifiers.

2. **There is no `add_title_flag` or `add_province_flag`.** Only characters and relations have runtime flags. To track state on a title or province, use variables: `set_variable = { name = my_state value = yes }`.

3. **Timed flags are not exact.** `years = 5` means the flag expires after 5 years of game time, but the check happens on a tick — there may be a brief window where it's already expired but hasn't been cleaned up yet.

4. **Flag names are global strings.** There's no namespacing — `my_flag` on character A is the same flag name as `my_flag` on character B. Always use descriptive, prefixed names: `mymod_had_dragon_event` not `had_event`.

5. **Permanent flags accumulate.** If you `add_character_flag = X` without duration on many characters and never remove it, those flags persist for the character's lifetime. This is fine for a few flags, but thousands of permanent flags on thousands of characters can impact save file size.

6. **`has_character_flag` on a dead character is always false.** Use `has_dead_character_flag` instead. This is a common bug in death event chains.

7. **Relation flags must be declared in the relation definition.** You can't add arbitrary flags to relations — they must be listed in the `flag = { }` block of the scripted relation file.

8. **Definition flags can't be added at runtime.** You can't dynamically add a flag to a government or trait during gameplay. If you need conditional behavior, use a character flag alongside the definition flag.

9. **`government_has_flag` is preferred over `has_government`.** The Paradox dev comment in the .info file says: "Use flags instead of has_government for moddability if possible." This allows other mods to create new governments that work with your code.

10. **Don't confuse `has_trait_with_flag` and `has_trait_flag`.** `has_trait_with_flag` is a character-scope trigger (does the character have any trait with this flag?). `has_trait_flag` is a trait-scope trigger (does this specific trait have this flag?). Different scopes, different uses.
