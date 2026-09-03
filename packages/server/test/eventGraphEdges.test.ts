/**
 * The two things the event graph used to get wrong, and why a Cultivation-Mod
 * namespace came back as "No events found":
 *
 *  - the node set was derived from the EDGES, so a namespace whose events are
 *    only reached through scripted effects (or not reached at all yet) was
 *    empty;
 *  - a `trigger_event` written inside a scripted_effect body belonged to no
 *    event, so the event that calls that effect looked like it fires nothing.
 *
 * The node set is still the namespace's DEFINITIONS. `connectedOnly` (on unless
 * the request says `false`) then drops the ones no edge touches, so the tests
 * that care about an edge-less event ask for it with `connectedOnly: false`.
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

/** A sequenced chain: delays on trigger_event, options as branch points. */
const SEQ_EVENTS_TXT = `namespace = seq

seq.1 = {
	type = character_event
	immediate = {
		trigger_event = { id = seq.2 days = 30 }
	}
	option = {
		name = seq.1.a
		trigger_event = { id = seq.3 days = { 7 14 } }
	}
	option = {
		name = seq.1.b
		trigger_event = seq.3
	}
	after = {
		trigger_event = { id = seq.4 months = 2 }
	}
}

seq.2 = { type = character_event }

seq.3 = { type = character_event }

seq.4 = {
	type = character_event
	option = {
		name = seq.4.a
		trigger_event = { id = seq.4 days = 100 }
	}
}
`;

const SEQ_ON_ACTION_TXT = `seq_pulse = {
	random_events = {
		100 = seq.2
		50 = seq.3
	}
}
`;

let dir: string;
let eventsFile: string;
let effectsFile: string;
let seqFile: string;
let onActionFile: string;
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
  seqFile = path.join(dir, "seq_events.txt");
  onActionFile = path.join(dir, "seq_on_actions.txt");
  fs.writeFileSync(seqFile, SEQ_EVENTS_TXT, "utf8");
  fs.writeFileSync(onActionFile, SEQ_ON_ACTION_TXT, "utf8");
  data.index.addAll([
    at("ns.1", "event", eventsFile, 2),
    at("ns.2", "event", eventsFile, 9),
    at("ns.9", "event", eventsFile, 13),
    at("ns_outer_effect", "scripted_effect", effectsFile, 0),
    at("ns_inner_effect", "scripted_effect", effectsFile, 4),
    at("seq.1", "event", seqFile, 2),
    at("seq.2", "event", seqFile, 20),
    at("seq.3", "event", seqFile, 22),
    at("seq.4", "event", seqFile, 24),
    at("seq_pulse", "on_action", onActionFile, 0),
    { ...at("seq.1.a", "loc_key", seqFile, 0), value: "Fight the raiders" },
  ]);
  data.refIndex.addAll(extractReferences(EVENTS_TXT, eventsFile, "mod", schema).references);
  data.refIndex.addAll(extractReferences(EFFECTS_TXT, effectsFile, "mod", schema).references);
  data.refIndex.addAll(extractReferences(SEQ_EVENTS_TXT, seqFile, "mod", schema).references);
  data.refIndex.addAll(extractReferences(SEQ_ON_ACTION_TXT, onActionFile, "mod", schema).references);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("event graph node selection", () => {
  it("lists every event of a namespace, including ones no edge touches", () => {
    const graph = computeEventGraph(data, { namespace: "ns", connectedOnly: false });
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["ns.1", "ns.2", "ns.9"]);
  });

  it("leaves the edge-less event out by default, so big mods stay cheap", () => {
    const graph = computeEventGraph(data, { namespace: "ns" });
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["ns.1", "ns.2"]);
  });

  it("lists the mod's definitions with no query at all", () => {
    const ids = computeEventGraph(data, { connectedOnly: false }).nodes.map((n) => n.id);
    expect(ids).toContain("ns.9");
  });

  it("an empty graph says WHY when the namespace exists outside the focus", () => {
    const graph = computeEventGraph(data, { namespace: "ns" }, () => false);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.emptyReason).toContain("another workspace mod");
  });

  it("a namespace the index has never seen keeps the generic empty story", () => {
    const graph = computeEventGraph(data, { namespace: "no_such_ns" });
    expect(graph.emptyReason).toBeUndefined();
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

  it("anchors a via-effect edge at the CALLER'S block, not inside the effect", () => {
    const graph = computeEventGraph(data, { root: "ns.1" });
    const edge = graph.edges.find((e) => e.from === "ns.1" && e.to === "ns.2")!;
    // ns.1 calls ns_outer_effect from its immediate block (line 4).
    expect(edge.phase).toBe("immediate");
    expect(edge.fromLine).toBe(4);
    // No delay is claimed: whatever waits inside the effect is not visible here.
    expect(edge.delay).toBeUndefined();
  });
});

describe("sequencing: steps, phases, delays, weights", () => {
  it("a mod event's card rows come in execution order with loc'd option text", () => {
    const graph = computeEventGraph(data, { namespace: "seq" });
    const node = graph.nodes.find((n) => n.id === "seq.1")!;
    expect(node.options).toBe(2);
    expect(node.steps!.map((s) => s.phase)).toEqual(["immediate", "option", "option", "after"]);
    expect(node.steps![0].line).toBe(4);
    expect(node.steps![1]).toMatchObject({ index: 0, line: 7, text: "Fight the raiders" });
    expect(node.steps![2]).toMatchObject({ index: 1, line: 11 });
    expect(node.steps![2].text).toBeUndefined();
  });

  it("two options firing the same target stay two edges, anchored at their own rows", () => {
    const graph = computeEventGraph(data, { namespace: "seq" });
    const toThree = graph.edges.filter((e) => e.from === "seq.1" && e.to === "seq.3");
    expect(toThree).toHaveLength(2);
    expect(toThree.map((e) => e.fromLine).sort((a, b) => a! - b!)).toEqual([7, 11]);
    for (const e of toThree) expect(e.phase).toBe("option");
  });

  it("reads trigger_event delays: a scalar, a range, a non-day unit", () => {
    const graph = computeEventGraph(data, { namespace: "seq" });
    const edge = (to: string) => graph.edges.find((e) => e.from === "seq.1" && e.to === to)!;
    expect(edge("seq.2")).toMatchObject({ phase: "immediate", delay: "30d", fromLine: 4 });
    const ranged = graph.edges.find((e) => e.to === "seq.3" && e.delay);
    expect(ranged?.delay).toBe("7–14d");
    expect(edge("seq.4")).toMatchObject({ phase: "after", delay: "2mo" });
  });

  it("an option that fires its own event is a self-edge, not silence", () => {
    const graph = computeEventGraph(data, { namespace: "seq" });
    const self = graph.edges.find((e) => e.from === "seq.4" && e.to === "seq.4");
    expect(self).toMatchObject({ phase: "option", delay: "100d", fromLine: 26 });
  });

  it("an on_action's random_events entries carry their raw weights", () => {
    const graph = computeEventGraph(data, { root: "seq_pulse" });
    const toTwo = graph.edges.find((e) => e.from === "seq_pulse" && e.to === "seq.2");
    expect(toTwo).toMatchObject({ weight: 100, phase: "random_events" });
    const toThree = graph.edges.find((e) => e.from === "seq_pulse" && e.to === "seq.3");
    expect(toThree?.weight).toBe(50);
  });
});
