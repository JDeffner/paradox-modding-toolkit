# Image guidelines (CK3 folders; the DDS formats apply to all games)

Every number below was **measured from the vanilla 1.19 game files** (most
common size and format per folder), so match them and your art will drop into
the game's UI without scaling artifacts. Sizes are width×height in pixels.
Rows the measurement did not cover are filled from the community "Graphical
DDS FAQ" (thanks to Sparc).

Convert PNG/JPEG/WebP to DDS with **Paradox: Convert Image to DDS** (also in the
right-click menu on image files and the Project view). Preview any `.dds` by
just clicking it.

## Which DDS format?

| Format | When | Notes |
|---|---|---|
| **BC1 / DXT1** | Photos/illustrations without transparency | 6:1 compression; what vanilla uses for event scenes and loading screens |
| **BC3 / DXT5** | Anything with smooth transparency (emblems, decorated icons) | 4:1 compression |
| **Uncompressed (A8R8G8B8)** | Small GUI icons with crisp edges | What vanilla uses for most icons ≤ ~150px; zero artifacts, larger file |
| Auto (converter default) | — | BC3 if the image has any transparency, else BC1 |

Rule of thumb straight from the vanilla data: **small icons are uncompressed,
big illustrations are BC1, anything with alpha gradients is BC3.** The
converter writes no mipmaps, which matches most vanilla interface textures —
the exceptions that DO ship mipmaps in vanilla are trait icons, lifestyle
perks, coat-of-arms emblems/patterns and clothing textures. A missing mipmap
chain still renders in the UI; for 3D-mapped textures (clothing) it costs
shimmer at distance.

## Icons (`gfx/interface/icons/…`)

| What | Folder | Size | Vanilla format |
|---|---|---|---|
| Trait icons | `icons/traits` | **120×120** | uncompressed (mipmaps in vanilla) |
| Modifier icons | `icons/modifiers` | 60×60 (also 120×120) | uncompressed |
| Character interaction icons | `icons/character_interactions` | 120×120 | uncompressed |
| Decision icons | see decision illustrations below | — | — |
| Casus belli icons | `icons/casus_bellis` | 60×60 or 120×120 | uncompressed |
| Faith icons | `icons/faith` | **100×100** | uncompressed |
| Faith doctrine icons | `icons/faith_doctrines` | 260×400 (cards) or 120×120 | DXT5 / uncompressed |
| Culture tradition cards | `icons/culture_tradition` | **545×285** | uncompressed |
| Culture innovation cards | `icons/culture_innovations` | 180×120 | DXT1 |
| Culture pillar icons | `icons/culture_pillars` | 120×120 | uncompressed |
| Lifestyle focus icons | `icons/focuses` | 140×140 | uncompressed |
| Lifestyle perk icons | `icons/lifestyles_perks` | 120×120 | uncompressed (mipmaps in vanilla) |
| Building icons | `icons/building_types` | **150×130** | uncompressed |
| Council task icons | `icons/council_task_types` | 140×140 | uncompressed |
| Court position icons | `icons/court_position_types` | 70×70 | uncompressed |
| Scheme icons | `icons/scheme_types` | 120×120 | uncompressed |
| Men-at-arms / regiment icons | `icons/regimenttypes` | 120×120 | uncompressed |
| Event theme icons | `icons/event_types` | **148×148** | uncompressed |
| Government icons | `icons/government_types` | 70×70 | uncompressed |
| Terrain icons | `icons/terrain_types` | 60×60 | uncompressed |
| Message feed icons | `icons/message_feed` | 70×70 | uncompressed |
| Alert banners | `icons/alerts` | 432×144 | uncompressed |
| Achievement icons | `icons/achievements` | 256×256 | uncompressed / DXT5 |
| Generic flat/status icons | `icons/flat_icons` | 60×60 | uncompressed |

## Illustrations (`gfx/interface/illustrations/…`)

| What | Folder | Size | Vanilla format |
|---|---|---|---|
| **Event scene backgrounds** | `illustrations/event_scenes` | **1592×848** (frontend variants 1592×828) | DXT1 |
| Decision illustrations | `illustrations/decisions` | **1100×440** (2200×880 for hi-res) | DXT1 |
| Activity backgrounds | `illustrations/activity_backgrounds` | 1592×848 or 3840×2160 | DXT1 |
| Activity type panels (tall) | `illustrations/activity_types` | 460×1100 | DXT1 |
| Splash / loading screens | `illustrations/loading_screens` | **3840×2160** | DXT1 |
| Council background | `illustrations/council` | 844×844 / 535×615 | DXT1 |
| Character view background | `illustrations/character_view` | 1539×849 | DXT1 |
| Holding type illustrations | `illustrations/holding_types` | 2560×1168 | DXT1 |
| Terrain type illustrations | `illustrations/terrain_types` | 1200×600 | DXT1 |
| Men-at-arms small | `illustrations/men_at_arms` | 160×160 | DXT1 |
| Men-at-arms large | `illustrations/men_at_arms` | 680×400 | DXT1 |
| Lifestyle backgrounds | `illustrations/lifestyles` | 608×1546 | DXT5 |
| Lifestyle tree backgrounds | `illustrations/lifestyles` | 347×812 | DXT5 |
| Dynasty legacy tracks | `illustrations/legacies` | 4216×368 | DXT5 |
| Bookmark backgrounds | `gfx/interface/bookmarks` | 1920×1080 | DXT5 |

## Coats of arms (`gfx/coat_of_arms/…`)

| What | Folder | Size | Vanilla format |
|---|---|---|---|
| Colored emblems | `coat_of_arms/colored_emblems` | **256×256** (128×128 for simple ones) | DXT5 |
| Patterns | `coat_of_arms/patterns` | 256×256 | DXT1 |

Emblems are masks: the game recolors them, so author them in the
red/green/blue mask convention (see vanilla examples in the same folder).
Both emblems and patterns ship **with mipmaps** in vanilla (they scale on the
map). Community sources also report 512×512 emblems working; the measured
vanilla majority is 256×256.

## Clothing & portrait textures (`gfx/portraits/…`)

| What | Size | Format |
|---|---|---|
| Clothing pattern properties | 512×512 | DXT5, **mipmaps** |
| Clothing pattern normals | 512×512 | DXT5, **mipmaps** |

Larger dimensions work in newer patches; the smaller ones keep working. These
are 3D-mapped, so generate mipmaps in your DDS tool (the built-in converter
does not write them yet).

## Gotchas

- The game finds textures by **exact path**: your mod mirrors
  `gfx/interface/icons/traits/my_trait.dds` and the trait's `icon` key (or the
  default `<trait_name>.dds` lookup) must match. A typo means an empty icon
  and **zero error output**.
- GUI files reference textures with forward slashes:
  `texture = "gfx/interface/icons/my_icon.dds"`.
- Non-power-of-two sizes are fine for interface textures (vanilla is full of
  them, e.g. 545×285 tradition cards).
- Keep transparency premultiplied-free (straight alpha); export PNG with
  transparency and let the converter pick BC3.
- Hover any `gfx/...` path in script to preview the texture inline; click a
  `.dds` in the explorer for the full preview.
