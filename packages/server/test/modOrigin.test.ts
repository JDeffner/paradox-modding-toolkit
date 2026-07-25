/**
 * Origin labels for hovers/completion: descriptor.mod names instead of the
 * generic "mod"/"parent" tag (server/src/index/modOrigin.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { ModOriginResolver } from "../src/index/modOrigin";
import { readDescriptorName } from "@px-lsp/protocol/descriptorMod";
import { ServerData } from "../src/serverData";
import { provideHover } from "../src/features/hover";
import { computeModOverview } from "../src/overview/modOverview";
import { computeOverrides } from "../src/overview/overrides";

let tmp: string;

function makeMod(name: string, descriptor: string | null): string {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  if (descriptor !== null) fs.writeFileSync(path.join(dir, "descriptor.mod"), descriptor, "utf8");
  return dir;
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-modorigin-"));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("readDescriptorName", () => {
  it("reads and unquotes name=", () => {
    const dir = makeMod("named", 'version="1.0"\nname="Cultivation Expanded"\nsupported_version="1.19.*"\n');
    expect(readDescriptorName(dir)).toBe("Cultivation Expanded");
  });

  it("null when descriptor.mod is missing", () => {
    expect(readDescriptorName(makeMod("bare", null))).toBe(null);
  });

  it("null when the name field is missing or empty", () => {
    expect(readDescriptorName(makeMod("noname", 'version="1.0"\n'))).toBe(null);
    expect(readDescriptorName(makeMod("emptyname", 'name=""\n'))).toBe(null);
  });
});

describe("ModOriginResolver", () => {
  it("labels files by their owning mod's descriptor name", () => {
    const a = makeMod("mod_a", 'name="Mod Alpha"\n');
    const b = makeMod("mod_b", null); // no descriptor: folder name
    const resolver = new ModOriginResolver();
    resolver.setRoots([a, b]);

    expect(resolver.labelFor(path.join(a, "common", "traits", "x.txt"), "mod")).toBe("Mod Alpha");
    expect(resolver.labelFor(path.join(b, "events", "y.txt"), "parent")).toBe("mod_b");
  });

  it("falls back to the source tag outside every root", () => {
    const a = makeMod("mod_c", 'name="Mod C"\n');
    const resolver = new ModOriginResolver();
    resolver.setRoots([a]);
    expect(resolver.labelFor(path.join(tmp, "elsewhere", "z.txt"), "vanilla")).toBe("vanilla");
    expect(resolver.labelFor("synthetic.txt", "mod")).toBe("mod");
  });

  it("does not match a sibling folder sharing the root as a name prefix", () => {
    const a = makeMod("prefix", 'name="Short"\n');
    const resolver = new ModOriginResolver();
    resolver.setRoots([a]);
    expect(resolver.labelFor(path.join(tmp, "prefix_extended", "f.txt"), "mod")).toBe("mod");
  });

  it("prefers the deepest root for nested mods", () => {
    const outer = makeMod("outer", 'name="Outer"\n');
    const inner = path.join(outer, "inner");
    fs.mkdirSync(inner, { recursive: true });
    fs.writeFileSync(path.join(inner, "descriptor.mod"), 'name="Inner"\n', "utf8");
    const resolver = new ModOriginResolver();
    resolver.setRoots([outer, inner]);
    expect(resolver.labelFor(path.join(inner, "common", "f.txt"), "mod")).toBe("Inner");
    expect(resolver.labelFor(path.join(outer, "common", "f.txt"), "mod")).toBe("Outer");
  });

  it("renders the descriptor name in a definition hover card", () => {
    const root = makeMod("hover_mod", 'name="Mod Alpha Hover"\n');
    const resolver = new ModOriginResolver();
    resolver.setRoots([root]);

    const data = new ServerData();
    data.originLabel = (def) => resolver.labelFor(def.file, def.source);
    data.index.addAll([
      {
        name: "my_alpha_effect",
        kind: "scripted_effect",
        file: path.join(root, "common", "scripted_effects", "fx.txt"),
        line: 0,
        source: "mod",
      },
    ]);

    const text = "immediate = { my_alpha_effect = yes }";
    const doc = TextDocument.create("file:///mod/events/origin_hover.txt", "paradox", 1, text);
    const at = text.indexOf("my_alpha_effect") + 3;
    const hover = provideHover(data, doc, { line: 0, character: at }, new Set(["character"]), null);
    const value = (hover!.contents as { value: string }).value;
    expect(value).toContain("**my_alpha_effect** · Mod Alpha Hover");
    expect(value).not.toContain("· mod");
  });

  it("scopes overview and overrides to one workspace mod, labels mod-vs-mod conflicts", () => {
    const a = makeMod("focus_a", 'name="Focus A"\n');
    const b = makeMod("focus_b", 'name="Focus B"\n');
    const resolver = new ModOriginResolver();
    resolver.setRoots([a, b]);

    const data = new ServerData();
    data.originLabel = (def) => resolver.labelFor(def.file, def.source);
    data.modRootOf = (file) => resolver.rootFor(file);
    const fileA = path.join(a, "common", "traits", "t.txt");
    const fileB = path.join(b, "common", "traits", "t.txt");
    data.index.addAll([
      { name: "shared_trait", kind: "trait", file: fileA, line: 0, source: "mod" },
      { name: "shared_trait", kind: "trait", file: fileB, line: 0, source: "mod" },
      { name: "only_b", kind: "trait", file: fileB, line: 1, source: "mod" },
    ]);

    const focusA = (file: string) => resolver.rootFor(file)?.toLowerCase() === a.toLowerCase();
    const overview = computeModOverview(data, focusA);
    expect(overview.totalDefs).toBe(1);
    expect(overview.kinds[0].defs.map((d) => d.name)).toEqual(["shared_trait"]);

    // Mod-vs-mod: A's trait reports B's twin as a shadowed site with B's name.
    const overrides = computeOverrides(data, null, focusA);
    expect(overrides).toHaveLength(1);
    expect(overrides[0].name).toBe("shared_trait");
    expect(overrides[0].mod.label).toBe("Focus A");
    expect(overrides[0].shadowed[0].label).toBe("Focus B");
    expect(overrides[0].note).toContain("load order");
  });

  it("clips pathological names to keep hover heads one line", () => {
    const long = makeMod("long", `name="${"X".repeat(80)}"\n`);
    const resolver = new ModOriginResolver();
    resolver.setRoots([long]);
    const label = resolver.labelFor(path.join(long, "f.txt"), "mod");
    expect(label.length).toBeLessThanOrEqual(40);
    expect(label.endsWith("…")).toBe(true);
  });
});
