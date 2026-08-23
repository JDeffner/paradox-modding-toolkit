/**
 * The simulator's script highlighting. Two rules carry the whole thing: a word
 * is a KEY only when an operator follows it (otherwise a bare list entry would
 * paint like a key), and every character of the line lands in exactly one
 * token, so the rendered row is the source row.
 */
import { describe, expect, it } from "vitest";
import { tokenizeScriptLine } from "../src/webviews/eventGraph/tokenize";

const kinds = (line: string): string[] =>
  tokenizeScriptLine(line)
    .filter((t) => t.text.trim() !== "")
    .map((t) => `${t.kind}:${t.text}`);

describe("tokenizeScriptLine", () => {
  it("reproduces the line exactly, whitespace included", () => {
    for (const line of ['  name = "a b"', "\tadd_gold = 10", "} # done", "", "   "]) {
      expect(
        tokenizeScriptLine(line)
          .map((t) => t.text)
          .join("")
      ).toBe(line);
    }
  });

  it("separates keys, operators, numbers, booleans and strings", () => {
    expect(kinds("add_gold = 10")).toEqual(["key:add_gold", "op:=", "number:10"]);
    expect(kinds("is_adult = yes")).toEqual(["key:is_adult", "op:=", "bool:yes"]);
    expect(kinds('name = "A Gift"')).toEqual(["key:name", "op:=", 'string:"A Gift"']);
    expect(kinds("gold >= my_value")).toEqual(["key:gold", "op:>=", "text:my_value"]);
  });

  it("does not call a bare list entry a key", () => {
    expect(kinds("events = {")).toEqual(["key:events", "op:=", "brace:{"]);
    expect(kinds("  det.2")).toEqual(["text:det.2"]);
  });

  it("takes a comment to the end of the line and tolerates an unclosed quote", () => {
    expect(kinds("add_gold = 10 # a gift")).toEqual([
      "key:add_gold",
      "op:=",
      "number:10",
      "comment:# a gift",
    ]);
    expect(kinds('name = "unclosed')).toEqual(["key:name", "op:=", 'string:"unclosed']);
  });
});
