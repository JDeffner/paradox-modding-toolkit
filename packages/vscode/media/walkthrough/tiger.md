# tiger: your mod validator

[tiger](https://github.com/amtep/tiger) checks your whole mod against the game files (unknown effects, broken scopes, missing localization) and this extension shows its findings as squiggles in the editor.

Each game has its own binary: `ck3-tiger` for Crusader Kings III, `vic3-tiger` for Victoria 3. EU5 has no tiger build yet, so on an EU5 workspace the tiger commands stay hidden.

**Download or Update Binary** fetches the latest release for the active game into the extension's own storage; no manual install, no settings. Re-run the same command after a game patch to update.

- Runs when you ask: **Paradox Tiger: Run Validation** (Ctrl+Alt+V) or the tiger item in the status bar. Set `px.tigerRunOn` to `save` to validate on every save (debounced), which is good for small and medium mods
- Already have tiger? Point `px.tigerPath` at your binary; the setting always wins over the downloaded copy
- macOS has no prebuilt binary. Build from source and set `px.tigerPath`
