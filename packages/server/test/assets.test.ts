import { afterAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { URI } from "vscode-uri";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { ParadoxSettings } from "@px-lsp/protocol/protocol";
import type { Reference } from "@px-lsp/protocol/types";
import { scanModRootFused } from "../src/index/fusedScan";
import { extractDefinitions } from "../src/index/extract";
import { extractReferences } from "../src/index/references";
import { loadSchema } from "../src/schema/loader";
import { ASSET_SCHEMA } from "../src/games/jomini/assets";
import { provideDocumentSymbols } from "../src/features/symbols";
import { assetFileAt, provideAssetFileCompletion, resolveAssetPath } from "../src/features/assetPaths";
import { provideTextureHover } from "../src/features/textureHover";
import { LazyReferenceScanner } from "../src/index/lazyRefs";
import { ck3Profile } from "../src/games/ck3";
import { vic3Profile } from "../src/games/vic3";
import { eu5Profile } from "../src/games/eu5";

// The same named-block/meshsettings shape as the installed portrait assets.
const text = `pdxmesh = {
  name = "hat_mesh"
  file = "hat.mesh"
  meshsettings = { name = "Shape" texture_diffuse = "hat.dds" }
}
entity = {
  name = "hat_entity"
  pdxmesh = "hat_mesh"
}
entity = { name = "second_entity" pdxmesh = hat_mesh }
`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "px-assets-test-"));
const mod = path.join(root, "mod");
const game = path.join(root, "game");
const parent = path.join(root, "parent");
function write(base: string, rel: string, content: string | Buffer): string {
  const file = path.join(base, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}
const asset = write(mod, "gfx/models/hat.asset", text);
const doc = TextDocument.create(URI.file(asset).toString(), "paradox", 1, text);
const schema = loadSchema(null);
const settings: ParadoxSettings = {
  modPath: mod,
  gamePath: game,
  parentPaths: [parent],
  logsPath: null,
  locLanguage: "english",
  scopeInlayHints: false,
  diagnosticsIgnore: [],
  diagnosticsIgnorePatterns: [],
  diagnosticsVanilla: false,
};
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("graphics assets", () => {
  it("enables verified profiles and leaves the unverified game out", () => {
    expect(ck3Profile.schema.find((e) => e.ext === ".asset")?.assetVocabulary).toBeDefined();
    expect(vic3Profile.schema.find((e) => e.ext === ".asset")?.assetVocabulary).toBeDefined();
    expect(eu5Profile.schema.some((e) => e.ext === ".asset")).toBe(false);
  });

  it("extracts direct names, preserves repeated block types and excludes meshsettings names", () => {
    const defs = extractDefinitions(text, ASSET_SCHEMA, asset, "mod");
    expect(defs.map((d) => [d.name, d.container, d.line])).toEqual([
      ["hat_mesh", "pdxmesh", 1],
      ["hat_entity", "entity", 6],
      ["second_entity", "entity", 9],
    ]);
    expect(provideDocumentSymbols(doc, "asset").map((s) => s.name)).toEqual(defs.map((d) => d.name));
  });

  it("indexes quoted and bare references with exact ranges and no script calls", () => {
    const result = extractReferences(text, asset, "mod", schema);
    expect(result.references).toHaveLength(2);
    for (const ref of result.references) {
      expect(ref.name).toBe("hat_mesh");
      expect(text.split("\n")[ref.line].slice(ref.startChar, ref.endChar)).toBe("hat_mesh");
      expect(ref.call).toBeUndefined();
    }
    expect(result.implicitDefs).toEqual([]);
  });

  it("reads each asset once in the fused scan and never reads binary companions", async () => {
    write(mod, "gfx/models/hat.mesh", Buffer.alloc(16));
    const reads: string[] = [];
    const refs: Reference[] = [];
    const result = await scanModRootFused(mod, {
      schema,
      source: "mod",
      locLanguage: "english",
      readBatch: async (files) => {
        reads.push(...files);
        return files.map((f) => fs.readFileSync(f, "utf8"));
      },
      superseded: () => false,
      yieldNow: async () => {},
      addReferences: (r) => refs.push(...r),
      setNamespaces: () => {},
    });
    expect(reads).toEqual([asset]);
    expect(result?.defs).toHaveLength(3);
    expect(refs).toHaveLength(2);
  });

  it("finds asset uses in dependency roots on demand", async () => {
    write(parent, "gfx/models/parent.asset", 'entity = { name = "parent_hat" pdxmesh = "hat_mesh" }');
    const scanner = new LazyReferenceScanner();
    scanner.setRoots([{ root: parent, source: "parent" }]);
    expect((await scanner.lookup("hat_mesh")).map((r) => r.name)).toEqual(["hat_mesh"]);
    scanner.setRoots([{ root: parent, source: "parent" }], undefined, false);
    expect(await scanner.lookup("hat_mesh")).toEqual([]);
    scanner.setRoots([{ root: parent, source: "parent" }]);
    expect(await scanner.lookup("hat_mesh")).toHaveLength(1);
  });

  it("resolves local and rooted paths through mod overlays and provides a real DDS preview", () => {
    const dds = Buffer.alloc(132);
    dds.write("DDS ");
    dds.writeUInt32LE(124, 4);
    dds.writeUInt32LE(1, 12);
    dds.writeUInt32LE(1, 16);
    dds.writeUInt32LE(32, 76);
    dds.writeUInt32LE(0x41, 80);
    dds.writeUInt32LE(32, 88);
    dds.writeUInt32LE(0xff0000, 92);
    dds.writeUInt32LE(0xff00, 96);
    dds.writeUInt32LE(0xff, 100);
    dds.writeUInt32LE(0xff000000, 104);
    dds.writeUInt32LE(0xffff0000, 128);
    const modTexture = write(mod, "gfx/models/hat.dds", dds);
    write(game, "gfx/models/hat.dds", dds);
    const vanillaUri = URI.file(path.join(game, "gfx/models/hat.asset")).toString();
    expect(resolveAssetPath(settings, vanillaUri, "hat.dds")?.fsPath).toBe(modTexture);
    expect(resolveAssetPath(settings, vanillaUri, "gfx/models/hat.dds")?.fsPath).toBe(modTexture);
    expect(resolveAssetPath(settings, vanillaUri, "../secret.dds")).toBeNull();
    const hoverDoc = TextDocument.create(vanillaUri, "paradox", 1, 'texture_diffuse = "hat.dds"');
    const hover = provideTextureHover(
      { ...settings, indexAssets: false },
      hoverDoc,
      { line: 0, character: 21 },
      "asset"
    );
    expect((hover?.contents as { value: string }).value).toContain("data:image/png;base64,");
    expect(assetFileAt(doc, { line: 2, character: 12 })).toBe("hat.mesh");
  });

  it("completes sibling files without suggesting unrelated script effects", () => {
    write(mod, "gfx/models/f_hat.mesh", "");
    write(game, "gfx/models/f_other.mesh", "");
    write(mod, "gfx/models/f_notes.txt", "");
    const result = provideAssetFileCompletion(settings, doc, 'file = "f_', ASSET_SCHEMA);
    expect(result.items.map((i) => i.label)).toEqual(["f_hat.mesh", "f_other.mesh"]);
  });
});
