/**
 * Ref-field disambiguation: when a word sits in the VALUE slot of a schema ref
 * field (`theme = faith`), hover and semantic tokens show/color the referenced
 * kind (event theme) instead of every same-named symbol (the `faith` event
 * target). Key position and non-ref values keep the multi-meaning behavior.
 */
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { provideHover } from "../src/features/hover";
import { provideSemanticTokens } from "../src/features/semanticTokens";
import { ServerData } from "../src/serverData";
import { loadSchema } from "../src/schema/loader";
import { CK3_SCHEMA } from "../src/games/ck3/schema";
import type { TokenData } from "@paradox-lsp/protocol/types";

const schema = loadSchema(null);
const eventEntry = CK3_SCHEMA.find((e) => e.kind === "event")!;

let uriCounter = 0;
const uri = () => `file:///mod/events/ref-fixture-${uriCounter++}.txt`;

const FAITH_TARGET: TokenData = {
  name: "faith",
  kind: "event_target",
  doc: "Global link to faith scope of given faith string",
  scopes: ["faith"],
};

function makeData(): ServerData {
  const data = new ServerData();
  data.setTokens([FAITH_TARGET]);
  data.index.addAll([
    { name: "faith", kind: "event_theme", file: "00_event_themes.txt", line: 645, source: "vanilla" },
  ]);
  return data;
}

function hoverMd(data: ServerData, text: string, line: number, character: number): string {
  const doc = TextDocument.create(uri(), "paradox", 1, text);
  const hover = provideHover(
    data,
    doc,
    { line, character },
    new Set(["character"]),
    eventEntry,
    () => schema
  );
  expect(hover).not.toBeNull();
  return (hover!.contents as { value: string }).value;
}

describe("hover ref-field disambiguation", () => {
  it("theme = faith shows only the event theme, not the event target", () => {
    const text = "cultivation.5 = {\n\ttheme = faith\n}";
    const md = hoverMd(makeData(), text, 1, text.split("\n")[1].indexOf("faith") + 1);
    expect(md).toContain("event theme");
    expect(md).not.toContain("event target");
  });

  it("faith in key position keeps all meanings", () => {
    const text = "cultivation.5 = {\n\ttrigger = { faith = faith:catholic }\n}";
    const md = hoverMd(makeData(), text, 1, text.split("\n")[1].indexOf("faith") + 1);
    expect(md).toContain("event target");
    expect(md).toContain("event theme");
  });

  it("list-form ref fields disambiguate bare elements", () => {
    const data = new ServerData();
    data.setTokens([{ ...FAITH_TARGET, name: "my_oa" }]);
    data.index.addAll([{ name: "my_oa", kind: "on_action", file: "mine.txt", line: 0, source: "mod" }]);
    const text = "x = {\n\ton_actions = { my_oa }\n}";
    const md = hoverMd(data, text, 1, text.split("\n")[1].indexOf("my_oa") + 1);
    expect(md).toContain("on action");
    expect(md).not.toContain("event target");
  });

  it("falls back to all meanings when no definition matches the expected kind", () => {
    const data = makeData();
    // `faith = X` expects a faith definition; none named `faith` exists, so the
    // event-target card still shows for the trigger's value word.
    const text = "cultivation.5 = {\n\ttrigger = { faith = faith }\n}";
    const line = text.split("\n")[1];
    const md = hoverMd(data, text, 1, line.lastIndexOf("faith") + 1);
    expect(md).toContain("event target");
  });
});

describe("semantic-token ref-field disambiguation", () => {
  // Decoded from the LSP delta encoding: [line, char, length, type, modifiers].
  function decode(
    data: number[]
  ): Array<{ line: number; char: number; length: number; type: number; mods: number }> {
    const out = [];
    let line = 0;
    let char = 0;
    for (let i = 0; i < data.length; i += 5) {
      line += data[i];
      char = data[i] === 0 ? char + data[i + 1] : data[i + 1];
      out.push({ line, char, length: data[i + 2], type: data[i + 3], mods: data[i + 4] });
    }
    return out;
  }

  const ENUM_MEMBER = 6; // TOKEN_TYPES order in semanticTokens.ts
  const VARIABLE = 2;

  it("theme = faith colors as event theme (enumMember), not event target (variable)", () => {
    const data = makeData();
    const doc = TextDocument.create(uri(), "paradox", 1, "my.1 = {\n\ttheme = faith\n}");
    const tokens = decode(provideSemanticTokens(data, doc, schema.refFields).data);
    const faith = tokens.find((t) => t.line === 1 && t.length === 5);
    expect(faith).toBeDefined();
    expect(faith!.type).toBe(ENUM_MEMBER);
  });

  it("without ref fields the engine token still wins (previous behavior)", () => {
    const data = makeData();
    const doc = TextDocument.create(uri(), "paradox", 1, "my.1 = {\n\ttheme = faith\n}");
    const tokens = decode(provideSemanticTokens(data, doc).data);
    const faith = tokens.find((t) => t.line === 1 && t.length === 5);
    expect(faith).toBeDefined();
    expect(faith!.type).toBe(VARIABLE);
  });
});
