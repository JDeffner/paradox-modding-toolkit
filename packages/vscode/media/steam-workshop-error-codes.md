# Steam Workshop error codes

When a Workshop upload fails, the reason is a number. Steam's API answers every call with an `EResult`, one of 131 values shared by the whole Steamworks API, and a refused upload is a non-zero one coming back from `SubmitItemUpdate`. The toolkit turns the 32 you are most likely to meet into a sentence. This page is the full table behind that, with the numbers, because tools other than the toolkit often show you the number alone.

Nothing here is specific to the toolkit. The Paradox launcher, SteamCMD's `workshop_build_item`, and anything else built on the Steamworks UGC API all hand the same codes back. Only the wording around them differs.

One warning about the numbers, because it costs people hours. `EResult` carries a one-line general description in `steam_api.h`, and Valve documents a **second, different** meaning for the same code on each UGC call. `k_EResultLimitExceeded` reads "Too much of a good thing" in the enum, but on `SubmitItemUpdate` it means your preview image is over 1 MB or your Steam Cloud is full. The per-call meaning is the one you want, and it is what the table below uses.

## How the toolkit shows a code

An upload failure arrives as a VS Code notification:

> Paradox Modding Toolkit: Workshop upload failed - the Steam account you are logged in as does not own the game, or does not own this item. Log in as the account that created the Workshop item (SubmitItemUpdate: k_EResultAccessDenied)

The sentence comes from the table below. The parentheses hold the Steamworks call that failed and the raw code, so a bug report or a forum thread still carries the exact failure. The **Paradox Modding Toolkit** output channel keeps the raw message next to the readable one.

## The codes the toolkit explains

| Code | # | What it means, and what to do |
|---|---|---|
| `k_EResultFail` | 2 | Steam's catch-all failure, often transient. Retry once, then check the item on its Workshop page. |
| `k_EResultNoConnection` | 3 | Steam has no connection. Check the Steam client and retry. |
| `k_EResultInvalidParam` | 8 | Steam rejected the item ID or one of the fields. The Workshop ID in the descriptor must belong to this game. |
| `k_EResultFileNotFound` | 9 | Steam could not read the preview image, or the item's Workshop entry is gone. Check the preview image path, then the item's Workshop page. |
| `k_EResultBusy` | 10 | Steam is busy with another task. Wait a moment and retry. |
| `k_EResultDuplicateName` | 14 | This account already has a Workshop item with that name. Rename the mod and retry. |
| `k_EResultAccessDenied` | 15 | The Steam account you are logged in as does not own the game, or does not own this item. Log in as the account that created the Workshop item. |
| `k_EResultTimeout` | 16 | Steam did not answer in time. This is usually transient, so retry the upload. |
| `k_EResultBanned` | 17 | The Steam account has a VAC or game ban, so it cannot upload for this game. Check the account's bans on its Steam profile. |
| `k_EResultServiceUnavailable` | 20 | Steam's Workshop servers are having trouble. Wait a few minutes and retry. |
| `k_EResultNotLoggedOn` | 21 | Steam is not logged in. Log in and retry. |
| `k_EResultInsufficientPrivilege` | 24 | The Steam account is banned from this game's community, so it cannot publish. Check the account's status on the game's Steam hub. |
| `k_EResultLimitExceeded` | 25 | The preview image is over 1 MB, or this account's Steam Cloud is full. Use a smaller preview image, then free up Steam Cloud space. |
| `k_EResultRevoked` | 26 | Steam gives no Workshop detail for this code. Check the account still owns the game, then check the item's Workshop page. |
| `k_EResultDuplicateRequest` | 29 | Steam already has this upload. Refresh the panel before uploading again. |
| `k_EResultPersistFailed` | 32 | Steam could not save the change on its side. Retry the upload. |
| `k_EResultLockingFailed` | 33 | Another update to this item is still running on Steam. Wait a moment and retry. |
| `k_EResultConnectFailed` | 35 | Steam could not reach its servers. Check the Steam client and retry. |
| `k_EResultIOFailure` | 37 | Steam could not read or write the files for this upload. Retry, and check the disk. |
| `k_EResultRemoteDisconnect` | 38 | Steam dropped the connection during the call. Retry the upload. |
| `k_EResultBlocked` | 40 | Steam gives no Workshop detail for this code. Retry, then check the account's status on Steam. |
| `k_EResultAccountDisabled` | 43 | The Steam account is disabled, so it cannot publish. |
| `k_EResultServiceReadOnly` | 44 | A recent password or email change blocks new uploads from this account. The block usually clears after 5 days, and can last 30. |
| `k_EResultSuspended` | 51 | The Steam account is suspended, so it cannot publish. |
| `k_EResultCancelled` | 52 | The upload was cancelled. |
| `k_EResultDiskFull` | 54 | The disk ran out of space while Steam prepared the upload. |
| `k_EResultValueOutOfRange` | 78 | One value is outside the range Steam accepts. Check the visibility and the tags. |
| `k_EResultRateLimitExceeded` | 84 | Too many Workshop updates in a short time. Wait a few minutes and retry. |
| `k_EResultItemDeleted` | 86 | This Workshop item no longer exists. It was deleted on Steam, so link or create another item. |
| `k_EResultNotModified` | 91 | Nothing in this update differs from what Steam already has. |
| `k_EResultInvalidItemType` | 104 | Steam refuses this item type here. Check the item was created for this game. |
| `k_EResultMustAgreeToSSA` | 118 | The account has not accepted the Steam Subscriber Agreement. Accept it on Steam and retry. |

Five of these are worth knowing before you meet them:

- **`k_EResultAccessDenied` is almost always the wrong account.** The item id stored in the mod belongs to whoever created it. If a friend uploaded the mod first, or you signed into a second Steam account, the update is refused no matter how the files look.
- **`k_EResultLimitExceeded` is the preview image, not your description.** Valve documents it on `SubmitItemUpdate` as an image over 1 MB, or a Steam Cloud with no room left. Preview images are stored in your Cloud, which is why the quota shows up here. The toolkit warns you about a large preview before it uploads, so this one usually means the Cloud.
- **`k_EResultServiceReadOnly` is your account, not Steam's servers.** Changing your password or your email puts a hold on new Workshop uploads. It normally lifts after 5 days, and up to 30 on an account that has been inactive. Nothing you change in the mod affects it.
- **`k_EResultFileNotFound` points at a path, not at your mod's contents.** The preview image is the usual culprit.
- **`k_EResultBanned` needs the Workshop page, not another upload.** Retrying cannot clear it. It means a VAC or game ban on the account, not on the item.

## Codes without advice

The other hundred codes are rare enough here that inventing advice for them would be worse than saying nothing. The toolkit names them and stops:

> Paradox Modding Toolkit: Workshop upload failed - Steam refused the request (SubmitItemUpdate: k_EResultInvalidSteamID)

These are the ones that turn up occasionally in Workshop and UGC contexts. The meanings are the enum's general ones, not Workshop-specific behavior, so treat them as a starting point:

| Code | # | The enum's general meaning |
|---|---|---|
| `k_EResultInvalidState` | 11 | The call arrived at a point Steam does not accept it. |
| `k_EResultAccountNotFound` | 18 | Steam found no such account. |
| `k_EResultInvalidSteamID` | 19 | An account or item id was not a valid Steam ID. |
| `k_EResultPending` | 22 | The operation is still running on Steam's side. |
| `k_EResultExpired` | 27 | Something passed to Steam has expired. |
| `k_EResultNoMatch` | 42 | Nothing matched the request, as in a query that found no item. |
| `k_EResultRemoteFileConflict` | 60 | Steam Cloud holds a conflicting copy. |
| `k_EResultUnexpectedError` | 79 | Steam's own unexpected-error code. |
| `k_EResultDisabled` | 80 | The feature is turned off for this account or app. |
| `k_EResultRegionLocked` | 83 | Blocked in this region. |
| `k_EResultTooManyPending` | 108 | Too many operations of this kind are already queued. |
| `k_EResultCommunityCooldown` | 116 | The account is in a community cooldown, which blocks community actions. |

A code the toolkit's copy of the Steamworks enum does not know at all reads as `EResult(<number>)`. That means Valve added it after the binding was generated; the number is still the number in this page's `#` column.

## When Steam refuses a value outright

Some failures never reach a result code. Steam's setters return false instead, before the update is submitted, and the toolkit names the value that was refused:

> Paradox Modding Toolkit: Workshop upload failed - Steam rejected the preview image (SetItemPreview)

The values it can name are the title, the description, the tags, the visibility, the content folder, the preview image, the language code and the item handle. This shape means the value itself was unacceptable, so retrying without changing it fails the same way.

## `Steam init failed`

This one is not an upload failure at all. It means the Steam client was not reachable when the toolkit started talking to it, and it carries Valve's own diagnostic text. Start Steam, sign into an account that owns the game, then retry. The toolkit repeats those two conditions in the message, because they are the cause almost every time.

## What the toolkit tells you

Every Workshop result is a VS Code notification and a line in the output channel, so it survives switching away from the panel.

- **Errors:** upload failed, item creation failed, pulling the listing failed, and the three local ones (writing the descriptor, writing the tags, setting the preview). Steam failures pass through the table above; local ones carry the file error.
- **Blocked before Steam is called:** the mod has no descriptor, or the descriptor has no `name=`.
- **Warnings:** nothing to upload, no Workshop item to pull from, no workshop folder yet, a preview image of 1 MB or more (Steam rejects it, so the upload keeps the current one), and the Workshop legal agreement, which comes with an **Open Agreement** button.
- **Done:** upload finished, or the description and translations written to the listing folder.

## If you upload another way

The launcher, SteamCMD and homegrown scripts hit the same wall for the same reasons, and the account questions above are the first thing to check whichever tool you use. What differs is the rendering: SteamCMD prints its own text for the result, and a small script often prints the bare integer. That is what the `#` column is for.

The numbers themselves come from the Steamworks SDK, through the generated enum in [steamwand.js](https://www.npmjs.com/package/steamwand.js), the binding the toolkit's Steam bridge uses. Valve lists the numbers with their general meanings in the [Steamworks API reference](https://partner.steamgames.com/doc/api/steam_api#EResult), and the meanings that apply to an upload under `CreateItem` and `SubmitItemUpdate` in the [ISteamUGC reference](https://partner.steamgames.com/doc/api/ISteamUGC). The sentences above follow the second one. The toolkit's own table of sentences lives in [`packages/vscode/src/steam/steamErrors.ts`](https://github.com/JDeffner/paradox-modding-toolkit/blob/main/packages/vscode/src/steam/steamErrors.ts), and a test checks every key in it against the enum, so a code documented here is a code the extension really knows.

## Related

The Steam Workshop panel itself (publishing, the listing files, translations and changenotes), the `px.workshop.dir` setting and the rest of the Workshop settings, and where each game stores the item id are on the GitHub wiki: https://github.com/JDeffner/paradox-modding-toolkit/wiki
