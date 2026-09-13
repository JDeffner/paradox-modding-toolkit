import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function liveWebviewHelper(entry = "index") {
  const configPath = join(root, "dev-paths.json");
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  const checkout = process.env.PX_LIVE_WEBVIEW_PATH || config.liveWebviewPath;
  if (typeof checkout !== "string" || !checkout.trim()) {
    throw new Error(
      "Set PX_LIVE_WEBVIEW_PATH or dev-paths.json liveWebviewPath to the built Live Webview checkout."
    );
  }
  const helper = resolve(root, checkout, "packages/helper/dist", `${entry}.js`);
  if (!existsSync(helper)) {
    throw new Error(`Live Webview helper not found at ${helper}. Run pnpm build in its checkout first.`);
  }
  return helper;
}
