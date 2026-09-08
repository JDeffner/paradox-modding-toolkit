// Install the actual npm tarballs outside the workspace. No workspace aliases may help resolution.
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "px-packed-consumer-"));
const run = (command, cwd = scratch) => execSync(command, { cwd, stdio: "inherit" });
// Pack inside each package; copy the resulting tarballs via a destination path.
for (const pkg of ["protocol", "server"]) {
  run(`pnpm pack --pack-destination "${scratch}"`, join(root, "packages", pkg));
}
const tarball = (name) =>
  readdirSync(scratch).find((file) => file.startsWith(`px-lsp-${name}-`) && file.endsWith(".tgz"));
writeFileSync(
  join(scratch, "package.json"),
  JSON.stringify({
    private: true,
    dependencies: {
      "@px-lsp/protocol": `file:./${tarball("protocol")}`,
      "@px-lsp/server": `file:./${tarball("server")}`,
    },
  })
);
writeFileSync(
  join(scratch, "pnpm-workspace.yaml"),
  `overrides:\n  '@px-lsp/protocol': 'file:./${tarball("protocol")}'\n`
);
run("pnpm install --ignore-scripts");
writeFileSync(
  join(scratch, "consumer.ts"),
  `
import { createBrowserLanguageService, type BakedTokens } from "@px-lsp/server/browser";
import tokens from "@px-lsp/server/browser-data/ck3/tokens.json";
import { statusNotification } from "@px-lsp/protocol/protocol";
if (!statusNotification) throw new Error("protocol export missing");
const doc = createBrowserLanguageService({ tokens: tokens as BakedTokens }).openDocument("events/consumer.txt", "namespace = consumer\\nconsumer.1 = { immediate = { } }");
if (!Array.isArray(doc.diagnostics())) throw new Error("browser diagnostics unavailable");
doc.dispose();
`
);
const outfile = join(scratch, "consumer.mjs");
await build({
  entryPoints: [join(scratch, "consumer.ts")],
  outfile,
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
});
// Type-check using the installed tarballs' declarations, not source path aliases.
writeFileSync(
  join(scratch, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      module: "esnext",
      moduleResolution: "bundler",
      target: "es2022",
      resolveJsonModule: true,
      allowSyntheticDefaultImports: true,
    },
    files: ["consumer.ts"],
  })
);
const tsc = join(root, "node_modules/typescript/bin/tsc");
run(`node "${tsc}" -p tsconfig.json`);
await import(pathToFileURL(outfile).href);
const server = join(scratch, "node_modules/@px-lsp/server/dist/server.js");
// Reuse the transport assertions against the installed npm payload.
execSync("pnpm exec vitest run packages/server/test/stdioSmoke.test.ts", {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PX_LSP_SERVER: server },
});
console.log(
  `Packed protocol, browser declarations/data, and server transport passed (${JSON.parse(readFileSync(join(scratch, "node_modules/@px-lsp/server/package.json"), "utf8")).version})`
);
