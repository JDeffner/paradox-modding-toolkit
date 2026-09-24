import { afterEach, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveConfig } from "../src/config";
import { fingerprint, referenceFingerprint } from "../src/files";
import { compareBaseline, writeBaseline, type Finding, type Validation } from "../src/validation";

const roots: string[] = [];
async function fixture() {
  await fs.mkdir(".local/testing", { recursive: true });
  const root = await fs.mkdtemp(path.resolve(".local/testing/pxtk-config-"));
  roots.push(root);
  await fs.mkdir(path.join(root, ".px-toolkit"));
  await fs.writeFile(path.join(root, "descriptor.mod"), 'name="test"');
  await fs.writeFile(
    path.join(root, ".px-toolkit/pxtk.json"),
    JSON.stringify({ game: "ck3", gamePath: null, logsPath: null })
  );
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
it("resolves the nearest project config and flag precedence", async () => {
  const root = await fixture();
  await fs.mkdir(path.join(root, "events"));
  const config = await resolveConfig({
    cwd: path.join(root, "events"),
    overrides: { language: "german" },
    env: {},
  });
  expect(config.mod).toBe(await fs.realpath(root));
  expect(config.gamePath).toBeNull();
  expect(config.language).toBe("german");
  expect(config.issues).toEqual([]);
});
it("reports an invalid supplied game path without silently choosing another install", async () => {
  const root = await fixture();
  const config = await resolveConfig({ cwd: root, overrides: { gamePath: "./absent" }, env: {} });
  expect(config.gamePath).toBeNull();
  expect(config.issues.join(" ")).toContain("absent");
});
it("rejects unknown config fields and game identifiers", async () => {
  const root = await fixture();
  await expect(resolveConfig({ cwd: root, overrides: { game: "typo" }, env: {} })).rejects.toThrow(
    "supported game"
  );
  await fs.writeFile(
    path.join(root, ".px-toolkit/pxtk.json"),
    JSON.stringify({ game: "ck3", gamePth: "typo" })
  );
  await expect(resolveConfig({ cwd: root, env: {} })).rejects.toThrow("Cannot read");
});
it("counts repeated baseline findings and ignores line movement", () => {
  const finding: Finding = {
    source: "tiger",
    code: "example",
    severity: "error",
    file: "events/test.txt",
    line: 2,
    column: 1,
    message: "Missing reference",
  };
  const result = compareBaseline(
    [
      { ...finding, line: 3 },
      { ...finding, line: 8 },
    ],
    [finding]
  );
  expect(result.existingFindings).toBe(1);
  expect(result.newFindings).toHaveLength(1);
  expect(compareBaseline([], [finding]).resolvedFindings).toEqual([finding]);
});
it("never overwrites a baseline or writes one after incomplete validation", async () => {
  const root = await fixture();
  const file = path.join(root, "baseline.json");
  await fs.writeFile(file, "user data");
  const validation = { complete: true, context: {}, findings: [] } as unknown as Validation;
  await expect(writeBaseline(file, validation, root)).rejects.toThrow();
  expect(await fs.readFile(file, "utf8")).toBe("user data");
  await expect(
    writeBaseline(path.join(root, "absent.json"), { ...validation, complete: false }, root)
  ).rejects.toThrow("requires completed");
  await expect(writeBaseline(path.join(root, "../outside.json"), validation, root)).rejects.toThrow(
    "inside the editable mod"
  );
  await expect(writeBaseline(path.join(root, "new.txt"), validation, root)).rejects.toThrow("JSON baseline");
});
it("uses an explicit config's directory and includes ordered playset parents", async () => {
  const root = await fixture();
  const parent = await fixture();
  const file = path.join(root, "settings.json");
  await fs.writeFile(
    file,
    JSON.stringify({ game: "ck3", mod: ".", gamePath: null, logsPath: null, parents: [parent] })
  );
  await fs.writeFile(path.join(root, ".px-toolkit/playset.json"), JSON.stringify({ parents: [parent] }));
  const config = await resolveConfig({ config: file, env: {} });
  expect(config.mod).toBe(await fs.realpath(root));
  expect(config.parents).toEqual([await fs.realpath(parent)]);
  expect(config.issues).toEqual([]);
});
it("detects content and validation-input edits separately from baseline output", async () => {
  const root = await fixture();
  const config = await resolveConfig({ cwd: root, env: {} });
  const content = await fingerprint(root);
  const references = await referenceFingerprint(config);
  await fs.writeFile(path.join(root, ".px-toolkit/before.json"), "{}");
  expect(await fingerprint(root)).toBe(content);
  expect(await referenceFingerprint(config)).toBe(references);
  await fs.writeFile(path.join(root, ".px-toolkit/schema.json"), "{}");
  expect(await referenceFingerprint(config)).not.toBe(references);
  await fs.writeFile(path.join(root, "probe.txt"), "test");
  expect(await fingerprint(root)).not.toBe(content);
});
