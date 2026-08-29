/**
 * Data types for [ ... ] datafunction expressions: the bundled wiki harvest,
 * the DumpDataTypes log parser, chain resolution, and the completion/hover
 * providers shared by .gui and localization files.
 */
import { describe, expect, it } from "vitest";
import {
  loadBundledDataTypes,
  loadDataTypes,
  parseDataTypesDump,
  resolveChainType,
  membersOf,
  producersOf,
} from "../src/data/dataTypes";
import {
  chainAtEnd,
  datafunctionExprAt,
  openCallAt,
  provideDataFnCompletion,
  provideDataFnHover,
  provideDataFnSignature,
} from "../src/features/datafunction";
import { emptyUsage, harvestLine, parseDataFnExpr, type DataFnUsage } from "../src/data/dataFnUsage";
import { describeDataFn, CURATED_DOCS } from "../src/data/dataFnDocs";
import { loadDataBindingMacros } from "../src/data/dataBindingMacros";
import { DefinitionIndex } from "../src/index/indexer";
import type { Definition } from "@px-lsp/protocol/types";
import { devPath } from "../../../scripts/devPaths";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

/** Usage fixture built by harvesting a handful of realistic vanilla lines. */
function fixtureUsage(): DataFnUsage {
  const u = emptyUsage();
  const lines = [
    'visible = "[ObjectsEqual( HouseAspiration.Self, HouseAspirationWindow.GetHouseAspiration )]"',
    'datacontext = "[HouseAspirationWindow.GetDynastyHouse.GetHouseAspiration]"',
    "text = \"[Character.GetHouseAspiration('no_aspect').GetName|E]\"",
    "text = \"[Character.GetHouseAspiration('strength').GetName|U]\"",
    'visible = "[And( HouseAspiration.HasMultipleLevels, Not( IsDataModelEmpty( HouseAspiration.GetLevels ) ) )]"',
  ];
  lines.forEach((l, i) => harvestLine(u, l, "gui/test.gui", i + 1));
  return u;
}

describe("bundled wiki data types", () => {
  const data = loadBundledDataTypes();

  it("loads globals and types from packages/server/data/ck3/dataTypes.json", () => {
    expect(data.count).toBeGreaterThan(2000);
    expect(data.globals.get("GetPlayer")?.ret).toBe("Character");
    expect(data.types.has("Character")).toBe(true);
    expect(data.types.has("Title")).toBe(true);
  });

  it("has the everyday Character members with return types", () => {
    const character = data.types.get("Character")!;
    expect(character.get("GetFather")?.ret).toBe("Character");
    expect(character.get("GetFaith")?.ret).toBe("Faith");
    expect(character.get("IsAlive")?.ret).toBe("bool");
    expect(character.has("IsAdult")).toBe(true);
    expect(character.get("GetDomainSize")?.ret).toBe("int32");
    // Known-name members whose return type the wiki does not register still complete:
    expect(character.has("GetName")).toBe(true);
  });
});

describe("DumpDataTypes log parser", () => {
  const DUMP = [
    "GetPlayer",
    "Definition type: Global function",
    "Return type: Character",
    "-----------------------",
    "",
    "Character.IsLandedRuler",
    "Definition type: Function",
    "Return type: bool",
    "-----------------------",
    "",
    "Faith.GetAdherentName( CString )",
    "Definition type: Function",
    "Return type: CString",
    "-----------------------",
    "",
    "ACTIVITY",
    "Definition type: Global promote",
    "Return type: Activity",
    "-----------------------",
    "",
    "Character",
    "Definition type: Type",
    "-----------------------",
    "",
    "SomeMacro",
    "Definition type: Global macro",
    "-----------------------",
  ].join("\n");

  it("parses globals, typed members and argument lists; skips Type/macro entries", () => {
    const data = parseDataTypesDump(DUMP);
    expect(data.count).toBe(4);
    expect(data.globals.get("GetPlayer")).toMatchObject({ ret: "Character", kind: "function" });
    expect(data.globals.get("ACTIVITY")).toMatchObject({ ret: "Activity", kind: "promote" });
    expect(data.types.get("Character")?.get("IsLandedRuler")?.ret).toBe("bool");
    expect(data.types.get("Faith")?.get("GetAdherentName")).toMatchObject({
      ret: "CString",
      args: ["CString"],
    });
    expect(data.globals.has("SomeMacro")).toBe(false);
  });

  it("merges into the bundled baseline (dump entries win by overwrite)", () => {
    const data = loadBundledDataTypes();
    parseDataTypesDump(DUMP, data);
    expect(data.types.get("Character")?.get("IsLandedRuler")?.ret).toBe("bool");
    // Bundled members survive.
    expect(data.types.get("Character")?.get("GetFather")?.ret).toBe("Character");
  });

  // Real-dump shapes verified against the 1.19 DumpDataTypes output (2026-07-14).
  const REAL_DUMP = [
    "Scope.GetFather",
    "Description: Jomini Script System",
    "Definition type: Promote",
    "Return type: Character",
    "-----------------------",
    "",
    // The dump lists some members twice; the [unregistered] Function twin
    // must not clobber the typed Promote above.
    "Scope.GetFather",
    "Definition type: Function",
    "Return type: [unregistered]",
    "-----------------------",
    "",
    "GetVariableSystem",
    "Description: Access the global variable system",
    "Definition type: Global promote",
    "Return type: VariableSystem",
    "-----------------------",
  ].join("\n");

  it("[unregistered] normalizes to null and never clobbers a typed duplicate", () => {
    const data = parseDataTypesDump(REAL_DUMP);
    const father = data.types.get("Scope")?.get("GetFather");
    expect(father?.ret).toBe("Character");
    // No entry anywhere carries the literal "[unregistered]" as a type.
    for (const members of data.types.values()) {
      for (const m of members.values()) expect(m.ret).not.toBe("[unregistered]");
    }
    // Duplicates count once.
    expect(data.count).toBe(2);
  });

  it("strips the Description: prefix and drops Jomini Script System boilerplate", () => {
    const data = parseDataTypesDump(REAL_DUMP);
    expect(data.globals.get("GetVariableSystem")?.desc).toBe("Access the global variable system");
    expect(data.types.get("Scope")?.get("GetFather")?.desc).toBeUndefined();
  });
});

describe("chain resolution", () => {
  const data = loadBundledDataTypes();

  it("resolves datacontext style (Character.GetFather → Character)", () => {
    expect(resolveChainType(data, ["Character"])).toBe("Character");
    expect(resolveChainType(data, ["Character", "GetFather"])).toBe("Character");
    expect(resolveChainType(data, ["Character", "GetFaith"])).toBe("Faith");
  });

  it("resolves global starts (GetPlayer.GetFather → Character)", () => {
    expect(resolveChainType(data, ["GetPlayer"])).toBe("Character");
    expect(resolveChainType(data, ["GetPlayer", "GetFather"])).toBe("Character");
  });

  it("returns null on unknown segments", () => {
    expect(resolveChainType(data, ["NoSuchThing"])).toBeNull();
    expect(resolveChainType(data, ["Character", "NoSuchMember"])).toBeNull();
  });

  it("membersOf is case-tolerant on the type name", () => {
    expect(membersOf(data, "character")).not.toBeNull();
  });
});

describe("expression detection", () => {
  it("finds the open expression in a line prefix", () => {
    expect(datafunctionExprAt('text = "[Character.')).toBe("Character.");
    expect(datafunctionExprAt('text = "[GetPlayer.GetName] and [Faith.')).toBe("Faith.");
    expect(datafunctionExprAt('text = "[GetPlayer.GetName]"')).toBeNull();
    expect(datafunctionExprAt("plain line")).toBeNull();
  });

  it("extracts the trailing chain, cutting at argument boundaries", () => {
    expect(chainAtEnd("Character.GetFather.")).toEqual(["Character", "GetFather", ""]);
    expect(chainAtEnd("Concat( 'x', Character.Get")).toEqual(["Character", "Get"]);
    expect(chainAtEnd("")).toEqual([""]);
  });
});

describe("datafunction completion", () => {
  const data = loadBundledDataTypes();

  it("chain start offers data types and globals", () => {
    const result = provideDataFnCompletion(data, emptyUsage(), ' my_key:0 "[')!;
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("Character");
    expect(labels).toContain("GetPlayer");
  });

  it("Character. offers that type's members (IsAlive, IsAdult, GetName…)", () => {
    const result = provideDataFnCompletion(data, emptyUsage(), 'text = "[Character.')!;
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("IsAlive");
    expect(labels).toContain("IsAdult");
    expect(labels).toContain("GetName");
    expect(labels).not.toContain("GetPlayer"); // globals only at chain start
  });

  it("chains through return types (GetPlayer.GetFaith. → Faith members)", () => {
    const result = provideDataFnCompletion(data, emptyUsage(), '"[GetPlayer.GetFaith.')!;
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("GetAdjective");
  });

  it("typed word filters members with the client's own predicate", () => {
    const result = provideDataFnCompletion(data, emptyUsage(), '"[Character.IsAl')!;
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("IsAlive");
    expect(labels).not.toContain("GetFather"); // no i-s-a-l subsequence
  });

  it("returns null outside an expression, empty on unknown owners", () => {
    expect(provideDataFnCompletion(data, emptyUsage(), "desc = my_loc")).toBeNull();
    expect(provideDataFnCompletion(data, emptyUsage(), '"[NoSuchType.')!.items).toEqual([]);
  });

  it("anchors items to the typed tail segment when a cursor is given (#2)", () => {
    // The gui/loc word pattern includes "." — without an explicit range the
    // client would filter and replace against the whole dotted chain.
    const line = 'text = "[GetPlayer.GetFa';
    const result = provideDataFnCompletion(data, emptyUsage(), line, undefined, {
      line: 3,
      character: line.length,
    })!;
    const item = result.items.find((i) => i.label === "GetFather")!;
    expect(item.textEdit).toEqual({
      range: {
        start: { line: 3, character: line.length - "GetFa".length },
        end: { line: 3, character: line.length },
      },
      newText: "GetFather",
    });
    // Right after the dot the replace range is empty at the cursor.
    const atDot = provideDataFnCompletion(data, emptyUsage(), 'text = "[Character.', undefined, {
      line: 0,
      character: 19,
    })!;
    const member = atDot.items.find((i) => i.label === "IsAlive")!;
    expect(member.textEdit).toEqual({
      range: { start: { line: 0, character: 19 }, end: { line: 0, character: 19 } },
      newText: "IsAlive",
    });
    // Without a cursor the items stay range-free (legacy callers).
    const plain = provideDataFnCompletion(data, emptyUsage(), line)!;
    expect(plain.items.find((i) => i.label === "GetFather")!.textEdit).toBeUndefined();
  });
});

describe("datafunction hover", () => {
  const data = loadBundledDataTypes();

  it("member segment shows owner, kind and return type", () => {
    const line = ' key:0 "Hello [Character.GetFather.GetDread]!"';
    const hover = provideDataFnHover(data, emptyUsage(), line, line.indexOf("GetDread") + 2)!;
    expect(hover.markdown).toContain("Character.GetDread");
    expect(hover.markdown).toContain("CFixedPoint");
    expect(line.slice(hover.start, hover.end)).toBe("GetDread");
  });

  it("chain-start segment shows the data type or global", () => {
    const line = 'text = "[Character.IsAlive]"';
    const typeHover = provideDataFnHover(data, emptyUsage(), line, line.indexOf("Character") + 1)!;
    expect(typeHover.markdown).toContain("data type");
    const memberHover = provideDataFnHover(data, emptyUsage(), line, line.indexOf("IsAlive") + 1)!;
    expect(memberHover.markdown).toContain("bool");
  });

  it("stays quiet outside expressions and on unknown names", () => {
    const line = 'some_key: "plain text"';
    expect(provideDataFnHover(data, emptyUsage(), line, 5)).toBeNull();
    const unknown = 'x = "[Bogus.Chain]"';
    expect(provideDataFnHover(data, emptyUsage(), unknown, unknown.indexOf("Chain") + 1)).toBeNull();
  });

  it("matches members by name when the chain owner does not resolve", () => {
    // GetDread is a Character member; "Bogus" is not a known start, so the
    // chain cannot resolve — the hover must still find the member by name.
    const line = 'x = "[Bogus.GetDread]"';
    const hover = provideDataFnHover(data, emptyUsage(), line, line.indexOf("GetDread") + 1)!;
    expect(hover.markdown).toContain("Character.GetDread");
    expect(hover.markdown).toContain("matched by name");
  });

  it("phrases the dump hint by what is loaded", () => {
    const usage = emptyUsage();
    usage.memberPool.set("MysteryMember", 7);
    const line = 'x = "[Bogus.MysteryMember]"';
    const wiki = provideDataFnHover(data, usage, line, line.indexOf("MysteryMember") + 1)!;
    expect(wiki.markdown).toContain("Run `DumpDataTypes`");
    const dumped = { ...data, source: "data_types.log" as const };
    const withDump = provideDataFnHover(dumped, usage, line, line.indexOf("MysteryMember") + 1)!;
    expect(withDump.markdown).toContain("which is loaded");
    expect(withDump.markdown).not.toContain("Run `DumpDataTypes`");
  });
});

describe("vanilla usage harvest", () => {
  const usage = fixtureUsage();

  it("parses expressions: chains, nested calls, literals, format suffix", () => {
    const parsed = parseDataFnExpr("ObjectsEqual( GetHouseAspiration('no_aspect'), HouseAspiration.Self )")!;
    expect(parsed.chain[0].name).toBe("ObjectsEqual");
    expect(parsed.chain[0].args).toHaveLength(2);
    const fmt = parseDataFnExpr("Character.GetName|U")!;
    expect(fmt.format).toBe("U");
    expect(parseDataFnExpr("not an expression!")).toBeNull();
  });

  it("records starts, pairs, member pool, arities and literals", () => {
    expect(usage.starts.get("HouseAspiration")).toBeGreaterThan(0);
    expect(usage.starts.get("HouseAspirationWindow")).toBeGreaterThan(0);
    expect(usage.pairs.get("HouseAspiration")?.get("Self")).toBeGreaterThan(0);
    expect(usage.memberPool.get("GetHouseAspiration")).toBeGreaterThan(0);
    expect(usage.argCounts.get("ObjectsEqual")?.get(2)).toBe(1);
    expect(usage.literals.get("GetHouseAspiration")?.get("no_aspect")).toBe(1);
    expect(usage.formats.get("E")).toBe(1);
    expect(usage.examples.get("GetHouseAspiration")![0].file).toBe("gui/test.gui");
  });

  it("skips loc-escaped brackets and lowercase scope starts as chain starts", () => {
    const u = emptyUsage();
    harvestLine(u, ' k:0 "literal \\[Not.An.Expr] and [owner.GetName]"', "f.yml", 1);
    expect(u.starts.has("Not")).toBe(false);
    expect(u.starts.has("owner")).toBe(false);
    expect(u.memberPool.get("GetName")).toBe(1);
  });
});

describe("openCallAt", () => {
  it("finds the innermost open call and active argument", () => {
    expect(openCallAt("ObjectsEqual( GetHouseAspiration('no_aspect'), HouseAsp")).toMatchObject({
      chain: ["ObjectsEqual"],
      argIndex: 1,
      literalPrefix: null,
    });
    expect(openCallAt("Character.GetHouseAspiration('no_as")).toMatchObject({
      chain: ["Character", "GetHouseAspiration"],
      argIndex: 0,
      literalPrefix: "no_as",
    });
    expect(openCallAt("Character.GetName")).toBeNull();
    expect(openCallAt("Concat( 'a', 'b' )")).toBeNull(); // closed
  });
});

describe("usage-aware completion", () => {
  const data = loadBundledDataTypes();
  const usage = fixtureUsage();

  it("offers harvested chain starts unknown to the tables", () => {
    const result = provideDataFnCompletion(data, usage, 'visible = "[HouseAsp')!;
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("HouseAspiration");
    expect(labels).toContain("HouseAspirationWindow");
  });

  it("offers harvested members on a harvested type", () => {
    const result = provideDataFnCompletion(data, usage, 'visible = "[HouseAspiration.')!;
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("Self");
    expect(labels).toContain("HasMultipleLevels");
  });

  it("falls back to the member pool when the chain cannot be resolved", () => {
    const result = provideDataFnCompletion(data, usage, '"[HouseAspirationWindow.GetDynastyHouse.')!;
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("GetHouseAspiration");
  });

  it("completes observed literal arguments inside quotes", () => {
    const result = provideDataFnCompletion(data, usage, "text = \"[Character.GetHouseAspiration('")!;
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("no_aspect");
    expect(labels).toContain("strength");
  });

  it("completes format suffixes after |", () => {
    const u = fixtureUsage();
    // Push |E over the >=3 uses threshold.
    harvestLine(u, 'a = "[Character.GetName|E]" b = "[Character.GetName|E]"', "f.gui", 1);
    const result = provideDataFnCompletion(data, u, 'text = "[Character.GetName|')!;
    expect(result.items.map((i) => i.label)).toContain("E");
  });

  it("annotates harvested-only names as vanilla usage", () => {
    const result = provideDataFnCompletion(data, usage, 'visible = "[HouseAspiration.')!;
    const self = result.items.find((i) => i.label === "Self")!;
    expect(self.detail).toContain("vanilla usage");
  });
});

describe("usage-aware hover", () => {
  const data = loadBundledDataTypes();
  const usage = fixtureUsage();

  it("covers names the tables do not know, with examples and deduced description", () => {
    const line = 'datacontext = "[HouseAspirationWindow.GetHouseAspiration]"';
    const hover = provideDataFnHover(data, usage, line, line.indexOf("GetHouseAspiration") + 3)!;
    expect(hover.markdown).toContain("vanilla usage");
    expect(hover.markdown).toContain("Returns the house aspiration");
    expect(hover.markdown).toContain("gui/test.gui");
    expect(hover.markdown).toContain("no_aspect");
  });

  it("links examples into the game folder when a root is known", () => {
    const line = 'x = "[HouseAspiration.Self]"';
    // "F:\game" collapses to "F:game" in a JS string — a separator-less path
    // that only passed because the link builder just needs a non-empty root.
    const hover = provideDataFnHover(data, usage, line, line.indexOf("HouseAspiration") + 2, "F:/game")!;
    expect(hover.markdown).toContain("file://");
  });
});

describe("datafunction signature help", () => {
  const data = loadBundledDataTypes();
  const usage = fixtureUsage();

  it("uses dump/wiki args when known, highlighting the active parameter", () => {
    const dumped = parseDataTypesDump(
      [
        "ObjectsEqual( CObject, CObject )",
        "Definition type: Global function",
        "Return type: bool",
        "----",
      ].join("\n"),
      loadBundledDataTypes()
    );
    const line = 'visible = "[ObjectsEqual( HouseAspiration.Self, HouseAsp';
    const help = provideDataFnSignature(dumped, usage, line, line.length)!;
    expect(help.signatures[0].label).toContain("ObjectsEqual( CObject, CObject )");
    expect(help.activeParameter).toBe(1);
  });

  it("falls back to the observed vanilla arity", () => {
    const line = 'text = "[Character.GetHouseAspiration(';
    const help = provideDataFnSignature(data, usage, line, line.length)!;
    expect(help.signatures[0].label).toContain("GetHouseAspiration( arg1 )");
    expect(help.signatures[0].documentation).toContain("no_aspect");
  });

  it("stays quiet outside calls", () => {
    const line = 'text = "[Character.GetName';
    expect(provideDataFnSignature(data, usage, line, line.length)).toBeNull();
  });
});

describe("deduced descriptions", () => {
  it("curates the ubiquitous utilities and deduces the rest from the name", () => {
    expect(CURATED_DOCS.get("ObjectsEqual")).toContain("same game object");
    expect(describeDataFn("GetHouseAspiration", null)).toContain("Returns the house aspiration");
    expect(describeDataFn("HasMultipleLevels", null)).toContain("boolean");
    expect(describeDataFn("OnClick", null)).toContain("Command");
    expect(describeDataFn("EqualTo_int32", null)).toContain("equal");
    expect(describeDataFn("ROOT", null)).toContain("Context promote");
    expect(describeDataFn("Self", null)).toBeNull(); // single word, no head verb: stay honest
  });
});

describe("data_binding macros promoted into [ … ]", () => {
  function withMacros() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-macros-"));
    fs.mkdirSync(path.join(dir, "data_binding"));
    fs.writeFileSync(
      path.join(dir, "data_binding", "test.txt"),
      `macro = {\n\tdescription = "True when the value is zero"\n\tdefinition = "IsZero(Value)"\n\treplace_with = "EqualTo_int32(Value, '(int32)0')"\n}`
    );
    const data = loadBundledDataTypes();
    const added = loadDataBindingMacros([dir], data);
    return { data, added };
  }

  it("parses the signature and adds the macro as a global function", () => {
    const { data, added } = withMacros();
    expect(added).toBe(1);
    const macro = data.globals.get("IsZero")!;
    expect(macro.kind).toBe("function");
    expect(macro.args).toEqual(["Value"]);
    expect(macro.src).toBe("macro");
    expect(macro.desc).toContain("True when the value is zero");
    expect(macro.desc).toContain("EqualTo_int32");
  });

  it("appears in [ … ] chain-start completion", () => {
    const { data } = withMacros();
    const res = provideDataFnCompletion(data, emptyUsage(), 'text = "[IsZ');
    expect(res).not.toBeNull();
    const item = res!.items.find((i) => i.label === "IsZero");
    expect(item).toBeDefined();
    expect(item!.detail).toContain("function");
  });

  it("offers its signature inside the call", () => {
    const { data } = withMacros();
    const sig = provideDataFnSignature(data, emptyUsage(), 'text = "[IsZero( ', 17);
    expect(sig).not.toBeNull();
    expect(sig!.signatures[0].label).toContain("Value");
  });

  it("never overwrites a real dump/wiki global of the same name", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-macros-"));
    fs.mkdirSync(path.join(dir, "data_binding"));
    fs.writeFileSync(
      path.join(dir, "data_binding", "test.txt"),
      `macro = {\n\tdefinition = "GetPlayer(x)"\n\treplace_with = "y"\n}`
    );
    const data = loadBundledDataTypes();
    const before = data.globals.get("GetPlayer");
    loadDataBindingMacros([dir], data);
    expect(data.globals.get("GetPlayer")).toBe(before); // unchanged
    expect(data.globals.get("GetPlayer")!.src).not.toBe("macro");
  });
});

/**
 * Regression for the reported bug: after `GetPlayer.` nothing was suggested.
 * Root cause was the DumpDataTypes twin — `GetPlayer` is listed both as a
 * Global promote returning Character and as a Global function returning
 * "[unregistered]"; the twin clobbered the typed entry, so the chain resolved
 * to a dead "[unregistered]" type with no members. `insertMember` (38bb775)
 * keeps the typed survivor; these lock the completion path end to end,
 * including the user's own nested expression.
 */
describe("dot-chain member completion through DumpDataTypes twins", () => {
  // Mirrors the real dump's twin shape and the user's chain.
  const TWIN_DUMP = [
    "GetPlayer",
    "Definition type: Global promote",
    "Return type: Character",
    "-----------------------",
    "",
    "GetPlayer",
    "Definition type: Global function",
    "Return type: [unregistered]",
    "-----------------------",
    "",
    "Character.MakeScope",
    "Definition type: Promote",
    "Return type: Scope",
    "-----------------------",
    "",
    "Character.MakeScope",
    "Definition type: Function",
    "Return type: [unregistered]",
    "-----------------------",
    "",
    "Scope.ScriptValue( Arg0 )",
    "Definition type: Function",
    "Return type: CFixedPoint",
    "-----------------------",
    "",
    // Registers CFixedPoint as a type (for the cast-completion test below).
    "CFixedPoint.ToString",
    "Definition type: Function",
    "Return type: CString",
    "-----------------------",
  ].join("\n");
  const data = parseDataTypesDump(TWIN_DUMP);

  it("offers members after a global that has an [unregistered] twin", () => {
    const result = provideDataFnCompletion(data, emptyUsage(), 'visible = "[GetPlayer.')!;
    expect(result.items.map((i) => i.label)).toContain("MakeScope");
  });

  it("offers members when the chain is nested inside function args (the user's case)", () => {
    const nested = 'visible = "[Not( GreaterThan_CFixedPoint( GetPlayer.';
    const result = provideDataFnCompletion(data, emptyUsage(), nested)!;
    expect(result.items.map((i) => i.label)).toContain("MakeScope");
  });

  it("chains on through the promote return type (GetPlayer.MakeScope. → Scope members)", () => {
    const result = provideDataFnCompletion(data, emptyUsage(), 'visible = "[GetPlayer.MakeScope.')!;
    expect(result.items.map((i) => i.label)).toContain("ScriptValue");
  });
});

describe("index-backed argument completion", () => {
  function index(defs: Array<Pick<Definition, "name" | "kind" | "source">>): DefinitionIndex {
    const i = new DefinitionIndex();
    i.addAll(defs.map((d) => ({ ...d, file: `${d.kind}.txt`, line: 0 })));
    return i;
  }
  const data = loadBundledDataTypes();

  it("ScriptValue('…') offers the mod's own script values, ranked above vanilla literals", () => {
    const idx = index([
      { name: "cultivation_gui_core_grade", kind: "script_value", source: "mod" },
      { name: "vanilla_sv", kind: "script_value", source: "vanilla" },
    ]);
    const usage = emptyUsage();
    harvestLine(usage, "text = \"[Scope.ScriptValue('harvested_lit')]\"", "f.gui", 1);
    const result = provideDataFnCompletion(
      data,
      usage,
      "visible = \"[GetPlayer.MakeScope.ScriptValue('",
      idx
    )!;
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("cultivation_gui_core_grade"); // mod def
    expect(labels).toContain("vanilla_sv"); // vanilla def
    expect(labels).toContain("harvested_lit"); // harvested literal, still merged
    // Mod defs sort first (tier 0), literals next (tier 1), vanilla defs last.
    const mod = result.items.find((i) => i.label === "cultivation_gui_core_grade")!;
    const lit = result.items.find((i) => i.label === "harvested_lit")!;
    const van = result.items.find((i) => i.label === "vanilla_sv")!;
    expect(mod.sortText! < lit.sortText!).toBe(true);
    expect(lit.sortText! < van.sortText!).toBe(true);
    expect(mod.detail).toContain("mod");
  });

  it("GetTrait('…') completes from the trait index", () => {
    const idx = index([{ name: "brave", kind: "trait", source: "vanilla" }]);
    const result = provideDataFnCompletion(data, emptyUsage(), "visible = \"[Character.GetTrait('", idx)!;
    expect(result.items.map((i) => i.label)).toContain("brave");
  });

  it("a function with no arg-kind mapping still only offers harvested literals", () => {
    const idx = index([{ name: "brave", kind: "trait", source: "vanilla" }]);
    const usage = emptyUsage();
    harvestLine(usage, "text = \"[Character.GetHouseAspiration('some_aspect')]\"", "f.gui", 1);
    const result = provideDataFnCompletion(data, usage, "text = \"[Character.GetHouseAspiration('", idx)!;
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("some_aspect");
    expect(labels).not.toContain("brave"); // trait index must not leak in
  });
});

describe("datatype-name completion and hover in cast literals", () => {
  // CFixedPoint/int32/CString are dump-only types; register a couple here.
  const CAST_DUMP = [
    "CFixedPoint.ToString",
    "Definition type: Function",
    "Return type: CString",
    "-----------------------",
    "",
    "int32.ToString",
    "Definition type: Function",
    "Return type: CString",
    "-----------------------",
  ].join("\n");
  const data = parseDataTypesDump(CAST_DUMP, loadBundledDataTypes());

  it("completes the datatype name inside a cast literal '(…", () => {
    const line = "visible = \"[Not( GreaterThan_CFixedPoint( GetPlayer.MakeScope.ScriptValue('x'), '(CFixed";
    const result = provideDataFnCompletion(data, emptyUsage(), line)!;
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("CFixedPoint");
    expect(labels).not.toContain("Character"); // filtered by the "CFixed" prefix
  });

  it("offers cast types before the closing paren is typed, then stops", () => {
    const open = provideDataFnCompletion(data, emptyUsage(), "text = \"[EqualTo_int32( x, '(")!;
    expect(open.items.map((i) => i.label)).toContain("int32");
    // Once the cast is closed, the '(int32)' literal is a normal argument again.
    const closed = provideDataFnCompletion(data, emptyUsage(), "text = \"[EqualTo_int32( x, '(int32)0")!;
    expect(closed.items.map((i) => i.label)).not.toContain("int32");
  });

  it("hovers a cast type name as a data type", () => {
    const line =
      "visible = \"[GreaterThan_CFixedPoint( GetPlayer.MakeScope.ScriptValue('x'), '(CFixedPoint)0' )]\"";
    const hover = provideDataFnHover(data, emptyUsage(), line, line.indexOf("CFixedPoint)") + 2)!;
    expect(hover.markdown).toContain("data type");
    expect(line.slice(hover.start, hover.end)).toBe("CFixedPoint");
  });
});

describe("producersOf: the inverse of the member list", () => {
  const dump = [
    "Scope",
    "Definition type: Type",
    "",
    "-----------------------",
    "",
    "Scope.Story",
    "Definition type: Promote",
    "Return type: Story",
    "",
    "-----------------------",
    "",
    "SituationItem.GetStoryCycle",
    "Definition type: Function",
    "Return type: Story",
    "",
    "-----------------------",
    "",
    "GetPlayer",
    "Definition type: Global promote",
    "Return type: Character",
    "",
    "-----------------------",
    "",
    "Character.IsAlive",
    "Definition type: Function",
    "Return type: bool",
    "",
    "-----------------------",
    "",
    "Story",
    "Definition type: Type",
    "",
    "-----------------------",
    "",
    "Story.GetName",
    "Definition type: Function",
    "Return type: CString",
    "",
  ].join("\n");

  it("lists every global and member that returns the type, qualified and sorted", () => {
    const data = parseDataTypesDump(dump);
    expect(producersOf(data, "Story")).toEqual(["Scope.Story", "SituationItem.GetStoryCycle"]);
    expect(producersOf(data, "Character")).toEqual(["GetPlayer"]);
  });

  it("is case-tolerant on the type name and empty for unknown or unproduced types", () => {
    const data = parseDataTypesDump(dump);
    expect(producersOf(data, "story")).toEqual(["Scope.Story", "SituationItem.GetStoryCycle"]);
    expect(producersOf(data, "NotAType")).toEqual([]);
  });

  it("merges case variants of a return type into one producer bucket", () => {
    // The dump declares `Story` as a Type but spells some returns `story`.
    const mixed = [
      "Story",
      "Definition type: Type",
      "",
      "-----------------------",
      "",
      "Scope.Story",
      "Definition type: Promote",
      "Return type: story",
      "",
      "-----------------------",
      "",
      "SituationItem.GetStoryCycle",
      "Definition type: Function",
      "Return type: Story",
      "",
    ].join("\n");
    const data = parseDataTypesDump(mixed);
    expect(producersOf(data, "Story")).toEqual(["Scope.Story", "SituationItem.GetStoryCycle"]);
  });

  it("ranks member producers by the qualified pair, not the bare member name", () => {
    const data = parseDataTypesDump(dump);
    const usage = emptyUsage();
    // `Story` as a bare member name is written 11 times, but only once after
    // `Scope`; `GetStoryCycle` is written 5 times, all after `SituationItem`.
    const lines = [
      ...Array<string>(5).fill('text = "[SituationItem.GetStoryCycle]"'),
      'text = "[Scope.Story]"',
      ...Array<string>(10).fill('text = "[Character.Story]"'),
    ];
    lines.forEach((l, i) => harvestLine(usage, l, "gui/test.gui", i + 1));

    const line = 'text = "[Story.GetName]"';
    const hover = provideDataFnHover(data, usage, line, line.indexOf("Story") + 1)!;
    const produced = hover.markdown.split("\n").find((l) => l.startsWith("Produced by:"))!;
    expect(produced.indexOf("SituationItem.GetStoryCycle")).toBeLessThan(produced.indexOf("Scope.Story"));
  });

  it("hovering a data type says how to obtain one", () => {
    const data = parseDataTypesDump(dump);
    const line = 'text = "[Story.GetName]"';
    const hover = provideDataFnHover(data, emptyUsage(), line, line.indexOf("Story") + 1)!;
    expect(hover.markdown).toContain("Produced by:");
    expect(hover.markdown).toContain("SituationItem.GetStoryCycle");
  });

  it("caps the list and says how many more there are", () => {
    const many = [
      "Widget",
      "Definition type: Type",
      "",
      "-----------------------",
      "",
      "Widget.Get0",
      "Definition type: Function",
      "Return type: CString",
      "",
      "-----------------------",
      "",
    ];
    for (let i = 0; i < 9; i++) {
      many.push(
        `Maker${i}.GetWidget`,
        "Definition type: Function",
        "Return type: Widget",
        "",
        "-----------------------",
        ""
      );
    }
    const data = parseDataTypesDump(many.join(String.fromCharCode(10)));
    expect(producersOf(data, "Widget")).toHaveLength(9);

    const line = 'text = "[Widget.Get0]"';
    const hover = provideDataFnHover(data, emptyUsage(), line, line.indexOf("Widget") + 1)!;
    expect(hover.markdown).toContain("Produced by:");
    expect(hover.markdown).toContain("+3 more");
  });
});

/**
 * Dump-dependent regression against the user's actual DumpDataTypes output.
 * Gated on the logs folder (devPaths.ts) so it runs on the maintainer's machine
 * and skips in CI, following the corpus-gated test pattern.
 */
/** Mirrors MAX_PRODUCERS in datafunction.ts: above this the hover shows a count. */
const MAX_PRODUCERS_IN_HOVER = 6;

const LOGS = devPath("logsPath");
const hasDump = LOGS !== null && fs.existsSync(path.join(LOGS, "data_types"));
(hasDump ? describe : describe.skip)("real DumpDataTypes: user's expression resolves", () => {
  const data = loadDataTypes(LOGS);

  it("GetPlayer. offers Character members including MakeScope", () => {
    const result = provideDataFnCompletion(data, emptyUsage(), 'visible = "[GetPlayer.')!;
    expect(result.items.length).toBeGreaterThan(100);
    expect(result.items.map((i) => i.label)).toContain("MakeScope");
  });

  it("a narrow type lists its producers, a broad one degrades to a count", () => {
    // The whole point of the feature: Story has a handful of producers and the
    // names fit in a hover, bool has thousands and only the count is useful.
    expect(producersOf(data, "Story").length).toBeLessThanOrEqual(MAX_PRODUCERS_IN_HOVER);
    expect(producersOf(data, "bool").length).toBeGreaterThan(1000);

    const line = 'text = "[Story.GetName]"';
    const hover = provideDataFnHover(data, emptyUsage(), line, line.indexOf("Story") + 1)!;
    expect(hover.markdown).toContain("Produced by:");
    expect(hover.markdown).toContain("Scope.Story");
  });

  it("GetPlayer.MakeScope. offers Scope members including ScriptValue", () => {
    const result = provideDataFnCompletion(data, emptyUsage(), 'visible = "[GetPlayer.MakeScope.')!;
    expect(result.items.map((i) => i.label)).toContain("ScriptValue");
  });
});
