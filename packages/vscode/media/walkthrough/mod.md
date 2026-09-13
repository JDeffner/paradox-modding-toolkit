# Open your mod workspace

Open the mod folder containing its game content, such as `common/`, `events/` and `localization/`. You can also open a project whose content is in a `mod/` subfolder, add several mod folders to one workspace, or open a folder that contains your mod projects.

The toolkit detects the mods, sets the Paradox language modes and indexes definitions and localization. **Project > Workspace Mods** shows what is included. Select a mod to focus the views and use the include switch to control indexing.

Starting fresh? **Paradox: New Mod** can create a project with content in `<project>/mod`, separate Git and Workshop listing files, and a launcher link to the game. Set `px.modProjectsDir` to keep new projects together.

If detection selects the wrong folder or game, set `px.modPath` or `px.gameId`, then run **Setup & Health Check**. The game installation and dependency mods are indexed separately from your editable content.
