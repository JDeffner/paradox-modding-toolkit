/**
 * paradox/scopeAt (features/scopeAt.ts): the structured read-out an embedder
 * renders as a scope status bar. Asserts the CHAIN shape, not just the final
 * scope, and that unknown stays unknown (empty scopes) rather than a guess.
 */
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { computeScopeAt } from "../src/features/scopeAt";
import { ServerData } from "../src/serverData";
import { CK3_SCHEMA } from "../src/games/ck3/schema";
import type { TokenData } from "@px-lsp/protocol/types";
import type { ScopeAtResult } from "@px-lsp/protocol/protocol";

/** Same miniature link table shape as scopes.test.ts (real script_docs rows). */
const TOKENS: TokenData[] = [
  { name: "liege", kind: "event_target", doc: "", scopes: ["input: character", "output: character"] },
  {
    name: "capital_province",
    kind: "event_target",
    doc: "",
    scopes: ["input: character", "output: province"],
  },
  {
    name: "every_held_title",
    kind: "effect",
    doc: "",
    scopes: ["character"],
    traits: "Supported Targets: landed_title",
  },
  { name: "add_gold", kind: "effect", doc: "", scopes: ["character"] },
];

const data = new ServerData();
data.setTokens(TOKENS);

const eventEntry = CK3_SCHEMA.find((e) => e.kind === "event")!;
const rootScopes = new Set(eventEntry.rootScopes!.map((s) => s.toLowerCase()));

let uriCounter = 0;

/** `|` marks the cursor; the parse cache is keyed by uri+version, so every
 *  text gets a fresh uri (AGENTS.md). */
function scopeAt(snippet: string): ScopeAtResult {
  const offset = snippet.indexOf("|");
  if (offset < 0) throw new Error("snippet needs a | marker");
  const text = snippet.replace("|", "");
  const doc = TextDocument.create(`file:///mod/events/scope-at-${uriCounter++}.txt`, "paradox", 1, text);
  return computeScopeAt(data, doc, doc.positionAt(offset), rootScopes, eventEntry);
}

describe("computeScopeAt", () => {
  it("event immediate block: the declared root scope, one chain step, no keyword", () => {
    const result = scopeAt("my.1 = {\n\timmediate = {\n\t\t|\n\t}\n}");
    expect(result.scopes).toEqual(["character"]);
    expect(result.chain).toEqual([{ scopes: ["character"] }]);
    expect(result.savedScopes).toEqual([]);
  });

  it("iterator: the chain names the entry keyword and the scope it produces", () => {
    const result = scopeAt("my.1 = {\n\timmediate = {\n\t\tevery_held_title = {\n\t\t\t|\n\t\t}\n\t}\n}");
    expect(result.scopes).toEqual(["landed_title"]);
    expect(result.chain).toEqual([
      { scopes: ["character"] },
      { entryKeyword: "every_held_title", scopes: ["landed_title"] },
    ]);
  });

  it("links chain outermost-first through nested blocks", () => {
    const result = scopeAt(
      "my.1 = {\n\timmediate = {\n\t\tliege = {\n\t\t\tcapital_province = {\n\t\t\t\t|\n\t\t\t}\n\t\t}\n\t}\n}"
    );
    expect(result.scopes).toEqual(["province"]);
    expect(result.chain.map((s) => s.entryKeyword)).toEqual([undefined, "liege", "capital_province"]);
    expect(result.chain[2].scopes).toEqual(["province"]);
  });

  it("save_scope_as makes the saved scope visible, typed by its save site", () => {
    const result = scopeAt(
      "my.1 = {\n\timmediate = {\n\t\tevery_held_title = {\n\t\t\tsave_scope_as = the_title\n\t\t}\n\t\tsave_scope_as = the_actor\n\t\t|\n\t}\n}"
    );
    expect(result.savedScopes).toEqual([
      { name: "the_actor", scopes: ["character"] },
      { name: "the_title", scopes: ["landed_title"] },
    ]);
    // …and entering it is a normal chain step.
    const inside = scopeAt(
      "my.1 = {\n\timmediate = {\n\t\tevery_held_title = {\n\t\t\tsave_scope_as = the_title\n\t\t}\n\t}\n\toption = {\n\t\tscope:the_title = {\n\t\t\t|\n\t\t}\n\t}\n}"
    );
    expect(inside.scopes).toEqual(["landed_title"]);
    expect(inside.chain[inside.chain.length - 1]).toEqual({
      entryKeyword: "scope:the_title",
      scopes: ["landed_title"],
    });
  });

  it("unknown is an empty scope list, not a guess", () => {
    const result = scopeAt("my.1 = {\n\timmediate = {\n\t\tscope:never_saved = {\n\t\t\t|\n\t\t}\n\t}\n}");
    expect(result.scopes).toEqual([]);
    expect(result.chain[result.chain.length - 1]).toEqual({
      entryKeyword: "scope:never_saved",
      scopes: [],
    });
  });
});
