# missing-bom

**Severity:** Warning for mod script `.txt` files; Error for localization files. **Source:** the active game's script diagnostics.

The file on disk does not start with a UTF-8 byte order mark (BOM). Mod script `.txt` files should use UTF-8 with BOM. CK3 localization requires it to load the file's keys.

The script warning applies to files inside an editable workspace mod. It does not apply to vanilla, dependency mods, `.gui`, `.asset` or `descriptor.mod` files. Unsaved files with no readable disk copy are not checked. The BOM is read when a file opens or saves, not on each keystroke.

## How to fix

Use the **Save as UTF-8 with BOM...** Quick Fix on the warning, or run **Paradox: Save as UTF-8 with BOM...** from the Command Palette. The fix opens the affected file's native encoding picker. Choose **Save with Encoding**, then **UTF-8 with BOM**. VS Code saves the current text, including unsaved edits, and handles the encoding and Undo history together. The same fix also handles the existing localization error.

If the displayed text is already garbled, first use **Reopen with Encoding** to select the file's original encoding. Keep any unsaved edits before reopening.

Other LSP clients receive the diagnostic and can use their own encoding controls. Files created by the extension's scaffolds already include the BOM.
