import { afterAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { URI } from "vscode-uri";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { ParadoxSettings } from "@px-lsp/protocol/protocol";
import { ServerData } from "../src/serverData";
import { ck3Profile } from "../src/games/ck3";
import { extractDefinitions } from "../src/index/extract";
import { assetCompletion, assetDefinitions, assetHover } from "../src/features/assetLanguage";
import { devPath } from "../../../scripts/devPaths";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "px-asset-language-"));
const game = path.join(root, "game");
const mod = path.join(root, "mod");
const entry = ck3Profile.schema.find((e) => e.ext === ".asset")!;
const settings: ParadoxSettings = {
  modPath: mod,
  gamePath: game,
  parentPaths: [],
  logsPath: null,
  locLanguage: "english",
  scopeInlayHints: false,
  diagnosticsIgnore: [],
  diagnosticsIgnorePatterns: [],
  diagnosticsVanilla: false,
};
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let version = 0;
function document(marked: string, file = path.join(mod, "gfx/models/hat.asset")) {
  const offset = marked.indexOf("|");
  const doc = TextDocument.create(URI.file(file).toString(), "paradox", ++version, marked.replace("|", ""));
  return { doc, pos: doc.positionAt(offset) };
}
function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}
function definitions(marked: string, data = new ServerData()) {
  const { doc, pos } = document(marked);
  return assetDefinitions(data, settings, doc, pos, entry);
}
function complete(marked: string, data = new ServerData()) {
  const { doc, pos } = document(marked);
  return assetCompletion(data, settings, doc, pos, entry).items.map((i) => i.label);
}

describe("context-sensitive asset language", () => {
  it("completes harvested keys at the root and at the screenshot's nested material", () => {
    expect(complete("pdxm|")).toContain("pdxmesh");
    expect(complete('pdxmesh = { name = "mesh" meshsettings = { texture_| } }')).toEqual(
      expect.arrayContaining(["texture_diffuse", "texture_normal", "texture_specular"])
    );
    expect(
      complete("entity = { game_data = { portrait_entity_user_data = { portrait_accessory = { var| } } } }")
    ).toEqual(["variation"]);
    expect(complete("entity = { default_| }")).toEqual(["default_state"]);
  });

  it("resolves mesh and blend-shape names in the open document, without indexing", () => {
    const prefix = 'pdxmesh = { name = "mesh" blend_shape = { id = "fat" type = "fat.mesh" } }\n';
    expect(definitions(prefix + 'entity = { pdxmesh = "me|sh" }')[0].range.start.line).toBe(0);
    expect(
      definitions(prefix + 'entity = { pdxmesh = "mesh" attribute = { blend_shape = "fa|t" } }')
    ).toHaveLength(1);
    expect(complete(prefix + 'entity = { pdxmesh = "mesh" attribute = { blend_shape = "f|" } }')).toEqual([
      "fat",
    ]);
    expect(
      definitions(prefix + 'entity = { pdxmesh = "different" attribute = { blend_shape = "fa|t" } }')
    ).toEqual([]);
  });

  it("keeps state and animation identifiers local to their owners, including imported sets", () => {
    const prefix = `skeletal_animation_set = { name = "shared" animation = { id = "idle_anim" type = "idle.anim" } }
pdxmesh = { name = "mesh" import = { type = skeletal_animation_set name = "shared" } }
entity = { name = "other" state = { name = "wrong" } }
`;
    expect(
      complete(prefix + 'entity = { pdxmesh = "mesh" state = { name = "idle" animation = "idle_|" } }')
    ).toEqual(["idle_anim"]);
    expect(
      definitions(prefix + 'entity = { pdxmesh = "mesh" state = { animation = "idle_an|im" } }')
    ).toHaveLength(1);
    expect(complete(prefix + 'entity = { default_state = "|" state = { name = "idle" } }')).toEqual(["idle"]);
    expect(definitions(prefix + 'entity = { state = { name = "idle" next_state = "id|le" } }')).toHaveLength(
      1
    );
  });

  it("uses typed external definitions and refreshes completion after index changes", () => {
    const data = new ServerData();
    const file = write(
      path.join(mod, "gfx/models/other.asset"),
      'pdxmesh = { name = "external" blend_shape = { id = "fat" } }'
    );
    data.index.addAll(extractDefinitions(fs.readFileSync(file, "utf8"), entry, file, "mod"));
    expect(definitions('entity = { pdxmesh = "ext|ernal" }', data)[0].uri).toBe(URI.file(file).toString());
    expect(
      definitions('entity = { pdxmesh = "external" attribute = { blend_shape = "fa|t" } }', data)[0].uri
    ).toBe(URI.file(file).toString());
    expect(complete('entity = { pdxmesh = "ext|" }', data)).toEqual(["external"]);
    data.index.removeFile(file);
    expect(complete('entity = { pdxmesh = "ext|" }', data)).toEqual([]);
    data.index.addAll(extractDefinitions('entity = { name = "external" }', entry, file, "mod"));
    expect(definitions('entity = { pdxmesh = "ext|ernal" }', data)).toEqual([]);
    expect(definitions('entity = { attach = { "locator" = "ext|ernal" } }', data)).toHaveLength(1);
    expect(complete('entity = { attach = { "locator" = "ext|" } }', data)).toEqual(["external"]);
  });

  it("resolves shader effects in the engine layer and ignores commented declarations", () => {
    const shader = write(
      path.join(root, "jomini/gfx/FX/jomini/portrait.shader"),
      "/*\nEffect commented {}\n*/\n// Effect hidden {}\nEffect portrait_attachment_pattern\n{ }"
    );
    const marked =
      'pdxmesh = { meshsettings = { shader = "portrait_attachment_pat|tern" shader_file = "gfx/FX/jomini/portrait.shader" } }';
    const defs = definitions(marked);
    expect(defs).toHaveLength(1);
    expect(defs[0].uri).toBe(URI.file(shader).toString());
    expect(defs[0].range.start.line).toBe(4);
    expect(complete(marked.replace("portrait_attachment_pat|tern", "|"))).toEqual([
      "portrait_attachment_pattern",
    ]);
  });

  it("does not resolve mesh-local IDs from a shadowed vanilla mesh", () => {
    const data = new ServerData();
    for (const source of ["vanilla", "mod"] as const) {
      const file = write(
        path.join(source === "mod" ? mod : game, "gfx/models/override.asset"),
        `pdxmesh = { name = "overridden" blend_shape = { id = "${source}_shape" } }`
      );
      data.index.addAll(extractDefinitions(fs.readFileSync(file, "utf8"), entry, file, source));
    }
    expect(
      definitions('entity = { pdxmesh = "overridden" attribute = { blend_shape = "vanilla_sh|ape" } }', data)
    ).toEqual([]);
    expect(
      definitions('entity = { pdxmesh = "overridden" attribute = { blend_shape = "mod_sh|ape" } }', data)
    ).toHaveLength(1);
  });

  it("resolves accessory variations and root-relative masks from portrait game_data", () => {
    const data = new ServerData();
    const variationEntry = ck3Profile.schema.find((e) => e.kind === "accessory_variation")!;
    const file = write(
      path.join(game, "gfx/portraits/accessory_variations/example.txt"),
      'variation = { name = "western_nobility" }'
    );
    data.index.addAll(extractDefinitions(fs.readFileSync(file, "utf8"), variationEntry, file, "vanilla"));
    const prefix = "entity = { game_data = { portrait_entity_user_data = { portrait_accessory = { ";
    expect(definitions(prefix + 'variation = "western_nob|ility" } } } }', data)[0].uri).toBe(
      URI.file(file).toString()
    );
    const mask = write(path.join(mod, "gfx/models/masks.dds"), "");
    expect(definitions(prefix + 'pattern_mask = "gfx/models/mas|ks.dds" } } } }')[0].uri).toBe(
      URI.file(mask).toString()
    );
  });

  it("does not confuse binary shape names, numeric properties or comments with script symbols", () => {
    const data = new ServerData();
    const prefix = 'pdxmesh = { name = "Shape" }\n';
    expect(definitions(prefix + 'pdxmesh = { meshsettings = { name = "Sha|pe" } }', data)).toEqual([]);
    expect(complete('entity = {\n # pdxmesh = "|\n}', data)).toEqual([]);
    expect(complete('entity = { name = "a" # pdxmesh = "|\n}', data)).toEqual([]);
    expect(complete("pdxmesh = { meshsettings = { index = | } }")).toEqual([]);
    const { doc, pos } = document('pdxmesh = { blend_shape = { ty|pe = "fat.mesh" } }');
    expect(JSON.stringify(assetHover(data, settings, doc, pos, entry))).toContain("Binary file");
    expect(JSON.stringify(assetHover(data, settings, doc, pos, entry))).not.toContain("character_event");
  });
});

const installedGame = devPath("gamePath");
it.skipIf(!installedGame)(
  "resolves the real CK3 portrait asset's mesh, blend shape, material files and variation",
  () => {
    const file = path.join(
      installedGame!,
      "gfx/models/portraits/f_headgear/sp3_western/western_nob_01/f_headgear_sec_sp3_western_hi_nob_01.asset"
    );
    const text = fs.readFileSync(file, "utf8");
    const doc = TextDocument.create(URI.file(file).toString(), "paradox", 1, text);
    const data = new ServerData();
    const variationEntry = ck3Profile.schema.find((e) => e.kind === "accessory_variation")!;
    const variation = path.join(installedGame!, "gfx/portraits/accessory_variations/sp3.txt");
    data.index.addAll(
      extractDefinitions(fs.readFileSync(variation, "utf8"), variationEntry, variation, "vanilla")
    );
    const realSettings = { ...settings, modPath: null, gamePath: installedGame };
    for (const key of [
      "file",
      "texture_diffuse",
      "texture_normal",
      "texture_specular",
      "shader",
      "shader_file",
      "pattern_mask",
      "variation",
      "pdxmesh",
      "blend_shape",
    ]) {
      const match = new RegExp(`\\b${key}\\s*=\\s*"([^"]+)"`).exec(text)!;
      expect(match, key).not.toBeNull();
      const pos = doc.positionAt(match.index + match[0].indexOf('"') + 2);
      const defs = assetDefinitions(data, realSettings, doc, pos, entry);
      expect(defs.length, key).toBeGreaterThan(0);
      expect(fs.existsSync(URI.parse(defs[0].uri).fsPath), key).toBe(true);
    }
  }
);
