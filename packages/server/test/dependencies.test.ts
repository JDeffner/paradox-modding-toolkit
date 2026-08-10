/**
 * ck3/dependencies: the generic dependency explorer. A scripted effect is
 * called (bare key) by two events and itself references a trait; assert that
 * dependents list the two events (grouped by kind) and dependencies list the
 * trait. Also covers the reference-index path (a trait's dependents come from
 * schema-captured `add_trait` references) and the empty result.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { computeDependencies } from "../src/overview/dependencies";
import { extractReferences } from "../src/index/references";
import { loadSchema } from "../src/schema/loader";
import { ServerData } from "../src/serverData";

const schema = loadSchema(null);

const EVENTS_TXT = `namespace = dep

dep.1 = {
	type = character_event
	immediate = {
		my_effect = yes
	}
}

dep.2 = {
	type = character_event
	immediate = {
		my_effect = yes
	}
}
`;

const EFFECT_TXT = `my_effect = {
	add_trait = brave
}
`;

const TRAIT_TXT = `brave = {
	prowess = 2
}
`;

let dir: string;
let eventsFile: string;
let effectFile: string;
let traitFile: string;
const data = new ServerData();

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-deps-"));
  eventsFile = path.join(dir, "events", "dep_events.txt");
  effectFile = path.join(dir, "common", "scripted_effects", "fx.txt");
  traitFile = path.join(dir, "common", "traits", "traits.txt");
  for (const [f, content] of [
    [eventsFile, EVENTS_TXT],
    [effectFile, EFFECT_TXT],
    [traitFile, TRAIT_TXT],
  ] as const) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content, "utf8");
  }

  data.index.addAll([
    { name: "dep.1", kind: "event", file: eventsFile, line: 2, source: "mod" },
    { name: "dep.2", kind: "event", file: eventsFile, line: 9, source: "mod" },
    { name: "my_effect", kind: "scripted_effect", file: effectFile, line: 0, source: "mod" },
    { name: "brave", kind: "trait", file: traitFile, line: 0, source: "mod" },
  ]);
  // Schema-captured references (add_trait = brave) power the trait's dependents.
  data.refIndex.addAll(extractReferences(EFFECT_TXT, effectFile, "mod", schema).references);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("computeDependencies", () => {
  it("lists a scripted effect's callers as dependents, grouped by kind", () => {
    const r = computeDependencies(data, schema, "my_effect");
    expect(r.def).toMatchObject({ name: "my_effect", kind: "scripted_effect" });
    const events = r.dependents.find((g) => g.kind === "event");
    expect(events).toBeDefined();
    expect(events!.items.map((i) => i.name).sort()).toEqual(["dep.1", "dep.2"]);
    // The jump target is the actual call site inside each event.
    const dep1 = events!.items.find((i) => i.name === "dep.1")!;
    expect(dep1.line).toBe(5);
  });

  it("lists the definitions referenced inside the block as dependencies", () => {
    const r = computeDependencies(data, schema, "my_effect");
    const traits = r.dependencies.find((g) => g.kind === "trait");
    expect(traits).toBeDefined();
    expect(traits!.items.map((i) => i.name)).toContain("brave");
    expect(traits!.items[0].file).toBe(traitFile);
  });

  it("resolves dependents from the reference index for non-callable kinds", () => {
    const r = computeDependencies(data, schema, "brave");
    expect(r.def?.kind).toBe("trait");
    const effects = r.dependents.find((g) => g.kind === "scripted_effect");
    expect(effects).toBeDefined();
    expect(effects!.items.map((i) => i.name)).toEqual(["my_effect"]);
  });

  it("returns a null def for an unknown name", () => {
    const r = computeDependencies(data, schema, "nope_nothing");
    expect(r.def).toBeNull();
    expect(r.dependents).toEqual([]);
    expect(r.dependencies).toEqual([]);
  });
});
