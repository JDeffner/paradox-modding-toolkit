# Your mod is the workspace

Open the mod folder — the one containing `common/`, `events/`, `localization/` — as your VS Code workspace root.

The extension then:

- switches its `.txt` and localization `.yml` files to the Paradox language modes (files elsewhere are untouched)
- indexes every scripted effect, trigger, event, on_action, script value and loc key
- re-indexes files as you save them
- lets your definitions **shadow** vanilla ones with the same name, exactly like the game does

If your mod lives somewhere else, set `px.modPath` instead.

Starting fresh? **Paradox: New Mod** creates the mod for you — recommended into a mod projects folder, where the mod's content lives in `<project>/mod` and git or Steam Workshop files stay next to it, outside the upload. The game finds the mod through a link in its own mod folder. **Paradox: Move Mod** moves an existing mod into (or out of) that layout.
