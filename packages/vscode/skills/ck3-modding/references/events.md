# Events, on_actions, decisions, interactions, story cycles

## Events

Files in `events/`. Full schema: `events/_events.info`. Best example: `events/tutorial_events.txt`.

```
namespace = my_events            # first line of the file; alphanumeric, no dots

my_events.0001 = {               # keep numeric IDs <= 9999
    type = character_event       # character_event | letter_event | duel_event | none | empty
    title = my_events.0001.t     # loc keys
    desc = my_events.0001.desc
    theme = intrigue             # from common/event_themes/ (background+lighting+sound)
    left_portrait = { character = root  animation = worry }

    trigger = { is_adult = yes } # gate, checked BEFORE firing; cannot see scopes saved in immediate
    immediate = {                # runs instantly, before text/portraits render:
        random_courtier = { save_scope_as = target }   # save scopes HERE for desc/portraits
    }
    option = {
        name = my_events.0001.a
        add_gold = 50
        hidden_effect = { ... }  # kept off the tooltip
        ai_chance = { base = 100 }
    }
    after = { clear_saved_scope = target }   # cleanup after an option is chosen
}
```

- `hidden = yes` — no window, runs in background (maintenance events; zero options allowed).
- `type = empty` — required for events with no character context.
- Portrait slots: `left_portrait`, `right_portrait`, `lower_left/center/right_portrait`; each
  accepts `character`, `animation`, `triggered_animation`, `triggered_outfit`, `hide_info`.
- Dynamic text: `desc`/`title` accept `first_valid` / `random_valid` blocks of
  `triggered_desc = { trigger = {...} desc = key }` (nestable).
- Option extras: per-option `trigger`, `show_as_unavailable`, `trait`/`skill` icons,
  `add_internal_flag = special|dangerous`, `highlight_portrait`, `fallback`, `exclusive`, `flavor`.
- Option norms (from the AGOT corpus, ~23k options): virtually every option has `name`; ~2 in 3
  carry `ai_chance` (omitting it means AI weights all options equally — usually a bug);
  `stress_impact = { trait = value }` on personality-relevant choices is standard flavor polish.
- Chaining/delays: `trigger_event = { id = my_events.0002  days = { 7 14 } }`
  (`days`/`months`/`years`, ranges allowed); `trigger_event = { on_action = my_on_action }`.
- `on_trigger_fail` runs if `trigger` fails.
- **You cannot override a single vanilla event** — whole file only.

## on_actions

Hooks that run on game happenings (birth, death, war end, pulses). Folder: `common/on_action/` —
**singular `on_action`, a classic typo trap**. The complete catalog of code-fired hooks and pulses
(with their scopes) is in `common/on_action/_on_actions.info`; each vanilla file's header comments
list available saved scopes.

Sub-blocks: `trigger` (gate), `effect` (direct effects — runs in a separate chain from any events
it fires; local scopes do NOT carry into those events),
`events = { id  delay = { days = 365 }  id2 }`,
`random_events = { chance_to_happen = 25  100 = event.1  100 = 0 }` (a `0` entry = chance of
nothing), `first_valid`, `on_actions`/`random_on_actions`/`first_valid_on_action` (chaining),
`weight_multiplier`, `fallback`.

### THE critical pitfall

Only `events`, `random_events`, and `on_actions` blocks **append** across mods. `trigger` and
`effect` **overwrite** vanilla and every other mod:

```
# CORRECT — append a custom on_action to the vanilla hook:
on_birth_child = {
    on_actions = { my_mod_on_birth }
}
my_mod_on_birth = {
    trigger = { ... }
    effect = { ... }
}

# WRONG — clobbers vanilla's (and other mods') trigger/effect:
on_birth_child = {
    trigger = { ... }
    effect = { ... }
}
```

Useful hooks: `on_game_start` (no root; before character select), `on_game_start_after_lobby`,
`on_birth_child`, `on_16th_birthday`, `on_death` (fires just before death — last chance to move
variables to `primary_heir`), `yearly_global_pulse`, `random_yearly_playable_pulse`,
`quarterly_playable_pulse`. **There is no monthly pulse**; simulate via quarterly + delayed calls
or a self-retriggering on_action. Never nest `every_living_character` inside a per-character
pulse (N² lag). Pulses that iterate characters must run over BOUNDED lists
(`every_in_global_list` + `limit`), ideally with an amortization counter; see `mods/agot.md`
pattern 9 for the worked example.

## Story cycles (per-character clocks — the right tool for AI-driven mechanics)

Folder: `common/story_cycles/`, schema `_story_cycles.info`. A story attaches to one character
(`story_owner`), holds its own variables, and runs `effect_group = { months = { 3 12 } trigger = {...} ... }`
blocks on randomized intervals, plus `on_setup`/`on_end`/`on_owner_death` hooks. Prefer one story
per participating actor over any global scan: the story IS the pulse and touches only its owner.
Always add a kill-switch effect_group (`trigger = { story_owner ?= { is_ai = no } }` →
`end_story = yes`) so AI machinery stops when the player takes over, and real `on_owner_death`
cleanup. Vanilla has few good examples; the AGOT mod is the reference implementation — see
`mods/agot.md` patterns 1, 2, 5, 10 for verified idioms (state-machine stories, trait-XP ladders,
decaying-chance-to-forced-decision).

## Decisions

Folder: `common/decisions/`; schema: `common/decisions/_decisions.info`. Unique key per decision
(LIOS override), convention `*_decision`.

```
my_decision = {
    picture = { reference = "gfx/interface/illustrations/decisions/decision_misc.dds" }
    desc = my_decision_desc
    decision_group_type = major             # groups from common/decision_group_types
    is_shown = { is_ruler = yes }           # appears in the tab at all?
    is_valid_showing_failures_only = { is_available_adult = yes }  # failed conds shown as requirements
    is_valid = { piety_level >= 3 }         # BOTH is_valid blocks must pass
    cost = { gold = 100 }                   # deducted; minimum_cost = affordable but not deducted
    cooldown = { years = 5 }
    effect = { add_prestige = 500 }
    ai_potential = { always = yes }         # will AI consider it
    ai_will_do = { base = 100 }
    ai_check_interval = 12                  # months; 0 = AI never checks; or ai_goal = yes
}
```

Localization keys auto-derived from the id: `<id>`, `<id>_desc`, `<id>_tooltip`, `<id>_confirm`
(overridable via `title`/`desc`/`selection_tooltip`/`confirm_text`). Testing: console
`effect remove_decision_cooldown = my_decision`.

## Character interactions

Folder: `common/character_interactions/`; schema: `_character_interactions.info` (read it — it
documents every key and the scope rules). The engine **auto-provides** `scope:actor` and
`scope:recipient` (there is no `root`); `scope:secondary_actor`/`scope:secondary_recipient` exist
only if the interaction declares secondary targets (e.g. `secondary_recipient = marriage`) or a
`redirect` block saves them. Skeleton (keys in real-world usage order):

```
my_interaction = {
    category = interaction_category_diplomacy   # from interaction_categories
    icon = ...
    desc = my_interaction_desc
    redirect = {                    # optional: re-target before checks run
        scope:recipient = {
            save_scope_as = secondary_recipient
            scope:actor.top_liege = { save_scope_as = recipient }
        }
    }
    is_shown = { ... }              # cheap visibility gate (runs often — keep light)
    is_valid_showing_failures_only = { ... }   # failed conditions listed to the player
    on_accept = { ... }             # effects; also on_decline, on_send
    auto_accept = yes               # or a trigger block; else recipient gets a choice
    ai_accept = {                   # recipient AI: base + opinion-style modifiers
        base = -25
        opinion_modifier = { who = scope:recipient  opinion_target = scope:actor
                             multiplier = 1  desc = AI_OPINION_REASON }
        modifier = { add = 50  trigger = { ... } }
    }
    ai_potential = { ... }  ai_will_do = { ... }  ai_frequency = 12
    ai_targets = { ai_recipients = neighboring_rulers  max = 3 }   # ALWAYS set max on AI-offered
    send_option = { flag = ... localization = ... }   # optional checkboxes; the most common
                                                      # extra key in complex interactions
    greeting = positive   notification_text = MY_KEY
}
```

The `redirect` pattern above is the standard way to route "ask my liege about X" interactions
(taken from AGOT's `00_agot_bastard_interactions.txt`).

**Craft notes (verified in AGOT, see `mods/agot.md` for full examples):**

- Give every `ai_accept` modifier its own `desc` and scale personality with AI attributes
  (`ai_honor`, `ai_greed`, `ai_zeal`, `ai_boldness`, `ai_vengefulness`) rather than trait lists —
  smooth variance and the tooltip reads like the character talking (pattern 3).
- `duel = { skill = X ... }` blocks inside options/on_accept give visible-odds gambles for free;
  surface odds with `compare_modifier` (pattern 4).
- On AI-offered hostile interactions always bound `ai_targets` with `max` and pre-filter with
  `ai_target_quick_trigger` before an expensive `is_shown`.

## Related systems (same pattern; each folder has an `.info`)

- **Schemes** (`common/schemes/scheme_types/` + `agent_types/`, agent-based since 1.13),
  **activities** (`common/activities/`), **casus belli** (`common/casus_belli_types/`),
  **laws** (`common/laws/`), **lifestyles/perks** (`common/lifestyles/`, `common/lifestyle_perks/`),
  **secrets** (`common/secret_types/` — full lifecycle hooks incl. `on_owner_death` ownership
  transfer; see `mods/agot.md` pattern 8), **important_actions** (`common/important_actions/` —
  alerts/feed entries, `combine_into_one`, `open_interaction_window`; see `mods/agot.md` pattern 7).
