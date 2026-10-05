import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { runMigrationWorker } from "../src/migrations/node/runner";
import type { MigrationSnapshot } from "../src/migrations/sdk";
import { migrationTemplate } from "../../vscode/src/compatch/migrationTemplate";

const base = path.resolve(".local/testing");
let scratch: string, worker: string, recipe: string, codeHash: string;
beforeAll(async () => {
  await fs.mkdir(base, { recursive: true });
  scratch = await fs.mkdtemp(path.join(base, "migration-worker-"));
  worker = path.join(scratch, "worker.cjs");
  recipe = path.join(scratch, "recipe.cjs");
  await build({
    entryPoints: ["packages/server/src/migrations/node/worker.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: worker,
    logLevel: "silent",
  });
  const source = migrationTemplate("ck3");
  await fs.writeFile(recipe, source);
  codeHash = createHash("sha256").update(source).digest("hex");
});
afterAll(async () => {
  if (scratch && path.dirname(scratch) === base && path.basename(scratch).startsWith("migration-worker-"))
    await fs.rm(scratch, { recursive: true, force: true });
});

async function outputRecipe(name: string, outputPath: string, text: string, includeEvidence = true) {
  const manifest = {
    id: name,
    revision: "1",
    sdkVersion: 1,
    gameId: "ck3",
    fromVersion: "1.0",
    toVersion: "1.1",
    kind: "recipe",
    detection: "script",
    requirement: "required",
    guidance: "",
    limitations: [],
    dependsOn: [],
    title: name,
    description: "Worker boundary fixture",
    ...(includeEvidence ? { evidence: [] } : {}),
    inputs: [{ root: "target", path: "localization" }],
  };
  const source = `module.exports = {
    manifest: ${JSON.stringify(manifest)},
    inspect() { return { applicability: "applicable", findings: [], questions: [], coverage: [] }; },
    prepare() { return { groups: [{ id: "output", title: "Output", dependsOn: [], changes: [
      { kind: "create", path: ${JSON.stringify(outputPath)}, bytes: new TextEncoder().encode(${JSON.stringify(text)}) }
    ] }], checks: [], unresolved: [] }; }
  };`;
  const localPath = path.join(scratch, `${name}.cjs`);
  await fs.writeFile(localPath, source);
  return { localPath, codeHash: createHash("sha256").update(source).digest("hex") };
}

const emptySnapshot = (): MigrationSnapshot => ({ gameId: "ck3", files: [], metadata: {} });
const note = (id = "manual-note") => ({
  manifest: {
    id,
    revision: "1",
    sdkVersion: 1,
    gameId: "ck3",
    fromVersion: "1.0",
    toVersion: "1.1",
    kind: "advisory",
    detection: "none",
    requirement: "required",
    title: id,
    description: "Manual change",
    guidance: "Read the upstream notes and review your definitions.",
    limitations: ["No automatic detection"],
    dependsOn: [],
    evidence: [],
    inputs: [],
  },
});

async function artifact(filename: string, source: string) {
  const localPath = path.join(scratch, filename);
  await fs.writeFile(localPath, source);
  return { localPath, codeHash: createHash("sha256").update(source).digest("hex") };
}

describe("isolated migration runner", () => {
  it("runs trusted discovery, validates requests and rejects oversized inputs before starting a worker", async () => {
    const manifest = {
      ...note().manifest,
      sdkVersion: 2,
      kind: "recipe",
      detection: "script",
      inputs: [{ root: "mod", path: "gfx", capture: "listing", extensions: [".dds"] }],
    };
    const selection = await artifact(
      "discovery.cjs",
      `module.exports = {
      manifest: ${JSON.stringify(manifest)},
      discover(context, answers) { if (context.readBytes('mod', 'gfx/a.dds') !== undefined) throw new Error('listing read bytes'); if (context.fileInfo('mod', 'gfx/a.dds').size !== 5) throw new Error('wrong size'); return answers.invalid ? [{root:'target',path:'gfx/a.dds'}] : [{root:'mod',path:'gfx/a.dds'}]; },
      inspect() { return {applicability:'applicable', findings:[], questions:[], coverage:[]}; },
      prepare() { return {groups:[], checks:[], unresolved:[]}; }
    };`
    );
    const snapshot = { ...emptySnapshot(), listings: [{ root: "mod" as const, path: "gfx/a.dds", size: 5 }] };
    expect(
      await runMigrationWorker(worker, { action: "discover", gameId: "ck3", selection, snapshot })
    ).toEqual({ kind: "discovered", selected: [{ root: "mod", path: "gfx/a.dds" }] });
    await expect(
      runMigrationWorker(worker, {
        action: "discover",
        gameId: "ck3",
        selection,
        snapshot,
        answers: { invalid: true },
      })
    ).rejects.toThrow("outside declared listing");
    await expect(
      runMigrationWorker(worker, {
        action: "discover",
        gameId: "ck3",
        selection: { localPath: selection.localPath },
        snapshot,
      })
    ).rejects.toThrow("Explicitly load and trust");
    const small = new Uint8Array(1024);
    const oversized = {
      ...emptySnapshot(),
      files: Array.from({ length: 10_001 }, (_, index) => ({
        root: "mod" as const,
        path: `gfx/${index}.dds`,
        bytes: small,
      })),
    };
    await expect(
      runMigrationWorker("missing-worker.cjs", {
        action: "inspect",
        gameId: "ck3",
        selection,
        snapshot: oversized,
      })
    ).rejects.toThrow("input file limit");
  });

  it("loads data-only JSON without executable trust and inspects it honestly", async () => {
    const selection = await artifact("notes.json", JSON.stringify([note(), note("another-note")]));
    const loaded = await runMigrationWorker(worker, {
      action: "load",
      gameId: "ck3",
      selection: { localPath: selection.localPath },
    });
    expect(loaded).toMatchObject({
      kind: "loaded",
      manifests: [note().manifest, note("another-note").manifest],
      codeHash: selection.codeHash,
    });
    const inspected = await runMigrationWorker(worker, {
      action: "inspect",
      gameId: "ck3",
      selection: { ...selection, id: "manual-note" },
      snapshot: emptySnapshot(),
    });
    expect(inspected).toMatchObject({
      kind: "inspected",
      result: {
        inspection: {
          applicability: "unknown",
          findings: [],
          questions: [],
          coverage: [note().manifest.guidance, "No automatic detection"],
        },
      },
    });
    await expect(
      runMigrationWorker(worker, {
        action: "prepare",
        gameId: "ck3",
        selection: { ...selection, id: "manual-note" },
        snapshot: emptySnapshot(),
      })
    ).rejects.toThrow("advisory entries cannot prepare");
    await expect(
      runMigrationWorker(worker, {
        action: "inspect",
        gameId: "ck3",
        selection,
        snapshot: emptySnapshot(),
      })
    ).rejects.toThrow("Select one migration entry ID");
  });

  it("never evaluates JavaScript inside a JSON artifact and rejects executable JSON capabilities", async () => {
    const sentinel = path.join(scratch, "json-executed.txt");
    const selection = await artifact(
      "executable.json",
      `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed');`
    );
    await expect(runMigrationWorker(worker, { action: "load", gameId: "ck3", selection })).rejects.toThrow();
    await expect(fs.stat(sentinel)).rejects.toMatchObject({ code: "ENOENT" });
    for (const bad of [
      { ...note(), inspect: "() => ({})" },
      { ...note(), prepare: "() => ({})" },
      { manifest: { ...note().manifest, kind: "recipe", detection: "script" } },
      { manifest: { ...note().manifest, detection: "script" } },
    ]) {
      const invalid = await artifact("capabilities.json", JSON.stringify(bad));
      await expect(
        runMigrationWorker(worker, { action: "load", gameId: "ck3", selection: invalid })
      ).rejects.toThrow("JSON entries must be data-only advisories");
    }
  });

  it("rejects changed JSON after load, duplicate IDs and mismatched game profiles", async () => {
    const selection = await artifact("changed-note.json", JSON.stringify(note()));
    await runMigrationWorker(worker, { action: "load", gameId: "ck3", selection });
    await fs.appendFile(selection.localPath, "\n");
    await expect(
      runMigrationWorker(worker, {
        action: "inspect",
        gameId: "ck3",
        selection,
        snapshot: emptySnapshot(),
      })
    ).rejects.toThrow("changed");
    for (const [filename, entries, message] of [
      ["duplicate.json", [note(), note()], "duplicate"],
      ["wrong-game.json", [{ manifest: { ...note().manifest, gameId: "vic3" } }], "different game"],
    ] as const) {
      const invalid = await artifact(filename, JSON.stringify(entries));
      await expect(
        runMigrationWorker(worker, { action: "load", gameId: "ck3", selection: invalid })
      ).rejects.toThrow(message);
    }
  });

  it("loads all executable bundle entries and runs only the selected entry", async () => {
    const a = await outputRecipe("bundle-a", "a.bin", "a");
    const b = await outputRecipe("bundle-b", "b.bin", "b");
    const exports = await Promise.all(
      [a, b].map(async (selection) => {
        const source = await fs.readFile(selection.localPath, "utf8");
        return source.replace(/^module\.exports = /u, "").replace(/;$/u, "");
      })
    );
    const selection = await artifact("bundle.cjs", `module.exports = [${exports.join(",")}];`);
    const loaded = await runMigrationWorker(worker, { action: "load", gameId: "ck3", selection });
    expect(loaded.kind).toBe("loaded");
    if (loaded.kind === "loaded")
      expect(loaded.manifests.map((manifest) => manifest.id)).toEqual(["bundle-a", "bundle-b"]);
    const prepared = await runMigrationWorker(worker, {
      action: "prepare",
      gameId: "ck3",
      selection: { ...selection, id: "bundle-b" },
      snapshot: emptySnapshot(),
    });
    expect(prepared.kind).toBe("prepared");
    if (prepared.kind === "prepared") expect(prepared.plan.files.map((file) => file.path)).toEqual(["b.bin"]);
    await fs.appendFile(selection.localPath, "\n");
    await expect(
      runMigrationWorker(worker, {
        action: "prepare",
        gameId: "ck3",
        selection: { ...selection, id: "bundle-b" },
        snapshot: emptySnapshot(),
      })
    ).rejects.toThrow("changed");
  });

  it("detects artifact changes during module evaluation", async () => {
    const selection = await artifact(
      "changes-itself.cjs",
      `require('node:fs').appendFileSync(__filename, '\\n'); module.exports = ${JSON.stringify(note())};`
    );
    await expect(runMigrationWorker(worker, { action: "load", gameId: "ck3", selection })).rejects.toThrow(
      "changed while loading"
    );
  });

  it("lists profile recipes without loading local code", async () => {
    const result = await runMigrationWorker(worker, { action: "catalog", gameId: "ck3" });
    expect(result.kind).toBe("catalog");
    if (result.kind === "catalog")
      expect(result.manifests.some((manifest) => manifest.id === "ck3.faiths-to-rites.decisions")).toBe(true);
  });
  it("loads an explicitly pinned local bundle and rejects changed trust", async () => {
    const selection = { localPath: recipe, codeHash };
    const result = await runMigrationWorker(worker, { action: "load", gameId: "ck3", selection });
    expect(result.kind).toBe("loaded");
    await expect(
      runMigrationWorker(worker, {
        action: "load",
        gameId: "ck3",
        selection: { ...selection, codeHash: "old" },
      })
    ).rejects.toThrow("changed");
  });
  it("reports unsupported games and invalid artifacts", async () => {
    await expect(runMigrationWorker(worker, { action: "catalog", gameId: "missing" })).rejects.toThrow(
      "Unknown"
    );
    const invalid = path.join(scratch, "invalid.cjs");
    await fs.writeFile(invalid, "module.exports={};");
    await expect(
      runMigrationWorker(worker, {
        action: "load",
        gameId: "ck3",
        selection: {
          localPath: invalid,
          codeHash: createHash("sha256").update("module.exports={};").digest("hex"),
        },
      })
    ).rejects.toThrow("missing manifest");
  });
  it("rejects a local manifest missing evidence during load", async () => {
    const selection = await outputRecipe("missing-evidence", "fixture.bin", "fixture", false);
    await expect(runMigrationWorker(worker, { action: "load", gameId: "ck3", selection })).rejects.toThrow(
      "invalid manifest documentation"
    );
  });
  it("rejects event output without its required namespace during preparation", async () => {
    const selection = await outputRecipe("missing-namespace", "events/fixture.txt", "fixture = { }\n");
    await expect(
      runMigrationWorker(worker, { action: "prepare", gameId: "ck3", selection, snapshot: emptySnapshot() })
    ).rejects.toThrow("Event output must start with its namespace declaration");
  });
  it("rejects localization output with an invalid filename during preparation", async () => {
    const selection = await outputRecipe(
      "invalid-localization-filename",
      "localization/fixture.yml",
      '\uFEFFl_english:\n fixture_key:0 "new"\n'
    );
    await expect(
      runMigrationWorker(worker, { action: "prepare", gameId: "ck3", selection, snapshot: emptySnapshot() })
    ).rejects.toThrow("matching _l_<language>.yml filename");
  });
  it("allows mod-owned localization keys in a recipe-selected replace layout without target vanilla keys", async () => {
    const selection = await outputRecipe(
      "replacement-localization",
      "localization/replace/fixture_l_english.yml",
      '\uFEFFl_english:\n fixture_key:0 "mod-owned"\n'
    );
    const snapshot = emptySnapshot();
    const result = await runMigrationWorker(worker, {
      action: "prepare",
      gameId: "ck3",
      selection,
      snapshot,
    });
    expect(result.kind).toBe("prepared");
    if (result.kind === "prepared") {
      expect(result.plan.files.map((file) => file.path)).toEqual([
        "localization/replace/fixture_l_english.yml",
      ]);
      expect(result.plan.files[0].after).toEqual(
        new TextEncoder().encode('\uFEFFl_english:\n fixture_key:0 "mod-owned"\n')
      );
    }
  });
  it("terminates a blocked author worker on cancellation", async () => {
    const looping = path.join(scratch, "loop.cjs");
    const source = "while(true) {}";
    await fs.writeFile(looping, source);
    const controller = new AbortController();
    const running = runMigrationWorker(
      worker,
      {
        action: "load",
        gameId: "ck3",
        selection: { localPath: looping, codeHash: createHash("sha256").update(source).digest("hex") },
      },
      controller.signal
    );
    setTimeout(() => controller.abort(), 150);
    await expect(running).rejects.toThrow("cancelled");
  });
});
