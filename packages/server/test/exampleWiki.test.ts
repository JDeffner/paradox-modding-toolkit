/**
 * Examples Wiki: the catalog built from synthetic sources, one entry of each
 * kind, and the line matcher behind the vanilla example sites.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { TokenData } from "@px-lsp/protocol/types";
import type { ExampleWikiSite } from "@px-lsp/protocol/protocol";
import {
  buildExampleWikiIndex,
  collectSites,
  computeExampleWikiEntry,
  SiteFinder,
  type ExampleWikiSources,
  type WikiVariable,
} from "../src/overview/exampleWiki";
import { emptyDataTypes, type DataTypesData } from "../src/data/dataTypes";
import { emptyUsage, type DataFnUsage } from "../src/data/dataFnUsage";

const TOKENS: TokenData[] = [
  {
    name: "add_gold",
    kind: "effect",
    doc: "Adds gold to the character. Negative values take it away.",
    scopes: ["character"],
    usage: "add_gold = 100",
  },
  { name: "is_alive", kind: "trigger", doc: "Is the character alive?", scopes: ["character"] },
  { name: "liege", kind: "event_target", doc: "", scopes: ["character"], traits: "To scope: character" },
];

function dataTypes(): DataTypesData {
  const data = emptyDataTypes();
  data.globals.set("GetPlayer", { ret: "Character", args: null, kind: "promote", src: "dump" });
  data.types.set(
    "Character",
    new Map([
      ["GetName", { ret: "CString", args: null, kind: "function", src: "dump", desc: "The name shown." }],
      ["Custom", { ret: "CString", args: ["CString"], kind: "function", src: "dump" }],
    ])
  );
  data.typeNamesLower.set("character", "Character");
  data.source = "data_types.log";
  return data;
}

function usage(): DataFnUsage {
  const u = emptyUsage();
  u.starts.set("GetPlayer", 40);
  u.pairs.set("GetPlayer", new Map([["GetName", 12]]));
  u.memberPool.set("GetName", 12);
  u.literals.set("Custom", new Map([["FOO", 5]]));
  u.examples.set("GetName", [{ text: "[GetPlayer.GetName]", file: "gui/hud.gui", line: 7 }]);
  return u;
}

function sources(over: Partial<ExampleWikiSources> = {}): ExampleWikiSources {
  return {
    tokens: TOKENS,
    dataTypes: dataTypes(),
    usage: usage(),
    counts: { add_gold: 900, is_alive: 300 },
    tokenSource: "your own script_docs logs.",
    needsScriptDocs: false,
    gamePath: null,
    variables: new Map<string, WikiVariable>(),
    ...over,
  };
}

/** A mod variable with one set site and two reads, as server.ts gathers it. */
function variables(dir: string): Map<string, WikiVariable> {
  return new Map<string, WikiVariable>([
    [
      "variable:my_toll",
      {
        name: "my_toll",
        kind: "variable",
        sets: [{ file: path.join(dir, "effects.txt"), line: 2, container: "my_effect" }],
        setsTotal: 1,
        reads: [
          { file: path.join(dir, "effects.txt"), line: 3 },
          { file: path.join(dir, "effects.txt"), line: 4 },
        ],
        readsTotal: 9,
        types: ["value"],
        origins: ["My Mod"],
      },
    ],
  ]);
}

/** A finder with no game root: every lookup answers "nothing searched". */
function noSites(): SiteFinder {
  const finder = new SiteFinder();
  finder.setRoots(null, []);
  return finder;
}

describe("example wiki index", () => {
  it("carries one row per token, global, type and member, most used first", () => {
    const index = buildExampleWikiIndex(sources());
    const names = index.entries.map((e) => `${e.kind}:${e.name}`);
    expect(names).toContain("effect:add_gold");
    expect(names).toContain("trigger:is_alive");
    expect(names).toContain("event_target:liege");
    expect(names).toContain("datafn_global:GetPlayer");
    expect(names).toContain("data_type:Character");
    expect(names).toContain("datafn_member:Character.GetName");
    expect(index.entries[0].name).toBe("add_gold");
    expect(index.entries.find((e) => e.name === "Character.GetName")?.owner).toBe("Character");
  });

  it("shortens a doc to its first sentence and names its sources", () => {
    const index = buildExampleWikiIndex(sources());
    expect(index.entries.find((e) => e.name === "add_gold")?.shortDoc).toBe("Adds gold to the character.");
    expect(index.sources.join(" ")).toContain("script_docs");
    expect(index.sources.join(" ")).toContain("Set the game folder");
  });
});

describe("example wiki variables", () => {
  it("carries a row per mod variable and says where it came from", () => {
    const index = buildExampleWikiIndex(sources({ variables: variables("/mod") }));
    const row = index.entries.find((e) => e.name === "my_toll");
    expect(row?.kind).toBe("variable");
    expect(row?.shortDoc).toBe("Set in 1 place, read in 9 places.");
    expect(row?.count).toBe(10);
    expect(index.sources.join(" ")).toContain("variable and list names");
  });

  it("answers a variable article with its type, its container and its sites", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-wiki-var-"));
    fs.writeFileSync(
      path.join(dir, "effects.txt"),
      [
        "my_effect = {",
        "\tif = {",
        "\t\tset_variable = { name = my_toll value = 5 }",
        "\t\thas_variable = my_toll",
        "\t\tremove_variable = my_toll",
        "\t}",
        "}",
      ].join("\n"),
      "utf8"
    );
    const detail = await computeExampleWikiEntry(
      sources({ variables: variables(dir) }),
      { name: "my_toll", kind: "variable" },
      noSites()
    );
    expect(detail?.valueType).toBe("value");
    expect(detail?.containers).toEqual(["my_effect"]);
    expect(detail?.provenance).toContain("My Mod");
    expect(detail?.examples).toHaveLength(3);
    expect(detail?.examples[0].label).toBe("set");
    expect(detail?.examples[0].line).toBe(3);
    expect(detail?.examples[0].text).toBe("set_variable = { name = my_toll value = 5 }");
    expect(detail?.examples[1].label).toBe("read");
    // Context: the lines around the site, dedented, with the site's own line
    // findable through contextStart.
    const site = detail!.examples[0];
    expect(site.contextStart).toBe(1);
    expect(site.context).toEqual([
      "my_effect = {",
      "\tif = {",
      "\t\tset_variable = { name = my_toll value = 5 }",
      "\t\thas_variable = my_toll",
      "\t\tremove_variable = my_toll",
      "\t}",
    ]);
    expect(detail?.examplesNote).toContain("of 10 places");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("says unknown rather than guessing a type it cannot resolve", async () => {
    const vars = variables("/mod");
    vars.get("variable:my_toll")!.types = null;
    const detail = await computeExampleWikiEntry(
      sources({ variables: vars }),
      { name: "my_toll", kind: "variable" },
      noSites()
    );
    expect(detail?.valueType).toBe("unknown");
    expect(
      await computeExampleWikiEntry(sources(), { name: "my_toll", kind: "variable" }, noSites())
    ).toBeNull();
  });
});

describe("example wiki entry", () => {
  it("answers an engine token with its doc, scopes and usage block", async () => {
    const detail = await computeExampleWikiEntry(sources(), { name: "add_gold", kind: "effect" }, noSites());
    expect(detail?.doc).toContain("Adds gold");
    expect(detail?.scopes).toEqual(["character"]);
    expect(detail?.usage).toBe("add_gold = 100");
    expect(detail?.count).toBe(900);
    expect(detail?.examples).toEqual([]);
    expect(detail?.examplesNote).toContain("game folder");
  });

  it("answers a datafunction member with its return type, arguments and literals", async () => {
    const detail = await computeExampleWikiEntry(
      sources({ gamePath: "/game" }),
      { name: "Character.Custom", kind: "datafn_member" },
      noSites()
    );
    expect(detail?.owner).toBe("Character");
    expect(detail?.ret).toBe("CString");
    expect(detail?.args).toEqual(["CString"]);
    expect(detail?.callKind).toBe("function");
    expect(detail?.literals).toEqual(["FOO"]);
    expect(detail?.provenance).toContain("DumpDataTypes");
  });

  it("resolves a harvested example site against the game path", async () => {
    const detail = await computeExampleWikiEntry(
      sources({ gamePath: path.join("C:", "game") }),
      { name: "Character.GetName", kind: "datafn_member" },
      noSites()
    );
    expect(detail?.examples).toHaveLength(1);
    expect(detail?.examples[0].file).toBe(path.join("C:", "game", "gui/hud.gui"));
    expect(detail?.examples[0].line).toBe(7);
  });

  it("answers a data type with its members and its producers", async () => {
    const detail = await computeExampleWikiEntry(
      sources(),
      { name: "Character", kind: "data_type" },
      noSites()
    );
    expect(detail?.members).toEqual(["Custom", "GetName"]);
    expect(detail?.membersTotal).toBe(2);
    expect(detail?.producers).toEqual(["GetPlayer"]);
  });

  it("answers null for a name the catalog does not have", async () => {
    expect(
      await computeExampleWikiEntry(sources(), { name: "no_such_thing", kind: "effect" }, noSites())
    ).toBeNull();
  });
});

describe("collectSites", () => {
  it("takes key lines and leaves comments and longer names alone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-wiki-"));
    const file = path.join(dir, "sample.txt");
    fs.writeFileSync(
      file,
      ["my_thing = {", "\tadd_gold = 100", "\t# add_gold = 5", "\tadd_gold_no = yes", "}"].join("\n"),
      "utf8"
    );
    const out: ExampleWikiSite[] = [];
    collectSites(file, "add_gold", out);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("add_gold = 100");
    expect(out[0].line).toBe(2);
    // The block the line sits in, dedented so the pane can read it.
    expect(out[0].contextStart).toBe(1);
    expect(out[0].context).toEqual([
      "my_thing = {",
      "\tadd_gold = 100",
      "\t# add_gold = 5",
      "\tadd_gold_no = yes",
      "}",
    ]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
