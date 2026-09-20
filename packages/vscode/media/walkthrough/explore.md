# Make a small change, then inspect it

## Start with a template

In your mod window, select **New Content**, then choose one of the templates offered for your game. Give it a unique prefix when asked. The prefix keeps your file names and identifiers separate from other mods. The toolkit creates the file in the correct folder and opens it.

For an existing mod, open one of your script files instead. You do not need a tutorial project.

## Try the editing loop

1. Put the cursor on a script keyword and hover it. Read what it does and which values or scopes it accepts.
2. Type part of a keyword inside a block. Choose a suggestion with Enter or Tab; use Tab to move through any fields it inserts. Press Ctrl+Space to ask for suggestions manually.
3. Put the cursor on a referenced definition and press F12 to inspect its source. A source in the game folder is a reference, not the place to make your mod's changes.
4. For CK3 or Victoria 3 events, type in a title, description or option-name value to see localization-key suggestions. A new key is only a reference until you add its displayed text.
5. Save the file. Open **View > Problems** to check structural errors. Use the lightbulb for available fixes, including saving a script or localization file as UTF-8 with BOM.

Right-click a definition or localization key for actions labelled **PX:**. Shift+F10 opens the same menu from the keyboard. **Project > Settings > Suggestion verbosity** lets you choose names, minimal fields or full examples.

## Test what the player sees

Enable the mod in a playset in the game's launcher before testing. A saved file or an empty Problems list does not prove that the game loads or runs it correctly. Check the feature in game; the validator step adds another useful check.

For more examples, open **Paradox: Export Generated Snippets**. It creates a searchable catalogue from the available game definitions.
