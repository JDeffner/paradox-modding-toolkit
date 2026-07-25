import { describe, expect, it } from "vitest";
import * as path from "path";
import { LazyReferenceScanner, scanContent } from "../src/index/lazyRefs";
import type { Reference } from "@px-lsp/protocol/types";

const GAME = path.join(__dirname, "fixtures", "game");

function scanner(isEngineToken?: (name: string) => boolean) {
  const s = new LazyReferenceScanner();
  s.setRoots([{ root: GAME, source: "vanilla" }], isEngineToken);
  return s;
}

describe("scanContent", () => {
  const hits = (content: string, name: string) => {
    const out: Reference[] = [];
    scanContent(content, name, "f.txt", out);
    return out;
  };

  it("matches exact tokens only, with the name's range", () => {
    const text = "e = {\n\tadd_prestige = tiny_loss\n\thas_trait = tiny_loss_x\n}\n";
    const out = hits(text, "tiny_loss");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ line: 1, startChar: 16, endChar: 25 });
  });

  it("dots and dashes are identifier characters (loc keys, event ids)", () => {
    expect(hits("\ttitle = vanilla_ev.1.t\n", "vanilla_ev.1")).toHaveLength(0);
    expect(hits("\ttitle = vanilla_ev.1.t\n", "vanilla_ev.1.t")).toHaveLength(1);
  });

  it("skips comments and column-0 definition sites", () => {
    const text = "my_value = {\n\tx = my_value # my_value again\n}\n";
    const out = hits(text, "my_value");
    expect(out).toHaveLength(1);
    expect(out[0].line).toBe(1);
  });
});

describe("LazyReferenceScanner", () => {
  it("finds usage sites in un-indexed (vanilla) roots on demand", async () => {
    const refs = await scanner().lookup("vanilla_ev.1.t");
    expect(refs.length).toBeGreaterThan(0);
    expect(refs[0].file).toContain(path.join("game", "events"));
  });

  it("returns nothing for degenerate, keyword or engine-token names", async () => {
    const s = scanner((name) => name === "add_gold");
    expect(await s.lookup("x")).toEqual([]); // too short
    expect(await s.lookup("bad name")).toEqual([]); // not an identifier
    expect(await s.lookup("trigger")).toEqual([]); // grammar keyword
    expect(await s.lookup("add_gold")).toEqual([]); // engine token
  });

  it("memoizes per name and forgets on setRoots", async () => {
    const s = scanner();
    const first = s.lookup("vanilla_ev.1.t");
    const second = s.lookup("vanilla_ev.1.t");
    expect(second).toBe(first); // same promise: no rescan
    s.setRoots([{ root: GAME, source: "vanilla" }]);
    expect(s.lookup("vanilla_ev.1.t")).not.toBe(first);
  });

  it("is empty when no roots are configured", async () => {
    const s = new LazyReferenceScanner();
    expect(await s.lookup("vanilla_ev.1.t")).toEqual([]);
  });
});
