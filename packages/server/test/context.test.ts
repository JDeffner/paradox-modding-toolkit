import { describe, expect, it } from "vitest";
import { detectContext } from "../src/context";

/** Helper: context at the position of the `|` marker in the snippet. */
function ctxAt(snippet: string) {
  const offset = snippet.indexOf("|");
  if (offset < 0) throw new Error("snippet needs a | marker");
  return detectContext(snippet.replace("|", ""), offset);
}

describe("detectContext", () => {
  it("reports trigger context inside trigger = { }", () => {
    expect(ctxAt("my_event.1 = {\n\ttrigger = {\n\t\t|\n\t}\n}")).toEqual({
      context: "trigger",
      keyword: "trigger",
    });
  });

  it("reports effect context inside immediate = { }", () => {
    expect(ctxAt("my_event.1 = {\n\timmediate = {\n\t\t|\n\t}\n}")).toEqual({
      context: "effect",
      keyword: "immediate",
    });
  });

  it("reports unknown at top level", () => {
    expect(ctxAt("|").context).toBe("unknown");
    expect(ctxAt("my_effect = { x = 1 }\n|").context).toBe("unknown");
  });

  it("limit inside an effect iterator is trigger context", () => {
    expect(ctxAt("immediate = {\n\tevery_child = {\n\t\tlimit = {\n\t\t\t|\n\t\t}\n\t}\n}").context).toBe(
      "trigger"
    );
  });

  it("effect iterator body after the limit block is effect context", () => {
    expect(
      ctxAt("immediate = {\n\tevery_child = {\n\t\tlimit = { is_adult = yes }\n\t\t|\n\t}\n}").context
    ).toBe("effect");
  });

  it("any_ iterators are trigger context", () => {
    expect(ctxAt("trigger = {\n\tany_courtier = {\n\t\t|\n\t}\n}").context).toBe("trigger");
  });

  it("walks through transparent blocks (NOT, if, scope changes)", () => {
    expect(ctxAt("trigger = {\n\tNOT = {\n\t\t|\n\t}\n}").context).toBe("trigger");
    expect(ctxAt("effect = {\n\tif = {\n\t\t|\n\t}\n}").context).toBe("effect");
    expect(ctxAt("effect = {\n\tscope:target = {\n\t\t|\n\t}\n}").context).toBe("effect");
  });

  it("unrecognized enclosing keyword yields unknown (never hide when unsure)", () => {
    expect(ctxAt("weird_custom_block = {\n\t|\n}").context).toBe("unknown");
  });

  it("math keys opening a block yield value context anywhere", () => {
    // Script-value math embedded in an effect argument.
    expect(ctxAt("immediate = {\n\tadd_gold = {\n\t\tvalue = {\n\t\t\t|\n\t\t}\n\t}\n}").context).toBe(
      "value"
    );
    expect(ctxAt("ai_will_do = {\n\tadd = {\n\t\t|\n\t}\n}").context).toBe("value");
    // limit inside math-if switches back to trigger grammar.
    expect(
      ctxAt("some_weight = {\n\tadd = {\n\t\tif = {\n\t\t\tlimit = {\n\t\t\t\t|\n\t\t\t}\n\t\t}\n\t}\n}")
        .context
    ).toBe("trigger");
  });

  it("handles the brace on the next line", () => {
    expect(ctxAt("trigger =\n{\n\t|\n}").context).toBe("trigger");
  });

  it("ignores braces in strings and comments", () => {
    expect(ctxAt('effect = {\n\tset_name = "weird } name" # } comment\n\t|\n}').context).toBe("effect");
  });

  it("option blocks are effect context", () => {
    expect(ctxAt("option = {\n\tname = my.1.a\n\t|\n}").context).toBe("effect");
  });

  it("on_X blocks are effect context by naming convention", () => {
    expect(ctxAt("on_auto_accept = {\n\t|\n}").context).toBe("effect");
    expect(ctxAt("on_intermediary_accept = {\n\t|\n}").context).toBe("effect");
  });

  it("on_actions lists names, not effects — stays unknown", () => {
    expect(ctxAt("on_actions = {\n\t|\n}").context).toBe("unknown");
  });

  it("X_trigger blocks are trigger context by naming convention", () => {
    expect(ctxAt("cancellation_trigger = {\n\t|\n}").context).toBe("trigger");
    expect(ctxAt("my_mod_valid_trigger = {\n\t|\n}").context).toBe("trigger");
  });

  it("ai_chance blocks are value context", () => {
    expect(ctxAt("option = {\n\tai_chance = {\n\t\t|\n\t}\n}").context).toBe("value");
    expect(ctxAt("ai_will_do = {\n\t|\n}").context).toBe("value");
  });
});
