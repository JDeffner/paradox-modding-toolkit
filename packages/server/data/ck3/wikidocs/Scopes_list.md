# Scopes list

`/Crusader Kings III/game/event_scopes.log` is a documentation provided by the game, which contains all existing scope types.

`/Crusader Kings III/game/event_targets.log` is a documentation provided by the game, which contains all existing event targets.

You can dump them locally on your computer by using the console command ``script_docs`` which will create them in `Documents/Paradox Interactive/Crusader Kings III/logs/`

The files need to be generated again after each major patch to get the latest version.

Both lists are transcribed here, but be aware that this information is outdated.
Some event targets have been deprecated, and some new scope types and event targets have been added since launch.


- [Culture](#culture)
- [Landed title](#landed-title)
- [Dynasty house](#dynasty-house)
- [Dynasty](#dynasty)
- [Secret](#secret)
- [Holy order](#holy-order)
- [Character](#character)
- [Army](#army)
- [Province](#province)
- [Faith](#faith)
- [Great holy war](#great-holy-war)
- [Combat side](#combat-side)
- [Scheme](#scheme)
- [Council task](#council-task)
- [Color](#color)
- [War](#war)
- [Casus belli](#casus-belli)
- [Combat](#combat)
- [Story cycle](#story-cycle)
- [Faction](#faction)
- [Activity](#activity)
- [Primitive scopes](#primitive-scopes)


## Culture


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| culture_head |  | character | 1.0 |
| culture_group | Usable in culture, landed title, character and province scopes. | culture group | 1.0 |


## Landed title


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| title:*%title id%* |  | landed title | 1.0 |
| barony_controller | Usable in landed title and province scopes. | character | 1.0 |
| county_controller | Usable in landed title and province scopes. | character | 1.0 |
| current_heir |  | character | 1.0 |
| holder |  | character | 1.0 |
| lessee |  | character | 1.0 |
| previous_holder |  | character | 1.0 |
| culture | Usable in landed title, character and province scopes. | culture | 1.0 |
| #lstScopesCultureGroupScope |  |  |  |
| controlled_faith |  | faith | 1.0 |
| faith | Usable in landed title, character, province and great holy war scopes. | faith | 1.0 |
| barony | Usable in landed title and province scopes. | landed title | 1.0 |
| county | Usable in landed title and province scopes. | landed title | 1.0 |
| de_facto_liege |  | landed title | 1.0 |
| de_jure_liege |  | landed title | 1.0 |
| duchy | Usable in landed title and province scopes. | landed title | 1.0 |
| empire | Usable in landed title and province scopes. | landed title | 1.0 |
| kingdom | Usable in landed title and province scopes. | landed title | 1.0 |
| lessee_title |  | landed title | 1.0 |
| title_capital_county |  | landed title | 1.0 |
| title_province |  | province | 1.0 |
| religion | Usable in landed title and province scopes. | religion | 1.0 |


## Dynasty house


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| house_head |  | character | 1.0 |


## Dynasty


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| dynasty |  | character | 1.0 |
| dynast | dynasty head | character | 1.0 |


## Secret


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| secret_owner |  | character | 1.0 |
| secret_target |  | character | 1.0 |


## Holy order


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| holy_order_patron |  | character | 1.0 |
| leader |  | character | 1.0 |
| title |  | landed title | 1.0 |


## Character


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| commanding_army |  | army | 1.0 |
| knight_army |  | army | 1.0 |
| betrothed |  | character | 1.0 |
| concubinist |  | character | 1.0 |
| court_owner |  | character | 1.0 |
| designated_heir |  | character | 1.0 |
| employer |  | character | 1.0 |
| father |  | character | 1.0 |
| ghw_beneficiary |  | character | 1.0 |
| host |  | character | 1.0 |
| imprisoner |  | character | 1.0 |
| killer |  | character | 1.0 |
| liege |  | character | 1.0 |
| liege_or_court_owner |  | character | 1.0 |
| matchmaker |  | character | 1.0 |
| mother |  | character | 1.0 |
| player_heir |  | character | 1.0 |
| pregnancy_assumed_father |  | character | 1.0 |
| pregnancy_real_father |  | character | 1.0 |
| primary_heir |  | character | 1.0 |
| primary_partner |  | character | 1.0 |
| primary_spouse |  | character | 1.0 |
| prisoner |  | character | 1.0 |
| real_father |  | character | 1.0 |
| realm_priest |  | character | 1.0 |
| top_liege |  | character | 1.0 |
| council_task |  | council task | 1.0 |
| #lstScopesCultureScope |  |  |  |
| #lstScopesCultureGroupScope |  |  |  |
| dynasty |  | dynasty | 1.0 |
| house |  | dynasty house | 1.0 |
| joined_faction |  | faction | 1.0 |
| #lstScopesFaithScope |  |  |  |
| capital_barony |  | landed title | 1.0 |
| capital_county |  | landed title | 1.0 |
| primary_title |  | landed title | 1.0 |
| capital_province |  | province | 1.0 |
| location | Usable in character, army and combat scopes. | province | 1.0 |
| religion |  | religion | 1.0 |
| *** child of a parent? *** |  |  |  |


## Army


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| army_commander |  | character | 1.0 |
| army_owner |  | character | 1.0 |
| #lstScopesLocationScope |  |  |  |


## Province


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| #lstScopesBaronyControllerScope |  |  |  |
| #lstScopesCountyControllerScope |  |  |  |
| province_owner |  | character | 1.0 |
| #lstScopesCultureScope |  |  |  |
| #lstScopesCultureGroupScope |  |  |  |
| #lstScopesFaithScope |  |  |  |
| #lstScopesBaronyScope |  |  |  |
| #lstScopesCountyScope |  |  |  |
| #lstScopesDuchyScope |  |  |  |
| #lstScopesEmpireScope |  |  |  |
| #lstScopesKingdomScope |  |  |  |
| #lstScopesReligionScope |  |  |  |


## Faith


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| religious_head |  | character | 1.0 |
| great_holy_war |  | great holy war | 1.0 |
| religious_head_title |  | landed title | 1.0 |
| #lstScopesReligionScope |  |  |  |


## Great holy war


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| ghw_designated_winner |  | character | 1.0 |
| ghw_target_character |  | character | 1.0 |
| ghw_title_recipient |  | character | 1.0 |
| ghw_war_declarer |  | character | 1.0 |
| #lstScopesFaithScope |  |  |  |
| ghw_target_title |  | landed title | 1.0 |
| #lstScopesReligionScope |  |  |  |
| ghw_war |  | war | 1.0 |


## Combat side


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| side_commander |  | character | 1.0 |
| side_primary_participant |  | character | 1.0 |
| combat |  | combat | 1.0 |
| enemy_side |  | combat side | 1.0 |


## Scheme


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| scheme_defender |  | character | 1.0 |
| scheme_owner |  | character | 1.0 |
| scheme_target |  | character | 1.0 |


## Council task


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| councillor |  | character | 1.0 |


## Color

The scope "Color" is no longer supported since 1.5. 

| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| blue |  | value | 1.0 |
| brightness |  | value | 1.0 |
| green |  | value | 1.0 |
| hue |  | value | 1.0 |
| red |  | value | 1.0 |
| saturation |  | value | 1.0 |


## War


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| casus_belli |  | casus belli | 1.0 |
| claimant | Usable in war and casus belli scopes. | character | 1.0 |
| primary_attacker | Usable in war and casus belli scopes. | character | 1.0 |
| primary_defender | Usable in war and casus belli scopes. | character | 1.0 |


## Casus belli


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| #lstScopesClaimantScope |  |  |  |
| #lstScopesPrimaryAttackerScope |  |  |  |
| #lstScopesPrimaryDefenderScope |  |  |  |
| war |  | war | 1.0 |


## Combat


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| combat_attacker |  | combat side | 1.0 |
| combat_defender |  | combat side | 1.0 |
| #lstScopesLocationScope |  |  |  |
| combat_war |  | war | 1.0 |


## Story cycle


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| story_owner |  | character | 1.0 |


## Faction


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| faction_leader |  | character | 1.0 |
| faction_target |  | character | 1.0 |
| special_character |  | character | 1.0 |
| special_title |  | landed title | 1.0 |
| faction_war |  | war | 1.0 |


## Activity


| **Scope** | **Description** | **To scope** | **Version added** |
| --- | --- | --- | --- |
| activity_owner |  | character | 1.0 |
| activity_province |  | province | 1.0 |


## Primitive scopes

These scope types by default have no direct scope links out of them, though they can chain into script values.


| **Scope** | **Example** |
| --- | --- |
| Number | -1.0, 42, 69, some_script_value |
| Bool | yes/no |
| Flags | flag:some_flag |


**Note: If you give a number more than five decimals, it fails** and the script engine reads the whole number as 0.

Technical information: the Number type (also called Value) is a signed 64 bit fixed point number with 5 digits after the decimal point. This means it can hold numbers from -92 233 720 368 547.75808 to 92 233 720 368 547.75807 (so about 100 trillion). However, the GUI display of these numbers is limited to values from -2 147 483 648.99999 to 2 147 483 647.99999 (so about 2 billion). In addition, by default the GUI will only print 2 digits after the decimal point. You can change this in ``common/modifier_definition_formats``.


Category:Modding

---

*Source: https://ck3.paradoxwikis.com/Scopes_list*
