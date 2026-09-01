/**
 * Engine-token and datafunction hover content: the cards must teach USAGE
 * (what the token does, the datatype its value expects, a syntax example, the
 * scopes it runs in) and must NOT show a vanilla usage-count line — the user
 * explicitly does not want frequency counts on engine tokens.
 */
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { provideHover } from "../src/features/hover";
import { provideDataFnHover } from "../src/features/datafunction";
import { ServerData } from "../src/serverData";
import { emptyDataTypes } from "../src/data/dataTypes";
import { emptyUsage } from "../src/data/dataFnUsage";
import type { TokenData } from "@px-lsp/protocol/types";
import type { Scope } from "../src/scopes/model";

const EFFECT: TokenData = {
  name: "add_hook",
  kind: "effect",
  doc: "Adds a hook on a character",
  scopes: ["character"],
  usage: "add_hook = { type = X, target = Y }",
};

const TRIGGER_BOOL: TokenData = {
  name: "is_adult",
  kind: "trigger",
  doc: "Is the scope character adult?",
  scopes: ["character"],
  traits: "Traits: yes/no",
};

const TRIGGER_CMP: TokenData = {
  name: "gold",
  kind: "trigger",
  doc: "does the character have the required gold?",
  scopes: ["character"],
  traits: "Traits: <, <=, =, !=, >, >=",
};

const EVENT_TARGET: TokenData = {
  name: "culture",
  kind: "event_target",
  doc: "Global link to culture scope of given culture string",
  scopes: ["output: culture"],
  traits: "Requires Data: yes\nGlobal Link: yes",
};

let uriCounter = 0;
function engineHover(token: TokenData, rendered = `${token.name} = yes`): string {
  const data = new ServerData();
  data.setTokens([token]);
  const text = `x = {\n\t${rendered}\n}`;
  const doc = TextDocument.create(`file:///mod/common/e-${uriCounter++}.txt`, "paradox", 1, text);
  const ch = text.split("\n")[1].indexOf(token.name) + 1;
  const hover = provideHover(
    data,
    doc,
    { line: 1, character: ch },
    new Set(["character"]) as Set<Scope>,
    null
  );
  expect(hover).not.toBeNull();
  return (hover!.contents as { value: string }).value;
}

describe("engine-token hover teaches usage", () => {
  // The scopes, the value shape and the leftover metadata used to be three
  // separate lines (a `Value:` paragraph, an italic traits line, and a
  // `Supported scopes:` footer after a rule). They are now one muted facts
  // line, so these assert on the facts line rather than on the old slots.
  it("effect: fences the syntax example and names the value datatype", () => {
    const md = engineHover(EFFECT);
    expect(md).toContain("Adds a hook on a character");
    expect(md).toContain("a block");
    expect(md).toContain("```paradox\nadd_hook = { type = X, target = Y }\n```");
    expect(md).toContain("character");
  });

  it("boolean trigger: value shape reads yes/no (boolean)", () => {
    const md = engineHover(TRIGGER_BOOL);
    // On the facts line next to the scope, not in a paragraph of its own.
    expect(md).toContain(" scope · `yes`/`no` (boolean)*");
  });

  it("comparison trigger: value shape names number/script value + operators", () => {
    const md = engineHover(TRIGGER_CMP);
    expect(md).toContain("a number or script value");
    expect(md).toContain("<=");
  });

  it("event target: surfaces the returned scope as `→ culture`", () => {
    const md = engineHover(EVENT_TARGET);
    expect(md).toContain("→");
    expect(md).toContain("culture");
    // The returned scope is not mislabeled as a supported (input) scope.
    expect(md).not.toContain("Supported scopes: <span");
  });

  it("engine cards never show a vanilla usage-count (× N) line", () => {
    for (const t of [EFFECT, TRIGGER_BOOL, TRIGGER_CMP, EVENT_TARGET]) {
      const md = engineHover(t);
      expect(md).not.toContain("×");
      expect(md).not.toMatch(/vanilla/i);
    }
  });
});

describe("datafunction hover teaches usage, not counts", () => {
  function dfnHover(): string {
    const data = emptyDataTypes();
    data.globals.set("GetPlayer", {
      ret: "Character",
      args: null,
      kind: "function",
      desc: "The local player's character.",
      src: "dump",
    });
    const usage = emptyUsage();
    usage.starts.set("GetPlayer", 2720);
    usage.examples.set("GetPlayer", [{ text: "[GetPlayer]", file: "gui/hud.gui", line: 36 }]);
    const lineText = `text = "[GetPlayer]"`;
    const hover = provideDataFnHover(data, usage, lineText, lineText.indexOf("GetPlayer") + 1, "F:/game");
    expect(hover).not.toBeNull();
    return hover!.markdown;
  }

  it("leads with signature + description and keeps example file links", () => {
    const md = dfnHover();
    expect(md).toContain("`GetPlayer`");
    expect(md).toContain("The local player's character.");
    expect(md).toContain("Vanilla examples:");
    expect(md).toContain("gui/hud.gui");
  });

  it("drops the frequency count line", () => {
    const md = dfnHover();
    expect(md).not.toContain("×");
    expect(md).not.toContain("2,720");
    expect(md).not.toMatch(/\bUsed \d/);
  });
});
