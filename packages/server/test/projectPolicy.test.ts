import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ProjectPolicyCache, owningProjectRoot, projectDiagnosticPolicy } from "../src/projectPolicy";
import { loadSchema } from "../src/schema/loader";
import { resolveProfile } from "../src/games/registry";
import { setActiveProfile } from "../src/games/active";

const fixtures: string[] = [];
const profile = resolveProfile("ck3");
const fallback = { diagnosticsIgnore: ["missing-bom"], diagnosticsIgnorePatterns: ["events/*"] };

afterEach(() => {
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "px-project-policy-"));
  fixtures.push(root);
  const write = (relative: string, value: unknown) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    return file;
  };
  return { root, write, cache: new ProjectPolicyCache() };
}

describe("editable-mod project policy", () => {
  it("uses explicit project rules independently, preserving fallback for absent fields", () => {
    const f = fixture();
    f.write("one/.px-toolkit/project.json", { version: 1, validation: { ignore: [] } });
    f.write("two/.px-toolkit/project.json", { version: 1, validation: { ignorePatterns: [] } });
    expect(projectDiagnosticPolicy(f.cache.read(path.join(f.root, "one"), profile), fallback)).toEqual({
      ignore: [],
      ignorePatterns: ["events/*"],
    });
    expect(projectDiagnosticPolicy(f.cache.read(path.join(f.root, "two"), profile), fallback)).toEqual({
      ignore: ["missing-bom"],
      ignorePatterns: [],
    });
  });

  it.each([
    ["malformed", "{", "JSON"],
    ["future", { version: 2 }, "version"],
    ["wrong game", { version: 1, gameId: "vic3" }, "vic3"],
  ])(
    "reports %s current settings without falling back to a valid legacy artifact",
    (_label, value, cause) => {
      const f = fixture();
      f.write(".ck3modding/project.json", { version: 1, validation: { ignore: [] } });
      const current = f.write(".px-toolkit/project.json", value);
      const result = f.cache.read(f.root, profile);
      expect(result.path).toBe(current);
      expect(result.error).toContain(cause);
      expect(result.settings).toBeUndefined();
      expect(projectDiagnosticPolicy(result, fallback)).toEqual({
        ignore: fallback.diagnosticsIgnore,
        ignorePatterns: fallback.diagnosticsIgnorePatterns,
      });
    }
  );

  it("reloads edits and deletions only after cache invalidation", () => {
    const f = fixture();
    f.write(".px-toolkit/calendar.json", {});
    f.write(".ck3modding/project.json", { version: 1, validation: { ignore: ["legacy"] } });
    expect(f.cache.read(f.root, profile).legacy).toBe(true);
    const current = f.write(".px-toolkit/project.json", { version: 1, validation: { ignore: [] } });
    expect(f.cache.read(f.root, profile).legacy).toBe(true);
    f.cache.clear();
    expect(f.cache.read(f.root, profile).settings?.validation?.ignore).toEqual([]);
    fs.unlinkSync(current);
    f.cache.clear();
    expect(f.cache.read(f.root, profile).settings?.validation?.ignore).toEqual(["legacy"]);
  });

  it("finds the closest owning mod and rejects a sibling prefix", () => {
    const root = path.resolve("test-project-policy");
    const nested = path.join(root, "nested");
    expect(owningProjectRoot(path.join(nested, "events/a.txt"), [root, nested])).toBe(nested);
    expect(owningProjectRoot(path.join(`${root}-dependency`, "events/a.txt"), [root])).toBeNull();
  });

  it("reads legacy schema beside a current unrelated artifact and does not hide an invalid current schema", () => {
    setActiveProfile(profile);
    const f = fixture();
    f.write(".px-toolkit/project.json", { version: 1 });
    f.write(".ck3modding/schema.json", {
      entries: [{ path: "common/policy_fixture", kind: "scripted_effect" }],
    });
    expect(loadSchema(f.root).entries.some((entry) => entry.path === "common/policy_fixture")).toBe(true);
    f.write(".px-toolkit/schema.json", "{");
    const messages: string[] = [];
    expect(
      loadSchema(f.root, (message) => messages.push(message)).entries.some(
        (entry) => entry.path === "common/policy_fixture"
      )
    ).toBe(false);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("schema overlay ignored");
  });
});
