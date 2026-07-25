/**
 * Mod-corpus validation (update plan v1.1 §B4). Gated on the configured
 * corpusPath (see devPaths.ts): skipped when unset. Asserts, over the whole
 * mod tree:
 *   (a) zero parse exceptions (offender ratio under the vanilla bar),
 *   (b) definition-count floors per the corrected A0 numbers,
 * plus two synthetic-document smoke tests that do NOT need the corpus content but
 * live here so the §B2/§B3 wiring is exercised end-to-end alongside the floors:
 *   (c) completion offers structure keys and ambient scopes,
 *   (d) hover on a structure key returns its doc.
 *
 * Run (Git Bash):
 *   CK3_MOD_CORPUS='<path to a big mod>' npx vitest run test/modCorpus.test.ts
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parseScript, decode } from "../src/parser";
import { scanRoot } from "../src/index/indexer";
import { loadSchema } from "../src/schema/loader";
import { CK3_SCHEMA } from "../src/games/ck3/schema";
import { CompletionFeature } from "../src/features/completion";
import { provideHover } from "../src/features/hover";
import { ServerData } from "../src/serverData";
import { devPath } from "../../../scripts/devPaths";

const CORPUS = devPath("corpusPath");
const run = CORPUS ? describe : describe.skip;

function walk(dir: string, ext: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, ext, out);
    else if (e.name.toLowerCase().endsWith(ext) && !e.name.endsWith(".info")) out.push(full);
  }
}

run("mod corpus (AGOT)", () => {
  it("parses the whole script tree with no exceptions and near-zero structural errors", () => {
    const root = CORPUS!;
    const files: string[] = [];
    for (const d of ["common", "events", "history", "gui"]) walk(path.join(root, d), ".txt", files);
    expect(files.length).toBeGreaterThan(0);

    let withErrors = 0;
    const offenders: string[] = [];
    for (const file of files) {
      const { text } = decode(fs.readFileSync(file));
      // "zero parse exceptions": parseScript must never throw on any file.
      const res = parseScript(text);
      if (res.errors.length > 0) {
        withErrors++;
        if (offenders.length < 20) {
          const e = res.errors[0];
          offenders.push(`${path.relative(root, file)} :: ${e.code} @${e.range.start}`);
        }
      }
    }
    const ratio = withErrors / files.length;
    // eslint-disable-next-line no-console
    console.log(
      `\n[mod-corpus] txt files: ${files.length}, with-errors: ${withErrors} (${(ratio * 100).toFixed(3)}%)`
    );
    if (offenders.length) {
      // eslint-disable-next-line no-console
      console.log("[mod-corpus] offenders (sample):\n  " + offenders.join("\n  "));
    }
    expect(ratio).toBeLessThan(0.005);
  }, 120000);

  it("yields definition counts above the measured A0 floors", () => {
    const defs = scanRoot(CORPUS!, "mod", { locLanguage: "english" });
    const byKind: Record<string, number> = {};
    for (const d of defs) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;

    // eslint-disable-next-line no-console
    console.log(
      `\n[mod-corpus] effects=${byKind.scripted_effect} triggers=${byKind.scripted_trigger} ` +
        `values=${byKind.script_value} modifiers=${byKind.scripted_modifier}`
    );

    // Floors just under the A0-measured yield (14,877 · 3,707 · 7,108 · 307).
    expect(byKind.scripted_effect ?? 0).toBeGreaterThanOrEqual(14000);
    expect(byKind.scripted_trigger ?? 0).toBeGreaterThanOrEqual(3500);
    expect(byKind.script_value ?? 0).toBeGreaterThanOrEqual(6500);
    expect(byKind.scripted_modifier ?? 0).toBeGreaterThanOrEqual(300);
  }, 120000);

  it("captures a PdxDoc block for a known documented AGOT effect (§E)", () => {
    const defs = scanRoot(CORPUS!, "mod", { locLanguage: "english" });
    // `# used in disburse_tour_activity_rewards on scope:host` sits directly
    // above `accolades_activity_complete_tour_glory_effect` in
    // common/scripted_effects/00_accolades_scripted_effects.txt.
    const def = defs.find((d) => d.name === "accolades_activity_complete_tour_glory_effect");
    expect(def, "known documented effect indexed").toBeDefined();
    expect(def!.doc, "doc prose captured").toContain("disburse_tour_activity_rewards");
  }, 120000);
});

// Smoke tests for the §B2/§B3 wiring. Synthetic documents — always run.
describe("character_interaction completion & hover smoke (§B2/§B3)", () => {
  const schema = loadSchema(null);
  const interactionEntry = CK3_SCHEMA.find((e) => e.kind === "character_interaction")!;
  const data = new ServerData();
  const completion = new CompletionFeature(data, () => schema);
  // Unique uri per document: the parse cache keys by uri+version, so reusing one
  // uri with different content would serve a stale parse.
  let n = 0;
  const uri = () => `file:///mod/common/character_interactions/smoke-${n++}.txt`;

  it("empty-prefix top-level completion offers is_shown and desc among the first items", () => {
    const text = "my_interaction = {\n\t\n}";
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    const offset = text.indexOf("\n\t") + 2;
    const { items } = completion.provide(doc, offset, new Set(["character"]), interactionEntry);
    // Sort as VS Code would (by sortText) and take the leading window.
    const sorted = [...items].sort((a, b) => (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label));
    const firstLabels = sorted.slice(0, 40).map((i) => i.label);
    expect(firstLabels).toContain("is_shown");
    expect(firstLabels).toContain("desc");
  });

  it("completion after scope: offers actor / recipient / secondary_recipient", () => {
    const text = "my_interaction = {\n\tis_shown = { scope: }\n}";
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    const offset = text.indexOf("scope:") + "scope:".length;
    const { items } = completion.provide(doc, offset, new Set(["character"]), interactionEntry);
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(["actor", "recipient", "secondary_recipient"]));
  });

  it("hover on a structure key returns the doc", () => {
    const text = "my_interaction = {\n\tis_shown = { }\n}";
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    const hover = provideHover(
      data,
      doc,
      { line: 1, character: 2 },
      new Set(["character"]),
      interactionEntry,
      () => schema
    );
    expect(hover).not.toBeNull();
    expect((hover!.contents as { value: string }).value).toContain("character_interactions");
  });
});
