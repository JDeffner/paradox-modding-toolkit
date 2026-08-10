# Modifying Culture and Religion — Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
Cultures are defined in `common/culture/cultures/` and religions in `common/religion/religion_types/`. Both use a hierarchical structure: culture groups contain cultures, religion families contain religions which contain faiths.

## Minimal Template — New Culture

### common/culture/cultures/my_cultures.txt
```
my_culture_group = {
	graphical_cultures = {
		western_coa_gfx
		western_clothing_gfx
		western_unit_gfx
	}

	my_custom_culture = {
		color = { 0.5 0.2 0.8 }
		heritage = heritage_west_germanic

		ethos = ethos_bellicose

		martial_custom = martial_custom_male_only

		traditions = {
			tradition_warriors
		}

		language = language_germanic
		name_list = name_list_german

		coa_gfx = { western_coa_gfx }
		building_gfx = { western_building_gfx }
		clothing_gfx = { western_clothing_gfx }
		unit_gfx = { western_unit_gfx }

		male_names = {
			10 = { Karl Heinrich Friedrich Wilhelm }
			1 = { Albrecht Siegfried }
		}
		female_names = {
			10 = { Anna Maria Elisabeth }
		}
	}
}
```

## Minimal Template — New Faith

### common/religion/religion_types/my_religion.txt
```
my_religion = {
	family = rf_pagan
	graphical_faith = pagan_gfx

	doctrine = pagan_hostility_doctrine
	pagan_roots = yes

	# Core doctrines
	doctrine = doctrine_no_head
	doctrine = doctrine_gender_male_dominated
	doctrine = doctrine_pluralism_pluralistic
	doctrine = doctrine_theocracy_lay_clergy

	# Marriage doctrines
	doctrine = doctrine_concubines
	doctrine = doctrine_divorce_allowed
	doctrine = doctrine_bastardry_legitimization
	doctrine = doctrine_consanguinity_cousins

	# Crime doctrines
	doctrine = doctrine_homosexuality_accepted
	doctrine = doctrine_adultery_men_shunned
	doctrine = doctrine_adultery_women_shunned
	doctrine = doctrine_kinslaying_shunned
	doctrine = doctrine_deviancy_accepted
	doctrine = doctrine_witchcraft_accepted

	# Clergy doctrines
	doctrine = doctrine_clerical_function_alms_and_pacification
	doctrine = doctrine_clerical_gender_either
	doctrine = doctrine_clerical_marriage_allowed
	doctrine = doctrine_clerical_succession_spiritual_appointment

	traits = {
		virtues = { brave generous just }
		sins = { craven greedy arbitrary }
	}

	faiths = {
		my_custom_faith = {
			color = { 0.8 0.3 0.1 }
			icon = custom_faith_1

			holy_site = jerusalem
			holy_site = mecca
			holy_site = rome
			holy_site = constantinople
			holy_site = alexandria

			doctrine = tenet_monasticism
			doctrine = tenet_mendicant_preachers
			doctrine = tenet_communal_identity
		}
	}
}
```

### Localization
```
l_english:
 my_religion: "My Religion"
 my_religion_desc: "Description of the religion."
 my_religion_adj: "My-Religion"
 my_religion_adherent: "Follower"
 my_religion_adherent_plural: "Followers"
 my_custom_faith: "My Faith"
 my_custom_faith_desc: "Description of this faith."
 my_custom_culture: "My Culture"
```

## Common Variants

### Adding a new faith to an existing religion
Create a new file — do NOT copy the entire vanilla religion file. Define only the faith within the religion block:
```
# common/religion/religion_types/my_new_faith.txt
christianity_religion = {
	faiths = {
		my_heresy = {
			color = { 0.6 0.1 0.1 }
			icon = custom_faith_2
			reformed_icon = custom_faith_2

			holy_site = rome
			holy_site = jerusalem
			holy_site = canterbury
			holy_site = cologne
			holy_site = santiago

			doctrine = tenet_pacifism
			doctrine = tenet_monasticism
			doctrine = tenet_communal_identity
		}
	}
}
```

### Adding innovations to a culture
Innovations (eras) are in `common/culture/innovations/`:
```
innovation_my_technique = {
	group = culture_group_military
	culture_era = culture_era_tribal

	modifier = {
		heavy_infantry_damage_mult = 0.1
	}

	flag = global_military
}
```

## Checklist
- [ ] Culture file in `common/culture/cultures/`
- [ ] Religion file in `common/religion/religion_types/`
- [ ] Localization for all names, descriptions, adherent names
- [ ] At least 5 holy sites for each faith
- [ ] All required doctrine categories filled (gender, marriage, crimes, clergy)
- [ ] Graphical culture references point to existing GFX definitions

## Common Pitfalls
- **Missing doctrines**: Each faith needs doctrines in all required categories. Missing ones cause errors
- **Holy site keys**: Holy sites reference baronies, not provinces or counties. Check vanilla for valid keys
- **Religion family**: Must reference an existing family from `common/religion/religion_family_types/`
- **Culture heritage**: Must reference an existing heritage. Check vanilla for valid heritage keys
- **Adding to existing**: When adding a faith to an existing religion, you can define just the faith in a new file — you don't need to copy the entire religion
