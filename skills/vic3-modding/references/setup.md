# Mod setup, packaging, and override rules

- [Creating a mod](#creating-a-mod)
- [metadata.json](#metadatajson)
- [Folder layout](#folder-layout)
- [Encoding](#encoding)
- [Localization layout](#localization-layout)
- [Load order and overriding](#load-order-and-overriding)
- [REPLACE and INJECT](#replace-and-inject)
- [Getting the mod to load](#getting-the-mod-to-load)

Verified against Victoria 3 **1.13.10** unless noted.

## Creating a mod

A Victoria 3 mod is a directory under `<mods>` containing `.metadata/metadata.json` plus whatever
game folders it overrides. That is the whole requirement. Minimum:

```
<mods>/my_mod/
  .metadata/
    metadata.json
  common/
  events/
  localization/english/
```

Victoria 3 has **no `descriptor.mod`** and no sibling `<name>.mod` file. If you are carrying a
CK3 habit, that is the first thing to unlearn. It is also why `vic3-tiger` takes a mod
*directory* where `ck3-tiger` takes a descriptor file.

## metadata.json

A real published mod (Community Mod Framework), verbatim:

```json
{
  "name" : "[1.13] Community Mod Framework",
  "id" : "com.github.Victoria-3-Modding-Co-op.Community-Mod-Framework",
  "version" : "1.63.0",
  "game_id" : "victoria3",
  "supported_game_version" : "1.13.*",
  "short_description" : "This is a framework to enable easy integration between mods.",
  "tags" : [ "Utilities" ],
  "relationships" : [],
  "game_custom_data" : { "multiplayer_synchronized" : true }
}
```

| Field | Notes |
|---|---|
| `name` | Required. Shown in the launcher. |
| `id` | Required by the wiki, reverse-DNS convention, and must stay stable across releases. In practice a local mod with `"id": ""` still loads, so the launcher treats it softly. |
| `version` | The mod's own version, free-form. |
| `game_id` | Always `"victoria3"`. Omitting it still loads locally. |
| `supported_game_version` | Accepts `*` wildcards (`"1.13.*"`) and a `+` suffix for "or higher". `"*"` means any. |
| `tags` | Maximum 5. |
| `relationships` | Dependencies, incompatibilities, and load ordering against other mods. |
| `game_custom_data` | Victoria 3 engine data. `multiplayer_synchronized` belongs here. |

## Folder layout

The mod mirrors `<game>` exactly. Do not add or remove hierarchy levels. Folder names are plural
except `common/technology`. `common/history` and `events` accept arbitrary named subfolders.

Two spellings that catch CK3 modders:

- `localization/`, American spelling, same as CK3.
- `common/on_actions/`, **plural**. CK3's is `common/on_action/`, singular.

**No non-ASCII characters anywhere in a mod's file paths.** Victoria 3 cannot load such mods at
all, and the failure gives no useful message.

## Encoding

UTF-8 **with BOM** for both script `.txt` and localization `.yml`. Every vanilla file of both
kinds ships a BOM on 1.13.10 (byte-checked: the first three bytes are `EF BB BF`), so match
vanilla. This differs from CK3, where script `.txt` carries no BOM and only localization does.

Wrong encoding fails silently: the game ignores the file and reports nothing.

## Localization layout

`localization/english/` is **flat**. Vanilla ships 158 `.yml` files directly in it, with no
per-system subfolders. The file must:

- end its name with `_l_english.yml` (matching the language folder),
- start with the line `l_english:`,
- carry a UTF-8 BOM.

Keys are indented under that header. Both of these are valid, and vanilla uses both heavily
(roughly 42,000 keys with a version suffix and 47,700 without), so neither is a bug to correct:

```yaml
l_english:
  my_key: "Some text"
  my_other_key:0 "Some text"
```

**A key's filename does not bind to its namespace.** Vanilla puts `acceptance_events.1.t` inside
`character_focused_l_english.yml`. So when hunting for an existing key, grep the whole folder
rather than guessing the filename.

## Load order and overriding

All files load in **ASCII order** of filename, subfolders after their parent folder, applied
uniformly to base game, DLC and mods. Filename prefixes therefore decide priority, which is why
vanilla files are numbered (`00_`, `01_`).

A mod file overrides a base-game file only at an **exactly matching path**. Between mods, one
lower in the playlist wins over one higher.

**The direction is inverted between script and GUI:**

| Kind | Rule |
|---|---|
| Script (`common/`, `events/`) | Last loaded wins. A later file overrides an earlier definition. |
| GUI (`.gui`) | **First loaded wins.** Once a GUI type or template is loaded it cannot be overwritten. |

This is the single biggest practical trap in Victoria 3 overriding, and it is the opposite of
what CK3 experience suggests for GUI work.

`<logs>\database_conflicts.log` records which file won each contested override. It is rewritten
on every launch, so it always reflects the last run.

## REPLACE and INJECT

Many `common/` folders accept key prefixes that patch a single object instead of replacing a
whole file:

```
REPLACE:movement_pro_slavery = { ... }   # overwrite this one object
INJECT:movement_pro_slavery = { ... }    # add to it, leaving prior definitions intact
```

Prefer these over copying a vanilla file wholesale, because a copied file freezes every other
object in it at the version you copied and silently reverts later patches and other mods.

Vanilla itself uses neither, so the reference example is real-world: Community Mod Framework's
`common/political_movements/ycom_00_ideological_movements.txt` uses `REPLACE:`.

Victoria 3 has no equivalent of CK3's whole-file override etiquette because it has this instead.

## Getting the mod to load

`<user documents>\Paradox Interactive\Victoria 3\content_load.json` lists enabled mods by
absolute path. Local `mod/` folders are registered through `launcher-v2.sqlite`, so a
hand-created mod folder normally needs one pass through the launcher before it appears. There is
no `dlc_load.json` as in CK3.
