/**
 * Exercise the bundled CLI against the configured CK3 install and Tiger.
 * All generated content stays in .local/testing; game files are read-only.
 * Build with esbuild to dist/test-pxtk-real.cjs, then run that file.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { requireDevPath, devPath } from "./devPaths";
import { digest } from "../packages/cli/src/config";
import type { PxtkResult } from "@px-lsp/protocol/agentTools";

const exec = promisify(execFile);
async function main(): Promise<void> {
  const root = path.resolve(__dirname, "..");
  const game = requireDevPath("gamePath", "test-pxtk-real", "ck3");
  const tiger = requireDevPath("tigerPath", "test-pxtk-real", "ck3");
  const bundle = path.join(root, "packages/cli/dist/pxtk.cjs");
  const evidenceFile = path.join(game, "common/scripted_effects/00_intercourse_effects.txt");
  const evidence = await fs.readFile(evidenceFile);
  assert.match(
    evidence.toString("utf8"),
    /add_gold\s*=\s*1\b/,
    "The test effect must be backed by installed vanilla."
  );
  const testing = path.join(root, ".local/testing");
  await fs.mkdir(testing, { recursive: true });
  const mod = await fs.mkdtemp(path.join(testing, "pxtk real "));
  const artifacts = path.join(root, ".local/artifacts", path.basename(mod));
  await fs.mkdir(artifacts, { recursive: true });
  await fs.mkdir(path.join(mod, ".px-toolkit"));
  await fs.mkdir(path.join(mod, "common/scripted_effects"), { recursive: true });
  await fs.writeFile(path.join(mod, "descriptor.mod"), '\uFEFFname="pxtk real validation"\nversion="0.1"\n');
  const config = { game: "ck3", gamePath: game, tigerPath: tiger, logsPath: devPath("logsPath", "ck3") };
  await fs.writeFile(path.join(mod, ".px-toolkit/pxtk.json"), JSON.stringify(config, null, 2));
  const script = path.join(mod, "common/scripted_effects/pxtk_probe.txt");
  const clean = "\uFEFFpxtk_probe = { add_gold = 1 }\npxtk_caller = { pxtk_probe = yes }\n";
  await fs.writeFile(script, clean);
  const reports: Array<{ name: string; code: number; elapsedMs: number; status: string }> = [];
  async function run(name: string, args: string[], codes: number[] = [0]): Promise<PxtkResult> {
    const started = Date.now();
    let stdout: string,
      code = 0;
    try {
      ({ stdout } = await exec(process.execPath, [bundle, ...args, "--json"], {
        cwd: mod,
        env: { ...process.env, PX_GAME_ID: "ck3", PX_CK3_MOD_PATH: mod },
        timeout: 360_000,
        maxBuffer: 16 * 1024 * 1024,
      }));
    } catch (error) {
      const failed = error as { stdout: string; code: number };
      if (!failed.stdout) throw error;
      stdout = failed.stdout;
      code = failed.code;
    }
    const result = JSON.parse(stdout) as PxtkResult;
    await fs.writeFile(path.join(artifacts, name + ".json"), JSON.stringify(result, null, 2));
    reports.push({ name, code, elapsedMs: Date.now() - started, status: result.status });
    console.log(`${name}: exit ${code}, ${result.status} (${Date.now() - started} ms)`);
    assert.ok(codes.includes(code), `${name}: expected exit ${codes}, got ${code}; see ${artifacts}`);
    return result;
  }
  const status = await run("status", ["status"]);
  assert.equal(status.sources.game, "ck3");
  const search = await run("search", ["search", "add_gold"]);
  assert.ok((search.data.documentation as { items: unknown[] }).items.length > 0);
  await run("inspect", ["inspect", "add_gold", "--kind", "effect"]);
  const impact = await run("impact", ["impact", "pxtk_probe", "--kind", "scripted_effect"]);
  assert.equal((impact.data.callers as { items: Array<{ name: string }> }).items[0]?.name, "pxtk_caller");
  const baseline = path.join(mod, ".px-toolkit/before.json");
  const initial = await run("baseline", ["validate", "--write-baseline", baseline], [0, 1]);
  assert.equal(initial.data.complete, true);
  const savedBaseline = digest(await fs.readFile(baseline));
  await fs.writeFile(script, clean.replace("add_gold = 1", "pxtk_intentionally_invalid_effect = yes"));
  const invalid = await run("new-error", ["validate", "--baseline", baseline], [1]);
  assert.ok(Number(invalid.data.newErrors) > 0);
  assert.equal(invalid.data.baselineApplied, true);
  await fs.writeFile(script, clean);
  const fixed = await run("fixed", ["validate", "--baseline", baseline]);
  assert.equal(fixed.data.newErrors, 0);
  await run("refuse-overwrite", ["validate", "--write-baseline", baseline], [2]);
  assert.equal(digest(await fs.readFile(baseline)), savedBaseline);
  await run("config-mismatch", ["validate", "--language", "german", "--baseline", baseline], [2]);
  await run("missing-validator", ["validate", "--tiger", path.join(mod, "missing-tiger.exe")], [2]);
  await run("create-event", ["create", "event", "pxtk_cli.1", "--prefix", "pxtk_cli", "--write"]);
  await run("edit-localization", ["loc", "set", "pxtk_cli_1_t", "--value", "CLI generated event", "--write"]);
  await run("format-event", ["format", "events/pxtk_cli_events.txt", "--write"]);
  await run("validate-scaffold", ["validate", "--baseline", baseline]);
  assert.equal(digest(await fs.readFile(evidenceFile)), digest(evidence));
  assert.equal(await fs.readFile(script, "utf8"), clean);
  await fs.writeFile(
    path.join(artifacts, "summary.json"),
    JSON.stringify(
      {
        gameVersion: status.sources.gameVersion,
        mod,
        evidenceFile,
        evidenceSha256: digest(evidence),
        reports,
      },
      null,
      2
    )
  );
  console.log(`Passed real CK3 exercise. Reports: ${artifacts}`);
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
