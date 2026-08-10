# Triggers list

> **Main article:** [Triggers](Triggers.md)


`/Crusader Kings III/game/triggers.log` is a documentation provided by the game, which contains all code triggers that can be used.

You can dump it locally on your computer by using the console command ``script_docs`` which will create it in `Documents/Paradox Interactive/Crusader Kings III/logs/`

The file needs to be generated again after each major patch to get the latest version.

The list is transcribed here, but be aware that it is outdated.
Some triggers have been deprecated, and some triggers added after launch are missing.


| **Name** | **Description** | **Usage** | **Traits** | **Supported Scopes** | **Supported Targets** |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| all_court_artifact_slots | check if all the scoped characters court artifact slots are empty or full |  |  | character |  |  |  |
| all_inventory_artifact_slots | check if all the scoped characters inventory artifact slots are empty or full |  |  | character |  |  |  |
| amenity_level | Compares the scoped character's amenity level in the given type to the given value | <code style="white-space: pre">amenity_level = { target = court_food_quality value &gt; 2 }<br>(It is "target" instead of "type" hereafter. "type" has been decommissioned.)</code> |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| any_artifact | Iterate through all existing artifacts | `any_artifact = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | none | artifact |  |  |
| any_artifact_claimant | Iterate through all characters with a claim on the scoped artifact | `any_artifact_claimant = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | artifact | character |  |  |
| any_artifact_house_claimant | Iterate through all dynasty houses with a claim on the scoped artifact | `any_artifact_house_claimant = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | artifact | dynasty house |  |  |
| any_character_artifact | Iterate through all artifacts in a given characters inventory | `any_character_artifact = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | character | artifact |  |  |
| any_character_struggle | Iterate through all struggles that character is involved in. Optional: Narrow down the involvement status *_character_struggle = { involvement = involved \| interloper } | `any_character_struggle = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | character | struggle |  |  |
| any_character_with_royal_court | Iterate through all characters with a royal court | `any_character_with_royal_court = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | none | character |  |  |
| any_claimed_artifact | Iterate through all claimed artifacts of the scoped character | `any_claimed_artifact = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | character | artifact |  |  |
| any_controlled_faith | Iterate through all faiths headed by a title | `any_controlled_faith = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | landed title | faith |  |  |
| any_county_struggle | Iterate through all struggles that a county is involved in. | `any_county_struggle = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | landed title | struggle |  |  |
| any_court_position_employer | Iterates through all characters that employ the scoped character in any court position. | `any_court_position_employer = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | character | character |  |  |
| any_court_position_holder | Iterates through all characters employed by the scoped character in the target court position. | `any_court_position_holder = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | character | character |  |  |
| any_culture_county | Iterate through all counties of the culture | `any_culture_county = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | culture | landed title |  |  |
| any_culture_duchy | Iterate through all duchies of the culture (duchies with at least one county of the culture | `any_culture_duchy = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | culture | landed title |  |  |
| any_culture_empire | Iterate through all empires of the culture (empires with at least one county of the culture | `any_culture_empire = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | culture | landed title |  |  |
| any_culture_global | Iterate through all cultures in the game | `any_culture_global = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | none | culture |  |  |
| any_culture_kingdom | Iterate through all kingdoms of the culture (kingdoms with at least one county of the culture | `any_culture_kingdom = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | culture | landed title |  |  |
| any_de_jure_county | Iterate through all counties within this dejure title | `any_de_jure_county = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | landed title | landed title |  |  |
| any_direct_de_facto_vassal_title | Iterate through all de facto vassal titles | `any_direct_de_facto_vassal_title = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | landed title | landed title |  |  |
| any_direct_de_jure_vassal_title | Iterate through the all de jure vassals titles | `any_direct_de_jure_vassal_title = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | landed title | landed title |  |  |
| any_equipped_character_artifact | Iterate through all equipped artifacts in a given characters inventory | `any_equipped_character_artifact = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | character | artifact |  |  |
| any_faith_character | Iterate through characters of the scoped faith | `any_faith_character = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | faith | character |  |  |
| any_faith_playable_ruler | Iterate through playable rulers of the scoped faith | `any_faith_playable_ruler = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | faith | character |  |  |
| any_faith_ruler | Iterate through rulers of the scoped faith | `any_faith_ruler = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | faith | character |  |  |
| any_house_claimed_artifact | Iterate through all claimed artifacts of the scoped house | `any_house_claimed_artifact = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | dynasty house | artifact |  |  |
| any_inspiration | Iterate through all inspirations in the world | `any_inspiration = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | none | inspiration |  |  |
| any_inspired_character | Iterate through all characters with an inspirations in the world | `any_inspired_character = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | none | character |  |  |
| any_interloper_ruler | Iterate through all characters that are interloper in a struggle. | `any_interloper_ruler = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | struggle | character |  |  |
| any_involved_ruler | Iterate through all characters that are involved in a struggle. | `any_involved_ruler = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | struggle | character |  |  |
| any_killed_character | Iterate through all kills of a character | `any_killed_character = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | character, artifact | character |  |  |
| any_memory | Iterate through all memories of a character | `any_memory = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | character | character memory |  |  |
| any_memory_participant | Iterate through all participating character of a memory | `any_memory_participant = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | character memory | character |  |  |
| any_opposite_sex_spouse_candidate | Iterate through all the spouse candidates of the opposite sex of a character. | <code style="white-space: pre">WARNING: THIS IS VERY SLOW DO NOT DO IT OFTEN.<br>any_opposite_sex_spouse_candidate = { &lt;count=num/all&gt; / &lt;percent=fixed_point&gt; &lt;triggers&gt; }</code> |  | character | character |  |  |
| any_parent_culture | Iterate through all parent cultures | `any_parent_culture = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | culture | culture |  |  |
| any_parent_culture_or_above | Iterate through all parent cultures or above | `any_parent_culture_or_above = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | culture | culture |  |  |
| any_past_holder | Iterate through all past owners of a title from earliest to latest | `any_past_holder = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | landed title | character |  |  |
| any_past_holder_reversed | Iterate through all past owners of a title from latest to earliest | `any_past_holder_reversed = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | landed title | character |  |  |
| any_personal_claimed_artifact | Iterate through all personally claimed artifacts of the scoped character | `any_personal_claimed_artifact = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | character | artifact |  |  |
| any_played_character | Iterate through all characters the player playing this character has played. Matches the game over legacy, except for excluding the currently played character | `any_played_character = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | character | character |  |  |
| any_powerful_vassal | Iterate through the all powerful vassals of a character | `any_powerful_vassal = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | character | character |  |  |
| any_same_sex_spouse_candidate | Iterate through all the spouse candidates of the same sex of a character. | <code style="white-space: pre">WARNING: THIS IS VERY SLOW DO NOT DO IT OFTEN.<br>any_same_sex_spouse_candidate = { &lt;count=num/all&gt; / &lt;percent=fixed_point&gt; &lt;triggers&gt; }</code> |  | character | character |  |  |
| any_sponsored_inspiration | Iterate through all sponsored inspirations | `any_sponsored_inspiration = { <count=num/all> / <percent=fixed_point> <triggers> }` |  | character | inspiration |  |  |
| aptitude | What is the scoped character's aptitude in the target court position type? aptitude = { court_position = court_position_type value &gt;= 1 } |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| artifact_durability | does this artifact have the required durability? |  |  | artifact | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| artifact_max_durability | does this artifact have the required max durability? |  |  | artifact | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| artifact_slot_type | is the artifact of the given inventory slot type? |  |  | artifact |  |  |  |
| artifact_type | is the artifact of the given type? |  |  | artifact |  |  |  |
| average_amenity_level | average_amenity_level &gt;= 3 | `Compares the scoped character's average amenity level to the given value, you probably never want to check for direct equality since the average will be some decimal number` |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| base_inspiration_gold_cost | base_inspiration_gold_cost > 5 | `Gets the base gold cost of the scoped inspiration` |  | inspiration | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| can_be_claimed_by | Can the scoped artifact be claimed by the given character? |  |  | artifact | character |  |  |
| can_be_employed_as | can the scoped character be employed as target court position type? |  |  | character |  |  |  |
| can_benefit_from_artifact | Can the scoped character benefit from the main bonuses of this artifact? |  |  | character | artifact |  |  |
| can_declare_war | Can the scoped character declare war on the defender with the specified casus bellis on the defender character for the target titles with an optional claimant. can_declare_war = { defender = X casus_belli = Y target_titles = { Z } claimant = A } |  |  | character |  |  |  |
| can_disband_army | Can we disband this army? |  |  | army | yes/no |  |  |
| can_diverge | Can this ruler diverge their culture? Includes checking the cost |  |  | character | yes/no |  |  |
| can_diverge_excluding_cost | Can this ruler diverge their culture? Does not check the cost |  |  | character | yes/no |  |  |
| can_employ_court_position_type | can the scoped character employ the target court position type? |  |  | character |  |  |  |
| can_equip_artifact | Can the scoped character equip given artifact? |  |  | character | artifact |  |  |
| can_fire_position | Check if the scope task's councillor can be fired. Will check both can_fire and things like it being illegal to reassing the position | `scope:task = { position_can_be_fired = yes }` |  | council task | yes/no |  |  |
| can_hybridize | Can this ruler hybridize with the target culture? Includes checking the cost |  |  | character | culture |  |  |
| can_hybridize_excluding_cost | Can this ruler hybridize with the target culture? Does not check the cost |  |  | character | culture |  |  |
| can_sponsor_inspiration | can_sponsor_inspiration = inspiration | `Can the scoped character sponsor the target inspiration` |  | character | inspiration |  |  |
| category | is the scoped artifact of given category? |  |  | artifact |  |  |  |
| court_grandeur_base | Gets the base court grandeur value for a character, always NRoyalCourt::COURT_GRANDEUR_MIN for those without one |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| court_grandeur_current | Gets the current court grandeur value for a character, always NRoyalCourt::COURT_GRANDEUR_MIN for those without one |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| court_grandeur_current_level | Gets the current court grandeur level for a character, always 0 for those without one |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| court_grandeur_minimum_expected | Gets the minimum expected court grandeur value for a character, always NRoyalCourt::COURT_GRANDEUR_MIN for those without one |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| court_grandeur_minimum_expected_level | Gets the minimum expected court grandeur level for a character, always 0 for those without one |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| court_positions_currently_available | How many court positions the scope character CAN currently employs |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| court_positions_currently_filled | How many court positions the scope character currently employs |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| cultural_acceptance | The cultural acceptance of the scoped culture with the target culture | `cultural_acceptance = { target = culture value > 50 }` |  | culture | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| culture_age | Checks the age of the scope culture in years. If the culture has no creation date set, this will simply return the current year | `culture_age >= 200` |  | culture | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| culture_number_of_counties | How many counties are there of this culture? | `culture_number_of_counties > 10` |  | culture | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| culture_overlaps_geographical_region | Checks if any county with this culture is in the given geographical region |  |  | culture |  |  |  |
| current_day | Compare the current ingame day [1, 31] |  |  | none | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| current_military_strength | Is the scoped character's current military strength this big? |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| current_year | Compare the current ingame year |  |  | none | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| days_as_ruler | Number of days this character has been a ruler, returns -1 if character isn't a ruler |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| days_since_creation | Gets the days since creation of the scoped inspiration | `days_since_creation > 5` |  | inspiration | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| days_since_death | number of days since the character has died. |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| days_since_joined_court | Gets the days since scoped character joined their current court | `days_since_joined_court > 5` |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| days_since_sponsorship | Gets the days since sponsorship started of the scoped inspiration | `days_since_sponsorship > 5` |  | inspiration | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| debt_level | Is the scoped character's debt level this value? -1 if not meeting any debt level threshold. 0 for the first one, and so on. Note that this might not match exactly with the modifier in effect as it calculates what the modifier will be now, and the character's actual modifier can lag behind |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| debug_log | Log whether the parent trigger succeeded or failed |  |  | none |  |  |  |
| debug_log_details | Log whether the parent trigger succeeded or failed. Log which children succeeded or failed |  |  | none |  |  |  |
| diplomacy_lifestyle_unlockable_perks | How many perks from this lifestyle can the character currently unlock? This checks that they have the parent perks, and that the can_be_picked is met. It doesn't check perk points |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| discontent_per_month | How much is the Faction's Discontent increasing each month? |  |  | faction | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| domain_size_excluding_grace_period | Is the scoped character's domain this big? Does not count titles currently in the grace period |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| dynasty_num_unlocked_perks | does the dynasty has the required number of unlocked dynasty perks? |  |  | dynasty | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| employs_court_position | is the scoped character employing a target court position type? |  |  | character |  |  |  |
| ep1_culture_legacy_track_perks | How many perks in the lifestyle does this dynasty have? |  |  | dynasty | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| fp1_adventure_legacy_track_perks | How many perks in the lifestyle does this dynasty have? |  |  | dynasty | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| fp1_pillage_legacy_track_perks | How many perks in the lifestyle does this dynasty have? |  |  | dynasty | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| fp2_coterie_legacy_track_perks | How many perks in the lifestyle does this dynasty have? |  |  | dynasty | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| fp2_urbanism_legacy_track_perks | How many perks in the lifestyle does this dynasty have? |  |  | dynasty | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| has_any_artifact | does the scoped character have any artifacts? |  |  | character | yes/no |  |  |
| has_any_artifact_claim | does the scoped character have any artifact claims at all? ( CHEAP ) |  |  | character | yes/no |  |  |
| has_any_court_position | does the scoped character have any court positions? |  |  | character | yes/no |  |  |
| has_any_unequipped_artifact | does the scoped character have any unequipped artifacts? |  |  | character | yes/no |  |  |
| has_artifact_claim | Does the scoped character have a personal or house claim on the target artifact |  |  | character | artifact |  |  |
| has_artifact_feature | Does the artifact have the given feature? | `has_artifact_feature = key` |  | artifact |  |  |  |
| has_artifact_feature_group | Does the artifact have the given feature group? | `has_artifact_feature_group = key` |  | artifact |  |  |  |
| has_artifact_modifier | Does the artifact have the given modifier? | `has_artifact_modifier  = key` |  | artifact |  |  |  |
| has_building_gfx | Does the culture have this building gfx? | `<culture> = { has_building_gfx = mena_building_gfx }` |  | culture |  |  |  |
| has_clothing_gfx | Does the culture have this clothing gfx? | `<culture> = { has_clothing_gfx = mena_clothing_gfx }` |  | culture |  |  |  |
| has_coa_gfx | Does the culture have this CoA gfx? | `<culture> = { has_coa_gfx = mena_coa_gfx }` |  | culture |  |  |  |
| has_completed_inspiration | Checks if the scoped character has ever completed an inspiration | `has_completed_inspiration = bool` |  | character | yes/no |  |  |
| has_court_language | Is the character's court language the given language? | `has_court_language = language_norwegian` |  | character |  |  |  |
| has_court_language_of_culture | Is the character's court language the language of the target culture? | `has_court_language_of_culture = scope:target_culture` |  | character | culture |  |  |
| has_court_position | is the scoped character holding the target court position type? |  |  | character |  |  |  |
| has_court_type | has_court_type = court_diplomatic | `Does the character have this court type?` |  | character |  |  |  |
| has_cultural_parameter | Does the culture have this cultural parameter? | `<culture> = { has_cultural_parameter = name }` |  | culture |  |  |  |
| has_cultural_pillar | Does the culture have this cultural pillar? | `<culture> = { has_cultural_pillar = name }` |  | culture |  |  |  |
| has_cultural_tradition | Does the culture have this cultural tradition? | `<culture> = { has_cultural_tradition = name }` |  | culture |  |  |  |
| has_dlc_feature | Does the host have DLC that enables this particular feature |  |  | none | Valid Features: garments_of_the_hre, fashion_of_the_abbasid_court, the_northern_lords, hybridize_culture, diverge_culture, royal_court, reform_culture, court_artifacts, the_fate_of_iberia, and friends_and_foes |  |  |
| has_employed_any_court_position | does the scoped character have any employed court positions? |  |  | character | yes/no |  |  |
| has_holding | does the scope province have holding? | `has_holding = yes` |  | province | yes/no |  |  |
| has_house_artifact_claim | Does the scoped dynasty house have a personal claim on the target artifact |  |  | dynasty house | artifact |  |  |
| has_innovation_flag | Has the culture discovered an innovation with this flag? has_innovation_flag = flag |  |  | culture |  |  |  |
| has_inspiration_type | has_inspiration_type = type | `Checks if the scoped inspiration has the given inspiration database type` |  | inspiration |  |  |  |
| has_local_player_open_court_event | Has the local player opened a court event in the royal court view? | `An interface trigger, can only be used in specific places` |  | none | yes/no |  |  |
| has_local_player_seen_unopened_court_event | Has the local player seen the unopened court event(s) waiting in the royal court view? | `An interface trigger, can only be used in specific places` |  | none | yes/no |  |  |
| has_local_player_unopened_court_event | Has the local player an unopened court event waiting in the royal court view? | `An interface trigger, can only be used in specific places` |  | none | yes/no |  |  |
| has_memory_category | Does the character memory have this memory category? | `has_memory_category = happy` |  | character memory |  |  |  |
| has_memory_participant | Does the character memory have this target character as a participant? | `has_memory_participant = character` |  | character memory | character |  |  |
| has_memory_type | Does the character memory have this memory type? | `has_memory_type = battle` |  | character memory |  |  |  |
| has_name_list | Does the culture have this name list? | `<culture> = { has_name_list = name }` |  | culture |  |  |  |
| has_outstanding_artifact_claims | does the scoped character have any artifact claims that can be pressed? ( EXPENSIVE ) |  |  | character | yes/no |  |  |
| has_pending_court_events | Does the character have pending court events? Meaning court events that'll spawn when they next open the royal court view. Can only be used on player characters with a royal court. | `has_pending_court_events = bool` |  | character | yes/no |  |  |
| has_personal_artifact_claim | Does the scoped character have a personal claim on the target artifact |  |  | character | artifact |  |  |
| has_primary_name_list | Does the culture have this name list as its first name list? | `<culture> = { has_primary_name_list = name }` |  | culture |  |  |  |
| has_prisoners | Does the character have prisoners? |  |  | character | yes/no |  |  |
| has_relation_antiquarian | Checks for a scripted relationship with a target character |  |  | character | character target |  |  |
| has_relation_to | does the character have a relation to the target? Matches the logic of the data system function HasRelationTo, has_relation_to = &lt;character&gt; |  |  | character | character |  |  |
| has_royal_court | has_royal_court = bool | `Does the scoped character have a royal court` |  | character | yes/no |  |  |
| has_same_court_language | Is the character's court language the same language as the target character's? | `has_same_court_language = scope:target_character` |  | character | character |  |  |
| has_same_court_type_as | has_same_court_type_as = character | `Does the character have the same court type as the target?` |  | character | character target |  |  |
| has_same_culture_ethos | Does the culture have the same ethos as the target? |  |  | culture | culture |  |  |
| has_same_culture_heritage | Does the culture have the same heritage as the target? |  |  | culture | culture |  |  |
| has_same_culture_language | Does the culture have the same language as the target? |  |  | culture | culture |  |  |
| has_same_culture_martial_tradition | Does the culture have the same martial tradition as the target? |  |  | culture | culture |  |  |
| has_same_sinful_trait | do the two characters share a trait that is considered sinful by both of their respective faiths? | `scope:character_1 = { has_same_sinful_trait = scope:character_2 }` |  | character | character target |  |  |
| has_same_virtue_trait | do the two characters share a trait that is considered virtuous by both of their respective faiths? | `scope:character_1 = { has_same_virtue_trait = scope:character_2 }` |  | character | character target |  |  |
| has_secret_relation_antiquarian | Checks for a secret scripted relationship with a target character |  |  | character | character target |  |  |
| has_spawned_court_events | has_spawned_court_events = bool | <code style="white-space: pre">Does the character have spawned court events? Meaning court events are shown (opened or not) in the royal court view.<br>Can only be used on player characters with a royal court.</code> |  | character | yes/no |  |  |
| has_struggle_phase_parameter | Does the given struggle's current phase have the given parameter? Can only check for bool parameters. has_struggle_phase_parameter = parameter_key |  |  | struggle |  |  |  |
| has_unit_gfx | Does the culture have this unit gfx? | `<culture> = { has_unit_gfx = mena_unit_gfx }` |  | culture |  |  |  |
| has_user_set_coa | Has the user set a specific coat of arms for this title? |  |  | landed title | yes/no |  |  |
| inspiration_gold_invested | Gets the amount of gold invested in the scoped inspiration | `inspiration_gold_invested > 5` |  | inspiration | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| inspiration_progress | Gets the progress of the scoped inspiration | `inspiration_progress > 5` |  | inspiration | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| intrigue_lifestyle_unlockable_perks | How many perks from this lifestyle can the character currently unlock? This checks that they have the parent perks, and that the can_be_picked is met. It doesn't check perk points |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| is_council_task_valid | Check if the task of the scope councillor is valid { task_type = council_position_type_key target = for_targeted_tasks } |  |  | character |  |  |  |
| is_court_position_employer | is the scoped character employed in the target position by target character |  |  | character |  |  |  |
| is_culture_involved_in_struggle | is the culture involved in struggle? | `is_culture_involved_in_struggle = culture:english` |  | struggle | culture |  |  |
| is_decision_on_cooldown | Is the given decision on cooldown for the current character. If decision on cooldown return True. | `is_decision_on_cooldown = decision_key` |  | character | yes/no |  |  |
| is_divergent_culture | Checks if the scope culture was created by diverging from a single parent culture and returns yes if true or no if false. | `is_divergent_culture = yes` |  | culture | yes/no |  |  |
| is_equipped | is the scoped artifact currently equipped in its owners inventory? |  |  | artifact | yes/no |  |  |
| is_faith_involved_in_struggle | is the faith involved in struggle? | `is_faith_involved_in_struggle  = faith:baltic_pagan` |  | struggle | faith |  |  |
| is_from_ruler_designer | Was this character made from the ruler designer |  |  | character | yes/no |  |  |
| is_head_of_faith | Is this title a head of faith title |  |  | landed title | yes/no |  |  |
| is_hybrid_culture | Checks if the scope culture was created from a hybridization of two cultures and returns yes if true or no if false. | `is_hybrid_culture = yes` |  | culture | yes/no |  |  |
| is_landless_ruler | Is the scope character a landless ruler (holds any title, but no on-map land)? |  |  | character | yes/no |  |  |
| is_pregnant | is the scoped character pregnant ? |  |  | character | yes/no |  |  |
| is_raided | Is this province currently being raided? |  |  | province | yes/no |  |  |
| is_riverside_county | is the county riverside? |  |  | landed title | yes/no |  |  |
| is_riverside_province | is the province riverside? |  |  | province | yes/no |  |  |
| is_sea_province | Is this a sea province? |  |  | province | yes/no |  |  |
| is_struggle_phase | is the scope struggle's current phase particular phase? | `is_struggle_phase = struggle_iberia_phase_opportunity` |  | struggle |  |  |  |
| is_struggle_type | is the scope struggle's type particular type? | `is_struggle_type = iberian_struggle` |  | struggle |  |  |  |
| is_unique | Is the scoped artifact unique | `defined in the scripted template of the artifact` |  | artifact | yes/no |  |  |
| is_valid_for_event_debug | is the scoped character valid for the given event, without checking event cooldown? | <code style="white-space: pre">NOTE: this is only for debug purposes and will not work in release mode!<br>is_valid_for_event_debug = event_key</code> |  | character |  |  |  |
| is_valid_for_event_debug_cooldown | is the scoped character valid for the given event, including a cooldown check? | <code style="white-space: pre">NOTE: this is only for debug purposes and will not work in release mode!<br>is_valid_for_event_debug_cooldown = event_key</code> |  | character |  |  |  |
| knows_court_language_of | Does the character know the court language of the target character? | `knows_court_language_of = scope:target_character` |  | character | character |  |  |
| knows_language | Does the character know the language? | `knows_language = language_norwegian` |  | character |  |  |  |
| knows_language_of_culture | Does the character know the language of the target culture? | `knows_language_of_culture = scope:target_culture` |  | character | culture |  |  |
| learning_lifestyle_unlockable_perks | How many perks from this lifestyle can the character currently unlock? This checks that they have the parent perks, and that the can_be_picked is met. It doesn't check perk points |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| long_term_gold_maximum | How big is the 'long term' budget is supposed to get? |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| martial_lifestyle_unlockable_perks | How many perks from this lifestyle can the character currently unlock? This checks that they have the parent perks, and that the can_be_picked is met. It doesn't check perk points |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| monthly_character_income_long_term | did the character allocate the required gold? (AI category long term) |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| monthly_character_income_reserved | did the character allocate the required gold? (AI category reserved) |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| monthly_character_income_short_term | did the character allocate the required gold? (AI category short term) |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| monthly_character_income_war_chest | did the character allocate the required gold? (AI category war chest) |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| months_as_ruler | Number of months this character has been a ruler, returns -1 if character isn't a ruler |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| months_until_max_discontent | How many months until Discontent is max (100)? |  |  | faction | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| morph_gene_attribute | Compare entity attribute from specific gene | <code style="white-space: pre">scope:character = {<br>    morph_gene_attribute = {<br>        category = gene_height<br>        attribute = body_height<br>        value &lt; 0.05<br>    }<br>}<br>An interface trigger, can only be used in specific places</code> |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| morph_gene_value | Compare value of specific gene. Does NOT take into account trait modifiers | <code style="white-space: pre">scope:character = {<br>        morph_gene_attribute = {<br>            category = gene_height<br>            value &lt; 0.05<br>        }<br>    }<br>An interface trigger, can only be used in specific places</code> |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| num_artifact_kills | How many kills has this artifact been used in? |  |  | artifact | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| num_enemies_killed | Number of troops killed on the opposite side. | `num_enemies_killed >= 500` |  | combat side | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| num_of_known_languages | How many languages does the character know? | `num_of_known_languages > 1` |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| num_of_relation_antiquarian | Compares the number of scripted relations a character has of the type |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| num_total_troops | Number of total troops on boths sides. | `num_total_troops >= 2000` |  | combat | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| number_of_sinful_traits_in_common | do the two characters share a number of traits that is considered sinful by both of their respective faiths? | `number_of_sinful_traits_in_common = { target = X value >/</>=/<= Y }` |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| number_of_virtue_traits_in_common | do the two characters share a number of traits that is considered virtuous by both of their respective faiths? | `number_of_virtue_traits_in_common = { target = X value >/</>=/<= Y }` |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| percent_enemies_killed | Percantage of enemies killed out of total number of enemy soldiers. | `percent_enemies_killed >= 80` |  | combat side | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| perks_in_diplomacy_lifestyle | How many perks does this lifestyle have? |  |  | none | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| perks_in_intrigue_lifestyle | How many perks does this lifestyle have? |  |  | none | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| perks_in_learning_lifestyle | How many perks does this lifestyle have? |  |  | none | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| perks_in_martial_lifestyle | How many perks does this lifestyle have? |  |  | none | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| perks_in_stewardship_lifestyle | How many perks does this lifestyle have? |  |  | none | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| phase_has_catalyst | Is any of the future phases affected by the given catalyst?phase_has_catalyst = catalyst_key |  |  | struggle |  |  |  |
| rarity | is the scoped artifact of given rarity? |  |  | artifact |  |  |  |
| reserved_gold | does the character have the required gold? (AI category 'reserved') |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| reserved_gold_maximum | How big is the 'reserved' budget is supposed to get? |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| save_temporary_opinion_value_as | Saves the scoped character's opinion of the target character as an arbitrarily-named target to be referenced later in the in the same trigger | `save_temporary_opinion_value_as = { name = <string> target = x` |  | none |  |  |  |
| scriptedtests_gold_income_no_theocracy | does the character have the specified tax income, excluding income from the theocratic lessee? |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| short_term_gold_maximum | How big is the 'short term' budget is supposed to get?(It may exceed this if all other budgets are full) |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| should_decay | should the scoped artifact decay with time? |  |  | artifact | yes/no |  |  |
| should_show_nudity | can nudity be shown? | `An interface trigger, can only be used in specific places` |  | none | yes/no |  |  |
| stewardship_lifestyle_unlockable_perks | How many perks from this lifestyle can the character currently unlock? This checks that they have the parent perks, and that the can_be_picked is met. It doesn't check perk points |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| time_since_death | for how long has the character is dead? time_since_death  = { days/months/years =,&gt;,&lt; X } |  |  | character |  |  |  |
| time_to_hook_expiry | The # of days until the scoped character's hook on the target expires | `time_to_hook_expiry = { target = someone value > 50 }` |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| title_held_years | Returns the number of years a title is held if valid (otherwise returns 0) |  |  | landed title | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| total_army_damage | What is the army's total damage stat in its current location? |  |  | army | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| total_army_pursuit | What is the army's total pursuit stat in its current location? |  |  | army | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| total_army_screen | What is the army's total screen stat in its current location? |  |  | army | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| total_army_siege_value | What is the army's total siege value stat in its current location? |  |  | army | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| total_army_toughness | What is the army's total toughness stat in its current location? |  |  | army | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| troops_ratio | Side's troops/opposide side's troops.ntroops_ratio &lt; 0.5 |  |  | combat side | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| war_chest_gold | does the character have the required gold? (AI category 'war chest') |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| war_chest_gold_maximum | How big is the 'war chest' budget is supposed to get? |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| warscore_value | Warscore value. | `warscore_value >= 25` |  | combat | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| years_as_ruler | Number of years this character has been a ruler, returns -1 if character isn't a ruler |  |  | character | &lt;, &lt;=, =, !=, &gt;, &gt;= |  |  |
| any_dynasty_member | Iterate through all dynasty members | any_dynasty_member = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | dynasty | character |  |  |
| blood_legacy_track_perks | How many legacies in the Blood legacy track does this dynasty have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | dynasty |  |  |  |
| dynasty_can_unlock_relevant_perk | Can the scoped dynasty unlock a 'relevant' legacy? Relevant meaning one that isn't the first in its track unless the dynasty has no partially filled tracks |  | yes/no | dynasty |  |  |  |
| dynasty_prestige | Does the dynasty have the required prestige? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | dynasty |  |  |  |
| dynasty_prestige_level | Does the dynasty have the required level of splendor? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | dynasty |  |  |  |
| erudition_legacy_track_perks | How many legacies in the Erudition legacy track does this dynasty have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | dynasty |  |  |  |
| glory_legacy_track_perks | How many legacies in the Glory legacy track does this dynasty have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | dynasty |  |  |  |
| guile_legacy_track_perks | How many legacies in the Guile legacy track does this dynasty have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | dynasty |  |  |  |
| has_dynasty_modifier | Does the scoped dynasty have a given modifier? | has_dynasty_modifier = name |  | dynasty |  |  |  |
| has_dynasty_modifier_duration_remaining | Does the scoped dynasty have the duration remaining on a given modifier? | has_dynasty_modifier_duration_remaining = name |  | dynasty |  |  |  |
| has_dynasty_perk | Does the dynasty have this legacy? | has_dynasty_perk = key |  | dynasty |  |  |  |
| kin_legacy_track_perks | How many legacies in the Kin legacy track does this dynasty have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | dynasty |  |  |  |
| law_legacy_track_perks | How many legacies in the Law legacy track does this dynasty have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | dynasty |  |  |  |
| warfare_legacy_track_perks | How many legacies in the Warfare legacy track does this dynasty have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | dynasty |  |  |  |
| compare_value | Compare the scoped value instead of scoping into it. | var:variable_name = { compare_value &lt; 4 }<br>var:variable_name.compare_value &lt; {value = var:other_variable add = 5} | &lt;, &lt;=, =, !=, &gt;, &gt;= | value |  |  |  |
| any_house_member | Iterate through all house members | any_house_member = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | dynasty house | character |  |  |
| has_house_modifier | Does the scoped house have a given modifier? | has_house_modifier = name |  | dynasty house |  |  |  |
| has_house_modifier_duration_remaining | Does the scoped house have the duration remaining on a given modifier? | has_house_modifier_duration_remaining = name |  | dynasty house |  |  |  |
| any_faith | Iterate through all faiths within a religion | any_faith = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | religion | faith |  |  |
| is_in_family | Is the scoped faith in a given religious family? | is_in_family = rf_abrahamic |  | religion |  |  |  |
| any_scheme_agent | Iterate through all agents in the scheme | any_scheme_agent = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | scheme | character |  |  |
| has_scheme_modifier | Is the scheme currently affected by the specified modifier? | has_scheme_modifier = X |  | scheme |  |  |  |
| is_hostile | Is the scoped scheme a hostile scheme? | is_hostile = bool | yes/no | scheme |  |  |  |
| is_scheme_agent_exposed | Is the target character an exposed agent in the scope scheme? |  | character target | scheme |  |  |  |
| is_scheme_exposed | Is the scheme exposed? |  | yes/no | scheme |  |  |  |
| scheme_duration_days | The number of days since the scheme was started |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | scheme |  |  |  |
| scheme_is_character_agent | Is the target character part of this scheme? |  | character target | scheme |  |  |  |
| scheme_monthly_progress | Monthly scheme progress in % (i.e. 50 equals 50%) |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | scheme |  |  |  |
| scheme_number_of_agents | The number of agents in a scheme |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | scheme |  |  |  |
| scheme_number_of_exposed_agents | The number of exposed agents in a scheme |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | scheme |  |  |  |
| scheme_power | Scheme power |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | scheme |  |  |  |
| scheme_power_resistance_difference | Scheme power minus scheme resistance |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | scheme |  |  |  |
| scheme_power_resistance_ratio | Scheme power/resistance ratio. Set to ±10000 if resistance is zero and power is positive/negative (0 if both power and resistance are 0) |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | scheme |  |  |  |
| scheme_progress | Scheme progress (0 - 10 (defined)) |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | scheme |  |  |  |
| scheme_resistance | Scheme resistance |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | scheme |  |  |  |
| scheme_secrecy | Scheme secrecy |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | scheme |  |  |  |
| scheme_skill | Is the scheme currently affected by the specified modifier? | has_scheme_modifier = X |  | scheme |  |  |  |
| scheme_success_chance | Scheme success chance |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | scheme |  |  |  |
| scheme_type | Is the scheme of the specified type? | scheme_type = X |  | scheme |  |  |  |
| active_de_jure_drift_progress |  | task_current_value = scope:county.active_de_jure_drift_progress | &lt;, &lt;=, =, !=, &gt;, &gt;= | landed title |  |  |  |
| any_claimant | Iterate through all claimants to title. parameters: explicit = yes/no/all - default yes | any_claimant = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | character |  |  |
| any_connected_county | Iterate through all counties connected to this one. Is based on top liege | any/every/whatever_connected_county = {<br>	max_naval_distance = 500<br>	allow_one_county_land_gap = yes<br>any_connected_county = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | landed title |  |  |
| any_county_province | Iterate through all baronies in a county | any_county_province = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | province |  |  |
| any_de_jure_county_holder | Iterate through all characters directly holding counties within this de jure title | any_de_jure_county_holder = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | character |  |  |
| any_de_jure_top_liege | Iterate through all top lieges of the counts within this de jure title | any_de_jure_top_liege = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | character |  |  |
| any_dejure_vassal_title_holder | Iterate through all the vassal holders of the title | any_dejure_vassal_title_holder = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | character |  |  |
| any_election_candidate | Iterate through all characters who are valid candidates in an election for a title | any_election_candidate = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | character |  |  |
| any_elector | Iterate through all characters who are valid electors in an election for a title | any_elector = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | character |  |  |
| any_in_de_facto_hierarchy | Iterate through the title itself, all de facto vassals, and below. The continue trigger specifies whether to recursively iterate through the vassal's vassals | continue is unrelated to the limit; if the limit is met it is added to the list, but its vassals will get checked even if the limit isn't met as long as the 'continue' trigger is<br>..._de_jure_vassal_and_below = { continue = { conditions } }<br>any_in_de_facto_hierarchy = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | landed title |  |  |
| any_in_de_jure_hierarchy | Iterate through the title itself, all de jure vassals, and below. The continue trigger specifies whether to recursively iterate through the vassal's vassal | This is unrelated to the limit; if the limit is met it is added to the list, but its vassals will get checked even if the limit isn't met as long as the 'continue' trigger is<br>..._de_jure_vassal_and_below = { continue = { conditions } }<br>any_in_de_jure_hierarchy = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | landed title |  |  |
| any_neighboring_county | Iterate through all neighboring counties. Can only be used in county scope | any_neighboring_county = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | landed title |  |  |
| any_this_title_or_de_jure_above | Iterate through this title and all its de jure liege titles | any_this_title_or_de_jure_above = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | landed title |  |  |
| any_title_heir | Line of succession for the scoped title | any_title_heir = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | character |  |  |
| any_title_joined_faction | Iterate through all factions joined the scope landed title | any_title_joined_faction = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | faction |  |  |
| any_title_to_title_neighboring_and_across_water_county | Scopes from a title to a neighboring county (incl. across water, looking through the de jure lieges) | any_title_to_title_neighboring_and_across_water_county = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | landed title |  |  |
| any_title_to_title_neighboring_and_across_water_duchy | Scopes from a title to a neighboring duchy (incl. across water, looking through the de jure lieges) | any_title_to_title_neighboring_and_across_water_duchy = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | landed title |  |  |
| any_title_to_title_neighboring_and_across_water_empire | Scopes from a title to a neighboring empire (incl. across water, looking through the de jure lieges) | any_title_to_title_neighboring_and_across_water_empire = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | landed title |  |  |
| any_title_to_title_neighboring_and_across_water_kingdom | Scopes from a title to a neighboring kingdom (incl. across water, looking through the de jure lieges) | any_title_to_title_neighboring_and_across_water_kingdom = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | landed title |  |  |
| any_title_to_title_neighboring_county | Scopes from a title to a neighboring county (looking through the de jure lieges) | any_title_to_title_neighboring_county = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | landed title |  |  |
| any_title_to_title_neighboring_duchy | Scopes from a title to a neighboring duchy (looking through the de jure lieges) | any_title_to_title_neighboring_duchy = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | landed title |  |  |
| any_title_to_title_neighboring_empire | Scopes from a title to a neighboring empire (looking through the de jure lieges) | any_title_to_title_neighboring_empire = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | landed title |  |  |
| any_title_to_title_neighboring_kingdom | Scopes from a title to a neighboring kingdom (looking through the de jure lieges) | any_title_to_title_neighboring_kingdom = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | landed title | landed title |  |  |
| can_be_leased_out | Can the scoped title be leased out? |  | yes/no | landed title |  |  |  |
| can_title_create_faction | Can the title create the faction of the specified type against the specified character? | can_title_create_faction = { type = X target = Y } |  | landed title |  |  |  |
| can_title_join_faction | Can the the scoped title join the faction? | can_title_join_faction = faction |  | landed title |  |  |  |
| county_control | Does the county title have the required county control? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | landed title |  |  |  |
| county_control_rate | How much county control is the county gaining each month? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | landed title |  |  |  |
| county_control_rate_modifier | What's the multiplier to the control gain rate? E.g., if there's just a +20% modifier, this would return 1.2 |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | landed title |  |  |  |
| county_holder_opinion | Compares the county's opinion of its holder |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | landed title |  |  |  |
| county_opinion | Compares the county's opinion of the current count |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | landed title |  |  |  |
| county_opinion_target | Compares the county's opinion of the target character to the specified value | county_opinion_target = { target = X value &gt;/&lt;/= Y } |  | landed title |  |  |  |
| de_jure_drift_progress | Compare drift progress towards target with value | &lt;drifting_title> = { de_jure_drift_progress = {     target = &lt;drift_target_title>    value > 50 } } |  | landed title |  |  |  |
| de_jure_drifting_towards | Is the scoped landed title de jure drifting toward another title? | &lt;drifting_title> = { de_jure_drifting_towards = &lt;drift_target_title> } | landed title scope | landed title | landed title |  |  |
| development_level | Does the county title have the required county development level? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | landed title |  |  |  |
| development_rate | How much development progress is the county gaining each month? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | landed title |  |  |  |
| development_rate_modifier | What's the multiplier to the development progress? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | landed title |  |  |  |
| development_towards_level_increase | Does the county title have the required progress towards the next level of development? E.g., if level 1 is 100, level 2 is 300 (these are set in defines), and current total is 150, this would return 50 |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | landed title |  |  |  |
| has_character_nominiated | Has the target character nominated a successor for the scoped title? |  | character target | landed title |  |  |  |
| has_county_modifier | Does the scoped county have a given modifier? | has_county_modifier = name |  | landed title |  |  |  |
| has_county_modifier_duration_remaining | Does the scoped county have the duration remaining on a given modifier? | has_county_modifier_duration_remaining = name |  | landed title |  |  |  |
| has_disabled_building | Is the scoped landed title connected to a holding that contains at least one disabled building? |  | yes/no | landed title |  |  |  |
| has_holy_site_flag | Does the barony have a holy site with the given flag? | has_holy_site_flag = some_flag |  | landed title |  |  |  |
| has_order_of_succession | Does the scoped title have a given succession type? | has_order_of_succession = election |  | landed title |  |  |  |
| has_revokable_lease | Is the title under a lease that can be revoked manually? |  | yes/no | landed title |  |  |  |
| has_title_law | Does the scoped title have the given title-specific law? |  |  | landed title |  |  |  |
| has_title_law_flag | Does the scoped title have a title-specific law with the given flag? |  |  | landed title |  |  |  |
| has_wrong_holding_type | Is the scope landed title connected to a holding that cannot be governed by the current lessee or holder? |  | yes/no | landed title |  |  |  |
| is_capital_barony | Is title in the scope a capital barony? |  | yes/no | landed title |  |  |  |
| is_coastal_county | Is the county coastal? |  | yes/no | landed title |  |  |  |
| is_connected_to | Is the county connected to the other county? Is based on top liege | is_connected_to = {<br>	max_naval_distance = 500<br>	allow_one_county_land_gap = yes<br>	target = some other county<br>} |  | landed title |  |  |  |
| is_contested | Is the scope landed title contested in any war? |  | yes/no | landed title |  |  |  |
| is_de_facto_liege_or_above_target | Is the title de facto liege or above the target title? |  | landed title target | landed title |  |  |  |
| is_de_jure_liege_or_above_target | Is the title de jure liege or above the target title? |  | landed title target | landed title |  |  |  |
| is_holy_order | Is the scope landed title a holy order? |  | yes/no | landed title |  |  |  |
| is_holy_site | Is the barony a holy site of any faith? | is_holy_site = yes | yes/no | landed title |  |  |  |
| is_holy_site_controlled_by | Does the target character control a holy site of the scoped object? | is_holy_site_controlled_by = root | character scope | landed title | character |  |  |
| is_holy_site_of | Is the barony a holy site of the given faith? | is_holy_site_of = catholic |  | landed title |  |  |  |
| is_landless_type_title | Is this title considered a landless type title? |  | yes/no | landed title |  |  |  |
| is_leased_out | Is the scoped title leased out? |  | yes/no | landed title |  |  |  |
| is_mercenary_company | Is the scope landed title a mercenary company? |  | yes/no | landed title |  |  |  |
| is_neighbor_to_realm | Is this landed title adjacent to the character's realm? | is_neighbor_to_realm = character | character scope | landed title | character |  |  |
| is_target_of_council_task | Is the county currently affected by the specified council task? Needs to be in a county title scope |  |  | landed title |  |  |  |
| is_title_created | Is title in the scope created? |  | yes/no | landed title |  |  |  |
| is_titular | Is this title titular (has no de jure counties in it, and is not a barony/county)? |  | yes/no | landed title |  |  |  |
| is_under_holy_order_lease | Is the scoped title leased out to any holy order? |  | yes/no | landed title |  |  |  |
| place_in_line_of_succession | What place in line of succession does the character hold? |  |  | landed title |  |  |  |
| recent_history | Does the scope title have a history entry of the specified type in recent history? | recent_history = { type = X days/months/years = Y }<br>The type can be omitted, all history types are considered then<br>Possible types:<br>- conquest<br>- conquest_holy_war<br>- conquest_claim<br>- conquest_populist<br>- election<br>- inheritance<br>- abdication<br>- created<br>- destroyed<br>- usurped<br>- granted<br>- revoked<br>- independency<br>- leased_out<br>- lease_revoked<br>- returned<br>- faction_demand |  | landed title |  |  |  |
| target_is_de_facto_liege_or_above | Is the target title de facto liege or above? |  | landed title target | landed title |  |  |  |
| target_is_de_jure_liege_or_above | Is the target title de jure liege or above? |  | landed title target | landed title |  |  |  |
| tier | What tier is the scoped title? Use the script values please, not raw numbers | The tiers are<br>1. tier_barony<br>1. tier_county<br>1. tier_duchy<br>1. tier_kingdom<br>1. tier_empire | &lt;, &lt;=, =, !=, &gt;, &gt;= | landed title |  |  |  |
| title_create_faction_type_chance | Check if the chance to create a faction against a target of the scope landed title is is true against the scripted value | title_create_faction_type_chance = { <br>    type = faction_type #An ongoing faction<br>    target = target_character<br>    value <|<=|>=|> 0<br>} |  | landed title |  |  |  |
| title_is_a_faction_member | Is the scope title a member of a faction? |  | yes/no | landed title |  |  |  |
| title_join_faction_chance | Check if the chance of the scope landed title to join the faction against the scripted value | title_join_faction_chance = { <br>    faction = faction_target #An ongoing faction<br>    value <|<=|>=|> 0<br>} |  | landed title |  |  |  |
| title_will_leave_sub_realm_on_succession | Will the title leave the sub-realm of the character on the right-hand-side upon succession? That is, is the first heir in someone outside the sub-realm, and the highest tier title they'll inherit from the person holding the title is not higher than their current tier |  | character target | landed title |  |  |  |
| story_type | Is the story in scope of this type? |  |  | story cycle |  |  |  |
| can_get_innovation_from | Get random applicable innovation from another culture |  |  | culture |  |  |  |
| has_all_innovations | Has the culture discovered all innovations matching the filter? | has_all_innovations = {<br>	with_flag = flag_name # innovation matches if it has the flag; optional<br>	without_flag = flag_name # innovation matches if it does not have the flag; optional<br>	culture_era = era_key # innovation matches if it is from the era; optional<br>} |  | culture |  |  |  |
| has_cultural_era_or_later | Has this culture achieved specified era? | &lt;culture> = { has_cultural_era_or_later = culture_era_early_medieval } |  | culture |  |  |  |
| has_innovation | Have the culture discovered this innovation? |  |  | culture |  |  |  |
| mercenary_company_expiration_days | How many days are left in the mercenary contract. 0 if not hired. |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | mercenary company |  |  |  |
| age | Compare character age |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| ai_boldness | AI boldness |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| ai_compassion | AI compassion |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| ai_diplomacy_stance | The AI's diplomatic view of the target character | ai_diplomacy_stance = {<br>    target = target_character<br>    stance = neutral/threat/enemy/friend<br>} |  | character |  |  |  |
| ai_energy | AI energy |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| ai_greed | AI greed |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| ai_honor | AI honor |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| ai_rationality | AI rationality |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| ai_sociability | AI sociability |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| ai_values_divergence | Compare AI values between characters | target = other character value &gt;/&lt;/= sum of differences in ai values |  | character |  |  |  |
| ai_vengefulness | AI vengefulness |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| ai_zeal | AI zeal |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| allowed_concubines | Can the scope owner have concubines? |  | yes/no | character |  |  |  |
| allowed_more_concubines | Can the scope owner have more concubines? |  | yes/no | character |  |  |  |
| allowed_more_spouses | Can the scope owner have more spouses? |  | yes/no | character |  |  |  |
| any_alert_creatable_title | Iterate through all titles that can be created by the character. (only for alerts) | any_alert_creatable_title = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_alert_usurpable_title | Iterate through all titles that can be usurped by the character. (only for alerts) | any_alert_usurpable_title = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_ally | Iterate through all allies | any_ally = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_ancestor | Iterate through all the ancestors of the scope character up to 5 generations | any_ancestor = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_army | Iterate through all armies | any_army = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | army |  |  |
| any_character_to_title_neighboring_and_across_water_county | Scopes from a character to a neighboring county (incl. across water, looking through the de jure lieges) | any_character_to_title_neighboring_and_across_water_county = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_character_to_title_neighboring_and_across_water_duchy | Scopes from a character to a neighboring duchy (incl. across water, looking through the de jure lieges) | any_character_to_title_neighboring_and_across_water_duchy = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_character_to_title_neighboring_and_across_water_empire | Scopes from a character to a neighboring empire (incl. across water, looking through the de jure lieges) | any_character_to_title_neighboring_and_across_water_empire = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_character_to_title_neighboring_and_across_water_kingdom | Scopes from a character to a neighboring kingdom (incl. across water, looking through the de jure lieges) | any_character_to_title_neighboring_and_across_water_kingdom = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_character_to_title_neighboring_county | Scopes from a character to a neighboring county (looking through the de jure lieges) | any_character_to_title_neighboring_county = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_character_to_title_neighboring_duchy | Scopes from a character to a neighboring duchy (looking through the de jure lieges) | any_character_to_title_neighboring_duchy = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_character_to_title_neighboring_empire | Scopes from a character to a neighboring empire (looking through the de jure lieges) | any_character_to_title_neighboring_empire = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_character_to_title_neighboring_kingdom | Scopes from a character to a neighboring kingdom (looking through the de jure lieges) | any_character_to_title_neighboring_kingdom = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_character_war | Wars of the scoped character | any_character_war = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | war |  |  |
| any_child | Iterate through all children | any_child = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_claim | Iterate through the titles of all claims held by a character; parameters: explicit = yes/no/all pressed = yes/no/all | any_claim = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_close_family_member | Iterate through all the close family [father, mother, siblings, children, grandparents] | any_close_family_member = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_close_or_extended_family_member | Iterate through all the close and extended relatives [father, mother, siblings, children, grandparents, uncles/aunts, nephew/niece, cousins] | any_close_or_extended_family_member = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_concubine | Iterate through all concubines | any_concubine = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_consort | Iterate through all consorts (concubines and spouses) | any_consort = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_councillor | Iterate through all councillors | any_councillor = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_courtier | Iterate through all courtiers. It stops iterating when finds very first suitable element therefore it does not check other elements. It might be annoying when you have another additional dependent triggers with that element previously found. | any_courtier = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_courtier_away | Iterate through all courtiers that are away | any_courtier_away = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_courtier_or_guest | Iterate through all courtiers and guests (pool and foreign court guests) It stops iterating when finds very first suitable element therefore it does not check other elements. It might be annoying when you have another additional dependent triggers with that element previously found. | any_courtier_or_guest = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_de_jure_claim | Iterate through all de jure claims for a character | any_de_jure_claim = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_diplomacy_councillor | Iterate through all diplomacy-based councillors | any_diplomacy_councillor = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_directly_owned_province | Iterate through all directly owned provinces | any_directly_owned_province = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | province |  |  |
| any_election_title | Iterate through all titles the scoped character can vote on | any_election_title = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_extended_family_member | Iterate through all the extended family [uncles/aunts, nephew/niece, cousins] | any_extended_family_member = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_foreign_court_guest | Iterate through all guests visiting from another court (in contrast to pool_guest they have a liege) | any_foreign_court_guest = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_former_concubine | Iterate through all former concubines. Not persisted past death | any_former_concubine = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_former_concubinist | Iterate through all former concubinists. Not persisted past death | any_former_concubinist = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_former_spouse | Iterate through all former spouses | any_former_spouse = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_general_councillor | Iterate through all councillors that are not related to a skill | any_general_councillor = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_heir | Heirs of the scoped character | any_heir = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_heir_title | Iterate through all landed titles character is heir to | any_heir_title = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_heir_to_title | Iterate through all titles the scoped character is heir to | any_heir_to_title = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_held_title | Iterate through all held landed titles | any_held_title = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_hired_mercenary | Iterate through all hired mercenary companies | any_hired_mercenary = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | mercenary company |  |  |
| any_hooked_character | Iterate through all characters this character has a hook on | any_hooked_character = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_hostile_raider | Iterate through anyone the character is hostile to due to their top liege's realm having been raided | any_hostile_raider = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_intrigue_councillor | Iterate through all intrigue-based councillors | any_intrigue_councillor = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_knight | Iterate through all knights | any_knight = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_known_secret | Iterate through all secrets known by the character | any_known_secret = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | secret |  |  |
| any_learning_councillor | Iterate through all learning-based councillors | any_learning_councillor = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_liege_or_above | Iterate through all lieges above a character (skipping the character themselves) | any_liege_or_above = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_martial_councillor | Iterate through all martial-based councillors | any_martial_councillor = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_neighboring_and_across_water_realm_same_rank_owner | A sub-realm or realm bordering the scope character's realm (including across water) that has the same rank as the scoped character (look for lieges of the owner of the land if necessary) | any_neighboring_and_across_water_realm_same_rank_owner = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_neighboring_and_across_water_top_liege_realm | A realm with a different top liege neighboring the realm of the scoped character's top liege (including across water); switches to the realm's top title. Can be based on borders a day or two out of date | any_neighboring_and_across_water_top_liege_realm = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_neighboring_and_across_water_top_liege_realm_owner | A realm with a different top liege neighboring the realm of the scope character's top liege (including across water); switches to the holder of the realm. Can be based on borders a day or two out of date | any_neighboring_and_across_water_top_liege_realm_owner = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_neighboring_realm_same_rank_owner | A sub-realm or realm bordering the scope character's realm and has the same rank as the scope character (look for lieges of he owner of the land if necessary) | any_neighboring_realm_same_rank_owner = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_neighboring_top_liege_realm | A realm with a different top liege neighboring the realm of the scope character's top liege; switches to the realm's top title. Can be based on borders a day or two out of date | any_neighboring_top_liege_realm = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_neighboring_top_liege_realm_owner | A realm with a different top liege neighboring the realm of the scope character's top liege; switches to the holder of the realm. Can be based on borders a day or two out of date | any_neighboring_top_liege_realm_owner = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_owned_story | Iterate through all owned stories for a character | any_owned_story = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | story cycle |  |  |
| any_parent | Iterate through all (both) parents | any_parent = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_patroned_holy_order | Iterate through all holy orders that the scoped character is a patron of | any_patroned_holy_order = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | holy order |  |  |
| any_pinned_character | Iterate through characters this player has pinned | any_pinned_character = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_pinning_character | Iterate through characters whose player has this character pinned | any_pinning_character = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_player_heir | Iterate through player heirs, capped at the first 10 | any_player_heir = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_pool_guest | Iterate through all guests visiting the court from the pool (in contrast to foreign_court_guest they don't have a liege) | any_pool_guest = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_potential_marriage_option | Iterate through all potential selectable marriage or betrothal options | any_potential_marriage_option = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_pretender_title | Iterate through all landed titles character is pretender to | any_pretender_title = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_primary_war_enemy | Iterate through all primary war enemies | any_primary_war_enemy = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_prisoner | Iterate through all prisoners in the scoped character's dungeon | any_prisoner = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_prowess_councillor | Iterate through all prowess-based councillors | any_prowess_councillor = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_raid_target | Iterate through anyone the character is hostile to due to having raided them. Only returns top lieges | any_raid_target = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_realm_county | Iterate through all counties in the realm. Based on top liege | any_realm_county = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_realm_de_jure_duchy | Iterate through all de jure duchies that have at least one county in the realm. Based on top liege | any_realm_de_jure_duchy = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_realm_de_jure_empire | Iterate through all de jures empire that have at least one county in the realm. Based on top liege | any_realm_de_jure_empire = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_realm_de_jure_kingdom | Iterate through all de jure kingdom that have at least one county in the realm. Based on top liege | any_realm_de_jure_kingdom = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_realm_province | Iterate through all realm provinces [baronies?] of a character | any_realm_province = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | province |  |  |
| any_relation | Iterate through scripted relations of a given type or multiple types. If someone is multiple relations they will only be in the list once | any_relation = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_scheme | Iterate through all schemes owned by the character | any_scheme = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | scheme |  |  |
| any_secret | Iterate through all secrets of the character | any_secret = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | secret |  |  |
| any_sibling | Iterate through all siblings | any_sibling = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_spouse | Iterate through all spouses | any_spouse = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_spouse_candidate | Iterate through all the spouse candidates of a character. WARNING: THIS IS VERY SLOW DO NOT DO IT OFTEN. | any_spouse_candidate = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_stewardship_councillor | Iterate through all stewardship-based councillors | any_stewardship_councillor = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_sub_realm_barony | Iterate through all baronies in sub-realm | any_sub_realm_barony = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_sub_realm_county | Iterate through all counties in sub-realm | any_sub_realm_county = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_sub_realm_duchy | Iterate through all duchies in sub-realm | any_sub_realm_duchy = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_sub_realm_empire | Iterate through all empires in sub-realm | any_sub_realm_empire = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_sub_realm_kingdom | Iterate through all kingdoms in sub-realm | any_sub_realm_kingdom = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_sub_realm_title | Iterate through all titles in sub-realm | any_sub_realm_title = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | landed title |  |  |
| any_targeting_faction | Iterate through all factions targeting the scoped character | any_targeting_faction = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | faction |  |  |
| any_targeting_scheme | Iterate through all schemes targeting the character | any_targeting_scheme = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | scheme |  |  |
| any_targeting_secret | Iterate through all secrets that target the specified scope | any_targeting_secret = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | secret |  |  |
| any_traveling_family_member | Iterate though all characters that should travel with the scoped one (when moving between courts for instance); includes the scoped character | any_traveling_family_member = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_truce_holder | Iterate through all characters that have a truce with this character | any_truce_holder = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_truce_target | Iterate through all characters this character has a truce with | any_truce_target = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_unspent_known_secret | Iterate through all unspent (not revealed/blackmailed) secrets known by the character | any_unspent_known_secret = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | secret |  |  |
| any_vassal | Iterate through all DIRECT vassals | any_vassal = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_vassal_or_below | Iterate through ALL vassals, not just direct vassals | any_vassal_or_below = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_war_ally | Iterate through all direct war allies | any_war_ally = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| any_war_enemy | Iterate through all direct war enemies | any_war_enemy = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | character | character |  |  |
| attraction | Attraction value for the scoped character |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| base_weight | Base weight of the scoped character | base_weight > 10 | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| can_add_hook | Will trying to hook the target character override the current hook? (if no current hook, always returns true) | can_add_hook = {<br>target = &lt;character&gt;<br>type = &lt;hook type&gt;<br>days/months/year = whatever (optional; will use the duration from the type if not provided)<br>} |  | character |  |  |  |
| can_attack_in_hierarchy | Can the scope character attack the given character based on their liege-vassal relations? |  | character target | character |  |  |  |
| can_be_child_of | Would the target character have been able to have children at the time of the scoped character's birth? Only age is taken into account |  | character target | character |  |  |  |
| can_be_parent_of | Would the scoped character have been able to have children at the time of the target character's birth? Only age is taken into account |  | character target | character |  |  |  |
| can_create_faction | Can the character create the faction of the specified type against the specified character? | can_create_faction = { type = X target = Y } |  | character |  |  |  |
| can_execute_decision | Is the scoped character able to execute the given decision? |  |  | character |  |  |  |
| can_have_children | Can the character have children? Only checks hard blocks from traits, not fertility | can_have_children = yes/no | yes/no | character |  |  |  |
| can_join_activities | Can the character join activities? |  | yes/no | character |  |  |  |
| can_join_faction | Can the scope character join the faction? | can_join_faction = faction |  | character |  |  |  |
| can_join_or_create_faction_against | Can the scope character create if join a faction against the target? | can_join_or_create_faction_against = scope:faction_target<br>can_join_or_create_faction_against = {<br>	who = scope:faction_target<br>	faction = faction_key # optional<br>	check_in_a_faction = no # default: yes<br>} | character target | character |  |  |  |
| can_start_scheme | Can the character start the given scheme against the given character? | can_start_scheme = { type = X target = Y } |  | character |  |  |  |
| character_has_commander_trait_scope_does_not | Does the character have a commander trait that the scope does not? |  | character target | character |  |  |  |
| character_is_land_realm_neighbor | Is the scoped character a realm neighbor of the target? Meaning they're independent or have the same liege, and border your realm. |  | character target | character |  |  |  |
| character_is_realm_neighbor | Is the scoped character a realm neighbor of the target? Meaning they're independent or has the same liege, and border your realm. Including across two sea zones |  | character target | character |  |  |  |
| completely_controls | Does the character control all counties and baronies inside de jure title (no hostile occupation either)? |  | landed title scope | character | landed title |  |  |
| completely_controls_region | Does the character control all counties and baronies inside the specified region (no hostile occupation either)? |  |  | character | geographical region |  |  |
| council_task_monthly_progress | Is the scoped character's monthly progress on their assigned council task this big? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| create_faction_type_chance | Check if the chance to create a faction against a target of the scope character is is true against the scripted value | create_faction_type_chance = { <br>    type = faction_type #An ongoing faction<br>    target = target_character<br>    value <|<=|>=|> 0<br>} |  | character |  |  |  |
| current_weight | Current weight of the scoped character | current_weight > 10 | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| current_weight_for_portrait | Current weight of the scoped character as a value for portraits scaled between 0.0 and 1.0 | current_weight_for_portrait > 0.1 | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| days_in_prison | Number of days the character has been imprisoned for (0 if not imprisoned) |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| days_of_continuous_peace | Number of days the character has been at peace (0 if at war). Raids count as 'not peace' |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| days_of_continuous_war | Number of days the character has been at war (0 if at peace) |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| death_reason | Does the scoped character have the given death reason? | death_reason = death_natural_causes |  | character |  |  |  |
| diplomacy | Does the character have the required diplomacy skill level? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| diplomacy_diff | Does the character have the required diplomacy skill level difference against target? | diplomacy = { target = character value &lt;= script_value abs = yes/no(optional, default no) } | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| diplomacy_for_portrait | Diplomacy skill scaled between 0.0 and 1.0 for portraits |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| diplomacy_lifestyle_perk_points | How many diplomacy perk points does the character have available? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| diplomacy_lifestyle_perks | How many diplomacy perks does the character have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| diplomacy_lifestyle_xp | How much diplomacy lifestyle experience does the character have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| does_ai_liege_in_vassal_contract_desire_obligation_change | Does the AI liege in a vassal contract desire changing an obligation level? |  | yes/no | character |  |  |  |
| does_ai_vassal_in_vassal_contract_desire_obligation_change | Does the AI vassal in a vassal contract desire changing an obligation level? |  | yes/no | character |  |  |  |
| domain_limit | Is the scoped character's domain limit this big? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| domain_limit_available | Is there this much space left in the character's domain limit? Negative values also work for checking characters that are above their limit |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| domain_limit_percentage | Is the scoped character's domain this big in comparison to their limit? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| domain_size | Is the scoped character's domain this big? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| dread | Does the character have the required dread? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| dread_modified_ai_boldness | AI boldness modified by the dread of the specified character | dread_modified_ai_boldness = {<br>	character = root	# the character whose dread is affecting the target character<br>	value &gt;= 5<br>} |  | character |  |  |  |
| effective_age | Age of character. If immortal, age they became immortal at |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| fertility | Does the character have the required fertility? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| focus_progress | Does the character have this much focus progress? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| gold | GHoes the character have the required gold? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| government_allows | Checks if the government of the character allows something |  |  | character |  |  |  |
| government_disallows | Checks if the government of the character disallows something |  |  | character |  |  |  |
| government_has_flag | Checks if the government of the character has a specific flag |  |  | character |  |  |  |
| has_any_cb_on | Does the scope character have any casus belli on the target character? |  | character target | character |  |  |  |
| has_any_display_cb_on | Does the scope character have any casus belli on the target character that should be displayed? (Allowed to fail valid_to_start_display_regardless) |  | character target | character |  |  |  |
| has_any_focus | Does the character have any focus set? |  | yes/no | character |  |  |  |
| has_any_nickname | Does the scope character have a nickname? |  | yes/no | character |  |  |  |
| has_any_scripted_relation | Does the scope character have any scripted relation with the target character? |  | character target | character |  |  |  |
| has_any_secret_relation | Does the scope character have any secret relationship with the target character? |  | character target | character |  |  |  |
| has_any_secrets | Does the character have any secrets? |  | yes/no | character |  |  |  |
| has_bad_nickname | Does the scope character have a bad nickname? |  | yes/no | character |  |  |  |
| has_banish_reason | Does the character have the banish reason towards the target? |  | character target | character |  |  |  |
| has_cb_on | Does the scoped character have the specified casus belli on the taget character? Invalid target returns false | has_cb_on = { target = X casus_belli/cb = Y } |  | character |  |  |  |
| has_character_flag | Does the character have this flag? |  |  | character |  |  |  |
| has_character_modifier | Does the scoped character have a given modifier? | has_character_modifier = name |  | character |  |  |  |
| has_character_modifier_duration_remaining | Does the scoped character have the duration remaining on a given modifier? | has_character_modifier_duration_remaining = name |  | character |  |  |  |
| has_claim_on | Does the character have a claim on the target title? |  | landed title target | character |  |  |  |
| has_council_position | Does the scoped character have the given position? |  |  | character |  |  |  |
| has_councillor_for_skill | Does the scoped character have a councillor for the specified skill? | has_councillor_for_skill = X, where X is a skill name or 'general' |  | character |  |  |  |
| has_culture | Does the character have this culture? |  |  | character |  |  |  |
| has_de_jure_claim_on | Does the scope character have a de jure claim against the target? |  | character target | character |  |  |  |
| has_disable_non_aggression_pacts | Does the character have disabled non-aggression pacts with the target? |  | character target | character |  |  |  |
| has_divorce_reason | Does the character have the divorce reason towards the target? |  | character target | character |  |  |  |
| has_dread_level_towards | How scared is the scope character of the target? 0 = not intimidated, 1 = intimidated, 2 = terrified. | has_dread_level_towards = { <br>target = X <br>level &gt;/&lt;/&gt;=/&lt;=/= Y <br>} |  | character |  |  |  |
| has_dynasty | Does the character have a valid dynasty? |  | yes ("no" does not work) | character |  |  |  |
| has_election_vote_of | Is the target character voting for the scoped character in the election of the target title | has_election_vote_of = { who = scope:actor title = primary_title } |  | character |  |  |  |
| has_execute_reason | Does the character have the execute reason towards the target? |  | character target | character |  |  |  |
| has_faith | Does the character have this faith? | has_faith = faith:baltic_pagan | faith scope | character | faith |  |  |
| has_father | does the character have a valid living father? |  | yes/no | character |  |  |  |
| has_focus | Does the character have this focus? |  |  | character |  |  |  |
| has_free_council_slot | Does the scope character have a council position to fill? (ignoring automatically filled positions) |  | yes/no | character |  |  |  |
| has_gene | Does the character have the specified gene template? Only works for morph genes. An interface trigger, can only be used in specific places | has_gene = { category = X template = Y } |  | character |  |  |  |
| has_government | Checks if the character has a specific government type | has_government = X<br>Where X is any government type (e.g. feudal_government, clan_government, tribal_government, etc.) |  | character |  |  |  |
| has_had_focus_for_days | Has the character had a focus for the given amount of time? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| has_hook | Does the character have a hook on the target? | has_hook = &lt;character&gt; | character scope | character | character |  |  |
| has_hook_from_secret | Does the character have a hook based on the target's secret? | has_hook_from_secret = scope:saved_secret |  | character |  |  |  |
| has_hook_of_type | Does the character have a hook on the target of the given type? | has_hook_of_type = { target = X type = Y } |  | character |  |  |  |
| has_imprisonment_reason | Does the character have an imprisonment reason towards the target? |  | character target | character |  |  |  |
| has_inactive_trait | Does the character have this trait or a trait of this trait group amongst their inactive traits? |  |  | character |  |  |  |
| has_lifestyle | Does the character have this lifestyle? |  |  | character |  |  |  |
| has_mother | Does the character have a valid living mother? |  | yes/no | character |  |  |  |
| has_nickname | Does the character have this nickname? |  |  | character |  |  |  |
| has_non_aggression_pact | Does the character have a non-aggression pact with the target? |  | character target | character |  |  |  |
| has_non_interference | Does the character have the non-interference reason towards the target? |  | character target | character |  |  |  |
| has_opinion_modifier | Does the character have the specified opinion modifier on the target? | has_opinion_modifier = { target = X modifier = Y } |  | character |  |  |  |
| has_opposite_relation | Does the scoped character have an opposite relationship of the relation value with the target character? target = , relation = |  |  | character |  |  |  |
| has_owned_scheme | Does this character own a scheme? |  | yes/no | character |  |  |  |
| has_pending_interaction_of_type | Does the character have a pending interaction of the type? Only works if the scope is player-controlled. | Example: has_pending_interaction = interaction_key |  | character |  |  |  |
| has_perk | Does the character have this perk? |  |  | character |  |  |  |
| has_primary_title | Does the character has specific title as his primary title? |  | landed title scope | character | landed title |  |  |
| has_raid_immunity_against | Is the scoped character's (top-liege) realm immune to raiding by the target due to having defeated their raid army? | has_raid_immunity_against = scope:character | character scope | character | character |  |  |
| has_raised_armies | Does the character have raised or gathering armies? |  | yes/no | character |  |  |  |
| has_realm_law | Does the scoped character have the given realm law? |  |  | character |  |  |  |
| has_realm_law_flag | Does the scoped character have a law with the given flag? |  |  | character |  |  |  |
| has_relation_best_friend | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_bully | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_court_physician | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_crush | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_flag | Does the scope character have a specific flag on a relation with the target character? target = , relation = , flag = |  |  | character |  |  |  |
| has_relation_friend | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_guardian | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_intrigue_mentor | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_intrigue_student | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_lover | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_mentor | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_nemesis | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_oaf | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_potential_friend | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_potential_lover | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_potential_rival | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_rival | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_soldier_friend | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_soulmate | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_student | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_victim | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_relation_ward | Checks for a scripted relationship with a target character |  | character target | character |  |  |  |
| has_religion | Does the character have this religion? | has_religion = religion:buddhism_religion | religion scope | character | religion |  |  |
| has_revoke_title_reason | Does the character have the revoke title reason towards the target? |  | character target | character |  |  |  |
| has_same_culture_as | Does the character have the same culture as the target? |  | character target | character |  |  |  |
| has_same_focus_as | Does the character have the same focus as the other? |  | character target | character |  |  |  |
| has_same_government | Checks if the character has the same government type as another character |  | character target | character |  |  |  |
| has_secret_relation_best_friend | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_bully | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_court_physician | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_crush | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_friend | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_guardian | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_intrigue_mentor | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_intrigue_student | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_lover | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_mentor | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_nemesis | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_oaf | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_potential_friend | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_potential_lover | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_potential_rival | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_rival | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_soldier_friend | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_soulmate | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_student | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_victim | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_secret_relation_ward | Checks for a secret scripted relationship with a target character |  | character target | character |  |  |  |
| has_sexuality | Does the character's sexuality match the scripted? (heterosexual, homosexual, bisexual, asexual, none). Characters that have yet to get a sexuality (children) have none set. |  |  | character |  |  |  |
| has_strong_claim_on | Does the character have a pressed claim on the target title? |  | landed title target | character |  |  |  |
| has_strong_hook | Does the character have a strong hook on the target? | has_strong_hook = &lt;character&gt; | character scope | character | character |  |  |
| has_strong_usable_hook | Does the character have a strong hook on the target that is not on cooldown? | has_strong_usable_hook = &lt;character&gt; | character scope | character | character |  |  |
| has_targeting_faction | Is there a faction targeting the scoped character? |  | yes/no | character |  |  |  |
| has_title | Does the character hold the title? |  | landed title scope | character | landed title |  |  |
| has_trait | Does the character have this trait or a trait of this trait group? |  |  | character |  |  |  |
| has_trait_rank | Compare the trait rank of a character to a value or other character. | has_trait_rank = {<br>  trait = TRAIT_GROUP<br>  rank &lt;=> number (can be script value) # need only one of rank or character<br>  character &lt;=> character target # need only one of rank or character<br>}<br>Note that not having the trait and having rank 0 count as the same thing. rank &lt; X on its own will therefore return true for a character that does not have the trait. |  | character |  |  |  |
| has_trait_with_flag | Does the scope character have a trait with a certain flag? | has_trait_with_flag = can_not_marry |  | character |  |  |  |
| has_truce | Does the scope character have a truce with the target character? Truces are one way, which means we ask if the scope character can't attack the target character |  | character target | character |  |  |  |
| has_usable_hook | Does the character have a hook on the target that isn't on cooldown | has_usable_hook = &lt;character&gt; | character scope | character | character |  |  |
| has_weak_claim_on | Does the character have an unpressed claim on the target title? |  | landed title target | character |  |  |  |
| has_weak_hook | Does the character have a weak hook on the target? A strong hook will *not* count. | has_weak_hook = &lt;character&gt; | character scope | character | character |  |  |
| health | Does the character have the required health? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| highest_held_title_tier | What is the highest held landed title tier of the character? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| highest_skill | Is the skill the highest skill (excluding prowess) of the character? True if tied for highest |  |  | character |  |  |  |
| holds_landed_title | Is the scope character landed (holds a county or barony)? |  | yes/no | character |  |  |  |
| important_action_is_valid_but_invisible | Is there an important action available to the character, but they dismissed it? | important_action_is_valid_but_invisible = important_action_key |  | character |  |  |  |
| important_action_is_visible | Is there an important action shown to the character? | important_action_is_visible = important_action_key |  | character |  |  |  |
| in_activity_type | Is the character in an activity of the specified type? |  |  | character |  |  |  |
| in_activity_with | Is the character in the same activity? |  | character target | character |  |  |  |
| in_diplomatic_range | Are the scoped character and the target character within each other's diplomatic range? |  | character target | character |  |  |  |
| intrigue | Does the character have the required intrigue skill level? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| intrigue_diff | Does the character have the required intrigue skill level difference against target? | intrigue = { target = character value &lt;= script_value abs = yes/no(optional, default no) } | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| intrigue_for_portrait | Intrigue skill scaled between 0.0 and 1.0 for portraits |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| intrigue_lifestyle_perk_points | How many intrigue perk points does the character have available? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| intrigue_lifestyle_perks | How many intrigue perks does the character have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| intrigue_lifestyle_xp | How much intrigue lifestyle experience does the character have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| is_a_faction_leader | Is the scoped character a leader of a faction? |  | yes/no | character |  |  |  |
| is_a_faction_member | Is the scoped character a member of a faction? |  | yes/no | character |  |  |  |
| is_adult | Is the scoped character adult? |  | yes/no | character |  |  |  |
| is_agent_exposed_in_scheme | Is the scoped character an exposed agent in the target scheme? |  |  | character |  |  |  |
| is_ai | Is the character played by AI? |  | yes/no | character |  |  |  |
| is_alive | Is the character alive? |  | yes/no | character |  |  |  |
| is_allied_in_war | Is the scoped character allied to the target character in a war? |  | character target | character |  |  |  |
| is_allied_to | Is the scoped character allied to the target character? |  | character target | character |  |  |  |
| is_at_home | Is the character at home? |  | yes/no | character |  |  |  |
| is_at_location | Is the character currently in the target province? |  | province target | character |  |  |  |
| is_at_same_location | Is the character currently in the same province as the target character? |  | character target | character |  |  |  |
| is_at_war | Is the character at war? Does not consider lieges' wars |  | yes/no | character |  |  |  |
| is_at_war_as_attacker | Is the character at war as an attacker? Does not consider lieges' wars |  | yes/no | character |  |  |  |
| is_at_war_as_defender | Is the character at war as a defender? Does not consider lieges' wars |  | yes/no | character |  |  |  |
| is_at_war_with | Is the character at war with the target? Does not consider lieges' wars |  | character target | character |  |  |  |
| is_at_war_with_liege | Is the character at war with their liege? |  | yes/no | character |  |  |  |
| is_attacker_in_war | Is the scope character in the target war as an attacker? |  |  | character |  |  |  |
| is_attracted_to_gender_of | Does the sexuality of the scope character make them attracted to the target character? |  | character target | character |  |  |  |
| is_attracted_to_men | Is the character attracted to men? |  | yes/no | character |  |  |  |
| is_attracted_to_women | Is the character attracted to women? |  | yes/no | character |  |  |  |
| is_away_from_court | Is the character away from the court? |  | yes/no | character |  |  |  |
| is_betrothed | Is the scope character betrothed? |  | yes/no | character |  |  |  |
| is_causing_raid_hostility_towards | Is the scoped character making the target hostile due to having raided their (top-liege's) realm? | is_causing_raid_hostility_towards = scope:character | character scope | character | character |  |  |
| is_character_interaction_potentially_accepted | Is the character interaction specified available and potentially accepted for the target character? | is_character_interaction_potentially_accepted = {<br>    recipient = character<br>    interaction = interaction_name<br>} |  | character |  |  |  |
| is_character_interaction_shown | Is the character interaction specified shown for the target character? | is_character_interaction_shown = {<br>    recipient = character<br>    interaction = interaction_name<br>} |  | character |  |  |  |
| is_character_interaction_valid | Is the character interaction specified valid (shown and usable) for the target character? | is_character_interaction_valid = {<br>    recipient = character<br>    interaction = interaction_name<br>} |  | character |  |  |  |
| is_character_window_main_character | Does the local player have knowledge about the secret? | An interface trigger, can only be used in specific places | yes/no | character |  |  |  |
| is_child_of | Is the character a child of the target character? |  | character target | character |  |  |  |
| is_claimant | Is the character a claimant to any landed titles? |  | yes/no | character |  |  |  |
| is_clergy | Is the scoped character clergy? |  | yes/no | character |  |  |  |
| is_close_family_of | Is the character a close family [parents, children, siblings, grandparents, grandchildren] of the target character? |  | character target | character |  |  |  |
| is_close_or_extended_family_of | Is the character a close or extended family [parents, children, siblings, grandparents, grandchildren, cousins, uncles, aunts, nephews, nieces] of the target character? |  | character target | character |  |  |  |
| is_commanding_army | Is the character commanding an army? |  | yes/no | character |  |  |  |
| is_concubine | Is the scoped character a concubine? |  | yes/no | character |  |  |  |
| is_concubine_of | Is the target character a concubine of the scoped character? |  | character target | character |  |  |  |
| is_consort_of | Is the character a spouse or concubine of the target character? |  | character target | character |  |  |  |
| is_councillor | Is the scoped character a councillor? |  | yes/no | character |  |  |  |
| is_councillor_of | Is the scoped character a councillor for the specified character? |  | character target | character |  |  |  |
| is_courtier | Is the scope character a courtier? |  | yes/no | character |  |  |  |
| is_courtier_of | Is the scoped character a courtier of the target character? |  | character target | character |  |  |  |
| is_cousin_of | Is the character a cousin of the target character? |  | character target | character |  |  |  |
| is_defender_in_war | Is the scoped character in the target war as a defender? |  |  | character |  |  |  |
| is_employer_of | Is the target character a courtier of the scope character? |  | character target | character |  |  |  |
| is_extended_family_of | Is the character extended family [cousins, uncles, aunts, nephews, nieces] of the target character? |  | character target | character |  |  |  |
| is_female | Is the scoped character female? |  | yes/no | character |  |  |  |
| is_forbidden_from_scheme | Is the scoped character forbidden from joining the target scheme? |  |  | character |  |  |  |
| is_forced_into_faction | Is the scope character forced to be part of a faction? |  | yes/no | character |  |  |  |
| is_forced_into_scheme | Checks if the scope character is forced into the target scheme |  |  | character |  |  |  |
| is_foreign_court_guest | Is the character a guest from another a court? In contrast to is_pool_guest the character has a liege |  | yes/no | character |  |  |  |
| is_foreign_court_guest_of | Is the character a guest from another a court, visiting the target character's court? In contrast to is_pool_guest_of the character has a liege |  | character target | character |  |  |  |
| is_foreign_court_or_pool_guest | Is the character a guest? (is_pool_guest or is_foreign_court_guest) |  | yes/no | character |  |  |  |
| is_foreign_court_or_pool_guest_of | Is the character a guest? (is_pool_guest_of or is_foreign_court_guest_of) |  | character target | character |  |  |  |
| is_grandchild_of | Is the character a grandchild of the target character? |  | character target | character |  |  |  |
| is_grandparent_of | Is the character a grandparent of the target character? |  | character target | character |  |  |  |
| is_great_grandchild_of | Is the character a great grandchild of the target character? |  | character target | character |  |  |  |
| is_great_grandparent_of | Is the character a great grandparent of the target character? |  | character target | character |  |  |  |
| is_heir_of | Is the character an heir of the target [placeholder]? |  | character target | character |  |  |  |
| is_immortal | Is the character immortal? |  | yes/no | character |  |  |  |
| is_imprisoned | is the character imprisoned? |  | yes/no | character |  |  |  |
| is_imprisoned_by | Is the scope character imprisoned by the target character? | is_imprisoned_by = TARGET | character target | character |  |  |  |
| is_in_an_activity | Checks whether the character is currently in, or has joined an activity |  | yes/no | character |  |  |  |
| is_in_army | Is the character in an army (a commander or a knight)? |  | yes/no | character |  |  |  |
| is_in_civil_war | Is the character at war with their liege, or one or more of their vassals? |  | yes/no | character |  |  |  |
| is_in_ongoing_great_holy_war | Is the character in an ongoing (i.e. the war has started) great holy war? |  | yes/no | character |  |  |  |
| is_in_pool_at | Is the character in the pool the target province is a part of |  | province target | character |  |  |  |
| is_in_prison_type | Is the character imprisoned in a prison of the specified type? Accepts any static modifier (see also imprison effect). | is_in_prison_type = house_arrest |  | character |  |  |  |
| is_in_target_activity | Is the scope character participating in the target activity? |  |  | character |  |  |  |
| is_in_the_same_court_as | Is the character in the same court as the target character (they have the same court owner or one is a courtier of the other)? |  | character target | character |  |  |  |
| is_in_the_same_court_as_or_guest | Is the character in the same court as the target character (they have the same court owner or one is a courtier of the other)? Includes guests in the court. |  | character target | character |  |  |  |
| is_incapable | Is the character incapable? |  | yes/no | character |  |  |  |
| is_independent_ruler | Is the character an independent ruler? |  | yes/no | character |  |  |  |
| is_knight | Is the scoped character a knight? |  | yes/no | character |  |  |  |
| is_knight_of | Is the scoped character a knight of the target character? |  | character target | character |  |  |  |
| is_landed | Is the scoped character landed (holds a county or barony)? |  | yes/no | character |  |  |  |
| is_leader_in_war | Is the scoped character leading one of the sides in the target war? |  |  | character |  |  |  |
| is_leading_faction_type | Is the character leading a faction of the specified type? |  |  | character |  |  |  |
| is_liege_or_above_of | Is the scope character a liege or above of the target character? |  | character target | character |  |  |  |
| is_local_player | Is the character the local player? | An interface trigger, can only be used in specific places | yes/no | character |  |  |  |
| is_lowborn | Is the character lowborn? |  | yes/no | character |  |  |  |
| is_male | Is the scope character male? |  | yes/no | character |  |  |  |
| is_married | Is the scope character married? |  | yes/no | character |  |  |  |
| is_nibling_of | Is the character a nibling (niece/nephew) of the target character? |  | character target | character |  |  |  |
| is_normal_councillor | Is the scoped character a regular councillor? |  | yes/no | character |  |  |  |
| is_obedient | Is the character obedient towards the target? |  | character target | character |  |  |  |
| is_overriding_designated_winner | Is the scoped character overriding the winner in the GHW they're pledged to (will put their beneficiary on the throne if they're top participant)? |  | yes/no | character |  |  |  |
| is_parent_of | Is the character a parent of the target character? |  | character target | character |  |  |  |
| is_participant_in_war | Is the scope character participating in the target war as an attacker or defender? |  |  | character |  |  |  |
| is_performing_council_task | Is the scoped character performing the given task? |  |  | character |  |  |  |
| is_player_heir_of | Is the scope character the player heir of the target character? |  | character target | character |  |  |  |
| is_pledged_ghw_attacker | Is the scoped character a pledged attacker in the current GHW? (it's an error to check this if there's no GHW around) |  | yes/no | character |  |  |  |
| is_pool_character | Is the character in the pool? (not a ruler, courtier or guest at any court) |  | yes/no | character |  |  |  |
| is_pool_guest | Is the character a guest from the pool? In contrast to is_foreign_court_guest the character has no liege |  | yes/no | character |  |  |  |
| is_pool_guest_of | Is the character a guest from the pool, visiting the target character's court? In contrast to is_foreign_court_guest_of the character has no liege |  | character target | character |  |  |  |
| is_powerful_vassal | Is the character a powerful vassal? |  | yes/no | character |  |  |  |
| is_powerful_vassal_of | Is the character a powerful vassal of the target? |  | character target | character |  |  |  |
| is_pregnant | Is the character pregnant? |  | yes/no | character |  |  |  |
| is_primary_heir_of | Is the character the heir of the target's primary title? |  | character target | character |  |  |  |
| is_ruler | Is the scope character a ruler (holds any title)? |  | yes/no | character |  |  |  |
| is_scheming_against | Checks whether the scope character is an owner or an owner agent in a scheme against the target. There are 3 possible ways to use it: | - is_scheming_against = { target = X type = Y } limits to schemes of type Y<br>- is_scheming_against = { target = X scheme_skill = Y } limits to schemes of Y skill category<br>- is_scheming_against = { target = X } considers all schemes |  | character |  |  |  |
| is_sibling_of | Is the character a sibling of the target character? |  | character target | character |  |  |  |
| is_spouse_of | Is the character a spouse of the target character, and are both alive? |  | character target | character |  |  |  |
| is_spouse_of_even_if_dead | Is the character a spouse of the target character, even if one or both are dead? |  | character target | character |  |  |  |
| is_theocratic_lessee | Is the scope character a theocratic lessee (bishop)? |  | yes/no | character |  |  |  |
| is_travelling | Is the scope character travelling ? |  | yes/no | character |  |  |  |
| is_twin_of | Is the character a twin of the target character? |  | character target | character |  |  |  |
| is_unborn_child_of_concubine | Is the unborn a child of a concubine? |  | yes/no | character |  |  |  |
| is_unborn_known_bastard | Is the unborn a known bastard? |  | yes/no | character |  |  |  |
| is_uncle_or_aunt_of | Is the character an uncle or aunt of the target character? |  | character target | character |  |  |  |
| is_valid_as_agent_in_scheme | Is the scope character suitable as an agent for the target scheme? |  |  | character |  |  |  |
| is_vassal_of | Is the character a direct vassal of the target character? |  | character target | character |  |  |  |
| is_vassal_or_below_of | Is the scoped character a vassal or below of the target character? |  | character target | character |  |  |  |
| is_visibly_fertile | Is the scoped character visibly fertile, that is: not too old if a woman, not too young and has no traits blocking having children |  | yes/no | character |  |  |  |
| join_faction_chance | Check the chance of the scope character to join the faction against the scripted value | join_faction_chance = { <br>    faction = faction_target #An ongoing faction<br>    value <|<=|>=|> 0<br>} |  | character |  |  |  |
| join_scheme_chance | Check if the chance of the scope character to join the scheme is between the given range (being min and max exclusive) | join_scheme_chance = { <br>    scheme = scheme_target #An ongoing scheme<br>    max = 0<br>    min = -10<br>} |  | character |  |  |  |
| learning | Does the character have the required learning skill level? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| learning_diff | Does the character have the required learning skill level difference against target? | learning = { target = character value &lt;= script_value abs = yes/no(optional, default no) } | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| learning_for_portrait | Learning skill scaled between 0.0 and 1.0 for portraits |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| learning_lifestyle_perk_points | How many learning lifestyle perk points does the character have available? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| learning_lifestyle_perks | How many learning lifestyle perks does the character have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| learning_lifestyle_xp | How much learning lifestyle experience does the character have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| long_term_gold | Does the character have the required gold? (AI category long term) |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| martial | Does the character have the required martial skill level? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| martial_diff | Does the character have the required martial skill level difference against target? | martial = { target = character value &lt;= script_value abs = yes/no(optional, default no) } | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| martial_for_portrait | Martial skill scaled between 0.0 and 1.0 for portraits |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| martial_lifestyle_perk_points | How many martial perk points does the character have available? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| martial_lifestyle_perks | How many martial lifestyle perks does the character have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| martial_lifestyle_xp | How much martial lifestyle experience does the character have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| matrilinear_betrothal | Is this character's betrothal matrilinear? False if there's no betrothal. |  | yes/no | character |  |  |  |
| matrilinear_marriage | Is the marriage with the spouse matrilinear? |  | yes/no | character |  |  |  |
| max_military_strength | Is the scoped character's max military strength this big? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| max_number_maa_soldiers_of_base_type | Does the scope character have value amount of max soldiers of men at arms of the base type? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| max_number_maa_soldiers_of_type | Does the scope character have value amount of max soldiers of men at arms of the type? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| max_number_of_concubines | The maximum number of concubines a character can have | max_number_of_concubines > 2 | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| max_number_of_knights | Check how many knights the scoped character can potentially have |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| missing_unique_ancestors | The amount of missing unique ancestors from the character's real father and mother | Traverses the family tree for NDefines::NChildbirth::INBREEDING_ANCESTOR_GENERATIONS amount of generations. By default this means that we're traversing 62 ancestors and report the number of duplicates we find.<br>calc_missing_unique_ancestors > 10 | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| monthly_character_balance | Is the scoped character's monthly balance this big? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| monthly_character_expenses | Is the scoped character's monthly expenses this big? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| monthly_character_income | Is the scoped character's monthly income this big? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_bad_genetic_traits | Compare the number of bad genetic traits | &lt;charater> = { num_of_bad_genetic_traits = 0 } | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_good_genetic_traits | Compare the number of good genetic traits | &lt;charater> = { num_of_good_genetic_traits &gt;= 2 } | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_best_friend | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_bully | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_court_physician | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_crush | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_friend | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_guardian | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_intrigue_mentor | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_intrigue_student | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_lover | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_mentor | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_nemesis | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_oaf | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_potential_friend | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_potential_lover | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_potential_rival | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_rival | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_soldier_friend | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_soulmate | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_student | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_victim | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_of_relation_ward | Compares the number of scripted relations a character has of the type |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_sinful_traits | Does the scoped character have this many virtuous traits? | - num_virtuous_traits > 5<br>- num_virtuous_traits = { value > 5 faith = scope:faith } to base it on what a specific faith considers virtuous | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| num_virtuous_traits | Does the scoped character have this many virtuous traits? | - num_virtuous_traits > 5<br>- num_virtuous_traits = { value > 5 faith = scope:faith } to base it on what a specific faith considers virtuous | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_maa_regiments_of_base_type | Does the scoped character have value amount of men at arms of the base type? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_maa_regiments_of_type | Does the scoped character have value amount of men at arms of the type? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_maa_soldiers_of_base_type | Does the scoped character have value amount of soldiers of men at arms of the base type? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_maa_soldiers_of_type | Does the scoped character have value amount of soldiers of men at arms of the type? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_of_commander_traits | Does the character have this many commander traits? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_of_commander_traits_in_common | Does the character and the target have a number of commander traits in common? | number_of_personality_traits_in_common = { target = X value &gt;/&lt;/&gt;=/&lt;= Y } |  | character |  |  |  |
| number_of_concubines | The number of concubines the scoped character has | number_of_concubines > 2 | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_of_desired_concubines | The number of fertile concubines the scoped character should have to not get penalties | number_of_desired_concubines > 2 | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_of_election_votes | Check the number of votes the scoped character has in the target title | number_of_election_votes = { title = scope:actor.primary_title value = 0 } | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_of_fertile_concubines | The number of visibly fertile concubines the scoped character has | number_of_fertile_concubines > 2 | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_of_knights | Check how many knights the scoped character has at the moment |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_of_lifestyle_traits | Does the character have this many lifestyle traits? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_of_maa_regiments | The number of men at arms the scoped character has |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_of_opposing_personality_traits | Does the character and the target have a number of opposing personality traits? | number_of_opposing_personality_traits = { target = X value &gt;/&lt;/&gt;=/&lt;= Y } |  | character |  |  |  |
| number_of_opposing_traits | Does the character and the target have a number of opposing traits? | number_of_opposing_traits = { target = X value &gt;/&lt;/&gt;=/&lt;= Y } |  | character |  |  |  |
| number_of_personality_traits | Does the character have this many personality traits? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_of_personality_traits_in_common | Does the character and the target have a number of personality traits in common? | number_of_personality_traits_in_common = { target = X value &gt;/&lt;/&gt;=/&lt;= Y } |  | character |  |  |  |
| number_of_powerful_vassals | Does the character have a specified number of powerful vassals? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_of_traits | Does the character have this many traits? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| number_of_traits_in_common | Does the character and the target have a number of traits in common? | number_of_traits_in_common = { target = X value &gt;/&lt;/&gt;=/&lt;= Y } |  | character |  |  |  |
| opinion | Is the character's opinion of the target greater or equal than the value? | opinion = { target = X [*value &gt;/&lt;/&gt;=/&lt;= Y* or *value = { min max }*  } |  | character |  |  |  |
| owns_a_story | Ćhecks whether the scope character is the owner of any currently active story |  | yes/no | character |  |  |  |
| owns_an_activity | Checks whether the scope character is the owner of any currently active activity |  | yes/no | character |  |  |  |
| owns_story_of_type | Does the character own a story of this type? |  |  | character |  |  |  |
| patrilinear_betrothal | Is this character's betrothal patrilinear? False if there's no betrothal. |  | yes/no | character |  |  |  |
| patrilinear_marriage | Is the marriage with the spouse patrilinear? |  | yes/no | character |  |  |  |
| perk_points | Does the character have this many perk points across all lifestyles combined? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| perk_points_assigned | Does the character have this many perks across all lifestyles combined? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| perks_in_tree | Does the character have this many perk points assigned to this tree? perks_in_tree = { tree = tree_key value > 5 } |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| piety | Does the character have the required piety? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| piety_level | Does the character have the required devotion level? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| player_heir_position | Check where the target character is in the scoped character's player heir list. | player_heir_position = { target = scope:actor position = 0 } | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| pregnancy_days | How long has the character been pregnant? Counts from impregnation, not reveal |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| prestige | Does the character have the required prestige? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| prestige_level | Does the character have the required fame level? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| prowess | Does the character have the required prowess skill level? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| prowess_diff | Does the character have the required prowess skill level difference against target? | prowess = { target = character value &lt;= script_value abs = yes/no(optional, default no) } | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| prowess_for_portrait | Prowess skill scaled between 0.0 and 1.0 for portraits |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| ransom_cost | What is the ransom cost of the character? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| realm_size | Is the scoped character's top liege's realm this big (# of counties)? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| realm_to_title_distance_squared | Is the character's realm within this distance of the title? Distance is in pixels, squared for performance reasons. | realm_to_title_distance_squared = { title = some_title value > 10000 } | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| reverse_has_opinion_modifier | Does the target have the specified opinion modifier on the character? (optional *value <|<=|=|>=|> X* or *value = { MIN MAX }* inclusive) |  |  | character |  |  |  |
| reverse_opinion | What is the target character's opinion of the scope character? opinion = { target = X value &gt;/&lt;/&gt;=/&lt;= Y } |  |  | character |  |  |  |
| scriptedtests_can_marry_character | Can the character marry the target character? |  | character target | character |  |  |  |
| scriptedtests_dread_base | Does the character have the specified natural dread? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| scriptedtests_piety_income | does the character have the specified piety income? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| sex_opposite_of | Are the scope character and the target character of opposite sex? |  | character target | character |  |  |  |
| sex_same_as | Are the scope character and the target character of the same sex? |  | character target | character |  |  |  |
| short_term_gold | Does the character have the required gold? (AI category short term) |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| should_show_disturbing_portrait_modifiers | Is the character the local player? | An interface trigger, can only be used in specific places | yes/no | character |  |  |  |
| stewardship | Does the character have the required stewardship skill level? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| stewardship_diff | Does the character have the required stewardship skill level difference against target? | stewardship = { target = character value &lt;= script_value abs = yes/no(optional, default no) } | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| stewardship_for_portrait | Stewardship skill scaled between 0.0 and 1.0 for portraits |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| stewardship_lifestyle_perk_points | How many perk points available does the character have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| stewardship_lifestyle_perks | How many perks from this lifestyle does the character have? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| stewardship_lifestyle_xp | How many stewardship perk points does the character have available? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| stress | Does the character have the required stress? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| stress_level | Does the character have the required stress level? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| sub_realm_size | Is the scoped character's sub-realm this big (# of counties)? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| target_is_liege_or_above | Is the target character the liege or above the scoped character? |  | character target | character |  |  |  |
| target_is_same_character_or_above | Is the target character the scoped character or above them in the vassal hierarchy? |  | character target | character |  |  |  |
| target_is_vassal_or_below | Is the target character a vassal or below of the scope character? |  | character target | character |  |  |  |
| target_weight | Target weight of the scoped character | target_weight > 10 | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| tier_difference | What is the difference in highest held title tier between the scoped character and the target character? (-5 to 5) | For example, this is true:<br>scope:a_baron = {<br>    tier_difference = {<br>        target = scope:a_king<br>        value = -3<br>    }<br>} |  | character |  |  |  |
| time_in_prison | How long has the character been imprisoned? time_in_prison = { days/months/years =,&gt;,&lt; X } |  |  | character |  |  |  |
| time_in_prison_type | How long has the character been imprisoned with the current imprisonment type? time_in_prison_type = { days/months/years =,&gt;,&lt; X } |  |  | character |  |  |  |
| trait_compatibility | target = other character value &gt;/&lt;/= sum of trait compatibility values |  |  | character |  |  |  |
| tyranny | Does the character have the required tyranny? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| vassal_contract_has_flag | Do any of the current active obligations in the scoped character's vassal contract have the given flag? |  |  | character |  |  |  |
| vassal_contract_has_modifiable_obligations | Can the scoped character's contract be modified at all? That is: they have one, they use obligation levels, and are count or above |  | yes/no | character |  |  |  |
| vassal_contract_is_blocked_from_modification | Has the scoped character's contract been blocked from modification by script via 'set_vassal_contract_modification_blocked'? |  | yes/no | character |  |  |  |
| vassal_contract_obligation_level_can_be_decreased | Can the obligation level of the scoped character's vassal contract be decreased? |  |  | character |  |  |  |
| vassal_contract_obligation_level_can_be_increased | Can the obligation level of the scoped character's vassal contract be increased? |  |  | character |  |  |  |
| vassal_count | Does the scoped character have this many vassals (excluding barons)? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| vassal_limit | Is the scoped character's vassal limit this big? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| vassal_limit_available | Is there this much space left in the character's vassal limit? Negative values also work for checking characters that are above their limit |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| vassal_limit_percentage | Is the scoped character's vassal count this big in comparison to their limit? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| yearly_character_balance | Is the scoped character's yearly balance this big? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| yearly_character_expenses | Is the scoped character's yearly expenses this big? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| yearly_character_income | Is the scoped character's yearly income this big? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | character |  |  |  |
| yields_alliance | Checks if the character would get an alliance with the target character through such a marriage. |  |  | character |  |  |  |
| any_faction_county_member | Iterate through all faction county members | any_faction_county_member = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | faction | landed title |  |  |
| any_faction_member | Iterate through all faction character members | any_faction_member = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | faction | character |  |  |
| average_faction_opinion | Average opinion of all the characters of the faction scope target |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | faction |  |  |  |
| average_faction_opinion_not_powerful_vassal | Average opinion of the character that are *not* powerful vassals of the faction scope target |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | faction |  |  |  |
| average_faction_opinion_powerful_vassal | Average opinion of the character that are powerful vassals of the faction scope target |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | faction |  |  |  |
| faction_can_press_demands | Can the scoped faction press demands? |  | yes/no | faction |  |  |  |
| faction_discontent | Current discontent of the faction |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | faction |  |  |  |
| faction_is_at_war | Is the scoped faction at war? |  | yes/no | faction |  |  |  |
| faction_is_type | Is the faction of this type? |  |  | faction |  |  |  |
| faction_power | Current power of the faction. Uses percentages as whole numbers. | faction_power &gt;= 80 | &lt;, &lt;=, =, !=, &gt;, &gt;= | faction |  |  |  |
| faction_power_threshold | Current power threshold of the faction |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | faction |  |  |  |
| has_special_character | Does the faction have a special character assigned? |  | yes/no | faction |  |  |  |
| has_special_title | Does the faction have a special title assigned? |  | yes/no | faction |  |  |  |
| number_of_faction_members_in_council | Current number of faction members in faction |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | faction |  |  |  |
| any_war_attacker | Iterate through all attackers in the war | any_war_attacker = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | war | character |  |  |
| any_war_defender | Iterate through all defenders in the war | any_war_defender = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | war | character |  |  |
| any_war_participant | Iterate through all participants in the war | any_war_participant = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | war | character |  |  |
| attacker_war_score | Compares the attacker war score |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | war |  |  |  |
| days_since_max_war_score | Number of days since the war score has been at max (+100 or −100). Returns -1 if the war score is not +100 or −100 |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | war |  |  |  |
| defender_war_score | Compares the defender war score |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | war |  |  |  |
| has_valid_casus_belli | Does the war interaction still have a valid casus belli? (Those should be automatically removed on daily tick, but can exist for a tick) |  | yes/no | war |  |  |  |
| is_attacker | Is the target character in the scope war as an attacker? |  | character target | war |  |  |  |
| is_civil_war | Check if the scope war is a civil war or not |  | yes/no | war |  |  |  |
| is_defender | Is the target character in the scoped war as a defender? |  | character target | war |  |  |  |
| is_participant | Is the target character participating in the scope war as either an attacker or defender? |  | character target | war |  |  |  |
| is_war_leader | Is the target character leading one of the sides in the scoped war? |  | character target | war |  |  |  |
| is_white_peace_possible | Check if the scoped war's CB allows white peace (is_white_peace_possible = yes) |  | yes/no | war |  |  |  |
| using_cb | Is the scope war using the specified CB? | using_cb = religious_war |  | war |  |  |  |
| war_contribution | Checks how much a character has contributed to the scoped war | war_contribution = {<br>target = some character<br>value > 5<br>} |  | war |  |  |  |
| war_days | Compares the number of days the war has gone on for |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | war |  |  |  |
| was_called | Has the target character been called to the scope war already? |  | character target | war |  |  |  |
| any_defensive_great_holy_wars | Iterate through all great holy wars this faith is defending against | any_defensive_great_holy_wars = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | faith | great holy war |  |  |
| any_faith_holy_order | Iterate through all holy orders of the faith | any_faith_holy_order = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | faith | holy order |  |  |
| any_holy_site | Iterate through all holy site baronies of a faith | any_holy_site = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | faith | landed title |  |  |
| controls_holy_site | Does the faith control a holy site? controls_holy_site = key_of_holy_site |  |  | faith |  |  |  |
| controls_holy_site_with_flag | Does the faith control a holy site with the given flag? controls_holy_site_with_flag = some flag |  |  | faith |  |  |  |
| estimated_faith_strength | How strong is the scoped faith? *Expensive*, if you're gonna use the value repeatedly, save it to a scope first! This is scaled by a factor of 1000, so '1' means 1000 men. This is due to the cap of ~2 million, which would be too low in many cases |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | faith |  |  |  |
| faith_hostility_level | What is the faith's hostility level towards the target faith? | faith_hostility_level { target = scope:some_faith value > 1 }<br><br>The levels are<br>- 0 righteous<br>- 1 astray<br>- 2 hostile<br>- 3 evil | &lt;, &lt;=, =, !=, &gt;, &gt;= | faith |  |  |  |
| faith_hostility_level_comparison | Compares the scoped faith's hostility level towards two other faiths. | faith_hostility_level_comparison { faith1 > faith2 } |  | faith |  |  |  |
| fervor | What is the faith's fervor? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | faith |  |  |  |
| has_allowed_gender_for_clergy | Is the target character of the allowed gender to be clergy of the faith? |  | character target | faith |  |  |  |
| has_doctrine | Does the given faith have the given doctrine? | has_doctrine = doctrine_key |  | faith |  |  |  |
| has_doctrine_parameter | Does the given faith have the given doctrine parameter? Can only check for bool parameters. | has_doctrine_parameter = parameter_key |  | faith |  |  |  |
| has_dominant_ruling_gender | Is the target character's gender of the dominant gender of the faith? True if there's no dominant gender |  | character target | faith |  |  |  |
| has_graphical_faith | Does the faith have this graphical faith? | &lt;faith> = { has_graphical_faith = orthodoxgfx } |  | faith |  |  |  |
| has_icon | Does the faith have the given icon? | has_icon = some_cool_custom_icon |  | faith |  |  |  |
| has_preferred_gender_for_clergy | Is the target character of the preferred gender to be clergy of the faith? |  | character target | faith |  |  |  |
| holy_sites_controlled | How many holy sites does the faith control? | holy_sites_controlled > 1 | &lt;, &lt;=, =, !=, &gt;, &gt;= | faith |  |  |  |
| num_character_followers | How many characters follow the scoped faith? | num_character_followers > 0 | &lt;, &lt;=, =, !=, &gt;, &gt;= | faith |  |  |  |
| num_county_followers | How many counties follow the scoped faith? | num_county_followers > 0 | &lt;, &lt;=, =, !=, &gt;, &gt;= | faith |  |  |  |
| religion_tag | Checks the tag of the religion of the current faith | religion_tag = christianity_religion |  | faith |  |  |  |
| trait_is_sin | Does the scoped faith consider the given trait sinful? | trait_is_sin = lustful |  | faith |  |  |  |
| trait_is_virtue | Does the scoped faith consider the given trait virtuous? | trait_is_virtue = lustful |  | faith |  |  |  |
| any_secret_knower | Iterate through all characters who know the scoped secret | any_secret_knower = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | secret | character |  |  |
| any_secret_participant | Iterate through participants in a secret | any_secret_participant = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | secret | character |  |  |
| can_be_exposed_by | Can the scope secret be exposed by the target character? | can_be_exposed_by = target | character target | secret |  |  |  |
| is_criminal_for | Is this secret criminal for the target participant? | is_criminal_for = &lt;character&gt; | character scope | secret | character |  |  |
| is_known_by | Is the scoped secret known by the target character? |  | character target | secret |  |  |  |
| is_shunned_for | Is this secret shunned for the target participant? | is_shunned_for = &lt;character&gt; | character scope | secret | character |  |  |
| is_shunned_or_criminal_for | Is this secret shunned or criminal for the target participant? | is_shunned_or_illegal_for = &lt;character&gt; | character scope | secret | character |  |  |
| is_spent_by | Has the scoped secret been spent by the target character? | is_spent_by = target | character target | secret |  |  |  |
| local_player_knows_this_secret | Does the local player know about the secret? | An interface trigger, can only be used in specific places | yes/no | secret |  |  |  |
| same_secret_type_as | Is the scoped secret of the same type as the target secret? | same_secret_type_as = scope:some_secret |  | secret |  |  |  |
| secret_type | Is the scoped secret of the specified type? |  |  | secret |  |  |  |
| available_loot | How much gold is available to loot for raiding armies? | available_loot &gt;= 7 | &lt;, &lt;=, =, !=, &gt;, &gt;= | province |  |  |  |
| building_slots | How many building slots exist (including occupied ones)? | building_slots > 3 | &lt;, &lt;=, =, !=, &gt;, &gt;= | province |  |  |  |
| combined_building_level | How many levels of normal buildings are there? Duchy and such buildings do not count. Building under construction does not count. The capital building does count | combined_building_level > 10 | &lt;, &lt;=, =, !=, &gt;, &gt;= | province |  |  |  |
| fort_level | Compares the fort level of a province |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | province |  |  |  |
| free_building_slots | How many free building slots exist? A building under construction is considered to be taking a slot | free_building_slots > 3 | &lt;, &lt;=, =, !=, &gt;, &gt;= | province |  |  |  |
| geographical_region | Checks if a province is in a certain geographical region |  |  | province |  |  |  |
| has_building | Does the scoped province have a particular building? | has_building = temple_01 |  | province |  |  |  |
| has_building_or_higher | Does the scoped province have a particular building or one of its upgrades? | has_building_or_higher = temple_01 |  | province |  |  |  |
| has_building_with_flag | Does the scoped province have a building with a certain flag? | - has_building_with_flag = { flag = temple count &gt;= 2 }<br>- has_building_with_flag = temple # count &gt;= 1 |  | province |  |  |  |
| has_construction_with_flag | Does the scoped province have a construction of a building with the specified flag? | has_construction_with_flag = temple |  | province |  |  |  |
| has_free_building_slot | Does the scoped province have a free building slot? | has_free_building_slot = yes | yes/no | province |  |  |  |
| has_holding_type | Does the scope province have a holding of particular type? | has_holding_type = castle_holding |  | province |  |  |  |
| has_ongoing_construction | Does the scoped province have a construction ongoing? | has_ongoing_construction = yes | yes/no | province |  |  |  |
| has_province_modifier | Does the scoped province have a given modifier? | has_province_modifier = name |  | province |  |  |  |
| has_province_modifier_duration_remaining | Does the scoped province have the duration remaining on a given modifier? | has_province_modifier_duration_remaining = name |  | province |  |  |  |
| has_special_building | Does the province (holding) have a special building? |  | yes/no | province |  |  |  |
| has_special_building_slot | Does the province (holding) have a special building slot? |  | yes/no | province |  |  |  |
| is_coastal | is the province a coastal province? |  | yes/no | province |  |  |  |
| is_county_capital | Is the province the county capital? |  | yes/no | province |  |  |  |
| monthly_income | Check the income of the scoped province | monthly_income > 10 | &lt;, &lt;=, =, !=, &gt;, &gt;= | province |  |  |  |
| num_buildings | How many normal buildings are there? Duchy and such buildings do not count. A building under construction does count | num_buildings > 3 | &lt;, &lt;=, =, !=, &gt;, &gt;= | province |  |  |  |
| number_of_characters_in_pool | Check the number of characters in the pool the scoped province is a part of |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | province |  |  |  |
| terrain | Checks if a province is of a specific terrain type |  |  | province |  |  |  |
| any_leased_title | Iterate through all titles leased to the scoped holy order | any_leased_title = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | holy order | landed title |  |  |
| num_leased_titles | How many holdings the holy order has under lease |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | holy order |  |  |  |
| activity_has_been_activated | Is the activity activated? |  | yes/no | activity |  |  |  |
| any_activity_declined | Iterate through all characters who declined an activity invite to a specific activity | any_activity_declined = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | activity | character |  |  |
| any_activity_invited | Iterate through all characters who have unanswered invites to a specific activity | any_activity_invited = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | activity | character |  |  |
| any_participant | Iterate through all participants in an activity | any_participant = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | activity | character |  |  |
| is_target_participating | Is the target character participating in the scoped activity? |  | character target | activity |  |  |  |
| number_of_participants | The number of activity participants (including the owner) |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | activity |  |  |  |
| any_target_title | Iterate through all casus belli's target titles | any_target_title = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | casus belli | landed title |  |  |
| army_is_moving | Is this army moving? |  | yes/no | army |  |  |  |
| army_max_size | What is this army's max size? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | army |  |  |  |
| army_size | what size is this army? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | army |  |  |  |
| is_army_in_combat | Is the scoped army in combat? |  | yes/no | army |  |  |  |
| is_army_in_raid | Is the scoped army in a raid (this includes a raid interrupted by combat)? |  | yes/no | army |  |  |  |
| is_army_in_siege | Is the scoped army in a siege (this includes a siege interrupted by combat)? |  | yes/no | army |  |  |  |
| is_army_in_siege_relevant_for | Is the scoped army in a siege that is relevant to the target character? | is_army_in_siege_relevant_for = scope:character | character scope | army | character |  |  |
| is_raid_army | Is the scoped army a raid army? |  | yes/no | army |  |  |  |
| raid_loot | How much raid loot is the army carrying? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | army |  |  |  |
| building_max_garrison | The max amount of garrison in a county or province from buildings | building_max_garrison > 100 | &lt;, &lt;=, =, !=, &gt;, &gt;= | landed title, province |  |  |  |
| building_levies | The amount of levies in a county or province from buildings | levies > 100 | &lt;, &lt;=, =, !=, &gt;, &gt;= | landed title, province |  |  |  |
| squared_distance | How far away is the province/barony/county from the target? Measured in map pixels. Squared for performance reasons (square root is expensive). squared_distance = { target = some province/barony/county value > 10000 } |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | landed title, province |  |  |  |
| add_to_temporary_list | Saves a temporary target for use during the trigger execution | This is used to build lists in triggers.<br>If used within an any-trigger, placement within the trigger is quite important. The game will iterate through every instance of the any-trigger until it finds a single instance that fulfills the requirements, and then it will stop.<br>In order to add every instance of a scope that fulfills certain conditions, use "count = all" while also placing this "effect" at the very end of the any-trigger (so that every condition is evaluated for every iteration). |  | none |  |  |  |
| any_barony | Iterate through all baronies in the game | any_barony = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none | landed title |  |  |
| any_county | Iterate through all counties in the game | any_county = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none | landed title |  |  |
| any_county_in_region | Iterate through all counties in the region. Put 'region = region_name' inside it | any_county_in_region = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none | landed title |  |  |
| any_duchy | Iterate through all duchies in the game | any_duchy = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none | landed title |  |  |
| any_empire | Iterate through all empires in the game | any_empire = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none | landed title |  |  |
| any_in_global_list | Iterate through all items in global list. list = name or variable = name | any_in_global_list = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none |  |  |  |
| any_in_list | Iterate through all items in list. list = name or variable = name | any_in_list = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none |  |  |  |
| any_in_local_list | Iterate through all items in local list. list = name or variable = name | any_in_local_list = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none |  |  |  |
| any_independent_ruler | Iterate through independent rulers of count tier or above | any_independent_ruler = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none | character |  |  |
| any_kingdom | Iterate through all kingdoms in the game | any_kingdom = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none | landed title |  |  |
| any_living_character | Iterate through all living characters | any_living_character = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none | character |  |  |
| any_player | Iterate through all player characters | any_player = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none | character |  |  |
| any_pool_character | Iterate through all characters in the pool of the given province | any_pool_character = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none | character |  |  |
| any_province | Iterate through all provinces (skips non-land and impassable provinces) | any_province = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none | province |  |  |
| any_religion_global | Iterate through all religions in the game | any_religion_global = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none | religion |  |  |
| any_ruler | Iterate through all rulers of count tier or above | any_ruler = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | none | character |  |  |
| assert_if | Conditionally cause an assert during run time | assert_if = { limit = { X } text = Y }, where X is a trigger and Y is an optional string |  | none |  |  |  |
| assert_read | Conditionally cause an assert during read time | assert_read = X, where X is yes or the string to be printed in the assert |  | none |  |  |  |
| calc_true_if | Returns true if the specified number of sub-triggers return true | calc_true_if = { amount = 2 &lt;trigger> &lt;trigger> &lt;trigger> } |  | none |  |  |  |
| can_start_tutorial_lesson | Can the specified tutorial lesson be started? | can_start_tutorial_lesson = reactive_advice_succession<br><br>An interface trigger, can only be used in specific places |  | none |  |  |  |
| current_computer_date | Compare the current computer date. | An interface trigger, can only be used in specific places | &lt;, =, > valid date | none |  |  |  |
| current_computer_date_day | Compare the current computer day. | An interface trigger, can only be used in specific places | &lt;, &lt;=, =, !=, &gt;, &gt;= | none |  |  |  |
| current_computer_date_month | Compare the current computer month. | An interface trigger, can only be used in specific places | &lt;, &lt;=, =, !=, &gt;, &gt;= | none |  |  |  |
| current_computer_date_year | Compare the current computer year. | An interface trigger, can only be used in specific places | &lt;, &lt;=, =, !=, &gt;, &gt;= | none |  |  |  |
| current_date | Compare the current ingame date. |  | &lt;, =, > valid date | none |  |  |  |
| current_month | Compare the current ingame month (1..12) |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | none |  |  |  |
| current_tooltip_depth | What is number of tooltips open rigth now? | An interface trigger, can only be used in specific places | &lt;, &lt;=, =, !=, &gt;, &gt;= | none |  |  |  |
| custom_description | Wraps triggers that get a custom description instead of the auto-generated one | custom_description = {<br>	text = &lt;trigger_localization_key&gt;<br>	subject = &lt;optional subject scope> #defaults to current scope<br>	object = &lt;optional object scope&gt;<br>	value = &lt;optional script value&gt;<br>	... triggers ...<br>} |  | none |  |  |  |
| custom_tooltip | Replaces the tooltips for the enclosed triggers with a custom text | custom_tooltip = {<br>	text = &lt;text&gt;<br>	&lt;trigger&gt;<br>} |  | none |  |  |  |
| debug_only | Checks if the game is in debug mode or not. |  | yes/no | none |  |  |  |
| exists | Checks whether the specified socope target exists (check for not being the null object) | exists = from.owner.var:cool_var.mother |  | none |  |  |  |
| game_start_date | Compare the date of the bookmarked game launched. |  | &lt;, =, > valid date | none |  |  |  |
| global_variable_list_size | Checks the size of a variable list | variable_list_size = { name = X value &gt;= Y }<br>- X is the name of the variable<br>- Y is a script value or number |  | none |  |  |  |
| has_dlc | Does the host have this DLC? |  |  | none |  |  |  |
| has_game_rule | Is the given game rule setting enabled? | has_game_rule = faster_conversion |  | none |  |  |  |
| has_global_variable | Checks whether the current scope has the specified variable set | has_variable = name |  | none |  |  |  |
| has_global_variable_list | Checks whether the current scope has the specified variable list set | has_variable_list = name |  | none |  |  |  |
| has_local_variable | Checks whether the current scope has the specified variable set | has_variable = name |  | none |  |  |  |
| has_local_variable_list | Checks whether the current scope has the specified variable list set | has_variable_list = name |  | none |  |  |  |
| has_map_mode | Checks if the current map mode is the specified one | has_map_mode = realms<br><br>An interface trigger, can only be used in specific places |  | none |  |  |  |
| has_multiple_players | Does the game have at least two players currently connected? |  | yes/no | none |  |  |  |
| has_variable | Checks whether the current scope has the specified variable set | has_variable = name |  | none |  |  |  |
| has_variable_list | Checks whether the current scope has the specified variable list set | has_variable_list = name |  | none |  |  |  |
| has_war_result_message_with_outcome | Is there a war result message with the specified outcome? | has_war_result_message_with_outcome = victory/defeat/white_peace/invalidated/any<br><br>An interface trigger, can only be used in specific places |  | none |  |  |  |
| is_bad_nickname | Is the nickname bad? |  |  | none |  |  |  |
| is_frontend_character_selected | is the specified front end character selected (also can be used with "= yes" and "= no")? | An interface trigger, can only be used in specific places |  | none |  |  |  |
| is_game_view_open | is the specified in-game view open? | An interface trigger, can only be used in specific places |  | none |  |  |  |
| is_gamestate_tutorial_active | Is the gamestate tutorial active? See save_progress_in_gamestate in tutorial_lesson_chains documentation. | An interface trigger, can only be used in specific places | yes/no | none |  |  |  |
| is_in_list | Checks if a target in in a list |  |  | none |  |  |  |
| is_player_selected | is the player playing a character? | An interface trigger, can only be used in specific places | yes/no | none |  |  |  |
| is_target_in_global_variable_list | Checks if a target is in a variable list | is_target_in_variable_list = { name = X target = Y }<br>- X is the name of the variable<br>- Y is an event target |  | none |  |  |  |
| is_target_in_local_variable_list | Checks if a target is in a variable list | is_target_in_variable_list = { name = X target = Y }<br>- X is the name of the variable<br>- Y is an event target |  | none |  |  |  |
| is_target_in_variable_list | Checks if a target is in a variable list | is_target_in_variable_list = { name = X target = Y }<br>- X is the name of the variable<br>- Y is an event target |  | none |  |  |  |
| is_tooltip_with_name_open | Is the tooltip with the specified name open? | An interface trigger, can only be used in specific places |  | none |  |  |  |
| is_tutorial_active | Is the tutorial active? | An interface trigger, can only be used in specific places | yes/no | none |  |  |  |
| is_tutorial_lesson_active | Is this the current tutorial lesson? | is_tutorial_lesson_active = reactive_advice_succession<br><br>An interface trigger, can only be used in specific places |  | none |  |  |  |
| is_tutorial_lesson_chain_completed | Has the tutorial lesson chain with the specified key been finished? | An interface trigger, can only be used in specific places |  | none |  |  |  |
| is_tutorial_lesson_completed | has the tutorial lesson with the specified name been finished? | An interface trigger, can only be used in specific places |  | none |  |  |  |
| is_tutorial_lesson_step_completed | Has the tutorial lesson step been finished? | is_tutorial_lesson_step_completed = lesson_key:step_key<br><br>An interface trigger, can only be used in specific places |  | none |  |  |  |
| is_war_overview_tab_open | is the war overview open at a specified tab (victory, defeat, white_peace)? | An interface trigger, can only be used in specific places |  | none |  |  |  |
| is_widget_open | is the widget with the specified name open? | Separting strings with dots will search for specific children of children e.g. appa.foo vs baz.foo<br><br>An interface trigger, can only be used in specific places |  | none |  |  |  |
| list_size | Checks the size of a list | list_size = { name = X value &gt;= Y }<br>- X is the name of the list<br>- Y is a script value | &lt;, &lt;=, =, !=, &gt;, &gt;= | none |  |  |  |
| local_variable_list_size | Checks the size of a variable list | variable_list_size = { name = X value &gt;= Y }<br>- X is the name of the variable<br>- Y is a script value or number |  | none |  |  |  |
| monarchs_journey_unlock |  | An interface trigger, can only be used in specific places |  | none |  |  |  |
| release_only | Checks if the game is in release mode or not. |  | yes/no | none |  |  |  |
| save_temporary_scope_as | Saves a temporary target for use during the trigger execution |  |  | none |  |  |  |
| save_temporary_scope_value_as | Saves a numerical or bool value as an arbitrarily-named temporary target to be referenced later in the same effect | save_temporary_scope_value_as = { name = &lt;string> value = x } |  | none |  |  |  |
| scripted_tests | Checks if the game is currently running scripted tests. |  | yes/no | none |  |  |  |
| time_of_year | Check if the current date is within the bounds | time_of_year = {<br>    min = 11.1 # default: beginning of year<br>    max = 2.29 # default: end of year<br>}<br>Dates are formatted as "&lt;month&gt;.&lt;day&gt;" or just "&lt;month&gt;".<br>The check includes the min and max dates.<br>min can be larger than max, in this case we wrap around to the next year (i.e., February is between October and March). |  | none |  |  |  |
| variable_list_size | Checks the size of a variable list | variable_list_size = { name = X value &gt;= Y }<br>- X is the name of the variable<br>- Y is a script value or number |  | none |  |  |  |
| weighted_calc_true_if | Returns true if the sum of weights of fulfilled sub-triggers amount to the specified sum | weighted_calc_true_if = { amount = 10 5 = { &lt;trigger> } 15 = { &lt;trigger> } 7 = { &lt;trigger> } } |  | none |  |  |  |
| years_from_game_start | How many years it has been since the start of the game | years_from_game_start > 5 | &lt;, &lt;=, =, !=, &gt;, &gt;= | none |  |  |  |
| any_side_commander | Iterate through all commanders (the commanders of every army on the side, not just the one leading the battle) | any_side_commander = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | combat side | character |  |  |
| any_side_knight | Iterate through all knights | any_side_knight = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | combat side | character |  |  |
| has_maa_of_type | Does this combat side have at least one regiment of men at arms of the given type? | has_maa_of_type = onager |  | combat side |  |  |  |
| is_combat_side_attacker | Was the combat side the attacker? |  | yes/no | combat side |  |  |  |
| is_combat_side_pursuing | Is this side the winner of the combat? |  | yes/no | combat side |  |  |  |
| is_combat_side_retreating | Is this side defeated in the combat? |  | yes/no | combat side |  |  |  |
| side_soldiers | How many soldiers does this side have still fighting? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | combat side |  |  |  |
| side_strength | How strong is this side (based on soldiers still fighting)? Scaled down by a factor of 1000 so it doesn't get too large to do math on |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | combat side |  |  |  |
| any_pledged_attacker | Iterate through all pledged attackers within a great holy war | any_pledged_attacker = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | great holy war | character |  |  |
| any_pledged_defender | Iterate through all pledged defenders within a great holy war | any_pledged_defender = { &lt;count=num/all> / &lt;percent=fixed_point> &lt;triggers> } |  | great holy war | character |  |  |
| days_until_ghw_launch | How many days is it until the given GHW launches? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | great holy war |  |  |  |
| ghw_attackers_strength | What is the max (if all levies were fully reinforced) military strength of the pledged attackers in the given hreat holy war? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | great holy war |  |  |  |
| ghw_defenders_strength | What is the max (if all levies were fully reinforced) military strength of the pledged defenders in the given great holy war? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | great holy war |  |  |  |
| has_forced_defender | Is the target character forced to be a defender in the given great holy war? |  | character scope | great holy war | character |  |  |
| has_pledged_attacker | Is the target character pledged as an attacker in the given great holy war? |  | character scope | great holy war | character |  |  |
| has_pledged_defender | Is the target character pledged as a defender in the given great holy war? |  | character scope | great holy war | character |  |  |
| is_directed_ghw | Is the scoped GHW a directed GHW? |  | yes/no | great holy war |  |  |  |
| ghw_war_chest_gold | How much gold is in the great holy war's war chest? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | great holy war |  |  |  |
| ghw_war_chest_piety | How much piety is in the great holy war's war chest? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | great holy war |  |  |  |
| ghw_war_chest_prestige | How much prestige is in the great holy war's war chest? |  | &lt;, &lt;=, =, !=, &gt;, &gt;= | great holy war |  | = | (unknown) |


Category:Modding

---

*Source: https://ck3.paradoxwikis.com/Triggers_list*
