# Check your setup and data sources

Open your mod workspace, then run **Paradox: Run Setup & Health Check**. It finds the game through Steam, checks the mod folders, loads the available game data and offers to download the game's tiger validator where supported.

The report shows two separate sources:

- **script_docs** for effects, triggers, event targets and modifiers.
- **Data types / datafunctions** for `[ ... ]` expressions in GUI and localization files.

**Toolkit-provided set** means the extension is using bundled reference data. **Your generated dump** means it loaded usable definitions from your dump folder. One set can be generated while the other still uses bundled data.

Generate both sets for your installed patch: `script_docs` plus `DumpDataTypes` in CK3, or `dump_data_types` in Victoria 3 and EU5. Then run **Paradox: Reload Game Data**. The next walkthrough step gives the commands and output folders.

Click **PX Toolkit** in the status bar to run this check again. Its tooltip also shows both sources. Open **Output > Paradox Modding Toolkit** for the full report and the dump folder in use.
