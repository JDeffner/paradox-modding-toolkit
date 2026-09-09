import { describe, expect, it } from "vitest";
import type { CompletionItem } from "vscode-languageserver/node";
import type { TokenData } from "@px-lsp/protocol/types";
import { withCompletionPreview } from "../src/features/completionPreview";
import { minimalTokenInsert } from "../src/features/completionInsert";

function markdown(item: CompletionItem): string {
  return typeof item.documentation === "string" ? item.documentation : (item.documentation?.value ?? "");
}

const variable: TokenData = {
  name: "set_variable",
  kind: "effect",
  scopes: [],
  usage: "set_variable = { name = X value = Y days = Z }",
  doc: "Where X is the name of the variable used to then access it\nWhere Y is any event target, bool, value, script value or flag (flag:W)\nAn optional days where Z is the number of days or script value",
};

describe("completion previews", () => {
  it("maps game-documented placeholder descriptions to the inserted fields", () => {
    const item: CompletionItem = {
      label: variable.name,
      insertText: minimalTokenInsert(variable)!.snippet,
      insertTextFormat: 2,
      documentation: variable.doc,
    };
    const insert = item.insertText;
    const preview = markdown(withCompletionPreview(item, variable));
    expect(preview).toContain("name = <name>");
    expect(preview).toContain("| name | the name of the variable");
    expect(preview).toContain("| value | any event target, bool, value, script value or flag (flag:W) |");
    expect(preview).not.toContain("| days |");
    expect(preview).not.toContain("$1");
    expect(item.insertText).toBe(insert);
  });

  it("gives plain LSP inserts the same preview", () => {
    const template = minimalTokenInsert(variable)!;
    const rich = withCompletionPreview(
      { label: variable.name, insertText: template.snippet, insertTextFormat: 2 },
      variable
    );
    const plain = withCompletionPreview({ label: variable.name, insertText: template.plain }, variable);
    expect(markdown(plain)).toBe(markdown(rich));
    expect(plain.insertText).toBe(template.plain);
  });

  it("labels concrete examples honestly instead of inferring an accepted datatype", () => {
    const token: TokenData = {
      name: "add_acceptance",
      kind: "effect",
      scopes: [],
      doc: "",
      usage: "add_acceptance = { culture = cu:romanian value = -10 }",
    };
    const preview = markdown(
      withCompletionPreview(
        { label: token.name, insertText: minimalTokenInsert(token)!.snippet, insertTextFormat: 2 },
        token
      )
    );
    expect(preview).toContain("Type not documented. Example: cu:romanian");
    expect(preview).toContain("Type not documented. Example: -10");
  });

  it("shows angle-bracket type hints and keeps nested paths distinct", () => {
    const token: TokenData = {
      name: "sample",
      kind: "effect",
      scopes: [],
      doc: "",
      usage: "sample = { first = { target = <character> } second = { target = <title> } }",
    };
    const preview = markdown(
      withCompletionPreview(
        { label: token.name, insertText: minimalTokenInsert(token)!.snippet, insertTextFormat: 2 },
        token
      )
    );
    expect(preview).toContain("| first.target | character |");
    expect(preview).toContain("| second.target | title |");
  });

  it("uses user-written @param descriptions without guessing from parameter names", () => {
    const item = withCompletionPreview(
      {
        label: "my_effect",
        insertText: "my_effect = {\n\tTARGET = $1\n\tAMOUNT = $2\n}",
        insertTextFormat: 2,
      },
      undefined,
      {
        name: "my_effect",
        kind: "scripted_effect",
        file: "mod.txt",
        line: 0,
        source: "mod",
        params: ["TARGET", "AMOUNT"],
        tags: [{ tag: "param", text: "TARGET character scope" }],
      }
    );
    expect(markdown(item)).toContain("| TARGET | character scope |");
    expect(markdown(item)).toContain("| AMOUNT | Type not documented. |");
  });

  it("decodes choices and escaped placeholder text in full examples", () => {
    const item = withCompletionPreview({
      label: "sample",
      insertText: "sample = {\n\tdays = ${1|10,20|}\n\ttext = ${2:a\\}b} $0\n}",
      insertTextFormat: 2,
    });
    expect(markdown(item)).toContain("days = 10");
    expect(markdown(item)).toContain("text = a}b");
    const once = markdown(item);
    expect(markdown(withCompletionPreview(item))).toBe(once);
  });

  it("does not attach an insertion preview to names-only completions", () => {
    const item = withCompletionPreview({ label: variable.name, documentation: variable.doc }, variable);
    expect(item.documentation).toBe(variable.doc);
  });

  it("uses the documented traits for a scalar value", () => {
    const token: TokenData = {
      name: "sample",
      kind: "trigger",
      scopes: [],
      doc: "",
      usage: "sample = yes",
      traits: "Traits: yes/no",
    };
    const preview = markdown(
      withCompletionPreview({ label: "sample", insertText: "sample = $0", insertTextFormat: 2 }, token)
    );
    expect(preview).toContain("sample = <value>");
    expect(preview).toContain("| sample | yes/no |");
  });

  it("describes block contents from the documented placeholders", () => {
    const token: TokenData = {
      name: "if",
      kind: "effect",
      scopes: [],
      doc: "",
      usage: "if = { limit = { <triggers> } <effects> }",
    };
    const template = minimalTokenInsert(token)!;
    const rich = markdown(
      withCompletionPreview({ label: "if", insertText: template.snippet, insertTextFormat: 2 }, token)
    );
    const plain = markdown(withCompletionPreview({ label: "if", insertText: template.plain }, token));
    expect(rich).toBe(plain);
    expect(rich).toContain("| limit (contents) | triggers |");
    expect(rich).toContain("| if (contents) | effects |");
  });
});
