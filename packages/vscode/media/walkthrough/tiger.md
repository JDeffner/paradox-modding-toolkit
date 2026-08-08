# ck3-tiger: your mod validator

[ck3-tiger](https://github.com/amtep/tiger) checks your whole mod against the game files — unknown effects, broken scopes, missing localization — and this extension shows its findings as squiggles in the editor.

**Download ck3-tiger** fetches the latest release into the extension's own storage; no manual install, no settings. Re-run the same command after a game patch to update.

- Runs when you ask: **Paradox Tiger: Run Validation** (Ctrl+Alt+V) or the tiger item in the status bar. Set `px.tigerRunOn` to `save` to validate on every save (debounced) — great for small and medium mods
- Already have tiger? Point `px.tigerPath` at your binary; the setting always wins over the downloaded copy
- macOS has no prebuilt binary — build from source and set `px.tigerPath`
