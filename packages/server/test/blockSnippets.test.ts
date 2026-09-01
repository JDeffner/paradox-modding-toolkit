/**
 * The guarded `usage:` extractor (features/blockSnippets.ts). Every fixture is
 * a verbatim example out of a shipped script_docs dump, because the whole
 * point of the guards is that they hold against what the games actually dump —
 * two dialects with different shapes, both accepted and rejected here.
 *
 * A wrong template is the failure mode to fear (it teaches a shape the engine
 * rejects), so the reject half of this table matters more than the accept half.
 */
import { describe, expect, it } from "vitest";
import type { TokenData } from "@px-lsp/protocol/types";
import { blockTemplateFor, extractBlockTemplate } from "../src/features/blockSnippets";

describe("blockSnippets — accepted examples", () => {
  it("renders a control-flow block with its placeholders as tabstops", () => {
    const t = extractBlockTemplate("if", "if = { limit = { <triggers> } <effects> }")!;
    expect(t.snippet).toBe("if = {\n\tlimit = {\n\t\t${1:triggers}\n\t}\n\t${2:effects}\n}");
    expect(t.plain).toBe("if = {\n\tlimit = {\n\t\t<triggers>\n\t}\n\t<effects>\n}");
  });

  it("keeps the loop form too (both control-flow tokens clear the guards)", () => {
    const t = extractBlockTemplate("while", "while = { limit = { <triggers> } <effects> }")!;
    expect(t.snippet).toBe("while = {\n\tlimit = {\n\t\t${1:triggers}\n\t}\n\t${2:effects}\n}");
  });

  it("iterators: the dump's canonical limit/effects pair", () => {
    const t = extractBlockTemplate(
      "every_activity",
      "every_activity = { limit = { <triggers> } <effects> }"
    )!;
    expect(t.plain).toBe("every_activity = {\n\tlimit = {\n\t\t<triggers>\n\t}\n\t<effects>\n}");
  });

  it("concrete example values become PRE-FILLED tabstops, keys stay literal", () => {
    // vic3 effects.log, markdown dialect.
    const t = extractBlockTemplate(
      "add_acceptance",
      "add_acceptance = { culture = cu:romanian value = -10 }"
    )!;
    expect(t.snippet).toBe("add_acceptance = {\n\tculture = ${1:cu:romanian}\n\tvalue = ${2:-10}\n}");
    expect(t.plain).toBe("add_acceptance = {\n\tculture = cu:romanian\n\tvalue = -10\n}");
  });

  it("multi-line examples with angle-bracket values (the other dump dialect)", () => {
    const t = extractBlockTemplate(
      "add_radicals",
      "add_radicals = {\n\tvalue = 0.2\n\tinterest_group = <scope/ig:key>\n\tstrata = <key>\n}"
    )!;
    expect(t.snippet).toBe(
      "add_radicals = {\n\tvalue = ${1:0.2}\n\tinterest_group = ${2:scope/ig:key}\n\tstrata = ${3:key}\n}"
    );
    expect(t.plain).toBe(
      "add_radicals = {\n\tvalue = 0.2\n\tinterest_group = <scope/ig:key>\n\tstrata = <key>\n}"
    );
  });

  it("an `a/b/c` key becomes a choice tabstop, first alternative in plain mode", () => {
    const t = extractBlockTemplate(
      "add_to_variable_list",
      "add_to_variable_list = { name = X target = Y days/weeks/months/years = Z }"
    )!;
    expect(t.snippet).toContain("${3|days,weeks,months,years|} = ${4:Z}");
    expect(t.plain).toContain("days = Z");
  });

  it("`(optional)` truncates the body and leaves one trailing tabstop", () => {
    const t = extractBlockTemplate(
      "random_living_character",
      "random_living_character = { limit = { <triggers> } (optional) weight = { mtth } <effects> }"
    )!;
    expect(t.snippet).toBe("random_living_character = {\n\tlimit = {\n\t\t${1:triggers}\n\t}\n\t$2\n}");
    // Nothing meaningful to write at a truncation point in plain text.
    expect(t.plain).toBe("random_living_character = {\n\tlimit = {\n\t\t<triggers>\n\t}\n}");
  });

  it("no accepted template ever leaks `${` into its plain form", () => {
    for (const [name, usage] of [
      ["if", "if = { limit = { <triggers> } <effects> }"],
      ["add_acceptance", "add_acceptance = { culture = cu:romanian value = -10 }"],
      ["clamp_variable", "clamp_variable = { name = X max = Y min = Z }"],
    ] as Array<[string, string]>) {
      expect(extractBlockTemplate(name, usage)!.plain).not.toContain("${");
    }
  });
});

describe("blockSnippets — rejected examples (null beats a guess)", () => {
  const rejected: Array<[label: string, name: string, usage: string | undefined]> = [
    ["no usage at all", "add_gold", undefined],
    ["the example is not a block", "add_title_law", "add_title_law = princely_elective_succession_law"],
    [
      "the example names a DIFFERENT effect",
      "add_title_law_effects",
      "add_title_law = princely_elective_succession_law",
    ],
    [
      "the example names a different effect (markdown dialect)",
      "add_loyalists",
      "add_radicals = {\n\tvalue = 0.2\n\tinterest_group = <scope/ig:key>\n}",
    ],
    [
      "pseudo-keys in a weight list",
      "random_list",
      "random_list = { X1 = { trigger = { x } modifier = Y1 effect1 } X2 = { trigger = { x } modifier = Y2 effect2 } ... }",
    ],
    [
      "the dump never closes the block",
      "switch",
      "switch = {\n\ttrigger = simple_assign_trigger\n\tcase_1 = { <effects> }\n\tfallback = { <effects> }",
    ],
    [
      "`#` comments enumerate mutually exclusive forms",
      "trigger_event",
      "trigger_event = {\n\tid = <event ID>   # or:\n\ton_action = <on_action name>\n}",
    ],
    ["a comparison, not an assignment", "monthly_income", "monthly_income > 10"],
    ["a key we cannot name", "some_effect", "some_effect = { <key> = 1 }"],
    ["a bare word that is not a placeholder", "some_effect", "some_effect = { limit = { x } effects }"],
    ["something follows the block", "some_effect", "some_effect = { a = 1 } trailing"],
    ["an uppercase key", "some_effect", "some_effect = { Name = X }"],
  ];

  for (const [label, name, usage] of rejected) {
    it(label, () => {
      expect(extractBlockTemplate(name, usage)).toBeNull();
    });
  }
});

describe("blockSnippets — memoization", () => {
  it("returns the identical object for the same token (the completion loop is hot)", () => {
    const token: TokenData = {
      name: "if",
      kind: "effect",
      doc: "",
      scopes: [],
      usage: "if = { limit = { <triggers> } <effects> }",
    };
    const first = blockTemplateFor(token);
    expect(first).not.toBeNull();
    expect(blockTemplateFor(token)).toBe(first);
  });

  it("caches the null verdict too", () => {
    const token: TokenData = { name: "add_gold", kind: "effect", doc: "", scopes: [] };
    expect(blockTemplateFor(token)).toBeNull();
    expect(blockTemplateFor(token)).toBeNull();
  });
});
