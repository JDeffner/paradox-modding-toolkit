# Script language: syntax, scopes, triggers/effects, variables, reusable script

## Fundamentals (Jomini/Clausewitz script)

Used in `common/` and `events/`. History files use a related but distinct static format
(see content.md).

```
key = value                 # assignment / effect / trigger
key = { nested = blocks }   # blocks nest arbitrarily
is_alive = yes              # booleans: yes / no
# comment to end of line
@my_const = 5               # file-local constant; use as key = @my_const
color = { 1 0 1 }           # colors as component lists (also rgb{}/hsv{}/hex{})
```

- Effects/triggers are never standalone; always `key = value` or `key = { ... }`.
- **Operators**: value comparison `< <= = != > >=`; scope comparison `=` and `!=`; `?=` is
  null-safe (checks the scope exists before comparing — `capital_county ?= title:c_byzantion`).
- **Logic blocks** (trigger context): `AND`, `OR`, `NOT`, `NOR` (same as NOT), `NAND`.
  All trigger blocks (`limit`, `trigger`, …) are AND by default.
- Triggers accept negation via `= no`: `is_ai = no` ≡ `NOT = { is_ai = yes }`.
- Some triggers return values usable by effects: `add_gold = age`; parenthesized targets need
  quotes: `add_gold = "opinion(liege)"`.
- No string manipulation, no inline arithmetic outside `@[...]` and script-value blocks,
  1000-iteration cap on `while`.
- **Encoding**: script `.txt` = UTF-8; localization `.yml` = UTF-8 **with BOM**, mandatory.

## Scopes

A **scope** is the object script currently operates on. Scope types: character, landed_title,
province, faith, religion, culture, dynasty, dynasty_house, activity, army, artifact, secret,
scheme, story, war, combat, struggle, legend, epidemic, situation, … (full list: console
`script_docs` → `logs/event_scopes.log`).

- **`root`** — the context the current block started with (e.g. the event's recipient). Not
  necessarily a character; some contexts (character interactions) have no root.
- **`this`** — current scope. **`prev`** — previous scope (no chaining two back).
- **Context switch**: open a block on any scope: `title:k_france = { ... }`.
- **Database prefixes**: `character:163109`, `title:k_france`, `culture:english`,
  `faith:orthodox`, `province:496`, `flag:my_string`. Only history-defined characters have
  stable IDs.
- **Event targets** — named links, chainable with `.`:
  `title:k_france.holder.mother.faith.religious_head`. Full list: `logs/event_targets.log`.
- **Saved scopes**:

```
title:k_france.holder = { save_scope_as = king }
scope:king = { add_gold = 100 }
```

  Persist through an unbroken event chain (A `trigger_event`s B → B sees the scope), then clear.
  In **trigger** blocks use `save_temporary_scope_as`. `save_scope_value_as` stores primitives
  (numbers, bools, `flag:x`); compare with `?=`: `scope:x.var:mood ?= flag:angry`.
  Never write `scope:` before `root`/`prev` or event targets.
  Interactions provide `scope:actor`/`scope:recipient` automatically (never saved by hand);
  on_actions pre-save scopes documented in header comments of each vanilla on_action file.
  `event_target:` is the legacy CK2-era prefix — modern mods use `scope:` exclusively (0 uses
  in the entire AGOT corpus vs ~29,000 `save_scope_as`).

- **List builders** (one-to-many): `every_X` (effect, all items, filter with `limit`),
  `random_X` (effect, one random, `limit` filters pool), `ordered_X` (effect; `order_by` script
  value, `position`, `min`/`max`, `check_range_bounds = no`), `any_X` (**trigger**; conditions
  inside; `count =`/`percent =` supported — do NOT use `limit` or effects inside `any_X`).

```
every_child = {
    limit = { is_female = yes }
    add_gold = 10
}
```

## Triggers vs effects

- **Triggers** check state (`has_trait = brave`); live in `limit`, `trigger`, `is_shown`,
  `is_valid`, `potential`, `can_…` blocks.
- **Effects** change state (`add_gold = 100`); live in `immediate`, `effect`, `option`,
  `on_accept`, `after` blocks.
- Mixing them up is an error (check error.log).

```
# in TRIGGER blocks:
trigger_if = { limit = { <cond> } <checks> }
trigger_else_if = { limit = { <cond> } <checks> }
trigger_else = { <checks> }        # a trigger_else_if ladder MUST end with trigger_else

# in EFFECT blocks:
if = { limit = { <cond> } <effects> }
else_if = { limit = { <cond> } <effects> }
else = { <effects> }
while = { count = 10 <effects> }   # or limit = {}; capped at 1000
switch = { trigger = has_trait  brave = { ... }  craven = { ... } }
```

AI weighting (`ai_chance` in event options, `ai_will_do` in decisions, weights in on_action
`random_events`):

```
ai_chance = {
    base = 50
    modifier = { add = 15  has_trait = sadistic }
    modifier = { add = -40 has_trait = compassionate }
}
```

For smooth, personality-driven AI weighting prefer the AI attributes (`ai_honor`, `ai_greed`,
`ai_zeal`, `ai_boldness`, `ai_vengefulness`, `ai_sociability`, `ai_energy`, `ai_compassion`)
scaled into the weight (`add = { value = ai_honor divide = 2 }`) over long trait lists — see
`mods/agot.md` pattern 3.

## Reusable script

| What | Folder | Use for |
|---|---|---|
| Scripted effect | `common/scripted_effects/` | Reusable effect code; call `my_effect = yes` |
| Scripted trigger | `common/scripted_triggers/` | Reusable conditions; call `my_trigger = yes` (or `= no`) |
| Script value | `common/script_values/` | Computed numbers; use as `add_gold = my_value`. Recomputed every use — heavy values in UI lag every frame |
| Scripted modifier | `common/scripted_modifiers/` | Reusable `base + modifier{}` weight blocks |
| Scripted list | `common/scripted_lists/` | Custom `any_/every_X` list definitions |

```
# script value with math
my_value = { value = age  add = 10  divide = 5  min = 1  max = 100 }

# parameters via $PARAM$ (scripted effects AND triggers):
gift = { add_gold = $VAL$ }        # definition
gift = { VAL = 100 }               # call site — no $$ here
# ANY token can be substituted, even effect names or whole chunks:
my_iter = { every_$WHO$ = { add_gold = 10 } }   →   my_iter = { WHO = child }
```

**Real-world conventions** (measured on the AGOT mod — 4,426 scripted effects, 3,699 scripted
triggers, 3,238 script values):

- Name scripted effects `*_effect`, triggers `*_trigger` (or `*_valid_trigger`), and prefix with
  a mod tag (`agot_*`) — the dominant convention; the extension/tiger tooling and other modders
  rely on it.
- `$PARAM$` macros are mainstream, not exotic: ~260 AGOT files use them. Prefer a parameterized
  scripted effect over near-duplicate copies.
- `@const` headers (e.g. `@esr_tier_duchy = 10`) are the standard way to keep tuning numbers at
  the top of script_value files.
- The workhorse vocabulary is small — most-used effects: `save_scope_as`, `add_character_flag`,
  `set_variable`, `custom_tooltip`, `trigger_event`, `stress_impact`, `hidden_effect`,
  `add_opinion`, `send_interface_toast`, `random_list`, `add_trait`; most-used triggers:
  `has_trait`, `exists`, `has_character_flag`, `opinion`, `is_ai`, `has_variable`, `is_alive`,
  `is_adult`. Reach for these before hunting exotic ones. Tooltip control (`custom_tooltip`,
  `hidden_effect`, `show_as_tooltip`) is a constant habit in polished mods, not an edge case.
- Trigger-side `any_*` is the most-used iterator family (18k uses vs 8k `every_*`) — check with
  `any_`, act with `every_`/`random_`.
- **Magnitude discipline**: when many call sites need "a chance of X happening", define named
  probability wrappers (`mymod_small/moderate/high_risk_of_X = random chance 10/25/50`) in ONE
  scripted-effects file and multiply by a single `*_factors_mult` script value — see
  `mods/pod.md` (the masquerade risk wrappers) for the reference implementation.

**Reader macros (`@`)**: `reader_export/_reader_export.info` documents the raw token-stream
preprocessor (`@name = value`, `@[expr]` inline math, `@:define`/`@:insert`). It runs before all
parsing and knows nothing about game logic. Paradox's guidance: **always prefer scripted
effects/triggers/values when they exist**; use `@` only for file-local constants and math.

## Variables, flags, lists

| Kind | Set | Read | Notes |
|---|---|---|---|
| Normal | `set_variable = { name = x  value = 5 }` | `var:x` | Lives ON the scope it was set on; dies with the character |
| Global | `set_global_variable` | `global_var:x` | One per name, everywhere |
| Local | `set_local_variable` | `local_var:x` | Current script execution only |
| Dead char | `set_dead_character_variable` | `dead_var:x` | Requires duration |

- Shorthand: `set_variable = x` sets a boolean flag; check with `has_variable = x`. There is also
  `add_character_flag = { flag = x  days = 10 }` used by vanilla for timed flags.
- Math: `value = { add = 10 divide = 5 }` inline; `change_variable = { name = x  add = 1 }`;
  `remove_variable = x`. Never use `var:` inside `change_/remove_`.
- **Scope-locality trap**: to read a variable you must be in (or chain from) the scope holding
  it: `player_heir.var:x`.
- In loc/GUI: `[GetPlayer.MakeScope.Var('x').GetValue]`, `.GetCharacter`, `.IsSet`; globals via
  `[GetGlobalVariable('x').GetValue]`.

**Lists**: temporary — `add_to_list`, `add_to_temporary_list` (only one usable in triggers);
persistent — `add_to_variable_list = { name = l  target = scope:x }`,
`add_to_global_variable_list`. Membership: `is_in_list`, `is_target_in_variable_list`.
Clear: `clear_variable_list` (run before rebuilding). Lists can't nest; duplicates ignored.
Gotcha inside iterators — `add_to_variable_list` stores on the *current* scope, so scope back:

```
every_ruler = {
    root = { add_to_variable_list = { name = rulers  target = prev } }
}
```

**Perf rule for persistent lists**: anything iterated in a pulse must be BOUNDED (cap size on
insert). Bounded lists anchored to a durable global object (a faith, a title, a global var) are
the standard way to model rosters/societies — worked examples in `mods/pod.md` (Camarilla) and
`mods/agot.md` (spy network, banking shareholders).
