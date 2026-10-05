import { describe, expect, it } from "vitest";
import { findLocKeyRefs } from "../src/locRefs";

describe("literal localization references", () => {
  it.each(["title = missing_key", 'title = "missing_key"', "event = { title = missing_key }"])(
    "recognizes %s",
    (line) => expect(findLocKeyRefs(line).map((ref) => ref.key)).toEqual(["missing_key"])
  );

  it.each([
    "# title = missing_key",
    "title = scope:dynamic_title",
    'text = "title = fake_key"',
    "title = key[GetName]",
  ])("does not invent a key from %s", (line) => expect(findLocKeyRefs(line)).toEqual([]));

  it("retains a literal before a comment and ignores commented references", () => {
    expect(findLocKeyRefs("title = visible_key # desc = hidden_key").map((ref) => ref.key)).toEqual([
      "visible_key",
    ]);
  });
});
