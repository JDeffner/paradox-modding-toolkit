# Princes of Darkness (PoD): patterns for meters, secrecy systems, hidden societies, supernatural rulers

Mod root: `<workshop>\2216659254`
All relative paths below are inside that root. All claims here were verified against the files
(July 2026, mod v1.19.0.6). When this summary is not enough, read the mod files directly.

## Structure map (where to look)

Total conversion, ~12k files, prefix `POD_` (GUI widget names `pod_`). Vanilla-override files keep
vanilla names or use `z_`/`zz_` prefixes (e.g. `z_POD_vanilla_override_wound_traits.txt`).

| System | Location |
|---|---|
| script_values | `common/script_values/POD_*_values.txt`, grouped by system (blood, discipline, umbra, crafting...). Masquerade math: `POD_masquerade_values.txt`; GUI display values: `POD_misc_values.txt` |
| scripted_effects | `common/scripted_effects/` (225 files), subfoldered: `POD_vampire/`, `POD_kueijin/`, `POD_demons/`, `POD_umbra/`, `POD_crafting/`, `POD_artifacts/` |
| scripted_triggers | `common/scripted_triggers/` (`POD_core_triggers.txt`, `POD_camarilla_triggers.txt`, ...) |
| events | `events/POD_masquerade/`, `events/POD_chargen/`, `events/POD_maintenance/`, plus many vanilla-override event files |
| on_actions | `common/on_action/` with vanilla filenames; PoD hooks appended inside (e.g. `yearly_on_actions.txt` line ~3071: `25 = POD_vampire_masquerade_breach.200`) |
| traits | `common/traits/00_POD_traits.txt`, `00_POD_traits_fera.txt` (hundreds of discipline/splat traits) |
| interactions | `common/character_interactions/` |
| court positions | `common/court_positions/types/00_POD_camarilla_court_positions.txt` etc. |
| GUI | registry `gui/scripted_widgets/POD_scripted_widgets.txt` (42 lines); windows `gui/POD_windows/`; shared types `gui/POD_shared/`; scripted_guis `common/scripted_guis/POD_progressbar_guis.txt`. Also full-file vanilla overrides at `gui/` root (`hud.gui`, `window_character.gui`, ...): their biggest maintenance tax, do not imitate (see `references/gui.md`) |
| localization | `localization/english/POD_*_l_english.yml` + `event_localization/POD_*/` |

Note: when validating a PoD submod with ck3-tiger, use the `--pod` flag.

## The Masquerade meter (a hidden-exposure system done right)

**Storage is NOT a variable.** Exposure is one of six mutually-exclusive character modifiers,
`masquerade0_modifier` (safe) through `masquerade5_modifier` (exposed). A script_value
(`masquerade_exposure_level` in `common/script_values/POD_masquerade_values.txt`) reads which one
is present and returns 0-5 via an if/else_if ladder. Why modifiers instead of a variable:

1. Each tier modifier carries actual game effects (opinion, dread, stress, AI weights, health)
   that scale with exposure automatically, no separate "apply penalties" pass.
2. Tiers are self-documenting in the character sheet and localize cleanly per tier.

A **floor**: `minimum_masquerade_exposure` (same file) pins characters who can never fully hide
(the `exposed` trait or forever-infamous trigger = 5; certain predator types = 1) and is enforced
on every mutation.

**The display value is INVERTED for the GUI.** `masquerade_level` in `POD_misc_values.txt`
(a `switch` over the modifiers: tier 0 → 5 ... tier 5 → 0) is what the HUD bar reads, so a full
bar = safe. Danger logic and display logic are two clearly-named script_values off one underlying
state. Copy this split; a bar forced to mean the opposite of your effects is a sign-flip bug farm.

**All mutation goes through one engine file**,
`common/scripted_effects/POD_vampire/POD_vampire_masquerade_effects.txt`:

- `POD_set_masquerade_modifier_effect = { AMOUNT = n }`: remove current tier, `switch`-add tier n.
- `POD_change_masquerade_exposure_effect = { DELTA = n }`: THE clamp wrapper. Computes
  level + DELTA, clamps `min = minimum_masquerade_exposure`, `max = 5`, calls the setter.
  Floor/ceiling enforced on every change because nothing else mutates state.
- Single-step increase/decrease effects, guarded by "has this system at all" triggers and NOR
  against terminal states. The increase step has a 10% chance, weighted by current level, to
  cascade into a full breach event.
- **Named risk wrappers own all magnitudes**: `POD_minimal/small/moderate/high/very_high_risk_of_
  increasing_masquerade_exposure` = random chances 5/10/25/50/75, each multiplied by
  `masquerade_all_factors_mult` (perks/masks reduce risk, frenzy/strict doctrines increase it;
  moderate+ branch on the `no_masquerade_penalty` faith doctrine parameter). Hundreds of flavor
  events just call `POD_moderate_risk_... = yes`; balance lives in ONE file. This is the single
  most transferable structural idea in the mod.

**Breach detection = spawn a concrete witness, not an abstract tick.**
`events/POD_masquerade/POD_vampire_masquerade_breach_events.txt`:

- `.100` (player breach; landed non-AI ruler only): `create_character` with
  `template = POD_mortal_hunter_template` at the capital, tagged `POD_knows_too_much` +
  `blocked_from_leaving` (2 yrs), added as courtier so it can't wander off; a 5-year character
  flag prevents re-entry. Player options: Dominate/erase, ignore (raises exposure), bribe,
  kill (prowess duel), drain. The witness IS the threat object.
- `.200` (AI courtier breach, hidden): fired from `yearly_on_actions.txt` at weight 25, gated
  hard: courtier, `is_ai = yes`, vampire under vampire liege, not imprisoned/torpored/at-war,
  and `intrigue <= 10` (high-intrigue characters aren't sloppy). Hands the problem up to the
  liege via `.300`/`.400` (Dominate the witness, forgive for a hook, or sheriff arrest duel).

**Society polices itself** via `POD_enforce_masquerade_interaction`
(`common/character_interactions/POD_vampire/POD_vampire_masquerade_interactions.txt`): liege
targets a vassal with exposure > 0, resolves as a duel (Dominate/Presence/Intrigue/Bribe), success
lowers target exposure; `ai_will_do` base 0, rising +20/+40/+60 with the target's tier.

**Cover-up effect**: `POD_cover_up_masquerade_effect` is a `switch` on the chosen `send_option`
flag (dominate/bloodsorcery/presence/bribe/murderspree/layinglow); each branch is a `random_list`
whose outcomes call the decrease-multiple effect, weights buffed by the relevant skill and
advanced-discipline trait; costs blood or gold; murderspree can backfire into an increase.

**AI compliance throttles (critical, copy all of these):**

- AI breaches rare and hard-gated (see `.200` above).
- AI auto-heals from max tier: hidden `POD_maintenance.26` fires 1-5 years after an AI hits
  tier 5 and drops it to 4, so AI never sticks at "exposed".
- The AI never sees the flavor risk pulses: all gated `is_ai = no`. AI exposure moves only through
  a few deterministic paths, or breaches would spam and tank performance.
- Enforcement AI is opt-in (`ai_will_do base = 0` rising with target exposure).

**Nuclear option**: `POD_destroy_masquerade_effect` sets a global variable, strips masquerade
modifiers off `every_living_character`, swaps every masquerade doctrine to a none-doctrine.
Precedent for a "the secret goes public" endgame toggle.

## Immortality and succession

- Deathlessness rides vanilla: `immortal = yes` + `can_have_children = no` +
  `no_prowess_loss_from_age` flags on the core supernatural traits in `common/traits/00_POD_traits.txt`.
- **Torpor** (`has_trait = torpor`) is the "temporarily inactive" sideline state, excluded from AI
  pulses, breaches, and society eligibility via one flag checked in pulse triggers. Cleaner than
  scattering special cases or killing the character.
- Player-switching (`set_player_character` master/servant swap) exists but is commented out in
  `common/scripted_effects/POD_resurrection_effects.txt`; PoD backed away from it. Instead:
  immortals simply rule for centuries.
- Because rulers are immortal and childless, the heir-driven vanilla meta goes dormant. PoD
  compensates with a non-dynastic progression axis: society ranks, court positions, artifacts.
  Any 300-year-rule design needs the same.

## Hidden society modeling (the Camarilla pattern)

Not a government, not a struggle: **a bounded roster on a durable global object plus a status
number plus a scripted_widget window.** No map presence required.

- Membership/ranks are variable-lists on a faith object: `POD_is_justicar_trigger` tests
  `faith:camahumanity = { is_target_in_variable_list = { name = justicars target = prev } }`
  (`common/scripted_triggers/POD_camarilla_triggers.txt`).
- Rank collapses to one comparable number: `camarilla_status` script_value
  (`common/script_values/POD_thorns_values.txt`): Inner Circle 8, Justicar 7, Archon 6, ruler 5,
  Primogen 4, ... with a `POD_has_higher_camarilla_status_trigger` for precedence.
- Local courts use real court positions with `aptitude_level_breakpoints`
  (`common/court_positions/types/00_POD_camarilla_court_positions.txt`).
- UI is the scripted_widget `camarilla_view`; consequences (bounties, arrests) are interactions
  gated on `camarilla_status >= 7`.

## Transferable patterns (application sketches use a cultivation-themed mod as the running example)

1. **Tiered-modifier meter instead of a raw variable.** For a 0-100 value (Heaven's Gaze),
   consider a hybrid: keep the variable for granularity but derive tier modifiers at 25/50/75 so
   effects attach automatically and localize per tier. Reuse the remove-old/switch-add-new setter.
2. **Named probability wrappers own all magnitudes**, multiplied by one `*_factors_mult`
   script_value. Call sites stay dumb; one file tunes the whole game.
3. **Split danger value from display value** (inverted bars documented loudly).
4. **Clamp wrapper with a script-value floor** respected by every mutation.
5. **Spawn threats as tagged, pinned NPC witnesses** (`create_character` + flag +
   `blocked_from_leaving` + re-entry flag). Witnesses need a lifecycle (silence, timeout, removal)
   or you leak courtiers and re-fire events.
6. **scripted_widgets for ALL custom UI**; never override `hud.gui` (see `references/gui.md`).
7. **GUI-script three-bridge contract**: `ScriptValue` for numbers, `PlayerGuiIsShown` for
   visibility, `PlayerGuiExecute`/`PlayerGuiBuildTooltip` for click/hover.
8. **Appraisal/detection as a resource-gated interaction** that reveals a hidden variable via
   event (PoD's Auspex telepathy: `common/character_interactions/POD_discipline/POD_discipline_auspex_interactions.txt`).
9. **Society = bounded list on a durable global object + status script_value** + char flag for
   fast membership checks, list for iteration/precedence.
10. **AI auto-heal from the worst tier + hard AI gating** so AI never perma-stalls or spams.
11. **Doctrine/faith parameters read inside the risk wrappers** give regional variation with zero
    extra call-site code.
12. **Global "secret goes public" switch** for endgame.

## Anti-patterns observed in PoD (do not copy)

- Full-file vanilla `.gui` overrides (`hud.gui`, `window_character.gui`, ...): re-diffed every
  patch, #1 source of breakage. PoD accepts the cost for deep integration; an additive mod should not.
- The inverted display value works but is a sign-flip trap; document it or name it away.
- Running player flavor pulses on AI would spam and lag; PoD's `is_ai = no` gates are load-bearing.
- Unbounded membership lists iterated in pulses are a known CK3 perf trap; PoD's rosters are bounded.
- Vanilla secret/blackmail plumbing has no "blackmailer gets exposed" backfire; if your design
  forbids blackmail, add the guard yourself.
