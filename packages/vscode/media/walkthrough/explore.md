# Try the editing tools

Open an event or scripted-effect file in your mod:

- Hover an effect or trigger to read its documentation and supported scopes.
- Press **Ctrl+Alt+I** on an empty line to insert a snippet derived from the game's definitions. Fill the fields with Tab. `px.completion.mode` selects Minimal, Examples or Names.
- Type inside a trigger or effect block to see context-aware suggestions. Scope information ranks and labels suggestions.
- Press **F12** on a referenced definition to open its source.
- Look beside a localization key for its text. Use the lightbulb to edit the value without leaving the script file.
- Hover a DDS texture path to preview it. Open the DDS file and use the background palette to change the shared editor and hover background; checkerboard is the default.

**Paradox: Export Generated Snippets** opens a searchable HTML catalogue with previews, copy controls and printing.

In GUI or localization files, try completion inside `[ ... ]`. The data-type dump supplies function signatures and return types. If expected names are missing, check both dump sources in the **PX Toolkit** tooltip.
