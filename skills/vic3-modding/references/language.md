# The Victoria 3 script language

- [Syntax basics](#syntax-basics)
- [The safe operator ?=](#the-safe-operator-)
- [Database prefixes](#database-prefixes)
- [Scopes](#scopes)
- [Iteration and the scope_ infix](#iteration-and-the-scope_-infix)
- [Triggers vs effects](#triggers-vs-effects)
- [Script values and math](#script-values-and-math)
- [Variables, and why there are no flags](#variables-and-why-there-are-no-flags)
- [Scripted effects, triggers, lists, modifiers](#scripted-effects-triggers-lists-modifiers)

Verified against Victoria 3 **1.13.10**. Vocabulary claims are checkable with
`vic3_docs.py find`; this file covers grammar, which the dumps do not describe.

## Syntax basics

Clausewitz `key = value` and `key = { ... }`. `#` starts a comment. Comparison operators are
written directly:

```
country_rank >= rank_value:unrecognized_major_power
popularity < 0
devastation > 0
```

## The safe operator ?=

`?=` means "if this scope exists". Vanilla uses it constantly, and using plain `=` on a scope
that may be absent is the standard source of `error.log` spam.

```
ig:ig_landowners ?= { save_scope_as = landowners_ig }
NOT = { scope:power_bloc ?= this }
c:USA ?= { ... }
```

Reach for `?=` whenever the target is a country, interest group, company, power bloc, or saved
scope that is not guaranteed to exist at that moment.

## Database prefixes

`prefix:key` addresses a database entry directly from any scope. Usage counts across `common/`
and `events/` in 1.13.10, which double as a guide to how central each one is:

| Prefix | Uses | Addresses |
|---|---:|---|
| `c:` | 23,703 | country by tag, `c:GBR` |
| `s:` | 16,713 | state, `s:STATE_SINAI` |
| `cu:` | 12,806 | culture, `cu:japanese` |
| `law_type:` | 9,017 | law, `law_type:law_monarchy` |
| `rel:` | 5,162 | religion |
| `ig:` | 2,460 | interest group, `ig:ig_landowners` |
| `sr:` | 1,479 | strategic region |
| `g:` | 660 | goods |
| `je:` | 616 | journal entry |
| `rank_value:` | 583 | country rank as a number |
| `modifier:` | 356 | read a live modifier value as a number |
| `ig_trait:` | 201 | interest group trait |
| `company_type:` | 145 | company type |
| `b:` | 50 | building |
| `institution:` | 49 | institution |
| `bg:` | 28 | building group |
| `principle:` | 21 | power bloc principle |
| `pop_type:` | 16 | pop type |

Plus `scope:<name>` for a saved scope and `var:<name>` / `global_var:<name>` for variables.

The complete authoritative list of global prefixes is in the event targets dump, where they are
marked `Global Link: yes`. There are 45 of them:

```bash
python scripts/vic3_docs.py find c
```

## Scopes

Victoria 3's scope types, as they appear in the dumps' `Supported Scopes` fields, number 47.
The ones that carry most scripting:

`country`, `state`, `state_region`, `strategic_region`, `province`, `pop`, `building`,
`interest_group`, `character`, `journal_entry`, `political_movement`, `power_bloc`, `company`,
`market`, `market_goods`, `state_goods`, `goods`, `law`, `law_type`, `culture`, `religion`,
`party`, `war`, `battle`, `battle_side`, `front`, `theater`, `military_formation`,
`diplomatic_play`, `diplomatic_pact`, `treaty`, `treaty_article`, `institution`, `civil_war`,
`political_lobby`, `ship`, `hq`, `none`.

`none` means the item has no scope requirement. It is the most common value in both dumps.

Every effect and trigger in the dumps names its supported scopes, so a scope question is always
answerable:

```bash
python scripts/vic3_docs.py find add_modifier
```

## Iteration and the scope_ infix

Four prefixes: `every_` (act on all), `any_` (trigger, does one match), `random_` (act on one),
`ordered_` (act on the best N, takes `order_by` and `max`). `limit = { ... }` filters inside
`every_`, `random_` and `ordered_`.

```
every_power_bloc = {
    limit = {
        NOT = { scope:power_bloc ?= this }
    }
    power_bloc_leader = { ... }
}
```

**The `scope_` infix is a Victoria 3 convention with no CK3 equivalent, and it changes meaning:**

| Form | Iterates |
|---|---|
| `every_state` | every state in the world |
| `every_scope_state` | the states belonging to the current scope |

The same holds for `every_scope_pop`, `every_scope_building`, `every_scope_character`,
`every_scope_war`, and their `any_` / `random_` / `ordered_` variants. Getting this wrong turns
a country-local loop into a world scan, which is both wrong and a performance problem.

## Triggers vs effects

Triggers are boolean, effects mutate. Logical operators: `AND`, `OR`, `NOT`, `NAND`. Triggers
also have `trigger_if = { limit = { ... } <conditions> }`. Effects use `if` / `else_if` / `else`,
each with `limit = { ... }`.

`custom_tooltip = { text = <loc key> <conditions> }` wraps a trigger so the UI prints one line
instead of the whole condition tree. This is a pervasive Victoria 3 idiom, and skipping it
produces unreadable tooltips.

## Script values and math

`common/script_values/script_values.md` is the authority. A value is either a bare number or a
formula block.

**Operations execute in written order, not by precedence.** The doc's own example:

```
value = { add = 5  multiply = 4  max = 10  add = 5 }
```

evaluates to 15, because `max = 10` applies before the final `add = 5`.

Operators: `add`, `subtract`, `multiply`, `divide`, `modulo`, `value`, `min`, `max`, `round`,
`ceiling`, `floor`, `round_to`, `fixed_range`, `integer_range`, and `if` / `else_if` / `else`
with `limit`. Ranges are written `{ min max }`, as in `add_gold = { 1 5 }`. Formulas nest, chain
through scopes (`value = mother.example_age`), and can iterate lists.

Two constraints from the doc: formulas do **not** work for boolean values, and they are
re-evaluated every time they are read, so a heavy formula on a pulse is a performance risk.
Guard against dividing by zero, modulo by zero, and rounding to zero.

## Variables, and why there are no flags

**Victoria 3 has no country, character, or province flags.** `set_country_flag` occurs zero
times across all of `common/` and `events/` in 1.13.10. Porting CK3 flag logic produces effects
that simply do not exist, and the dumps will confirm that:

```bash
python scripts/vic3_docs.py find set_country_flag   # not found
```

Use variables instead. Vanilla usage counts: `has_variable` 6,358, `set_variable` 2,991,
`remove_variable` 712, `change_variable` 448, `set_global_variable` 339, `var:` 1,390,
`global_var:` 160.

```
set_variable = { name = suez_canal_var }
change_variable = { name = abolishing_monarchy_var  add = 1 }
```

A boolean flag becomes "variable exists or does not", tested with `has_variable`. Variable lists
exist too (`add_to_variable_list`, `every_in_list`, `every_in_global_list`), though vanilla uses
them sparingly. `set_local_variable` and `local_var:` exist but appear once each in vanilla.

**Saved scopes are the main plumbing**, with `save_scope_as` appearing 5,906 times. Prefer a
saved scope over a variable when you need to remember an object rather than a number.

## Scripted effects, triggers, lists, modifiers

`common/scripted_effects/` (40 files) and `common/scripted_triggers/` (25 files) hold reusable
blocks. Neither folder ships a schema doc, so vanilla is the reference. Parameters use `$PARAM$`
substitution:

```
save_neighbor_with_state = {
    random_neighbouring_state = {
        limit = { owner = { $CRITERIA$ } }
    }
}
```

`common/scripted_lists/` defines derived lists that then gain the full
`every_` / `any_` / `random_` / `ordered_` prefix set:

```
interest_group_in_government = {
    base = interest_group
    conditions = { is_in_government = yes }
}
```

`common/scripted_modifiers/` holds reusable `factor` blocks for AI weighting.

Document your own scripted effects and triggers with a comment naming the root scope and each
parameter. Nothing in the engine records that, and the next reader (including a later agent
session) cannot infer it.
