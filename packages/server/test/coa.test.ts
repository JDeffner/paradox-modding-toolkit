/**
 * Coat-of-arms model: the parser resolves @vars, reads every color form and
 * the three layer kinds; the writer produces script the parser reads back
 * unchanged; upsert replaces a flag in place. The corpus check runs over every
 * vanilla Victoria 3 coa file when games.vic3.gamePath is configured.
 */
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { devPath } from "../../../scripts/devPaths";
import { colorToRgb, hsv360ToRgb, writeFlag } from "../src/coa/coa";
import { parseCoaFile, parseNamedColors, resolveNumber, upsertFlagInFile } from "../src/coa/coaParse";
import {
  parseAtDefaults,
  parseColorLists,
  parseDesignerCatalog,
  parseDesignerPalette,
  parseDesignerTemplates,
} from "../src/coa/coaDesigner";

const sample = `@third = @[1/3]
@canton_y = @[ ( 205 / 512 ) + 0.001 ]

template = { pattern = "x.dds" }

GBR = {
	pattern = "pattern_gironny_8.dds"
	color1 = "blue"
	color2 = color1
	color3 = rgb { 255 0 0 }
	color4 = hsv360 { 230 80 30 }
	color5 = hsv { 0.5 1 1 }
	color6 = { 0.5 0.5 0.5 }

	colored_emblem = {
		texture = "ce_saltire.dds"
		mask = { 2 }
		color1 = color3
		instance = { rotation = 45 scale = { @third 1 } position = { 0.5 @canton_y } }
		instance = { scale = { 0.5 0.5 } }
	}
	textured_emblem = {
		texture = "te_crow_star.dds"
	}
	sub = {
		parent = "sub_GBR_uk"
		instance = { offset = { 0.1 0.2 } scale = { 0.5 0.5 } }
	}
}
`;

describe("coa parser", () => {
  const flags = parseCoaFile(sample);
  const gbr = flags[0];

  it("skips templates and reads the flag", () => {
    expect(flags.map((f) => f.name)).toEqual(["GBR"]);
    expect(gbr.pattern).toBe("pattern_gironny_8.dds");
  });

  it("reads every color form", () => {
    expect(gbr.colors).toEqual([
      { name: "color1", kind: "named", value: "blue" },
      { name: "color2", kind: "ref", value: "color1" },
      { name: "color3", kind: "rgb", value: [255, 0, 0] },
      { name: "color4", kind: "hsv360", value: [230, 80, 30] },
      { name: "color5", kind: "hsv360", value: [180, 100, 100] },
      { name: "color6", kind: "rgb", value: [128, 128, 128] },
    ]);
  });

  it("resolves @vars and @[expr] inside instances", () => {
    const layer = gbr.layers[0];
    if (layer.kind !== "colored_emblem") throw new Error("expected colored_emblem");
    expect(layer.mask).toBe(2);
    expect(layer.colors).toEqual([{ name: "color1", kind: "ref", value: "color3" }]);
    expect(layer.instances[0].rotation).toBe(45);
    expect(layer.instances[0].scale[0]).toBeCloseTo(1 / 3);
    expect(layer.instances[0].position[1]).toBeCloseTo(205 / 512 + 0.001);
    // Missing attributes keep the game's defaults.
    expect(layer.instances[1]).toEqual({ rotation: 0, scale: [0.5, 0.5], position: [0.5, 0.5] });
  });

  it("reads textured emblems and subs", () => {
    expect(gbr.layers[1]).toEqual({ kind: "textured_emblem", texture: "te_crow_star.dds", instances: [] });
    expect(gbr.layers[2]).toEqual({
      kind: "sub",
      parent: "sub_GBR_uk",
      instances: [{ offset: [0.1, 0.2], scale: [0.5, 0.5] }],
    });
  });

  it("evaluates arithmetic with precedence and rejects anything else", () => {
    const vars = new Map([["@a", 2]]);
    expect(resolveNumber("@[ 1 + 2 * 3 ]", vars)).toBe(7);
    expect(resolveNumber("@[ (1 + 2) * @a ]", vars)).toBe(6);
    expect(resolveNumber("@[ -1 ]", vars)).toBe(-1);
    expect(resolveNumber("@missing", vars)).toBeNaN();
    expect(resolveNumber("@[ 1 + ]", vars)).toBeNaN();
    expect(resolveNumber("@[ a.b ]", vars)).toBeNaN();
  });
});

describe("colors", () => {
  it("converts hsv360 like the game's named colors", () => {
    expect(hsv360ToRgb(0, 0, 100)).toEqual([255, 255, 255]);
    expect(hsv360ToRgb(0, 100, 100)).toEqual([255, 0, 0]);
    expect(hsv360ToRgb(120, 100, 50)).toEqual([0, 128, 0]);
  });

  it("parses named_colors and follows references once", () => {
    const named = parseNamedColors(
      `colors = {\n\tred = hsv360 { 0 100 100 }\n\tgrey = rgb { 0.5 0.5 0.5 }\n}`
    );
    expect(named).toEqual({ red: [255, 0, 0], grey: [128, 128, 128] });
    const flag = parseCoaFile(`A = { color1 = "red" color2 = color1 color3 = color2 }`)[0];
    expect(colorToRgb(flag.colors[1], named, flag.colors)).toEqual([255, 0, 0]);
    // color3 -> color2 -> color1: the game does not chain, neither do we.
    expect(colorToRgb(flag.colors[2], named, flag.colors)).toBeNull();
    expect(colorToRgb({ name: "color1", kind: "named", value: "nope" }, named, [])).toBeNull();
  });
});

describe("coa writer", () => {
  it("round-trips through the parser", () => {
    const flag = parseCoaFile(sample)[0];
    const text = writeFlag(flag);
    expect(
      text.startsWith('GBR = {\n\tpattern = "pattern_gironny_8.dds"\n\tcolor1 = "blue"\n\tcolor2 = color1\n')
    ).toBe(true);
    expect(text).toContain("\t\tmask = { 2 }");
    expect(text).toContain("instance = { rotation = 45 scale = { 0.333 1 } position = { 0.5 0.401 } }");
    const again = parseCoaFile(text)[0];
    const rounded = JSON.parse(
      JSON.stringify(flag, (_k, v) => (typeof v === "number" ? Number(v.toFixed(3)) : v))
    );
    expect(again).toEqual(rounded);
  });

  it("upserts a flag in place and appends a new one", () => {
    const file = 'A = {\r\n\tpattern = "a.dds"\r\n}\r\n\r\nB = { pattern = "b.dds" } # keep\r\n';
    const replaced = upsertFlagInFile(file, "A", 'A = {\n\tpattern = "z.dds"\n}');
    expect(replaced).toBe('A = {\r\n\tpattern = "z.dds"\r\n}\r\n\r\nB = { pattern = "b.dds" } # keep\r\n');
    const appended = upsertFlagInFile(file, "C", "C = {\n}");
    expect(appended.endsWith("# keep\r\n\r\nC = {\r\n}\r\n")).toBe(true);
    expect(upsertFlagInFile("", "C", "C = {\n}")).toBe("\nC = {\n}\n");
  });
});

describe("instance depth", () => {
  // Shape and spelling copied from 01_landed_titles.txt `c_ghur`: the in-game
  // designer writes `depth=1.010000` on one instance and none on the other.
  const withDepth = `c_ghur = {
	pattern="pattern_solid.dds"
	color1=yellow
	colored_emblem={
		color1=red
		texture="ce_octogon_frame.dds"
		instance={ position={ 0.5 0.48 } scale={ 0.75 0.75 } depth=1.010000 }
	}
	colored_emblem={
		color1=red
		texture="ce_tower.dds"
		instance={ scale={ 0.59 0.52 } }
	}
}`;

  it("round-trips depth and leaves an instance without one alone", () => {
    const flag = parseCoaFile(withDepth)[0];
    const first = flag.layers[0];
    const second = flag.layers[1];
    if (first.kind !== "colored_emblem" || second.kind !== "colored_emblem")
      throw new Error("expected colored emblems");
    expect(first.instances[0].depth).toBe(1.01);
    expect(second.instances[0].depth).toBeUndefined();

    const text = writeFlag(flag);
    expect(text).toContain("instance = { scale = { 0.75 0.75 } position = { 0.5 0.48 } depth = 1.01 }");
    expect(text).toContain("instance = { scale = { 0.59 0.52 } position = { 0.5 0.5 } }");
    expect(parseCoaFile(text)[0]).toEqual(flag);
  });
});

describe("designer catalogs", () => {
  it("keeps file order, drops nothing, and reads visible / colors / category", () => {
    const patterns = parseDesignerCatalog(
      `pattern__solid_designer.dds = { colors = 1 }
pattern_solid.dds = { colors = 1 visible = no }
pattern_bend_01.dds = { colors = 2 }
pattern_no_count.dds = { }`,
      3
    );
    expect(patterns.map((p) => [p.file, p.colors, p.visible])).toEqual([
      ["pattern__solid_designer.dds", 1, true],
      ["pattern_solid.dds", 1, false],
      ["pattern_bend_01.dds", 2, true],
      // "will assume maximum number of colors if missing" (the file's own header).
      ["pattern_no_count.dds", 3, true],
    ]);

    const emblems = parseDesignerCatalog(
      `ce__empty_designer.dds = { colors = 0 category = abstract }
ce_lion.dds = { colors = 2 category = animals }`,
      3
    );
    expect(emblems[0].colors).toBe(0);
    expect(emblems.map((e) => e.category)).toEqual(["abstract", "animals"]);
  });

  it("reads the palette in list order and a color list's first entry", () => {
    expect(
      parseDesignerPalette(`coa_designer_background_colors = {\n\tred = {}\n\torange = {}\n\tblack = {}\n}`)
    ).toEqual(["red", "orange", "black"]);
    expect(
      parseColorLists(
        `color_lists = {\n\tnormal_colors = {\n\t\t30 = "red"\n\t\t12 = "blue"\n\t}\n\tmetal_colors = {\n\t\t24 = "yellow"\n\t}\n}`
      )
    ).toEqual({ normal_colors: "red", metal_colors: "yellow" });
  });

  it("leaves a layout's placeholders unresolved and reads its @ defaults", () => {
    const file = `@color_1 = grey
@color_2 = white
@texture_1 = "ce_fleur.dds"
@pattern = "pattern_solid.dds"

coa_designer_single_centre = {
	pattern = @pattern
	color1 = @color_1
	colored_emblem = {
		texture = @texture_1
		color1 = @color_2
		instance = { position = { 0.5 0.5 } scale = { 0.7 0.7 } }
	}
}`;
    expect(parseAtDefaults(file)).toEqual({
      "@color_1": "grey",
      "@color_2": "white",
      "@texture_1": "ce_fleur.dds",
      "@pattern": "pattern_solid.dds",
    });
    const layout = parseCoaFile(file)[0];
    expect(layout.pattern).toBe("@pattern");
    expect(layout.colors[0]).toEqual({ name: "color1", kind: "named", value: "@color_1" });
    const layer = layout.layers[0];
    if (layer.kind !== "colored_emblem") throw new Error("expected a colored emblem");
    expect(layer.texture).toBe("@texture_1");
    expect(layer.instances[0].scale).toEqual([0.7, 0.7]);
  });

  it("resolves a template's list references through the color lists", () => {
    const templates = parseDesignerTemplates(
      `template = {
	coa_designer_blank_default = {
		pattern = "pattern_solid.dds"
		color1 = list "normal_colors"
		color2 = list "metal_colors"
		colored_emblem = { texture = "ce_fleur.dds" color1 = color2 }
	}
}`,
      { normal_colors: "red", metal_colors: "yellow" }
    );
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe("coa_designer_blank_default");
    expect(templates[0].colors).toEqual([
      { name: "color1", kind: "named", value: "red" },
      { name: "color2", kind: "named", value: "yellow" },
    ]);
    const layer = templates[0].layers[0];
    if (layer.kind !== "colored_emblem") throw new Error("expected a colored emblem");
    expect(layer.colors[0]).toEqual({ name: "color1", kind: "ref", value: "color2" });
  });
});

const vic3 = devPath("gamePath", "vic3");
describe.skipIf(!vic3)("vanilla Victoria 3 corpus", () => {
  it("parses every coa file with numeric instances and known color forms", () => {
    const dir = path.join(vic3!, "common", "coat_of_arms", "coat_of_arms");
    let flags = 0;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".txt"))) {
      for (const flag of parseCoaFile(fs.readFileSync(path.join(dir, file), "utf8"))) {
        flags++;
        for (const layer of flag.layers) {
          for (const inst of layer.instances) {
            for (const n of Object.values(inst).flat())
              expect(Number.isFinite(n), `${file} ${flag.name}`).toBe(true);
          }
        }
      }
    }
    expect(flags).toBeGreaterThan(500);
  });
});
