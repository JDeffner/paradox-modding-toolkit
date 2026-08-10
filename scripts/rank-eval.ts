/**
 * Standalone completion-ranking eval (update plan v1.1 §C4). Same core as the
 * gated vitest suite (test/rankEval.test.ts), runnable without the test runner so
 * the numbers can be captured before and after a ranking change.
 *
 * Run:
 *   npx esbuild scripts/rank-eval.ts --bundle --platform=node --outfile=dist/rank-eval.cjs \
 *     && node dist/rank-eval.cjs <modPath> [gamePath]
 *   (or set CK3_MOD_CORPUS / CK3_GAME_PATH)
 */
import * as path from "path";
import { buildEvalEnv, runRankEval, formatMetrics } from "../packages/server/test/rankEvalCore";
import { devPath, requireDevPath } from "./devPaths";

const modPath = process.argv[2] ?? requireDevPath("corpusPath", "rank-eval");
const gamePath = process.argv[3] ?? devPath("gamePath");

const wikidocsDir = path.join(__dirname, "..", "packages", "server", "data", "ck3", "wikidocs");
const freqsDir = path.join(__dirname, "..", "packages", "server", "data", "ck3");

const t0 = Date.now();
const env = buildEvalEnv({ wikidocsDir, freqsDir, gamePath, modPath });
console.log(
  `index built: ${env.data.index.stats().total} defs, ${env.data.refIndex.size} refs, ` +
    `${env.data.tokens.length} tokens (${Date.now() - t0} ms)`
);

const t1 = Date.now();
const { samples, metrics } = runRankEval(env, modPath, { seed: 1234567, perContext: 200 });
console.log(`sampled ${samples.length} key-positions (${Date.now() - t1} ms)\n`);
console.log(formatMetrics(metrics));
