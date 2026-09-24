import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { URI } from "vscode-uri";
import { TextDocument } from "vscode-languageserver-textdocument";
import { extractDefinitions } from "../src/index/extract";
import { extractReferences } from "../src/index/references";
import { CK3_SCHEMA } from "../src/games/ck3/schema";
import { loadSchema } from "../src/schema/loader";
import { ServerData } from "../src/serverData";
import { CompletionFeature } from "../src/features/completion";
import { provideDefinition } from "../src/features/definition";
import { provideHover } from "../src/features/hover";
import { provideReferences } from "../src/features/references";
import { prepareRename } from "../src/features/rename";
import { computeRequiredLocDiagnostics } from "../src/features/diagnostics";
import { devPath } from "../../../scripts/devPaths";

// Shapes from CK3 1.19.0.6 _religion_types.info and _laws.info. Names are test-local.
const religion = `audit_religion = {
  traits = { virtues = { brave } }
  faiths = {
    audit_faith = { color = { 1 0 0 } holy_site = rome }
    another_faith = {}
    @macro = { invalid = {} }
    not_a_definition = yes
  }
  localization = { HighGodName = god_key }
}`;
const laws = `audit_group = {
  default = audit_law
  can_change_law_group = { always = yes }
  audit_law = { can_keep = { always = yes } }
  another_law = {}
}`;
const schema = loadSchema(null);
let serial = 0;
function indexed(kind: string, text: string) {
  const entry = CK3_SCHEMA.find((e) => e.kind === kind)!;
  const file = path.resolve(".local/testing/nested-definitions", entry.path, `case-${serial++}.txt`);
  const defs = extractDefinitions(text, entry, file, "mod");
  const data = new ServerData();
  data.index.addAll(defs);
  const doc = TextDocument.create(URI.file(file).toString(), "paradox", 1, text);
  return { entry, file, defs, data, doc };
}

it("indexes faiths alongside their parent religion without treating properties as definitions", () => {
  const { defs } = indexed("religion", religion);
  expect(defs.map(({ name, kind, container, line }) => ({ name, kind, container, line }))).toEqual([
    { name: "audit_religion", kind: "religion", container: undefined, line: 0 },
    { name: "audit_faith", kind: "faith", container: "audit_religion", line: 3 },
    { name: "another_faith", kind: "faith", container: "audit_religion", line: 4 },
  ]);
});

it("indexes laws without indexing the group's trigger or the law's own properties", () => {
  expect(
    indexed("law_group", laws).defs.map(({ name, kind, container }) => ({ name, kind, container }))
  ).toEqual([
    { name: "audit_group", kind: "law_group", container: undefined },
    { name: "audit_law", kind: "law", container: "audit_group" },
    { name: "another_law", kind: "law", container: "audit_group" },
  ]);
});

it.each([
  ["religion", religion, "audit_faith", "faith", "faith = faith:"],
  ["law_group", laws, "audit_law", "law", "add_realm_law = "],
])(
  "resolves %s children through completion, hover, navigation and references",
  async (kind, text, name, childKind, field) => {
    const { entry, data, doc, file } = indexed(kind, text);
    // Same-name localization and scripted effects must not steal the declaration or use site.
    data.index.addAll([
      { name, kind: "loc_key", file: "strings.yml", line: 0, source: "mod", value: "Localized" },
      { name, kind: "scripted_effect", file: "effects.txt", line: 0, source: "mod" },
    ]);
    const declaration = doc.positionAt(text.indexOf(`${name} = {`) + 2);
    const target = provideDefinition(data, doc, declaration, undefined, schema);
    expect(target).toHaveLength(1);
    expect(target[0].uri).toBe(URI.file(file).toString());
    const hover = provideHover(data, doc, declaration, null, entry, () => schema);
    expect(JSON.stringify(hover?.contents)).toContain(childKind);
    expect(JSON.stringify(hover?.contents)).not.toContain("scripted effect");

    const partial = `audit.1 = {\n immediate = { ${field}`;
    const use = TextDocument.create(`file:///audit/events/nested-${serial++}.txt`, "paradox", 1, partial);
    const completion = new CompletionFeature(data, () => schema);
    expect(completion.provide(use, partial.length, null).items.map((i) => i.label)).toContain(name);
    const complete = TextDocument.create(
      `file:///audit/events/nested-${serial++}.txt`,
      "paradox",
      1,
      `${partial}${name} } }`
    );
    data.refIndex.addAll(
      extractReferences(complete.getText(), URI.parse(complete.uri).fsPath, "mod", schema).references
    );
    expect(
      provideDefinition(data, complete, complete.positionAt(partial.length + 2), undefined, schema)
    ).toEqual(target);
    const references = await provideReferences(data, doc, declaration, true, undefined, schema);
    expect(references.map((r) => r.uri).sort()).toEqual([doc.uri, complete.uri].sort());
    expect(() => prepareRename(data, doc, declaration, schema)).toThrow(/not all indirect reference forms/);
  }
);

it("does not apply the parent religion's localization contract to its children", () => {
  const { defs, entry, data } = indexed("religion", religion);
  const diagnostics = computeRequiredLocDiagnostics(defs, entry, data);
  expect(diagnostics.map((d) => d.data.key)).toEqual(["audit_religion"]);
});

it("re-extracts current unsaved text and removes deleted child definitions", () => {
  const { entry, file } = indexed("religion", religion);
  const updated = religion.replace("audit_faith", "changed_faith").replace("    another_faith = {}\n", "");
  const defs = extractDefinitions(updated, entry, file, "mod");
  expect(defs.filter((d) => d.kind === "faith").map((d) => d.name)).toEqual(["changed_faith"]);
});

const gamePath = devPath("gamePath");
describe.skipIf(!gamePath || !fs.existsSync(gamePath))("installed CK3 nested definitions", () => {
  it.each([
    ["religion", "00_christianity.txt", "faith", "catholic"],
    ["law_group", "00_realm_laws.txt", "law", "crown_authority_0"],
  ])("extracts %s children from the installed game", (kind, name, childKind, wanted) => {
    const entry = CK3_SCHEMA.find((e) => e.kind === kind)!;
    const file = path.join(gamePath!, entry.path, name);
    const text = fs.readFileSync(file, "utf8");
    const defs = extractDefinitions(text, entry, file, "vanilla");
    const def = defs.find((d) => d.name === wanted && d.kind === childKind);
    expect(def).toBeDefined();
    expect(text.split(/\r?\n/)[def!.line]).toMatch(new RegExp(`^\\s*${wanted}\\s*=`));
    expect(defs.some((d) => d.name === "can_change_law_group" || d.name === "virtues")).toBe(false);
  });
});
