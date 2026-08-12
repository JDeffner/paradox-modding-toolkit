# script_docs: exact data for your game version

Out of the box, completion and hover use reference data bundled from the CK3 wiki (about 2,300 tokens with usage examples). It's good, but it can lag behind game patches and has no modifiers. Victoria 3 ships with a bundled script_docs snapshot instead of wiki data, so this step refreshes it for your patch. On EU5 nothing is bundled, so there this step is what fills in effects, triggers and event targets in the first place.

The game itself can produce the authoritative list:

1. Add `-debug_mode` to the game's Steam launch options (right-click the game, Properties, Launch Options)
2. Start the game, open the console with the **`** key (below Esc)
3. Type `script_docs` and press Enter
4. Back in VS Code, run **Paradox: Reload Game Data (script_docs)**

This writes `triggers.log`, `effects.log`, `event_targets.log` and `modifiers.log` into `Documents/Paradox Interactive/Crusader Kings III/logs/` (Victoria 3 and EU5 dump to `docs/` instead) — the extension picks them up and merges them **over** the wiki data (wiki usage examples are kept).

Repeat after each game patch.
