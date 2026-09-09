import { describe, expect, it } from "vitest";
import { buildSnippetCatalogue } from "../src/features/snippetCatalogue";
import type { TokenData } from "@px-lsp/protocol/types";
import { minimalTokenInsert, scriptedCallTemplate } from "../src/features/completionInsert";
import { resolveProfile } from "../src/games/registry";

describe("generated snippet catalogue", () => {
  it("exports all tokens without the cursor picker's cap and keeps both kinds of a name", () => {
    const tokens: TokenData[] = Array.from({ length: 80 }, (_, i) => ({
      name: `sample_${i}`,
      kind: "effect",
      scopes: [],
      doc: "",
      usage: `sample_${i} = { key = X }`,
    }));
    tokens.push({ ...tokens[0], kind: "trigger" });
    const entries = buildSnippetCatalogue(tokens, undefined, []);
    expect(entries).toHaveLength(81);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(81);
    expect(entries.every((entry) => entry.variants.length === 2)).toBe(true);
  });

  it("uses the same insertion and preview rules as completion", () => {
    const token: TokenData = {
      name: "set_variable",
      kind: "effect",
      scopes: [],
      usage: "set_variable = { name = X value = Y days = Z }",
      doc: "Where X is the name of the variable\nWhere Y is any event target, bool, value, script value or flag\nAn optional days where Z is the number of days",
    };
    const [entry] = buildSnippetCatalogue([token], undefined, []);
    expect(entry.variants[0].snippet).toBe(minimalTokenInsert(token)!.snippet);
    expect(entry.variants[0].preview).toContain("| value | any event target");
    expect(entry.variants[0].snippet).not.toContain("days");
    expect(entry.variants[1].snippet).toContain("days");
  });

  it("includes all-fields variants and effective scripted calls", () => {
    const token: TokenData = {
      name: "sample",
      kind: "effect",
      scopes: [],
      doc: "",
      usage: "sample = {\n key = X\n other = Y # optional\n}",
    };
    const def = {
      name: "my_effect",
      kind: "scripted_effect",
      source: "mod" as const,
      file: "mod.txt",
      line: 0,
      params: ["TARGET"],
    };
    const entries = buildSnippetCatalogue([token], undefined, [def, def]);
    expect(entries[1].variants.map((v) => v.label)).toEqual(["Minimal", "Examples", "All fields"]);
    expect(entries[0].variants[0].snippet).toBe(scriptedCallTemplate(def, "minimal")!.snippet);
    expect(entries[0].category).toBe("Scripted calls");
  });

  it.each(["ck3", "vic3", "eu5"])("exports every bundled definition and child block for %s", (game) => {
    const profile = resolveProfile(game);
    const entries = buildSnippetCatalogue([], profile.skeletons, []);
    const expected = Object.values(profile.skeletons ?? {}).reduce(
      (sum, kind) => sum + 1 + Object.keys(kind.blocks ?? {}).length,
      0
    );
    expect(entries).toHaveLength(expected);
    expect(entries.every((entry) => entry.variants[0].snippet.length > 0)).toBe(true);
  });
});
