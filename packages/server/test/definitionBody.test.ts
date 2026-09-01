/**
 * Reading a definition's source block back for the hover, and the cache that
 * keeps it off the hot path.
 */
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { clearDefinitionBodyCache, definitionBody } from "../src/features/definitionBody";

const NL = String.fromCharCode(10);
const made: string[] = [];

function write(lines: string[]): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "px-body-")), "00_scripted_triggers.txt");
  fs.writeFileSync(file, lines.join(NL));
  made.push(path.dirname(file));
  return file;
}

afterEach(() => {
  clearDefinitionBodyCache();
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("definitionBody", () => {
  it("returns the whole block, braces included", () => {
    const file = write([
      "# a comment",
      "is_human = {",
      "  NOT = { has_trait = beast }",
      "}",
      "",
      "other = { always = yes }",
    ]);
    expect(definitionBody(file, 1)).toBe(["is_human = {", "  NOT = { has_trait = beast }", "}"].join(NL));
  });

  it("handles a block that opens and closes on one line", () => {
    const file = write(["other = { always = yes }", "next = { }"]);
    expect(definitionBody(file, 0)).toBe("other = { always = yes }");
  });

  it("returns the single line for an assignment with no block", () => {
    const file = write(["my_value = 5"]);
    expect(definitionBody(file, 0)).toBe("my_value = 5");
  });

  it("does not count braces inside comments or quoted strings", () => {
    const file = write([
      "tricky = {",
      '  desc = "a } brace in a string {"',
      "  # a } brace in a comment",
      "  value = 1",
      "}",
      "after = yes",
    ]);
    const body = definitionBody(file, 0);
    expect(body).toContain("value = 1");
    expect(body!.split(NL)).toHaveLength(5);
    expect(body).not.toContain("after");
  });

  it("gives up on a block that never closes rather than returning the rest of the file", () => {
    const file = write(["broken = {", "  a = 1", "  b = 2"]);
    expect(definitionBody(file, 0)).toBeNull();
  });

  it("stops at maxLines so one malformed file cannot dominate a hover", () => {
    const file = write(["big = {", ...Array.from({ length: 500 }, (_, i) => `  a${i} = 1`), "}"]);
    const body = definitionBody(file, 0, 20);
    expect(body!.split(NL)).toHaveLength(20);
  });

  it("returns null for a missing file or an out-of-range line", () => {
    const file = write(["a = { b = 1 }"]);
    expect(definitionBody(path.join(path.dirname(file), "nope.txt"), 0)).toBeNull();
    expect(definitionBody(file, 99)).toBeNull();
  });

  it("re-reads a file after it changes, with no explicit invalidation", () => {
    const file = write(["a = {", "  first = 1", "}"]);
    expect(definitionBody(file, 0)).toContain("first = 1");
    // A different mtime is what invalidates; writing twice in the same
    // millisecond would not, so set it explicitly.
    fs.writeFileSync(file, ["a = {", "  second = 2", "}"].join(NL));
    const later = new Date(Date.now() + 2000);
    fs.utimesSync(file, later, later);
    expect(definitionBody(file, 0)).toContain("second = 2");
  });
});
