import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  constantDeclarations,
  constantHints,
  constantRefAt,
  evaluateConstant,
  provideConstantCompletion,
  provideConstantDefinition,
  provideConstantHover,
} from "../src/features/atConstants";
import { ServerData } from "../src/serverData";

// Shape of game/events/scheme_events/agent_events.txt: declared once at the
// top, used by name further down, and one value that is itself a script value.
const TEXT = [
  "namespace = agent_events",
  "@scheme_beneficial_modifier_default_duration = 1825",
  "@bet_value = major_gold_value # a script value",
  "",
  "agent_events.0021 = {",
  "\timmediate = {",
  "\t\tadd_scheme_modifier = {",
  "\t\t\tdays = @scheme_beneficial_modifier_default_duration",
  "\t\t}",
  "\t\tadd_gold = @[ bet_value * 2 ]",
  "\t\tadd_prestige = @missing",
  "\t}",
  "}",
].join("\n");

const doc = (uri = "file:///m/events/agent_events.txt") => TextDocument.create(uri, "paradox", 1, TEXT);

describe("@ constants", () => {
  it("finds a @name use, the operand of inline math, and nothing else", () => {
    expect(constantRefAt("\t\t\tdays = @scheme_x", 12)).toEqual({ name: "scheme_x", start: 10, end: 19 });
    expect(constantRefAt("\t\tadd_gold = @[ bet_value * 2 ]", 18)).toEqual({
      name: "bet_value",
      start: 16,
      end: 25,
    });
    expect(constantRefAt("\t\tadd_gold = @[ bet_value * 2 ]", 28)).toBeNull(); // the literal 2
    expect(constantRefAt("\t\tdays = plain_word", 12)).toBeNull();
    expect(constantRefAt('\t\ttext = "@gold_icon!"', 14)).toBeNull(); // loc icon, not a constant
  });

  it("go-to-definition jumps to the declaration in the same file", () => {
    const d = doc();
    const use = provideConstantDefinition(d, { line: 7, character: 20 });
    expect(use).toEqual([
      { uri: d.uri, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 44 } } },
    ]);
    // A math operand resolves the same way; the declaration itself goes nowhere.
    expect(provideConstantDefinition(d, { line: 9, character: 18 })?.[0].range.start.line).toBe(2);
    expect(provideConstantDefinition(d, { line: 1, character: 5 })).toEqual([]);
    // Undeclared: a @name stops (nothing else can resolve it), a plain word falls through.
    expect(provideConstantDefinition(d, { line: 10, character: 20 })).toEqual([]);
    expect(provideConstantDefinition(d, { line: 0, character: 3 })).toBeNull();
  });

  it("hover shows the value, the declaring line and the use count", () => {
    const data = new ServerData();
    const hover = provideConstantHover(data, doc(), { line: 7, character: 20 });
    expect(hover).not.toBeNull();
    const md = hover!.contents as { value: string };
    expect(md.value).toContain("@scheme_beneficial_modifier_default_duration");
    expect(md.value).toContain("= 1825");
    expect(md.value).toContain("Declared on line 2");
    expect(md.value).toContain("used 1 time in this file");
    expect(hover!.range).toEqual({ start: { line: 7, character: 10 }, end: { line: 7, character: 54 } });
  });

  it("a constant standing for an indexed name leads on to that definition", () => {
    const data = new ServerData();
    data.index.addAll([
      {
        name: "major_gold_value",
        kind: "script_value",
        file: "/g/common/script_values/00_a.txt",
        line: 3,
        source: "vanilla",
      },
    ]);
    const md = provideConstantHover(data, doc(), { line: 9, character: 18 })!.contents as { value: string };
    expect(md.value).toContain("major_gold_value");
    expect(md.value).toContain("00_a.txt:4");
  });

  it("an undeclared @name still answers, and says so", () => {
    const md = provideConstantHover(new ServerData(), doc(), { line: 10, character: 20 })!.contents as {
      value: string;
    };
    expect(md.value).toContain("Not declared in this file");
  });
});

describe("@ constants: value arithmetic and doc placement", () => {
  const MATH = [
    "@base = 20",
    "@spacing = @[base / 20]",
    "@half = @[ (base + 10) * 0.5 - 1 ]",
    "@alias = @base",
    "@broken = @[base / 0]",
    "@unknown = @[nope * 2]",
    "@loop_a = @loop_b",
    "@loop_b = @loop_a",
    "x = @spacing",
  ].join("\n");

  it("computes inline math over the file's own declarations", () => {
    const decls = constantDeclarations(MATH);
    expect(evaluateConstant("@[base / 20]", decls)).toBe(1);
    expect(evaluateConstant("@[ (base + 10) * 0.5 - 1 ]", decls)).toBe(14);
    expect(evaluateConstant("@[base * -1]", decls)).toBe(-20);
    expect(evaluateConstant("@base", decls)).toBe(20);
    expect(evaluateConstant("1825", decls)).toBe(1825);
    // Not a number: a script value name, a division by zero, an undeclared operand, a cycle.
    expect(evaluateConstant("major_gold_value", decls)).toBeNull();
    expect(evaluateConstant("@[base / 0]", decls)).toBeNull();
    expect(evaluateConstant("@[nope * 2]", decls)).toBeNull();
    expect(evaluateConstant("@loop_a", decls)).toBeNull();
  });

  it("shows the computed number after the expression, and the explanation only where it helps", () => {
    const d = TextDocument.create("file:///m/gui/x.gui", "paradox-gui", 1, MATH);
    const md = (line: number, character: number) =>
      (provideConstantHover(new ServerData(), d, { line, character })!.contents as { value: string }).value;
    // A use: value, computed number, line and count. No lecture.
    expect(md(8, 6)).toContain("= @[base / 20] → 1");
    expect(md(8, 6)).not.toContain("substitutes");
    // The declaration carries the explanation; a plain number is not repeated after an arrow.
    expect(md(0, 3)).toContain("substitutes");
    expect(md(0, 3)).toContain("= 20\n");
    expect(md(0, 3)).not.toContain("→");
    // Nothing to compute: the expression stands alone.
    expect(md(4, 3)).toContain("= @[base / 0]\n");
  });
});

describe("@ constants: completion and inlay hints", () => {
  const TEXT = [
    "@duration = 1825",
    "@cost = @[duration / 365]",
    "@label = major_gold_value",
    "e.1 = {",
    "\tdays = @dur",
    "\tgold = @[ du",
    "\tvalue = @cost # was @duration",
    "\tother = @nope",
    "}",
  ].join("\n");
  const d = TextDocument.create("file:///m/events/c.txt", "paradox", 1, TEXT);

  it("after @ offers the file's constants with their values, replacing from the @", () => {
    const list = provideConstantCompletion(d, { line: 4, character: 12 })!;
    expect(list.items.map((i) => i.label)).toEqual(["@duration", "@cost", "@label"]);
    expect(list.items[1].detail).toBe("= @[duration / 365] → 5");
    expect(list.items[0].textEdit).toEqual({
      range: { start: { line: 4, character: 8 }, end: { line: 4, character: 12 } },
      newText: "@duration",
    });
    // Inside @[ ... ] the names go bare; elsewhere the usual provider runs.
    expect(provideConstantCompletion(d, { line: 5, character: 13 })!.items[0].label).toBe("duration");
    expect(provideConstantCompletion(d, { line: 4, character: 4 })).toBeNull();
  });

  it("hints the value beside each use, never on the declaration, an unknown name or a comment", () => {
    const hints = constantHints(d, { start: { line: 0, character: 0 }, end: { line: 8, character: 0 } });
    // Line 1's operand sits inside @[ ... ] without an @: no hint there, by design.
    expect(hints.map((h) => [h.position.line, h.label])).toEqual([[6, "= 5"]]);
    // Loc files never declare constants.
    const loc = TextDocument.create("file:///m/l_english.yml", "paradox-loc", 1, TEXT);
    expect(constantHints(loc, { start: { line: 0, character: 0 }, end: { line: 8, character: 0 } })).toEqual(
      []
    );
  });
});
