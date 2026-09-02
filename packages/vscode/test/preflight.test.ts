import { describe, expect, it } from "vitest";
import { preflight, supportsGameVersion, type PreflightInput } from "../src/steam/preflight";

const good: PreflightInput = {
  name: "My Mod",
  description: "[b]Hi[/b]",
  tags: ["Gameplay"],
  previewPath: "thumbnail.png",
  previewBytes: 200_000,
  supportedVersion: "1.19.*",
  gameVersion: "1.19.0.6",
};

describe("preflight", () => {
  it("passes a complete listing", () => {
    expect(preflight(good)).toEqual([]);
  });

  it("blocks on Steam's hard limits", () => {
    const levels = preflight({
      ...good,
      name: "x".repeat(129),
      description: "y".repeat(8001),
      previewBytes: 1024 * 1024,
    }).map((c) => c.level);
    expect(levels).toEqual(["error", "error", "error"]);
  });

  it("warns on the things that make a listing look abandoned", () => {
    const messages = preflight({
      ...good,
      description: "",
      tags: [],
      previewPath: null,
      previewBytes: null,
      supportedVersion: "1.18.0",
    }).map((c) => `${c.level}:${c.message.split(" ")[0]}`);
    expect(messages).toEqual(["warn:No", "warn:The", "warn:No", "warn:The"]);
  });

  it("matches wildcard supported versions against the installed game", () => {
    expect(supportsGameVersion("1.19.*", "1.19.0.6")).toBe(true);
    expect(supportsGameVersion("1.19", "1.19.0.6")).toBe(true);
    expect(supportsGameVersion("*", "1.19.0.6")).toBe(true);
    expect(supportsGameVersion("1.18.0", "1.19.0.6")).toBe(false);
  });
});
