# Connect the game to your mod

The toolkit needs two different folders: your **mod**, where you write changes, and the **game installation**, which it reads for definitions and references.

1. Open your mod and check the game name at the top of **PX Toolkit > Project**.
2. Select **Check Setup**. The toolkit looks for the game in your Steam libraries and reports what it found.
3. If the game was not found, select **Choose Game Folder** and browse to its installation or `game` data folder. A custom installation is fine.
4. Wait for indexing to finish. Hover **PX Toolkit** in the status bar to see progress and loaded data sources. Use **Show details** in the setup result for the full report.

If the game name is wrong, set **Paradox: Game Id** in Toolkit Settings before choosing the installation. A newly created mod remembers the game you chose.

You can start with the reference data included in the toolkit. **Toolkit-provided set** means bundled data; **your generated dump** means data loaded from your game. Missing generated dumps do not prevent your first edit. Later steps explain how to refresh them and add a validator.

If no usable reference data is available for your game, generate its dumps before relying on completion. If the toolkit is disabled for this workspace, enable **Paradox: Enable For Workspace** in Settings.

This step completes when the game, mod and script reference data are ready. Installing a validator is a separate optional step. Run Check Setup again whenever paths or game versions change.
