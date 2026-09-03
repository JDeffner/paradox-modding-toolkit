# Your mod is the workspace

Open the mod folder — the one containing `common/`, `events/`, `localization/` — as your VS Code workspace root.

The extension then:

- switches its `.txt` and localization `.yml` files to the Paradox language modes (files elsewhere are untouched)
- indexes every scripted effect, trigger, event, on_action, script value and loc key
- re-indexes files as you save them
- lets your definitions **shadow** vanilla ones with the same name, exactly like the game does

If your mod lives somewhere else, set `px.modPath` instead.

Starting fresh? **Paradox: New Mod** creates the mod for you in the game's mod folder, with a `.pxignore` file that keeps git, editor and toolkit files out of Workshop uploads made through the toolkit. It can also create a mod project instead, where the content lives in `<project>/mod` and everything else stays next to it, linked from the game's mod folder.
