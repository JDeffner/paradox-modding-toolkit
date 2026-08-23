/**
 * The two things the event graph used to get wrong, and why a Cultivation-Mod
 * namespace came back as "No events found":
 *
 *  - the node set was derived from the EDGES, so a namespace whose events are
 *    only reached through scripted effects (or not reached at all yet) was
 *    empty;
 *  - a `trigger_event` written inside a scripted_effect body belonged to no
 *    event, so the event that calls that effect looked like it fires nothing.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { computeEventGraph } from "../src/overview/eventGraph";
import { extractReferences } from "../src/index/references";
import { loadSchema } from "../src/schema/loader";
import { ServerData } from "../src/serverData";

/** ns.1 fires ns.2 through two scripted effects; ns.9 is referenced by nothing. */
const EVENTS_TXT = `namespace = ns

ns.1 = {
	type = character_event
	immediate = {
		ns_outer_effect = yes
	}
}

ns.2 = {
	type = character_event
}

ns.9 = {
	type = character_event
}
`;

const EFFECTS_TXT = `ns_outer_effect = {
	ns_inner_effect = yes
}

ns_inner_effect = {
	trigger_event = ns.2
}
`;

let dir: string;
let eventsFile: string;
let effectsFile: string;
const data = new ServerData();
const schema = loadSchema(null);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-graph-edges-"));
  eventsFile = path.join(dir, "ns_events.txt");
  effectsFile = path.join(dir, "ns_effects.txt");
  fs.writeFileSync(eventsFile, EVENTS_TXT, "utf8");
  fs.writeFileSync(effectsFile, EFFECTS_TXT, "utf8");
  const at = (name: string, kind: string, file: string, line: number) => ({
    name,
    kind,
    file,
    line,
    source: "mod" as const,
  });
  data.index.addAll([
    at("ns.1", "event", eventsFile, 2),
    at("ns.2", "event", eventsFile, 9),
    at("ns.9", "event", eventsFile, 13),
    at("ns_outer_effect", "scripted_effect", effectsFile, 0),
    at("ns_inner_effect", "scripted_effect", effectsFile, 4),
  ]);
  data.refIndex.addAll(extractReferences(EVENTS_TXT, eventsFile, "mod", schema).references);
  data.refIndex.addAll(extractReferences(EFFECTS_TXT, effectsFile, "mod", schema).references);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("event graph node selection", () => {
  it("lists every event of a namespace, including ones no edge touches", () => {
    const graph = computeEventGraph(data, { namespace: "ns" });
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["ns.1", "ns.2", "ns.9"]);
  });

  it("lists the mod's definitions with no query at all", () => {
    const ids = computeEventGraph(data, {}).nodes.map((n) => n.id);
    expect(ids).toContain("ns.9");
  });
});

describe("edges through scripted effects", () => {
  it("turns A -> effect -> effect -> B into A -> B labeled with the chain", () => {
    const graph = computeEventGraph(data, { root: "ns.1" });
    const edge = graph.edges.find((e) => e.from === "ns.1" && e.to === "ns.2");
    expect(edge).toBeDefined();
    expect(edge!.label).toBe("via ns_outer_effect → ns_inner_effect");
    // The effects themselves are not nodes: the reader asked about events.
    expect(graph.nodes.map((n) => n.id)).not.toContain("ns_outer_effect");
  });
});
