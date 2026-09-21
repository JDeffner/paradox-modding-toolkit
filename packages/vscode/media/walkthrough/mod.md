# Your first mod starts here

A mod is a folder of your changes. The game installation supplies the original files, often called **vanilla**. Keep your changes in the mod so a game update does not replace them.

## I want to make my first mod

1. Select **I've never created a mod**, choose your game and give the mod a name. This turns on scope inlay hints so you can see which target a script block acts on. You can turn them off in **Project > Settings**. Use **Create a Mod** to keep your current hint preference.
2. Keep **Game mod folder (recommended)**. The toolkit finds the location, creates the mod and registers it with the launcher. You do not need to find Documents or a Steam folder yourself.
3. Choose **Add to Current Workspace** to edit the mod in this window, or **Open in New Window** to give it a separate window. Explorer shows the files, and the PX icon opens your tools.
4. Return to this tutorial with **Paradox: Get Started with the Toolkit** from the Command Palette (F1).

The new mod starts with a descriptor, which tells the launcher its name and game version. The next steps connect the game and help you create content. Creating a mod does not publish it or enable it in a playset.

For **Victoria 3**, select Victoria 3 in the game picker. Its descriptor is `.metadata/metadata.json`, not CK3's `descriptor.mod`. A separate project uses a folder link in the game's mod folder. The new project remembers Victoria 3, so its setup, templates and validator use that game.

## I already have a mod

Select **Find Existing Mod**. The list shows local mods from the games' user folders and your configured mod projects folder. It also follows launcher links to projects stored elsewhere. Search by name or path, or choose **Browse for a mod or project folder**.

Open the individual mod, such as a folder with `descriptor.mod` or `.metadata/metadata.json`. Projects with a `mod/` subfolder work too. A Steam-managed Workshop subscription is not an editable local project; use your own source copy.

If nothing is found, browse to a custom location or create a mod. You can also use VS Code's **File > Open Folder** or **Open Workspace from File**. After selecting a mod, choose **Add to Current Workspace** or **Open in New Window**. Cancelling this choice keeps your windows unchanged.

To add another mod to the window you already use, select the folder button beside **Project > Workspace Mods**, or run **Paradox: Add Mod or Base Game to Workspace**. Choose Documents, your configured mod projects folder, Steam Workshop or the base game. The mod list is for the active game. Steam manages subscribed files and can replace edits during an update; use your own copy for changes you want to keep.

This step completes after a mod is detected and indexing finishes, not when you dismiss a picker.
