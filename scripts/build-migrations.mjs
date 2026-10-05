import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const server = join(root, "packages", "server");
const require = createRequire(import.meta.url);

await build({
  absWorkingDir: server,
  entryPoints: { sdk: "src/migrations/sdk.ts", routes: "src/migrations/routes.ts" },
  outdir: "dist/migrations",
  bundle: true,
  format: "cjs",
  // Node emits export annotations for ESM consumers of these dependency-free CJS modules.
  platform: "node",
  target: "es2022",
});
await build({
  absWorkingDir: server,
  entryPoints: { testing: "src/migrations/testing.ts", engine: "src/migrations/engine.ts" },
  outdir: "dist/migrations",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
});
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.migrations.json"], {
  cwd: server,
  stdio: "inherit",
});
await build({
  absWorkingDir: server,
  entryPoints: ["examples/migrations/folderExample.ts"],
  outfile: "dist/examples/migrations/folderExample.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
});
