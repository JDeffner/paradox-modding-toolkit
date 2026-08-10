# A Game of Thrones (AGOT): patterns for AI-initiated drama, story cycles, interactions, secrets, performance

Mod root: `<workshop>\2962333032` (name "A Game of
Thrones", v0.4.38, supported_version 1.19.0.6). **NOT** `2995674648`: that is only the
"AGOT - Crowns of Westeros" crown-art submod (prefix `ntc_`). All claims below were verified
against the files (July 2026). When this summary is not enough, read the mod files directly.

## Structure map (where to look)

Total conversion, prefix `agot_` (files usually `00_agot_*.txt`; DLC-derived overrides keep
vanilla numeric prefixes like `10_tgp_*`; load-order tails `zz_`). The descriptor declares many
`replace_path=` entries (history/characters, landed_titles, cultures, dynasties, religion, ...).

| System | Location |
|---|---|
| story_cycles | `common/story_cycles/` (40+ files, `agot_story_cycle_*`): pirate AI, faceless, secret_identity, maester, dragon, royal_bastard, squire, prisoner, scenario_* |
| scripted_effects | `common/scripted_effects/` incl. `00_agot_secret_identity_effects.txt` (~2k lines) |
| secret_types | `common/secret_types/agot_secret_types.txt` (+ `00_secret_types.txt`, bastard, dynastic_cycle) |
| interactions | `common/character_interactions/` (50+ files): kingsguard, spy_network, hostile (goad), trial_by_combat, banking, dragon_bond, small_council, ... |
| on_actions | `common/on_action/agot_on_actions/` (40+ files: `agot_yearly_on_actions.txt`, `agot_game_start.txt`, `agot_death.txt`, subfolders `relations/`, `agot_story_cycles/`) |
| important_actions | `common/important_actions/00_agot_actions.txt` |
| schemes | `common/schemes/scheme_types/` (~17 files, uses the 1.13+ agent-based scheme system: `agot_kingsguard_scheme`, `agot_bond_with_dragon_scheme`, `tgp_mentoring_scheme`, vanilla overrides) + `agent_types/` |
| localization | `localization/english/agot/...` (and `simp_chinese/agot/`, `replace/french/agot/`) |

## The 10 most transferable patterns

### 1. Per-character story cycle as a self-terminating AI "life arc"
`common/story_cycles/agot_landless_pirate_ai_story_cycles.txt`. A story attached to one AI
character with randomized-interval `effect_group = { months = { 3 12 } }` and a trigger gate
(`story_owner ?= { is_ai = yes ... is_at_war = no is_travelling = no }`), plus a kill-switch
group: the story ends (`end_story = yes`) the moment `story_owner` is `is_ai = no`. Each hidden
actor runs its own bounded clock; no global scan; randomized intervals de-sync the herd; AI
machinery never runs on the player. (Correction vs older notes: the file's `on_owner_death` and
`on_end` blocks exist but are EMPTY, so death cleanup is a no-op here; add real cleanup in yours.)
Application: wrap each seeded hidden cultivator in a `hidden_cultivator_life_story`
(`months = { 6 18 }`) driving breakthrough attempts and grudge actions, with the is_ai kill-switch.

### 2. State-carrying story with per-story variable slots
`common/story_cycles/agot_story_cycle_faceless.txt` (`story_hire_faceless`, `story_wear_face`).
The story holds a `faceless_victim` variable, then a `days = 30` effect_group fires the payoff
event once `var:faceless_victim ?= { is_alive = no }`: the story WAITS for an offscreen outcome
and reports back. `story_wear_face` juggles 2-4 variables and on end pushes the worn face into a
global anchor (`global_var:hall_of_faces` points at a title_province holding a `faces`
variable-list). A story is a tiny state machine with bounded memory polling one cheap condition.
Application: inherited-grudge story (`var:grudge_target`/`grudge_originator`, transfer to heir on
owner death) and breakthrough-protector story (wait for tribulation, roll betrayal).

### 3. Rich, fully-narrated `ai_accept` with personality-scaled reasons
`common/character_interactions/00_agot_kingsguard_interactions.txt`
(`invite_to_kingsguard_interaction`). ~15 weighted `modifier` blocks, EACH with its own `desc` so
the decision reads like the character talking; personality via AI attributes, not trait lists:
`add = { value = ai_honor divide = 2 }`, `ai_greed` multiplied negative, `ai_zeal` both
directions (also `ai_boldness`); plus `auto_accept = { custom_description = ... }` for the
slam-dunk case. Attributes give smooth non-binary variance. Highest value per effort of anything
in this file: copy the block shape verbatim for every accept decision.

### 4. Peer-to-peer duel/challenge with visible odds
`common/character_interactions/00_agot_hostile_interactions.txt` (`agot_goad_interaction`) and
`00_agot_trial_by_combat_interactions.txt`. Goad: `auto_accept`, `cooldown = { years = 2 }`,
`is_shown` gated on personality (`NOR = { honest just compassionate shy }`) and target
`is_ai = yes`, a `duel = { skill = intrigue ... }` with `compare_modifier` surfacing odds, rival
potential on failure. Trial by combat: `popup_on_receive`/`pause_on_receive` peer challenge with
on_accept/on_decline/champion chain and family-wide opinion stakes on declining. `duel` blocks
give visible-odds gambles for free. Application: dao duels weighted by realm, decline branch
raises Heaven's Gaze or brands cowardice.

### 5. Trait-XP ladder progression driven from a story cycle
`common/story_cycles/agot_story_cycle_maester.txt`. A `days = 365` effect_group advances
novices via `has_trait_xp = { trait = maester value < 100 }` into threshold events;
`on_owner_death` picks the successor with a weighted `random_living_*` (not scan-and-sort).
In-file perf comment caps headcount (~22) and threatens to stretch the interval if too costly:
adopt that budgeting discipline verbatim. Example application (cultivation-themed mod): a
10-realm trait ladder plus disciple succession (`random_relation = { type = disciple }` weighted pick).

### 6. Secret society as a bounded variable_list
`common/character_interactions/00_agot_spy_network_interactions.txt`: membership lives in
`variable_list = spy_network_members` on the network owner; `is_shown`/`is_valid` dedupe with
`is_target_in_variable_list`; recruits gated (courtier, unlanded, not incapable). Global variant:
the hall_of_faces list (pattern 2). Bounded list = O(members), never O(map), and doubles as the
membership record. (This file also contains the hardcoded-character anti-pattern, see below.)

### 7. Alerts/important_actions as the offscreen-drama feed
`common/important_actions/00_agot_actions.txt`. `action_agot_squire_can_be_knighted`:
`type = alert`, `check_create_action` finds the relation + validates the interaction, `effect`
opens the interaction window directly (`open_interaction_window = { interaction = ... }`).
Other actions in the same file (`action_agot_faceless_interaction`, `action_can_hire_maester`)
use `combine_into_one = yes` to collapse repeats into one feed entry (the squire alert itself
does not). This is how the player cheaply "hears about" AI-vs-AI activity. Application:
disciple-ready-for-breakthrough alert; bounty/edict feed entries with combine_into_one.

### 8. Secret lifecycle with ownership transfer on death
`common/secret_types/agot_secret_types.txt` (`secret_agot_disputed_heritage`): full hooks
(`is_valid`, `is_shunned`, `is_criminal`, `on_discover`, `on_expose`, and
`on_owner_death -> set_secret_owner = scope:child`) so the conspiracy survives its keeper.
Secrets are CK3's built-in blackmail/exposure economy: author `on_expose` once, the engine
handles discovery spread and blackmail interactions for free. Application: `secret_cultivator`
with on_expose raising Heaven's Gaze + alerting the Covenant, on_owner_death transferring to an
heir/disciple.

### 9. Global pulses over BOUNDED lists with amortization counters
`common/on_action/agot_on_actions/agot_yearly_on_actions.txt`: `yearly_global_pulse` runs
`agot_banking`, iterating `every_in_global_list = { variable = IB_Shareholder ... }` (plus
bank1/2/3 lists), with the counter global var `IB_BookkeepingYears` (increments 1..4, then payout
and reset) spreading the expensive pass across years. Textbook "no world scans in pulses" and
time-amortization. Application: Veiled Court yearly edict/bounty pass over
`veiled_court_members` with a cycle counter.

### 10. "Glamour"/secret identity via dupe-character death + link variable
`common/scripted_effects/00_agot_secret_identity_effects.txt`
(`agot_start_secret_identity_effect`): create a duplicate (`copy_inheritable_appearance_from`,
`copy_traits`, `change_first_name`, throwaway fake parents), kill the dupe
(`death_disappearance`/`death_execution`), clear the real character's claims/relations, link the
two with `set_variable = { name = secret_identity_character value = scope:dupe }`; reverse op
`agot_end_secret_identity_effect`. The companion story
(`agot_story_cycle_secret_identity.txt`) runs a **decaying-chance-to-forced-decision** engine:
a `secret_adventure_chance` variable decremented by a weighted random_list, branching when < 1.
That idiom is perfect for any "pressure builds until a reckoning" mechanic.

## AI-agency architecture (the budget model)

Per-actor stories replace map scans (the pulse IS the story, touching only `story_owner`).
Randomized intervals de-sync thousands of actors. Anything cross-character lives in bounded
global lists iterated with `every_in_global_list` + `limit`. Amortization counters gate expensive
passes to once every few years. Personality attributes (`ai_honor/ai_greed/ai_zeal/
ai_vengefulness/ai_boldness/ai_sociability`) decide behavior with legible desc'd reasons.
Kill-switches end every AI story on player takeover; add real on-death cleanup too. Alerts with
`combine_into_one` are the spam-safe offscreen feed. Secrets provide a free AI-driven drama
economy. Net cost: N actor-stories, each O(1) per its own randomized tick, plus a handful of
bounded amortized list passes per year. Scales with participating actors, not world size.

## Anti-patterns observed in AGOT (do not copy in an additive mod)

1. **Hardcoded named-character blockers**: `NOR = { this = character:Lannister_6 this = character:Lannister_7 }`
   in `00_agot_spy_network_interactions.txt` (lines ~45-46); `agot_secret_types.txt` on_expose also
   hardcodes Stark/Tully/Targaryen IDs. A total-conversion luxury. Gate on traits/variables/flags,
   never character IDs.
2. **Monolithic `on_expose` tied to specific titles** (`title:h_the_iron_throne` claim chains).
   Keep on_expose generic (raise a value, add to a list, fire one event); push flavor into events.
3. **Broad `every_courtier` in a yearly story without a headcount cap**: the maester story's own
   dev comment flags this as a cost risk. Always cap before iterating.
4. **Bespoke scenario story cycles** (`agot_story_cycle_scenario_roberts_rebellion.txt` etc.):
   canon-timeline machines with no additive analog.
5. **Unbounded AI-offered hostile interactions**: goad is fine only because
   `ai_targets = { ... max = 3 }` bounds it; always set `max` and prefer `ai_target_quick_trigger`
   as a cheap pre-filter before an expensive `is_shown`.
6. **Per-year artifact re-equip sweeps** (archmaester regalia): model persistent gear as
   traits/modifiers instead of artifacts needing maintenance loops.
