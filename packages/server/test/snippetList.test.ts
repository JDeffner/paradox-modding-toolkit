/**
 * The `paradox/snippets` answer (features/snippetList.ts). The skeleton half is
 * covered by definitionSkeletons.test.ts; what is checked here is the engine
 * token half, and in particular that an example marking fields `# optional`
 * offers BOTH forms under one cap slot.
 */
import { describe, expect, it } from "vitest";
import type { TokenData } from "@px-lsp/protocol/types";
import { parseScript } from "../src/parser";
import { buildSnippetList } from "../src/features/snippetList";

const tokens: TokenData[] = [
  {
    name: "if",
    kind: "effect",
    doc: "",
    scopes: [],
    usage: "if = { limit = { <triggers> } <effects> }",
  },
  {
    // ck3 effects.log create_holy_order, with the optional fields it marks.
    name: "create_holy_order",
    kind: "effect",
    doc: "",
    scopes: [],
    usage: "create_holy_order = {\n" + "\tleader = scope:a_character\n" + "\tname = <name> #Optional\n" + "}",
  },
];

function tokenItems() {
  const text = "test.0001 = {\n\timmediate = {\n\t\t\n\t}\n}\n";
  const parse = parseScript(text);
  const offset = text.indexOf("\t\t\n") + 2;
  return buildSnippetList(parse, offset, null, undefined, tokens, { if: 100, create_holy_order: 1 }).filter(
    (s) => s.form === "token"
  );
}

describe("snippetList — engine token snippets", () => {
  it("offers a second `.full` item for a token whose example marks optional fields", () => {
    const items = tokenItems();
    expect(items.map((s) => s.id)).toEqual(["if", "create_holy_order", "create_holy_order.full"]);
    const full = items[2];
    expect(full.label).toBe("create_holy_order (all fields)");
    expect(full.detail).toBe("effect block with its optional fields, from the game's own usage example");
    expect(full.plain).toBe("create_holy_order = {\n\tleader = scope:a_character\n\tname = <name>\n}");
  });

  it("the minimal item stays the required fields only", () => {
    const minimal = tokenItems()[1];
    expect(minimal.label).toBe("create_holy_order");
    expect(minimal.plain).toBe("create_holy_order = {\n\tleader = scope:a_character\n}");
  });
});
