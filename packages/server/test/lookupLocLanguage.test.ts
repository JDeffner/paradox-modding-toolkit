import { afterAll, beforeAll, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { lookupLocLanguage } from "../src/overview/lookupLocLanguage";

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "px-loc-language-"));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

it("selects the requested language, honors mod shadowing and reads unsaved text", async () => {
  const mod = path.join(root, "mod");
  const vanilla = path.join(root, "vanilla");
  const folders = ["in_game/localization"];
  const write = (base: string, language: string, value: string) => {
    const file = path.join(base, folders[0], `sample_l_${language}.yml`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `l_${language}:\n same_key:0 "${value}"\n`);
    return file;
  };
  const german = write(mod, "german", "Mod Deutsch");
  write(mod, "english", "Mod English");
  write(vanilla, "german", "Vanilla Deutsch");
  const roots = [
    { path: vanilla, source: "vanilla" as const },
    { path: mod, source: "mod" as const },
  ];
  expect(await lookupLocLanguage("same_key", "german", roots, folders)).toEqual([
    { file: german, line: 1, source: "mod", value: "Mod Deutsch" },
  ]);
  expect(
    await lookupLocLanguage(
      "same_key",
      "german",
      roots,
      folders,
      new Map([[german, 'l_german:\n same_key:0 "Unsaved"']])
    )
  ).toMatchObject([{ value: "Unsaved" }]);
  expect(await lookupLocLanguage("same_key", "french", roots, folders)).toEqual([]);
  expect(await lookupLocLanguage("same_key", "../english", roots, folders)).toEqual([]);
});

it("finds new unsaved files and accepts the existing custom-language identifier contract", async () => {
  const file = path.join(root, "custom", "localization", "new_l_custom_language.yml");
  const roots = [{ path: path.join(root, "custom"), source: "mod" as const }];
  expect(
    await lookupLocLanguage(
      "new_key",
      "custom_language",
      roots,
      ["localization"],
      new Map([[file, 'l_custom_language:\n new_key:0 "Unsaved new file"']])
    )
  ).toEqual([{ file, line: 1, source: "mod", value: "Unsaved new file" }]);
});
