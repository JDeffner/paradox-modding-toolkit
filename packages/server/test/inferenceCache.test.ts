import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Definition, TokenData } from "@px-lsp/protocol/types";
import { ServerData } from "../src/serverData";
import { getParse, getSavedScopes } from "../src/parseCache";
import { callSiteScopes, inferenceContextFor, variableTypes } from "../src/scopes/varTypes";
import { computeScopeAt } from "../src/features/scopeAt";
import { provideHover } from "../src/features/hover";
import { CompletionFeature } from "../src/features/completion";
import { DefinitionIndex } from "../src/index/indexer";
import { extractReferences, ReferenceIndex } from "../src/index/references";
import { loadSchema } from "../src/schema/loader";
import type { SchemaEntry } from "../src/schema/types";

// Miniature script_docs rows already exercised by scopeAt.test.ts.
const CAPITAL: TokenData = {
  name: "capital_province",
  kind: "event_target",
  doc: "",
  scopes: ["input: character", "output: province"],
};
const CHARACTER = new Set(["character"]);
let sequence = 0;
function document(text: string): TextDocument {
  return TextDocument.create(`file:///mod/events/inference-cache-${sequence++}.txt`, "paradox", 1, text);
}
function def(name: string, kind: string, value?: string): Definition {
  return { name, kind, value, file: "events/source.txt", line: 0, source: "mod" };
}
function saved(data: ServerData, doc: TextDocument, root = CHARACTER, entry: SchemaEntry | null = null) {
  return getSavedScopes(doc, data.scopeModel, root, entry?.ambientScopes, inferenceContextFor(data, entry));
}

describe("inference cache refresh without document edits", () => {
  it("refreshes scopeAt, hover and completion after token reload while retaining the parse", () => {
    const data = new ServerData();
    const schema = loadSchema(null);
    const entry = schema.entries.find((e) => e.kind === "event")!;
    const completion = new CompletionFeature(data, () => schema);
    const text =
      "e = {\n immediate = {\n capital_province = { save_scope_as = target }\n scope:target = {\n \n }\n }\n}";
    const doc = document(text);
    const completionDoc = document(text.replace("scope:target", "scope:"));
    const parse = getParse(doc).result;
    const read = () => ({
      scope: computeScopeAt(data, doc, doc.positionAt(text.indexOf("\n \n") + 2), CHARACTER, entry).scopes,
      hover: JSON.stringify(
        provideHover(data, doc, doc.positionAt(text.indexOf("scope:target") + 8), CHARACTER, entry)
      ),
      completion: completion
        .provide(completionDoc, completionDoc.getText().indexOf("scope:") + 6, CHARACTER, entry)
        .items.find((item) => item.label === "target")?.detail,
    });
    const before = read();
    expect(before.scope).toEqual(["character"]);
    expect(before.hover).toContain("character");
    expect(before.completion).toContain("character");
    data.setTokens([CAPITAL]);
    const after = read();
    expect(after.scope).toEqual(["province"]);
    expect(after.hover).toContain("province");
    expect(after.completion).toContain("province");
    expect(getParse(doc).result).toBe(parse);
  });

  it("refreshes variables, lists and call-site roots after tokens change", () => {
    const data = new ServerData();
    data.rootScopesForFile = () => CHARACTER;
    data.index.addAll([
      def("capital", "variable", "root.capital_province"),
      def("places", "variable_list", "root.capital_province"),
    ]);
    data.refIndex.addAll(
      extractReferences(
        "e = { immediate = { capital_province = { helper = yes } } }",
        "events/source.txt",
        "mod",
        loadSchema(null)
      ).references
    );
    const doc = document("helper = { save_scope_as = target }");
    const entry = { path: "common/scripted_effects", kind: "scripted_effect" } as SchemaEntry;
    expect(variableTypes(data, data.rootScopesForFile).types.get("var:capital")).toBeNull();
    expect(callSiteScopes(data, data.rootScopesForFile).get("helper")).toEqual(CHARACTER);
    expect(saved(data, doc, CHARACTER, entry).get("target")).toEqual(CHARACTER);
    data.setTokens([CAPITAL]);
    expect(variableTypes(data, data.rootScopesForFile).types.get("var:capital")).toEqual(
      new Set(["province"])
    );
    expect(variableTypes(data, data.rootScopesForFile).listItemTypes.get("var:places")).toEqual(
      new Set(["province"])
    );
    expect(callSiteScopes(data, data.rootScopesForFile).get("helper")).toEqual(new Set(["province"]));
    expect(saved(data, doc, CHARACTER, entry).get("target")).toEqual(new Set(["province"]));
  });

  it("refreshes an unchanged dependent document after definitions and tags change", () => {
    const data = new ServerData();
    data.index.addAll([def("shared", "saved_scope", "type:value")]);
    const doc = document("e = { scope:shared = { save_scope_as = target } }");
    expect(saved(data, doc).get("target")).toEqual(new Set(["value"]));
    data.index.removeFile("events/source.txt");
    data.index.addAll([def("shared", "saved_scope", "expr:yes")]);
    expect(saved(data, doc).get("target")).toEqual(new Set(["boolean"]));
    const effect = document("helper = { save_scope_as = target }");
    const entry = { path: "common/scripted_effects", kind: "scripted_effect" } as SchemaEntry;
    expect(saved(data, effect, CHARACTER, entry).get("target")).toEqual(CHARACTER);
    data.index.addAll([{ ...def("helper", "scripted_effect"), tags: [{ tag: "scope", text: "province" }] }]);
    expect(saved(data, effect, CHARACTER, entry).get("target")).toEqual(new Set(["province"]));
  });

  it("does not reuse equal revision numbers from replacement indexes", () => {
    const data = new ServerData();
    data.rootScopesForFile = () => CHARACTER;
    data.setTokens([CAPITAL]);
    const populate = (chain: string) => {
      data.index.addAll([def("x", "variable", chain === "" ? "root" : "root.capital_province")]);
      data.refIndex.addAll(
        extractReferences(
          `e = { immediate = { ${chain ? `${chain} = { helper = yes }` : "helper = yes"} } }`,
          "events/source.txt",
          "mod",
          loadSchema(null)
        ).references
      );
    };
    populate("");
    expect(variableTypes(data, data.rootScopesForFile).types.get("var:x")).toEqual(CHARACTER);
    expect(callSiteScopes(data, data.rootScopesForFile).get("helper")).toEqual(CHARACTER);
    data.index = new DefinitionIndex();
    data.refIndex = new ReferenceIndex();
    populate("capital_province");
    expect(variableTypes(data, data.rootScopesForFile).types.get("var:x")).toEqual(new Set(["province"]));
    expect(callSiteScopes(data, data.rootScopesForFile).get("helper")).toEqual(new Set(["province"]));
  });

  it("refreshes root resolvers, schema context and on-action roots", () => {
    const data = new ServerData();
    let root = CHARACTER;
    data.rootScopesForFile = () => root;
    data.index.addAll([def("x", "variable", "root")]);
    expect(variableTypes(data, data.rootScopesForFile).types.get("var:x")).toEqual(CHARACTER);
    root = new Set(["province"]);
    data.invalidateInference();
    expect(variableTypes(data, data.rootScopesForFile).types.get("var:x")).toEqual(root);
    data.rootScopesForFile = () => new Set(["value"]);
    expect(variableTypes(data, data.rootScopesForFile).types.get("var:x")).toEqual(new Set(["value"]));
    const doc = document("e = { save_scope_as = target }");
    expect(saved(data, doc).get("target")).toEqual(CHARACTER);
    expect(saved(data, doc, root).get("target")).toEqual(root);
    const entry = { path: "common/on_action", kind: "on_action" } as SchemaEntry;
    data.onActionScopes = new Map([["e", "character"]]);
    expect(saved(data, doc, root, entry).get("target")).toEqual(CHARACTER);
    data.onActionScopes = new Map([["e", "province"]]);
    expect(saved(data, doc, root, entry).get("target")).toEqual(root);
    const ambientDoc = document("e = { scope:actor = { save_scope_as = target } }");
    const ambientEntry = { ...entry, ambientScopes: [{ name: "actor", type: "character", doc: "" }] };
    expect(saved(data, ambientDoc, root, ambientEntry).get("target")).toEqual(CHARACTER);
    expect(
      saved(data, ambientDoc, root, {
        ...ambientEntry,
        ambientScopes: [{ name: "actor", type: "province", doc: "" }],
      }).get("target")
    ).toEqual(root);
  });

  it("refreshes saved scopes after scripted-list bases change", () => {
    const data = new ServerData();
    data.setTokens([CAPITAL]);
    data.index.addAll([def("places", "scripted_list", "capital_province")]);
    data.notifyIndexChanged();
    const doc = document("e = { every_places = { save_scope_as = target } }");
    expect(saved(data, doc).get("target")).toEqual(new Set(["province"]));
    data.index.removeFile("events/source.txt");
    data.notifyIndexChanged();
    expect(saved(data, doc).get("target")).toEqual(CHARACTER);
  });
});
