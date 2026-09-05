# Localization, history, titles/map/CoA, culture, religion, traits, dynasties

## Localization

Folder: `localization/<language>/`; filename **must** end `_l_<language>.yml` (lowercase L, US
spelling "localization"). Encoding: **UTF-8 with BOM** or the file silently fails to load.

```
l_english:                       # first line, must match folder/filename language
 my_key:0 "Some #bold text#! for [ROOT.Char.GetFirstName]"
 other_key: "The :0 version number is optional/deprecated"
```

Format: one leading space, `KEY:0 "value"`. Inside values:

- `$other_key$` — insert another loc key or an engine value (`$VALUE|=+0$`).
- `[Scope.Function]` data functions: `[ROOT.Char.GetName]`, `[GetTitleByKey('k_france').GetName]`,
  `[GetTrait('brave').GetName(GetNullCharacter)]`. Dump all functions with console
  `dump_data_types` → `logs/data_types`.
- Formatting: `#bold ...#!`, `#P` (green), `#N` (red), `#EMP` (italic), combine `#high;bold`.
  Styles defined in `gui/preload/textformatting.gui`.
- Game-concept links: `[faith|E]` (concepts from `common/game_concepts`).
- Icons: `@gold_icon!` (defined in `gui/texticons*.gui`).
- Gendered text via functions, not duplicate keys: `[ROOT.Char.GetSheHe]`, `GetHerHis`,
  `GetLadyLord`; case with `|U`/`|L`. Numbers: `|0`–`|9` decimals, `|=` forced sign, `|%`, `|+`.
- Escapes: `\"` literal quote, `\n` newline.

Overriding a vanilla key errors **unless** the file sits in a replace folder:
`localization/replace/english/` or `localization/english/replace/`. Provide copies for every
language folder (other-language players see raw keys otherwise) — duplicating the English text
into each is standard. Complex conditional text: `common/customizable_localization/`.

## History modding

Folder: `history/`. Format (see `history/_history.info`): base key-values, then
`YYYY.MM.DD = { ... }` blocks applied chronologically; values persist until changed.

**Characters** (`history/characters/*.txt`):

```
46706 = {                        # IDs numeric or string
    name = "Saemundr"
    dynasty = 101586             # dynasty vs dynasty_house are DIFFERENT fields
    culture = norse   religion = catholic
    trait = education_learning_3
    father = 46705
    1055.1.1 = { birth = yes }
    1075.6.11 = { add_spouse = 46707 }
    1133.5.22 = { death = yes }  # or death = { death_reason = death_murder killer = X }
}
```

**Titles** (`history/titles/*.txt`): dated `holder = <char id>` (0 destroys, not for
counties/baronies), `liege =` (`0`/omitted = independent), `government =`, `de_jure_liege =`,
`succession_laws = {}`, `change_development_level =`, arbitrary `effect = {}` blocks.

**Provinces** (`history/provinces/*.txt`): per province ID — `culture`, `religion`, `holding`
(e.g. `castle_holding`), buildings, at dates.

**Cultures** (`history/cultures/*.txt`): only `discover_innovation` and `join_era` at dates.

Pitfalls: mixing up `dynasty` vs `dynasty_house` breaks family trees; a title's holder must be
alive at the assignment date; match death dates to title-loss dates or the dynasty tree
mislabels; **re-defining a vanilla character in a new file DUPLICATES them** — edit the whole
vanilla file (same filename) or use `replace_path`.

## Landed titles, map, coat of arms

**Landed titles** (`common/landed_titles/`, schema `_landed_titles.info`). Tiers by prefix:
`b_` barony < `c_` county < `d_` duchy < `k_` kingdom < `e_` empire, plus `h_` hegemony.
Hierarchy is **nested**: county inside duchy, containing ≥1 barony; each barony needs
`province = <map id>`. Titular titles possible only at duchy+
(`k_x = { color = { 100 255 200 } }`); **counties/baronies cannot be titular** — they are bound
to the map. Attributes: `color`, `capital = c_x`, `definite_form`, `landless`,
`de_jure_drift_disabled`, `male_names`/`female_names` (regnal pools), `cultural_names`,
`ai_primary_priority`. Loc: `<title>` + `<title>_adj`. A coat of arms named identically to the
title auto-applies.

**Map** (`map_data/` in the real install): `provinces.png` (unique flat RGB per province,
8/24-bit, NO antialiasing/transparency or CTD), `definition.csv` (`ID;R;G;B;Name;x;` — **IDs must
be sequential or the game crashes**), 16-bit `heightmap.png` (+ repacked `packed_heightmap`),
indexed-palette `rivers.png` (wrong palette = CTD), `adjacencies.csv` (straits). Title/script
modding is easy; map modding is hard and update-fragile.

**Coat of arms** (`common/coat_of_arms/coat_of_arms/`): `pattern =`, `color1..color5` (named
colors from `common/named_colors` or `rgb {}`/`hsv {}`),
`colored_emblem = { texture  color1  instance = { scale position rotation depth } }`, `mask`,
inheritance via `parent =`, quartering via subs. Dynamic CoAs:
`common/coat_of_arms/dynamic_definitions/` (trigger-picked; refresh with
`update_dynamic_coa = yes`). The in-game CoA designer (Royal Court) exports valid script via
"Copy to clipboard". Typos in CoA names fail silently.

## Culture (post-1.5 pillar system — local game files are authoritative; wiki lags)

A culture (`common/culture/cultures/`) references pillars (`culture/pillars/` — one `ethos_*`,
`heritage_*`, `language_*`, `martial_custom_*` each), traditions (`culture/traditions/`), a name
list (`culture/name_lists/`), era progression via innovations (`culture/innovations/`, grouped by
`culture/eras/`), plus `color`, `ethnicities = { 10 = ethnicity_key }`,
`coa_gfx`/`clothing_gfx`/`unit_gfx`. Pillars and traditions carry
`character_modifier`/`culture_modifier`/`province_modifier` + `ai_will_do` — see
`pillars/00_ethos.txt` for the minimal shape.

## Religion

`common/religion/religion_types/` files define religions containing nested `faiths = { }` blocks.
Religion level: `family` (from `religion_family_types/`), `doctrine =` lines applied to all
faiths, `traits = { virtues = {} sins = {} }`, holy-order names, `custom_faith_icons`.
Faith level: `color`, `icon`, `religious_head = d_x`, repeated `holy_site = key` (sites defined
in `holy_site_types/`, only `county` mandatory), and doctrine/tenet picks (typically 3 tenets
from `doctrine_types/30_core_tenets.txt`). **Faiths cannot be single-object-overridden — whole
file.** Loc: `<key>`, `_adj`, `_adherent`, `_adherent_plural`, `_desc` + deity/term keys
(HighGodName etc.) — copy a vanilla loc file. Icons: 100×100 `.dds` in
`gfx/interface/icons/faith/`.

Doctrines can carry custom **parameters** readable in script (e.g. PoD gates masquerade risk on
`no_masquerade_penalty`); this is the clean way to give faiths/cultures mechanical hooks without
call-site changes — see `mods/pod.md` pattern 11.

## Traits

`common/traits/00_traits.txt`, schema `_traits.info`.
`category = personality|education|childhood|commander|lifestyle|fame|health|court_type`,
skill/stat modifiers, `potential = {}`, `valid_sex`, age bounds. Genetic: `genetic = yes`
(active/inactive inheritance), `inherit_chance`, `birth`, `enables_inbred`; leveled families via
`group_equivalence` (`has_trait = lunatic` matches all levels); portrait hooks
`genetic_constraint_all`, `forced_portrait_age_index`. Loc `trait_<key>` / `trait_<key>_desc`;
icon `gfx/interface/icons/traits/<key>.dds`. Guard dynamic descs with `NOT = { exists = this }`
(per `_traits.info`).

Supernatural/immortal characters: vanilla supports `immortal = yes`, `can_have_children = no`,
`no_prowess_loss_from_age` directly on traits (PoD's vampires ride these; no custom aging system
needed — see `mods/pod.md`). Trait-XP tracks (`has_trait_xp`, `add_trait_xp`) double as
progression ladders (see `mods/agot.md` pattern 5).

## Dynasties

`common/dynasties/` + `common/dynasty_houses/`: a house belongs to a dynasty; character history
references either via `dynasty =` or `dynasty_house =`. Legacies: `common/dynasty_legacies/` +
`common/dynasty_perks/`.
