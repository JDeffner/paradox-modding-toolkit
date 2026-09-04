import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { migrateConfigDir, resolveConfigDir } from "../src/configDir";

const names = { configDirName: ".px-toolkit", legacyConfigDirName: ".ck3modding" };
const tmpMod = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "px-config-dir-"));

describe("configDir", () => {
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
