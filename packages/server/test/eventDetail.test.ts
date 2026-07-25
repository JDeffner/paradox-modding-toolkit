/**
 * ck3/eventDetail extraction: loc resolution with editable sites, section and
 * option summaries, and reference collection (scopes, variables, scripted
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
	}
}

det.2 = {
	type = character_event
}
`;

let dir: string;
let file: string;
const data = new ServerData();

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-detail-"));
  file = path.join(dir, "det_events.txt");
  fs.writeFileSync(file, EVENT_TXT, "utf8");
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
    const d = computeEventDetail(data, "det.1")!;
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
    const d = computeEventDetail(data, "det.1")!;
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
    const d = computeEventDetail(data, "det.1")!;
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
    expect(computeEventDetail(data, "nope.999")).toBeNull();
  });
});

describe("event graph v2 (titles + edge origin labels)", () => {
  it("nodes carry localized titles; edges carry their origin option's text", () => {
    const schema = loadSchema(null);
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
