/**
 * Engine-layer (jomini) scan validation, gated on the game path like
 * schemaVanilla.test.ts: skipped entirely when no game install is configured.
 *
 * The jomini directory next to `<game>` is scanned as the lowest-priority
 * vanilla root (server.ts engineRoots). This asserts the schema-driven
 * extraction actually finds engine-only content there, so a regression in the
 * root derivation or schema coverage is caught against the real install.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { extractDefinitions } from "../src/index/extract";
import { CK3_SCHEMA } from "../src/games/ck3/schema";
import { DefinesIndex } from "../src/data/defines";
import { TextFormattingIndex } from "../src/data/textFormatting";
import { devPath } from "../../../scripts/devPaths";

const GAME = devPath("gamePath");
const JOMINI = GAME ? path.join(path.dirname(GAME), "jomini") : null;
const run = JOMINI && fs.existsSync(JOMINI) ? describe : describe.skip;

run("engine layer (jomini)", () => {
  it("yields trigger_localization definitions from the jomini root", () => {
    const entry = CK3_SCHEMA.find((e) => e.path === "common/trigger_localization");
    expect(entry).toBeDefined();
    const dir = path.join(JOMINI!, "common", "trigger_localization");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt"));
    expect(files.length).toBeGreaterThan(0);
    const defs = files.flatMap((f) => {
      const file = path.join(dir, f);
      const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
      return extractDefinitions(text, entry!, file, "vanilla");
    });
    const names = new Set(defs.map((d) => d.name));
    // Logic trigger loc lives only in the engine layer, not under <game>.
    expect(names.has("and")).toBe(true);
    expect(names.has("or")).toBe(true);
  });

  it("harvests defines across engine + game and resolves a known constant", () => {
    const defines = new DefinesIndex();
    defines.addLayer(JOMINI!, "jomini");
    defines.addLayer(GAME!, "game");
    expect(defines.namespaces()).toContain("NGame");
    const endDate = defines.resolve("NGame", "END_DATE");
    expect(endDate).not.toBeNull();
    expect(endDate!.winner.value).toMatch(/^"\d+\.\d+\.\d+"$/);
    // A jomini-only namespace exists in the harvest.
    expect(defines.namespaces()).toContain("NTextFormatting");
  });

  it("harvests textformatting and resolves G to a green color", () => {
    const tf = new TextFormattingIndex();
    tf.addLayer(JOMINI!, "jomini");
    tf.addLayer(GAME!, "game");
    const g = tf.resolve("G");
    expect(g.rgb).not.toBeNull();
    const [r, green, b] = g.rgb!;
    // G is "color:{0,1,0}" — pure green.
    expect(green).toBeGreaterThan(r);
    expect(green).toBeGreaterThan(b);
    expect(green).toBe(1);
  });
});
