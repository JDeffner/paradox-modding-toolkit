import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSkill, type DevPaths, type GenResult } from "../../../scripts/gen-skill";

const SRC = path.join(__dirname, "..", "skills", "ck3-modding");
const TOKENS = ["<game>", "<logs>", "<mods>", "<workshop>", "<tiger>"];

// Deliberately non-real paths so the assertions can't accidentally match template prose.
const FAKE: DevPaths = {
  gamePath: "Z:/games/steamapps/common/Crusader Kings III/game",
  logsPath: "Z:/docs/Paradox Interactive/Crusader Kings III/logs",
  tigerPath: "Z:/tools/ck3-tiger/ck3-tiger.exe",
};

function allFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) allFiles(full, out);
    else out.push(full);
  }
  return out;
}

describe("gen-skill", () => {
  let dest: string;
  let result: GenResult;

  beforeAll(() => {
    dest = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-genskill-"));
    result = generateSkill(FAKE, SRC, dest);
  });

  afterAll(() => {
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it("leaves no template placeholder token in any output file", () => {
    expect(result.unresolved).toEqual([]);
    for (const file of allFiles(dest)) {
      const text = fs.readFileSync(file, "utf8");
      for (const token of TOKENS) {
        expect(text.includes(token), `${token} in ${path.relative(dest, file)}`).toBe(false);
      }
    }
  });

  it("writes LF-only output (no CR bytes)", () => {
    for (const file of allFiles(dest)) {
      expect(fs.readFileSync(file, "utf8").includes("\r")).toBe(false);
    }
  });

  it("substitutes the derived paths (Windows-style)", () => {
    const skill = fs.readFileSync(path.join(dest, "SKILL.md"), "utf8");
    // <game> -> the game data dir, verbatim
    expect(skill).toContain("Z:\\games\\steamapps\\common\\Crusader Kings III\\game");
    // <workshop> -> derived from the game path's steam library
    expect(skill).toContain("Z:\\games\\steamapps\\workshop\\content\\1158310");
    // <mods> -> sibling `mod` of the logs dir
    const setup = fs.readFileSync(path.join(dest, "references", "setup.md"), "utf8");
    expect(setup).toContain("Z:\\docs\\Paradox Interactive\\Crusader Kings III\\mod");
    // <tiger> -> the configured validator path
    const validation = fs.readFileSync(path.join(dest, "references", "validation.md"), "utf8");
    expect(validation).toContain("Z:\\tools\\ck3-tiger\\ck3-tiger.exe");
    expect(result.substitutions).toBeGreaterThan(0);
    expect(result.tigerMissing).toBe(false);
  });

  it("falls back to a marker and flags it when tigerPath is missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ck3-genskill-notiger-"));
    try {
      const r = generateSkill({ gamePath: FAKE.gamePath, logsPath: FAKE.logsPath }, SRC, tmp);
      expect(r.tigerMissing).toBe(true);
      expect(r.unresolved).toEqual([]); // marker is not one of the five tokens
      const validation = fs.readFileSync(path.join(tmp, "references", "validation.md"), "utf8");
      expect(validation).toContain("SET tigerPath IN dev-paths.json");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
