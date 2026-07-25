# Chapter 8: Graphics and icons

Sooner or later your trait needs an icon and your event wants a background. CK3 textures are DDS files at specific sizes, and the game's failure mode here is the familiar one: a wrong path or size produces an empty graphic and **zero error output**. This chapter gives you the formats, the sizes and the tooling.

The extension bundles a full reference measured from the vanilla 1.19 files: run **Paradox: Show Image Guidelines (sizes & formats)** to open it. The tables below are the highlights; the guidelines document has the complete folder-by-folder listing.

## The golden rule: exact paths

The game finds textures by exact path. Your mod mirrors the vanilla folder, and the referencing key must match:

- A trait `chron_famed_chronicler` looks for `gfx/interface/icons/traits/chron_famed_chronicler.dds` by default (or whatever its `icon = ...` says).
- GUI files reference textures with **forward slashes**: `texture = "gfx/interface/icons/chron_icon.dds"`.
- A typo anywhere in the path means an empty icon and nothing in any log.

The extension softens this: hover any `gfx/...` path in script to preview the texture inline, and clicking a `.dds` file in the Explorer opens the built-in DDS preview.

## Which DDS format?

| Format | Use for | Notes |
|---|---|---|
| **BC1 / DXT1** | Photos and illustrations without transparency | 6:1 compression; vanilla's choice for event scenes and loading screens |
| **BC3 / DXT5** | Anything with smooth transparency (emblems, decorated icons) | 4:1 compression |
| **Uncompressed (A8R8G8B8)** | Small GUI icons with crisp edges | Vanilla's choice for most icons up to ~150px; zero artifacts |

Rule of thumb, measured straight from the vanilla data: **small icons uncompressed, big illustrations BC1, alpha gradients BC3.**

You do not need Photoshop plugins for any of this. **Paradox: Convert Image to DDS** converts PNG, JPEG or WebP (also available by right-clicking an image file in the Explorer). Its automatic mode picks BC3 if the image has transparency and BC1 otherwise, and it writes no mipmaps, matching vanilla interface textures. Export your art as PNG with straight (non-premultiplied) alpha and let the converter do the rest.

## The sizes that matter most

Sizes are width by height in pixels, measured as the dominant size per vanilla folder:

| What | Folder under `gfx/interface/` | Size | Vanilla format |
|---|---|---|---|
| Trait icons | `icons/traits` | **120×120** | uncompressed |
| Faith icons | `icons/faith` | **100×100** | uncompressed |
| Character interaction icons | `icons/character_interactions` | 120×120 | uncompressed |
| Scheme icons | `icons/scheme_types` | 120×120 | uncompressed |
| Lifestyle perk icons | `icons/lifestyles_perks` | 120×120 | uncompressed |
| Culture tradition cards | `icons/culture_tradition` | 545×285 | uncompressed |
| Building icons | `icons/building_types` | 150×130 | uncompressed |
| Event theme icons | `icons/event_types` | 148×148 | uncompressed |
| Modifier icons | `icons/modifiers` | 60×60 | uncompressed |
| **Event scene backgrounds** | `illustrations/event_scenes` | **1592×848** | DXT1 |
| Decision illustrations | `illustrations/decisions` | **1100×440** | DXT1 |
| Loading screens | `illustrations/loading_screens` | 3840×2160 | DXT1 |

Non-power-of-two sizes are fine for interface textures; vanilla is full of them (those 545×285 tradition cards, for instance). Match the vanilla size for the slot and your art drops in without scaling artifacts.

## Coats of arms

CoAs are not textures but script (`common/coat_of_arms/coat_of_arms/`) composing patterns and emblems:

```
chron_coa_example = {
	pattern = "pattern_solid.dds"
	color1 = "red"
	color2 = "yellow"
	colored_emblem = {
		texture = "ce_lion_rampant.dds"
		color1 = "yellow"
		instance = { scale = { 0.8 0.8 } position = { 0.5 0.5 } }
	}
}
```

- Colors come from `common/named_colors/` or inline `rgb {}` / `hsv {}`.
- A coat of arms **named identically to a landed title** applies to that title automatically.
- Emblem textures (`gfx/coat_of_arms/colored_emblems/`, 256×256 DXT5) are **masks**: the game recolors them via the red/green/blue mask convention, so author new emblems by studying a vanilla one, not from scratch.
- The fastest authoring route: use the in-game CoA designer (Royal Court) and its "Copy to clipboard" button, which exports valid script.
- Typos in pattern or emblem names fail silently, as usual.

Dynamic CoAs (trigger-picked variants) live in `common/coat_of_arms/dynamic_definitions/`; refresh in script with `update_dynamic_coa = yes`.

## Event backgrounds and themes

To give your events a custom scene: drop a 1592×848 DXT1 image under `gfx/interface/illustrations/event_scenes/`, register a background in `common/event_backgrounds/`, and reference it from an event with `override_background = { reference = your_background }` (or build a full theme in `common/event_themes/`). Copy a vanilla background definition; they are a few lines each.

## Portraits: a signpost

Character appearance is a gene/DNA system spanning `common/genes`, `common/ethnicities`, `common/dna_data` and `common/portrait_types`, with meshes and textures under the install's `gfx/`. It is deep water: new clothes mean overriding genes, new animations mean touching the idle animation set, and 3D assets go through the Maya exporter in `tools/`. Two useful shallow-end facts: the debug-mode portrait editor exports DNA strings you can paste into character history, and trait-based portrait hooks (`genetic_constraint_all`, aging overrides) let you do a lot without touching a mesh. For serious portrait work, the wiki's Graphical assets and 3D models pages plus a mod that already does it are the way in.

## Try it

1. Draw or generate a 120×120 icon for `chron_famed_chronicler` (a quill, obviously). Export as PNG.
2. Right-click it in the VS Code Explorer, run **Paradox: Convert Image to DDS**, and place the result at `gfx/interface/icons/traits/chron_famed_chronicler.dds` in your mod.
3. Click the `.dds` to check it in the preview, then confirm in-game: the trait now shows your icon in the character window.
4. Stretch goal: compose a coat of arms in the Royal Court designer, copy it to clipboard, and attach it to a custom-named landed title in a sandbox mod.

Next: [Chapter 9: Validation and debugging](09-debugging.md) · [Back to index](index.md)
