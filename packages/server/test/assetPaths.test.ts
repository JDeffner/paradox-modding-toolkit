/**
 * Filesystem-backed asset-path IntelliSense: directory-segment drill-down inside
 * quoted asset paths, and bare-filename .dds fields resolved against the engine's
 * fixed per-context base dirs (trait icon → gfx/interface/icons/traits/).
 *
 * The context/shadowing/dir-vs-file behaviour runs against a synthesized temp
 * root tree (deterministic, ungated). The end-to-end bare-name completion+hover
 * cases are gated on CK3_GAME_PATH so they can assert against a real vanilla
 * trait icon.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItemKind } from "vscode-languageserver/node";
import {
  assetDirContext,
  provideAssetDirCompletion,
  provideBareNameCompletion,
} from "../src/features/assetPaths";
import { provideTextureHover } from "../src/features/textureHover";
import { CompletionFeature, MAX_ITEMS } from "../src/features/completion";
import { ServerData } from "../src/serverData";
import { loadSchema } from "../src/schema/loader";
import type { ParadoxSettings } from "@px-lsp/protocol/protocol";
import { devPath } from "../../../scripts/devPaths";

function makeSettings(over: Partial<ParadoxSettings>): ParadoxSettings {
  return {
    gamePath: null,
    logsPath: null,
    modPath: null,
    parentPaths: [],
    locLanguage: "english",
    scopeInlayHints: false,
    diagnosticsIgnore: [],
    diagnosticsIgnorePatterns: [],
    diagnosticsVanilla: false,
    ...over,
  };
}

describe("assetDirContext", () => {
  it("captures a multi-segment path whose first segment is an asset root", () => {
    expect(assetDirContext('\ttexture = "gfx/interface/ico')).toBe("gfx/interface/ico");
    expect(assetDirContext('\ttexture = "gfx/')).toBe("gfx/");
  });

  it("accepts unquoted script paths (icon = gfx/...)", () => {
    expect(assetDirContext("\ticon = gfx/interface/icons/traits/x")).toBe("gfx/interface/icons/traits/x");
  });

  it("offers a slash-free partial only when it can still grow into a root", () => {
    expect(assetDirContext('\ttexture = "g')).toBe("g"); // prefix of gfx/gui
    expect(assetDirContext('\tname = "PdxWidget')).toBeNull();
  });

  it("rejects a path rooted outside the known asset roots", () => {
    expect(assetDirContext('\tkey = "common/traits/x')).toBeNull();
  });
});

describe("provideAssetDirCompletion (synthesized roots, shadowing)", () => {
  let root: string;
  let settings: ParadoxSettings;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-assetpaths-"));
    const touch = (rel: string) => {
      const full = path.join(root, ...rel.split("/"));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, "");
    };
    // mod root: a shared "icons" dir, a mod-only "modonly" dir, a shared file.
    touch("mod/gfx/interface/icons/traits/shared.dds");
    touch("mod/gfx/interface/modonly/x.dds");
    // vanilla root: same "icons" dir plus a vanilla-only sibling and file.
    touch("game/gfx/interface/icons/traits/shared.dds");
    touch("game/gfx/interface/icons/traits/reveler.dds");
    touch("game/gfx/interface/vanillaonly/y.dds");
    settings = makeSettings({ modPath: path.join(root, "mod"), gamePath: path.join(root, "game") });
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("unions sibling directories across roots, deduped, with retrigger command", () => {
    const { items } = provideAssetDirCompletion(settings, "gfx/interface/");
    const byLabel = new Map(items.map((i) => [i.label, i]));
    // "icons" exists in both roots but appears once (mod wins the detail).
    const icons = byLabel.get("icons")!;
    expect(icons).toBeDefined();
    expect(items.filter((i) => i.label === "icons")).toHaveLength(1);
    expect(icons.kind).toBe(CompletionItemKind.Folder);
    expect(icons.detail).toBe("mod");
    expect(icons.insertText).toBe("icons/");
    expect(icons.command?.command).toBe("editor.action.triggerSuggest");
    // Root-exclusive siblings both surface, tagged by their root.
    expect(byLabel.get("modonly")?.detail).toBe("mod");
    expect(byLabel.get("vanillaonly")?.detail).toBe("vanilla");
  });

  it("lists files as File items and dedupes a file present in both roots", () => {
    const { items } = provideAssetDirCompletion(settings, "gfx/interface/icons/traits/");
    const shared = items.filter((i) => i.label === "shared.dds");
    expect(shared).toHaveLength(1);
    expect(shared[0].kind).toBe(CompletionItemKind.File);
    expect(shared[0].detail).toBe("mod");
    expect(items.find((i) => i.label === "reveler.dds")?.detail).toBe("vanilla");
    // Files carry no drill-down command.
    expect(shared[0].command).toBeUndefined();
  });

  it("filters children by the typed partial segment", () => {
    const { items } = provideAssetDirCompletion(settings, "gfx/interface/icons/traits/rev");
    expect(items.map((i) => i.label)).toEqual(["reveler.dds"]);
  });
});

describe("provideBareNameCompletion (synthesized roots)", () => {
  let root: string;
  let settings: ParadoxSettings;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-barename-"));
    const touch = (rel: string) => {
      const full = path.join(root, ...rel.split("/"));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, "");
    };
    touch("mod/gfx/interface/icons/traits/cultivation_realm_2.dds");
    touch("mod/gfx/interface/icons/traits/shared.dds");
    touch("game/gfx/interface/icons/traits/shared.dds");
    touch("game/gfx/interface/icons/traits/brave.dds");
    touch("game/gfx/interface/icons/traits/notes.txt"); // non-dds ignored
    settings = makeSettings({ modPath: path.join(root, "mod"), gamePath: path.join(root, "game") });
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("lists *.dds from the mapped base dir across roots, mod-first, deduped", () => {
    const items = provideBareNameCompletion(settings, "trait", "icon")!;
    expect(items).not.toBeNull();
    const byLabel = new Map(items.map((i) => [i.label, i]));
    expect(byLabel.get("cultivation_realm_2.dds")?.detail).toContain("(mod)");
    expect(byLabel.get("brave.dds")?.detail).toContain("(vanilla)");
    expect(items.filter((i) => i.label === "shared.dds")).toHaveLength(1);
    expect(byLabel.get("shared.dds")?.detail).toContain("(mod)");
    expect(items.some((i) => i.label === "notes.txt")).toBe(false);
  });

  it("returns null for a key/kind that is not a bare-name field", () => {
    expect(provideBareNameCompletion(settings, "trait", "name")).toBeNull();
    expect(provideBareNameCompletion(settings, "decision", "icon")).toBeNull();
    expect(provideBareNameCompletion(settings, null, "icon")).toBeNull();
  });
});

// ---- end-to-end against real vanilla assets (gated on CK3_GAME_PATH) --------

const GAME = devPath("gamePath");
const gated = GAME ? describe : describe.skip;

gated("asset paths against vanilla", () => {
  const settings = makeSettings({ gamePath: GAME });
  const schema = loadSchema(null);
  const traitEntry = schema.entries.find((e) => e.kind === "trait")!;

  it("directory drill-down lists the traits/ folder under gfx/interface/icons", () => {
    const { items } = provideAssetDirCompletion(settings, "gfx/interface/icons/tr");
    const traits = items.find((i) => i.label === "traits");
    expect(traits).toBeDefined();
    expect(traits!.kind).toBe(CompletionItemKind.Folder);
    expect(traits!.detail).toBe("vanilla");
  });

  it("bare trait-icon completion offers real vanilla .dds files", () => {
    const data = new ServerData();
    const completion = new CompletionFeature(data, () => schema);
    completion.setSettings(settings);
    const text = "reveler_trait = {\n\ticon = |\n}";
    const cursor = text.indexOf("|");
    const clean = text.slice(0, cursor) + text.slice(cursor + 1);
    const doc = TextDocument.create("file:///mod/common/traits/00_traits.txt", "paradox", 1, clean);
    const { items } = completion.provide(doc, cursor, new Set(["character"]), traitEntry, MAX_ITEMS);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("reveler.dds");
    expect(items.every((i) => i.label.toLowerCase().endsWith(".dds"))).toBe(true);
  });

  it("hover resolves a bare trait icon against gfx/interface/icons/traits/", () => {
    const text = "reveler_trait = {\n\ticon = reveler.dds\n}";
    const doc = TextDocument.create("file:///mod/common/traits/00_traits.txt", "paradox", 1, text);
    // Cursor on the filename token (line 1, inside "reveler.dds").
    const hover = provideTextureHover(settings, doc, { line: 1, character: 12 }, "trait");
    expect(hover).not.toBeNull();
    const value = (hover!.contents as { value: string }).value;
    // The card head names the file and where it resolved; the facts line under
    // the picture carries dimensions + encoding + size, not the (redundant) path.
    expect(value).toContain("**reveler.dds** · vanilla");
    expect(value).toMatch(/\*\d+×\d+ · \S+ · [\d.]+ [KM]B\*/);
  });

  it("does not resolve a bare icon when the field is not a mapped bare-name field", () => {
    const text = "x = {\n\ttexture = reveler.dds\n}";
    const doc = TextDocument.create("file:///mod/common/traits/00_traits.txt", "paradox", 1, text);
    const hover = provideTextureHover(settings, doc, { line: 1, character: 14 }, "trait");
    expect(hover).toBeNull();
  });
});
