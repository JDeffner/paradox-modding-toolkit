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
// CK3 1.20.0.3 common/laws/_laws.info: laws moved to top-level blocks.
const standaloneLaws = `audit_law = {
  law_group_type = audit_group
  can_keep = { always = yes }
  can_have = { always = yes }
}`;
const schema = loadSchema(null);
let serial = 0;
function indexed(kind: string, text: string) {
  const entry = CK3_SCHEMA.find((e) => (kind === "law_group" ? e.path === "common/laws" : e.kind === kind))!;
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

it("indexes standalone laws without indexing their trigger blocks as nested laws", () => {
  expect(
    indexed("law_group", standaloneLaws).defs.map(({ name, kind, container }) => ({ name, kind, container }))
  ).toEqual([{ name: "audit_law", kind: "law", container: undefined }]);
});

it("offers standalone law fields and their harvested game documentation", () => {
  const { entry, data } = indexed("law_group", standaloneLaws);
  const text = "audit_law = {\n law_group_type = audit_group\n \n}";
  const doc = TextDocument.create(`file:///audit/common/laws/fields-${serial++}.txt`, "paradox", 1, text);
  const completion = new CompletionFeature(data, () => schema);
  const items = completion.provide(doc, text.indexOf(" \n}") + 1, new Set(["character"]), entry).items;
  expect(items.map((item) => item.label)).toEqual(
    expect.arrayContaining(["law_group_type", "can_keep", "can_pass", "on_pass"])
  );
  const hover = provideHover(
    data,
    doc,
    doc.positionAt(text.indexOf("law_group_type") + 2),
    new Set(["character"]),
    entry,
    () => schema
  );
  expect(JSON.stringify(hover?.contents)).toContain("Mandatory");
  expect(JSON.stringify(hover?.contents)).toContain("*(laws)*");
});

it("offers legacy law group properties and their group documentation", () => {
  const text = "audit_group = {\n default = audit_law\n \n audit_law = {}\n}";
  const { entry, data, doc } = indexed("law_group", text);
  const completion = new CompletionFeature(data, () => schema);
  const items = completion.provide(doc, text.indexOf(" \n audit_law") + 1, null, entry).items;
  expect(items.map((item) => item.label)).toEqual(
    expect.arrayContaining(["default", "cumulative", "can_change_law_group"])
  );
  expect(items.map((item) => item.label)).not.toContain("law_group_type");
  const hover = provideHover(
    data,
    doc,
    doc.positionAt(text.indexOf("default") + 2),
    null,
    entry,
    () => schema
  );
  expect(JSON.stringify(hover?.contents)).toContain("law group key");
  expect(JSON.stringify(hover?.contents)).toContain("New rulers will use this law by default");
  expect(JSON.stringify(hover?.contents)).toContain("*(law_groups)*");
});

it("offers nested law fields without leaking them into the law's trigger body", () => {
  const text = "audit_group = {\n audit_law = {\n  \n  can_keep = {\n   \n  }\n }\n}";
  const { entry, data, doc } = indexed("law_group", text);
  const completion = new CompletionFeature(data, () => schema);
  const items = completion.provide(doc, text.indexOf("  \n  can_keep") + 2, null, entry).items;
  expect(items.map((item) => item.label)).toEqual(
    expect.arrayContaining(["can_keep", "can_pass", "on_pass"])
  );
  expect(items.map((item) => item.label)).not.toContain("can_change_law_group");
  const hover = provideHover(
    data,
    doc,
    doc.positionAt(text.indexOf("can_keep") + 2),
    null,
    entry,
    () => schema
  );
  expect(JSON.stringify(hover?.contents)).toContain("law key");
  expect(JSON.stringify(hover?.contents)).toContain("Requirements for keeping the law");
  expect(JSON.stringify(hover?.contents)).toContain("*(laws)*");
  const triggerItems = completion.provide(doc, text.indexOf("   \n  }") + 3, null, entry).items;
  for (const key of ["law_group_type", "can_keep", "can_pass", "on_pass", "can_change_law_group"]) {
    expect(triggerItems.map((item) => item.label)).not.toContain(key);
  }
});

it("uses the legacy group's boolean value contract", () => {
  const text = "audit_group = {\n cumulative = \n audit_law = {}\n}";
  const { entry, data, doc } = indexed("law_group", text);
  data.index.addAll([
    { name: "audit_value", kind: "script_value", file: "values.txt", line: 0, source: "mod" },
  ]);
  const completion = new CompletionFeature(data, () => schema);
  const items = completion.provide(
    doc,
    text.indexOf("cumulative = ") + "cumulative = ".length,
    null,
    entry
  ).items;
  expect(items.map((item) => item.label).sort()).toEqual(["no", "yes"]);
});

it("indexes separate law groups and resolves a standalone law's group reference", () => {
  const entry = CK3_SCHEMA.find((e) => e.path === "common/law_groups")!;
  const file = path.resolve(".local/testing/nested-definitions", entry.path, "groups.txt");
  const group = "audit_group = { default = audit_law can_change_law_group = { always = yes } }";
  const defs = extractDefinitions(group, entry, file, "mod");
  expect(defs.map((d) => [d.name, d.kind])).toEqual([["audit_group", "law_group"]]);
  const { data, doc } = indexed("law_group", standaloneLaws);
  data.index.addAll(defs);
  const refs = extractReferences(standaloneLaws, URI.parse(doc.uri).fsPath, "mod", schema).references;
  expect(refs).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "audit_group", kinds: ["law_group"] })])
  );
  expect(
    provideDefinition(data, doc, doc.positionAt(standaloneLaws.indexOf("audit_group") + 2), undefined, schema)
  ).toEqual([
    {
      uri: URI.file(file).toString(),
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    },
  ]);
});

it("rejects invalid kind discriminators in a user schema overlay", () => {
  fs.mkdirSync(path.resolve(".local/testing"), { recursive: true });
  const root = fs.mkdtempSync(path.resolve(".local/testing/schema-kind-field-"));
  try {
    const config = path.join(root, ".px-toolkit");
    fs.mkdirSync(config);
    fs.writeFileSync(
      path.join(config, "schema.json"),
      JSON.stringify({
        entries: [
          {
            path: "common/invalid",
            kind: "custom",
            kindByField: { field: "marker", kind: "custom", otherwise: 42 },
          },
        ],
      })
    );
    const messages: string[] = [];
    const loaded = loadSchema(root, (message) => messages.push(message));
    expect(loaded.entries.some((entry) => entry.path === "common/invalid")).toBe(false);
    expect(messages).toContain("schema overlay entry ignored (invalid kind field): common/invalid");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it.each([
  ["religion", religion, "audit_faith", "faith", "faith = faith:"],
  ["law_group", laws, "audit_law", "law", "add_realm_law = "],
  ["law_group", standaloneLaws, "audit_law", "law", "add_realm_law = "],
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
    ["common/religion/religion_types", "00_christianity.txt", "faith", "catholic"],
    ["common/laws", "00_realm_laws.txt", "law", "crown_authority_0"],
    ...(gamePath && fs.existsSync(path.join(gamePath, "common/law_groups"))
      ? [["common/law_groups", "00_realm_law_groups.txt", "law_group", "crown_authority"]]
      : []),
  ])("extracts %s definitions from the installed game", (folder, name, childKind, wanted) => {
    // 1.20 separates faiths from religions. Earlier installs retain the nested corpus check.
    if (childKind === "faith" && fs.existsSync(path.join(gamePath!, "common/religion/faith_types"))) {
      folder = "common/religion/faith_types";
      name = "00_faith_types.txt";
    }
    const entry = CK3_SCHEMA.find((e) => e.path === folder)!;
    const file = path.join(gamePath!, entry.path, name);
    const text = fs.readFileSync(file, "utf8");
    const defs = extractDefinitions(text, entry, file, "vanilla");
    const def = defs.find((d) => d.name === wanted && d.kind === childKind);
    expect(def).toBeDefined();
    expect(text.split(/\r?\n/)[def!.line]).toMatch(new RegExp(`^\\s*${wanted}\\s*=`));
    expect(defs.some((d) => d.name === "can_change_law_group" || d.name === "virtues")).toBe(false);
  });
});
