/**
 * Engine defines harvest (server/src/data/defines.ts): namespace/constant/value
 * extraction, layer override (jomini shadowed by game), nested block values, and
 * the `define:NS|CONST` hover card.
 */
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DefinesIndex } from "../src/data/defines";
import { ServerData } from "../src/serverData";
import { provideHover } from "../src/features/hover";

const JOMINI = "F:/game/../jomini/common/defines/00_defines.txt";
const GAME = "F:/game/common/defines/00_defines.txt";

describe("defines harvest", () => {
  it("extracts namespaces, constants and scalar values", () => {
    const idx = new DefinesIndex();
    idx.harvestText(
      `NGame = {\n\tEND_DATE = "1453.1.1"\n\tSTART_GOLD = 100\n}\nNCharacter = {\n\tMAX_STRESS_LEVEL = 3\n}`,
      GAME,
      "game"
    );
    expect(idx.namespaces()).toEqual(["NCharacter", "NGame"]);
    const consts = idx.constants("NGame");
    expect(consts.map((c) => c.name)).toEqual(["END_DATE", "START_GOLD"]);
    expect(idx.resolve("NGame", "END_DATE")!.winner.value).toBe('"1453.1.1"');
    expect(idx.resolve("NGame", "START_GOLD")!.winner.value).toBe("100");
    expect(idx.resolve("NCharacter", "MAX_STRESS_LEVEL")!.winner.value).toBe("3");
  });

  it("records the line and layer of a constant", () => {
    const idx = new DefinesIndex();
    idx.harvestText(`NGame = {\n\tEND_DATE = "1453.1.1"\n}`, GAME, "game");
    const e = idx.resolve("NGame", "END_DATE")!.winner;
    expect(e.line).toBe(1);
    expect(e.layer).toBe("game");
    expect(e.file).toBe(GAME);
  });

  it("last-wins across layers and reports the shadowed lower layers", () => {
    const idx = new DefinesIndex();
    // Harvested out of priority order to prove the sort, not insertion order.
    idx.harvestText(`NGame = {\n\tSPEED = 5\n}`, GAME, "game");
    idx.harvestText(`NGame = {\n\tSPEED = 1\n}`, JOMINI, "jomini");
    const res = idx.resolve("NGame", "SPEED")!;
    expect(res.winner.value).toBe("5");
    expect(res.winner.layer).toBe("game");
    expect(res.shadowed.map((s) => s.layer)).toEqual(["jomini"]);
    expect(res.shadowed[0].value).toBe("1");
  });

  it("renders a nested block value without crashing", () => {
    const idx = new DefinesIndex();
    idx.harvestText(
      `NGame = {\n\tSPEEDS = {\t# how fast\n\t\t2\n\t\t1\n\t\t0.5\n\t}\n\tWAYPOINTS = rgb { 1 0 0 }\n}`,
      GAME,
      "game"
    );
    expect(idx.resolve("NGame", "SPEEDS")!.winner.value).toBe("{ 2 1 0.5 }");
    expect(idx.resolve("NGame", "WAYPOINTS")!.winner.value).toBe("rgb { 1 0 0 }");
  });

  it("resolve returns null for an unknown namespace/constant", () => {
    const idx = new DefinesIndex();
    idx.harvestText(`NGame = {\n\tSPEED = 5\n}`, GAME, "game");
    expect(idx.resolve("NGame", "MISSING")).toBeNull();
    expect(idx.resolve("NMissing", "SPEED")).toBeNull();
  });
});

describe("define hover card", () => {
  it("shows the value, source layer and overridden layer", () => {
    const data = new ServerData();
    data.defines.harvestText(`NGame = {\n\tEND_DATE = "1400.1.1"\n}`, JOMINI, "jomini");
    data.defines.harvestText(`NGame = {\n\tEND_DATE = "1453.1.1"\n}`, GAME, "game");
    const text = `add = define:NGame|END_DATE`;
    const doc = TextDocument.create("file:///mod/common/script_values/x.txt", "paradox", 1, text);
    const character = text.indexOf("END_DATE") + 2;
    const hover = provideHover(data, doc, { line: 0, character }, null, null);
    expect(hover).not.toBeNull();
    const md = (hover!.contents as { value: string }).value;
    expect(md).toContain("NGame|END_DATE");
    expect(md).toContain('= "1453.1.1"');
    expect(md).toContain("overrides jomini");
  });
});
