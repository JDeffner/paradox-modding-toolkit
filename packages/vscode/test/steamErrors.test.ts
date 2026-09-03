/**
 * The Steam-error rewriter (steam/steamErrors.ts). The fixtures are the exact
 * message shapes steamwand throws, because the previous table was keyed on
 * the phrases of the OLD native layer and silently matched nothing after the
 * bridge moved to steamwand.
 */
import { describe, expect, it } from "vitest";
import { EResult } from "steamwand.js/dist/generated/enums";
import { RESULT_HINTS, explainSteamError } from "../src/steam/steamErrors";

/** What bridge.ts hands friendlyError for a failed main submit. */
const submitFailed = (name: string) => `SubmitItemUpdate failed: ${name}`;

describe("explainSteamError", () => {
  it("explains the codes an upload actually hits", () => {
    expect(explainSteamError(submitFailed("k_EResultAccessDenied"))).toBe(
      "the Steam account you are logged in as may not edit this item. The Workshop ID in the " +
        "descriptor must belong to that account (SubmitItemUpdate: k_EResultAccessDenied)"
    );
    expect(explainSteamError(submitFailed("k_EResultLimitExceeded"))).toContain("8000 characters");
    expect(explainSteamError(submitFailed("k_EResultNotLoggedOn"))).toContain("Log in and retry");
    expect(explainSteamError("CreateItem failed: k_EResultFileNotFound")).toContain("preview image");
    expect(explainSteamError(submitFailed("k_EResultTimeout"))).toContain("retry the upload");
  });

  it("keeps the text around the failure", () => {
    expect(
      explainSteamError(`uploading the german translation failed: ${submitFailed("k_EResultBanned")}`)
    ).toBe(
      "uploading the german translation failed: Steam has banned this item or this account. " +
        "Check the item's Workshop page (SubmitItemUpdate: k_EResultBanned)"
    );
  });

  it("still names an unmapped or unknown code", () => {
    expect(explainSteamError(submitFailed("k_EResultInvalidSteamID"))).toBe(
      "Steam refused the request (SubmitItemUpdate: k_EResultInvalidSteamID)"
    );
    // eResultName's fallback for a value not in the shipped enum.
    expect(explainSteamError(submitFailed("EResult(9999)"))).toBe(
      "Steam refused the request (SubmitItemUpdate: EResult(9999))"
    );
  });

  it("names the field a rejected setter was given", () => {
    expect(explainSteamError("steamwand: SetItemTags returned false (invalid handle or argument?)")).toBe(
      "Steam rejected the tags (SetItemTags)"
    );
    expect(explainSteamError("steamwand: SetLanguage returned false (invalid handle or argument?)")).toBe(
      "Steam rejected one of the values it was given (SetLanguage)"
    );
  });

  it("returns null for anything that is not a Steam failure", () => {
    expect(explainSteamError("unexpected bridge reply")).toBeNull();
    expect(explainSteamError("Steam bridge exited with code 127")).toBeNull();
    expect(explainSteamError("content folder does not exist: F:/mods/x")).toBeNull();
    expect(explainSteamError("")).toBeNull();
  });

  it("keys only on EResult names steamwand can emit", () => {
    const names = new Set(Object.keys(EResult));
    for (const key of Object.keys(RESULT_HINTS)) {
      // steamwand spells one entry K_EResult..., so accept either prefix.
      expect(names.has(`k_EResult${key}`) || names.has(`K_EResult${key}`)).toBe(true);
      expect(explainSteamError(`Op failed: k_EResult${key}`)).toContain(RESULT_HINTS[key]);
    }
  });
});
