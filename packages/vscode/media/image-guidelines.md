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
| Auto (converter default) | Ordinary images | BC3 if alpha is present, else BC1; uncompressed if either dimension is not divisible by 4 |

Rule of thumb from the vanilla data: **small icons are uncompressed, big illustrations are BC1, anything with alpha gradients is BC3.** BC1 and BC3 output requires width and height to be multiples of four. Auto uses uncompressed output for other sizes and keeps the original dimensions. An explicit BC1 or BC3 choice reports incompatible dimensions as a failure.

For replacements, choose **Match reference DDS...** and select the original vanilla or parent-mod texture. The converter copies its compression format and exact mip count, including partial chains. Source dimensions must match; a mismatch is reported as a failure without resizing or writing the output. The reference file stays read-only. Reference matching supports DXT1, DXT5 and A8R8G8B8 single 2D textures. Other formats, including BC7 and DX10 headers, are reported as unsupported rather than substituted.

When choosing a format manually, the converter offers **No mipmaps**, **Generate full mip chain**, and **Custom mip level count...**. The count includes the base image: **1** writes only the base, and **2** writes the base plus one smaller mip (for example, 200×200 and 100×100). A full chain continues down to 1×1. A custom count applies to every image in a batch; images too small for that count fail without replacing existing output. Reference matching uses the original count without a separate prompt. Some vanilla UI textures also have mipmaps, so check the original instead of assuming interface art needs none. Smaller levels use a box filter on each RGBA channel independently. Filtering does not apply gamma correction, multiply RGB by alpha, or renormalize normal maps. Use a specialized texture tool when those operations are needed.

## Texture arrays and portrait masks

**Match the original texture's resolution, compression format and mip-level count.** Auto chooses from pixel content and dimensions; it cannot infer the format required by a texture array. Even an opaque mask may need BC3 because the other array textures use it. A mismatch can produce CK3's `in texture array has inconsistent properties` error and white textures.

For example, the vanilla `gfx/portraits/accessory_variations/textures/patterns/byzantine/byzantine_silk_trim_03_masks.dds` inspected for this fix is **512×512, BC3/DXT5, with 10 levels including the base**. To replace it, use a 512×512 PNG and **Match reference DDS...** with that installed texture. The manual equivalent is **BC3 / DXT5**, then **Generate full mip chain**. Check the original in your installed game or parent mod if its version differs.

PNG input preserves all four channels, including RGB where alpha is zero. This matters for masks and material textures, where alpha stores data rather than transparency. PNG color profiles are not applied; 16-bit inputs are reduced to 8 bits per channel. JPEG is lossy and has no alpha. Other image inputs use browser decoding and can discard RGB under transparent pixels, so use PNG for packed channel data. DDS-to-PNG conversion reads the base level only; PNG does not carry the DDS format or mip chain back into a later conversion.

## Inspect stored mipmaps

Open a DDS in the viewer and use **Mip level** to inspect each stored level and its dimensions. Level 0 is the base image. Files with one level show **No smaller mipmaps**. The viewer decodes the selected level from the file; zooming alone does not select another mipmap. **Save preview PNG** exports only the displayed surface and selected level, with `.mip-N.png` suggested for levels above zero. Batch DDS-to-image conversion exports the base level of a single 2D image.

The viewer supports mip levels in its existing DXT1/3/5, BC7 and uncompressed formats. For texture arrays and cubemaps it displays the first slice or face. Volume textures, padded uncompressed rows and malformed or truncated chains show a mip-preview warning; the base image remains visible when it can be decoded.

Batch conversion rejects cubemaps, texture arrays and volume textures before writing output. Use a DDS tool that preserves all surfaces when editing those files. To deliberately extract the visible face or slice, use **Save preview PNG** in the viewer.

## Import pictures in a creator

**Custom picture** uses the same DDS choices as the converter. The first choices are **Uncompressed (A8R8G8B8)** and **Generate full mip chain** to preserve icon detail and supply smaller levels. Choose **Match reference DDS...** when replacing an existing game texture. Existing DDS inputs are copied without re-encoding, preserving their format and mip levels.

The importer asks before replacing a picture and refuses a replacement if the destination changed while the question was open. Cancel leaves the existing file intact. Remembered destinations belong to the selected mod, and folders that link outside that mod are rejected. Importing the file already at the destination leaves it unchanged.

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

These are 3D-mapped textures. Match the original dimensions and format, and select **Generate full mip chain** when the original has a full chain. For texture arrays, all entries must have matching properties.

## Gotchas

- The game finds textures by **exact path**: your mod mirrors
  `gfx/interface/icons/traits/my_trait.dds` and the trait's `icon` key (or the
  default `<trait_name>.dds` lookup) must match. A typo means an empty icon
  and **zero error output**.
- GUI files reference textures with forward slashes:
  `texture = "gfx/interface/icons/my_icon.dds"`.
- Non-power-of-two sizes are valid for interface textures. BC1/BC3 base dimensions must still be divisible by four; use uncompressed DDS for sizes such as 545×285.
- Keep transparency premultiplied-free (straight alpha); export PNG with
  transparency and let the converter pick BC3.
- Hover any `gfx/...` path in script to preview the texture inline; click a
  `.dds` in the explorer for the full preview.
