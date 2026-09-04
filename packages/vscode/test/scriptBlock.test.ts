/**
 * The one block scanner the three creator apps read and write their definition
 * with. The creators' own suites cover their forms; this one pins the parts
 * they all lean on, on the inputs a real file actually holds: nested braces, a
 * comment where a statement could be, a quoted key, CRLF, an empty body.
 */
import { describe, expect, it } from "vitest";
import {
  changedProperties,
  firstValues,
  locKeyFor,
  parseBlock,
  quoteIfNeeded,
  readNumberRows,
  readTokenList,
  scanItems,
  writeBlock,
} from "../src/webviews/shared/scriptBlock";

describe("scanning a block body", () => {
  it("reports each statement with the span it came from", () => {
    const body = "\n\tcategory = personality\n\tmartial = 2\n";
    expect(scanItems(body).map((item) => [item.key, item.op, item.value, item.block])).toEqual([
      ["category", "=", "personality", false],
      ["martial", "=", "2", false],
    ]);
    const first = scanItems(body)[0];
    expect(body.slice(first.start, first.end)).toBe("category = personality");
    // A quoted key and a quoted value are one token each.
    const quoted = scanItems('"my key" = "a name"');
    expect(quoted[0].key).toBe('"my key"');
    expect(quoted[0].value).toBe('"a name"');
  });

  it("takes a nested block whole, braces balanced", () => {
    const items = scanItems("desc = {\n\tfirst_valid = {\n\t\tdesc = trait_x_desc\n\t}\n}");
    expect(items).toHaveLength(1);
    expect(items[0].block).toBe(true);
    expect(items[0].value).toBe("{\n\tfirst_valid = {\n\t\tdesc = trait_x_desc\n\t}\n}");
  });

  it("treats a comment as trivia, inside a value as well as between statements", () => {
    const items = scanItems("# a note\n\tdesc = { # why\n\t\tx = 1\n\t}\n\t# trailing");
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("desc");
    expect(items[0].value).toBe("{ # why\n\t\tx = 1\n\t}");
  });

  it("keeps the file's own line ending and indentation, and binds a repeated key to its first value", () => {
    const block = parseBlock("px_x = {\r\n\ta = 1\r\n}")!;
    expect(block.eol).toBe("\r\n");
    expect(block.indent).toBe("\t");
    expect(block.items.map((item) => item.value)).toEqual(["1"]);
    const repeated = parseBlock("px_x = {\n\tflag = one\n\tflag = two\n}")!;
    expect(firstValues(repeated).get("flag")).toBe("one");
  });

  it("reads an empty body as no statements and writes it back unchanged", () => {
    const block = parseBlock("px_x = {\n}")!;
    expect(block.items).toEqual([]);
    expect(writeBlock(block.name, block, [])).toBe("px_x = {\n}");
  });
});

describe("reading a value the way a widget needs it", () => {
  it("reads a list, or `key = number` rows, only when EVERY entry is of that shape", () => {
    // A widget that cannot hold the whole value must not hold half of it.
    expect(readTokenList("{ craven ambitious }")).toEqual(["craven", "ambitious"]);
    expect(readTokenList("{ craven = 2 }")).toBeNull();
    expect(readTokenList("craven")).toBeNull();
    expect(readNumberRows("{\n\tbrave = 20\n\tdrunkard = -5\n}")).toEqual([
      { name: "brave", value: 20 },
      { name: "drunkard", value: -5 },
    ]);
    expect(readNumberRows("{ brave = @pos_compat_high }")).toBeNull();
    expect(readNumberRows("{ }")).toBeNull();
  });

  it("quotes a scalar only when the engine needs the quotes", () => {
    expect(quoteIfNeeded("reveler.dds")).toBe("reveler.dds");
    expect(quoteIfNeeded("two words")).toBe('"two words"');
  });
});

describe("changedProperties", () => {
  it("reports the keys whose value moved, and null for a key now cleared", () => {
    const before = new Map<string, string | null>([
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ]);
    const after = new Map<string, string | null>([
      ["a", "1"],
      ["b", "9"],
      ["c", null],
      ["d", "4"],
    ]);
    expect(changedProperties(before, after)).toEqual([
      { key: "b", value: "9" },
      { key: "c", value: null },
      { key: "d", value: "4" },
    ]);
    // A form nobody touched reports nothing at all.
    expect(changedProperties(before, new Map(before))).toEqual([]);
  });
});

describe("locKeyFor", () => {
  it("fills every `$` of the pattern with the definition's own name", () => {
    expect(locKeyFor("$_name", "blood_legacy_track")).toBe("blood_legacy_track_name");
    expect(locKeyFor("$", "px_stoic")).toBe("px_stoic");
    expect(locKeyFor("trait_$_desc", "px_stoic")).toBe("trait_px_stoic_desc");
  });
});

/**
 * game/common/traits/00_traits.txt, verbatim (the same block traitScript.test
 * loads through the trait form). Here it only has to prove the mechanics: a
 * comment after an opening brace, a `desc` no widget could hold, tabs and
 * blank lines all come back untouched when no write claims them.
 */
const CONCUBINE =
  "child_of_concubine_female = {\n" +
  "\tcategory = fame\n" +
  "\tgroup = child_of_concubine\n" +
  "\tlevel = 1\n" +
  "\topposites = {\n" +
  "\t\tbastard\n" +
  "\t\tlegitimized_bastard\n" +
  "\t\twild_oat\n" +
  "\t}\n" +
  "\tdiplomacy = -1\n" +
  "\t\n" +
  "\tshown_in_ruler_designer = no\n" +
  "\n" +
  "\tname = trait_child_of_concubine\n" +
  "\tdesc = { # mother was a concubine (at time of birth)\n" +
  "\t\tfirst_valid = {\n" +
  "\t\t\ttriggered_desc = {\n" +
  "\t\t\t\ttrigger = {\n" +
  "\t\t\t\t\tNOT = { exists = this }\n" +
  "\t\t\t\t}\n" +
  "\t\t\t\tdesc = trait_child_of_concubine_desc\n" +
  "\t\t\t}\n" +
  "\t\t\tdesc = trait_child_of_concubine_character_desc\n" +
  "\t\t}\n" +
  "\t}\n" +
  "\ticon = child_of_concubine.dds\n" +
  "\n" +
  "\tai_energy = 15\n" +
  "}\n";

describe("a vanilla block round trip", () => {
  it("gives the block back byte for byte, and rewrites one statement by copying every other span", () => {
    const block = parseBlock(CONCUBINE)!;
    expect(block.name).toBe("child_of_concubine_female");
    expect(writeBlock(block.name, block, [])).toBe(CONCUBINE);
    const out = writeBlock(block.name, block, [
      { key: "diplomacy", lines: ["diplomacy = -2"], changed: true },
    ]);
    expect(out).toBe(CONCUBINE.replace("\tdiplomacy = -1\n", "\tdiplomacy = -2\n"));
  });
});
