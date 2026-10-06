// Install the actual npm tarballs in an isolated consumer. No workspace aliases may help resolution.
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
import { MIGRATION_LIMITS } from "@px-lsp/server/migrations";
import { planMigrationRoutes } from "@px-lsp/server/migrations/routes";
if (!statusNotification) throw new Error("protocol export missing");
if (!(MIGRATION_LIMITS.files > 0)) throw new Error("browser migration SDK unavailable");
if (planMigrationRoutes([], "ck3", "1.0", "2.0").routes.length) throw new Error("unexpected synthetic migration route");
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
  // A repo-local TEMP must not inherit source aliases from the root tsconfig.
  tsconfigRaw: {},
});
writeFileSync(
  join(scratch, "migration-consumer.ts"),
  String.raw`
import assert from "node:assert/strict";
import { defineMigration, type MigrationRecipe } from "@px-lsp/server/migrations";
import { inspectMigration, prepareMigration, verifyPreparedMigration } from "@px-lsp/server/migrations/engine";
import { planMigrationRoutes } from "@px-lsp/server/migrations/routes";
import { assertMigrationIdempotent, createMigrationSnapshot } from "@px-lsp/server/migrations/testing";
import { parseLocalizationDefaults, suggestLocalizationTarget, upsertLocalizationText } from "@px-lsp/protocol/localizationPolicy";
import type { MigrationAnswers, MigrationManifest } from "@px-lsp/protocol/migration";

// The wire module is type-only, but its published JavaScript must still load in plain Node.
await import("@px-lsp/protocol/migration");
const path = "migration-demo.txt";
const before = '\uFEFFdemo_old = yes\r\n# café: keep this comment\n';
const after = before.replace("demo_old", "demo_new");
const locPath = "localization/english/migration-demo_l_english.yml";
const defaults = parseLocalizationDefaults({ language: "english", entryVersion: "zero" });
const target = suggestLocalizationTarget({
  key: "packed_example_name", language: defaults.language!, documents: [],
  locRoots: ["localization"], sourcePath: path, defaults,
});
assert.equal(target.path, locPath);
const locText = upsertLocalizationText("\uFEFF", "english", "packed_example_name", "Packed café", defaults.entryVersion);
assert.equal(locText, '\uFEFFl_english:\n packed_example_name:0 "Packed café"\n');
const owned = '\uFEFFl_english:\r\n packed_example_name:7 "Old" # retain\r\n other:0 "Keep"\r\n';
assert.equal(upsertLocalizationText(owned, "english", "packed_example_name", "New"), owned.replace('"Old"', '"New"'));
assert.equal(suggestLocalizationTarget({
  key: "packed_example_name", language: "english", locRoots: ["localization"],
  documents: [{ path: locPath, text: owned }], defaults: { newKeyFile: "localization/english/other_l_english.yml" },
}).path, locPath);
assert.throws(() => suggestLocalizationTarget({
  key: "packed_example_name", language: "english", locRoots: ["localization"], documents: [],
  override: true, defaults: { overrideFile: locPath },
}), /replace directory/);

// These builds and field names are synthetic, with no claim of game compatibility.
const manifest: MigrationManifest = {
  id: "packed.example", revision: "1", sdkVersion: 1, gameId: "ck3",
  fromVersion: "1.0", toVersion: "2.0", kind: "recipe", detection: "script", requirement: "required",
  title: "Packed consumer fixture", description: "Rename a synthetic scalar and create localization.",
  guidance: "Use only in the synthetic package fixture.", limitations: ["No target-game validation."],
  dependsOn: [], evidence: ["Synthetic migration-demo.txt fixture."], inputs: [{ root: "mod", path }],
};
const recipe: MigrationRecipe = defineMigration({
  manifest,
  inspect(context) {
    return {
      applicability: context.readText("mod", path) === before ? "applicable" : "not-applicable",
      findings: [], coverage: [],
      questions: [{ id: "label", label: "Localized label", kind: "text", required: true }],
    };
  },
  prepare(context, answers) {
    const text = context.readText("mod", path)!;
    const start = text.indexOf("demo_old");
    return {
      groups: [{
        id: "example", title: "Rename and localize the example", dependsOn: [],
        changes: [
          { kind: "text", path, edits: [{ start, end: start + "demo_old".length, text: "demo_new" }] },
          { kind: "create", path: target.path, bytes: new TextEncoder().encode(
            upsertLocalizationText("\uFEFF", "english", "packed_example_name", String(answers.label), defaults.entryVersion)
          ) },
        ],
      }],
      unresolved: [], checks: [],
    };
  },
});
const snapshot = createMigrationSnapshot({
  gameId: "ck3", mod: { [path]: before, "unrelated.bin": new Uint8Array([0, 255, 17]) },
  source: { [path]: before }, target: { [path]: after }, metadata: { fixture: "packed-consumer" },
});
const original = structuredClone(snapshot);
const answers: MigrationAnswers = { label: "Packed café" };
assert.equal((await inspectMigration(recipe, snapshot, {})).inspection.applicability, "applicable");
await assert.rejects(() => prepareMigration(recipe, snapshot, {}, "packed-fixture"), /missing answers/);
const plan = await prepareMigration(recipe, snapshot, answers, "packed-fixture");
assert.deepEqual(plan.files.map((file) => file.path), [locPath, path]);
assert.equal(await verifyPreparedMigration(plan), true);
const tampered = structuredClone(plan);
tampered.files[0].after![0] = 0;
assert.equal(await verifyPreparedMigration(tampered), false);
const result = await assertMigrationIdempotent({ recipe, snapshot, answers, codeHash: "packed-fixture" });
assert.deepEqual(result.plan, plan);
assert.deepEqual(snapshot, original);
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
assert.equal(decoder.decode(result.snapshot.files.find((file) => file.root === "mod" && file.path === path)!.bytes), after);
assert.equal(decoder.decode(result.snapshot.files.find((file) => file.root === "mod" && file.path === locPath)!.bytes), locText);
for (const file of original.files.filter((file) => file.root !== "mod" || file.path !== path)) {
  assert.deepEqual(result.snapshot.files.find((entry) => entry.root === file.root && entry.path === file.path), file);
}
const route = planMigrationRoutes([manifest], "ck3", "1.0", "2.0");
assert.deepEqual(route.issues, []);
assert.deepEqual(route.routes.map((entry) => entry.entryIds), [[manifest.id]]);
assert.deepEqual(planMigrationRoutes([manifest], "ck3", "2.0", "1.0").routes, []);
console.log("Packed migration SDK 1, engine, routes, fixtures, and localization policy passed in plain Node");
`
);
const migrationOutfile = join(scratch, "migration-consumer.mjs");
// Keep package imports external so Node itself resolves and loads the published exports.
await build({
  entryPoints: [join(scratch, "migration-consumer.ts")],
  outfile: migrationOutfile,
  bundle: false,
  platform: "node",
  format: "esm",
  target: "es2022",
  tsconfigRaw: {},
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
      types: ["node"],
      typeRoots: [join(root, "node_modules/@types")],
    },
    files: ["consumer.ts", "migration-consumer.ts"],
  })
);
const tsc = join(root, "node_modules/typescript/bin/tsc");
run(`node "${tsc}" -p tsconfig.json`);
await import(pathToFileURL(outfile).href);
run(`node "${migrationOutfile}"`);
const server = join(scratch, "node_modules/@px-lsp/server/dist/server.js");
// Reuse the transport assertions against the installed npm payload.
execSync("pnpm exec vitest run packages/server/test/stdioSmoke.test.ts", {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PX_LSP_SERVER: server },
});
console.log(
  `Packed protocol, browser declarations/data, migration/localization APIs, and server transport passed (${JSON.parse(readFileSync(join(scratch, "node_modules/@px-lsp/server/package.json"), "utf8")).version})`
);
