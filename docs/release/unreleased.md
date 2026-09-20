# Paradox Modding Toolkit: editor improvements (unreleased)

A guided start for new modders, better suggestions and navigation, and batch image conversion.

- Start without knowing your mod folder: create a mod or find an existing one from the welcome panel, then add it to this workspace or open a new window. The rewritten tutorial covers your first edit and advanced workflows. First-time modders get scope hints. Extra validation is optional.
- Keep the creation wizard open when focus changes. If you cancel the final opening step, a notification shows where the mod was saved and offers both opening actions. Adding the new mod opens Explorer with its files visible.
- Suggestions appear while you type unfinished script. Traits no longer disappear when a localization key shares their name, and navigation keeps different definition types separate.
- CK3 and Victoria 3 events suggest title, description and option localization keys before you write the translations.
- Navigation follows unsaved edits. Rename checks the current text and symbol type before changing files.
- Problems in open scripts update when a referenced event or required localization changes in another file, including unsaved edits and discarded changes.
- Find mod views in Explorer. Project has clearer focus controls, compact mod buttons and Settings controls for suggestions and hovers. Add mods from Documents, projects or Steam Workshop to your current workspace. Your custom view placements are preserved.
- Right-click files or definitions for direct PX: actions. Event Graph, GUI Editor and Coat of Arms Designer also gain source menus and keyboard improvements.
- Convert files or whole folders between DDS, PNG, JPEG and WebP. Choose multiple images directly; an overwrite-or-skip toast appears only for existing outputs. Sources are preserved and failed files are reported.
- Open BBCode Preview from the editor selector, including unsaved text. Fix missing UTF-8 BOMs through the native encoding picker.
- Localization coverage and game-log bursts do less repeated work. Localization actions use the selected mod and language, and Add Language can create a mod's first translation file.

### Full changelog

[Extension details](../../packages/vscode/CHANGELOG.md#unreleased) · [Language server](../../packages/server/CHANGELOG.md#unreleased) · [Protocol](../../packages/protocol/CHANGELOG.md#unreleased)
