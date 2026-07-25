# Chapter 6: Content databases and localization

`common/` contains roughly a hundred database folders, and they nearly all follow the same grammar you already know: named objects, trigger blocks, effect hooks, modifiers, loc keys derived from the id. This chapter covers the three databases you are most likely to touch (traits, cultures, faiths) and then goes deep on localization, which every database depends on.

## Traits

Folder: `common/traits/`, schema `_traits.info`. A real vanilla personality trait, abridged from `00_traits.txt`:

```
brave = {
	category = personality
	opposites = {
		craven
	}
	martial = 2
	prowess = 3

	attraction_opinion = 10
	glory_hound_opinion = 10
	opposite_opinion = -10
	same_opinion = 10

	culture_modifier = {
		parameter = trait_county_opinion_modifiers
		county_opinion_add = 10
	}
}
```

And a custom trait for the chronicle mod:

```
# common/traits/chron_traits.txt
chron_famed_chronicler = {
	category = lifestyle
	learning = 3
	diplomacy = 1
	monthly_prestige = 0.5

	desc = trait_chron_famed_chronicler_desc
}
```

The essentials:

- **`category`** is one of `personality`, `education`, `childhood`, `commander`, `lifestyle`, `fame`, `health`, `court_type`. Personality traits participate in AI attribute computation and opinion webs (`opposites`, `same_opinion`, `opposite_opinion`).
- Bare skill names (`martial = 2`) are stat modifiers; most character modifiers work directly in the trait body (`monthly_prestige`, `fertility`, etc.).
- **`culture_modifier`** blocks apply only when the character's culture has a matching parameter, which is how vanilla makes traits interact with traditions.
- Genetic traits add `genetic = yes`, `inherit_chance`, optionally `birth` (chance to appear at birth) and leveled families via `group` and `group_equivalence` so `has_trait = beauty_1` style checks can match a whole group.
- **Localization**: `trait_<key>` for the name and `trait_<key>_desc` for the description. **Icon**: `gfx/interface/icons/traits/<key>.dds`, 120 by 120 pixels ([Chapter 8](08-graphics.md)); a trait can also set `icon = ...` explicitly.
- Grant and remove with the effects `add_trait = chron_famed_chronicler` / `remove_trait = ...`; test with `has_trait`.

Try `effect add_trait = chron_famed_chronicler` in the console. Until you add an icon the trait shows a placeholder, and until you add loc it shows the raw key. Both are normal mid-development states; the extension's Localization Coverage view keeps score of the second.

## Cultures (a guided overview)

Since patch 1.5 a culture is an assembly of parts, all under `common/culture/`:

- **Pillars** (`culture/pillars/`): every culture references exactly one `ethos_*`, `heritage_*`, `language_*` and `martial_custom_*`.
- **Traditions** (`culture/traditions/`): the modular bonus cards; each carries `character_modifier` / `culture_modifier` / `province_modifier` blocks plus AI weighting and a `cost`.
- **Name lists** (`culture/name_lists/`): the pools characters draw names from.
- **Innovations and eras** (`culture/innovations/`, `culture/eras/`): the tech tree.

A new culture is mostly a recipe file in `common/culture/cultures/` referencing pillars, traditions, a name list, `color`, `ethnicities = { 10 = ethnicity_key }` and graphics keys (`coa_gfx`, `clothing_gfx`, `unit_gfx`). The cleanest way in: copy a small vanilla culture, then swap parts. A custom *tradition* is often the better first project, since it plugs into every culture and exercises the modifier system. `pillars/00_ethos.txt` shows the minimal shape.

One warning: online guides predating 1.5 describe a completely different culture system. Trust the local game files.

## Faiths (a guided overview)

Religion files (`common/religion/religion_types/`) each define a religion with nested `faiths = { }` blocks. Religion level sets the `family`, shared `doctrine =` lines and holy order naming; each faith picks `color`, `icon`, `religious_head`, `holy_site =` entries (defined in `holy_site_types/`) and its doctrines, typically including three tenets from `doctrine_types/30_core_tenets.txt`.

Two things to know before you start:

1. **Faiths cannot be single-object overridden.** Editing a vanilla faith means replacing its entire religion file. Adding a *new* faith to a vanilla religion has the same problem. Plan around it (a new religion in a new file is clean).
2. Faiths need a surprising amount of localization: `<key>`, `<key>_adj`, `<key>_adherent`, `<key>_adherent_plural`, `<key>_desc`, plus deity and term keys (`HighGodName` and friends). Copy a vanilla faith's loc block wholesale and edit; do not try to enumerate the keys from memory.

Doctrines can carry custom **parameters** readable from script, which is the clean way to give faiths mechanical hooks: define the parameter on a doctrine, then check `has_doctrine_parameter` in your triggers. No per-faith special cases in your code.

## Localization in depth

You know the container rules from Chapter 2 (folder `localization/english/`, filename `*_l_english.yml`, first line `l_english:`, UTF-8 with BOM, one leading space per entry). Now the content.

### Inside the quotes

```yaml
l_english:
 chron_example_1: "Plain text with #bold emphasis#! and an icon @gold_icon!"
 chron_example_2: "$chron_example_1$ (keys can embed other keys)"
 chron_example_3: "[ROOT.Char.GetTitledFirstName] rules [ROOT.Char.GetPrimaryTitle.GetName]"
 chron_example_4: "This concerns your [realm|E] and your [gold|E]."
 chron_example_5: "[ROOT.Char.GetSheHe|U] paid [gold_amount|0=+] gold."
```

- **`$key$`** inserts another loc key or an engine-supplied value (`$VALUE|=+0$` in vanilla tooltips).
- **`[Scope.Function]` data functions** are a whole expression language: `[ROOT.Char.GetName]`, `[GetTitleByKey('k_france').GetName]`, `[GetTrait('brave').GetName(GetNullCharacter)]`. The complete function list for your game version comes from the console command `dump_data_types` (writes to `logs/data_types/`).
- **Formatting**: `#bold text#!`, `#P ...#!` (positive green), `#N ...#!` (negative red), `#EMP` (emphasis); combinable as `#high;bold`. Styles live in `gui/preload/textformatting.gui` if you want the full list.
- **Game concepts**: `[realm|E]` renders "realm" as a hoverable concept link (concepts from `common/game_concepts/`).
- **Icons**: `@gold_icon!`, `@prestige_icon!` and friends, defined in `gui/texticons*.gui`.
- **Gendered and grammatical text** uses functions, never duplicate keys: `[ROOT.Char.GetSheHe]`, `GetHerHis`, `GetLadyLord`. Post-process with `|U` (uppercase first letter) or `|L`. Number formatting: `|0` to `|9` for decimals, `|=` and `|+` for sign coloring, `|%` for percent.
- Escapes: `\"` for a literal quote, `\n` for a newline.

### Overriding vanilla text

Redefining a vanilla key in a normal loc file logs an error and load order decides the winner. The sanctioned mechanism is a **replace folder**: `localization/replace/english/` (or `localization/english/replace/`). Keys there silently override vanilla. Use it for deliberate text changes only.

### Other languages

The game has nine language folders (english, french, german, spanish, russian, korean, japanese, simp_chinese, polish). If you ship only English, players on other languages see raw keys. The standard fix is duplicating English text into every language folder until real translations exist.

The extension automates this workflow end to end:

- **Localization Coverage view** (CK3 Activity Bar icon): every key, which languages have it, which are missing or stale, with one-click "Add localization" on missing entries.
- **Paradox Localization: Add Language** scaffolds a new language folder from your English files, keeping English visible side by side while you translate.
- **Paradox Localization: Translate Missing Keys** walks you through the gaps.
- **Paradox Localization: Open Side by Side** pairs a script file with its loc file in a split editor.
- F12 on a loc key jumps between script usage and yml definition in both directions.

### Conditional text at scale

When a description needs real branching logic (not just a data function), the tool is `common/customizable_localization/`: named text objects with trigger-picked alternatives, referenced from loc via `[ROOT.Char.Custom('my_custom_loc')]`. Reach for it when `first_valid` desc blocks in events start repeating themselves.

## A word on history files

Character, title and province setup lives under `history/`, in a related but distinct static format: base values plus dated blocks (`1066.9.15 = { ... }`) applied chronologically. Two warnings, because they defy the intuition you have built: history files are not single-object overridable (**re-defining a vanilla character in a new file duplicates the character**, it does not edit them), and `dynasty =` vs `dynasty_house =` are different fields that break family trees when mixed up. When you get to history-heavy modding, start from `history/_history.info` and a small vanilla file like `history/characters/afar.txt`.

## Try it

1. Create `chron_famed_chronicler` as above, with `trait_chron_famed_chronicler` and `trait_chron_famed_chronicler_desc` loc keys.
2. Grant the trait from your Chapter 4 event chain: the final event's best option gives it via `add_trait`.
3. Open the Localization Coverage view and check your mod is at 100 percent for English. Then run **Paradox Localization: Add Language** for German (or any language), translate two keys, and see coverage update.
4. Stretch goal: write a `chron_example` loc key using a data function, a concept link and a text icon, and display it via `custom_tooltip` in an event option.

Next: [Chapter 7: Custom GUI](07-gui.md) · [Back to index](index.md)
