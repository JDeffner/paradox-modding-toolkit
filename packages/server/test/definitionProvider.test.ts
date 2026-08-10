import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { provideDefinition } from "../src/features/definition";
import { provideReferences } from "../src/features/references";
import { ServerData } from "../src/serverData";
import type { Definition, Reference } from "@px-lsp/protocol/types";

const def = (source: Definition["source"], file: string, line = 0): Definition => ({
  name: "shared_effect",
  kind: "scripted_effect",
  file,
  line,
  source,
});

function dataWith(defs: Definition[]): ServerData {
  const data = new ServerData();
  data.index.addAll(defs);
  return data;
}

const doc = TextDocument.create("file:///m/events/e.txt", "paradox", 1, "shared_effect = yes\n");

describe("provideDefinition", () => {
  it("lists every source, mod first, instead of hiding shadowed ones (#4)", () => {
    const data = dataWith([
      def("vanilla", "/game/common/scripted_effects/a.txt"),
      def("parent", "/parent/common/scripted_effects/a.txt"),
      def("mod", "/mod/common/scripted_effects/a.txt"),
    ]);
    const locations = provideDefinition(data, doc, { line: 0, character: 3 });
    expect(locations.map((l) => URI.parse(l.uri).fsPath.split(/[\\/]/)[1])).toEqual([
      "mod",
      "parent",
      "game",
    ]);
  });
});

describe("provideDefinition doc-local fallback", () => {
  it("answers from the open document when the index has nothing (#5)", () => {
    const data = new ServerData(); // empty index: vanilla not (yet) scanned
    const text = [
      "namespace = tgp",
      "scripted_effect tgp_give_effect = {",
      "\tadd_gold = 5",
      "}",
      "tgp.1 = {",
      "\timmediate = { tgp_give_effect = yes }",
      "}",
    ].join("\n");
    const eventDoc = TextDocument.create("file:///game/events/e.txt", "paradox", 1, text);
    const docDefs = (word: string) =>
      (
        [
          {
            name: "tgp_give_effect",
            kind: "scripted_effect",
            file: "/game/events/e.txt",
            line: 1,
            source: "vanilla",
          },
        ] as Definition[]
      ).filter((d) => d.name === word);
    const locations = provideDefinition(data, eventDoc, { line: 5, character: 20 }, docDefs);
    expect(locations).toHaveLength(1);
    expect(locations[0].uri).toBe("file:///game/events/e.txt");
    expect(locations[0].range.start.line).toBe(1);
    // Indexed answers keep precedence: no doc-local duplicates once indexed.
    data.index.addAll([
      {
        name: "tgp_give_effect",
        kind: "scripted_effect",
        file: "/game/events/e.txt",
        line: 1,
        source: "vanilla",
      },
    ]);
    expect(provideDefinition(data, eventDoc, { line: 5, character: 20 }, docDefs)).toHaveLength(1);
  });
});

describe("provideReferences", () => {
  it("merges on-demand vanilla usage sites with the indexed ones (#3)", async () => {
    const data = dataWith([def("mod", "/mod/common/scripted_effects/a.txt", 4)]);
    data.refIndex.addAll([
      {
        name: "shared_effect",
        kinds: ["scripted_effect"],
        file: "/mod/events/e.txt",
        line: 2,
        startChar: 1,
        endChar: 14,
      },
    ]);
    const lazy: Reference[] = [
      {
        name: "shared_effect",
        kinds: ["scripted_effect"],
        file: "/game/events/v.txt",
        line: 9,
        startChar: 1,
        endChar: 14,
      },
      // Textual hit at a known definition site (an inline declaration is not
      // at column 0): must be dropped, includeDeclaration covers it.
      {
        name: "shared_effect",
        kinds: [],
        file: "/mod/common/scripted_effects/a.txt",
        line: 4,
        startChar: 17,
        endChar: 30,
      },
    ];
    const locations = await provideReferences(data, doc, { line: 0, character: 3 }, false, () =>
      Promise.resolve(lazy)
    );
    expect(locations.map((l) => URI.parse(l.uri).fsPath.replace(/\\/g, "/"))).toEqual([
      "/mod/events/e.txt",
      "/game/events/v.txt",
    ]);
    // includeDeclaration appends the definition sites after the usages.
    const withDecl = await provideReferences(data, doc, { line: 0, character: 3 }, true, () =>
      Promise.resolve(lazy)
    );
    expect(withDecl).toHaveLength(3);
  });
});
