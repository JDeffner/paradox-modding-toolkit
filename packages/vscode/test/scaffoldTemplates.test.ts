import { describe, expect, it } from "vitest";
import { renderScaffold, type ScaffoldFile, type ScaffoldResult } from "../src/scaffold/templates";
import { ck3Meta } from "../../server/src/games/ck3/meta";
import { vic3Meta } from "../../server/src/games/vic3/meta";
import { eu5Meta } from "../../server/src/games/eu5/meta";
import type { GameMeta, ScaffoldTemplate } from "../../server/src/games/profile";
import { docForDefinition } from "../../server/src/index/docComments";
import { parseScript } from "../../server/src/parser";
import { parseLoc } from "../../server/src/parser";

const LANG = "english";

/** The template a game offers for `id`; fails the test when it offers none. */
function templateOf(meta: GameMeta, id: string): ScaffoldTemplate {
  const t = (meta.scaffolds ?? []).find((s) => s.id === id);
  expect(t, `${meta.id} offers a ${id} template`).toBeDefined();
  return t!;
}

/** Render a game's template exactly as the command does. */
function render(meta: GameMeta, id: string, name: string): ScaffoldResult {
  return renderScaffold(templateOf(meta, id), {
    prefix: "mymod",
    name,
    locLanguage: LANG,
    stageRoot: meta.stageRoots?.[0],
  });
}

function scriptFile(r: ScaffoldResult): ScaffoldFile {
  const f = r.files.find((x) => x.relPath.endsWith(".txt"));
  expect(f, "expected a .txt file").toBeDefined();
  return f!;
}

function locFile(r: ScaffoldResult): ScaffoldFile {
  const f = r.files.find((x) => x.relPath.endsWith(".yml"));
  expect(f, "expected a .yml file").toBeDefined();
  return f!;
}

/** Assert the produced content parses with no structural errors. */
function assertCleanScript(content: string): void {
  const parsed = parseScript(content);
  expect(parsed.errors, JSON.stringify(parsed.errors)).toEqual([]);
}

function assertCleanLoc(content: string, lang: string): void {
  const parsed = parseLoc(content);
  expect(parsed.language).toBe(lang);
  expect(parsed.errors, JSON.stringify(parsed.errors)).toEqual([]);
  expect(parsed.entries.length).toBeGreaterThan(0);
}

/** BOM flags: every generated file carries one, like every vanilla file. */
function assertBomFlags(r: ScaffoldResult): void {
  for (const f of r.files) expect(f.bom, `${f.relPath} bom`).toBe(true);
}

/** cursor points inside the produced content (line < content line count). */
function assertCursorInside(r: ScaffoldResult): void {
  const target = r.files.find((f) => f.relPath === r.cursor.relPath);
  expect(target, "cursor targets a produced file").toBeDefined();
  const lineCount = target!.content.split("\n").length;
  expect(r.cursor.line).toBeGreaterThanOrEqual(0);
  expect(r.cursor.line).toBeLessThan(lineCount);
}

/** Loc file must be named `_l_<lang>.yml` and its header must match. */
function assertLocFilenameAndHeader(f: ScaffoldFile, lang: string): void {
  expect(f.relPath.endsWith(`_l_${lang}.yml`)).toBe(true);
  expect(f.content.startsWith(`l_${lang}:`)).toBe(true);
  // appendContent (used when the file exists) must NOT carry a header — it is
  // just the key lines.
  expect(f.appendContent).toBeDefined();
  expect(f.appendContent!.includes(`l_${lang}:`)).toBe(false);
}

describe("event, default profile", () => {
  const r = render(ck3Meta, "event", "mymod.1");

  it("puts the event file under events/ and loc under localization/<lang>/", () => {
    expect(scriptFile(r).relPath).toBe("events/mymod_events.txt");
    expect(locFile(r).relPath).toBe("localization/english/mymod_events_l_english.yml");
  });

  it("declares the namespace and the matching event id", () => {
    const c = scriptFile(r).content;
    expect(c).toContain("namespace = mymod");
    expect(c).toContain("mymod.1 = {");
    expect(c).toContain("type = character_event");
  });

  it("appendContent for the event file has the block but NOT the namespace", () => {
    const f = scriptFile(r);
    expect(f.appendIfExists).toBe(true);
    expect(f.requiredHeader).toBe("namespace = mymod");
    expect(f.appendContent).toBeDefined();
    expect(f.appendContent!).toContain("mymod.1 = {");
    expect(f.appendContent!.includes("namespace =")).toBe(false);
  });

  it("loc filename/header match and loc keys line up with the event", () => {
    const f = locFile(r);
    assertLocFilenameAndHeader(f, LANG);
    // This game's loc keys cannot carry the event id's dot: $KEY$ replaces it.
    expect(f.content).toContain("mymod_1_t:");
    expect(f.content).toContain("mymod_1_desc:");
    expect(f.content).toContain("mymod_1_a:");
    // the option-name key in the script must exist in loc
    expect(scriptFile(r).content).toContain("name = mymod_1_a");
  });

  it("bom flags, cursor, and clean parse", () => {
    assertBomFlags(r);
    assertCursorInside(r);
    assertCleanScript(scriptFile(r).content);
    assertCleanLoc(locFile(r).content, LANG);
  });
});

describe("decision, default profile", () => {
  const r = render(ck3Meta, "decision", "my_decision");

  it("uses common/decisions/ and the loc folder", () => {
    expect(scriptFile(r).relPath).toBe("common/decisions/mymod_decisions.txt");
    expect(locFile(r).relPath).toBe("localization/english/mymod_decisions_l_english.yml");
  });

  it("has the required loc keys", () => {
    const c = locFile(r).content;
    expect(c).toContain("my_decision:");
    expect(c).toContain("my_decision_desc:");
    expect(c).toContain("my_decision_tooltip:");
    expect(c).toContain("my_decision_confirm:");
  });

  it("contains the expected decision structure", () => {
    const c = scriptFile(r).content;
    expect(c).toContain("is_shown = {");
    expect(c).toContain("is_valid_showing_failures_only = {");
    expect(c).toContain("effect = {");
    expect(c).toContain("custom_tooltip = my_decision_tooltip");
    expect(c).toContain("ai_potential = {");
    expect(c).toContain("ai_will_do = {");
  });

  it("bom flags, filename/header, cursor, and clean parse", () => {
    assertBomFlags(r);
    assertLocFilenameAndHeader(locFile(r), LANG);
    assertCursorInside(r);
    assertCleanScript(scriptFile(r).content);
    assertCleanLoc(locFile(r).content, LANG);
  });
});

describe("character interaction, default profile", () => {
  const r = render(ck3Meta, "interaction", "my_interaction");

  it("uses common/character_interactions/ (singular category, plural folder)", () => {
    expect(scriptFile(r).relPath).toBe("common/character_interactions/mymod_interactions.txt");
    expect(locFile(r).relPath).toBe("localization/english/mymod_interactions_l_english.yml");
  });

  it("has a working interaction shape and loc keys", () => {
    const c = scriptFile(r).content;
    expect(c).toContain("category = interaction_category_friendly");
    expect(c).toContain("desc = my_interaction_desc");
    expect(c).toContain("is_shown = {");
    expect(c).toContain("on_accept = {");
    const loc = locFile(r).content;
    expect(loc).toContain("my_interaction:");
    expect(loc).toContain("my_interaction_desc:");
  });

  it("bom flags, filename/header, cursor, and clean parse", () => {
    assertBomFlags(r);
    assertLocFilenameAndHeader(locFile(r), LANG);
    assertCursorInside(r);
    assertCleanScript(scriptFile(r).content);
    assertCleanLoc(locFile(r).content, LANG);
  });
});

describe("on_action hook, default profile", () => {
  const r = render(ck3Meta, "on_action", "on_birth");

  it("uses common/on_action/ (SINGULAR) and needs no loc", () => {
    expect(scriptFile(r).relPath).toBe("common/on_action/mymod_on_actions.txt");
    expect(r.files.some((f) => f.relPath.endsWith(".yml"))).toBe(false);
  });

  it("uses the APPEND pattern, not an override", () => {
    const c = scriptFile(r).content;
    // hooks into the vanilla on_action via its on_actions list
    expect(c).toContain("on_actions = { mymod_on_birth }");
    // defines the mod-owned on_action separately
    expect(c).toContain("mymod_on_birth = {");
    // the vanilla block must NOT carry effects directly (that would override it)
    const vanillaBlock = c.slice(c.indexOf("on_birth = {"), c.indexOf("mymod_on_birth = {"));
    expect(vanillaBlock.includes("effect = {")).toBe(false);
  });

  it("bom flag, cursor, and clean parse", () => {
    expect(scriptFile(r).bom).toBe(true);
    assertCursorInside(r);
    assertCleanScript(scriptFile(r).content);
    // appendContent is the same append pattern
    const f = scriptFile(r);
    expect(f.appendIfExists).toBe(true);
    expect(f.appendContent!).toContain("on_actions = { mymod_on_birth }");
  });
});

describe("scripted effect / trigger, default profile", () => {
  it("effect: emits a PdxDoc stub with @scope and @param, under scripted_effects/", () => {
    const f = scriptFile(render(ck3Meta, "scripted_effect", "mymod_do_thing"));
    expect(f.relPath).toBe("common/scripted_effects/mymod_scripted_effects.txt");
    const c = f.content;
    expect(c).toContain("# What this does.");
    expect(c).toContain("# @scope character");
    expect(c).toContain("# @param EXAMPLE_PARAM");
    // A `$PARAM$` in the template's prose is content, not a placeholder.
    expect(c).toContain("$PARAM$");
    expect(c).toContain("mymod_do_thing = {");
    assertCleanScript(c);
  });

  it("trigger: emits a PdxDoc stub with @scope, under scripted_triggers/", () => {
    const f = scriptFile(render(ck3Meta, "scripted_trigger", "mymod_is_thing"));
    expect(f.relPath).toBe("common/scripted_triggers/mymod_scripted_triggers.txt");
    const c = f.content;
    expect(c).toContain("# What this checks.");
    expect(c).toContain("# @scope character");
    expect(c).not.toContain("@param");
    expect(c).toContain("mymod_is_thing = {");
    assertCleanScript(c);
  });

  it("the emitted stub is captured as this definition's doc block", () => {
    const r = render(ck3Meta, "scripted_effect", "mymod_do_thing");
    const lines = scriptFile(r).content.split("\n");
    const defLine = lines.findIndex((l) => l.startsWith("mymod_do_thing = {"));
    const block = docForDefinition(lines, defLine);
    expect(block).not.toBeNull();
    expect(block!.doc).toBe("What this does.");
    expect(block!.tags.some((t) => t.tag === "scope")).toBe(true);
    expect(block!.tags.some((t) => t.tag === "param")).toBe(true);
  });

  it("bom flag, cursor inside the block, append pattern set", () => {
    const r = render(ck3Meta, "scripted_effect", "mymod_do_thing");
    expect(scriptFile(r).bom).toBe(true);
    assertCursorInside(r);
    expect(scriptFile(r).appendIfExists).toBe(true);
    expect(scriptFile(r).appendContent).toContain("mymod_do_thing = {");
  });
});

describe("cursor lands inside a useful block for every kind", () => {
  it("event cursor is inside immediate", () => {
    const r = render(ck3Meta, "event", "mymod.1");
    const line = scriptFile(r).content.split("\n")[r.cursor.line];
    expect(line).toContain("effects that run when the event fires");
    // Indented as deeply as the marker: two tabs inside immediate = {.
    expect(r.cursor.character).toBe(2);
  });
  it("decision cursor is inside effect", () => {
    const r = render(ck3Meta, "decision", "d");
    const line = scriptFile(r).content.split("\n")[r.cursor.line];
    expect(line).toContain("effects that run when the decision is taken");
  });
  it("interaction cursor is inside on_accept", () => {
    const r = render(ck3Meta, "interaction", "i");
    const line = scriptFile(r).content.split("\n")[r.cursor.line];
    expect(line).toContain("effects that run when the recipient accepts");
  });
  it("on_action cursor is inside the mod effect block", () => {
    const r = render(ck3Meta, "on_action", "on_death");
    const line = scriptFile(r).content.split("\n")[r.cursor.line];
    expect(line).toContain("your effects here");
  });
  it("scripted effect cursor sits one tab in", () => {
    const r = render(ck3Meta, "scripted_effect", "mymod_do_thing");
    expect(r.cursor.character).toBe(1);
  });
});

describe("per-game template selection", () => {
  it("the metadata-descriptor game writes its own event shape and loc keys", () => {
    const r = render(vic3Meta, "event", "mymod.1");
    const c = scriptFile(r).content;
    expect(c).toContain("namespace = mymod");
    expect(c).toContain("type = country_event");
    expect(c).not.toContain("character_event");
    // Its loc keys keep the dotted id, unlike the default profile's.
    expect(locFile(r).content).toContain("mymod.1.t:");
    expect(scriptFile(r).content).toContain("name = mymod.1.a");
    assertCleanScript(c);
    assertCleanLoc(locFile(r).content, LANG);
    assertBomFlags(r);
    assertCursorInside(r);
  });

  it("its on_action hook uses the PLURAL folder and its own vanilla names", () => {
    const t = templateOf(vic3Meta, "on_action");
    expect(t.picks).toContain("on_monthly_pulse_country");
    expect(t.picks).toContain("on_game_started");
    // Names of the default profile that do not exist in this game.
    expect(t.picks).not.toContain("on_birth");
    expect(t.picks).not.toContain("on_title_gain");
    const f = scriptFile(render(vic3Meta, "on_action", "on_game_started"));
    expect(f.relPath).toBe("common/on_actions/mymod_on_actions.txt");
    expect(f.content).toContain("on_actions = { mymod_on_game_started }");
    assertCleanScript(f.content);
  });

  it("offers no content type it cannot ground in the game's own files", () => {
    const ids = (meta: GameMeta) => (meta.scaffolds ?? []).map((s) => s.id);
    // Decisions and character interactions exist in this game with a different
    // shape, so it offers neither rather than writing the default profile's.
    expect(ids(vic3Meta)).toEqual(["event", "on_action", "scripted_effect", "scripted_trigger"]);
    // The game nobody owns gets only the two engine-generic block shapes.
    expect(ids(eu5Meta)).toEqual(["scripted_effect", "scripted_trigger"]);
  });
});

describe("load-stage roots", () => {
  it("prefixes every path of a staged game, and nothing of an unstaged one", () => {
    const stage = eu5Meta.stageRoots?.[0];
    expect(stage).toBe("in_game");
    const r = render(eu5Meta, "scripted_effect", "mymod_do_thing");
    expect(scriptFile(r).relPath).toBe("in_game/common/scripted_effects/mymod_scripted_effects.txt");
    // The cursor still names a file that was produced.
    expect(r.cursor.relPath).toBe(scriptFile(r).relPath);
    assertCleanScript(scriptFile(r).content);

    expect(ck3Meta.stageRoots).toBeUndefined();
    expect(scriptFile(render(ck3Meta, "scripted_effect", "x")).relPath).toBe(
      "common/scripted_effects/mymod_scripted_effects.txt"
    );
  });

  it("prefixes loc paths too, so a staged game's loc is loaded as well", () => {
    const staged: GameMeta = { ...ck3Meta, stageRoots: ["in_game"] };
    const r = render(staged, "event", "mymod.1");
    expect(locFile(r).relPath).toBe("in_game/localization/english/mymod_events_l_english.yml");
  });
});
