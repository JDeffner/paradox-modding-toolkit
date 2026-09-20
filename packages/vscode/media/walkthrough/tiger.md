# Check more than syntax

The toolkit catches structural problems while you edit. The optional **tiger validator** checks game rules across your mod, such as unknown effects, broken scopes and missing localization.

1. Select **Download Validator**. The toolkit downloads the binary for your active game into its own storage.
2. Select **Validate Mod**, or use the validator in the status bar.
3. Open **View > Problems** and select a finding to reach its source. Fix it, save and validate again.

CK3 uses ck3-tiger; Victoria 3 uses vic3-tiger. A game whose profile has no validator does not show this step. Validation needs the game installation as well as your mod. It does not replace testing in game.

Already installed tiger? Set `px.tigerPath` to your binary; that takes priority. For a large mod, set `px.tigerRunOn` to `manual`. Choose `save` if you want validation after edits. Re-run Download or Update Binary when you need a newer validator.

macOS has no prebuilt binary in the toolkit's download flow. Build tiger from its source and configure the path, or continue with structural checks.

A failed or cancelled download leaves this step incomplete. You can keep editing and return later.
