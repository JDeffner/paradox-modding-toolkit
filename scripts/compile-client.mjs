import { build, context } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { liveWebviewHelper } from "./live-webview-config.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionRoot = join(root, "packages", "vscode");
const live = process.argv.includes("--live");
const options = {
  absWorkingDir: extensionRoot,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  loader: { ".css": "text" },
  define: { __WEBVIEW_DEV__: String(live) },
  ...(live ? { alias: { "@webview-dev/helper": liveWebviewHelper() } } : {}),
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
  await build({
    absWorkingDir: extensionRoot,
    entryPoints: { steamBridge: "src/steam/bridge.ts", ddsWorker: "src/webviews/guiEditor/decodeWorker.ts" },
    outdir: "dist",
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
  });
}
