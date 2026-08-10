import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as protocol from "../src/protocol";

/**
 * docs/PROTOCOL.md is the contract external clients code against, so it is
 * published surface, not a courtesy. Nothing enforced that it stayed in sync
 * with the exported constants: adding a request and forgetting the doc was a
 * silent break for anyone not reading our source.
 *
 * The constants are the source of truth; this only asserts the doc matches.
 */
const DOC = path.join(__dirname, "..", "..", "..", "docs", "PROTOCOL.md");
const WIRE_PREFIX = "paradox/";

function declaredMethods(): string[] {
  const out = new Set<string>();
  for (const value of Object.values(protocol)) {
    if (typeof value === "string" && value.startsWith(WIRE_PREFIX)) out.add(value);
  }
  return [...out].sort();
}

function documentedMethods(text: string): string[] {
  return [...new Set(text.match(/paradox\/[A-Za-z]+/g) ?? [])].sort();
}

describe("docs/PROTOCOL.md", () => {
  it("documents every exported wire method, and no method that no longer exists", () => {
    const declared = declaredMethods();
    expect(declared.length).toBeGreaterThan(10); // sanity: the module actually loaded

    const documented = documentedMethods(fs.readFileSync(DOC, "utf8"));
    expect(documented).toEqual(declared);
  });
});
