/**
 * One-line advice for the Steam error phrases the native layer produces
 * (steamworks-rs maps EResult codes to short strings like "limit exceeded" -
 * accurate, but bare). The hint says what the phrase usually means for a
 * Workshop upload, so a failure is actionable without a Steamworks manual.
 *
 * No vscode imports: unit-tested in plain Node.
 */

const HINTS: { match: RegExp; hint: string }[] = [
  {
    match: /limit exceeded/i,
    hint: "usually the description: Steam caps it at 8000 characters (and titles at 128)",
  },
  {
    match: /file was not found/i,
    hint: "a path Steam was given does not exist - re-check the preview image and the mod's content",
  },
  {
    match: /access denied|insufficient privilege/i,
    hint:
      "the logged-in Steam account cannot edit this item - a linked remote_file_id must belong " +
      "to the account Steam is logged in as",
  },
  {
    match: /user not logged on/i,
    hint: "log into Steam first",
  },
  {
    match: /isn't a network connection|connect failed|no connection/i,
    hint: "Steam appears to be offline - check the client's connection and retry",
  },
  {
    match: /operation timed out/i,
    hint: "Steam did not answer in time - usually transient, retry the upload",
  },
  {
    match: /parameter is invalid/i,
    hint: "often a malformed tag or visibility value - check the descriptor's tags block",
  },
  {
    match: /request is a duplicate/i,
    hint: "Steam already processed an identical update - refresh the panel before retrying",
  },
  {
    match: /banned|account disabled|access revoked/i,
    hint: "Steam has restricted the item or the account - check the item's Workshop page",
  },
  {
    match: /service is read only|requested service is unavailable/i,
    hint: "a Steam-side outage - wait and retry",
  },
  {
    match: /disk being full/i,
    hint: "Steam ran out of disk space while preparing the upload",
  },
  {
    match: /generic failure/i,
    hint:
      "Steam's catch-all - often transient, sometimes a tag or image it refuses. Retry once, " +
      "then check the item on its Workshop page",
  },
];

/** Advice for a Steam error message, or null when no phrase is recognized. */
export function explainSteamError(message: string): string | null {
  for (const { match, hint } of HINTS) {
    if (match.test(message)) return hint;
  }
  return null;
}
