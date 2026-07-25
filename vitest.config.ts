import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    // The corpus-gated suites parse the real game tree (~460k definitions, and
    // the AGOT corpus on top), so seconds per test is normal here and the 5s
    // default is not a meaningful bound. It only ever passed because vitest 2
    // ran fewer files concurrently; under vitest 4's scheduling the same tests
    // time out. Individually slower suites still set their own (rank eval, the
    // cold-scan budget, mod corpus).
    testTimeout: 60_000,
    // --expose-gc makes global.gc() real. Without it the memory budget in
    // packages/server/test/budgets.test.ts measures collector timing instead of
    // the index, and can report a NEGATIVE cost while still passing.
    execArgv: ["--expose-gc"],
  },
});
