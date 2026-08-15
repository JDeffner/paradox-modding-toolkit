/**
 * Standalone completion-ranking eval (update plan v1.1 §C4). Same core as the
 * gated vitest suite (test/rankEval.test.ts), runnable without the test runner so
 * the numbers can be captured before and after a ranking change.
 *
 * Game-neutral: `--game <id>` picks the profile, and the bundled data it loads
 * (wikidocs, freqs.json, script_docs) is the same per-game bundle the live server
 * uses, so the measured numbers reflect a server a user actually runs.
 *
 * Run:
 *   npx esbuild scripts/rank-eval.ts --bundle --platform=node --outfile=dist/rank-eval.cjs \
 *     && node dist/rank-eval.cjs [--game <id>] [modPath ...] [gamePath is read from dev-paths]
 *   (mod corpus defaults to dev-paths games.<id>.modCorpus; pass several mod
 *    roots to sample across a whole workshop collection)
 */
import * as path from "path";
import { buildEvalEnv, runRankEval, formatMetrics } from "../packages/server/test/rankEvalCore";
import { devPath, parseGameArg, requireDevPath } from "./devPaths";

const { gameId, rest } = parseGameArg(process.argv.slice(2));
const modPaths = rest.length > 0 ? rest : [requireDevPath("corpusPath", "rank-eval", gameId)];
const gamePath = devPath("gamePath", gameId);

const dataDir = path.join(__dirname, "..", "packages", "server", "data", gameId);
const wikidocsDir = path.join(dataDir, "wikidocs");
const scriptDocsDir = path.join(dataDir, "script_docs");

const t0 = Date.now();
const env = buildEvalEnv({
  gameId,
  wikidocsDir,
  freqsDir: dataDir,
  scriptDocsDir,
  gamePath,
  modPath: modPaths,
});
console.log(
  `[${gameId}] index built: ${env.data.index.stats().total} defs, ${env.data.refIndex.size} refs, ` +
    `${env.data.tokens.length} tokens (${Date.now() - t0} ms)`
);

const t1 = Date.now();
const { samples, metrics } = runRankEval(env, modPaths, { seed: 1234567, perContext: 200 });
console.log(`sampled ${samples.length} key-positions (${Date.now() - t1} ms)\n`);
console.log(formatMetrics(metrics));
