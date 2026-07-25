# Chapter 3: The script language

Everything under `common/` and `events/` is written in Paradox's Jomini script. It looks like configuration but behaves like a small programming language with one unusual core concept: the **scope**. This chapter is the longest and the most important; the rest of the tutorial assumes it.

## Fundamentals

```
key = value                 # assignment / effect / trigger
key = { nested = blocks }   # blocks nest arbitrarily
is_alive = yes              # booleans are yes / no
# comment to end of line
@my_const = 5               # file-local constant; use as key = @my_const
color = { 1 0 1 }           # colors as component lists (also rgb {} / hsv {})
```

- Effects and triggers are never standalone; everything is `key = value` or `key = { ... }`.
- **Comparison operators**: values compare with `< <= = != > >=`. Scopes compare with `=` and `!=`. And `?=` is the null-safe comparison: it checks the left side exists before comparing, so `capital_county ?= title:c_byzantion` is safe even for a character with no capital.
- There is no string manipulation and no inline arithmetic outside script values and `@[...]` constant math. `while` loops cap at 1000 iterations.
- `@` constants are file-local and resolved before parsing. `@[expr]` does inline math on constants: `@half = @[base / 2]`. The convention in large mods is a block of `@` constants at the top of a file holding all tuning numbers. The extension highlights both forms.

## Triggers vs effects: the grand division

Every keyword in the language is either a **trigger** (reads state) or an **effect** (changes state), and each is only legal in its own kind of block.

- Trigger blocks: `trigger`, `limit`, `is_shown`, `is_valid`, `potential`, `can_...`. Examples of triggers: `has_trait = brave`, `gold >= 100`, `is_ai = no`.
- Effect blocks: `effect`, `immediate`, `option`, `on_accept`, `after`. Examples of effects: `add_gold = 100`, `add_trait = brave`, `trigger_event = my.1`.

Mixing them up is the most common script error and lands in `error.log`. The extension's completion only offers triggers inside trigger blocks and effects inside effect blocks, which prevents most of these before they happen.

Logic in trigger blocks: every block is AND by default; `OR = { }`, `NOT = { }`, `NOR = { }`, `NAND = { }`, `AND = { }` nest freely. Most yes/no triggers negate directly: `is_ai = no` means the same as `NOT = { is_ai = yes }`.

Conditionals use different keywords on each side of the divide:

```
# in TRIGGER blocks:
trigger_if = { limit = { <condition> } <checks> }
trigger_else_if = { limit = { <condition> } <checks> }
trigger_else = { <checks> }     # an else_if ladder MUST end with trigger_else

# in EFFECT blocks:
if = { limit = { <condition> } <effects> }
else_if = { limit = { <condition> } <effects> }
else = { <effects> }
while = { count = 10 <effects> }
switch = {
	trigger = has_trait
	brave = { <effects> }
	craven = { <effects> }
}
```

See `common/scripted_triggers/00_bastard_triggers.txt` in the game folder for a beautifully explicit `trigger_if` ladder in the wild.

## Scopes: what the script is "about"

A **scope** is the object the current line of script operates on. When an event fires for a character, `add_gold = 50` gives gold to that character because the character is the current scope. Scope types include character, landed_title, province, faith, religion, culture, dynasty, army, artifact, secret, scheme, story, war and more.

The navigation keywords:

- **`root`** : the scope the current context started with (an event's recipient, a decision's taker).
- **`this`** : the current scope. Mostly used in comparisons: `this = scope:bad_guy`.
- **`prev`** : the scope you were in before the last scope change. No chaining two steps back.
- **Context switch**: open a block on any scope expression and everything inside operates on it:

```
title:k_france = {
	holder = {
		add_gold = 100      # the current holder of Kingdom of France gets gold
	}
}
```

- **Database prefixes** address specific objects: `character:163109`, `title:k_france`, `culture:english`, `faith:orthodox`, `province:496`, `trait:brave`, `flag:my_marker`.
- **Event targets** are named links you can chain with dots: `title:k_france.holder.mother.faith.religious_head`. The complete list for your game version comes from the console command `script_docs` (writes `event_targets.log`); the extension indexes that dump for completion.

### Saved scopes

To remember an object across a block (or across an event chain), save it:

```
random_courtier = {
	limit = { is_adult = yes }
	save_scope_as = scribe
}
scope:scribe = { add_gold = 10 }
```

Rules that save hours:

- In **trigger** blocks use `save_temporary_scope_as` (saving is technically an effect; the temporary variant is the trigger-legal version).
- Saved scopes persist through an unbroken event chain: if event A saves `scope:scribe` and `trigger_event`s event B, B can use `scope:scribe`. After the chain ends, they are gone.
- `save_scope_value_as` stores primitives (numbers, booleans, `flag:x` markers). Compare them null-safely: `scope:mood ?= flag:angry`.
- Never write `scope:` in front of `root`, `prev` or event targets. `scope:` is only for names you saved (plus the auto-provided ones like `scope:actor` in interactions).
- You may still meet `event_target:` in old wiki pages; that is the legacy CK2-era spelling. Modern mods use `scope:` exclusively.

The optional setting `px.scopeInlayHints` displays the inferred scope type after scope-changing openers (for example `every_vassal = {  # character`) while you learn.

## Lists and iterators

One-to-many relationships use a four-way family of list builders. For a list `X` (children, vassals, courtiers, realm provinces...):

| Form | Kind | Purpose |
|---|---|---|
| `any_X` | **trigger** | Does at least one item match? Supports `count =` and `percent =` |
| `every_X` | effect | Run effects on all matching items |
| `random_X` | effect | Run effects on one random matching item |
| `ordered_X` | effect | Run effects on the top item(s) by an `order_by` script value |

```
# trigger: do I have at least 2 adult children?
any_child = {
	is_adult = yes
	count >= 2
}

# effect: give every daughter gold
every_child = {
	limit = { is_female = yes }
	add_gold = 10
}
```

The asymmetry trips everyone once: **effect iterators filter with `limit = { }`; `any_X` takes its conditions directly and must never contain `limit` or effects.** A `limit` inside `any_X` is invalid.

`ordered_X` accepts `order_by = <script value>`, `position`, `min`/`max` and `check_range_bounds = no`. The idiomatic split, measured across large mods: check with `any_`, act with `every_` or `random_`.

## Variables

Script has no declarations; you set variables on scopes at runtime.

| Kind | Set | Read | Lifetime |
|---|---|---|---|
| Normal | `set_variable = { name = x value = 5 }` | `var:x` | Lives on the scope it was set on, dies with it |
| Global | `set_global_variable = { ... }` | `global_var:x` | One per name, everywhere |
| Local | `set_local_variable = { ... }` | `local_var:x` | Current script execution only |

- Shorthand: `set_variable = my_flag` sets a boolean marker; check with `has_variable = my_flag`. Vanilla also uses `add_character_flag = { flag = x days = 10 }` for timed markers.
- Change and remove: `change_variable = { name = x add = 1 }`, `remove_variable = x`. Do not write `var:` inside `change_`/`remove_` blocks; they take the bare name.
- **The scope-locality trap**: a variable lives on the scope you set it on. To read it you must be in, or chain from, that scope: `player_heir.var:x`. Reading `var:x` from the wrong scope silently yields nothing.

**Variable lists** are how you model rosters and collections:

```
add_to_variable_list = { name = shareholders target = scope:new_member }
is_target_in_variable_list = { name = shareholders target = scope:someone }   # trigger
every_in_list = { variable = shareholders  <effects> }
clear_variable_list = shareholders
```

There are also temporary lists (`add_to_list`, `add_to_temporary_list`) scoped to one execution, and global lists (`add_to_global_variable_list`, iterated with `every_in_global_list`). Lists cannot nest and ignore duplicate inserts. One gotcha inside iterators: `add_to_variable_list` stores the list on the *current* scope, so scope back to the intended owner:

```
every_ruler = {
	root = { add_to_variable_list = { name = rulers target = prev } }
}
```

Chapter 10 returns to lists with the single most important performance rule in CK3 modding: anything you iterate regularly must be bounded.

## Script values: computed numbers

`common/script_values/` holds named numeric expressions usable anywhere a number is expected:

```
# common/script_values/chron_values.txt
chron_chronicle_cost = 50            # plain constant

chron_chronicle_prestige = {         # computed
	value = 100
	add = diplomacy                  # triggers that return values work here
	multiply = 2
	min = 150
	max = 500
}
```

Use them as `add_prestige = chron_chronicle_prestige`. Inline math blocks work in most numeric positions too: `add_gold = { value = age multiply = 2 }`. Some triggers return values directly to effects: `add_gold = age`. Parenthesized targets need quotes: `add_gold = "opinion(liege)"`.

Two cautions: script values are recomputed on every use (a heavy value displayed in the UI recomputes every frame, see [Chapter 7](07-gui.md)), and vanilla's `common/script_values/00_basic_values.txt` is the reference for style, including culture-era scaling tricks.

## Reusable script: the DRY toolkit

| What | Folder | Call as |
|---|---|---|
| Scripted effect | `common/scripted_effects/` | `chron_reward_effect = yes` |
| Scripted trigger | `common/scripted_triggers/` | `chron_eligible_trigger = yes` (or `= no`) |
| Script value | `common/script_values/` | `add_gold = chron_cost` |
| Scripted modifier | `common/scripted_modifiers/` | Reusable `base` + `modifier {}` weight blocks |
| Scripted list | `common/scripted_lists/` | Custom `any_/every_X` definitions |

Naming conventions used by essentially all major mods: scripted effects end `_effect`, scripted triggers end `_trigger`, everything carries your mod prefix. The extension's go-to-definition (F12) jumps from a call site to the definition, in your mod or vanilla, and Find All References works in reverse.

### `$PARAM$` macros

Scripted effects and triggers accept parameters. The definition wraps a name in `$...$`; the call site supplies it bare:

```
# common/scripted_effects/chron_effects.txt
chron_gift_effect = {
	add_gold = $AMOUNT$
	if = {
		limit = { gold >= 1000 }
		add_prestige = $AMOUNT$
	}
}

# call site:
chron_gift_effect = { AMOUNT = 100 }
```

Any token can be substituted, even effect names or scope fragments:

```
chron_pay_family_effect = {
	every_$WHO$ = { add_gold = 10 }
}
chron_pay_family_effect = { WHO = child }
```

This is mainstream practice, not an exotic trick; vanilla's `00_bastard_triggers.txt` passes `$TARGET$` and `$PARTICIPANT$` through nested scripted triggers. Prefer one parameterized effect over near-duplicate copies. The extension highlights `$PARAM$` tokens so definitions read clearly.

## The workhorse vocabulary

Frequency analysis of the largest CK3 mods shows a small core vocabulary does most of the work. Effects: `save_scope_as`, `set_variable`, `add_character_flag`, `custom_tooltip`, `trigger_event`, `stress_impact`, `hidden_effect`, `add_opinion`, `send_interface_toast`, `random_list`, `add_trait`. Triggers: `has_trait`, `exists`, `has_character_flag`, `opinion`, `is_ai`, `has_variable`, `is_alive`, `is_adult`. Learn these first; reach for exotic ones only when the workhorses cannot express the idea.

Note how many of those are about **tooltips** (`custom_tooltip`, `hidden_effect`, `show_as_tooltip`). Polished mods constantly control what the player sees of an effect block. `hidden_effect = { }` runs effects without showing them in the tooltip; `custom_tooltip = some_loc_key` shows text without running anything.

## Try it

1. Create `common/scripted_effects/chron_effects.txt` with a `chron_chronicle_reward_effect` that takes an `$AMOUNT$` parameter, adds that much prestige, and (via `if`/`limit`) adds a bonus 50 if the character has the `ambitious` trait.
2. Create `common/script_values/chron_values.txt` with `chron_chronicle_prestige` as shown above.
3. Rewire your Chapter 2 decision: `effect = { chron_chronicle_reward_effect = { AMOUNT = chron_chronicle_prestige } }`.
4. F12 from the decision into the scripted effect and back. Then test in-game via the console: `effect chron_chronicle_reward_effect = { AMOUNT = 100 }`.

Next: [Chapter 4: Events and on_actions](04-events.md) · [Back to index](index.md)
