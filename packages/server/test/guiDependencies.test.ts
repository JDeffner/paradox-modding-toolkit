/**
 * G5 GUI-to-script dependency surfaces, both directions.
 *
 * PdxGui reaches script through exactly one door, `GetScriptedGui('name')`, so
 * the two questions are one walk read from opposite ends: forward, this widget
 * calls X which fires event E "directly" or "via effect_a -> effect_b";
 * reverse, event E is reached from these .gui paths.
 *
 * The chain is the part worth pinning hardest. A flat "this scripted_gui
 * references these names" list is what the reference index already gives; the
 * value here is that the hop list is right, shortest-path, and cycle-safe.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { computeGuiDependencies, computeGuiUses } from "../src/gui/guiDependencies";
import { computeDependencies } from "../src/overview/dependencies";
import { collectScriptedGuiCalls, emptyGuiScriptLinks, findScriptedGuiCalls } from "../src/gui/guiLinks";
import { loadSchema } from "../src/schema/loader";
import { ServerData } from "../src/serverData";

const schema = loadSchema(null);
const data = new ServerData();
const links = emptyGuiScriptLinks();

/**
 * `px_open_gui` fires an event directly and reaches two more through a chain of
 * scripted effects; `px_ring_gui` calls a pair of effects that call each other,
 * which is the cycle guard's subject.
 */
const SGUI_TXT = `px_open_gui = {
	scope = character
	is_shown = {
		always = yes
	}
	effect = {
		trigger_event = px.1
		px_stage_one = yes
	}
}

px_ring_gui = {
	scope = character
	effect = {
		px_loop_a = yes
	}
}
`;

const EFFECTS_TXT = `px_stage_one = {
	px_stage_two = yes
}

px_stage_two = {
	trigger_event = px.2
	on_action = px_after
}

px_loop_a = {
	px_loop_b = yes
}

px_loop_b = {
	px_loop_a = yes
	trigger_event = px.3
}
`;

const GUI_TXT = `window = {
	name = "px_panel"
	widget = {
		name = "px_open_button"
		onclick = "[GetScriptedGui('px_open_gui').Execute(GuiScope.SetRoot(GetPlayer.MakeScope).End)]"
		text = "PX_OPEN_LABEL"
		tooltip = "PX_MISSING_TIP"
	}
	widget = {
		name = "px_other_button"
		onclick = "[GetScriptedGui('px_ring_gui').Execute(GuiScope.End)]"
		raw_text = "PX_NOT_A_KEY"
		text = "[GetPlayer.GetName]"
	}
}
`;

let dir: string;
let sguiFile: string;
let guiFile: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-guideps-"));
  sguiFile = path.join(dir, "common", "scripted_guis", "px_sguis.txt");
  const effectsFile = path.join(dir, "common", "scripted_effects", "px_effects.txt");
  guiFile = path.join(dir, "gui", "px_panel.gui");
  for (const [file, content] of [
    [sguiFile, SGUI_TXT],
    [effectsFile, EFFECTS_TXT],
    [guiFile, GUI_TXT],
  ] as const) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }

  data.index.addAll([
    { name: "px_open_gui", kind: "scripted_gui", file: sguiFile, line: 0, source: "mod" },
    { name: "px_ring_gui", kind: "scripted_gui", file: sguiFile, line: 11, source: "mod" },
    { name: "px_stage_one", kind: "scripted_effect", file: effectsFile, line: 0, source: "mod" },
    { name: "px_stage_two", kind: "scripted_effect", file: effectsFile, line: 4, source: "mod" },
    { name: "px_loop_a", kind: "scripted_effect", file: effectsFile, line: 9, source: "mod" },
    { name: "px_loop_b", kind: "scripted_effect", file: effectsFile, line: 13, source: "mod" },
    { name: "px.1", kind: "event", file: path.join(dir, "events", "px.txt"), line: 2, source: "mod" },
    { name: "px.2", kind: "event", file: path.join(dir, "events", "px.txt"), line: 9, source: "mod" },
    { name: "px.3", kind: "event", file: path.join(dir, "events", "px.txt"), line: 16, source: "mod" },
    {
      name: "PX_OPEN_LABEL",
      kind: "loc_key",
      file: path.join(dir, "localization", "px_l_english.yml"),
      line: 1,
      source: "mod",
      value: "Open",
    },
  ]);
  collectScriptedGuiCalls(GUI_TXT, guiFile, links);
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function forFile() {
  return computeGuiDependencies(data, schema, GUI_TXT, undefined, links);
}
function forWidget(line: number) {
  return computeGuiDependencies(data, schema, GUI_TXT, line, links);
}

describe("the call scan", () => {
  it("finds both quote styles and reports the 0-based line", () => {
    // Vanilla writes the single-quoted form inside a quoted attribute; the
    // double-quoted spelling is what an unquoted datacontext line uses.
    const text = `a = "[GetScriptedGui('one').Execute]"\nb = [GetScriptedGui( "two" ).IsShown]\n`;
    expect(findScriptedGuiCalls(text)).toEqual([
      { name: "one", line: 0 },
      { name: "two", line: 1 },
    ]);
  });

  it("a document naming no scripted_gui costs nothing and finds nothing", () => {
    expect(findScriptedGuiCalls('widget = { text = "hello" }')).toEqual([]);
  });
});

describe("forward: a widget's script surface", () => {
  it("the whole document lists every scripted_gui it calls", () => {
    const result = forFile();
    expect(result.widget).toBeUndefined();
    expect(result.scriptedGuis.map((r) => r.name)).toEqual(["px_open_gui", "px_ring_gui"]);
  });

  it("a widget is scoped to its own source subtree", () => {
    const result = forWidget(2);
    expect(result.widget).toEqual({ key: "widget", name: "px_open_button", line: 2 });
    expect(result.scriptedGuis.map((r) => r.name)).toEqual(["px_open_gui"]);
    expect(result.scriptedGuis[0].callLines).toEqual([4]);
  });

  it("a row carries the definition site and the tree-wide use count", () => {
    const [row] = forWidget(2).scriptedGuis;
    expect(row.file).toBe(sguiFile);
    expect(row.line).toBe(0);
    expect(row.uses).toBe(1);
  });

  it("`uses` counts every .gui file the store scanned, not just this document", () => {
    const wider = emptyGuiScriptLinks();
    collectScriptedGuiCalls(GUI_TXT, guiFile, wider);
    collectScriptedGuiCalls(GUI_TXT, path.join(dir, "gui", "px_second.gui"), wider);
    const [row] = computeGuiDependencies(data, schema, GUI_TXT, 2, wider).scriptedGuis;
    expect(row.uses).toBe(2);
    expect(row.callLines).toEqual([4]);
  });

  it("an unindexed scripted_gui is reported as called, with no definition and no chain", () => {
    const text = `widget = { onclick = "[GetScriptedGui('px_absent_gui').Execute]" }`;
    const [row] = computeGuiDependencies(data, schema, text, undefined, links).scriptedGuis;
    expect(row).toMatchObject({ name: "px_absent_gui", file: undefined, chains: [], uses: 1 });
  });

  it("a line carrying no widget answers empty rather than the whole file", () => {
    expect(forWidget(1)).toEqual({ scriptedGuis: [], locKeys: [] });
  });
});

describe("forward: the event chains", () => {
  it('a direct `trigger_event` is "directly": an empty via', () => {
    const chains = forWidget(2).scriptedGuis[0].chains;
    expect(chains.find((c) => c.name === "px.1")).toEqual({
      name: "px.1",
      kind: "event",
      file: path.join(dir, "events", "px.txt"),
      line: 2,
      via: [],
    });
  });

  it("an event two effects deep names both hops, outermost first", () => {
    const chains = forWidget(2).scriptedGuis[0].chains;
    expect(chains.find((c) => c.name === "px.2")!.via).toEqual(["px_stage_one", "px_stage_two"]);
    // An on_action is a control-transfer target too, over the same hops.
    expect(chains.find((c) => c.name === "px_after")).toMatchObject({
      kind: "on_action",
      via: ["px_stage_one", "px_stage_two"],
    });
  });

  it("directly-reached rows sort first", () => {
    expect(forWidget(2).scriptedGuis[0].chains.map((c) => c.via.length)).toEqual([0, 2, 2]);
  });

  it("scripted effects are hops, not rows: only events and on_actions are listed", () => {
    const names = forWidget(2).scriptedGuis[0].chains.map((c) => c.name);
    expect(names).not.toContain("px_stage_one");
    expect(names.sort()).toEqual(["px.1", "px.2", "px_after"]);
  });

  it("a cycle between two effects terminates and still reports what is past it", () => {
    const row = forFile().scriptedGuis.find((r) => r.name === "px_ring_gui")!;
    expect(row.chains.map((c) => c.name)).toEqual(["px.3"]);
    expect(row.chains[0].via).toEqual(["px_loop_a", "px_loop_b"]);
  });
});

describe("forward: the loc keys", () => {
  it("flags a key the loc index does not have, and resolves one it does", () => {
    const rows = forWidget(2).locKeys;
    expect(rows).toEqual([
      { key: "PX_OPEN_LABEL", prop: "text", line: 5, missing: false, value: "Open" },
      { key: "PX_MISSING_TIP", prop: "tooltip", line: 6, missing: true, value: undefined },
    ]);
  });

  it("`raw_text` is a literal, and a datafunction is not a key", () => {
    const keys = forFile().locKeys.map((r) => r.key);
    expect(keys).not.toContain("PX_NOT_A_KEY");
    expect(keys.some((k) => k.includes("["))).toBe(false);
  });
});

describe("reverse: from a definition to the .gui paths using it", () => {
  it("an event reached through two effects names the file, the door and the hops", () => {
    expect(computeGuiUses(data, schema, links, "px.2")).toEqual([
      { file: guiFile, line: 4, scriptedGui: "px_open_gui", via: ["px_stage_one", "px_stage_two"] },
    ]);
  });

  it("an event fired by the scripted_gui itself has an empty via", () => {
    expect(computeGuiUses(data, schema, links, "px.1")[0].via).toEqual([]);
  });

  it("a scripted effect is a target in its own right", () => {
    expect(computeGuiUses(data, schema, links, "px_stage_two")).toEqual([
      { file: guiFile, line: 4, scriptedGui: "px_open_gui", via: ["px_stage_one"] },
    ]);
  });

  it("the scripted_gui itself is reached with no hops at all", () => {
    expect(computeGuiUses(data, schema, links, "px_ring_gui")).toEqual([
      { file: guiFile, line: 10, scriptedGui: "px_ring_gui", via: [] },
    ]);
  });

  it("a definition no .gui reaches answers empty", () => {
    expect(computeGuiUses(data, schema, links, "px_unrelated")).toEqual([]);
  });

  it("paradox/dependencies carries it only when asked, and `[]` is a real answer", () => {
    const plain = computeDependencies(data, schema, "px.2");
    expect(plain.guiUses).toBeUndefined();
    const withGui = computeDependencies(data, schema, "px.2", undefined, (name) =>
      computeGuiUses(data, schema, links, name)
    );
    expect(withGui.guiUses).toHaveLength(1);
    expect(computeDependencies(data, schema, "px_stage_one", undefined, () => []).guiUses).toEqual([]);
  });
});
