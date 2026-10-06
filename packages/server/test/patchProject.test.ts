import { describe, expect, it } from "vitest";
import { parsePatchProject, validatePatchPath } from "../src/compatch/project";
import type { PatchProject } from "../src/compatch/model";

const project = (): PatchProject => ({
  version: 1,
  id: "patch",
  gameId: "test",
  name: "Example",
  inputs: [{ id: "a", name: "A" }],
  decisions: {},
  generated: {},
});

describe("portable maintained patch project", () => {
  it("round trips unknown project, input, decision, and generated fields", () => {
    const value = project();
    value.future = { details: [1, "kept"] };
    value.inputs[0].future = 2;
    value.decisions.example = {
      fingerprint: "abc",
      resolution: { mode: "defer", note: "Manual integration" },
      future: 3,
    };
    value.generated["common/defs/example.txt"] = { text: "\uFEFFx = 1", entries: ["example"], future: 4 };
    const parsed = parsePatchProject(JSON.stringify(value), "test");
    expect(parsed).toEqual(value);
    parsed.inputs[0].name = "Changed";
    expect(value.inputs[0].name).toBe("A");
  });

  it("rejects future versions and mismatched games", () => {
    expect(() => parsePatchProject({ ...project(), version: 2 })).toThrow("version");
    expect(() => parsePatchProject(project(), "other")).toThrow("game");
  });

  it.each([
    {
      inputs: [
        { id: "a", name: "A" },
        { id: "a", name: "Duplicate" },
      ],
    },
    { inputs: [{ name: "Missing ID" }] },
    { decisions: { x: { fingerprint: "abc", resolution: { mode: "unknown" } } } },
    { decisions: { x: { fingerprint: "abc", resolution: { mode: "source" } } } },
    { decisions: { x: { fingerprint: "abc", resolution: { mode: "fields", fields: { a: 4 } } } } },
    { decisions: { x: { fingerprint: "abc", resolution: { mode: "manual", text: 4 } } } },
    { generated: { "common/x.txt": { text: 4, entries: [] } } },
    { generated: { "common/x.txt": { text: "x = 1", entries: [null] } } },
  ])("rejects malformed known fields: %j", (change) => {
    expect(() => parsePatchProject({ ...project(), ...change })).toThrow();
  });

  it.each([
    "../outside.txt",
    "/absolute.txt",
    "C:/absolute.txt",
    "common\\x.txt",
    "common/./x.txt",
    "common//x.txt",
    "common/x.txt ",
    "common/NUL.txt",
    "common/x\u0000.txt",
  ])("guards paths: %s", (path) => {
    expect(() => validatePatchPath(path)).toThrow("Unsafe patch path");
    expect(() =>
      parsePatchProject({ ...project(), generated: { [path]: { text: "", entries: [] } } })
    ).toThrow();
  });
});
