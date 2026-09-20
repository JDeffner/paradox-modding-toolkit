import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import type { Definition } from "@px-lsp/protocol/types";
import { ServerData } from "../src/serverData";
import { allProfiles, defaultProfile } from "../src/games/registry";
import { setActiveProfile } from "../src/games/active";
import { loadSchema } from "../src/schema/loader";
import { CompletionFeature } from "../src/features/completion";
import { provideDefinition } from "../src/features/definition";
import { provideReferences } from "../src/features/references";
import { provideRename } from "../src/features/rename";
import { expectedKindsAt } from "../src/features/symbolResolution";
import { detectContextFromParse } from "../src/context";
import { parseScript } from "../src/parser";
import { provideHover } from "../src/features/hover";
import { provideSignatureHelp } from "../src/features/signatureHelp";
import { provideSemanticTokens, SEMANTIC_LEGEND } from "../src/features/semanticTokens";
import { provideWorkspaceSymbols } from "../src/features/workspaceSymbols";
import { extractReferences } from "../src/index/references";
import { computeDependencies } from "../src/overview/dependencies";
import { computeReferenceDiagnostics, computeRequiredLocDiagnostics } from "../src/features/diagnostics";
import { resolveClientCapabilities, setClientCapabilities } from "../src/clientMode";

let sequence = 0;
let fixtureId = 0;
function at(text: string, file = `/mod/events/symbol-${sequence++}.txt`) {
  const offset = text.indexOf("|");
  const document = TextDocument.create(URI.file(file).toString(), "paradox", 1, text.replace("|", ""));
  return { document, offset, position: document.positionAt(offset) };
}
function def(name: string, kind: string, source: Definition["source"] = "mod"): Definition {
  return {
    name,
    kind,
    source,
    file: `/${source}/${loadSchema(null).entries.find((e) => e.kind === kind)?.path ?? kind}/symbols-${fixtureId}.txt`,
    line: 0,
  };
}
beforeEach(() => {
  fixtureId++;
  setClientCapabilities(
    resolveClientCapabilities({}, { workspace: { workspaceEdit: { documentChanges: true } } })
  );
});
afterEach(() => {
  setActiveProfile(defaultProfile);
  setClientCapabilities(resolveClientCapabilities({ clientCommands: true }));
});

describe("symbol identity includes its definition kind", () => {
  it.each(allProfiles().map((p) => [p.id, p] as const))(
    "preserves independent kinds in %s",
    (_id, profile) => {
      setActiveProfile(profile);
      const data = new ServerData();
      data.index.addAll([
        def("shared", "scripted_trigger", "vanilla"),
        def("shared", "scripted_gui"),
        def("shared", "scripted_trigger", "parent"),
      ]);
      expect(data.index.lookup("shared").map((d) => [d.kind, d.source])).toEqual([
        ["scripted_gui", "mod"],
        ["scripted_trigger", "parent"],
      ]);
      expect([...data.index.entries()].map((d) => d.kind).sort()).toEqual([
        "scripted_gui",
        "scripted_trigger",
      ]);
      expect(provideWorkspaceSymbols(data, "shared")).toHaveLength(2);
    }
  );

  it("completes vanilla traits even when a mod or parent localizes the same name", () => {
    for (const source of ["mod", "parent"] as const) {
      const schema = loadSchema(null);
      const data = new ServerData();
      data.index.addAll([def("shrewd", "trait", "vanilla"), def("shrewd", "loc_key", source)]);
      const p = at("event.1 = { immediate = { random_list = { 10 = {\nadd_trait = shre|\n} } } }");
      const result = new CompletionFeature(data, () => schema).provide(p.document, p.offset, null);
      expect(result.items.map((i) => i.label)).toContain("shrewd");
    }
  });

  it("does not offer unrelated values when a known ref field has no definitions", () => {
    const data = new ServerData();
    data.setTokens([{ name: "scheme_target_character", kind: "event_target", scopes: [], doc: "" }]);
    const p = at("add_trait = shre|");
    expect(
      new CompletionFeature(data, () => loadSchema(null)).provide(p.document, p.offset, null).items
    ).toEqual([]);
  });

  it("uses trigger context while preserving all same-kind override sites", async () => {
    const data = new ServerData();
    data.index.addAll([
      def("shared", "scripted_gui"),
      def("shared", "scripted_trigger"),
      def("shared", "scripted_trigger", "parent"),
    ]);
    const p = at("event.1 = { trigger = { shared| = yes } }");
    data.refIndex.addAll(
      extractReferences(p.document.getText(), URI.parse(p.document.uri).fsPath, "mod", loadSchema(null))
        .references
    );
    const locations = provideDefinition(data, p.document, p.position);
    expect(locations).toHaveLength(2);
    expect(locations.every((l) => l.uri.includes("scripted_trigger"))).toBe(true);
    expect(
      (await provideReferences(data, p.document, p.position, true)).some((l) =>
        l.uri.includes("scripted_gui")
      )
    ).toBe(false);
  });

  it("honors an explicit dependency kind without falling back to another kind", () => {
    const data = new ServerData();
    data.index.addAll([def("shared", "scripted_gui"), def("shared", "scripted_trigger", "vanilla")]);
    expect(computeDependencies(data, loadSchema(null), "shared", "scripted_trigger").def?.kind).toBe(
      "scripted_trigger"
    );
    expect(computeDependencies(data, loadSchema(null), "shared", "trait").def).toBeNull();
  });

  it("does not let a loc key stand in for a missing event", () => {
    const data = new ServerData();
    data.modNamespaces.add("test");
    data.index.addAll([def("test.missing", "loc_key")]);
    const refs = extractReferences(
      "e = { trigger_event = test.missing }",
      "/mod/events/test.txt",
      "mod",
      loadSchema(null)
    ).references;
    expect(computeReferenceDiagnostics(refs, data).map((d) => d.code)).toContain("unknown-event");
  });

  it("preserves vanilla localization for a mod nickname with the same name", () => {
    const data = new ServerData();
    const nickname = def("nick_test", "nickname");
    data.index.addAll([nickname, def("nick_test", "loc_key", "vanilla")]);
    expect(
      computeRequiredLocDiagnostics(
        [nickname],
        loadSchema(null).entries.find((e) => e.kind === "nickname")!,
        data
      )
    ).toEqual([]);
  });
});

describe("rename preserves unrelated content", () => {
  it("does not rename another kind's declaration", () => {
    const data = new ServerData();
    const trigger = def("shared", "scripted_trigger");
    const gui = def("shared", "scripted_gui");
    data.index.addAll([trigger, gui]);
    const p = at("event.1 = { trigger = { shared| = yes } }");
    const docs = new Map(
      [trigger, gui].map((d) => [
        URI.file(d.file).toString(),
        TextDocument.create(URI.file(d.file).toString(), "paradox", 1, "shared = { }"),
      ])
    );
    docs.set(p.document.uri, p.document);
    data.refIndex.addAll(
      extractReferences(p.document.getText(), URI.parse(p.document.uri).fsPath, "mod", loadSchema(null))
        .references
    );
    const edit = provideRename(data, p.document, p.position, "renamed", (uri) => docs.get(uri));
    const uris =
      edit.documentChanges?.map((e) => ("textDocument" in e ? e.textDocument.uri : "")) ??
      Object.keys(edit.changes ?? {});
    expect(uris).toContain(URI.file(trigger.file).toString());
    expect(uris).not.toContain(URI.file(gui.file).toString());
  });

  it("rejects stale reference ranges instead of editing a different name", () => {
    const data = new ServerData();
    const target = def("shared", "scripted_trigger");
    data.index.addAll([target]);
    const p = at("shared| = { }", target.file);
    const old = at("e = { trigger = { shared| = yes } }");
    data.refIndex.addAll(
      extractReferences(old.document.getText(), URI.parse(old.document.uri).fsPath, "mod", loadSchema(null))
        .references
    );
    const dirty = TextDocument.create(
      old.document.uri,
      "paradox",
      2,
      old.document.getText().replace("shared", "others")
    );
    expect(() =>
      provideRename(data, p.document, p.position, "renamed", (uri) =>
        uri === dirty.uri ? dirty : p.document
      )
    ).toThrow(/changed|stale/i);
  });
});

describe("grammar controls symbol type across providers", () => {
  it.each([
    ["e = { trigger = { same| = yes } }", "scripted_trigger"],
    ["e = { immediate = { same| = yes } }", "scripted_effect"],
    ["e = { immediate = { random_list = { 10 = { same| = yes } } } }", "scripted_effect"],
    ["scripted_trigger inline_name = { same| = yes }", "scripted_trigger"],
    ["scripted_effect inline_name = { same| = yes }", "scripted_effect"],
    ["e = { add_trait = same| }", "trait"],
    ["e = { on_actions = { same| } }", "on_action"],
    ["e = { trigger_event = { id = same| } }", "event"],
    ["e = { x = culture:same| }", "culture"],
    ["e = { scope:same| = { } }", "saved_scope"],
    ["e = { every_in_list = { variable = same| } }", "variable_list"],
  ])("resolves %s as %s", (text, kind) => {
    const p = at(text);
    expect(expectedKindsAt(p.document, p.position, loadSchema(null))).toContain(kind);
    const refs = extractReferences(
      p.document.getText(),
      URI.parse(p.document.uri).fsPath,
      "mod",
      loadSchema(null)
    ).references;
    expect(refs.filter((r) => r.name === "same").flatMap((r) => r.kinds)).toEqual([kind]);
  });

  it.each(["scripted_trigger", "scripted_effect"])("uses the %s file body as its context", (kind) => {
    const p = at("container = { same| = yes }", def("container", kind).file);
    const parse = parseScript(p.document.getText());
    expect(detectContextFromParse(parse, p.offset, kind).context).toBe(
      kind === "scripted_trigger" ? "trigger" : "effect"
    );
    expect(expectedKindsAt(p.document, p.position, loadSchema(null))).toEqual([kind]);
  });

  it.each(["ck3", "vic3"])("resolves GetScriptedGui arguments in %s", (id) => {
    setActiveProfile(allProfiles().find((p) => p.id === id)!);
    const data = new ServerData();
    data.index.addAll([def("shared", "scripted_trigger"), def("shared", "scripted_gui")]);
    const p = at(
      "window = { onclick = \"[GetScriptedGui('sha|red').Execute(GuiScope.End)]\" }",
      `/mod/gui/symbol-${sequence++}.gui`
    );
    expect(provideDefinition(data, p.document, p.position).map((l) => l.uri)).toEqual([
      URI.file(def("shared", "scripted_gui").file).toString(),
    ]);
  });

  it.each([
    ["set_variable = { name = sha|red value = 1 }", "variable"],
    ["save_scope_value_as = { name = sha|red value = 1 }", "saved_scope"],
    ["add_character_flag = { flag = sha|red }", "flag"],
  ])("keeps implicit declarations separate from loc names in %s", (body, kind) => {
    const data = new ServerData();
    const p = at(`event.1 = { immediate = { ${body} } }`);
    const implicit = extractReferences(
      p.document.getText(),
      URI.parse(p.document.uri).fsPath,
      "mod",
      loadSchema(null)
    ).implicitDefs;
    data.index.addAll([...implicit, def("shared", "loc_key")]);
    expect(expectedKindsAt(p.document, p.position, loadSchema(null))).toEqual([kind]);
    expect(provideDefinition(data, p.document, p.position).map((l) => l.uri)).toEqual([p.document.uri]);
  });

  it("does not resolve names or prefixes inside comments", () => {
    const data = new ServerData();
    data.index.addAll([def("shared", "scripted_trigger"), def("shared", "saved_scope")]);
    for (const text of ["# sha|red = yes", "# scope:sha|red", "# [GetScriptedGui('sha|red')]"]) {
      const p = at(text);
      expect(provideDefinition(data, p.document, p.position)).toEqual([]);
    }
  });

  it("keeps trigger and effect call sites separate in references and dependencies", async () => {
    const data = new ServerData();
    data.index.addAll([def("shared", "scripted_effect"), def("shared", "scripted_trigger")]);
    const p = at("event.1 = {\n trigger = { shared| = yes }\n immediate = { shared = yes }\n}");
    data.refIndex.addAll(
      extractReferences(p.document.getText(), URI.parse(p.document.uri).fsPath, "mod", loadSchema(null))
        .references
    );
    expect(
      (await provideReferences(data, p.document, p.position, false)).map((l) => l.range.start.line)
    ).toEqual([1]);
    expect(
      computeDependencies(data, loadSchema(null), "shared", "scripted_effect")
        .dependents.flatMap((g) => g.items)
        .map((i) => i.line)
    ).toEqual([2]);
  });

  it("uses the same kind for hover, signature help and semantic highlighting", () => {
    const data = new ServerData();
    data.index.addAll([
      { ...def("shared", "scripted_gui"), params: ["GUI_PARAM"] },
      { ...def("shared", "scripted_trigger"), params: ["TRIGGER_PARAM"] },
    ]);
    const p = at("event.1 = { trigger = { sha|red = yes } }");
    const md = (
      provideHover(data, p.document, p.position, null, null, () => loadSchema(null))?.contents as {
        value: string;
      }
    )?.value;
    expect(md).toContain("scripted trigger");
    expect(md).not.toContain("scripted gui");
    const call = at("event.1 = { trigger = { shared = { | } } }");
    const signature = provideSignatureHelp(data, call.document, call.position);
    expect(JSON.stringify(signature)).toContain("TRIGGER_PARAM");
    expect(JSON.stringify(signature)).not.toContain("GUI_PARAM");
    const tokens = provideSemanticTokens(data, p.document, loadSchema(null).refFields).data;
    const start = p.document.getText().indexOf("shared");
    let character = 0;
    const hit = [];
    for (let i = 0; i < tokens.length; i += 5) {
      character += tokens[i + 1];
      if (character === start) hit.push(SEMANTIC_LEGEND.tokenTypes[tokens[i + 3]]);
    }
    expect(hit).toEqual(["macro"]);
  });
});

describe("rename validates all sources before returning edits", () => {
  function fixture() {
    const data = new ServerData();
    const target = def("shared", "scripted_trigger");
    data.index.addAll([target]);
    const p = at("sha|red = { always = yes }", target.file);
    const usage = at("event.1 = {\n trigger = { shared| = yes }\n unrelated = untouched\n}");
    data.refIndex.addAll(
      extractReferences(
        usage.document.getText(),
        URI.parse(usage.document.uri).fsPath,
        "mod",
        loadSchema(null)
      ).references
    );
    const docs = new Map([p.document, usage.document].map((d) => [d.uri, d]));
    return {
      data,
      target,
      p,
      usage,
      docs,
      rename: (writable?: (file: string) => boolean) =>
        provideRename(
          data,
          p.document,
          p.position,
          "renamed",
          (uri) => docs.get(uri),
          loadSchema(null),
          writable
        ),
    };
  }

  it("returns versioned edits which preserve unrelated text", () => {
    const f = fixture();
    const result = f.rename();
    expect(result.changes).toBeUndefined();
    expect(result.documentChanges).toHaveLength(2);
    for (const edit of result.documentChanges!) {
      if (!("textDocument" in edit)) throw new Error("Expected TextDocumentEdit");
      expect(edit.textDocument.version).toBe(1);
      const original = f.docs.get(edit.textDocument.uri)!;
      const text = TextDocument.applyEdits(
        original,
        edit.edits.map((e) => {
          if (!("newText" in e)) throw new Error("Unexpected snippet edit");
          return e;
        })
      );
      expect(text).toBe(original.getText().replace("shared", "renamed"));
    }
  });

  it("rejects read-only files and missing source files", () => {
    const f = fixture();
    expect(() => f.rename(() => false)).toThrow(/read-only/);
    f.docs.delete(f.usage.document.uri);
    expect(() => f.rename()).toThrow(/Cannot read/);
  });

  it("rejects a stale declaration even when its old name survives in a comment", () => {
    const f = fixture();
    f.docs.set(f.p.document.uri, TextDocument.create(f.p.document.uri, "paradox", 2, "other = { } # shared"));
    expect(() => f.rename()).toThrow(/declaration changed/);
  });

  it("refuses ambiguous call sites instead of guessing their kind", () => {
    const f = fixture();
    f.data.index.addAll([def("shared", "scripted_effect")]);
    const p = at("event.1 = { unknown_block = { shared| = yes } }");
    expect(() => provideRename(f.data, p.document, p.position, "renamed", (uri) => f.docs.get(uri))).toThrow(
      /several possible symbol types/
    );
  });

  it("rejects renaming onto another existing definition of the same kind", () => {
    const f = fixture();
    f.data.index.addAll([def("renamed", "scripted_trigger")]);
    expect(() => f.rename()).toThrow(/already exists/);
  });

  it("requires saving unsaved sources if the client cannot version-check edits", () => {
    const f = fixture();
    setClientCapabilities(resolveClientCapabilities({}));
    expect(() => f.rename()).toThrow(/Save first/);
  });
});
