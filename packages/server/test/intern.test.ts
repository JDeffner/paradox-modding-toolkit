/**
 * §C2: the index shares the identifier strings it holds instead of keeping the
 * parser's substrings, which pin the whole file (see budgets.test.ts for the
 * retention budget that proves the point). Here: the sharing must be invisible,
 * i.e. every field keeps its exact value.
 */
import { describe, expect, it } from "vitest";
import type { Definition, Reference } from "@px-lsp/protocol/types";
import {
  copyOf,
  intern,
  internedCount,
  resetInternTable,
  shareDefinitionStrings,
  shareReferenceStrings,
} from "../src/index/intern";

describe("intern", () => {
  it("hands equal strings the same copy, and the copy is not the original", () => {
    const long = "some_long_definition_name_that_v8_would_slice";
    const a = intern(`x ${long}`.slice(2));
    const b = intern(`y ${long}`.slice(2));
    expect(a).toBe(long);
    expect(b).toBe(long);
    expect(Object.is(a, b)).toBe(true);
  });

  it("copies without sharing, preserving astral characters", () => {
    const s = "Ærlig 𐐷 text";
    expect(copyOf(s)).toBe(s);
    expect(copyOf(s).length).toBe(s.length);
  });

  it("starts a fresh table on reset, so a rebuilt index shares nothing old", () => {
    intern("reset_me_please_now");
    expect(internedCount()).toBeGreaterThan(0);
    resetInternTable();
    expect(internedCount()).toBe(0);
    expect(intern("reset_me_please_now")).toBe("reset_me_please_now");
    expect(internedCount()).toBe(1);
  });
});

describe("sharing an extracted batch", () => {
  it("keeps every definition field exactly as it was", () => {
    const def: Definition = {
      name: "my_scripted_effect",
      kind: "scripted_effect",
      file: "F:/mod/common/scripted_effects/e.txt",
      line: 12,
      source: "mod",
      value: "chain:immediate.every_vassal",
      container: "some_event.1",
      params: ["TARGET", "AMOUNT"],
      doc: "Gives the target gold. ".repeat(20),
      tags: [{ tag: "param", text: "TARGET the character" }],
      entryMode: "REPLACE",
    };
    const copy: Definition = { ...def, params: [...def.params!], tags: [{ ...def.tags![0] }] };
    expect(shareDefinitionStrings([copy])[0]).toEqual(def);
  });

  it("keeps every reference field exactly as it was", () => {
    const ref: Reference = {
      name: "character_event",
      kinds: ["event"],
      file: "F:/mod/events/e.txt",
      line: 3,
      startChar: 8,
      endChar: 23,
      call: true,
      chain: "immediate.every_vassal",
    };
    expect(shareReferenceStrings([{ ...ref }])[0]).toEqual(ref);
  });
});
