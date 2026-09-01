import { describe, expect, it } from "vitest";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { eu5Meta } from "@px-lsp/server/games/eu5/meta";
import { DEBUG_ARGS, runPresets, steamRunUrl } from "../src/gameRunPresets";

describe("runPresets", () => {
  it("debug default first, game extras between, vanilla last", () => {
    const presets = runPresets(ck3Meta);
    expect(presets[0]).toEqual({ name: "Launch CK3 (debug mode)", args: DEBUG_ARGS });
    expect(presets[presets.length - 1]).toEqual({ name: "Launch CK3 (vanilla, no options)", args: [] });
    expect(presets.map((p) => p.name)).toContain("Launch CK3 Map Editor");
    expect(presets.find((p) => p.name === "Launch CK3 Map Editor")?.args).toEqual(["-mapeditor"]);
  });

  it("a game without verified extras still offers debug and vanilla", () => {
    const presets = runPresets(eu5Meta);
    expect(presets).toHaveLength(2);
    expect(presets[0].args).toEqual(DEBUG_ARGS);
    expect(presets[1].args).toEqual([]);
  });
});

describe("steamRunUrl", () => {
  it("URL-encodes the options into the Steam run URL", () => {
    expect(steamRunUrl(1158310, ["-debug_mode", "-develop"])).toBe(
      "steam://run/1158310//-debug_mode%20-develop/"
    );
  });

  it("a vanilla launch has an empty options segment", () => {
    expect(steamRunUrl(529340, [])).toBe("steam://run/529340///");
  });
});
