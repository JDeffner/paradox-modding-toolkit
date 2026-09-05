# Laws, interest groups, movements, diplomacy, power blocs

- [Laws and law groups](#laws-and-law-groups)
- [Interest groups](#interest-groups)
- [Political movements and lobbies](#political-movements-and-lobbies)
- [Diplomatic plays and war goals](#diplomatic-plays-and-war-goals)
- [Power blocs](#power-blocs)
- [Subject types](#subject-types)
- [Pitfalls](#pitfalls)

Several folders in this area ship **no** schema doc, so vanilla is the reference. Check which
before you start:

```bash
python scripts/vic3_docs.py folders law
python scripts/vic3_docs.py folders interest
```

## Laws and law groups

`common/laws/` (26 files) and `common/law_groups/` (1 file). `common/laws/readme.md` exists but
documents only `ai_enact_weight_modifier`, `can_impose` and `on_impose`, not the law entry as a
whole. `law_groups` is undocumented. Read `common/law_groups/00_laws.txt`, whose header comments
carry the group schema:

```
lawgroup_governance_principles = {
    law_group_category = power_structure
    base_enactment_days = 200
    enactment_approval_mult = 2.0
    ideological_opinion_impact = 2.0
    affected_by_regime_change = yes
    change_allowed_trigger = { ... }
}
```

A law points back at its group:

```
law_peasant_levies = {
    group = lawgroup_army_model
    icon = "..."
    progressiveness = -50
    modifier = { country_can_only_conscript_peasants_bool = yes }
    can_impose = { ... }
    is_visible = { ... }
    on_enact = { custom_tooltip = QUALIFICATIONS_OFFICERS_PEASANT_LEVIES_DESC }
    ai_will_do = { always = no }
}
```

Cross-links: `group` into `common/law_groups/`, every `modifier` key into
`common/modifier_type_definitions/` (verify with `vic3_docs.py find`), and `can_impose` uses
`scope:target_country` and `scope:law`.

Laws are addressed elsewhere in script as `law_type:law_peasant_levies`, which is the fourth most
common database prefix in the game.

## Interest groups

`common/interest_groups/` (8 files), **undocumented**. Read `00_armed_forces.txt`:

```
ig_armed_forces = {
    color = hsv{ 0.09 0.29 0.39 }
    texture = "..."
    layer = "revolution_dynamic_armed_forces"
    index = 0
    ideologies = { ideology_jingoist ideology_loyalist ideology_patriotic }
    character_ideologies = { ideology_moderate ideology_authoritarian }
    enable = { always = yes }
    on_enable = {
        ig:ig_armed_forces ?= { set_ig_trait = ig_trait:ig_trait_newly_created_army }
    }
}
```

**The `traits = { }` block is deprecated**, and vanilla says so in an in-file comment while still
carrying one. Assign traits through `on_enable` with `set_ig_trait` instead.

Cross-links into `common/ideologies/` (6 files) and `common/interest_group_traits/` (8 files).
Interest groups are addressed as `ig:ig_armed_forces` and traits as `ig_trait:<key>`.

## Political movements and lobbies

`common/political_movements/` (8 files) and `common/political_lobbies/` (2 files), both
documented, along with `political_movement_categories`, `political_movement_pop_support`, and
`political_lobby_appeasement`.

`political_movement` is a scope type in its own right, so movements can carry triggers, effects,
and scripted GUIs the same way countries do.

Community Mod Framework's use of `REPLACE:movement_pro_slavery = { ... }` in
`common/political_movements/` is the reference example for patching one movement without copying
the whole vanilla file. See [setup.md](setup.md).

## Diplomatic plays and war goals

`common/diplomatic_plays/` (2 files), documented. The key coupling is
`war_goal = <war goal type>`, pointing into `common/war_goal_types/` (35 files, documented).

Other fields: `requires_interest_marker` (default yes), `enable_switch_sides`,
`allow_negotiated_peace`, `mirror_war_goal`, `initiator_can_add_war_goals`,
`target_can_add_war_goals`, the `add_infamy_for_starting_*_wargoals` pair, `ai_acceptance_max`,
`is_epic`, `selectable_in_lens`, `possible`, `on_weekly_pulse`, `on_war_begins`, `on_war_end`,
`on_demand_accepted` (root is the initiator), and `on_demand_rejected`.

Related folders: `common/diplomatic_actions/` (49 files, documented),
`common/diplomatic_catalysts/`, `common/treaty_articles/` (35 files, documented, and its doc is
the largest in the game at 25 KB).

## Power blocs

`common/power_bloc_principles/` (documented), grouped by
`common/power_bloc_principle_groups/`, plus `power_bloc_identities` and `power_bloc_names`.

A principle carries `visible`, `possible`, `incompatible_with` (repeatable), `icon`,
`background`, and four modifier buckets: `power_bloc_modifier`, `participant_modifier`,
`leader_modifier`, `member_modifier`. It may name an `institution` from `common/institutions/`
along with an `institution_modifier`.

Principles are referenced back from production methods via `unlocking_principles`, which is the
main way a power bloc changes the economy. Addressed in script as `principle:<key>`.

## Subject types

`common/subject_types/` (1 file), **undocumented**, and unusually cross-referential. From
`00_subject_types.txt`:

```
subject_type_protectorate = {
    diplomatic_action = protectorate
    autonomy_level = 2
    category = same_as_puppet
    lower_autonomy_subject_type_alternatives = { subject_type_puppet subject_type_colony }
    same_autonomy_subject_type_alternatives = { subject_type_tributary subject_type_dominion }
    valid_overlord_country_types = { recognized colonial company }
    valid_subject_country_types = { recognized unrecognized }
    valid_overlord_ranks = { great_power major_power minor_power }
    valid_subject_ranks = { minor_power insignificant_power unrecognized_regional_power unrecognized_power }
}
```

Every one of those lists points at another database: `common/diplomatic_actions/`,
`common/country_types/`, `common/country_ranks/`, and other subject types. Adding a subject type
means updating the alternative lists on the existing types too, or it is unreachable.

## Pitfalls

| Symptom | Cause |
|---|---|
| A law never appears | `is_visible` fails, or `group` names a law group that does not exist |
| A law's modifier does nothing | The modifier key is not real; check with `vic3_docs.py find` |
| Interest group traits do not apply | Assigned through the deprecated `traits = { }` instead of `on_enable` + `set_ig_trait` |
| A new subject type is never offered | Not listed in the alternatives of any existing subject type, or the rank and country-type lists exclude every real case |
| A diplomatic play does nothing | `war_goal` names a war goal type that does not exist |
| A principle does not change production | Production methods were never updated to name it in `unlocking_principles` |
| Patching a vanilla movement broke other mods | A whole vanilla file was copied instead of using `REPLACE:` on the one object |
