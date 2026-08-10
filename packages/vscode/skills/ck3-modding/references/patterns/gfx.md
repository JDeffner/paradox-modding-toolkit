# Adding Graphical Assets — Practical Recipe

> Imported from a community skill (2026-07); folder paths were re-verified against the local game install, but individual key names were not exhaustively checked. When anything here disagrees with a `_*.info` schema, script_docs, or vanilla files, those win.

## What You Need to Know First
CK3 uses DDS files for most textures and has specific requirements for different asset types. Coat of arms have their own scripting system. Portrait modifications use DNA modifiers.

## Minimal Template — Custom Trait Icon

### gfx/interface/icons/traits/my_trait.dds
- Size: 60x60 pixels
- Format: DDS (BC3/DXT5 with alpha) or PNG
- Save with mipmaps for best quality

## Minimal Template — Custom Coat of Arms

### common/coat_of_arms/coat_of_arms/my_coa.txt
```
my_custom_title_coa = {
	pattern = "pattern_solid"
	color1 = "blue"
	color2 = "white"

	colored_emblem = {
		texture = "ce_lion_passant.dds"
		color1 = "yellow"
		instance = {
			position = { 0.5 0.5 }
			scale = { 0.8 0.8 }
		}
	}
}
```

If the CoA key matches a title, dynasty, or house key (e.g., `d_my_duchy`), it's automatically used.

## Common Variants

### Decision illustration
Place a DDS image at:
```
gfx/interface/illustrations/decisions/my_decision_image.dds
```
Reference in decision:
```
picture = {
	reference = "gfx/interface/illustrations/decisions/my_decision_image.dds"
}
```

### Event background
Standard event backgrounds are defined in `gui/event_windows/`. Custom backgrounds go in `gfx/interface/illustrations/event_scenes/`.

### Portrait DNA modifier
```
# gfx/portraits/portrait_modifiers/my_modifiers.txt
my_custom_look = {
	usage = game
	priority = 50
	my_custom_look = {
		dna_modifiers = {
			accessory = {
				mode = add
				gene = headgear
				template = western_imperial
				value = 1.0
			}
		}
		weight = {
			base = 0
			modifier = {
				add = 100
				has_character_flag = my_custom_look
			}
		}
	}
}
```
Apply with: `add_character_flag = my_custom_look`

### Portrait palettes
Located in `gfx/portraits/`:
- `hair_palette.dds` — 256x256, 8.8.8 BGR 24bpp DDS, no mipmaps
- `skin_palette.dds` — same format
- `eye_palette.dds` — same format

### CoA with multiple emblems
```
my_complex_coa = {
	pattern = "pattern_vertical_split_01"
	color1 = "red"
	color2 = "white"

	textured_emblem = {
		texture = "te_griffin_01.dds"
		mask = { 1 }
		instance = {
			position = { 0.25 0.5 }
			scale = { 0.5 0.5 }
		}
	}

	colored_emblem = {
		texture = "ce_crown.dds"
		color1 = "yellow"
		instance = {
			position = { 0.75 0.25 }
			scale = { 0.3 0.3 }
			depth = 5.0
		}
	}
}
```

## Asset File Format

3D models and entities are defined in `.asset` files. A `pdxmesh` block defines the mesh and its material settings; an `entity` block wraps a mesh for use in game.

```
pdxmesh = {
	name = "my_mesh"
	file = "my_model.mesh"
	meshsettings = {
		name = "submesh_name"
		index = 0
		texture_diffuse = "my_diffuse.dds"
		texture_normal = "my_normal.dds"
		texture_specular = "my_properties.dds"
		shader = "standard"
		shader_file = "gfx/FX/jomini/default.shader"
	}
}

entity = {
	name = "my_entity"
	pdxmesh = "my_mesh"
}
```

- `pdxmesh` — Points to a `.mesh` file (exported from Blender/Maya with the CK3 exporter). Each `meshsettings` block configures one submesh with textures and shader.
- `entity` — A named wrapper around a `pdxmesh`. Entities are what the game references in code, GUI, and map object definitions.
- Asset files can live anywhere under `gfx/models/` and the game loads them all automatically.

## Texture Format Standards

All textures use DDS format. Different texture types require specific compression:

| Suffix | Purpose | Compression | Notes |
|--------|---------|-------------|-------|
| `_diffuse.dds` | Color / albedo | BC1 (DXT1) or BC3 (DXT5) if alpha needed | Base color of the surface |
| `_normal.dds` | Normal map | BC5 (ATI2) | Tangent-space normals |
| `_properties.dds` | Material properties | BC1 (DXT1) | Packed channels: R=roughness, G=metallic, B=AO |

Common texture sizes: 512x512, 1024x1024, 2048x2048 (always power-of-two).

Generate mipmaps for all textures except portrait palettes (which must be exactly 256x256, no mipmaps).

Tools: Intel Texture Works (Photoshop plugin), GIMP DDS plugin, or `texconv` from DirectXTex.

## Portrait Animation System

Portrait animations are defined in `gfx/portraits/portrait_animations/`. Each animation is a named block that controls head and torso animation clips. Selection uses weighted random: the first variant whose weight reaches >= 100 is automatically chosen; otherwise a weighted random pick is made.

### File location
`gfx/portraits/portrait_animations/*.txt`

### Structure
```
my_animation = {
	# Animations are scripted per portrait type; all types must be defined
	male = {
		# Default animation when no variant has weight > 0, or in non-scripted contexts
		default = { head = "idle" torso = "idle" }

		# force = no (default). If yes, portrait_modifier is NOT copied to children
		force = no

		# Triggered portrait modifiers applied when this animation is active.
		# First matching trigger wins.
		portrait_modifier = {
			trigger = { age > 30 }
			custom_beards = awesome_beard
			clothes = basic_clothes
		}

		# Named variant — selected by weighted random
		evil = {
			animation = { head = "evil" torso = "evil" }

			# Optional portrait_modifier override for this variant
			# If omitted, inherits the default animation's portrait_modifier
			portrait_modifier = { ... }

			weight = {
				base = 1
				modifier = {
					add = 10
					has_trait = evil
				}
				modifier = {
					factor = 0
					has_trait = kind
				}
			}
		}
	}

	boy = {
		default = { head = "idle_boy" torso = "idle_boy" }
	}

	female = {
		default = { head = "idle" torso = "idle" }
	}
	girl = female    # Shorthand: reuse the female block
}
```

### Weight calculation
Weight = `base`, then for each modifier: `weight *= factor` or `weight += add`. A final weight >= 100 is selected immediately; otherwise a weighted random is performed across all variants.

### Trait Portrait Modifiers

Trait-based portrait modifiers live in `gfx/portraits/trait_portrait_modifiers/`. These apply DNA changes (clothing, accessories, etc.) when a character has specific traits.

```
group_name = {
	entry_name = {
		traits = { trait_1 trait_2 }    # Character must have one of these
		trigger = { <trigger> }          # Additional condition (root = character)
		base = another_entry             # Inherit dna_modifier from another entry
		dna_modifier = {
			# DNA modifier definition
		}
	}
}
```

The first valid entry in a group is applied (priority order, top to bottom).

## Court Scene Roles

Court scene roles define which characters appear in the royal court 3D scene and what animations they play. Defined in `gfx/court_scene/character_roles/`.

### Structure
```
role_name = {
	# scope:ruler = character who owns the royal court
	# Populate the "characters" list with whoever should fill this role
	effect = {
		scope:ruler = {
			every_knight = {
				add_to_list = characters
			}
		}
	}

	# Animation selection via scripted_animation block
	# scope:ruler = court owner, scope:character = character receiving animation
	scripted_animation = {
		triggered_animation = {
			trigger = {
				scope:ruler = { is_female = no }
			}
			# Single animation or random pick from list
			animation = { one_handed_1_aggressive one_handed_2_aggressive }
			animation = one_handed_1_aggressive
			# Or reference a reusable scripted_animation key
			scripted_animation = key_of_scripted_animation
			# Optional camera override
			camera = camera_name
		}

		triggered_animation = {
			trigger = {
				scope:character = { is_female = yes }
			}
			animation = throne_room_conversation_1
			camera = camera_name
		}

		# Fallback if no triggers match
		animation = throne_room_conversation_3
		camera = camera_name
	}
}
```

Court events can override both role assignment and animation for specific event scenarios.

## Event Backgrounds

Event backgrounds are defined in `common/event_backgrounds/`. Each background key can contain multiple `background` blocks; the first one whose trigger is satisfied is selected. If a block has no trigger, it always matches (use as fallback).

### File location
`common/event_backgrounds/*.txt`

### Structure
```
my_background = {
	background = {
		trigger = { has_trait = brave }
		reference = "gfx/interface/illustrations/event_scenes/my_scene.dds"
		environment = "environment_event_standard"
		ambience = "event:/SFX/Events/Ambience/my_ambience"
	}
	background = {
		# No trigger — fallback
		reference = "gfx/interface/illustrations/event_scenes/my_default.dds"
	}
}
```

### Fields
| Field | Type | Description |
|-------|------|-------------|
| `trigger` | Jomini trigger | Receives the event scope. Optional — omit for a fallback. |
| `reference` | string path | Path to the illustration DDS (or video file). |
| `video` | bool | Set `yes` if `reference` points to a `.bk2` video instead of an image. |
| `environment` | database key | Portrait environment defined in `gfx/portraits/environments/`. Controls lighting. |
| `ambience` | string | Sound event reference from `game/sound/GUIDs.txt`. |
| `video_mask` | string path | Alpha mask for fade effects on video backgrounds. |

### Usage in events
Reference a background key in an event with:
```
background = { reference = my_background }
```

## Scripted Animations

Scripted animations are reusable animation definitions that can be referenced by events, court scene roles, and other scripted contexts. Defined in `common/scripted_animations/`.

### File location
`common/scripted_animations/*.txt`

### Structure
```
my_scripted_animation = {
	# Triggered animations evaluated in order; first matching trigger wins
	triggered_animation = {
		trigger = { portrait_should_wield_axe_trigger = yes }
		# Single animation or random-from-list
		animation = schadenfreude
		animation = { schadenfreude sadness rage }
		# Or chain to another scripted_animation
		scripted_animation = other_scripted_animation
		# Optional camera override
		camera = camera_name
	}

	triggered_animation = { ... }

	# Default fallback animation
	animation = anger
	# Or fallback to another scripted_animation
	scripted_animation = fallback_animation

	# Default camera when no triggered_animation matches
	camera = camera_name
}
```

Scripted animations are referenced by key from court roles, events, and other animation contexts using `scripted_animation = my_scripted_animation`.

## Map-Related GFX

3D objects placed on the map (buildings, holdings, special landmarks) use the entity/asset system described above but are positioned through map object data files. For full details see:
- `references/patterns/map-modding.md` — terrain, provinces, map painting
- `references/patterns/map-objects.md` — 3D map objects, building models, placement

Map object data files live in `gfx/map/map_object_data/` and reference entities defined in `.asset` files.

## Checklist
- [ ] DDS files saved in correct format (BC3/DXT5 for icons with alpha, BC1/DXT1 for opaque)
- [ ] Correct dimensions for the asset type (60x60 for trait icons, 256x256 for palettes)
- [ ] CoA definitions in `common/coat_of_arms/coat_of_arms/`
- [ ] CoA key matches title/dynasty/house key for auto-assignment
- [ ] Test CoA in the in-game CoA designer (`coat_of_arms_designer` console command)
- [ ] Asset files define both `pdxmesh` and `entity` blocks
- [ ] Textures use correct compression per type (diffuse=BC1/BC3, normal=BC5, properties=BC1)
- [ ] Portrait animations define all required portrait types (male, female, boy, girl)
- [ ] Event backgrounds have a fallback `background` block with no trigger
- [ ] Scripted animations referenced by correct key in events and court roles

## Common Pitfalls
- **DDS format**: Use Intel Texture Works (Photoshop) or GIMP DDS plugin. Wrong compression format causes visual glitches
- **Palette dimensions**: Portrait palettes must be exactly 256x256
- **CoA patterns**: Always include a `pattern` to avoid masking issues with textured emblems
- **PNG fallback**: The game accepts PNG in many places, which is easier to work with during development. Convert to DDS for release
- **CoA designer**: Use the in-game designer to prototype, then export the script. The designer has some limitations vs manual scripting
- **Animation weight >= 100**: If any variant hits weight >= 100, it is selected immediately (no random). Use this for forced overrides but be careful with unintended priority
- **Missing portrait types**: All portrait types (male, female, boy, girl) must be defined in animation blocks or the game may error. Use `girl = female` shorthand to share definitions
- **Event background order**: Backgrounds are evaluated top-to-bottom. Place more specific triggers first, fallback last
- **Scripted animation chaining**: A `scripted_animation` reference inside a `triggered_animation` replaces the `animation` field — do not use both simultaneously
