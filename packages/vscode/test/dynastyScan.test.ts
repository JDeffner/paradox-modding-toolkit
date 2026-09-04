/**
 * Reading blocks back out of a script file, and what the Dynasty Tree does
 * with a DNA off the clipboard. The load-bearing cases: a scan must not be
 * fooled by a brace inside a comment or a string, and a paste must never take
 * a key that is already somebody's portrait.
 */
import { describe, expect, it } from "vitest";
import { dnaPasteBlock, parseDnaPaste, scanBlocks, uniqueKey } from "../src/webviews/dynastyTree/scan";

describe("scanBlocks", () => {
  it("finds every top-level block with its offsets", () => {
    const text = "a = {\n\tx = 1\n}\n\nb = {\n\ty = { z = 2 }\n}\n";
    const blocks = scanBlocks(text);
    expect([...blocks.keys()]).toEqual(["a", "b"]);
    expect(blocks.get("a")!.text).toBe("a = {\n\tx = 1\n}");
    expect(text.slice(blocks.get("b")!.start, blocks.get("b")!.end)).toBe(blocks.get("b")!.text);
  });

  it("ignores braces inside comments and quoted values", () => {
    const text = '# a = { not a block\nreal = {\n\tname = "} still inside {"\n\t# }\n}\n';
    const blocks = scanBlocks(text);
    expect([...blocks.keys()]).toEqual(["real"]);
    expect(blocks.get("real")!.text.endsWith("}")).toBe(true);
  });

  it("keeps the last block of a repeated key, the way the engine does", () => {
    const blocks = scanBlocks("dup = {\n\tx = 1\n}\ndup = {\n\tx = 2\n}\n");
    expect(blocks.get("dup")!.text).toContain("x = 2");
  });

  it("survives a file that ends mid-block", () => {
    expect([...scanBlocks("open = {\n\tx = 1\n").keys()]).toEqual([]);
  });
});

describe("uniqueKey", () => {
  it("takes the name when nothing has it", () => {
    expect(uniqueKey("eadgar_dna", new Set())).toBe("eadgar_dna");
  });

  it("suffixes rather than replacing a portrait that is already there", () => {
    expect(uniqueKey("eadgar_dna", new Set(["eadgar_dna"]))).toBe("eadgar_dna_2");
    expect(uniqueKey("eadgar_dna", new Set(["eadgar_dna", "eadgar_dna_2"]))).toBe("eadgar_dna_3");
  });
});

describe("parseDnaPaste", () => {
  const genes = "genes={ hair_color={ 1 2 3 4 } }";

  it("reads a whole definition the portrait editor copied", () => {
    const paste = parseDnaPaste(
      `bookmark_guy = {\n\tportrait_info = {\n\t\t${genes}\n\t}\n\tenabled = yes\n}`
    );
    expect(paste).toMatchObject({ kind: "block", key: "bookmark_guy" });
    expect(paste && "body" in paste && paste.body.startsWith("{")).toBe(true);
  });

  it("reads a bare portrait_info half", () => {
    const paste = parseDnaPaste(`portrait_info = {\n\t${genes}\n}`);
    expect(paste?.kind).toBe("portrait");
  });

  it("reads a bare name as a name", () => {
    expect(parseDnaPaste("  eadgar_dna \n")).toEqual({ kind: "name", name: "eadgar_dna" });
  });

  it("says no to prose and to nothing", () => {
    expect(parseDnaPaste("copy this into the game")).toBeNull();
    expect(parseDnaPaste("   ")).toBeNull();
  });
});

describe("dnaPasteBlock", () => {
  it("keeps a copied block's body verbatim under the key it is given", () => {
    const paste = parseDnaPaste("guy = {\n\tportrait_info = { genes={ } }\n}")!;
    expect(dnaPasteBlock("eadgar_dna_2", paste)).toBe("eadgar_dna_2 = {\n\tportrait_info = { genes={ } }\n}");
  });

  it("wraps a bare portrait_info in a block of its own", () => {
    const paste = parseDnaPaste("portrait_info = {\n\tgenes={ }\n}")!;
    expect(dnaPasteBlock("eadgar_dna", paste)).toBe(
      "eadgar_dna = {\n\tportrait_info = {\n\t\tgenes={ }\n\t}\n}"
    );
  });

  it("writes nothing for a bare name: there is no block to write", () => {
    expect(dnaPasteBlock("x", { kind: "name", name: "x" })).toBeNull();
  });
});
