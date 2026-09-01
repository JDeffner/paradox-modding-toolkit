// Bundle every webview app, discovered rather than listed: a folder
// packages/vscode/src/webviews/<name>/app/main.ts becomes
// packages/vscode/dist/webview/<name>.js. Hardcoding the names here (or in a
// package.json one-liner, as before) meant a new panel had to edit the build
// in two places or silently ship without its bundle. Paths are relative to
// this file, not the cwd, so the script runs the same from the repo root and
// from packages/vscode.
//
// `node scripts/compile-webviews.mjs --list` prints the discovered names
// (used by the packaging regression test). `--typecheck` runs `tsc -p` on
// each app's own tsconfig instead of bundling (webview apps are excluded from
// the root tsconfig: they are browser code with DOM types and nothing else).
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildSync, context } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webviewsDir = join(root, "packages", "vscode", "src", "webviews");

export function discoverWebviewApps(dir = webviewsDir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "app", "main.ts")))
    .map((e) => e.name)
    .sort();
}

function buildOptions(name) {
  return {
    entryPoints: [join(webviewsDir, name, "app", "main.ts")],
    bundle: true,
    outfile: join(root, "packages", "vscode", "dist", "webview", `${name}.js`),
    format: "iife",
    platform: "browser",
    target: "es2020",
  };
}

// Run only when invoked as a script: the packaging regression test imports
// discoverWebviewApps and must not trigger a build.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const apps = discoverWebviewApps();
  if (process.argv.includes("--list")) {
    console.log(apps.join("\n"));
  } else if (process.argv.includes("--typecheck")) {
    for (const name of apps) {
      // typescript's own entry point, so the script works without
      // node_modules/.bin on PATH (i.e. when run directly, not via pnpm).
      const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
      const result = spawnSync(process.execPath, [tsc, "-p", join(webviewsDir, name, "app")], {
        stdio: "inherit",
      });
      if (result.status) process.exit(result.status);
    }
  } else if (process.argv.includes("--watch")) {
    for (const name of apps) {
      const ctx = await context({
        ...buildOptions(name),
        plugins: [
          {
            name: "log",
            setup(build) {
              build.onEnd((result) => {
                const when = new Date().toLocaleTimeString();
                if (result.errors.length) console.log(`[${when}] ${name}: ${result.errors.length} error(s)`);
                else console.log(`[${when}] ${name} rebuilt`);
              });
            },
          },
        ],
      });
      await ctx.watch();
    }
    console.log(`watching ${apps.length} webview apps (${apps.join(", ")}); Ctrl+C stops`);
  } else {
    for (const name of apps) {
      buildSync(buildOptions(name));
    }
  }
}
