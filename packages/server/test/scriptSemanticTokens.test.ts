import { afterEach, describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { SchemaEntry } from "../src/schema/types";
import { loadSchema } from "../src/schema/loader";
import { activeProfile, setActiveProfile } from "../src/games/active";
import { allProfiles } from "../src/games/registry";
import { ServerData } from "../src/serverData";
import {
  provideSemanticTokens,
  provideScriptSemanticSpans,
  SEMANTIC_LEGEND,
} from "../src/features/semanticTokens";
import { encodeSemanticSpans } from "../src/features/semanticTokenTypes";
import {
  provideDatafunctionSemanticSpans,
  datafunctionExpressionRanges,
} from "../src/features/datafunctionSemanticTokens";
import { parseDataTypesDump } from "../src/data/dataTypes";

const originalProfile = activeProfile();
afterEach(() => setActiveProfile(originalProfile));
let serial = 0;

function document(text: string, languageId = "paradox") {
  return TextDocument.create(`file:///semantic-${serial++}.txt`, languageId, 1, text);
}

function tokens(data: ServerData, text: string, entry?: SchemaEntry) {
  const doc = document(text);
  const schema = loadSchema(null);
  const encoded = provideSemanticTokens(data, doc, schema.refFields, entry, schema.structures, schema).data;
  const result: { text: string; type: string; modifiers: string[] }[] = [];
  let line = 0;
  let character = 0;
  for (let i = 0; i < encoded.length; i += 5) {
    line += encoded[i];
    character = encoded[i] === 0 ? character + encoded[i + 1] : encoded[i + 1];
    const offset = doc.offsetAt({ line, character });
    result.push({
      text: text.slice(offset, offset + encoded[i + 2]),
      type: SEMANTIC_LEGEND.tokenTypes[encoded[i + 3]],
      modifiers: SEMANTIC_LEGEND.tokenModifiers.filter((_, bit) => encoded[i + 4] & (1 << bit)),
    });
  }
  expect(result.every((token) => token.modifiers.includes("px"))).toBe(true);
  return result;
}

function collisionData() {
  const data = new ServerData();
  data.setTokens([
    { name: "shared", kind: "trigger", doc: "fixture", scopes: [] },
    { name: "shared", kind: "effect", doc: "fixture", scopes: [] },
  ]);
  data.index.addAll(
    ["saved_scope", "variable", "event", "loc_key"].map((kind) => ({
      name: "shared",
      kind,
      file: "fixture.txt",
      line: 0,
      source: "mod" as const,
    }))
  );
  return data;
}

describe("script semantic grammar", () => {
  it("resolves scalar math identities before same-named engine calls or runtime names", () => {
    const data = new ServerData();
    data.setTokens([{ name: "add_gold", kind: "effect", doc: "fixture", scopes: [] }]);
    data.index.addAll(
      ["variable", "script_value"].map((kind) => ({
        name: "add_gold",
        kind,
        file: "fixture.txt",
        line: 0,
        source: "mod" as const,
      }))
    );
    const matches = tokens(
      data,
      "immediate = { add_gold = add_gold }\nvalue = add_gold\nvalues = { add_gold }"
    ).filter((token) => token.text === "add_gold");
    expect(matches.map((token) => token.type)).toEqual(["method", "variable", "enumMember", "variable"]);
  });

  it.each(['scripted_effect "" = {}', 'scripted_effect "[oops\nnext]" = {}'])(
    "keeps malformed quoted inline declarations out of the span encoder: %s",
    (text) => {
      expect(() => tokens(new ServerData(), text)).not.toThrow();
      expect(tokens(new ServerData(), text)).toEqual([]);
    }
  );

  it("resolves navigation before unresolved field types but preserves indexed dotted identities", () => {
    const data = new ServerData();
    data.setTokens([{ name: "culture", kind: "event_target", doc: "fixture", scopes: [] }]);
    data.index.addAll([{ name: "ROOT.1", kind: "event", file: "fixture.txt", line: 0, source: "mod" }]);
    const matches = tokens(
      data,
      "set_culture = ROOT.culture\nculture = ROOT.culture\nculture = root\ntrigger_event = ROOT.1"
    );
    expect(
      matches
        .filter((token) => ["ROOT", "root", "ROOT.1"].includes(token.text))
        .map((token) => [token.text, token.type])
    ).toEqual([
      ["ROOT", "property"],
      ["ROOT", "property"],
      ["root", "property"],
      ["ROOT.1", "event"],
    ]);
    expect(
      matches
        .filter((token) => token.type === "property")
        .every((token) => token.modifiers.includes("pxScope"))
    ).toBe(true);
  });

  it("uses declaration, block-reference, and localization identities before colliding engine names", () => {
    const matches = tokens(
      collisionData(),
      `event.1 = {
      immediate = {
        save_scope_as = shared
        set_variable = { name = shared value = 1 }
        trigger_event = { id = shared }
      }
      title = shared
    }`
    ).filter((token) => token.text === "shared");
    expect(matches.map((token) => token.type)).toEqual(["variable", "variable", "event", "string"]);
    expect(matches.map((token) => token.modifiers.includes("declaration"))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("selects trigger and effect tokens by grammar, independent of registration order", () => {
    const matches = tokens(
      collisionData(),
      "event.1 = { trigger = { shared = yes } immediate = { shared = yes } }"
    ).filter((token) => token.text === "shared");
    expect(matches.map((token) => token.type)).toEqual(["function", "method"]);
    expect(matches[0].modifiers).toEqual(["defaultLibrary", "px", "pxTrigger"]);
    expect(matches[1].modifiers).toEqual(["defaultLibrary", "px", "pxEffect"]);
  });

  it.each(allProfiles())("highlights implicit writes and reads before indexing in $id", (profile) => {
    setActiveProfile(profile);
    const matches = tokens(
      new ServerData(),
      `immediate = {
      save_scope_as = fresh_scope
      set_variable = { name = fresh_variable value = 1 }
      has_variable = { name = fresh_variable }
      change_variable = { name = fresh_variable add = 1 }
    }`
    ).filter((token) => token.text.startsWith("fresh_"));
    expect(matches.map((token) => token.type)).toEqual(["variable", "variable", "variable", "variable"]);
    expect(matches.map((token) => token.modifiers.includes("declaration"))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(matches[3].modifiers).toContain("modification");
  });

  it.each(allProfiles())("uses block-reference and prefix tables from $id", (profile) => {
    setActiveProfile(profile);
    const data = collisionData();
    const event = tokens(data, "immediate = { trigger_event = { id = shared } }").find(
      (token) => token.text === "shared"
    );
    expect(event?.type).toBe(profile.blockRefFields.trigger_event?.id ? "event" : "variable");
    const prefix = Object.entries(profile.prefixRefs)[0];
    if (prefix) {
      const matches = tokens(data, `target = ${prefix[0]}:shared`);
      expect(matches.map((token) => [token.text, token.type])).toEqual([
        [`${prefix[0]}:`, "keyword"],
        ["shared", "type"],
      ]);
    }
  });

  it("segments saved scopes, variable references, profile prefixes, and navigation links", () => {
    const data = new ServerData();
    data.setTokens([
      { name: "liege", kind: "event_target", doc: "fixture", scopes: [] },
      { name: "culture", kind: "event_target", doc: "fixture", scopes: [] },
    ]);
    const matches = tokens(
      data,
      "target = scope:fresh.liege.culture\ntarget = var:fresh.liege\ntarget = culture:fresh\ntarget = ROOT.liege"
    );
    expect(matches.map((token) => [token.text, token.type])).toEqual([
      ["scope:", "keyword"],
      ["fresh", "variable"],
      ["liege", "property"],
      ["culture", "property"],
      ["var:", "keyword"],
      ["fresh", "variable"],
      ["liege", "property"],
      ["culture:", "keyword"],
      ["fresh", "type"],
      ["ROOT", "property"],
      ["liege", "property"],
    ]);
    expect(matches[1].modifiers).toContain("pxScope");
    expect(matches[5].modifiers).not.toContain("pxScope");
    expect(
      matches
        .filter((token) => token.type === "property")
        .every((token) => token.modifiers.includes("pxScope"))
    ).toBe(true);
  });

  it("distinguishes database declarations and references from script values", () => {
    const data = new ServerData();
    data.index.addAll([
      { name: "known", kind: "trait", file: "fixture.txt", line: 0, source: "vanilla" },
      { name: "score", kind: "script_value", file: "fixture.txt", line: 0, source: "mod" },
    ]);
    const matches = tokens(data, "fresh = { has_trait = known value = score }", {
      path: "common/traits",
      kind: "trait",
    });
    expect(
      matches
        .filter((token) => ["fresh", "known", "score"].includes(token.text))
        .map((token) => [token.text, token.type])
    ).toEqual([
      ["fresh", "type"],
      ["known", "type"],
      ["score", "enumMember"],
    ]);
    expect(matches[0].modifiers).toContain("declaration");
    expect(matches.find((token) => token.text === "known")!.modifiers).toContain("defaultLibrary");
  });

  it("segments prefixed reads after navigation and another prefixed read", () => {
    const matches = tokens(new ServerData(), "target = ROOT.var:fresh\ntarget = scope:holder.var:fresh");
    expect(matches.map((token) => [token.text, token.type])).toEqual([
      ["ROOT", "property"],
      ["var:", "keyword"],
      ["fresh", "variable"],
      ["scope:", "keyword"],
      ["holder", "variable"],
      ["var:", "keyword"],
      ["fresh", "variable"],
    ]);
  });

  it("marks inline scripted declarations before indexing and typed calls after indexing", () => {
    const data = new ServerData();
    data.index.addAll([
      { name: "condition", kind: "scripted_trigger", file: "fixture.txt", line: 0, source: "mod" },
      { name: "action", kind: "scripted_effect", file: "fixture.txt", line: 0, source: "mod" },
    ]);
    const matches = tokens(
      data,
      "scripted_trigger fresh_condition = { }\nscripted_effect fresh_action = { }\nevent.1 = { trigger = { condition = yes } immediate = { action = yes } }"
    );
    expect(
      matches.filter((token) => token.type === "macro").map((token) => [token.text, token.modifiers])
    ).toEqual([
      ["fresh_condition", ["declaration", "px", "pxTrigger"]],
      ["fresh_action", ["declaration", "px", "pxEffect"]],
      ["condition", ["px", "pxTrigger"]],
      ["action", ["px", "pxEffect"]],
    ]);
  });

  it("preserves comments and ordinary quoted text while highlighting explicit quoted references", () => {
    const matches = tokens(
      collisionData(),
      '# shared\nopaque = "shared"\ntext = "ordinary"\ntitle = "shared"\ntrigger_event = { id = "shared" }'
    );
    expect(matches.filter((token) => token.text === "shared").map((token) => token.type)).toEqual([
      "string",
      "event",
    ]);
    expect(matches.some((token) => token.text === "ordinary")).toBe(false);
  });

  it("distinguishes constant declarations and reads from macro parameters", () => {
    const matches = tokens(
      new ServerData(),
      '@amount = 2\nvalue = @amount\nvalue = $PARAM$\nvalue = prefix_$PARAM|2$_suffix\nopaque = "@amount $PARAM$"'
    );
    expect(matches.map((token) => [token.text, token.type, token.modifiers])).toEqual([
      ["@amount", "variable", ["declaration", "readonly", "px"]],
      ["@amount", "variable", ["readonly", "px"]],
      ["PARAM", "parameter", ["px"]],
      ["PARAM", "parameter", ["px"]],
    ]);
  });

  it("highlights GUI type and template declarations and uses without classifying ordinary strings", () => {
    const matches = tokens(
      new ServerData(),
      'types Fixture { type Widget = window { } template Row { } }\nWidget = { text = "Widget" using = Row Row = { } }',
      {
        path: "gui",
        kind: "gui_type",
        extraction: "gui-type",
        ext: ".gui",
      }
    );
    expect(
      matches
        .filter((token) => token.modifiers.includes("declaration"))
        .map((token) => [token.text, token.type])
    ).toEqual([
      ["Fixture", "namespace"],
      ["Widget", "type"],
      ["Row", "type"],
    ]);
    expect(matches.filter((token) => token.text === "Widget").map((token) => token.type)).toEqual([
      "type",
      "type",
    ]);
    expect(matches.filter((token) => token.text === "Row").map((token) => token.type)).toEqual([
      "type",
      "type",
      "type",
    ]);
  });

  it.each([
    "[Character.GetName]",
    "[GetPlayer().GetName]",
    "[Character.GetName = Character.GetName]",
    "[Character.GetName = Character.GetName",
  ])("leaves complete bracket grammar to the expression collector: %s", (expression) => {
    const text = `widget = { text = ${expression} }`;
    const doc = document(text, "paradox-gui");
    const data = new ServerData();
    data.dataTypes = parseDataTypesDump(
      "GetPlayer\nDefinition type: Global function\nReturn type: Character\n-----------------------\nCharacter.GetName\nDefinition type: Function\nReturn type: CString"
    );
    const entry: SchemaEntry = { path: "gui", kind: "gui_type", extraction: "gui-type", ext: ".gui" };
    const script = provideScriptSemanticSpans(data, doc, undefined, entry);
    const bracket = provideDatafunctionSemanticSpans(data, doc);
    const ranges = datafunctionExpressionRanges(doc);
    expect(bracket.some((span) => span.type === "function")).toBe(true);
    expect(
      script.every((span) =>
        ranges.every((range) => span.offset + span.length <= range.start || span.offset >= range.end)
      )
    ).toBe(true);
    expect(() => encodeSemanticSpans(doc, [...script, ...bracket])).not.toThrow();
  });
});

describe("semantic span encoding", () => {
  it("sorts UTF-16 positions and adds the product modifier", () => {
    const doc = document("😀 first\r\nsecond");
    expect(
      encodeSemanticSpans(doc, [
        { offset: 10, length: 6, type: "type" },
        { offset: 3, length: 5, type: "variable" },
      ]).data
    ).toEqual([0, 3, 5, 2, 16, 1, 0, 6, 9, 16]);
  });

  it("rejects invalid and overlapping collector spans", () => {
    const doc = document("first\nsecond");
    expect(() => encodeSemanticSpans(doc, [{ offset: -1, length: 1, type: "type" }])).toThrow("Invalid");
    expect(() => encodeSemanticSpans(doc, [{ offset: 0, length: 7, type: "type" }])).toThrow("Multiline");
    expect(() =>
      encodeSemanticSpans(doc, [
        { offset: 0, length: 4, type: "type" },
        { offset: 2, length: 2, type: "type" },
      ])
    ).toThrow("overlapping");
  });
});
