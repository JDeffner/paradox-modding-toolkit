/**
 * The script language ids, in one place.
 *
 * A VS Code language id carries exactly one static icon and one static alias,
 * so per-game icons and per-game display names need one script id per game.
 * All four ids are the SAME language: same grammar, same language
 * configuration, same server handlers. Only the Explorer icon and the label in
 * the status bar differ.
 *
 * Every client-side selector and languageId check must go through
 * `PARADOX_SCRIPT_LANGS` / `isScriptLang`. A comparison that hardcodes
 * `"paradox"` still compiles and still runs, it just silently stops matching
 * the per-game ids, so the feature disappears without an error anywhere.
 *
 * Pure: no vscode import, so the manifest guard and the migration tests can
 * import it directly.
 */

/** Generic id plus one per game. The manifest guard test keeps this in sync. */
export const PARADOX_SCRIPT_LANGS = ["paradox", "paradox-ck3", "paradox-vic3", "paradox-eu5"];

/** Whether `id` is one of our script languages (not loc / gui / mod / info). */
export function isScriptLang(id: string): boolean {
  return PARADOX_SCRIPT_LANGS.includes(id);
}

/**
 * The script language id a workspace of `gameId` uses. Unknown ids fall back
 * to the generic `paradox`, which is also what the language picker offers on a
 * file outside every detected mod root.
 */
export function scriptLangFor(gameId: string): string {
  const perGame = `paradox-${gameId}`;
  return isScriptLang(perGame) ? perGame : "paradox";
}

/**
 * Whether the persisted workspace association for `*.txt` must be rewritten to
 * `wanted`.
 *
 * 0.1.x and 0.3.0 both wrote `*.txt: "paradox"` for every game, so existing
 * workspaces carry a value that is now the wrong id (a CK3 workspace shows the
 * PX box instead of the crown). Rewriting is limited to values we ourselves
 * could have written: anything else is the user's own mapping and wins.
 */
export function shouldRewriteAssociation(current: string | undefined, wanted: string): boolean {
  return current !== undefined && current !== wanted && isScriptLang(current);
}
