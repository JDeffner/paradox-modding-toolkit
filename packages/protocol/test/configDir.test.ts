import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  indexConfigWatchPatterns,
  isIndexConfigFile,
  migrateConfigDir,
  resolveConfigDir,
} from "../src/configDir";

const names = { configDirName: ".px-toolkit", legacyConfigDirName: ".ck3modding" };
const tmpMod = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "px-config-dir-"));

describe("configDir", () => {
  it("watches current and legacy index configuration, including absent files", () => {
    const root = path.resolve("mod");
    expect(indexConfigWatchPatterns(names)).toEqual([
      "**/.px-toolkit/{schema,playset}.json",
      "**/.ck3modding/{schema,playset}.json",
    ]);
    expect(indexConfigWatchPatterns({ configDirName: ".px-toolkit" })).toEqual([
      "**/.px-toolkit/{schema,playset}.json",
    ]);
    for (const dir of [names.configDirName, names.legacyConfigDirName]) {
      expect(isIndexConfigFile(path.join(root, dir, "schema.json"), [root], names)).toBe(true);
      expect(isIndexConfigFile(path.join(root, dir, "playset.json"), [root], names)).toBe(true);
    }
    for (const relative of [
      "schema.json",
      ".px-toolkit/calendar.json",
      ".px-toolkit/nested/schema.json",
      "nested/.px-toolkit/playset.json",
    ]) {
      expect(isIndexConfigFile(path.join(root, relative), [root], names)).toBe(false);
    }
    expect(isIndexConfigFile(path.join(root + "-other", ".px-toolkit/schema.json"), [root], names)).toBe(
      false
    );
    expect(isIndexConfigFile(path.join(root, ".PX-TOOLKIT/SCHEMA.JSON"), [root], names)).toBe(
      process.platform === "win32"
    );
    expect(isIndexConfigFile(path.join(root.toUpperCase(), ".px-toolkit/schema.json"), [root], names)).toBe(
      process.platform === "win32"
    );
  });

  it("resolves to the current name for a fresh mod without creating it", () => {
    const root = tmpMod();
    expect(resolveConfigDir(root, names)).toBe(path.join(root, ".px-toolkit"));
    expect(fs.existsSync(path.join(root, ".px-toolkit"))).toBe(false);
  });

  it("reads from the legacy dir while only that one exists", () => {
    const root = tmpMod();
    fs.mkdirSync(path.join(root, ".ck3modding"));
    expect(resolveConfigDir(root, names)).toBe(path.join(root, ".ck3modding"));
  });

  it("prefers the current dir when both exist", () => {
    const root = tmpMod();
    fs.mkdirSync(path.join(root, ".ck3modding"));
    fs.mkdirSync(path.join(root, ".px-toolkit"));
    expect(resolveConfigDir(root, names)).toBe(path.join(root, ".px-toolkit"));
  });

  it("renames the legacy dir on the first write, keeping its files", () => {
    const root = tmpMod();
    fs.mkdirSync(path.join(root, ".ck3modding"));
    fs.writeFileSync(path.join(root, ".ck3modding", "schema.json"), "{}");
    expect(migrateConfigDir(root, names)).toBe(path.join(root, ".px-toolkit"));
    expect(fs.existsSync(path.join(root, ".ck3modding"))).toBe(false);
    expect(fs.readFileSync(path.join(root, ".px-toolkit", "schema.json"), "utf8")).toBe("{}");
  });

  it("ignores the legacy name for a game that never had one", () => {
    const root = tmpMod();
    fs.mkdirSync(path.join(root, ".ck3modding"));
    expect(resolveConfigDir(root, { configDirName: ".px-toolkit" })).toBe(path.join(root, ".px-toolkit"));
  });
});
