/**
 * Turns the Steam bridge's raw failures into a sentence a modder can act on.
 *
 * steamwand throws two message shapes. Both are exact, and both are
 * Steamworks jargon:
 *   "SubmitItemUpdate failed: k_EResultAccessDenied"   (a non-OK EResult)
 *   "steamwand: SetItemTags returned false (invalid handle or argument?)"
 * We put the plain-language cause in front and keep the operation and the
 * code in parentheses, because a support thread needs the exact code.
 *
 * The table is keyed on the EResult NAME on purpose. It used to be keyed on
 * prose ("access denied", "limit exceeded"), which is what steamworks-rs
 * emitted; moving the bridge to steamwand changed every message to an enum
 * name, no key matched any more, and all advice went silently missing.
 *
 * No vscode imports: unit-tested in plain Node.
 */

/**
 * EResult name without its `k_EResult` prefix -> what the code means for a
 * Workshop upload. Only the codes an upload can realistically hit; the full
 * enum is 131 entries, and listing one we have nothing to say about is worse
 * than the fallback sentence.
 *
 * Exported so the test can check every key against the enum steamwand ships:
 * a typo here fires no hint and nothing else would notice.
 *
 * Meanings come from the per-call result lists Valve documents on ISteamUGC
 * (CreateItem, SubmitItemUpdate), not from the generic one-line enum text.
 * The two disagree often, and the per-call one is what a Workshop upload
 * gets: LimitExceeded is the preview image or the Cloud quota, not a text
 * field; ServiceReadOnly is the account's post-password-change hold, not a
 * Steam outage. Codes Valve documents nowhere for uploads say so.
 */
export const RESULT_HINTS: Record<string, string> = {
  Fail: "Steam's catch-all failure, often transient. Retry once, then check the item on its Workshop page",
  NoConnection: "Steam has no connection. Check the Steam client and retry",
  ConnectFailed: "Steam could not reach its servers. Check the Steam client and retry",
  RemoteDisconnect: "Steam dropped the connection during the call. Retry the upload",
  IOFailure: "Steam could not read or write the files for this upload. Retry, and check the disk",
  Busy: "Steam is busy with another task. Wait a moment and retry",
  Timeout: "Steam did not answer in time. This is usually transient, so retry the upload",
  InvalidParam:
    "Steam rejected the item ID or one of the fields. The Workshop ID in the descriptor must " +
    "belong to this game",
  FileNotFound:
    "Steam could not read the preview image, or the item's Workshop entry is gone. Check the " +
    "preview image path, then the item's Workshop page",
  AccessDenied:
    "the Steam account you are logged in as does not own the game, or does not own this item. " +
    "Log in as the account that created the Workshop item",
  InsufficientPrivilege:
    "the Steam account is banned from this game's community, so it cannot publish. Check the " +
    "account's status on the game's Steam hub",
  NotLoggedOn: "Steam is not logged in. Log in and retry",
  LimitExceeded:
    "the preview image is over 1 MB, or this account's Steam Cloud is full. Use a smaller preview " +
    "image, then free up Steam Cloud space",
  RateLimitExceeded: "too many Workshop updates in a short time. Wait a few minutes and retry",
  DuplicateRequest: "Steam already has this upload. Refresh the panel before uploading again",
  DuplicateName: "this account already has a Workshop item with that name. Rename the mod and retry",
  Banned:
    "the Steam account has a VAC or game ban, so it cannot upload for this game. Check the " +
    "account's bans on its Steam profile",
  Revoked:
    "Steam gives no Workshop detail for this code. Check the account still owns the game, then " +
    "check the item's Workshop page",
  Blocked: "Steam gives no Workshop detail for this code. Retry, then check the account's status on Steam",
  AccountDisabled: "the Steam account is disabled, so it cannot publish",
  Suspended: "the Steam account is suspended, so it cannot publish",
  ServiceUnavailable: "Steam's Workshop servers are having trouble. Wait a few minutes and retry",
  ServiceReadOnly:
    "a recent password or email change blocks new uploads from this account. The block usually " +
    "clears after 5 days, and can last 30",
  DiskFull: "the disk ran out of space while Steam prepared the upload",
  ItemDeleted: "this Workshop item no longer exists. It was deleted on Steam, so link or create another item",
  InvalidItemType: "Steam refuses this item type here. Check the item was created for this game",
  MustAgreeToSSA: "the account has not accepted the Steam Subscriber Agreement. Accept it on Steam and retry",
  Cancelled: "the upload was cancelled",
  NotModified: "nothing in this update differs from what Steam already has",
  LockingFailed: "another update to this item is still running on Steam. Wait a moment and retry",
  PersistFailed: "Steam could not save the change on its side. Retry the upload",
  ValueOutOfRange: "one value is outside the range Steam accepts. Check the visibility and the tags",
};

/** Flat setter -> the value Steam refused, for the "returned false" shape. */
const REJECTED_VALUE: Record<string, string> = {
  StartItemUpdate: "the item handle",
  SetItemTitle: "the title",
  SetItemDescription: "the description",
  SetItemTags: "the tags",
  SetItemVisibility: "the visibility",
  SetItemContent: "the content folder",
  SetItemPreview: "the preview image",
  SetItemUpdateLanguage: "the language code",
};

/** `<Op> failed: k_EResultAccessDenied`, or the `EResult(<n>)` fallback name. */
const RESULT_FAILURE = /(\w+) failed: (k_EResult(\w+)|EResult\(\d+\))/i;
/** `steamwand: <Op> returned false (invalid handle or argument?)`. */
const SETTER_FAILURE = /steamwand: (\w+) returned false(?: \([^)]*\))?/i;

/**
 * The message with its Steam failure rewritten in plain language, or null
 * when it carries no Steam failure (a bridge or staging error passes through
 * unchanged). Surrounding text is kept, so the step that failed still reads
 * first.
 */
export function explainSteamError(message: string): string | null {
  const result = RESULT_FAILURE.exec(message);
  if (result) {
    const [segment, operation, code, name] = result;
    const hint = (name && RESULT_HINTS[name]) || "Steam refused the request";
    return message.replace(segment, () => `${hint} (${operation}: ${code})`);
  }
  const setter = SETTER_FAILURE.exec(message);
  if (setter) {
    const [segment, operation] = setter;
    const value = REJECTED_VALUE[operation] ?? "one of the values it was given";
    return message.replace(segment, () => `Steam rejected ${value} (${operation})`);
  }
  return null;
}
