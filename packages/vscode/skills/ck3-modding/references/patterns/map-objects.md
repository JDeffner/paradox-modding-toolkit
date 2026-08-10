# Map Objects (3D Buildings, Locators, Entities)

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
- Map objects are 3D models placed on the CK3 map: buildings, bridges, animals, special monuments, environmental props
- They are defined in `gfx/map/map_object_data/` as text files describing what to render, where, and how
- There are two main systems: **objects** (static meshes placed at explicit coordinates) and **locators** (province-indexed positions where the game dynamically spawns entities)
- The locator system links province IDs to positions so the game knows where to show building models, siege equipment, and army stacks for each barony
- The layer system controls visibility, fade distances, and camera-zoom behavior
- Entity/asset files (`.asset`) define the 3D meshes and their materials; map object data files reference them by name
- Coordinate system: X and Z are the horizontal map plane, Y is height (usually 0.0 and clamped to terrain). Rotation is a quaternion (X, Y, Z, W)

## Key Concepts

### File Hierarchy
```
gfx/map/map_object_data/
    building_locators.txt          # Per-province locators for regular buildings
    special_building_locators.txt  # Per-province locators for special/unique buildings
    siege_locators.txt             # Per-province locators for siege equipment
    stack_locators.txt             # Army stack positions
    combat_locators.txt            # Combat positions
    bridges.txt                    # Bridge objects (static placement)
    animals.txt                    # Decorative animals (elephants, horses, etc.)
    special.txt                    # Special building meshes (Hagia Sophia, Hadrian's Wall, etc.)
    layers.txt                     # Layer definitions (foliage, water, map table)
    game_object_layers.txt         # Game-logic layers (buildings, units, activities)
    effect_layers.txt              # Visual effect layers (coast foam, environment)
    activities.txt                 # Activity-related map objects

gfx/models/buildings/
    all_buildings.asset            # Master entity with locators for every building sub-entity
    holdings/                      # Per-building .asset files (mesh + entity)
    special/                       # Special building .asset files
```

### Two Types of Map Object Data

**1. Objects (`object={}`)** -- static meshes placed at explicit world coordinates:
```
object={
    name="bridge 01"
    render_pass=MapUnderWater
    clamp_to_water_level=no
    generated_content=no
    layer="temp_layer"
    pdxmesh="bridge_01_mesh"
    count=65
    transform="X Y Z  qX qY qZ qW  sX sY sZ
               X Y Z  qX qY qZ qW  sX sY sZ
               ..."
}
```
Used for: bridges, animals, special building meshes, environmental props, walls.

**2. Locators (`game_object_locator={}`)** -- province-indexed positions where the game spawns entities dynamically:
```
game_object_locator={
    name="buildings"
    render_pass=Map
    clamp_to_water_level=yes
    generated_content=no
    layer="building_layer"
    instances={
        {
            id=1                                        # Province ID
            position={ 271.799835 0.000000 4462.883301 }
            rotation={ -0.000000 -0.960029 -0.000000 0.279900 }
            scale={ 1.000000 1.000000 1.000000 }
        }
        ...
    }
}
```
Used for: building_locators, special_building_locators, siege_locators, stack_locators, combat_locators.

## File Format

### Object Definition
| Field | Description |
|---|---|
| `name` | Unique identifier string (can contain spaces) |
| `render_pass` | `Map` (on terrain surface) or `MapUnderWater` (can go below water line) |
| `clamp_to_water_level` | `yes` = objects float on water; `no` = objects follow terrain height |
| `generated_content` | `yes` for engine-generated objects (trees, etc.); `no` for hand-placed |
| `layer` | Which visibility layer this belongs to (see Layer System below) |
| `pdxmesh` | Direct mesh reference (for `object={}` types) |
| `entity` | Entity reference (for `object={}` types that use entities instead of raw meshes) |
| `count` | Number of instances in the transform block |
| `transform` | Packed transform data: 10 floats per instance (posX posY posZ quatX quatY quatZ quatW scaleX scaleY scaleZ) |

Objects use either `pdxmesh` or `entity` to specify what to render. Most buildings and special structures use `pdxmesh`; animals use `entity` because they have animations.

### Locator Instance Format
Each instance in a `game_object_locator` block:
| Field | Description |
|---|---|
| `id` | Province barony ID (matches the province numbering in `map_data/`) |
| `position` | `{ X Y Z }` world coordinates on the map |
| `rotation` | `{ X Y Z W }` quaternion rotation |
| `scale` | `{ X Y Z }` scale factors (usually all 1.0) |

### Transform Format (for objects)
The `transform` field packs all instances into a single string, 10 floats per line:
```
posX posY posZ  quatX quatY quatZ quatW  scaleX scaleY scaleZ
```
- **Position**: X = east-west, Y = height (usually 0.0), Z = north-south
- **Rotation**: Quaternion. For a simple Y-axis rotation of angle A: `0.0 sin(A/2) 0.0 cos(A/2)`
- **Scale**: Uniform scaling is most common (all three values equal)

### Layer System
Layers control when objects appear/disappear as the camera zooms. Defined across three files:

**layers.txt** -- environment layers (foliage, water, map table variants):
```
layer={
    name="grass_layer"
    fade_in=0          # Zoom level where objects start appearing
    fade_out=6         # Zoom level where objects disappear
    category="map_foliage_category"
    masks="high"       # Detail level masks: "low", "medium", "high" or combinations
    visibility_tags="" # Engine visibility tags (e.g., "map_table_style_western")
}
```

**game_object_layers.txt** -- game-logic layers (buildings, units):
```
layer={
    name="building_layer"
    fade_in=0
    fade_out=9
    category=""
    masks=""
    visibility_tags=""
}
```

**effect_layers.txt** -- visual effect layers:
```
layer={
    name="coast_foam_layer"
    fade_in=0
    fade_out=9
    category=""
    masks="medium|high"
    visibility_tags=""
}
```

Key layers for modding:
| Layer | Used By | fade_out |
|---|---|---|
| `building_layer` | Building locators, special buildings | 9 |
| `unit_layer` | Siege locators, army stacks, animals | 9 |
| `activities_layer` | Activity map objects | 9 |
| `temp_layer` | Bridges, special building meshes, walls | (defined elsewhere) |

### Entity/Asset System
An `.asset` file defines a 3D mesh and wraps it in an entity:

```
# gfx/models/buildings/holdings/building_western_castle_04.asset

pdxmesh = {
    name = "building_western_castle_04_mesh"
    file = "building_western_castle_04.mesh"

    meshsettings = {
        name = "building_western_castle_0Shape4"
        index = 0
        texture_diffuse = "building_western_atlas_diffuse.dds"
        texture_normal = "building_western_atlas_normal.dds"
        texture_specular = "building_western_atlas_properties.dds"
        shader = "standard_atlas"
        shader_file = "gfx/FX/pdxmesh.shader"
    }
}

entity = {
    name = "building_western_castle_04_entity"
    pdxmesh = "building_western_castle_04_mesh"
}
```

The `pdxmesh` block binds a `.mesh` binary file to a named mesh with textures and shaders. The `entity` block gives the mesh a name the game can reference. Map object data files then reference either the mesh name (via `pdxmesh=`) or entity name (via `entity=`).

### Master Building Entity
`all_buildings.asset` defines a master entity that arranges all building sub-entities on a grid using locators:

```
entity = {
    name = "building_all"
    @gap = 7

    # Locators position each building variant on a grid
    locator = { name = "pos_00_a" position = { @[gap * -4.5] 000 @[gap * -1.5] } }
    attach = {  "pos_00_a" = "western_walls_01_a_entity" }

    locator = { name = "pos_04_a" position = { @[gap * -0.5] 000 @[gap * -1.5] } }
    attach = {  "pos_04_a" = "building_western_castle_01_entity" }
    ...
}
```

The game uses this entity to compose the building visuals for each barony. The `building_locators.txt` positions this entity at each province, and the game selects which sub-entities to show based on constructed buildings.

### How Buildings Link to Map Visuals
The chain from gameplay to visuals:
1. **`common/buildings/`** defines the building with gameplay stats
2. **`building_locators.txt`** maps each province ID to a world position where the building entity spawns
3. **`all_buildings.asset`** or individual entity definitions compose the 3D models
4. **`gfx/models/buildings/`** contains the `.asset`, `.mesh`, and texture files
5. The game's building system selects which sub-entities to display based on what the player has built

For **special buildings** (unique landmarks), the chain adds:
1. **`special_building_locators.txt`** provides the position per province
2. **`special.txt`** (in `map_object_data/`) places the unique mesh via `object={}` with `pdxmesh`
3. The special building `.asset` file in `gfx/models/buildings/special/` provides the mesh

## Common Tasks

### Place a New Building Model
1. Create the `.asset` file with `pdxmesh` and `entity` definitions:
```
# gfx/models/buildings/holdings/my_custom_building.asset
pdxmesh = {
    name = "my_custom_building_mesh"
    file = "my_custom_building.mesh"
    meshsettings = {
        name = "my_custom_buildingShape"
        index = 0
        texture_diffuse = "my_custom_building_diffuse.dds"
        texture_normal = "my_custom_building_normal.dds"
        texture_specular = "my_custom_building_properties.dds"
        shader = "standard_atlas"
        shader_file = "gfx/FX/pdxmesh.shader"
    }
}
entity = {
    name = "my_custom_building_entity"
    pdxmesh = "my_custom_building_mesh"
}
```
2. Place the `.mesh` and `.dds` texture files alongside the `.asset` file
3. Reference the entity or mesh from your map object data

### Add Special Building Visuals
To give a special/unique building its own 3D model on the map:

1. Create the `.asset` file in `gfx/models/buildings/special/`
2. Add an `object={}` entry in a map object data file (create your own or append):
```
# gfx/map/map_object_data/my_special_buildings.txt
object={
    name="my_special_temple"
    render_pass=MapUnderWater
    clamp_to_water_level=no
    generated_content=no
    layer="temp_layer"
    pdxmesh="my_special_temple_mesh"
    count=1
    transform="1234.56 0.000000 5678.90 0.000000 0.000000 0.000000 1.000000 1.000000 1.000000 1.000000
"}
```
3. The game logic in the building definition controls when this object appears

### Modify Locator Positions
To move where a building appears for a specific province:

1. Copy the relevant locator file to your mod: `gfx/map/map_object_data/building_locators.txt`
2. Find the instance with the target province `id`
3. Adjust `position` values (X and Z for horizontal placement, Y usually stays 0.0)
4. Adjust `rotation` quaternion if needed

**Warning**: Locator files are monolithic -- you must include ALL provinces if you override the file, not just your changes. The game replaces (does not merge) these files.

### Add a Decorative Map Object
For animals, props, or other non-building objects:

```
# gfx/map/map_object_data/my_decorations.txt
object={
    name="my_camel"
    render_pass=Map
    clamp_to_water_level=yes
    generated_content=no
    layer="unit_layer"
    entity="camel_entity"
    count=5
    transform="1000.0 0.0 2000.0 0.0 0.5 0.0 0.866 1.0 1.0 1.0
               1050.0 0.0 2010.0 0.0 -0.3 0.0 0.954 1.0 1.0 1.0
               1100.0 0.0 1990.0 0.0 0.707 0.0 0.707 1.0 1.0 1.0
               1080.0 0.0 2050.0 0.0 0.0 0.0 1.0 1.0 1.0 1.0
               1020.0 0.0 2030.0 0.0 -0.866 0.0 0.5 1.0 1.0 1.0
"}
```

### Define a Custom Layer
If you need custom visibility behavior:
```
# gfx/map/map_object_data/my_layers.txt (or add to an existing layer file)
layer={
    name="my_custom_layer"
    fade_in=0
    fade_out=12
    category=""
    masks="medium|high"
    visibility_tags=""
}
```
Then reference `layer="my_custom_layer"` in your object definitions.

## Checklist

- [ ] `.asset` file defines both `pdxmesh` and `entity` blocks
- [ ] `.mesh` binary file exists at the path referenced by the asset
- [ ] Texture files (`.dds`) exist and are referenced correctly in `meshsettings`
- [ ] Map object data file uses correct format (`object={}` or `game_object_locator={}`)
- [ ] `layer` value matches a defined layer name in layers.txt, game_object_layers.txt, or effect_layers.txt
- [ ] `count` matches the actual number of transform entries
- [ ] Transform data has exactly 10 floats per instance (position 3 + rotation 4 + scale 3)
- [ ] Province IDs in locators match valid provinces from `map_data/`
- [ ] If overriding a vanilla locator file, ALL provinces are included (not just modified ones)
- [ ] `render_pass` is appropriate: `Map` for surface objects, `MapUnderWater` for objects that clip below water
- [ ] Entity names are unique across all `.asset` files

## Pitfalls

**Locator files replace, they don't merge.** If your mod provides `building_locators.txt`, it completely replaces vanilla's file. You must include every province's locator, not just the ones you changed. Missing provinces will have no building visuals.

**Count must match transform entries.** If `count=5` but you have 4 lines of transform data, the game will read garbage data for the 5th instance, causing visual glitches or crashes.

**Quaternion rotation is not Euler angles.** The rotation field uses quaternion format `{ X Y Z W }`, not degrees. For a simple rotation around the vertical axis by angle A in radians: `{ 0.0 sin(A/2) 0.0 cos(A/2) }`. Getting this wrong causes objects to float, tilt, or disappear underground.

**Y position is usually 0.0 for clamped objects.** When `clamp_to_water_level=yes`, the Y coordinate is ignored and the engine places objects on the terrain surface. Setting a non-zero Y can cause unexpected behavior with unclamped objects.

**`pdxmesh` vs `entity` in object definitions.** Use `pdxmesh` for static meshes (buildings, bridges, walls). Use `entity` for animated objects (animals, units) that need entity state machines. Using the wrong one silently fails.

**Layer fade distances affect visibility.** If your custom object disappears too early when zooming out, check that its layer's `fade_out` value is high enough. Building and unit layers default to `fade_out=9`.

**The `masks` field filters by detail settings.** `masks="high"` means the object only appears on High graphics settings. Use `masks="low|medium|high"` or `masks=""` (empty = always visible regardless of settings) to ensure visibility on all settings.

**Entity name collisions.** If two `.asset` files define entities with the same name, one silently overwrites the other. Always prefix custom entity names with your mod's namespace.

**Map object data files are additive for new files.** Unlike locator files, you can add entirely new `.txt` files in `gfx/map/map_object_data/` and the game will load them alongside vanilla files. Only locator files (which are loaded by specific name) need full replacement.
