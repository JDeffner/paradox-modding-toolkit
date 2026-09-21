# Refresh reference data for your game patch

You can try the editor with bundled data first. Generate these two separate dump sets when you want names and signatures from your installed patch, and refresh them after game updates.

- **script_docs** lists effects, triggers, event targets and modifiers.
- **Data types** lists functions, arguments and return types for `[ ... ]` expressions in GUI and localization files.

1. Launch the game in debug mode. Use **Paradox: Launch Game (debug mode)**, or add `-debug_mode` to its Steam launch options.
2. Open the game's debug console. Its key depends on your keyboard layout.
3. Run `script_docs`, then the data-type command for your game below. Wait for both to finish.
4. Return to VS Code and select **Reload Game Data**.
5. Hover **PX Toolkit** in the status bar. Both sets should say **your generated dump**. If only one does, generate the other set and reload again.

| Game | Data-type command | script_docs folder | Data-type folder |
|---|---|---|---|
| Crusader Kings III | `DumpDataTypes` | `Crusader Kings III/logs/` | `Crusader Kings III/logs/` |
| Victoria 3 | `dump_data_types` | `Victoria 3/docs/` | `Victoria 3/logs/` |
| Europa Universalis V | `dump_data_types` | `Europa Universalis V/docs/` | `Europa Universalis V/logs/` |

The paths above are under the game's Paradox Interactive user-data directory, normally in Documents on Windows and macOS. Redirected Documents folders are supported. **PX Toolkit > Paths** shows the location in use. On Linux, discovery also checks the game's user-data and default Proton locations; use an explicit path for other layouts.

If discovery fails, set `px.logsPath` to the folder containing `effects.log`, `triggers.log` and the other script_docs files. Data types can be in `data_types.log`, `data_type*.txt` files or a `data_types/` subfolder; the toolkit also checks the sibling `logs/` folder.

Generated definitions take priority; bundled entries and wiki examples can supplement them. The source label confirms what loaded, not when it was generated. This step completes only when both generated sets are loaded.
