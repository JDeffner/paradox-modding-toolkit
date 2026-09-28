import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { provideSemanticTokens, SEMANTIC_LEGEND } from "../src/features/semanticTokens";
import { ServerData } from "../src/serverData";

let serial = 0;

function tokens(data: ServerData, text: string) {
  const document = TextDocument.create(`file:///scope-highlighting-${serial++}.txt`, "paradox", 1, text);
  const encoded = provideSemanticTokens(data, document).data;
  const decoded: { text: string; type: string }[] = [];
  let line = 0;
  let character = 0;
  for (let i = 0; i < encoded.length; i += 5) {
    line += encoded[i];
    character = encoded[i] === 0 ? character + encoded[i + 1] : encoded[i + 1];
    decoded.push({
      text: text.split("\n")[line].slice(character, character + encoded[i + 2]),
      type: SEMANTIC_LEGEND.tokenTypes[encoded[i + 3]],
    });
  }
  return decoded;
}

describe("saved-scope highlighting", () => {
  it.each([
    "target = scope:county_culture",
    "scope:county_culture ?= { }",
    "change = scope:change",
    "resolve_title_and_vassal_change = scope:change",
    "set_county_culture = scope:replacement_county.culture",
    "set_county_faith = scope:replacement_county.faith",
    "targets = { scope:county_culture }",
  ])("keeps the prefix distinct before and after indexing: %s", (text) => {
    const data = new ServerData();
    const expected = [{ text: "scope:", type: "keyword" }];
    expect(tokens(data, text)).toEqual(expected);
    data.index.addAll([
      { name: "scope", kind: "scripted_effect", file: "fixture.txt", line: 0, source: "mod" },
      { name: "county_culture", kind: "saved_scope", file: "fixture.txt", line: 1, source: "mod" },
    ]);
    expect(tokens(data, text)).toEqual(expected);
    data.setTokens([{ name: "scope", kind: "event_target", doc: "Fixture", scopes: [] }]);
    expect(tokens(data, text)).toEqual(expected);
  });

  it("preserves comments, quoted strings, ordinary identifiers, and other prefixes", () => {
    const data = new ServerData();
    data.setTokens([{ name: "culture", kind: "event_target", doc: "Fixture", scopes: [] }]);
    expect(
      tokens(
        data,
        '# scope:county_culture\ntext = "scope:county_culture"\nvalue = county_culture\nvalue = culture:county_culture'
      )
    ).toEqual([{ text: "culture", type: "variable" }]);
  });
});
