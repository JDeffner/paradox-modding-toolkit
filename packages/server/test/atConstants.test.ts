import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { constantRefAt, provideConstantDefinition, provideConstantHover } from "../src/features/atConstants";
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
