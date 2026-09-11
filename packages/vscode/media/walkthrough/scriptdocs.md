# Generate both dumps for your game patch

The toolkit includes reference data so you can start editing immediately. For the best completion and hover information, generate **both** dump sets from your installed game. Refresh them after each game patch.

- `script_docs` lists effects, triggers, event targets and modifiers for script editing.
- The data-type dump lists types, functions, arguments and return values for `[ ... ]` expressions in GUI and localization files. It is a separate dump.

1. Add `-debug_mode` to the game's Steam launch options, or use **Paradox: Launch Game (debug mode)** in VS Code.
2. Start the game and open its debug console. The console key depends on your keyboard layout; on a US keyboard it is usually **`** below Esc.
3. Run `script_docs`, then run the data-type command for your game from the table below. Wait for both dumps to finish.
4. In VS Code, run **Paradox: Reload Game Data**. This loads both sets.
5. Click **PX Toolkit** in the status bar to run **Setup & Health Check**. Each set should say **your generated dump**. If one still says **toolkit-provided set**, check the dump folder and generate that set again.

| Game | Data-type command | `script_docs` folder | Data-type folder |
|---|---|---|---|
| Crusader Kings III | `DumpDataTypes` | `Crusader Kings III/logs/` | `Crusader Kings III/logs/` |
| Victoria 3 | `dump_data_types` | `Victoria 3/docs/` | `Victoria 3/logs/` |
| Europa Universalis V | `dump_data_types` | `Europa Universalis V/docs/` | `Europa Universalis V/logs/` |

These paths are under your **Documents/Paradox Interactive/** folder. Redirected Documents folders are supported. If detection fails, set `px.logsPath` to the folder containing `effects.log`, `triggers.log` and the other `script_docs` files. Data types can be in `data_types.log`, `data_type*.txt` files, or a `data_types/` subfolder; the toolkit also checks the sibling `logs/` folder.

Your generated definitions take priority. Bundled reference entries and wiki usage examples can supplement them. Health reports where the loaded data came from; it does not verify when you generated it.
