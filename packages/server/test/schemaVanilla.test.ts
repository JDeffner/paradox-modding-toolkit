/**
 * Vanilla-corpus validation for the CK3 schema table. Gated on CK3_GAME_PATH:
 * skipped entirely when the env var is unset (CI without the game installed).
 *
 * For every .txt schema entry it walks the real vanilla folder, runs
 * extractDefinitions over every file, and asserts the folder yields at least
 * one definition (folders legitimately missing in the install are skipped with
 * a log line). For every entry with requiredLoc it measures the fraction of
 * that kind's definitions whose expected loc key exists in the vanilla english
 * localization and asserts >= 95%.
 *
 * Run:
 *   $env:CK3_GAME_PATH = "F:\SteamLibrary\...\Crusader Kings III\game"
 *   npx vitest run test/schemaVanilla.test.ts
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { extractDefinitions } from "../src/index/extract";
import { CK3_SCHEMA } from "../src/games/ck3/schema";
import type { Definition } from "@px-lsp/protocol/types";
import { devPath } from "../../../scripts/devPaths";

const GAME = devPath("gamePath");
const run = GAME ? describe : describe.skip;

/** Read a script/loc file stripping a leading UTF-8 BOM, mirroring the
 * indexer's decodeBuffer (production never feeds the BOM char to the parser). */
function readText(file: string): string {
  const text = fs.readFileSync(file, "utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function walkFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full, ext));
    else if (e.name.toLowerCase().endsWith(ext) && !e.name.endsWith(".info")) out.push(full);
  }
  return out;
}

/** Fast loc-key set: scan every english yml for ` key:` lines (no full parse). */
const LOC_KEY = /^\s*([A-Za-z0-9_.-]+):\s?\d*\s*"/;
function loadLocKeys(root: string): Set<string> {
  const keys = new Set<string>();
  const dir = path.join(root, "localization", "english");
  for (const file of walkFiles(dir, ".yml")) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const m = LOC_KEY.exec(line);
      if (m) keys.add(m[1]);
    }
  }
  return keys;
}

run("vanilla corpus extraction", () => {
  const txtEntries = CK3_SCHEMA.filter((e) => (e.ext ?? ".txt") === ".txt");
  const counts: Record<string, number> = {};
  const missing: string[] = [];

  // Walks and extracts every vanilla .txt folder; seconds of real work, so it
  // needs a real bound rather than the 5s default.
  it("every .txt folder yields definitions (missing folders skipped)", { timeout: 120_000 }, () => {
    for (const entry of txtEntries) {
      const folder = path.join(GAME!, entry.path);
      if (!fs.existsSync(folder)) {
        missing.push(entry.path);
        continue;
      }
      const files = walkFiles(folder, ".txt");
      let total = 0;
      for (const file of files) {
        const content = readText(file);
        total += extractDefinitions(content, entry, file, "vanilla").length;
      }
      counts[entry.kind] = total;
      expect(total, `${entry.kind} (${entry.path}) extracted 0 definitions`).toBeGreaterThan(0);
    }

    // Table
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const pad = Math.max(...rows.map(([k]) => k.length));

    console.log("\n  kind -> vanilla definition count");
    for (const [kind, n] of rows) {
      console.log(`  ${kind.padEnd(pad)}  ${n}`);
    }
    if (missing.length) {
      console.log(`\n  folders absent in this install (skipped): ${missing.join(", ")}`);
    }
  });

  it("gui folder yields gui types", () => {
    const entry = CK3_SCHEMA.find((e) => e.kind === "gui_type")!;
    const folder = path.join(GAME!, entry.path);
    if (!fs.existsSync(folder)) return;
    let total = 0;
    for (const file of walkFiles(folder, ".gui")) {
      const content = readText(file);
      total += extractDefinitions(content, entry, file, "vanilla").length;
    }

    console.log(`  gui_type  ${total}`);
    expect(total).toBeGreaterThan(0);
  });
});

run("requiredLoc coverage >= 95%", () => {
  const locEntries = CK3_SCHEMA.filter((e) => e.requiredLoc && (e.ext ?? ".txt") === ".txt");

  it("each requiredLoc pattern is defined for >=95% of vanilla defs", () => {
    const keys = loadLocKeys(GAME!);
    for (const entry of locEntries) {
      const folder = path.join(GAME!, entry.path);
      if (!fs.existsSync(folder)) continue;
      const defs: Definition[] = [];
      for (const file of walkFiles(folder, ".txt")) {
        const content = readText(file);
        defs.push(...extractDefinitions(content, entry, file, "vanilla"));
      }
      if (defs.length === 0) continue;
      for (const pattern of entry.requiredLoc!) {
        let hit = 0;
        for (const def of defs) {
          const key = pattern.replace("$", def.name);
          if (keys.has(key)) hit++;
        }
        const coverage = hit / defs.length;

        console.log(`  ${entry.kind} "${pattern}": ${(coverage * 100).toFixed(1)}% (${hit}/${defs.length})`);
        expect(
          coverage,
          `${entry.kind} pattern "${pattern}" only ${(coverage * 100).toFixed(1)}% covered`
        ).toBeGreaterThanOrEqual(0.95);
      }
    }
  });
});
