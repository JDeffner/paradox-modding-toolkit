import { afterAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { dnaFiles, gameDnaCopy } from "../src/webviews/dynastyTree/dna";
import { scanBlocks, parseDnaPaste, dnaPasteBlock } from "../src/webviews/dynastyTree/scan";
import { parseScript } from "@px-lsp/server/parser";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "px-dynasty-dna-"));
const folder = "common/dna_data";
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));
function write(root: string, file: string, text: string): string {
  const full = path.join(root, folder, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

describe("dynasty DNA lookup", () => {
  it("exports persistent DNA and imports it back with every gene and override intact", () => {
    const portrait =
      "genes={ hair_color={ 14 244 25 255 } }\nportrait_modifier_overrides={ custom_hair=example_hair }";
    const copied = gameDnaCopy(`test_dna={ portrait_info={ ${portrait} } enabled=yes }`, true);
    expect(copied?.format).toBe("persistent");
    expect(copied?.text).toContain("type=female");
    expect(copied?.text).toContain(portrait);
    expect(copied?.text).not.toContain("portrait_info");
    expect(copied?.text).not.toContain("enabled");
    const pasted = dnaPasteBlock("another_dna", parseDnaPaste(copied!.text)!);
    expect(pasted).toContain("portrait_info");
    expect(pasted).toContain(portrait);
    expect(parseScript(pasted!).errors).toEqual([]);
    expect(pasted).not.toContain("type=");
    expect(gameDnaCopy(pasted!, true)?.text).toContain(portrait);
  });

  it("uses the character's sex without losing stored portrait metadata", () => {
    const copied = gameDnaCopy("test={portrait_info={type=male age=0.3 random_seed=42 genes={}}}", true);
    expect(copied?.text).toBe("test={type=female age=0.3 random_seed=42 genes={}}");
    const pasted = dnaPasteBlock("new_dna", parseDnaPaste(copied!.text)!);
    expect(pasted).not.toMatch(/type=|age=|random_seed=/);
    expect(pasted).toContain("genes={}");
  });

  it("copies stored DNA strings and refuses incomplete or unrelated blocks", () => {
    expect(gameDnaCopy('test={dna="abc+/123="}', false)).toEqual({ text: "abc+/123=", format: "string" });
    expect(gameDnaCopy("test={portrait_info={genes={}", false)).toBeNull();
    expect(gameDnaCopy("test={trait=brave}", false)).toBeNull();
  });

  it("finds nested dependency DNA and applies file and definition overrides", () => {
    const game = path.join(scratch, "game");
    const parent = path.join(scratch, "parent");
    const mod = path.join(scratch, "mod");
    const vanilla = write(game, "shared.txt", "hidden = { dna = vanilla }");
    const overridden = write(parent, "a.txt", "portrait = { dna = earlier }");
    const winner = write(parent, "portraits/z.txt", "portrait = { dna = later }");
    const replacement = write(mod, "shared.txt", "replacement = { dna = mod }");
    const files = dnaFiles([game, parent, mod], folder);
    expect(files).toEqual([replacement, winner, overridden]);
    expect(files).not.toContain(vanilla);
    const found = files.map((f) => scanBlocks(fs.readFileSync(f, "utf8")).get("portrait")).find(Boolean);
    expect(found?.text).toBe("portrait = { dna = later }");
  });

  it("includes a new unsaved DNA file while excluding other folders and file types", () => {
    const mod = path.join(scratch, "new-mod");
    const unsaved = path.join(mod, folder, "portraits/new.txt");
    expect(
      dnaFiles([mod], folder, [
        unsaved,
        path.join(mod, "events/event.txt"),
        path.join(mod, folder, "image.dds"),
      ])
    ).toEqual([unsaved]);
  });
});
