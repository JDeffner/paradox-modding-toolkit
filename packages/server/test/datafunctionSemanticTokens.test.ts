import { afterEach, describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Definition } from "@px-lsp/protocol/types";
import { parseDataTypesDump } from "../src/data/dataTypes";
import { activeProfile, setActiveProfile } from "../src/games/active";
import { ck3Profile } from "../src/games/ck3";
import { eu5Profile } from "../src/games/eu5";
import { vic3Profile } from "../src/games/vic3";
import { provideDatafunctionSemanticSpans } from "../src/features/datafunctionSemanticTokens";
import { ServerData } from "../src/serverData";

// Representative DumpDataTypes shapes, including the promote/function distinction.
const DUMP = [
  "GetPlayer\nDefinition type: Global function\nReturn type: Character",
  "GetVariableSystem\nDefinition type: Global promote\nReturn type: VariableSystem",
  "Character.GetFather\nDefinition type: Promote\nReturn type: Character",
  "Character.GetName\nDefinition type: Function\nReturn type: CString",
  "Character.Custom( CString )\nDefinition type: Function\nReturn type: CString",
  "ObjectsEqual( Character, Character )\nDefinition type: Global function\nReturn type: bool",
  "ScriptValue( CString )\nDefinition type: Global function\nReturn type: CFixedPoint",
].join("\n-----------------------\n");

function fixtureData(): ServerData {
  const data = new ServerData();
  data.dataTypes = parseDataTypesDump(DUMP);
  return data;
}

let documentId = 0;
function collect(text: string, languageId = "paradox-gui", data = fixtureData()) {
  const document = TextDocument.create(`file:///datafunctions-${documentId++}.gui`, languageId, 1, text);
  return provideDatafunctionSemanticSpans(data, document).map((span) => ({
    text: text.slice(span.offset, span.offset + span.length),
    type: span.type,
    modifiers: span.modifiers ?? [],
    offset: span.offset,
  }));
}

function labels(text: string, languageId = "paradox-gui", data = fixtureData()) {
  return collect(text, languageId, data).map(({ text: name, type }) => [name, type]);
}

function definition(name: string, kind: string, source: Definition["source"] = "mod"): Definition {
  return { name, kind, source, file: "/fixtures/definitions.txt", line: 1 };
}

const initialProfile = activeProfile();
afterEach(() => setActiveProfile(initialProfile));

describe("embedded datafunction semantic spans", () => {
  it("distinguishes datatypes, object navigation and functions in GUI bindings", () => {
    expect(
      labels(
        'text = "[Character.GetFather.GetName|U]"\nvalue = [GetVariableSystem]\ntext = "[GetPlayer.GetName]"'
      )
    ).toEqual([
      ["Character", "type"],
      ["GetFather", "property"],
      ["GetName", "function"],
      ["GetVariableSystem", "variable"],
      ["GetPlayer", "function"],
      ["GetName", "function"],
    ]);
  });

  it("retains type resolution after calls and resolves nested argument chains", () => {
    expect(
      labels('text = "[GetPlayer().GetFather.GetName()] [ObjectsEqual(Character.GetFather, GetPlayer())]"')
    ).toEqual([
      ["GetPlayer", "function"],
      ["GetFather", "property"],
      ["GetName", "function"],
      ["ObjectsEqual", "function"],
      ["Character", "type"],
      ["GetFather", "property"],
      ["GetPlayer", "function"],
    ]);
  });

  it("leaves unresolved bare names alone but recognizes explicit call syntax", () => {
    expect(labels('text = "[Unknown.GetName] [Unknown.CallMe()] [Unknown] [Character.Missing]"')).toEqual([
      ["CallMe", "function"],
      ["Character", "type"],
    ]);
  });

  it("does not reinterpret prose, GUI comments or escaped opening brackets", () => {
    const text = String.raw`# [Character.GetName]
text = "Character.GetName and \[Character.GetName]"
text = "[Character.GetName]" # [GetPlayer.GetName]
text = "Plain \"quote\" [Character.GetName]"`;
    expect(labels(text)).toEqual([
      ["Character", "type"],
      ["GetName", "function"],
      ["Character", "type"],
      ["GetName", "function"],
    ]);
  });

  it("keeps brackets and escaped quotes inside arguments from ending an expression", () => {
    const text = String.raw`text = "[Unknown('Character.GetName [GetPlayer] \'quoted\'', Character.GetName)]"`;
    expect(labels(text)).toEqual([
      ["Unknown", "function"],
      ["Character", "type"],
      ["GetName", "function"],
    ]);
  });

  it("supports multiline GUI expressions without coloring single-quoted prose", () => {
    expect(
      labels("text = \"[ObjectsEqual(\n Character.GetFather,\n Unknown('Character.GetName')\n)]\"")
    ).toEqual([
      ["ObjectsEqual", "function"],
      ["Character", "type"],
      ["GetFather", "property"],
      ["Unknown", "function"],
    ]);
  });

  it("limits localization highlighting to entry values and preserves UTF-16 offsets", () => {
    const text =
      '\uFEFFl_english:\r\n # [GetPlayer.GetName]\r\n key:0 "😀 quoted "speech" [Character.GetName|U]" # [GetPlayer.GetName]\r\n malformed [GetPlayer.GetName]';
    const spans = collect(text, "paradox-loc");
    expect(spans.map(({ text: name, type }) => [name, type])).toEqual([
      ["Character", "type"],
      ["GetName", "function"],
    ]);
    expect(spans[0].offset).toBe(text.indexOf("Character"));
  });

  it("does not process ordinary script strings", () => {
    expect(labels('desc = "[Character.GetName]"', "paradox-script")).toEqual([]);
  });

  it("identifies loaded binding macros without engine-library provenance", () => {
    const data = fixtureData();
    data.dataTypes.globals.set("IsZero", { kind: "function", args: ["Value"], ret: null, src: "macro" });
    const spans = collect("visible = \"[IsZero(ScriptValue('unindexed_value'))]\"", "paradox-gui", data);
    expect(spans.map(({ text: name, type }) => [name, type])).toEqual([
      ["IsZero", "macro"],
      ["ScriptValue", "function"],
    ]);
    expect(spans[0].modifiers).toEqual([]);
    expect(spans[1].modifiers).toEqual(["defaultLibrary"]);
  });

  it("resolves only the indexed first literal argument authorized by the active profile", () => {
    setActiveProfile(ck3Profile);
    const data = fixtureData();
    data.index.addAll([
      definition("my_value", "script_value"),
      definition("my_custom", "customizable_localization", "vanilla"),
      definition("wrong_kind", "trait"),
    ]);
    const text =
      "text = \"[ScriptValue('my_value')] [Character.Custom('my_custom')] [Unknown('my_value')] [ScriptValue('wrong_kind')] [ScriptValue('missing')] [ScriptValue('missing', 'my_value')]\"";
    const spans = collect(text, "paradox-gui", data);
    expect(
      spans.filter((span) => ["my_value", "my_custom", "wrong_kind", "missing"].includes(span.text))
    ).toEqual([
      { text: "my_value", type: "enumMember", modifiers: [], offset: text.indexOf("my_value") },
      { text: "my_custom", type: "type", modifiers: ["defaultLibrary"], offset: text.indexOf("my_custom") },
    ]);
  });

  it.each([ck3Profile, vic3Profile, eu5Profile])("uses the loaded datatype tables for $id", (profile) => {
    setActiveProfile(profile);
    expect(labels('text = "[Character.GetName]"')).toEqual([
      ["Character", "type"],
      ["GetName", "function"],
    ]);
  });

  it("honors a profile without a reference mapping", () => {
    setActiveProfile(eu5Profile);
    const data = fixtureData();
    data.index.addAll([definition("my_value", "script_value")]);
    expect(labels("text = \"[ScriptValue('my_value')]\"", "paradox-gui", data)).toEqual([
      ["ScriptValue", "function"],
    ]);
  });
});
