/**
 * ck3/eventDetail extraction: loc resolution with editable sites, section and
 * option summaries, the rendered pseudo-script + step-into targets the event
 * simulator walks, and reference collection (scopes, variables, scripted
 * effects/triggers, script values, chained events) with definition sites.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { computeEventDetail } from "../src/overview/eventDetail";
import { computeEventGraph } from "../src/overview/eventGraph";
import { extractReferences } from "../src/index/references";
import { loadSchema } from "../src/schema/loader";
import { ServerData } from "../src/serverData";

const EVENT_TXT = `namespace = det

det.1 = {
	type = character_event
	title = det.1.t
	desc = det.1.desc
	theme = intrigue

	trigger = {
		is_adult = yes
		my_scripted_trigger = yes
		gold >= my_value
	}

	immediate = {
		save_scope_as = det_target
		my_scripted_effect = yes
		set_variable = { name = det_count value = 3 }
	}

	option = {
		name = det.1.a
		add_gold = 10
		trigger_event = det.2
		ai_chance = { base = 100 }
	}
	option = {
		name = det.1.b
		trigger = { scope:det_target = { is_alive = yes } }
		change_variable = { name = det_count add = var:det_count }
		trigger_event = {
			id = det.3
			days = 3
		}
		trigger_event = { on_action = det_pulse }
		trigger_event = det.404
	}

	after = {
		add_prestige = 50
	}
}

det.2 = {
	type = character_event
}

det.3 = {
	type = character_event
}
`;

const ON_ACTION_TXT = `det_pulse = {
	events = {
		det.2
	}
	random_events = {
		900 = 0
		100 = det.3
	}
}
`;

const RAND_EVENT_TXT = `namespace = rnd

rnd.1 = {
	type = character_event
	immediate = {
		trigger_event = { on_action = det_rand }
	}
}
`;

const RAND_ON_ACTION_TXT = `det_rand = {
	random_on_action = {
		100 = det_pulse
	}
	first_valid_on_action = {
		det_pulse2
	}
}
`;

/** 70 statements: past the 60-line render cap. */
const BIG_TXT = `namespace = big

big.1 = {
	type = character_event
	immediate = {
${Array.from({ length: 70 }, (_, i) => `\t\tadd_gold = ${i}`).join("\n")}
	}
}
`;

let dir: string;
let file: string;
let onActionFile: string;
let bigFile: string;
const data = new ServerData();
const schema = loadSchema(null);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-detail-"));
  file = path.join(dir, "det_events.txt");
  onActionFile = path.join(dir, "det_on_actions.txt");
  bigFile = path.join(dir, "big_events.txt");
  fs.writeFileSync(file, EVENT_TXT, "utf8");
  fs.writeFileSync(onActionFile, ON_ACTION_TXT, "utf8");
  fs.writeFileSync(bigFile, BIG_TXT, "utf8");
  fs.writeFileSync(path.join(dir, "rnd_events.txt"), RAND_EVENT_TXT, "utf8");
  fs.writeFileSync(path.join(dir, "rnd_on_actions.txt"), RAND_ON_ACTION_TXT, "utf8");
  const at = (name: string, kind: string, extra: object = {}) => ({
    name,
    kind,
    file,
    line: 0,
    source: "mod" as const,
    ...extra,
  });
  data.index.addAll([
    at("det.1", "event", { line: 2 }),
    at("det.2", "event", { line: 42 }),
    at("det.3", "event", { line: 46 }),
    at("det_pulse", "on_action", { file: onActionFile, line: 0 }),
    // Second definition site: a mod extending det_pulse (defCount hint).
    at("det_pulse", "on_action", { file: path.join(dir, "det_on_actions_ext.txt"), line: 0 }),
    at("rnd.1", "event", { file: path.join(dir, "rnd_events.txt"), line: 2 }),
    at("det_rand", "on_action", { file: path.join(dir, "rnd_on_actions.txt"), line: 0 }),
    at("det_pulse2", "on_action", { file: path.join(dir, "rnd_on_actions.txt"), line: 4 }),
    at("big.1", "event", { file: bigFile, line: 2 }),
    at("det.1.t", "loc_key", {
      file: path.join(dir, "det_l_english.yml"),
      line: 1,
      value: "A Detailed Event",
    }),
    at("det.1.a", "loc_key", { file: path.join(dir, "det_l_english.yml"), line: 2, value: "Take the gold" }),
    at("my_scripted_effect", "scripted_effect", { file: path.join(dir, "fx.txt"), line: 5 }),
    at("my_scripted_trigger", "scripted_trigger", { file: path.join(dir, "tr.txt"), line: 7 }),
    at("my_value", "script_value", { file: path.join(dir, "sv.txt"), line: 9 }),
    at("det_target", "saved_scope", { line: 16 }),
    at("det_count", "variable", { line: 18 }),
  ]);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("computeEventDetail", () => {
  it("resolves the event with type/theme and loc fields", () => {
    const d = computeEventDetail(data, schema, "det.1")!;
    expect(d).not.toBeNull();
    expect(d.type).toBe("character_event");
    expect(d.theme).toBe("intrigue");
    expect(d.title?.key).toBe("det.1.t");
    expect(d.title?.text).toBe("A Detailed Event");
    expect(d.title?.file).toContain("det_l_english.yml"); // mod entry → editable site
    expect(d.desc?.key).toBe("det.1.desc");
    expect(d.desc?.text).toBeUndefined(); // no loc entry yet
    expect(d.endLine).toBeGreaterThan(d.line);
  });

  it("summarizes sections and options", () => {
    const d = computeEventDetail(data, schema, "det.1")!;
    const names = d.sections.map((s) => s.name);
    expect(names).toContain("trigger");
    expect(names).toContain("immediate");
    expect(d.options).toHaveLength(2);
    expect(d.options[0].name?.key).toBe("det.1.a");
    expect(d.options[0].name?.text).toBe("Take the gold");
    expect(d.options[0].effectKeys).toContain("add_gold");
    expect(d.options[0].hasAiChance).toBe(true);
    expect(d.options[1].hasTrigger).toBe(true);
  });

  it("collects references with definition sites", () => {
    const d = computeEventDetail(data, schema, "det.1")!;
    const byKey = new Map(d.refs.map((r) => [`${r.kind}:${r.name}`, r]));
    expect(byKey.get("saved_scope:det_target")?.defLine).toBe(16);
    expect(byKey.get("variable:det_count")?.defLine).toBe(18);
    expect(byKey.get("scripted_effect:my_scripted_effect")?.defFile).toContain("fx.txt");
    expect(byKey.get("scripted_trigger:my_scripted_trigger")?.defFile).toContain("tr.txt");
    expect(byKey.get("script_value:my_value")?.defFile).toContain("sv.txt");
    expect(byKey.get("event:det.2")).toBeDefined();
    expect(byKey.has("event:det.1")).toBe(false); // self excluded
  });

  it("returns null for unknown events", () => {
    expect(computeEventDetail(data, schema, "nope.999")).toBeNull();
  });
});

describe("simulator payload: rendered blocks", () => {
  it("renders a section as indented pseudo-script with source lines", () => {
    const d = computeEventDetail(data, schema, "det.1")!;
    const trigger = d.sections.find((s) => s.name === "trigger")!;
    expect(trigger.lines.map((l) => l.text)).toEqual([
      "is_adult = yes",
      "my_scripted_trigger = yes",
      "gold >= my_value",
    ]);
    expect(trigger.lines.every((l) => l.depth === 0)).toBe(true);
    expect(trigger.totalLines).toBe(3);
    // Lines carry their own source line, in order, inside the section.
    expect(trigger.lines[0].line).toBe(trigger.line + 1);
    expect(trigger.lines[2].line).toBe(trigger.line + 3);
  });

  it("nests child blocks and closes them", () => {
    const d = computeEventDetail(data, schema, "det.1")!;
    const immediate = d.sections.find((s) => s.name === "immediate")!;
    expect(immediate.lines.map((l) => `${l.depth}:${l.text}`)).toEqual([
      "0:save_scope_as = det_target",
      "0:my_scripted_effect = yes",
      "0:set_variable = {",
      "1:name = det_count",
      "1:value = 3",
      "0:}",
    ]);
  });

  it("renders option effects without the option's own gating keys", () => {
    const d = computeEventDetail(data, schema, "det.1")!;
    const texts = d.options[0].lines.map((l) => l.text);
    expect(texts).toContain("add_gold = 10");
    expect(texts).toContain("trigger_event = det.2");
    // name / ai_chance gate or label the option; they are not its effect.
    expect(texts.some((t) => t.startsWith("name"))).toBe(false);
    expect(texts.some((t) => t.startsWith("ai_chance"))).toBe(false);
    // The option's own trigger is dropped too, block and all.
    expect(d.options[1].lines.some((l) => l.text.startsWith("trigger "))).toBe(false);
  });

  it("caps a long block and reports the real line count", () => {
    const d = computeEventDetail(data, schema, "big.1")!;
    const immediate = d.sections.find((s) => s.name === "immediate")!;
    expect(immediate.lines).toHaveLength(60);
    expect(immediate.totalLines).toBe(70);
  });
});

describe("simulator payload: step-into targets", () => {
  it("finds the scalar form and resolves its definition", () => {
    const d = computeEventDetail(data, schema, "det.1")!;
    const target = d.options[0].targets.find((t) => t.name === "det.2")!;
    expect(target).toMatchObject({ via: "trigger_event", kind: "event", file });
    expect(target.defLine).toBe(42);
    expect(target.line).toBeGreaterThan(d.options[0].line);
  });

  it("finds the block form `trigger_event = { id = X }`", () => {
    const d = computeEventDetail(data, schema, "det.1")!;
    const target = d.options[1].targets.find((t) => t.name === "det.3")!;
    expect(target).toMatchObject({ via: "trigger_event", kind: "event" });
  });

  it("labels an unresolvable target instead of guessing", () => {
    const d = computeEventDetail(data, schema, "det.1")!;
    const target = d.options[1].targets.find((t) => t.name === "det.404")!;
    expect(target.kind).toBe("unknown");
    expect(target.file).toBeUndefined();
    expect(target.fires).toBeUndefined();
  });

  it("resolves an on_action target's own event targets one level deep", () => {
    const d = computeEventDetail(data, schema, "det.1")!;
    const target = d.options[1].targets.find((t) => t.name === "det_pulse")!;
    expect(target).toMatchObject({ via: "on_action", kind: "on_action", file: onActionFile });
    expect(target.fires!.map((f) => f.name)).toEqual(["det.2", "det.3"]);
    expect(target.fires!.every((f) => f.kind === "event")).toBe(true);
    expect(target.firesTotal).toBe(2);
    // `900 = 0` is "no event", not a target named 0.
    expect(target.fires!.some((f) => f.name === "0")).toBe(false);
    // One level only: the fired events are not themselves expanded.
    expect(target.fires!.every((f) => f.fires === undefined)).toBe(true);
    // Two indexed definition sites: the hint says which one fires reflects.
    expect(target.defCount).toBe(2);
  });

  it("follows random_on_action and first_valid_on_action chains", () => {
    const d = computeEventDetail(data, schema, "rnd.1")!;
    const target = d.sections
      .find((s) => s.name === "immediate")!
      .targets.find((t) => t.name === "det_rand")!;
    expect(target.kind).toBe("on_action");
    expect(target.fires!.map((f) => [f.via, f.name])).toEqual([
      ["random_on_action", "det_pulse"],
      ["first_valid_on_action", "det_pulse2"],
    ]);
    expect(target.fires!.every((f) => f.kind === "on_action")).toBe(true);
    // Single-site targets carry no defCount; the merged det_pulse does.
    expect(target.defCount).toBeUndefined();
    expect(target.fires![0].defCount).toBe(2);
  });

  it("keeps sections without onward references target-free", () => {
    const d = computeEventDetail(data, schema, "det.1")!;
    expect(d.sections.find((s) => s.name === "after")!.targets).toEqual([]);
    expect(d.sections.find((s) => s.name === "trigger")!.targets).toEqual([]);
  });

  it("counts every target, capped list or not", () => {
    const d = computeEventDetail(data, schema, "det.1")!;
    expect(d.options[1].targetsTotal).toBe(d.options[1].targets.length);
    expect(d.options[1].targetsTotal).toBe(3);
  });
});

describe("event graph v2 (titles + edge origin labels)", () => {
  it("nodes carry localized titles; edges carry their origin option's text", () => {
    const extracted = extractReferences(EVENT_TXT, file, "mod", schema);
    data.refIndex.addAll(extracted.references);
    const graph = computeEventGraph(data, { root: "det.1" });
    const det1 = graph.nodes.find((n) => n.id === "det.1");
    expect(det1?.title).toBe("A Detailed Event");
    const edge = graph.edges.find((e) => e.from === "det.1" && e.to === "det.2");
    expect(edge).toBeDefined();
    expect(edge!.label).toBe("option: Take the gold");
  });
});
