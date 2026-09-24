import { afterEach, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { prepareTigerConfig } from "../src/tigerConfig";

const roots: string[] = [];
function fixture() {
  fs.mkdirSync(".local/testing", { recursive: true });
  const modRoot = fs.mkdtempSync(path.resolve(".local/testing/tiger-config-"));
  roots.push(modRoot);
  const configDir = path.join(modRoot, ".px-toolkit");
  fs.mkdirSync(configDir);
  return { modRoot, configDir, confName: "validator.conf", descriptor: "mod" as const, parentPaths: [] };
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it("preserves existing configuration and applies explicit, toolkit, then mod-root precedence", () => {
  const input = fixture();
  const inMod = path.join(input.modRoot, input.confName);
  const inConfig = path.join(input.configDir, input.confName);
  const explicit = path.join(input.modRoot, "explicit.conf");
  for (const file of [inMod, inConfig, explicit]) fs.writeFileSync(file, "# user configuration\n");
  for (const [options, expected] of [
    [{ ...input, explicitConfig: explicit }, explicit],
    [input, inConfig],
  ] as const) {
    const prepared = prepareTigerConfig(options);
    expect(prepared.args).toEqual(["--config", expected]);
    prepared.dispose();
    expect(fs.readFileSync(expected, "utf8")).toBe("# user configuration\n");
  }
  fs.unlinkSync(inConfig);
  const prepared = prepareTigerConfig(input);
  expect(prepared.source).toBe(inMod);
  prepared.dispose();
  expect(fs.existsSync(inMod)).toBe(true);
});
it("removes its temporary configuration without writing into the mod", () => {
  const input = fixture();
  const before = fs.readdirSync(input.modRoot);
  const prepared = prepareTigerConfig(input);
  expect(prepared.source).toBeNull();
  expect(fs.readFileSync(prepared.args[1], "utf8")).toBe("");
  expect(fs.readdirSync(input.modRoot)).toEqual(before);
  prepared.dispose();
  expect(fs.existsSync(prepared.args[1])).toBe(false);
});
it("fails when generated dependency configuration would omit a declared parent", () => {
  const input = fixture();
  expect(() => prepareTigerConfig({ ...input, parentPaths: [path.join(input.modRoot, "missing")] })).toThrow(
    "dependency descriptors are missing"
  );
});
