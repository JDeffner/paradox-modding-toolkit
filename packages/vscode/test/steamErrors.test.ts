/**
 * The Steam-error advice table (steam/steamErrors.ts): the phrases the
 * native layer's EResult mapping produces get a one-line hint, everything
 * unrecognized passes through unchanged.
 */
import { describe, expect, it } from "vitest";
import { explainSteamError } from "../src/steam/steamErrors";

describe("explainSteamError", () => {
  it("explains the phrases uploads actually hit", () => {
    expect(explainSteamError("upload failed: limit exceeded")).toContain("8000 characters");
    expect(explainSteamError("a file was not found")).toContain("preview image");
    expect(explainSteamError("access denied")).toContain("logged-in Steam account");
    expect(explainSteamError("insufficient privilege")).toContain("logged-in Steam account");
    expect(explainSteamError("user not logged on")).toContain("log into Steam");
    expect(explainSteamError("there isn't a network connection to steam or it failed to connect")).toContain(
      "offline"
    );
    expect(explainSteamError("operation timed out")).toContain("retry");
    expect(explainSteamError("a parameter is invalid")).toContain("tag");
    expect(explainSteamError("a generic failure from the steamworks API")).toContain("catch-all");
  });

  it("returns null for anything it does not recognize", () => {
    expect(explainSteamError("unexpected bridge reply")).toBeNull();
    expect(explainSteamError("Steam bridge exited with code 127")).toBeNull();
    expect(explainSteamError("")).toBeNull();
  });
});
