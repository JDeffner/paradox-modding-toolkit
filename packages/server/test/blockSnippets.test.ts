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

describe("blockSnippets — `# optional` fields yield a minimal AND an all-fields form", () => {
  // ck3 effects.log, verbatim (mixed spaces and tabs included). The entry has
  // no `usage:` header; docsParser follows such an example until its braces
  // balance, so this is exactly what the extractor is handed.
  const createHolyOrder =
    "create_holy_order = {\n" +
    "    leader = scope:a_character\n" +
    "    capital = scope:a_barony_title\n" +
    "\t  name = <name> #Optional\n" +
    "\t  coat_of_arms = <coa_name> #Optional\n" +
    "    save_scope_as/save_temporary_scope_as = new_holy_order # optional way to get a reference to the new holy order\n" +
    "}";

  it("the minimal form keeps only the fields the example did not call optional", () => {
    const t = extractBlockTemplate("create_holy_order", createHolyOrder)!;
    expect(t.plain).toBe(
      "create_holy_order = {\n\tleader = scope:a_character\n\tcapital = scope:a_barony_title\n}"
    );
    expect(t.snippet).toBe(
      "create_holy_order = {\n\tleader = ${1:scope:a_character}\n\tcapital = ${2:scope:a_barony_title}\n}"
    );
  });

  it("the all-fields form carries every field, numbering its tabstops afresh", () => {
    const t = extractBlockTemplate("create_holy_order", createHolyOrder)!;
    expect(t.full!.snippet).toBe(
      "create_holy_order = {\n" +
        "\tleader = ${1:scope:a_character}\n" +
        "\tcapital = ${2:scope:a_barony_title}\n" +
        "\tname = ${3:name}\n" +
        "\tcoat_of_arms = ${4:coa_name}\n" +
        "\t${5|save_scope_as,save_temporary_scope_as|} = ${6:new_holy_order}\n" +
        "}"
    );
    expect(t.full!.plain).toBe(
      "create_holy_order = {\n" +
        "\tleader = scope:a_character\n" +
        "\tcapital = scope:a_barony_title\n" +
        "\tname = <name>\n" +
        "\tcoat_of_arms = <coa_name>\n" +
        "\tsave_scope_as = new_holy_order\n" +
        "}"
    );
  });

  it("a wrapped `# Optional, …` note is dropped with the comment it continues", () => {
    // ck3 effects.log change_title_holder: its two optional fields carry a note
    // that runs on over two more comment-only lines. (The dump's own header
    // line reads `change_title_holder -  = {` and never closes the block, so
    // the wrapper is spelled out here; the body is verbatim.)
    const t = extractBlockTemplate(
      "change_title_holder",
      "change_title_holder = {\n" +
        "holder = Character\n" +
        "change = title_and_vassal_change\n" +
        "take_baronies = yes # Optional; if set, will cause baronies to be taken (rather than vassalized) as well if this title is a county\n" +
        "government_base = character # Optional, if the character getting the title was unlanded, their new government\n" +
        "                            # will be based on the government of government_base.\n" +
        "                            # If no government_base is specified, the government will be based on holder's government.\n" +
        "}"
    )!;
    expect(t.plain).toBe(
      "change_title_holder = {\n\tholder = Character\n\tchange = title_and_vassal_change\n}"
    );
    expect(t.full!.plain).toBe(
      "change_title_holder = {\n" +
        "\tholder = Character\n" +
        "\tchange = title_and_vassal_change\n" +
        "\ttake_baronies = yes\n" +
        "\tgovernment_base = character\n" +
        "}"
    );
  });

  it("an all-optional body still leaves the minimal form a tabstop to land on", () => {
    const t = extractBlockTemplate("x", "x = {\n\ta = 1 # optional\n}")!;
    expect(t.snippet).toBe("x = {\n\t$1\n}");
    expect(t.plain).toBe("x = {\n}");
    expect(t.full!.plain).toBe("x = {\n\ta = 1\n}");
  });

  it("a `<scope> = { … }` wrapper is peeled off, the template starts at the token", () => {
    // ck3 effects.log create_cadet_branch, verbatim `usage:` body: the example
    // shows the scope the effect has to run in, which is not part of what the
    // modder types.
    const t = extractBlockTemplate(
      "create_cadet_branch",
      "<founding character> = {\n" +
        "\tcreate_cadet_branch = {\n" +
        "\t\tname = <dynamic_description> # optional\n" +
        "\t\tcoat_of_arms = <coa key> # optional\n" +
        "\t\tspread_to_descendants = <yes/no> # optional, default: yes\n" +
        "\t\tsave_scope_as = <name>\n" +
        "\t}\n" +
        "}"
    )!;
    expect(t.plain).toBe("create_cadet_branch = {\n\tsave_scope_as = <name>\n}");
    expect(t.full!.plain).toBe(
      "create_cadet_branch = {\n" +
        "\tname = <dynamic_description>\n" +
        "\tcoat_of_arms = <coa key>\n" +
        "\tspread_to_descendants = <yes/no>\n" +
        "\tsave_scope_as = <name>\n" +
        "}"
    );
  });

  it("an example with no optional field carries no all-fields form", () => {
    expect(
      extractBlockTemplate("clamp_variable", "clamp_variable = { name = X max = Y min = Z }")!.full
    ).toBeUndefined();
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
    [
      "a `#` comment that explains rather than marks optional (ck3 effects.log)",
      "vassal_contract_set_obligation_level",
      "vassal_contract_set_obligation_level = { type = name level = 1 } # index to obligation level",
    ],
    [
      "a comment on a line of its own marks no field",
      "some_effect",
      "some_effect = {\n\ta = 1\n\t# optional effects go here\n}",
    ],
    [
      "an optional comment on the line that only OPENS a nested block",
      "some_effect",
      "some_effect = {\n\tinner = { # optional, several can be given\n\t\ta = 1\n\t}\n}",
    ],
    ["a comparison, not an assignment", "monthly_income", "monthly_income > 10"],
    ["a key we cannot name", "some_effect", "some_effect = { <key> = 1 }"],
    [
      "a scope wrapper holding more than the token's own block",
      "some_effect",
      "<scope> = {\n\tsome_effect = { a = 1 }\n\tother_effect = { b = 2 }\n}",
    ],
    [
      "a scope wrapper holding a DIFFERENT effect",
      "some_effect",
      "<scope> = {\n\tother_effect = { a = 1 }\n}",
    ],
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
