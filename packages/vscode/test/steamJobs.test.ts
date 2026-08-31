import { describe, expect, it } from "vitest";
import { versionAtLeast, VISIBILITY } from "../src/steam/jobs";

describe("steam jobs", () => {
  it("compares dotted versions numerically", () => {
    expect(versionAtLeast("0.6.0", "0.6.0")).toBe(true);
    expect(versionAtLeast("0.10.0", "0.6.0")).toBe(true);
    expect(versionAtLeast("1.0.0", "0.6.0")).toBe(true);
    expect(versionAtLeast("0.5.0", "0.6.0")).toBe(false);
    expect(versionAtLeast("0.6", "0.6.0")).toBe(true);
    expect(versionAtLeast("0.6.1", "0.6")).toBe(true);
  });

  it("treats junk versions as too old", () => {
    expect(versionAtLeast("0.0.0", "0.6.0")).toBe(false);
    expect(versionAtLeast("garbage", "0.6.0")).toBe(false);
  });

  it("names the ISteamUGC visibility values Steam defines", () => {
    // ERemoteStoragePublishedFileVisibility: the numbers are Steam's, not ours.
    expect(VISIBILITY).toEqual({ public: 0, friendsOnly: 1, private: 2, unlisted: 3 });
  });
});
