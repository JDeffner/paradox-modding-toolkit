/**
 * The perf-round-3 fused scan (src/index/fusedScan.ts) walks a mod root ONCE
 * for `.txt` and feeds one parse to both extractors, where the code it
 * replaced walked the ~156 schema folders for definitions and the whole root
 * again for references. The ways the fusion can silently diverge all change
 * results rather than fail: classification (`classifyFile` must find the same
 * schema entry the folder walk did, nested subfolders included, and leave
 * files outside every schema folder reference-only), schema-order definition
 * collection, and the non-`.txt` entries (localization `.yml`, `gui`), which
 * keep the folder walk and its `isWantedLocFile` language filter. Each shape
 * below is pinned directly on a fixture root that exercises it.
 */
import { afterAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Definition, Reference } from "@px-lsp/protocol/types";
import { pushAll } from "@px-lsp/protocol/arrays";
import { loadSchema } from "../src/schema/loader";
import { scanModRootFused } from "../src/index/fusedScan";

const LOC_LANGUAGE = "english";
/** Stands in for the server's script_docs token map. */
const isEngineToken = (name: string) => name === "add_gold" || name === "trigger_event";

const FILES: Record<string, string> = {
  // A schema folder whose definitions AND references both matter: the scripted
  // effects are definitions, and their bodies call other definitions, save
  // scopes and set variables.
  "common/scripted_effects/my_effects.txt": [
    "my_effect = {",
    "\tsave_scope_as = my_target",
    "\tadd_gold = 10",
    "\thelper_effect = yes",
    "\tset_variable = { name = my_var value = 3 }",
    "\tadd_character_flag = my_flag",
    "}",
    "",
    "helper_effect = {",
    "\tadd_trait = brave",
    "\ttrigger_event = my_mod.0001",
    "\tadd_to_list = my_list",
    "}",
    "",
  ].join("\n"),
  // Nested one level down: the folder walk finds it, so classifyFile must too.
  "common/scripted_effects/nested/more_effects.txt": [
    "nested_effect = {",
    "\thas_trait = brave",
    "\tsave_scope_as = nested_target",
    "}",
    "",
  ].join("\n"),
  // A different extraction mode (event ids), plus namespaces.
  "events/my_events.txt": [
    "namespace = my_mod",
    "",
    "my_mod.0001 = {",
    "\ttype = character_event",
    "\ttitle = my_mod.0001.t",
    "\timmediate = {",
    "\t\tmy_effect = yes",
    "\t\tsave_scope_as = event_target",
    "\t}",
    "}",
    "",
  ].join("\n"),
  // Trait group + required-loc shapes, another schema folder.
  "common/traits/my_traits.txt": [
    "my_trait = {",
    "\tgroup = my_trait_group",
    "\tdesc = my_trait_desc",
    "}",
    "",
  ].join("\n"),
  // Outside EVERY schema folder: reference-only, and the reason the reference
  // pass walked the whole root rather than the schema folders.
  "gfx/portraits/notes.txt": [
    "some_block = {",
    "\thas_trait = brave",
    "\tadd_character_flag = loose_flag",
    "\ttrigger_event = my_mod.0001",
    "}",
    "",
  ].join("\n"),
  "music/loose_music.txt": "sound_block = { has_trait = brave }\n",
  // Localization: `.yml`, so it keeps the schema-folder path.
  "localization/english/my_l_english.yml": [
    "l_english:",
    ' my_mod.0001.t:0 "A title"',
    ' my_trait_desc:0 "A trait"',
    "",
  ].join("\n"),
  // Wrong language: the folder pass filters it out and so must the fused one.
  "localization/french/my_l_french.yml": ["l_french:", ' my_mod.0001.t:0 "Un titre"', ""].join("\n"),
  // `.gui`, the other non-`.txt` entry.
  "gui/my_window.gui": [
    "types MyTypes {",
    "\ttype my_widget = widget {",
    "\t\tsize = { 100 100 }",
    "\t}",
    "}",
    "template my_template {",
    "\tvisible = yes",
    "}",
    "",
  ].join("\n"),
};

const tempRoots: string[] = [];

function makeFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "px-fused-"));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(FILES)) {
    const file = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
  return root;
}

afterAll(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

function readStripBom(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  } catch {
    return null;
  }
}

interface ScanOutcome {
  defs: Definition[];
  implicitDefs: Definition[];
  references: Reference[];
  namespaces: Array<[string, string[]]>;
}

async function fused(root: string, schema: ReturnType<typeof loadSchema>): Promise<ScanOutcome> {
  const references: Reference[] = [];
  const namespaces: Array<[string, string[]]> = [];
  const result = await scanModRootFused(root, {
    schema,
    source: "mod",
    locLanguage: LOC_LANGUAGE,
    isEngineToken,
    readBatch: async (files) => files.map(readStripBom),
    superseded: () => false,
    yieldNow: async () => {},
    addReferences: (refs) => pushAll(references, refs),
    setNamespaces: (file, ns) => namespaces.push([file.toLowerCase(), ns]),
  });
  expect(result).not.toBeNull();
  return { defs: result!.defs, implicitDefs: result!.implicitDefs, references, namespaces };
}

describe("fused definition + reference scan", () => {
  const schema = loadSchema(null);
  const root = makeFixtureRoot();

  it("covers the shapes the fusion could break", async () => {
    const now = await fused(root, schema);
    const kinds = new Set(now.defs.map((d) => d.kind));
    // A file in a schema folder, a nested one, a different extraction mode,
    // the `.yml` entry and the `.gui` entry all contributed.
    expect(kinds).toContain("scripted_effect");
    expect(kinds).toContain("event");
    expect(kinds).toContain("trait");
    expect(kinds).toContain("loc_key");
    expect(kinds).toContain("gui_type");

    // The `.txt` outside every schema folder is reference-only.
    const loose = path.join(root, "gfx", "portraits", "notes.txt");
    expect(now.defs.some((d) => d.file === loose)).toBe(false);
    expect(now.references.some((r) => r.file === loose)).toBe(true);
    expect(now.implicitDefs.some((d) => d.file === loose && d.name === "loose_flag")).toBe(true);

    // A file whose definitions AND references both matter contributed both.
    const effects = path.join(root, "common", "scripted_effects", "my_effects.txt");
    expect(now.defs.some((d) => d.file === effects && d.name === "my_effect")).toBe(true);
    expect(now.references.some((r) => r.file === effects && r.name === "helper_effect")).toBe(true);

    // The wrong-language loc file stays out of the index.
    expect(now.defs.every((d) => !d.file.includes("french"))).toBe(true);
  });

  it("returns null and stops when a newer scan supersedes it", async () => {
    let reads = 0;
    const result = await scanModRootFused(root, {
      schema,
      source: "mod",
      locLanguage: LOC_LANGUAGE,
      isEngineToken,
      readBatch: async (files) => {
        reads++;
        return files.map(readStripBom);
      },
      superseded: () => reads > 0,
      yieldNow: async () => {},
      addReferences: () => {},
      setNamespaces: () => {},
    });
    expect(result).toBeNull();
    expect(reads).toBe(1); // aborted right after the first batch was read
  });
});
