import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  assertConfigPath,
  canonicalConfigPath,
  resolveConfigPath,
  type ConfigDirNames,
} from "../src/configDir";
import { readProjectSettings } from "../src/projectSettingsFile";

const names = { configDirName: ".px-toolkit", legacyConfigDirName: ".ck3modding" };
const temporary: string[] = [];
function tmpMod(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "px-config-path-"));
  temporary.push(root);
  return root;
}
function write(root: string, dir: string, relative: string, text: string): string {
  const file = path.join(root, dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}
afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { force: true, recursive: true });
});

describe("independent config artifact resolution", () => {
  it("resolves disjoint current and legacy files even when both directories exist", () => {
    const root = tmpMod();
    const current = write(root, names.configDirName, "schema.json", "current schema");
    const legacy = write(root, names.legacyConfigDirName, "calendar.json", "legacy calendar");
    write(root, names.legacyConfigDirName, "schema.json", "legacy schema");
    const workshop = write(root, names.legacyConfigDirName, "workshop/description.txt", "legacy listing");
    expect(resolveConfigPath(root, names, "schema.json")).toBe(current);
    expect(resolveConfigPath(root, names, "calendar.json")).toBe(legacy);
    expect(resolveConfigPath(root, names, "workshop")).toBe(path.dirname(workshop));
    expect(resolveConfigPath(root, names, "workshop/description.txt")).toBe(workshop);
    expect(resolveConfigPath(root, names, "project.json")).toBe(
      path.join(root, names.configDirName, "project.json")
    );
    expect(canonicalConfigPath(root, names, "calendar.json")).toBe(
      path.join(root, names.configDirName, "calendar.json")
    );
    expect(fs.readFileSync(legacy, "utf8")).toBe("legacy calendar");
  });

  it("does not create a config folder for a fresh mod", () => {
    const root = tmpMod();
    expect(resolveConfigPath(root, names, "workshop/nested/file.txt")).toBe(
      path.join(root, names.configDirName, "workshop/nested/file.txt")
    );
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it.each([
    "",
    "../calendar.json",
    "nested/../calendar.json",
    "nested\\..\\calendar.json",
    "/calendar.json",
    "C:\\calendar.json",
    "C:calendar.json",
    "\\\\host\\file",
    "file:stream",
    "./file",
    "a//file",
    "a\u0000b",
  ])("rejects unsafe relative paths: %s", (relative) => {
    const root = tmpMod();
    expect(() => canonicalConfigPath(root, names, relative)).toThrow();
    expect(() => resolveConfigPath(root, names, relative)).toThrow();
  });

  it.each(["", ".", "..", "../other", "folder/child", "folder\\child", "C:", "name*", "{schema,project}"])(
    "rejects unsafe configuration names: %s",
    (configDirName) => {
      const root = tmpMod();
      expect(() => canonicalConfigPath(root, { configDirName }, "project.json")).toThrow();
      expect(() =>
        canonicalConfigPath(root, { ...names, legacyConfigDirName: configDirName }, "project.json")
      ).toThrow();
    }
  );

  it("rejects escaped directory junctions before reading or writing missing files", () => {
    const root = tmpMod();
    const outside = tmpMod();
    fs.symlinkSync(
      outside,
      path.join(root, names.configDirName),
      process.platform === "win32" ? "junction" : "dir"
    );
    expect(() => canonicalConfigPath(root, names, "project.json")).toThrow("escapes");
    expect(() => assertConfigPath(root, names, "nested/new.json")).toThrow("escapes");
    expect(readProjectSettings(root, names)).toMatchObject({
      error: expect.stringContaining("escapes"),
      legacy: false,
    });
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("rejects nested junctions to sibling folders and preserves the current artifact priority", () => {
    const root = tmpMod();
    const sibling = path.join(root, "source");
    fs.mkdirSync(sibling);
    fs.mkdirSync(path.join(root, names.configDirName));
    fs.symlinkSync(
      sibling,
      path.join(root, names.configDirName, "workshop"),
      process.platform === "win32" ? "junction" : "dir"
    );
    write(root, names.legacyConfigDirName, "workshop/readme.txt", "legacy");
    expect(() => resolveConfigPath(root, names, "workshop/readme.txt")).toThrow("escapes");
    expect(() => canonicalConfigPath(root, names, "workshop/new/file.txt")).toThrow("escapes");
  });
});

describe("project settings file boundary", () => {
  it.each<[string, ConfigDirNames]>([
    ["ck3", names],
    ["vic3", { configDirName: ".px-toolkit", legacyConfigDirName: ".vic3modding" }],
    ["eu5", { configDirName: ".px-toolkit" }],
  ])("reads only the supplied names for %s", (gameId, dirs) => {
    const root = tmpMod();
    write(root, ".wronggame", "project.json", '{"version":1}');
    expect(readProjectSettings(root, dirs, gameId)).toEqual({
      path: path.join(root, dirs.configDirName, "project.json"),
      legacy: false,
    });
    const dir = dirs.legacyConfigDirName ?? dirs.configDirName;
    const file = write(
      root,
      dir,
      "project.json",
      `\uFEFF${JSON.stringify({ version: 1, gameId, future: "keep" })}`
    );
    if (dirs.legacyConfigDirName) fs.mkdirSync(path.join(root, dirs.configDirName));
    expect(readProjectSettings(root, dirs, gameId)).toEqual({
      path: file,
      legacy: !!dirs.legacyConfigDirName,
      settings: { version: 1, gameId, future: "keep" },
    });
  });

  it.each([
    "not JSON",
    '{"version":2}',
    '{"version":1,"gameId":"vic3"}',
    '{"version":1,"validation":{"ignore":false}}',
  ])("reports invalid current files without falling back: %s", (current) => {
    const root = tmpMod();
    write(root, names.legacyConfigDirName, "project.json", '{"version":1,"gameId":"ck3"}');
    const file = write(root, names.configDirName, "project.json", current);
    expect(readProjectSettings(root, names, "ck3")).toEqual({
      path: file,
      legacy: false,
      error: expect.any(String),
    });
  });

  it("reports unreadable current artifacts without falling back", () => {
    const root = tmpMod();
    write(root, names.legacyConfigDirName, "project.json", '{"version":1}');
    const file = path.join(root, names.configDirName, "project.json");
    fs.mkdirSync(file, { recursive: true });
    expect(readProjectSettings(root, names)).toEqual({
      path: file,
      legacy: false,
      error: expect.any(String),
    });
  });

  it("reports invalid legacy content with its actual selected path", () => {
    const root = tmpMod();
    const file = write(root, names.legacyConfigDirName, "project.json", '{"version":9}');
    expect(readProjectSettings(root, names)).toEqual({
      path: file,
      legacy: true,
      error: expect.stringContaining("version"),
    });
    expect(fs.readFileSync(file, "utf8")).toBe('{"version":9}');
  });
});
