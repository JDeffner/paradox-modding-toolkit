import { describe, expect, it } from "vitest";
import { minimalTokenInsert, syntaxInsert } from "../src/features/completionInsert";
import type { TokenData } from "@px-lsp/protocol/types";

const token = (name: string, usage?: string, doc = ""): TokenData => ({
  name,
  usage,
  doc,
  kind: "effect",
  scopes: [],
});

describe("minimal completion syntax", () => {
  it("keeps set_variable name and value, without the optional days", () => {
    // CK3 script_docs effects.log; days is optional in the prose, not in the example.
    expect(
      minimalTokenInsert(
        token(
          "set_variable",
          "set_variable = { name = X value = Y days = Z }",
          "An optional days where Z is the number of days or script value"
        )
      )
    ).toEqual({
      snippet: "set_variable = {\n\tname = $1\n\tvalue = $2\n}",
      plain: "set_variable = {\n\tname = \n\tvalue = \n}",
    });
  });

  it("uses explicitly mandatory fields from the docs, including a scope wrapper", () => {
    // CK3 script_docs: record_situation_special_event.
    const example = token(
      "record_situation_special_event",
      "scope:situation = { record_situation_special_event = { key = special_event_key actor = scope:character (optional) } }",
      "The key field is mandatory and enables special entry localization."
    );
    expect(minimalTokenInsert(example)?.snippet).toBe("record_situation_special_event = {\n\tkey = $1\n}");
  });

  it("keeps example fields even without an unconditional required declaration", () => {
    expect(
      minimalTokenInsert(
        token(
          "sample",
          "sample = { key = X value = Y }",
          "The key field is required if another field is set."
        )
      )?.snippet
    ).toBe("sample = {\n\tkey = $1\n\tvalue = $2\n}");
  });

  it("keeps nested control-flow fields without placeholder text", () => {
    expect(minimalTokenInsert(token("if", "if = { limit = { <triggers> } <effects> }"))?.snippet).toBe(
      "if = {\n\tlimit = {\n\t\t$1\n\t}\n\t$2\n}"
    );
  });

  it("keeps fields from Victoria 3 examples without concrete values", () => {
    expect(
      minimalTokenInsert(token("add_acceptance", "add_acceptance = { culture = cu:romanian value = -10 }"))
        ?.snippet
    ).toBe("add_acceptance = {\n\tculture = $1\n\tvalue = $2\n}");
  });

  it("omits fields marked optional inline and in prose", () => {
    expect(
      minimalTokenInsert(
        token(
          "sample",
          "sample = {\n key = X\n other = Y # optional\n last = Z\n}",
          "The last field is optional."
        )
      )?.snippet
    ).toBe("sample = {\n\tkey = $1\n}");
  });

  it("uses the first complete example when wiki usage includes trailing prose", () => {
    expect(
      minimalTokenInsert(
        token("set_variable", "set_variable = { name = X value = Y }\nUse the variable later.")
      )?.snippet
    ).toBe("set_variable = {\n\tname = $1\n\tvalue = $2\n}");
  });

  it("omits a field followed by a parenthesized optional marker", () => {
    expect(minimalTokenInsert(token("sample", "sample = { key = X actor = Y (optional) }"))?.snippet).toBe(
      "sample = {\n\tkey = $1\n\t$2\n}"
    );
  });

  it("leaves required parameter values blank and gives each a tabstop", () => {
    expect(syntaxInsert("sample", true, "=", [{ name: "TARGET" }, { name: "AMOUNT" }])).toEqual({
      snippet: "sample = {\n\tTARGET = $1\n\tAMOUNT = $2\n}",
      plain: "sample = {\n\tTARGET = \n\tAMOUNT = \n}",
    });
  });

  it("uses the documented operator without its example value", () => {
    expect(minimalTokenInsert(token("sample", "sample >= 10"))?.snippet).toBe("sample >= $0");
  });

  it("uses an empty block even when the example body is not executable", () => {
    expect(
      minimalTokenInsert(token("random_list", "random_list = { X1 = { effect1 } X2 = { effect2 } ... }"))
        ?.snippet
    ).toBe("random_list = {\n\t$0\n}");
  });

  it("keeps unknown syntax and copied sibling examples as names", () => {
    expect(minimalTokenInsert(token("sample"))).toBeNull();
    expect(minimalTokenInsert(token("sample", "sibling = { key = X }"))).toBeNull();
  });
});
