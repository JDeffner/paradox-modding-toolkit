# Great Projects

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
- Great Projects are large-scale construction endeavors (wonders, monuments, campaigns) that characters plan, fund, and build over time. Added in the Roads to Power / Tides of Power DLC era.
- Defined in `common/great_projects/types/` as `.txt` files.
- A great project has a **planning phase** (founder commits initial cost), a **funding phase** (contributions are funded by the owner and optionally by vassals/allies/tributaries), and a **construction phase** (time passes until completion).
- Each project has **contributions** -- individual sub-items that need funding. Contributions can be required or optional. All required contributions must be funded before construction begins.
- `owner` determines who controls the project. Options: `province_owner`, `province_owner_top_liege`, `founder_primary_title_owner`, `founder_top_liege_title_owner`.
- `province_filter` controls which provinces appear as valid locations during planning (same rules as Activities).
- `group` controls UI presentation: `major_project`, `minor_project`, or `environmental_project` (hides owner portrait).

### Localization Keys
- **Project type name**: `great_project_type_<key>`
- **Project type tooltip**: `great_project_type_tooltip_<key>`
- **Ongoing project name** (default): `great_project_name` -- override with `great_project_name_<key>`
- **Ongoing project possessive** (default): `great_project_name_possessive` -- override with `great_project_name_possessive_<key>`
- **Contribution name**: `great_project_type_<project_key>_contribution_<contribution_key>`
- **Contribution desc**: `great_project_type_<project_key>_contribution_<contribution_key>_desc`
- **Ongoing contribution name** (default): `great_project_contribution_name` -- override with `great_project_<project_key>_contribution_name_<contribution_key>`

### Scope Reference
Most triggers and effects receive:
- `root` = the great project itself (or the character in `can_start_planning`/`is_shown`)
- `scope:province` = province where the project is located
- `scope:great_project` = the project (null before planning phase in contributions)
- `scope:owner` = the character who currently owns the project
- `scope:founder` = the character who originally planned the project

## Minimal Template

```
# common/great_projects/types/my_great_projects.txt

my_grand_monument = {
    # --- Visuals ---
    icon = {
        reference = "gfx/interface/icons/great_projects/my_monument.dds"
    }
    illustration = {
        reference = "gfx/interface/illustrations/great_projects/my_monument.dds"
    }

    # --- Display name (trigger list, last entry is fallback) ---
    name = {
        desc = great_project_type_my_grand_monument
    }

    # --- Visibility & eligibility ---
    is_shown = {
        highest_held_title_tier >= tier_duchy
    }

    can_start_planning = {
        is_independent_ruler = yes
        gold >= 500
        NOT = { is_planning_great_project = my_grand_monument }
    }

    # Province selection
    province_filter = capital    # capital, realm, domain, etc.

    is_location_valid = {
        # Province-specific checks
        scope:province = {
            has_building_with_flag = castle_building
        }
    }

    # --- Ownership ---
    owner = province_owner_top_liege

    # --- Validity (checked while ongoing; if false, project is invalidated) ---
    is_valid = {
        scope:owner = { is_alive = yes }
    }

    # --- Cost to start planning ---
    cost = {
        gold = 500
        prestige = 200
    }

    # --- Construction ---
    construction_time = 1825    # days (~5 years). Supports scripted values.
    contribution_threshold = 50  # % progress after which optional contributions lock out
    contributor_cooldown = 21    # days before non-founders can start contributing

    # --- Lifecycle effects ---
    on_plan_build = {
        # Fires when planning begins (project funded, contributions not yet funded)
    }
    on_start_build = {
        # Fires when construction starts (all required contributions funded)
        scope:owner = {
            add_prestige = minor_prestige_value
        }
    }
    on_complete = {
        # Fires when construction finishes
        scope:province = {
            # e.g. add a special building
            # set_great_building = my_monument_building
        }
        scope:owner = {
            add_prestige = major_prestige_value
        }
    }
    on_cancel = {
        scope:owner = {
            add_prestige = minor_prestige_loss
        }
    }
    on_invalidated = {
        # Fires right before on_cancel when is_valid fails
    }

    # --- Who can contribute ---
    allowed_contributor_filter = {
        owner = yes
        vassals = yes
    }

    # --- Contributions ---
    project_contributions = {

        # A required contribution (must be funded for construction to start)
        stone_materials = {
            contributor_is_valid = {
                highest_held_title_tier > tier_barony
            }

            cost = {
                gold = 200
            }

            contributor_cooldown = 300  # days before same character can fund another contribution

            is_required = yes   # default

            on_contribution_funded = {
                # Fires immediately when this contribution is funded
            }
            on_complete = {
                # Fires when the entire project completes
            }

            ai_check_interval_by_tier = {
                barony = 0
                county = 12
                duchy = 6
                kingdom = 3
                empire = 3
                hegemony = 3
            }
            ai_will_do = {
                value = 100
            }
        }

        # An optional contribution (enhances the project but not required)
        decorative_carvings = {
            is_required = no

            contributor_is_valid = {
                highest_held_title_tier > tier_barony
            }

            cost = {
                gold = 100
                prestige = 50
            }

            contributor_cooldown = 300

            on_complete = {
                # Extra rewards if this optional contribution was funded
            }

            ai_check_interval_by_tier = {
                barony = 0
                county = 12
                duchy = 12
                kingdom = 6
                empire = 6
                hegemony = 6
            }
            ai_will_do = {
                value = 50
            }
        }
    }

    # --- AI behavior (project-level) ---
    ai_target_quick_trigger = {
        adult = yes
        rank = duchy    # minimum title tier to consider
        # government_type = { feudal_government }  # optional filter
    }
    ai_check_interval_by_tier = {
        barony = 0
        county = 10
        duchy = 3
        kingdom = 1
        empire = 1
        hegemony = 1
    }
    ai_will_do = {
        value = 100
    }

    # --- GUI settings ---
    is_important = yes           # special notifications (default no)
    show_in_list = yes           # show in Great Projects list (default yes)
    group = major_project        # major_project, minor_project, environmental_project
    target_title_tier = barony   # tier highlighted on map in planning mode

    completion_sound_effect = "event:/SFX/some_sound"
}
```

### Localization File

```
# localization/english/great_projects/my_great_projects_l_english.yml
l_english:
 great_project_type_my_grand_monument: "Grand Monument"
 great_project_type_tooltip_my_grand_monument: "Construct a grand monument in your capital."
 great_project_name_my_grand_monument: "[CHARACTER.GetName]'s Grand Monument"
 great_project_name_possessive_my_grand_monument: "[CHARACTER.GetName]'s Grand Monument's"
 great_project_type_my_grand_monument_contribution_stone_materials: "Stone Materials"
 great_project_type_my_grand_monument_contribution_stone_materials_desc: "Quarried stone for the monument's foundations."
 great_project_type_my_grand_monument_contribution_decorative_carvings: "Decorative Carvings"
 great_project_type_my_grand_monument_contribution_decorative_carvings_desc: "Ornamental carvings to adorn the monument."
```

## Common Variants

### Trigger-Based Illustrations (regional variation)
```
illustration = {
    trigger = {
        scope:province ?= {
            geographical_region = world_asia
        }
    }
    reference = "gfx/interface/illustrations/great_projects/monument_asia.dds"
}
illustration = {
    # Fallback (no trigger = always matches)
    reference = "gfx/interface/illustrations/great_projects/monument_default.dds"
}
```

### Trigger-Based Names
```
name = {
    trigger = {
        scope:province ?= {
            terrain = mountains
        }
    }
    desc = great_project_type_mountain_fortress
}
name = {
    desc = great_project_type_my_grand_monument   # fallback
}
```

### Owner-Only Contribution (no vassals allowed)
```
sacred_consecration = {
    allowed_contributor_filter = {
        owner = yes
    }
    contributor_is_valid = {
        piety_level >= high_piety_level
    }
    cost = {}   # no currency cost, just meeting the trigger
    is_required = yes

    ai_will_do = { value = 1000 }
    ai_check_interval_by_tier = {
        barony = 0
        county = 3
        duchy = 3
        kingdom = 3
        empire = 3
        hegemony = 3
    }
}
```

### Environmental / System-Spawned Project (not player-initiated)
```
great_project_disaster_relief = {
    # Players cannot plan or cancel this -- it is spawned by events
    can_start_planning = { always = no }
    can_cancel = { always = no }

    is_valid = {
        exists = var:situation   # tied to a situation
    }

    construction_time = 60
    group = environmental_project   # hides owner portrait
    # ...
}
```

### Contribution with show_in_planning_phase
```
secret_chamber = {
    is_required = no
    show_in_planning_phase = no   # hidden until funding phase begins
    # ...
}
```

### Different Contributor Filters at Contribution Level
```
allied_support = {
    allowed_contributor_filter = {
        allies = yes
    }
    # Overrides the project-level filter for this specific contribution
}
```

## Checklist

### Files to create or modify:
1. `common/great_projects/types/my_great_projects.txt` -- project definition with contributions
2. `localization/english/great_projects/my_great_projects_l_english.yml` -- all loc keys
3. Icon image at the path specified in `icon.reference` (DDS format, placed in `gfx/interface/icons/great_projects/`)
4. Illustration image at the path specified in `illustration.reference` (DDS format, placed in `gfx/interface/illustrations/great_projects/`)
5. (Optional) Events triggered by `on_complete`, `on_cancel`, etc. in `events/`
6. (Optional) Scripted effects/triggers in `common/scripted_effects/` and `common/scripted_triggers/` for reuse

### Validation checks:
- [ ] At least one `project_contributions` entry exists (minimum 1 required)
- [ ] At least one contribution has `is_required = yes` (or uses default, which is yes)
- [ ] `province_filter` is set appropriately (capital, realm, domain, etc.)
- [ ] `owner` type is set (province_owner, province_owner_top_liege, etc.)
- [ ] `construction_time` is defined (in days)
- [ ] `cost` block is present (even if empty for system-spawned projects)
- [ ] All `ai_check_interval_by_tier` blocks define all six tiers: barony, county, duchy, kingdom, empire, hegemony
- [ ] `ai_target_quick_trigger` is defined with at minimum `adult`, `rank`
- [ ] Loc keys exist for project type name, tooltip, and each contribution name + desc
- [ ] `is_shown` prevents the project from appearing when it shouldn't (e.g., already planning, wrong government)
- [ ] `can_start_planning` includes `NOT = { is_planning_great_project = <key> }` to prevent duplicates
- [ ] `is_valid` checks are meaningful (what invalidates an ongoing project?)
- [ ] Icon and illustration image files exist at the referenced paths

## Common Pitfalls

1. **Missing contribution**: Every great project must have at least one entry in `project_contributions`. A project with zero contributions will not function.

2. **Forgetting `is_planning_great_project` guard**: If you do not check `NOT = { is_planning_great_project = my_project }` in both `is_shown` and `can_start_planning`, the player can start multiple instances of the same project.

3. **Incomplete `ai_check_interval_by_tier`**: All six tiers (barony, county, duchy, kingdom, empire, hegemony) must be defined. Missing a tier causes errors. Set tiers to `0` to exclude them.

4. **Confusing project-level vs contribution-level AI**: The project has its own `ai_will_do` and `ai_check_interval_by_tier` (controls whether AI starts the project). Each contribution also has its own (controls whether AI funds that contribution). Both need to be set.

5. **`ai_check_interval` units differ**: At the project level, `ai_check_interval` and `ai_check_interval_by_tier` are in **years**. At the contribution level, they are in **months**. Mixing these up causes AI to check far too often or too rarely.

6. **Wrong scope in `can_start_planning`**: In `can_start_planning`, `root` is the **character** planning the project, not the project itself. In `is_valid` and lifecycle effects, `root` is the **project** and the character is `scope:owner`.

7. **Optional contributions after threshold**: Optional contributions (`is_required = no`) cannot be funded after the `contribution_threshold` percentage of progress is reached. If you set this too low, optional contributions become nearly impossible to fund.

8. **Loc key pattern mismatch**: The contribution loc key pattern is `great_project_type_<PROJECT>_contribution_<CONTRIBUTION>` -- note `great_project_type_` prefix includes `_type_`, not just `great_project_`. Missing this prefix causes raw key display.

9. **`contributor_cooldown` vs `construction_time`**: The `contributor_cooldown` at the project level controls how long non-founders must wait before they can start funding any contributions (giving the founder a head start). The per-contribution `contributor_cooldown` controls how long after funding one contribution before the same character can fund another on the same project.

10. **Missing `on_cancel` cleanup for contributors**: When a project is cancelled, contributors who funded contributions get nothing. Vanilla handles this by iterating `every_contribution` and applying opinion penalties. Forgetting this makes cancellation feel consequence-free.

11. **`owner` type mismatch with `province_filter`**: If `province_filter = capital` but `owner = province_owner_top_liege`, ownership transfers to the top liege, which may not be the founder. Make sure the ownership model matches your design intent.

12. **Image paths**: Icon images go in `gfx/interface/icons/great_projects/` and illustration images go in `gfx/interface/illustrations/great_projects/` (or similar). Use DDS format. Missing images cause blank UI elements, not errors.
