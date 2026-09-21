# Bring your existing workflow

You can skip the tutorial. Open a mod or saved `.code-workspace`, run **Paradox: Run Setup & Health Check**, and keep editing. Existing configuration and generated dumps remain in use.

## Keep your project layout

**Find Existing Mod** supports custom folders and projects with content in `mod/`. **Paradox: Add Mod or Base Game to Workspace**, also available from the folder button beside **Workspace Mods**, adds content from Documents, your configured projects folder, Steam Workshop or the base game to your current window. Use one game per workspace. Save a multi-folder workspace through **File > Save Workspace As**.

To keep future projects together, set **Paradox: Mod Projects Dir**. New Mod can then use a separate project folder with the game content in `<project>/mod` and a launcher link back to it. You choose this layout; existing mods are not moved.

Use **Project > Workspace Mods** to select a focus or exclude a mod from indexing. Configure parent mods when you need reference content without treating it as editable work.

## Use your own tools and data

Set `px.gamePath`, `px.logsPath` or `px.tigerPath` when automatic discovery is not right for your installation. Workspace settings can override user settings. Paths shows the effective locations.

Refresh `script_docs` and data types after game patches, then run **Paradox: Reload Game Data**. For large mods, set `px.tigerRunOn` to `manual` and run validation when needed.

Tune **Project > Settings** for names-only suggestions, full examples, compact hovers or optional scope hints. **All Tools** remains available even for tools you hide with Customize.
