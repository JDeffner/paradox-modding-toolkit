# The Victoria 3 economy: buildings, production methods, goods, pops

- [The chain](#the-chain)
- [Buildings](#buildings)
- [Production method groups](#production-method-groups)
- [Production methods](#production-methods)
- [Goods](#goods)
- [Pop types](#pop-types)
- [Technology](#technology)
- [Companies](#companies)
- [State traits](#state-traits)
- [Pitfalls](#pitfalls)

The economy is Victoria 3's core and its most cross-linked system. Character and dynasty content,
central in CK3, is minor here. Most silent breakage in a Victoria 3 mod happens somewhere along
the chain below.

## The chain

```
building  ->  production_method_group  ->  production_method  ->  goods
   |                                             |
   +-> building_group                            +-> laws, technologies, principles
   +-> unlocking_technologies                    +-> pop types (employment)
   +-> terrain_manipulator
```

A building names production method **groups**, never production methods directly. Each group has
exactly one active method at a time. Methods name the goods they consume and produce, and the
modifiers they apply.

Schema docs exist for every link in this chain:

```bash
python scripts/vic3_docs.py folders production
```

## Buildings

`common/buildings/` (15 files), documented by `common/buildings/buildings.md`. Real vanilla
entry from `02_agro.txt`:

```
building_wheat_farm = {
    building_group = bg_staple_crops
    icon = "gfx/interface/icons/building_icons/wheat_farm.dds"
    city_type = farm
    levels_per_mesh = 50
    unlocking_technologies = { enclosure }
    production_method_groups = {
        pmg_base_building_wheat_farm
        pmg_secondary_building_wheat_farm
        pmg_harvesting_process_building_wheat_farm
    }
    required_construction = construction_cost_low
    terrain_manipulator = farmland_wheat
    ownership_type = self
    background = "..."
}
```

Common fields and their meaning are in the doc, which annotates each with a type, a default, and
the scope any trigger runs in: `buildable`, `expandable`, `downsizeable`, `unique`,
`has_max_level`, `port`, `company_headquarter`, `potential` (state scope), `possible` (state
scope), `can_build` (state scope), `should_auto_expand`, `economic_contribution`, `ai_value`.

Note the doc is not exhaustive. It describes `construction_points = int32` while vanilla uses the
symbolic `required_construction = construction_cost_low`. **On any disagreement, vanilla wins.**

## Production method groups

`common/production_method_groups/` (16 files), documented. A group is a list plus a texture:

```
pmg_base_building_wheat_farm = {
    texture = "..."
    production_methods = { pm_simple_farming pm_herring_meal_farming pm_soil_enriching_farming pm_fertilization pm_chemical_fertilizer }
}
```

Exactly one method in a group is active at any time. `is_default = yes` on a method picks the
starting one. **If no method is marked default, the first listed silently becomes the default.**

## Production methods

`common/production_methods/` (16 files), documented. A method carries:

- `required_input_goods` and its output goods, referencing `common/goods/`.
- Unlock gates: `unlocking_technologies`, `unlocking_laws`, `unlocking_principles`,
  `unlocking_identity`, and `unlocking_production_methods`.
- Modifier blocks in three target buckets: `country_modifiers`, `state_modifiers`,
  `building_modifiers`.
- Three scalings inside those buckets: `workforce_scaled`, `level_scaled`, `unscaled`.

Two constraints from the doc that fail quietly:

1. **A method's key must be unique per building, not globally**, and
   `unlocking_production_methods` entries must refer to methods on the *same* building.
   Referencing another building's method fails with no error.
2. **Choosing the wrong modifier bucket or the wrong scaling parses fine and does the wrong
   thing.** `workforce_scaled` scales with employed pops, `level_scaled` with building level,
   `unscaled` not at all. There is no diagnostic for picking the wrong one.

Verify every modifier key you write:

```bash
python scripts/vic3_docs.py find building_throughput_add
```

Modifiers come in three tiers. Static and dynamic modifiers carry a display name. "Potential
dynamic" modifiers are combinatorial keys the engine accepts only when the content they are
built from exists, and they have no display name. The script labels the tier and warns on the
last one, which is a good way to write a modifier that silently does nothing.

## Goods

`common/goods/` (2 files), documented. Small and simple:

```
ammunition = {
    texture = "gfx/interface/icons/goods_icons/ammunition.dds"
    cost = 50
    category = military
    prestige_factor = 5
    traded_quantity = 5
}
```

`category` is one of `military`, `staple`, `industrial`, `luxury`. Flags `tradeable`, `local`
and `fixed_price` default to yes, no, no.

Adding a good means touching every production method that should use it, plus pop needs if it is
consumed. A good nothing produces and nothing consumes is inert.

## Pop types

`common/pop_types/` (16 files), documented. Fields cover employment and politics:
`working_adult_ratio`, `start_quality_of_life`, `wage_weight`, `paid_private_wage`,
`literacy_target`, `consumption_mult`, `dependent_wage`, `unemployment`, `unemployment_wealth`,
`political_engagement_base`, `political_engagement_literacy_factor`, `political_engagement_mult`,
`qualifications`, and portrait fields.

**Every pop type needs a `<POP_TYPE>_QUALIFICATIONS_DESC` localization key.** The doc states this
outright, and the game shows a raw key without it.

The doc has at least one wrong comment (`literacy_target` is annotated "wage for dependents"), so
read the field name, not only the comment.

## Technology

`common/technology/` holds `eras/`, `technologies/`, and three loose files
(`10_production.txt`, `20_military.txt`, `30_society.txt`). Only eras are documented:

```
era_1 = { #Pre-1836
    technology_cost = 7500
}
```

Technologies are referenced from buildings and production methods as
`unlocking_technologies = { <key> }`, with **bare identifiers**. Note that
`common/state_traits/` quotes them instead (`disabling_technologies = { "quinine" }`). Match the
surrounding file's convention rather than assuming one.

## Companies

`common/company_types/` (23 files), documented by `companies.md`. Companies gate visibility
through three triggers evaluated in order: `potential`, then `attainable`, then `possible`. A
company failing the first is hidden; failing a later one shows it as a prospect.

Cross-links: `building_types` and `extension_building_types` into `common/buildings/`,
`possible_prestige_goods` into `common/prestige_goods/`, `replaces_company`, and
`can_establish_in` (state scope).

Two documented traps, both quoted in the doc:

- An **empty `state_trigger`** inside `ai_construction_targets` does nothing at all, rather than
  matching everything.
- A company with **no `ai_will_do`** is never founded by the AI.

## State traits

`common/state_traits/` (13 files), undocumented, so read vanilla:

```
state_trait_malaria = {
    icon = "..."
    disabling_technologies = { "quinine" }
    modifier = {
        state_non_homeland_colony_growth_speed_mult = -0.9
        state_non_homeland_mortality_mult = 0.15
    }
}
```

Traits attach to state regions defined in `map_data/state_regions/`, which has its own schema doc.

## Pitfalls

| Symptom | Cause |
|---|---|
| A building exists but produces nothing | Its production method group has no active method, or the group is not listed on the building |
| A production method's bonus does nothing | Wrong modifier bucket or wrong scaling |
| A production method never unlocks | `unlocking_production_methods` names a method on another building |
| A modifier parses but has no effect | It is a "potential dynamic" key with no display name |
| A new good does nothing | No production method consumes or produces it |
| A pop type shows a raw key in the UI | Missing `<POP_TYPE>_QUALIFICATIONS_DESC` |
| A group starts on the wrong method | No `is_default = yes`, so the first listed won |
| The AI never builds a new company | No `ai_will_do`, or an empty `state_trigger` |
