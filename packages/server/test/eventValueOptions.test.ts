/**
 * The inspector's nested-value dropdowns: a value resolves through the index
 * to the set it belongs to (`secret_cultivator` → every secret). The static
 * key→values vocabulary cannot answer this — key names collide across
 * contexts (`type` in `random_secret` is a secret, not an event type).
 */
import { describe, expect, it } from "vitest";
import { computeValueOptions } from "../src/overview/eventVocabulary";
import { ServerData } from "../src/serverData";

const data = new ServerData();
const at = (name: string, kind: string, file = "f.txt", source: "mod" | "vanilla" = "mod") => ({
  name,
  kind,
  file,
  line: 0,
  source,
});
data.index.addAll([
  at("secret_cultivator", "secret"),
  at("secret_murder", "secret", "vanilla.txt", "vanilla"),
  at("secret_witch", "secret", "vanilla.txt", "vanilla"),
  at("brave", "trait", "vanilla.txt", "vanilla"),
  at("ns.1", "event"),
]);

describe("computeValueOptions", () => {
  it("resolves a value to every definition of its kind, mod entries first", () => {
    const result = computeValueOptions(data, "secret_cultivator");
    expect(result?.kind).toBe("secret");
    expect(result?.items.map((i) => i.value)).toEqual(["secret_cultivator", "secret_murder", "secret_witch"]);
    expect(result?.items[0].hint).toBe("this mod");
  });

  it("answers null for numbers, booleans, scope chains and unindexed names", () => {
    expect(computeValueOptions(data, "100")).toBeNull();
    expect(computeValueOptions(data, "yes")).toBeNull();
    expect(computeValueOptions(data, "scope:father")).toBeNull();
    expect(computeValueOptions(data, "no_such_thing")).toBeNull();
  });

  it("skips id spaces a capped list would lie about (events)", () => {
    expect(computeValueOptions(data, "ns.1")).toBeNull();
  });

  it("a set of one enumerates nothing worth a menu", () => {
    expect(computeValueOptions(data, "brave")).toBeNull();
  });
});
