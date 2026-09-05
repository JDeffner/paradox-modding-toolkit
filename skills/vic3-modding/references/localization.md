# Localization

- [File rules](#file-rules)
- [Value syntax](#value-syntax)
- [Formatting markers](#formatting-markers)
- [Data functions](#data-functions)
- [Customizable localization](#customizable-localization)
- [Trigger and effect localization](#trigger-and-effect-localization)
- [Pitfalls](#pitfalls)

## File rules

Four hard requirements. Getting any of them wrong makes the game show the raw key, with no error.

1. The file lives in `localization/<language>/`, American spelling.
2. Its name ends `_l_<language>.yml`. Every one of the 167 files in vanilla's `english/` matches
   `*_l_english.yml`, with no exceptions.
3. Its first line is the language tag: `l_english:`.
4. It is UTF-8 **with BOM**. Byte-checked across 40 sampled vanilla loc files: 40 of 40 start
   `EF BB BF`.

`localization/english/` is essentially flat, with a handful of subfolders (`character/`,
`frontend/`, `historical/`, `interest_groups/`, `map/`). **A key's filename does not bind to its
namespace.** Vanilla puts `acceptance_events.1.t` inside `character_focused_l_english.yml`. When
hunting for an existing key, grep the whole folder rather than guessing a filename.

Vanilla ships 13 language folders plus a shared `jomini/` and `modifiers/`, and `languages.yml`.

## Value syntax

```yaml
l_english:
  je_metternich_lobby: "Maintain the ideals of the Chancellor Klemens von Metternich."
  je_matter_of_hungary_lobby:1 "Austrian control of Hungary must be maintained."
```

The version number after the colon is **optional**. Vanilla uses both forms heavily (roughly
42,000 keys with a version suffix, 47,700 without), so neither is a bug to correct. Use `\n` for
a line break.

Event keys follow `<namespace>.<number>.<t|d|f|a>`, with **dots**.

## Formatting markers

Text formatting is `#tag ... #!`, always closed with `#!`. The tags vanilla actually uses, by
frequency in `english/*.yml`:

`#v` (3,137), `#bold` (2,804), `#b` (2,148), `#header` (1,870), `#variable` (1,818),
`#tooltippable` (891), `#title` (680), `#italic` (311), `#N` (276), `#BOLD` (224), `#lore` (206),
`#V` (192), `#r` (156), `#tooltippable_name` (130), `#n` (114), `#g` (96), `#instruction` (94),
`#P` (91), `#i` (71).

Sprite and icon references are `@name!`: `@money!` (865), `@battalions!` (141), `@warning!`
(138), `@red_cross!` (108), `@ships!` (104).

Parameter substitution is `$NAME$`: `$TOOLTIP_DELIMITER$` (1,419), `$COMPARATOR$` (1,217),
`$concept_pops$` (828), `$TAB$` (347), `$NUM$` (308), `$NAME$` (301). Game concepts appear both
as `$concept_pops$` and `[concept_pops]`.

## Data functions

Square brackets call into the data-binding layer:

```
[COUNTRY.GetName]
[ROOT.GetCountry.GetRuler.GetPrimaryRoleTitle]
[SCOPE.sLaw('current_law_scope').GetName]
[GetPlayer.GetTooltipTag]
[Nbsp]
```

Saved script scopes reach localization through `SCOPE.sCountry('name')`,
`SCOPE.sCharacter('name')`, `SCOPE.sCulture('name')`, and from a journal entry through
`JournalEntry.GetTopScope.sCountry('saved_scope_name')`.

The complete set of available promotes and functions is not in the script docs. It is dumped
separately by the console command `dump_data_types` into `<logs>\data_types\`.
`data_types_script.txt` (469 records) is the small useful slice; the uncategorized file holds the
full engine surface. Each record gives a name, a definition type, and a return type, but
**argument types are not given**, only positional placeholders.

## Customizable localization

`common/customizable_localization/` (28 files) picks a localization key at runtime by trigger:

```
character_role_magnate_custom_loc = {
    type = character
    random_valid = yes

    text = {
        trigger = { character_is_taikun = yes }
        localization_key = character_title_taikun
    }
    text = {
        trigger = { character_is_taikun = no  character_is_daimyo = yes }
        localization_key = character_title_daimyo
    }
}
```

`type` is the scope it evaluates in. `random_valid = yes` picks randomly among all matching
`text` blocks instead of taking the first match.

The 202 defined custom localization keys, each with its scope and entry list, are in the dumps:

```bash
python scripts/vic3_docs.py find -s custom_loc
```

## Trigger and effect localization

`common/trigger_localization/` (4 files, documented) maps a trigger to `global`, `first` and
`third` person localization keys, so conditions read as sentences in tooltips.

Its doc states a requirement worth repeating: a key **requires both a positive and a negative
version**, the negative named `NOT_<key>` and used inside `NOT` triggers. It also documents a
silent fallback: "If the requested entry is not available, the system will fall back to the
_last_ available one", which produces a wrong but plausible tooltip rather than an error.

`common/effect_localization/` (18 files) is the effect-side equivalent.

## Pitfalls

| Symptom | Cause |
|---|---|
| Raw keys show in-game | Missing BOM, wrong filename suffix, wrong header line, or the key simply is not defined |
| Event text is blank or raw | Loc keys written with underscores instead of dots |
| A pop type shows a raw key | Missing `<POP_TYPE>_QUALIFICATIONS_DESC` |
| A tooltip says the wrong thing in a `NOT` | Missing `NOT_<key>`, so the system fell back to the last available entry |
| Formatting leaks into the text | A `#tag` was never closed with `#!` |
| A data function prints literally | The promote does not exist for that scope; check `<logs>\data_types\` |
