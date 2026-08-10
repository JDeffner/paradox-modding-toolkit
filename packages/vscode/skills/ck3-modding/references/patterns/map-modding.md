# Map Data Modding

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
- Map data lives in `map_data/` and controls the physical world: provinces, terrain, rivers, seas, adjacencies, and positions
- Map modding is the most technically demanding area of CK3 modding -- most files are tightly coupled and a mistake in one often causes crashes or invisible errors in others
- The `default.map` file is the master index; it references every other map file and defines which provinces are sea, river, lake, or impassable
- Province IDs are assigned via `definition.csv` and painted onto `provinces.png` using unique RGB colors -- every province must have a unique color that exactly matches its definition
- Map images must be specific dimensions and formats; the game will not load incorrectly sized or formatted images
- For total conversion mods, you will need to redo nearly every file in `map_data/`. For province additions or terrain tweaks, you can override individual files
- **Mod path**: Place overriding files in `<mod>/map_data/` to replace vanilla files. The game does NOT merge map files -- your mod file completely replaces the vanilla version

## Key Files Reference

### default.map -- The Master Index
This is the central configuration file. It declares which files the game loads and categorizes every non-land province.

```
# File references (paths relative to map_data/)
definitions = "definition.csv"
provinces = "provinces.png"
rivers = "rivers.png"
topology = "heightmap.heightmap"
continent = "continent.txt"
adjacencies = "adjacencies.csv"
island_region = "island_region.txt"
seasons = "seasons.txt"

# Province type assignments by ID range
sea_zones = RANGE { 632 641 }       # Inclusive range of province IDs
sea_zones = LIST { 977 }            # Individual province IDs
river_provinces = RANGE { 628 630 } # Thames
lakes = LIST { 943 955 956 957 }
impassable_mountains = LIST { 1049 1050 1051 }
```

**Province categories in default.map:**
- `sea_zones` -- navigable ocean/sea tiles (naval movement)
- `river_provinces` -- major navigable rivers (shown on map, allow river crossings/movement)
- `lakes` -- inland water bodies (non-navigable, visual only)
- `impassable_mountains` -- blocks unit movement entirely, colored by neighboring province owners

Every province ID that is NOT listed in any of these categories is treated as a **land province**.

### definition.csv -- Province Registry
Maps province IDs to RGB colors and names. Semicolon-delimited, no header row (first row is the null province).

```
# Format: ID;R;G;B;NAME;x;
0;0;0;0;x;x;
1;42;3;128;VESTFIRDIR;x;
2;84;6;1;REYKJAVIK;x;
3;126;9;129;STOKKSEYRI;x;
```

**Fields:**
| Column | Description |
|--------|-------------|
| ID | Unique integer province ID (sequential, no gaps recommended) |
| R, G, B | RGB color values (0-255) that MUST match provinces.png exactly |
| NAME | Province name key (used for debug; localization handles display names) |
| x (last two) | Legacy placeholder columns, always `x` |

**Rules:**
- Province 0 is always `0;0;0;0;x;x;` (the null/invalid province)
- Every RGB combination must be unique across all provinces
- RGB values must exactly match pixel colors in `provinces.png` -- even a single value off by 1 means the province will not be recognized
- Province IDs should be sequential; gaps can cause issues with some tools

### provinces.png -- Province Map
A flat-color image where each contiguous region of a single RGB color defines a province's shape and borders.

**Requirements:**
- Format: 8-bit RGB PNG (no alpha channel)
- Every pixel must be a color defined in `definition.csv`
- Province borders are where two different colors meet
- Anti-aliasing is forbidden -- every pixel must be exactly one province color
- Black pixels (0,0,0) map to province 0 (the null province) and should only appear at map edges
- Standard vanilla map size: 8192 x 4096 pixels

### heightmap.png -- Elevation Data
Grayscale image defining terrain elevation. Darker = lower, brighter = higher.

**Requirements:**
- Format: 8-bit grayscale PNG
- Same dimensions as provinces.png (8192 x 4096 in vanilla)
- Sea level is approximately value 95-100 (pixels darker than this render as water)
- The game converts this to `heightmap.heightmap` (a proprietary binary format) on load
- `packed_heightmap.png` and `indirection_heightmap.png` are generated/cached files -- do not edit these directly

### rivers.png -- River Map
Defines river paths, sources, and merges using specific color codes.

**Requirements:**
- Format: 8-bit indexed-color PNG
- Same dimensions as provinces.png
- Uses specific pixel colors for river features:
  - Green (0, 255, 0): River source
  - Red (255, 0, 0): River merge point (where tributaries join)
  - Blue shades: River flow (different blue values = different river widths)
  - Yellow (255, 252, 0): River split point
- Rivers must flow as connected pixel paths from source to sea/lake
- Background (non-river) pixels should be white or transparent

### positions.txt -- Entity Placement
Defines where cities, units, combat indicators, siege indicators, and province name text appear for each province.

```
# Format: province_id = { position = { x1 y1  x2 y2  x3 y3  x4 y4  x5 y5 } rotation = { ... } height = { ... } }
1 = {
    position = {
        96.000 1874.000    # City/holding position (x, y)
        104.000 1882.000   # Unit position
        132.000 1886.000   # Text/name position
        8.000 1833.000     # Combat indicator position
        85.000 1867.000    # Siege indicator position
    }
    rotation = {
        0.000 0.000 0.000 0.000 1.222  # Rotation for each entity (radians)
    }
    height = {
        0.000 0.000 0.000 20.000 0.000  # Height offset for each entity
    }
}
```

**Position pairs (5 x,y pairs):**
1. City/holding graphic
2. Unit stack position
3. Province name text position
4. Combat indicator
5. Siege indicator

Coordinates use the map's pixel space (matching provinces.png dimensions). Every land province should have an entry; missing entries cause the game to guess positions (often poorly).

### adjacencies.csv -- Connections
Defines special connections between provinces: sea crossings (straits), river crossings, and other non-standard adjacencies.

```
# Format: From;To;Type;Through;start_x;start_y;stop_x;stop_y;Comment
13;1690;sea;1019;655;3608;668;3617;Slemish-Arran
1504;1515;river_large;628;-1;-1;-1;-1;Rochester-Maldon
```

**Fields:**
| Column | Description |
|--------|-------------|
| From | Source province ID |
| To | Destination province ID |
| Type | Connection type: `sea` (strait), `river_large` (major river crossing), `river_small` |
| Through | Province ID of the sea/river tile the crossing passes through (-1 if none) |
| start_x, start_y | Pixel coordinates where the crossing line starts on the map (-1 for auto) |
| stop_x, stop_y | Pixel coordinates where the crossing line ends (-1 for auto) |
| Comment | Human-readable label (ignored by game) |

**Adjacency types:**
- `sea` -- A strait crossing (e.g., crossing the English Channel). Armies can walk across if the strait province is controlled
- `river_large` -- A major river crossing connection. Affects combat penalties
- `river_small` -- A minor river crossing
- `-1` coordinates tell the game to calculate positions automatically

### climate.txt -- Winter Severity
Assigns provinces to winter severity categories. Each category affects supply, attrition, and visuals.

```
mild_winter = {
    # Province IDs grouped by region
    8 10 12       # Ireland
    3 4 5 7 9 11  # Ireland
    33 35 54      # British Isles
}

normal_winter = {
    1 2           # Iceland
    34 36         # British Isles
}

severe_winter = {
    # Arctic/Siberian provinces
}
```

**Categories:** `mild_winter`, `normal_winter`, `severe_winter`. Provinces not listed in any category have no winter effects.

### seasons.txt -- Season Timing
Defines calendar dates for visual season transitions (foliage, snow, etc.).

```
winter = {
    start_date = 00.12.01
    end_date = 00.02.31
}
spring = {
    start_date = 00.04.01
    end_date = 00.05.1
}
summer = {
    start_date = 00.06.01
    end_date = 00.09.10
}
autumn = {
    start_date = 00.10.10
    end_date = 00.10.31
}
```

Also defines `tree_winter`, `tree_spring`, `tree_summer`, `tree_autumn` (and their `2` variants) for foliage transition timing. Dates use `00.MM.DD` format (year 00 = every year).

### island_region.txt -- Island Definitions
Tells the AI pathfinding which areas are islands (no land path to the continent). Uses duchy and county title keys.

```
island_region_iceland = {
    duchies = { d_iceland }
}
island_region_britain = {
    duchies = {
        d_moray
        d_western_isles
        d_albany
        # ...
    }
}
```

### geographical_regions/ -- Scripting Regions
Defines named regions that can be referenced in scripting (events, decisions, etc.). Located in `map_data/geographical_regions/`.

```
# Regions can use:
#   kingdoms = { }   -- de-jure kingdom title keys
#   duchies = { }    -- de-jure duchy title keys
#   counties = { }   -- de-jure county title keys
#   provinces = { }  -- province ID numbers
#   regions = { }    -- other region keys (must be declared earlier in file)
```

Regions follow a hierarchy: `world_europe` > `world_europe_west` > `world_europe_west_britannia`. Sub-regions must be declared before parent regions that reference them. Setting `generate_modifiers = yes` on a region auto-generates development growth modifiers for it.

### continent.txt -- Continent Assignment
Assigns provinces to continents. Referenced by `default.map`. Used for AI logic and some game rules.

## Common Modding Tasks

### Adding a New Province
This is one of the most involved map modding tasks. Every step must be completed or the game will crash or behave unexpectedly.

1. **Choose a province ID** -- Pick the next unused ID (check the end of `definition.csv`)
2. **Choose a unique RGB color** -- Must not match any existing province. Verify against the full `definition.csv`
3. **Add to definition.csv** -- Append a new line: `ID;R;G;B;PROVINCE_NAME;x;`
4. **Paint provinces.png** -- Using the exact RGB color, paint the province shape. No anti-aliasing. Must border at least one other province
5. **Update default.map** -- If this is a sea zone, river, lake, or impassable mountain, add its ID to the appropriate section. If it is a land province, no entry is needed here
6. **Add to positions.txt** -- Define city, unit, text, combat, and siege positions for the new province
7. **Update adjacencies.csv** -- If the province needs strait crossings or special connections
8. **Update climate.txt** -- Assign a winter severity
9. **Create history** -- Add `history/provinces/XXXX.txt` with culture, religion, terrain, and holding data
10. **Update title hierarchy** -- The province needs a barony and county in `common/landed_titles/`
11. **Update geographical_regions** -- Add to appropriate region(s)
12. **Update island_region.txt** -- If the province is on an island

### Modifying Terrain Type
Terrain types are assigned per-province in `history/provinces/`. To change a province's terrain:

1. Edit `history/provinces/<province_id>.txt`
2. Change the `terrain` field (e.g., `terrain = mountains`, `terrain = plains`, `terrain = desert`)
3. Terrain affects movement speed, combat modifiers, supply, and building availability

Note: The visual terrain (what you see on the map) is partly controlled by the heightmap, terrain textures, and terrain mask files in `gfx/map/terrain/`. Changing the history terrain type changes gameplay effects; changing visuals requires editing texture maps.

### Creating a Strait Crossing
To add a strait (allowing armies to walk across a sea zone):

1. Identify the two land provinces on either side
2. Identify the sea zone province between them
3. Add a line to `adjacencies.csv`:
   ```
   FROM_ID;TO_ID;sea;SEA_PROVINCE_ID;start_x;start_y;stop_x;stop_y;Description
   ```
4. Use `-1` for coordinates to let the game auto-calculate, or specify pixel positions for precise visual placement
5. The sea province in the `Through` column determines which sea tile must be controlled for the crossing

### Changing Province Borders
1. Edit `provinces.png` -- repaint the border between provinces using the correct RGB colors
2. Update `positions.txt` if city/unit positions need to move to stay within the new borders
3. Verify no orphaned pixels exist (single pixels of a different color create micro-provinces)

## Texture Format Requirements
Map-related images have strict format requirements:

| File | Format | Color Mode | Dimensions (vanilla) |
|------|--------|------------|---------------------|
| provinces.png | PNG | 8-bit RGB (no alpha) | 8192 x 4096 |
| heightmap.png | PNG | 8-bit Grayscale | 8192 x 4096 |
| rivers.png | PNG | 8-bit Indexed Color | 8192 x 4096 |

Terrain textures and other visual assets in `gfx/map/` typically use DDS format:
- **DDS compression**: BC1 (DXT1) for textures without alpha, BC3 (DXT5) for textures with alpha
- **Mipmaps**: Generate mipmaps for terrain textures
- **Dimensions**: Must be power-of-2 (e.g., 1024x1024, 2048x2048)

## Tools Commonly Used
- **Photoshop / GIMP** -- Province painting, heightmap editing. GIMP is free and handles indexed-color PNGs well. Disable anti-aliasing for province work
- **Paint.NET** -- Lighter alternative for province/heightmap editing on Windows
- **The CK3 map editor** (in-game) -- Launch with `-mapeditor` flag for basic province and position editing
- **Province ID color picker scripts** -- Community scripts that help find unused RGB values and validate definitions
- **Irfanview** -- Useful for batch-converting image formats and checking color modes
- **Paradox Asset Converter** -- For DDS texture conversion

## Checklist
When modifying map data, verify:
- [ ] Every RGB color in `definition.csv` is unique
- [ ] Every color painted in `provinces.png` has a matching entry in `definition.csv`
- [ ] No anti-aliased pixels in `provinces.png` (zoom in on borders)
- [ ] `default.map` categorizes every non-land province (sea, river, lake, impassable)
- [ ] `positions.txt` has entries for all land provinces
- [ ] `adjacencies.csv` header row is present: `From;To;Type;Through;start_x;start_y;stop_x;stop_y;Comment`
- [ ] All province IDs referenced in `climate.txt` and geographical regions actually exist
- [ ] `island_region.txt` includes all island provinces
- [ ] Image files are the correct format and dimensions (no alpha on provinces.png)
- [ ] History files exist for all new land provinces
- [ ] Title hierarchy (barony/county/duchy/kingdom/empire) includes new provinces
- [ ] If total conversion: `seasons.txt` and `continent.txt` are updated

## Pitfalls
- **Anti-aliasing in provinces.png**: Image editors love to anti-alias by default. A single blended pixel on a province border creates an undefined color that the game cannot match to any province, causing errors or invisible provinces. Always use hard-edged tools with anti-aliasing OFF
- **RGB mismatch between definition.csv and provinces.png**: Even a difference of 1 in any channel means the province does not exist. The game will log an error but may not crash -- the province simply vanishes, which is hard to debug visually
- **Province 0 (black)**: Black pixels (0,0,0) in provinces.png map to province 0, the null province. If you accidentally paint something black, it becomes void. Use black only at map edges
- **Forgetting default.map**: Adding a sea province to definition.csv and painting it is not enough. If you do not add its ID to `sea_zones` in default.map, it will be treated as a land province and behave bizarrely
- **Heightmap sea level**: If your heightmap values for water areas are too high, they render as land visually even though the game treats them as sea. Keep sea areas below the sea-level threshold (~95)
- **River connectivity**: Rivers must form continuous pixel paths. A single gap breaks the river into two disconnected segments. River sources (green pixels) must be at the upstream end
- **Position coordinate space**: Positions in `positions.txt` use the same coordinate space as the map images. If you resize the map, all positions become invalid
- **File replacement, not merging**: The game replaces entire map files with your mod version. If you override `definition.csv`, your mod must include ALL provinces, not just new ones. Same for `default.map`, `climate.txt`, etc.
- **Orphan pixels**: A single pixel of a unique color creates a valid (but tiny) province. These are nearly invisible and cause AI pathfinding issues. Always zoom to 100% and check borders
- **Missing positions.txt entries**: The game will guess city/unit positions for provinces without entries, but it often places them in water or on borders. Always define positions explicitly
- **Geographical region ordering**: Sub-regions must be declared BEFORE parent regions that reference them. If `world_europe_west` includes `world_europe_west_britannia`, then Britannia must appear first in the file
- **DDS format mistakes**: Using the wrong compression (e.g., BC7 instead of BC1) for terrain textures causes them to render as black or garbage. Check vanilla files to match the expected format for each texture type
