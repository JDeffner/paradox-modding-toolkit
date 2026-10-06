import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { URI } from "vscode-uri";
import { TextDocument } from "vscode-languageserver-textdocument";
import { devPath } from "../../../scripts/devPaths";
import { setActiveProfile } from "../src/games/active";
import { resolveProfile } from "../src/games/registry";
import { loadSchema } from "../src/schema/loader";
import { classifyFile, scanRoot } from "../src/index/indexer";
import { extractDefinitions } from "../src/index/extract";
import { extractReferences } from "../src/index/references";
import { parseScript } from "../src/parser";
import { ServerData } from "../src/serverData";
import { CompletionFeature } from "../src/features/completion";
import { provideDefinition } from "../src/features/definition";
import { provideReferences } from "../src/features/references";
import { provideHover } from "../src/features/hover";
import { inferScopeAt } from "../src/scopes/inference";
import { ScopeModel } from "../src/scopes/model";

const profile = resolveProfile("ck3");
beforeEach(() => setActiveProfile(profile));
let serial = 0;
function cursor(text: string, folder: string) {
  const offset = text.indexOf("|");
  const file = path.resolve("mod", folder, `crozier-${serial++}.txt`);
  const doc = TextDocument.create(URI.file(file).toString(), "paradox", 1, text.replace("|", ""));
  return { doc, offset, position: doc.positionAt(offset), file };
}

function environment() {
  const schema = loadSchema(null);
  const data = new ServerData();
  for (const kind of ["faith", "rite", "tenet", "doctrine", "holy_site"]) {
    const entry = schema.entries.find((e) => e.kind === kind)!;
    data.index.addAll(
      extractDefinitions("shared = {}", entry, path.resolve("mod", entry.path, "defs.txt"), "mod")
    );
  }
  return { schema, data, completion: new CompletionFeature(data, () => schema) };
}

describe("Crozier religion databases", () => {
  it.each(["faith", "rite", "tenet"])(
    "indexes standalone %s definitions without treating structural children as definitions",
    (kind) => {
      const schema = loadSchema(null);
      const folder = `common/religion/${kind}_types`;
      const file = path.resolve("mod", folder, "test.txt");
      const entry = classifyFile(path.resolve("mod"), file, schema.entries)!;
      expect(entry?.kind).toBe(kind);
      const text = "@local = 1\ncustom = { name = { first_valid = { desc = custom_name } } }";
      expect(extractDefinitions(text, entry, file, "mod").map((d) => [d.name, d.kind])).toEqual([
        ["custom", kind],
      ]);
    }
  );

  it("keeps legacy nested faith definitions alongside standalone faiths", () => {
    const schema = loadSchema(null);
    const entry = schema.entries.find((e) => e.kind === "religion")!;
    const defs = extractDefinitions(
      "legacy_religion = { faiths = { legacy_faith = { doctrine = old_tenet } } }",
      entry,
      "legacy.txt",
      "mod"
    );
    expect(defs.map((d) => [d.name, d.kind])).toEqual([
      ["legacy_religion", "religion"],
      ["legacy_faith", "faith"],
    ]);
    const { data, completion } = environment();
    data.index.addAll(defs);
    const p = cursor("character = { faith = | }", "history/characters");
    expect(completion.provide(p.doc, p.offset, null).items.map((item) => item.label)).toEqual(
      expect.arrayContaining(["legacy_faith", "shared"])
    );
  });

  it.each([
    ["faith", "faith_details"],
    ["faith", "main_rite"],
    ["rite", "faith"],
    ["rite", "create"],
    ["tenet", "piety_cost"],
    ["tenet", "can_pick_as_personal_tenet"],
  ])("offers documented %s field %s at definition level", (kind, key) => {
    const { schema, completion } = environment();
    const p = cursor("custom = {\n |\n}", `common/religion/${kind}_types`);
    const entry = schema.entries.find((e) => e.kind === kind)!;
    const offered = completion.provide(p.doc, p.offset, new Set(entry.rootScopes), entry).items;
    expect(offered.some((item) => item.label === key)).toBe(true);
  });

  it("offers faith_details fields and shows their source documentation", () => {
    const { data, schema, completion } = environment();
    const entry = schema.entries.find((e) => e.kind === "faith")!;
    const p = cursor("custom = { faith_details = { | } }", entry.path);
    const labels = completion
      .provide(p.doc, p.offset, new Set(["faith"]), entry)
      .items.map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(["religion", "religious_head", "head_of_rite"]));
    expect(labels).not.toContain("main_rite");
    const hoverAt = cursor("custom = { faith_details = { reli|gion = custom_religion } }", entry.path);
    const hover = provideHover(data, hoverAt.doc, hoverAt.position, new Set(["faith"]), entry, () => schema);
    expect((hover?.contents as { value: string }).value).toContain("faith_types");
    expect((hover?.contents as { value: string }).value).toContain("Required parent religion");
  });

  it.each([
    ["faith", "faith = ", "faith"],
    ["faith", "main_rite = ", "rite"],
    ["rite", "tenets = { ", "tenet"],
    ["rite", "doctrines = { ", "doctrine"],
    ["faith", "eminent_holy_sites = { ", "holy_site"],
    ["faith", "holy_sites = { ", "holy_site"],
    ["faith", "set_character_rite = ", "rite"],
    ["faith", "set_county_faith = ", "faith"],
    ["faith", "has_tenet = ", "tenet"],
    ["rite", "rite_has_tenet = ", "tenet"],
  ])("completes and resolves %s %s to %s with colliding IDs", (fileKind, field, targetKind) => {
    const { schema, data, completion } = environment();
    const entry = schema.entries.find((e) => e.kind === fileKind)!;
    const close = field.includes("{") ? "} }" : "}";
    const p = cursor(`custom = { ${field}| ${close}`, entry.path);
    const items = completion.provide(p.doc, p.offset, new Set(entry.rootScopes), entry).items;
    expect(items.map((item) => item.label)).toEqual(["shared"]);
    const atName = cursor(`custom = { ${field}sha|red ${close}`, entry.path);
    const target = data.index.lookupAll("shared").find((d) => d.kind === targetKind)!;
    expect(provideDefinition(data, atName.doc, atName.position).map((location) => location.uri)).toEqual([
      URI.file(target.file).toString(),
    ]);
    expect(
      extractReferences(atName.doc.getText(), atName.file, "mod", schema).references.some(
        (ref) => ref.name === "shared" && ref.kinds.includes(targetKind)
      )
    ).toBe(true);
  });

  it("completes rite scope prefixes and navigates their definitions and scope-block usages", async () => {
    const { schema, data, completion } = environment();
    const p = cursor("event.1 = { immediate = { set_character_rite = rite:| } }", "events");
    expect(completion.provide(p.doc, p.offset, null).items.map((item) => item.label)).toEqual(["shared"]);
    const atName = cursor("event.1 = { immediate = { set_character_rite = rite:sha|red } }", "events");
    expect(provideDefinition(data, atName.doc, atName.position)[0].uri).toContain("rite_types");
    expect(extractReferences(atName.doc.getText(), atName.file, "mod", schema).references).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "shared", kinds: ["rite"] })])
    );
    const block = cursor(
      "event.1 = { immediate = { rite:sha|red = { save_scope_as = selected_rite } } }",
      "events"
    );
    data.refIndex.addAll(extractReferences(block.doc.getText(), block.file, "mod", schema).references);
    expect(
      (await provideReferences(data, atName.doc, atName.position, false)).map((location) => location.uri)
    ).toEqual([block.doc.uri]);
  });

  it.each([
    ["piety_cost", "rite"],
    ["can_pick", "faith"],
    ["can_pick_as_personal_tenet", "character"],
  ])("uses documented %s root %s", (key, scope) => {
    const schema = loadSchema(null);
    const entry = schema.entries.find((e) => e.kind === "tenet")!;
    const p = cursor(`custom = { ${key} = { | } }`, entry.path);
    const inferred = inferScopeAt(
      parseScript(p.doc.getText()),
      p.offset,
      new ScopeModel([]),
      new Set(["faith"]),
      new Map(),
      { entry }
    );
    expect(inferred.scopes).toEqual(new Set([scope]));
  });
});

const gamePath = devPath("gamePath");
describe.skipIf(!gamePath)("installed Crozier religion corpus", () => {
  it("indexes the shipped standalone definitions through the real folder scanner", () => {
    const schema = loadSchema(null);
    const entries = schema.entries.filter((entry) => ["faith", "rite", "tenet"].includes(entry.kind));
    for (const entry of entries) expect(fs.existsSync(path.join(gamePath!, entry.path))).toBe(true);
    const definitions = scanRoot(gamePath!, "vanilla", { entries, locLanguage: "english" });
    const counts = Object.fromEntries(
      entries.map((entry) => [entry.kind, definitions.filter((def) => def.kind === entry.kind).length])
    );
    expect(definitions.some((def) => def.kind === "faith" && def.name === "akom_pagan")).toBe(true);
    expect(definitions.some((def) => def.kind === "rite" && def.name === "roman_rite")).toBe(true);
    expect(definitions.some((def) => def.kind === "tenet" && def.name === "tenet_aniconism")).toBe(true);
    console.log("Crozier religion definitions", counts);
  });
});
