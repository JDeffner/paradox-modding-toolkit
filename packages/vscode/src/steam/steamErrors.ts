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
    "Steam rejected one of the values. Check the tags, the visibility and the title in the descriptor",
  FileNotFound: "a path Steam was given does not exist. Check the preview image and the mod's content folder",
  AccessDenied:
    "the Steam account you are logged in as may not edit this item. The Workshop ID in the " +
    "descriptor must belong to that account",
  InsufficientPrivilege:
    "the Steam account may not publish right now. A community ban or another restriction on the " +
    "account blocks Workshop uploads",
  NotLoggedOn: "Steam is not logged in. Log in and retry",
  LimitExceeded:
    "a field is over Steam's limit. The description caps at 8000 characters and the title at 128",
  RateLimitExceeded: "too many Workshop updates in a short time. Wait a few minutes and retry",
  DuplicateRequest: "Steam already has an identical update in flight. Refresh the panel before retrying",
  Banned: "Steam has banned this item or this account. Check the item's Workshop page",
  Revoked: "Steam has withdrawn access to this item. Check the item's Workshop page",
  Blocked: "Steam blocked the request for this account. Check the account's status on Steam",
  AccountDisabled: "the Steam account is disabled, so it cannot publish",
  Suspended: "the Steam account is suspended, so it cannot publish",
  ServiceUnavailable: "Steam's Workshop service is down. Wait and retry",
  ServiceReadOnly: "Steam is in read-only mode, so it accepts no updates right now. Wait and retry",
  DiskFull: "the disk ran out of space while Steam prepared the upload",
  ItemDeleted: "this Workshop item no longer exists. It was deleted on Steam, so link or create another item",
  InvalidItemType: "Steam refuses this item type here. Check the item was created for this game",
  MustAgreeToSSA: "the account has not accepted the Steam Subscriber Agreement. Accept it on Steam and retry",
  Cancelled: "the upload was cancelled",
  NotModified: "nothing in this update differs from what Steam already has",
  LockingFailed: "Steam could not save the change on its side. Retry the upload",
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
