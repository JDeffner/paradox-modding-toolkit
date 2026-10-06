# Image guidelines

For new CK3 artwork, the community **CK3 Graphical DDS FAQ**, credited to **Sparc**, gives useful starting sizes. For a replacement, match the specific texture in your installed game or parent mod, including its format and stored mip levels. A folder's most common size is not an engine requirement, and matching dimensions alone does not guarantee the same crop or layout.

The references below separate the supplied FAQ from DDS headers inspected in **CK3 1.20.0.3 (Crozier), 4 October 2026**. The FAQ's game version is unspecified. Dimensions are **width × height in pixels**. **No mipmaps** means one stored level, the base image. Where the FAQ says **mipmaps**, it does not specify a level count.

The asset folders and examples are CK3-specific. The toolkit's conversion and preview instructions also apply to its other supported games; do not use CK3 sizes as their asset requirements.

## Coats of arms

Folders are under `gfx/coat_of_arms/`.

- **Colored emblems:** FAQ **512×512, BC3/DXT5, mipmaps**. Folder: `colored_emblems`. Current vanilla includes 97 emblems at 512×512 with 10 levels, 903 at 256×256 with 9 levels, and 543 at 128×128 with 8 levels, all DXT5. The FAQ's 512×512 guidance is supported by shipped examples; the more common 256×256 size is not a limit.
- **Patterns:** FAQ **256×256, BC1/DXT1, mipmaps**. Folder: `patterns`. Current files include 256×256 DXT1 with 9 levels and 128×128 DXT1 with 8 levels. DXT5 and base-only exceptions also exist; match the reference pattern when replacing it.

Coat-of-arms textures carry recoloring masks. Follow a comparable vanilla asset's channel layout instead of treating every channel as ordinary visible color.

## Icons

Folders in this section are relative to `gfx/interface/icons/`. **Uncompressed** means 32-bit **A8R8G8B8**, also called BGRA8 in the toolkit. Current examples describe shipped files, not a required format for every icon in that folder.

### FAQ icon sizes, with current differences

- **Religion / faith icons:** FAQ **100×100, uncompressed, no mipmaps**. Folder: `faith`. This is also the main current profile; some shipped icons have 7 levels. Check your reference before removing them.
- **Regiment type icons:** FAQ **120×120, uncompressed, no mipmaps**. Folder: `regimenttypes`. The current 120×120 examples have **7 levels**, so do not discard their mipmaps on replacement. These icons are separate from the men-at-arms illustrations below.
- **Lifestyle focus icons:** FAQ **140×140, uncompressed, no mipmaps**. Folder: `focuses`. Most current files match; a few have 8 levels.
- **Faith tenet cards:** FAQ **260×400, BC3/DXT5, no mipmaps**. Folder: `faith_tenets`, not `faith_doctrines`. Most current cards match; uncompressed cards and a few files with 9 levels also exist.
- **Faith doctrine icon banners:** FAQ **260×400, uncompressed, no mipmaps**. Current 260×400 banners are in `faith_tenets`, with DXT5 and uncompressed examples; some have 9 levels. The separate `faith_doctrines/doctrine_banner.dds` used by the faith GUI is **132×160, DXT5, 1 level**. Match the banner referenced by your target GUI.
- **Culture innovation cards:** FAQ **90×60, uncompressed, no mipmaps**. Folder: `culture_innovations`. Current files are **180×120**, mostly **BC1/DXT1 with 8 levels**. Use the larger current reference for replacements; retain 90×60 as attributed FAQ guidance, not a measurement of Crozier.
- **Character interaction icons:** FAQ **120×120, uncompressed, no mipmaps**. Folder: `character_interactions`. Current assets mix sizes and formats; many 120×120 files have **7 levels**. Both base-only and mipmapped examples exist.
- **Building type icons:** FAQ **150×130, uncompressed, no mipmaps**. Folder: `building_types`. This remains the main current profile. DXT5 files, nearby dimensions and some mipmapped assets also exist. The toolkit's BC encoder cannot export 150×130; use uncompressed output or preserve the original DDS with a suitable tool.
- **Trait icons:** FAQ **120×120, uncompressed, mipmaps**. Folder: `traits`. Current vanilla contains both base-only files and files with 7 levels. Match the individual reference rather than adding or removing mipmaps for the entire category.
- **Lifestyle perk icons:** FAQ **120×120, uncompressed, mipmaps**. Folder: `lifestyles_perks`. Current square perk icons have 7 levels; 180×60 assets in the folder serve different layouts.
- **Event type / theme icons:** FAQ **148×148**; the supplied FAQ does not state a format or mip policy. Folder: `event_types`. Most current files are **uncompressed with 8 levels**; a DXT5 base-only exception exists.

### Other current icon examples

These entries come from the installed 1.20.0.3 headers, rather than the supplied FAQ. Mixed folders need an asset-specific reference.

- **Doctrine and doctrine-group icons:** `faith_doctrines` and `faith_doctrine_groups`; commonly **120×120, uncompressed**, with either 1 or 7 levels. They are separate from the 260×400 tenet cards.
- **Modifier icons:** `modifiers`; commonly **60×60** or **120×120, uncompressed**, usually 6 or 7 levels respectively. Base-only exceptions exist.
- **Casus belli icons:** `casus_bellis`; commonly **60×60** or **120×120, uncompressed**. Mip counts vary; both base-only and full chains occur.
- **Culture tradition cards:** `culture_tradition`; commonly **545×285, uncompressed, 1 level**. Nearby sizes also occur.
- **Culture pillar icons:** `culture_pillars`; **120×120, uncompressed, 1 level**. The same folder also contains **1200×260** banners.
- **Council task icons:** `council_task_types`; commonly **140×140, uncompressed, 8 levels**. A base-only example exists.
- **Court position icons:** `court_position_types`; commonly **70×70, uncompressed**, with 1 or 7 levels. Some are 120×120.
- **Scheme icons:** `scheme_types`; commonly **120×120, uncompressed, 7 levels**. Dimensions and compression vary in some files.
- **Government icons:** `government_types`; commonly **70×70, uncompressed**, with 1 or 7 levels.
- **Terrain icons:** `terrain_types`; commonly **60×60, uncompressed**, with 1 or 6 levels.
- **Message feed icons:** `message_feed`; commonly **70×70, uncompressed, 7 levels**. Other sizes and base-only files also occur.
- **Alert banners:** `alerts`; commonly **432×144, uncompressed, 9 levels**. Some banners use different sizes or compression.
- **Achievement icons:** `achievements`; **256×256**, with uncompressed, DXT1 and DXT5 files. Most are base-only; some uncompressed files have 9 levels.
- **Flat / status icons:** `flat_icons`; commonly **60×60, uncompressed**, with 1 or 6 levels. The folder contains other shapes and sizes too.

## Illustrations

Folders are relative to `gfx/interface/illustrations/` unless a full path is given. The FAQ lists **no mipmaps** for every illustration below and for bookmarks. Current files often match that policy, but exceptions are called out rather than hidden.

- **Loading screens:** FAQ **3840×2160, BC1/DXT1**. Current examples in `loading_screens` match, with 1 level. `activity_splash_screens` and `main_menu` also contain 3840×2160 DXT1 base-only art.
- **Event scene backgrounds:** FAQ **1592×848, BC1/DXT1**. Folder: `event_scenes`. This remains the main current profile, with 1 level; other dimensions and some DXT5 files exist.
- **Frontend event scenes:** FAQ **1592×828, BC1/DXT1**. Folder: `event_scenes_frontend`. Current files are **1920×1080** or **1592×848**, DXT1, 1 level. The FAQ size is not the measured current size.
- **Decision illustrations:** FAQ **1100×440, BC1/DXT1**. Folder: `decisions`. Current files include **2200×880**, DXT5 and uncompressed alternatives. Most are base-only, but at least one has a full mip chain.
- **Council backgrounds:** FAQ **844×844, BC1/DXT1**. Folder: `council`. Current files use **844×844** or **535×615**, DXT1, 1 level. Match the intended panel, not an average of the two.
- **Character view backgrounds:** FAQ **1539×849, BC1/DXT1**. Folder: `character_view`. Current files instead include **1593×849**, **3185×1697** and **3184×1700**, DXT1, 1 level. Several dimensions are incompatible with this toolkit's BC export; see the converter limitation below.
- **Holding illustrations:** FAQ **2560×1168, BC1/DXT1**. Folder: `holding_types`. Current files match, with 1 level.
- **Terrain illustrations:** FAQ **1200×600, BC1/DXT1**. Folder: `terrain_types`. This is the main current profile, with 1 level; 1592×848 examples also exist.
- **Men-at-arms small illustrations:** FAQ **160×160, BC1/DXT1**. Folder: `men_at_arms_small`. Current files have 1 level, with DXT5 and uncompressed alternatives.
- **Men-at-arms large illustrations:** FAQ **680×400, BC1/DXT1**. Folder: `men_at_arms_big`. Current files have 1 level, with DXT5 and uncompressed alternatives.
- **Lifestyle backgrounds:** FAQ **608×1546, BC3/DXT5**. Folder: `lifestyles_background`. Current files are **608×1552**, mostly **DXT1**, with 1 level; one is DXT5.
- **Lifestyle tree backgrounds:** FAQ **347×812, BC3/DXT5**. Folder: `gfx/interface/icons/lifestyle_tree_backgrounds`. Current artwork is **348×812** or **500×812, DXT1, 1 level**; a larger uncompressed file also exists. The FAQ's 347×812 size was not found in the inspected files. Separate UI frames live under `gfx/interface/window_lifestyles`; check the tree's specific texture reference.
- **Dynasty legacy tracks:** FAQ **4216×368, BC3/DXT5**. Folder: `legacy_tracks`. Current files use **4216×368** or **4220×368**, **DXT1**, with 1 level.
- **Bookmark backgrounds:** FAQ **1920×1080, BC3/DXT5**. Folder: `gfx/interface/bookmarks`. This remains the main current background profile, with 1 level. The folder also contains smaller title and decoration textures; those are not background-size examples.

Additional current examples: `activity_backgrounds` includes 1592×848 and 3840×2160 files, with both base-only and full-chain textures and both DXT1 and DXT5. Tall `activity_types` panels are commonly 460×1100 DXT1 with 1 level; some newer files use BC7 in a DX10 header, which the toolkit can preview but cannot match for export.

## Clothing pattern textures and portrait masks

Inspect the matching target texture under `gfx/portraits/accessory_variations/textures/patterns/` before converting. The supplied FAQ gives **512×512, BC3/DXT5, mipmaps** for both pattern properties and pattern normals. Current 1.20.0.3 headers show:

- **Pattern properties:** 512×512 DXT5, **10 stored levels**, a full chain down to 1×1.
- **Pattern normals:** 512×512 DXT5, **10 stored levels**. Their channels are material data; ordinary color filtering is not a substitute for a normal-map-aware tool.
- **Pattern masks:** 512×512 DXT5, **2 stored levels**, 512×512 and 256×256. This is a partial chain. The FAQ does not specify these mask files.

For example, `byzantine/byzantine_silk_trim_03_masks.dds` under that folder has **2 levels in 1.20.0.3**. The earlier page's 10-level example does not match this version. Use a 512×512 PNG and **Match reference DDS...** with the installed mask. The manual equivalent for this current file is **BC3 / DXT5**, then **Custom mip level count...**, then **2**, not a full chain.

CK3 can assemble individual 2D textures into texture arrays. Match the target member's resolution, compression and mip count, even when the pixels look opaque. Auto cannot infer those requirements. Inconsistent properties can cause the game's texture-array error and white textures. Other portrait and model masks can have different dimensions and counts; the 512×512 pattern example is not a rule for every mask.

An actual multi-slice DDS array is a different resource. The toolkit's converter rejects DDS arrays, cubemaps and volumes instead of flattening them. Use a tool that preserves all surfaces for those resources.

## Convert an image or replace an existing texture

Run **PX: Convert Image to DDS** from the Command Palette, image context menu or Project view. For a replacement, choose **Match reference DDS...** and select the original game or parent-mod DDS. It stays read-only. The source image must already have the same dimensions; a mismatch fails without resizing or writing the output.

Reference matching copies the reference's compression format and exact mip count, including partial chains. It generates the new mip pixels from your source image; it does not copy the reference's artwork. Supported reference formats are classic **DXT1, DXT5 and A8R8G8B8 single 2D textures**. BC7, DX10 headers and other formats are reported as unsupported, even when the viewer can display them.

### Choose a format manually

- **BC1 / DXT1:** compressed color for opaque artwork. It stores 4 bits per pixel before headers and mip levels. This toolkit does not export BC1 transparency.
- **BC3 / DXT5:** compressed color plus alpha, 8 bits per pixel. Use the reference format for packed masks; apparent transparency alone does not determine their required format.
- **Uncompressed A8R8G8B8 / BGRA8:** 32 bits per pixel, with no block-compression loss. Useful for crisp icons and dimensions the toolkit's BC encoder cannot export.
- **Auto:** selects BC3 if any pixel has alpha below 255, otherwise BC1. If either dimension is not divisible by four, it selects uncompressed output and keeps the source dimensions.

The toolkit's **BC1/BC3 encoder requires base width and height to be multiples of four**. Explicit BC1/BC3 and reference-matched BC output fail for other dimensions. This is an export limitation, not proof that an existing CK3 DDS is invalid: shipped files include exceptions such as 535×615 and 1593×849 DXT1. Do not resize a replacement or change its format just to get past the error. Preserve the original DDS or use a suitable external texture tool, then test the result in the game.

### Choose mip levels

Manual conversion offers **No mipmaps**, **Generate full mip chain**, and **Custom mip level count...**. The count includes the base: **1** is base-only; **2** is the base plus one smaller image. A full chain ends at 1×1. A custom count applies to each image in a batch; a count too large for an image fails without replacing existing output. Reference matching uses the reference count without another prompt.

Some interface assets have mipmaps and some 3D masks have partial chains. Follow the reference rather than applying "UI means no mipmaps" or "3D means a full chain." The toolkit filters RGBA channels independently, without gamma correction, alpha-weighted color filtering or normal-vector normalization. Use a specialized texture tool when your asset requires those operations.

### Preserve mask and alpha data

PNG input preserves all four channels, including RGB under zero alpha. PNG color profiles are not applied, and 16-bit input is reduced to 8 bits per channel. JPEG is lossy and has no alpha. Other image inputs use browser decoding, which can discard RGB under transparent pixels. Prefer PNG for packed channel data.

For ordinary transparent artwork, use straight alpha. For masks and material textures, first check what each channel stores. DDS-to-PNG batch conversion exports only the base image; PNG does not retain the DDS compression format or mip chain for a later conversion.

## Preview and inspect a DDS

**DDS Preview** opens `.dds` files by default unless you changed the editor association. Use **Open With > DDS Preview** to choose it explicitly. **Mip level** selects each stored level and shows its dimensions; zooming does not change the selected mip. One-level files show **No smaller mipmaps**.

**Save preview PNG** exports only the displayed surface and selected level, with `.mip-N.png` suggested above level 0. Batch DDS-to-image conversion exports the base level of a single 2D image. Neither operation preserves a complete mip chain in the PNG.

The viewer supports its existing DXT1/3/5, BC7 and uncompressed formats. For DDS arrays and cubemaps it displays the first slice or face. Volume textures, padded uncompressed rows and malformed or truncated chains show a mip-preview warning; a decodable base image can remain visible.

Hover a supported `.dds` path in script for an inline preview. Unresolved paths have no texture preview; unsupported formats or the preview-size limit can produce file information without an image. Mirror game-relative texture paths in the mod, and use forward slashes in GUI references, for example `texture = "gfx/interface/icons/my_icon.dds"`.

## Import a creator picture

**Custom picture** uses the same DDS choices. The first choices are **Uncompressed (A8R8G8B8)** and **Generate full mip chain**; these are UI defaults, not requirements for every icon. Select the reference's format and mip policy. Existing DDS inputs are copied without re-encoding, preserving their format and levels.

The importer asks before replacing a picture and refuses the replacement if its destination changed while the question was open. Cancel leaves the existing file intact. Remembered destinations belong to the selected mod, linked folders outside the mod are rejected, and importing the file already at its destination leaves it unchanged.

## Sources and scope

- **Community reference:** the supplied "CK3 Graphical DDS FAQ", credited to **Sparc**. Its sizes and export guidance are labelled as FAQ entries above; its date and game version were not supplied.
- **Current file evidence:** DDS headers from the installed **CK3 1.20.0.3 (Crozier)**, inspected on **4 October 2026**. A shipped file's properties establish an example, not every format or size that the engine accepts. Folder summaries do not replace inspecting the target file, and no in-game rendering test was performed for this page update.
- **Format terminology:** [Microsoft's texture block compression reference](https://learn.microsoft.com/en-us/windows/win32/direct3d11/texture-block-compression-in-direct3d-11). BC1/DXT1 and BC3/DXT5 names refer to their compression formats; uncompressed A8R8G8B8 uses 8 bits for each of four channels.
