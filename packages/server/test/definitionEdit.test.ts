/**
 * paradox/definitionEdit over a real vanilla trait block, copied verbatim out
 * of game/common/traits/00_traits.txt (tabs, blank lines and all): the promise
 * the creators make is that a save changes the key it was asked to change and
 * nothing else, and only a real file's formatting can show that.
 *
 * Also covers the SCRIPT dialect of the span model, which is what lets the .gui
 * writer serve script at all: script has no child declarations, so every block
 * child must classify as a property.
 */
import { describe, expect, it } from "vitest";
import { computeDefinitionEdits } from "../src/creators/definitionEdit";
import { applyAll } from "../src/gui/sourceEdit";
import { parseGuiSource, SCRIPT_DIALECT } from "../src/gui/sourceModel";
import type { DefinitionOp, GuiTextEdit } from "@px-lsp/protocol/protocol";

/** game/common/traits/00_traits.txt, verbatim. */
const WAYFARER =
  "lifestyle_wayfarer = {\n" +
  "\tcategory = lifestyle\n" +
  "\n" +
  "\tdiplomacy = 2\n" +
  "\tprowess_per_prestige_level = 1\n" +
  "\tstress_loss_per_prestige_level = 0.05\n" +
  "\n" +
  "\truler_designer_cost = 50\n" +
  "}\n";

/** The same file's next trait, so an edit has a neighbour it must not touch. */
const VOYAGER =
  "lifestyle_voyager = {\n" +
  "\tcategory = lifestyle\n" +
  "\n" +
  "\tstewardship = 2\n" +
  "\tcharacter_travel_speed = 10\n" +
  "\tmonthly_prestige = 0.25\n" +
  "\tdiplomatic_range_mult = 0.15\n" +
  "\n" +
  "\truler_designer_cost = 50\n" +
  "}\n";

const FILE = "# Lifestyle traits.\n" + WAYFARER + "\n" + VOYAGER;

function run(text: string, ops: DefinitionOp[]) {
  const result = computeDefinitionEdits({ uri: "file:///traits.txt", text, ops });
  return { ...result, applied: applyAll(text, result.edits as GuiTextEdit[]) };
}

describe("definitionEdit setProperties", () => {
  it("changes one key with one edit and leaves every other byte alone", () => {
    const out = run(FILE, [
      { op: "setProperties", name: "lifestyle_wayfarer", properties: [{ key: "diplomacy", value: "4" }] },
    ]);
    expect(out.ops).toEqual([{}]);
    expect(out.edits).toHaveLength(1);
    expect(out.applied).toBe(FILE.replace("\tdiplomacy = 2\n", "\tdiplomacy = 4\n"));
  });

  it("removes a key by deleting its whole line", () => {
    const out = run(FILE, [
      {
        op: "setProperties",
        name: "lifestyle_wayfarer",
        properties: [{ key: "prowess_per_prestige_level", value: null }],
      },
    ]);
    expect(out.applied).toBe(FILE.replace("\tprowess_per_prestige_level = 1\n", ""));

    // And adds a key the block does not have, with the block's own indentation.
    const added = run(FILE, [
      {
        op: "setProperties",
        name: "lifestyle_wayfarer",
        properties: [{ key: "martial", value: "1" }],
      },
    ]);
    expect(added.applied).toBe(
      FILE.replace("}\n\nlifestyle_voyager", "\tmartial = 1\n}\n\nlifestyle_voyager")
    );
  });

  it("edits a block-valued key as a property, which is what script has", () => {
    const text = "px_t = {\n\topposites = { craven }\n}\n";
    const out = run(text, [
      { op: "setProperties", name: "px_t", properties: [{ key: "opposites", value: "{ craven lazy }" }] },
    ]);
    expect(out.applied).toBe("px_t = {\n\topposites = { craven lazy }\n}\n");
  });

  it("refuses with a reason: no block of that name, or a file that does not parse", () => {
    const missing = run(FILE, [
      { op: "setProperties", name: "no_such_trait", properties: [{ key: "martial", value: "1" }] },
    ]);
    expect(missing.edits).toEqual([]);
    expect(missing.ops[0].refused).toContain("no_such_trait");

    const broken = run("px_t = {\n\tcategory = personality\n", [
      { op: "setProperties", name: "px_t", properties: [{ key: "martial", value: "1" }] },
    ]);
    expect(broken.edits).toEqual([]);
    expect(broken.ops[0].refused).toContain("parse error");
  });
});

describe("definitionEdit upsertBlock", () => {
  it("replaces exactly the span of an existing block", () => {
    const replacement = "lifestyle_wayfarer = {\n\tcategory = lifestyle\n}";
    const out = run(FILE, [{ op: "upsertBlock", name: "lifestyle_wayfarer", text: replacement }]);
    expect(out.edits).toHaveLength(1);
    expect(out.applied).toBe("# Lifestyle traits.\n" + replacement + "\n\n" + VOYAGER);
  });

  it("appends a new block after one blank separator line, whatever the file ends with", () => {
    const block = "px_new = {\n\tcategory = personality\n}";
    expect(run(FILE, [{ op: "upsertBlock", name: "px_new", text: block }]).applied).toBe(
      FILE + "\n" + block + "\n"
    );
    // An unterminated last line is closed before the separator.
    const open = "px_a = { category = personality }";
    expect(run(open, [{ op: "upsertBlock", name: "px_b", text: "px_b = { category = fame }" }]).applied).toBe(
      open + "\n\npx_b = { category = fame }\n"
    );
    // An empty file (or one holding only its BOM) gets the block alone.
    expect(run("", [{ op: "upsertBlock", name: "px_new", text: block }]).applied).toBe(block + "\n");
    expect(run("﻿", [{ op: "upsertBlock", name: "px_new", text: block }]).applied).toBe("﻿" + block + "\n");
  });

  it("writes the file's own newline style", () => {
    const crlf = FILE.replace(/\n/g, "\r\n");
    const out = run(crlf, [{ op: "upsertBlock", name: "px_new", text: "px_new = {\n\tmartial = 1\n}" }]);
    expect(out.applied).toBe(crlf + "\r\npx_new = {\r\n\tmartial = 1\r\n}\r\n");
  });

  it("appends several blocks as ONE edit, in the order they were asked for", () => {
    // The Legacy Creator sends one op per new perk. Zero-width edits at the
    // same offset have no order of their own, so they are grown into one.
    const perks = ["px_perk_1", "px_perk_2", "px_perk_3"];
    const out = run(
      FILE,
      perks.map((name) => ({ op: "upsertBlock" as const, name, text: `${name} = {\n\tmartial = 1\n}` }))
    );
    expect(out.ops).toEqual([{}, {}, {}]);
    expect(out.edits).toHaveLength(1);
    expect(out.applied).toBe(FILE + perks.map((name) => `\n${name} = {\n\tmartial = 1\n}\n`).join(""));
  });

  it("refuses an upsert with no name or no block text", () => {
    const out = run(FILE, [
      { op: "upsertBlock", name: "", text: "x = {}" },
      { op: "upsertBlock", name: "px_new", text: "  " },
    ]);
    expect(out.edits).toEqual([]);
    expect(out.ops.map((o) => Boolean(o.refused))).toEqual([true, true]);
  });
});

describe("script dialect of the span model", () => {
  it("classifies every block child of a definition as a property", () => {
    const text =
      "px_t = {\n" +
      "\tcategory = personality\n" +
      "\topposites = { craven }\n" +
      "\tculture_modifier = {\n\t\tparameter = p\n\t}\n" +
      "\tdesc = {\n\t\tfirst_valid = { desc = k }\n\t}\n" +
      "}\n";
    const file = parseGuiSource(text, SCRIPT_DIALECT);
    expect(file.errors).toEqual([]);
    expect(file.entries.every((e) => e.kind === "property")).toBe(true);
    expect(file.root.children).toEqual([]);

    // And reads no declaration markers or slot forms out of script: `type` and
    // `blockoverride` are ordinary script words, not .gui markers.
    const words = parseGuiSource("px_t = {\n\ttype = character_event\n}\ntemplate = 3\n", SCRIPT_DIALECT);
    expect(words.entries.map((e) => e.marker)).toEqual([null, null, null]);
    expect(words.root.entries.map((e) => e.key)).toEqual(["px_t", "template"]);
  });
});
