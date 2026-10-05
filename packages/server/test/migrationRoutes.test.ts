import { describe, expect, it } from "vitest";
import type { MigrationManifest } from "@px-lsp/protocol/migration";
import { planMigrationRoutes } from "../src/migrations/routes";

function entry(
  id: string,
  fromVersion: string,
  toVersion: string,
  dependsOn: string[] = []
): MigrationManifest {
  return {
    id,
    revision: "1",
    sdkVersion: 1,
    gameId: "ck3",
    fromVersion,
    toVersion,
    kind: "advisory",
    detection: "none",
    requirement: "required",
    title: id,
    description: "Route fixture",
    guidance: "Manual review",
    limitations: ["Known changes only"],
    evidence: [],
    inputs: [],
    dependsOn,
  };
}

describe("migration route planner", () => {
  it("includes every entry at every hop and orders local and earlier-hop prerequisites", () => {
    const catalog = [
      entry("a-follow-up", "1.1", "1.2", ["z-first"]),
      entry("z-first", "1.0", "1.1"),
      entry("a-dependent", "1.0", "1.1", ["z-first"]),
      { ...entry("b-note", "1.0", "1.1"), requirement: "informational" as const },
    ];
    const result = planMigrationRoutes(catalog, "ck3", "1.0", "1.2");
    expect(result.issues).toEqual([]);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].entryIds).toEqual(["z-first", "a-dependent", "b-note", "a-follow-up"]);
    expect(result.routes[0].transitions).toEqual([
      { fromVersion: "1.0", toVersion: "1.1", entryIds: ["z-first", "a-dependent", "b-note"] },
      { fromVersion: "1.1", toVersion: "1.2", entryIds: ["a-follow-up"] },
    ]);
    expect(planMigrationRoutes([...catalog].reverse(), "ck3", "1.0", "1.2")).toEqual(result);
  });

  it("returns direct and multi-hop alternatives for explicit selection", () => {
    const catalog = [
      entry("direct", "1.0", "1.2"),
      entry("first", "1.0", "1.1"),
      entry("second", "1.1", "1.2"),
    ];
    expect(planMigrationRoutes(catalog, "ck3", "1.0", "1.2").routes.map((route) => route.id)).toEqual([
      "1.0->1.1->1.2",
      "1.0->1.2",
    ]);
  });

  it("sorts builds numerically without inventing edges or normalizing exact build identities", () => {
    const catalog = [entry("late", "1.10", "1.11"), entry("early", "1.2", "1.3.0.1")];
    expect(planMigrationRoutes(catalog, "ck3", "1.2", "1.11")).toMatchObject({
      versions: ["1.2", "1.3.0.1", "1.10", "1.11"],
      routes: [],
      issues: [expect.stringContaining("version gap")],
    });
    expect(planMigrationRoutes(catalog, "ck3", "1.2.0", "1.3.0.1").routes).toEqual([]);
    expect(planMigrationRoutes(catalog, "ck3", "1.11", "1.10").routes).toEqual([]);
    expect(
      planMigrationRoutes([entry("downgrade", "1.11", "1.10")], "ck3", "1.11", "1.10").routes
    ).toHaveLength(1);
  });

  it("does not claim a route from an empty or different-game library", () => {
    expect(planMigrationRoutes([], "ck3", "1.0", "1.1")).toMatchObject({
      routes: [],
      issues: [expect.stringContaining("No migration entries")],
    });
    expect(planMigrationRoutes([entry("a", "1.0", "1.1")], "vic3", "1.0", "1.1")).toMatchObject({
      versions: [],
      routes: [],
      issues: [expect.stringContaining("vic3")],
    });
  });

  it.each([
    [[entry("a", "1.0", "1.1"), entry("a", "1.1", "1.2")], "Duplicate"],
    [[entry("a", "1.0", "1.1", ["absent"])], "missing prerequisite"],
    [[entry("a", "1.0", "1.1", ["b"]), entry("b", "1.0", "1.1", ["a"])], "Cyclic"],
    [[{ ...entry("a", "1.0", "1.1"), requirement: "optional" }], "invalid entry requirement"],
    [[{ ...entry("a", "1.0", "1.1"), fromVersion: "1.*" }], "invalid exact game version"],
  ])("rejects malformed catalogs and prerequisite graphs", (catalog, message) => {
    const result = planMigrationRoutes(catalog as MigrationManifest[], "ck3", "1.0", "1.2");
    expect(result.routes).toEqual([]);
    expect(result.issues.join(" ")).toContain(message);
  });

  it("rejects forward prerequisites and prerequisites outside a chosen version path", () => {
    const forward = [entry("first", "1.0", "1.1", ["second"]), entry("second", "1.1", "1.2")];
    const result = planMigrationRoutes(forward, "ck3", "1.0", "1.2");
    expect(result.routes).toEqual([]);
    expect(result.issues.join(" ")).toContain("forward prerequisites");
    const alternative = [
      entry("direct", "1.0", "1.2", ["first"]),
      entry("first", "1.0", "1.1"),
      entry("second", "1.1", "1.2", ["first"]),
    ];
    expect(planMigrationRoutes(alternative, "ck3", "1.0", "1.2").routes.map((route) => route.id)).toEqual([
      "1.0->1.1->1.2",
    ]);
  });

  it("bounds route alternatives and reports incomplete enumeration", () => {
    const catalog: MigrationManifest[] = [];
    // Every intermediate version can be skipped, yielding 256 alternatives.
    for (let from = 0; from < 9; from++) {
      for (let to = from + 1; to <= 9; to++) catalog.push(entry(`${from}-${to}`, `1.${from}`, `1.${to}`));
    }
    const result = planMigrationRoutes(catalog, "ck3", "1.0", "1.9");
    expect(result.routes).toHaveLength(128);
    expect(result.issues.join(" ")).toContain("enumeration limit reached");
    expect(result.issues.join(" ")).toContain("incomplete");
  });

  it("uses explicit directed routes even when reverse transitions form a version cycle", () => {
    const catalog = [entry("up", "1.0", "1.1"), entry("down", "1.1", "1.0"), entry("next", "1.1", "1.2")];
    expect(planMigrationRoutes(catalog, "ck3", "1.0", "1.2").routes.map((route) => route.id)).toEqual([
      "1.0->1.1->1.2",
    ]);
  });
});
