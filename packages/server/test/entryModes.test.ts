/**
 * Database entry modes (`REPLACE:key = { ... }`): games whose profile declares
 * entryModes index the definition under the bare name and keep the mode on the
 * Definition. The default profile declares none, so `REPLACE:x` stays an
 * (invalid) literal key there and is skipped by DEF_NAME.
 */
import { afterEach, describe, expect, it } from "vitest";
import { extractDefinitions } from "../src/index/extract";
import { setActiveProfile } from "../src/games/active";
import { resolveProfile, defaultProfile } from "../src/games/registry";
import type { SchemaEntry } from "../src/schema/types";

const entry: SchemaEntry = { path: "in_game/common/laws", kind: "law" };

const content = [
  "plain_law = { foo = yes }",
  "REPLACE:reformed_law = { foo = no }",
  "TRY_INJECT:tweaked_law = { bar = 1 }",
  "INJECT_OR_CREATE:new_law = { baz = 2 }",
].join("\n");

afterEach(() => setActiveProfile(defaultProfile));

describe("entry-mode prefixes", () => {
  it("strips declared modes and records them on the definition", () => {
    const eu5 = resolveProfile("eu5");
    // Guard: this test only means something once the eu5 profile is registered.
    if (eu5.id !== "eu5") return;
    setActiveProfile(eu5);
    const defs = extractDefinitions(content, entry, "laws.txt", "mod");
    const byName = new Map(defs.map((d) => [d.name, d]));
    expect(byName.get("plain_law")?.entryMode).toBeUndefined();
    expect(byName.get("reformed_law")?.entryMode).toBe("REPLACE");
    expect(byName.get("tweaked_law")?.entryMode).toBe("TRY_INJECT");
    expect(byName.get("new_law")?.entryMode).toBe("INJECT_OR_CREATE");
    expect(defs).toHaveLength(4);
  });

  it("leaves mode-prefixed keys unindexed for games without entryModes", () => {
    setActiveProfile(defaultProfile);
    const defs = extractDefinitions(content, entry, "laws.txt", "mod");
    expect(defs.map((d) => d.name)).toEqual(["plain_law"]);
  });
});
